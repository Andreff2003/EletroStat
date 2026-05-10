import type { EISDataPoint } from "@/hooks/useSimulatedData";

/**
 * Randles equivalent circuit fitting + Warburg slope extraction.
 *
 * Model:  Z(ω) = Rs + 1 / (jωCdl + 1/(Rct + Aw/√ω))
 */

export interface RandlesParams {
  Rs: number;   // Ω
  Rct: number;  // Ω
  Cdl: number;  // F
  Aw: number;   // Ω/√s
}

export interface RandlesFitResult extends RandlesParams {
  fitErrorPct: number;             // residual RMSE as % of mean |Z|
  fittedCurve: { zReal: number; zImag: number; frequency: number }[];
}

export interface WarburgResult {
  ok: boolean;
  slope?: number;   // ideal = 1.0
  Aw?: number;      // Ω/√s, derived from slope * √(2)·something — see below
  nPoints?: number;
}

/** Compute model Z for a given ω and parameters. Returns [zRe, -zIm] (so zIm is the sign-flipped value used in plots). */
function modelZ(omega: number, p: RandlesParams) {
  // Faradaic branch: Zf = Rct + Aw/√ω · (1 - j)
  const w = Aw_term(omega, p.Aw); // {re, im}
  const ZfRe = p.Rct + w.re;
  const ZfIm = w.im;
  // Y_f = 1/Zf
  const denom = ZfRe * ZfRe + ZfIm * ZfIm || 1e-30;
  const YfRe = ZfRe / denom;
  const YfIm = -ZfIm / denom;
  // Y_total = jωCdl + Y_f
  const YRe = YfRe;
  const YIm = YfIm + omega * p.Cdl;
  // Z_par = 1/Y
  const yMag2 = YRe * YRe + YIm * YIm || 1e-30;
  const ZparRe = YRe / yMag2;
  const ZparIm = -YIm / yMag2;
  // Z = Rs + Z_par
  const ZRe = p.Rs + ZparRe;
  const ZIm = ZparIm;
  // Plots use -Im(Z), which is positive for capacitive systems.
  return { zReal: ZRe, zImag: -ZIm };
}

/** Warburg impedance contribution: Aw/√ω · (1 - j). Returns the additive {re, im} on Zf. */
function Aw_term(omega: number, Aw: number) {
  const s = Aw / Math.sqrt(Math.max(omega, 1e-9));
  return { re: s, im: -s };
}

function residualSSE(points: EISDataPoint[], p: RandlesParams) {
  let sse = 0;
  for (const pt of points) {
    const omega = 2 * Math.PI * pt.frequency;
    const m = modelZ(omega, p);
    const dr = m.zReal - pt.zReal;
    const di = m.zImag - pt.zImag;
    sse += dr * dr + di * di;
  }
  return sse;
}

/** Nelder-Mead simplex over parameters in log-space (so they stay positive). */
function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number } = {},
) {
  const maxIter = opts.maxIter ?? 400;
  const tol = opts.tol ?? 1e-6;
  const n = x0.length;
  // Build initial simplex
  const simplex: { x: number[]; f: number }[] = [];
  simplex.push({ x: x0.slice(), f: f(x0) });
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] = x[i] + (x[i] === 0 ? 0.05 : 0.1);
    simplex.push({ x, f: f(x) });
  }

  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];

    // Convergence: range of f values
    if (Math.abs(worst.f - best.f) < tol) break;

    // Centroid of all but worst
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j];
    }
    for (let j = 0; j < n; j++) centroid[j] /= n;

    // Reflection
    const xr = centroid.map((c, j) => c + alpha * (c - worst.x[j]));
    const fr = f(xr);
    if (fr < second.f && fr >= best.f) {
      simplex[n] = { x: xr, f: fr };
      continue;
    }
    // Expansion
    if (fr < best.f) {
      const xe = centroid.map((c, j) => c + gamma * (xr[j] - c));
      const fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
      continue;
    }
    // Contraction
    const xc = centroid.map((c, j) => c + rho * (worst.x[j] - c));
    const fc = f(xc);
    if (fc < worst.f) {
      simplex[n] = { x: xc, f: fc };
      continue;
    }
    // Shrink
    const xb = best.x;
    for (let i = 1; i <= n; i++) {
      const x = simplex[i].x.map((v, j) => xb[j] + sigma * (v - xb[j]));
      simplex[i] = { x, f: f(x) };
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

/**
 * Fit the Randles model to a Nyquist dataset.
 * Returns null if there are <5 points.
 */
export function fitRandles(data: EISDataPoint[]): RandlesFitResult | null {
  if (!data || data.length < 5) return null;
  const zReals = data.map(d => d.zReal);
  const zImags = data.map(d => d.zImag);
  const minRe = Math.min(...zReals);
  const maxRe = Math.max(...zReals);
  const range = Math.max(maxRe - minRe, 1);

  // f at peak zImag
  let peakIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (zImags[i] > zImags[peakIdx]) peakIdx = i;
  }
  const fPeak = data[peakIdx].frequency || 100;

  const Rs0 = Math.max(minRe, 1);
  const Rct0 = Math.max(range, 10);
  const Cdl0 = 1 / (2 * Math.PI * fPeak * Rct0);
  const Aw0 = 10;

  // Optimize in log-space to keep positivity
  const x0 = [Math.log(Rs0), Math.log(Rct0), Math.log(Cdl0), Math.log(Aw0)];
  const cost = (x: number[]) => {
    const p: RandlesParams = {
      Rs: Math.exp(x[0]),
      Rct: Math.exp(x[1]),
      Cdl: Math.exp(x[2]),
      Aw: Math.exp(x[3]),
    };
    return residualSSE(data, p);
  };
  const best = nelderMead(cost, x0, { maxIter: 600, tol: 1e-8 });
  const fitted: RandlesParams = {
    Rs: Math.exp(best.x[0]),
    Rct: Math.exp(best.x[1]),
    Cdl: Math.exp(best.x[2]),
    Aw: Math.exp(best.x[3]),
  };

  // RMSE as % of mean |Z|
  const sse = best.f;
  const rmse = Math.sqrt(sse / (2 * data.length));
  const meanZ = data.reduce((s, d) => s + Math.sqrt(d.zReal * d.zReal + d.zImag * d.zImag), 0) / data.length;
  const fitErrorPct = (rmse / Math.max(meanZ, 1e-9)) * 100;

  // Build fitted curve sampled at the same frequencies (sorted by freq desc to draw nicely)
  const fittedCurve = data
    .slice()
    .sort((a, b) => b.frequency - a.frequency)
    .map(d => {
      const m = modelZ(2 * Math.PI * d.frequency, fitted);
      return { zReal: m.zReal, zImag: m.zImag, frequency: d.frequency };
    });

  return { ...fitted, fitErrorPct, fittedCurve };
}

/**
 * Extract Warburg slope from low-frequency tail.
 * Region: f < 10 Hz OR local |Δz''/Δz'| ∈ [0.8, 1.2].
 * Linear regression z'' vs z'. Slope ≈ 1 for ideal Warburg.
 */
export function extractWarburgSlope(data: EISDataPoint[]): WarburgResult {
  if (!data || data.length < 3) return { ok: false };
  // Sort ascending in frequency
  const sorted = data.slice().sort((a, b) => a.frequency - b.frequency);

  const lowFreq = sorted.filter(d => d.frequency < 10);

  // Local slopes for points at any frequency
  const localOK: EISDataPoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const dx = b.zReal - a.zReal;
    const dy = b.zImag - a.zImag;
    if (Math.abs(dx) < 1e-6) continue;
    const s = Math.abs(dy / dx);
    if (s >= 0.8 && s <= 1.2) {
      if (!localOK.includes(a)) localOK.push(a);
      if (!localOK.includes(b)) localOK.push(b);
    }
  }

  // Union (dedup by reference)
  const set = new Set<EISDataPoint>();
  lowFreq.forEach(p => set.add(p));
  localOK.forEach(p => set.add(p));
  const region = Array.from(set);

  if (region.length < 3) return { ok: false, nPoints: region.length };

  // Linear regression: zImag = m * zReal + b
  const n = region.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of region) {
    sx += p.zReal;
    sy += p.zImag;
    sxx += p.zReal * p.zReal;
    sxy += p.zReal * p.zImag;
  }
  const denom = n * sxx - sx * sx || 1e-9;
  const slope = (n * sxy - sx * sy) / denom;

  // Aw estimate: at low ω, Z'' ≈ Aw/√ω. Use the lowest-freq point.
  const lowest = sorted[0];
  const omega = 2 * Math.PI * lowest.frequency;
  const Aw = lowest.zImag * Math.sqrt(Math.max(omega, 1e-9));

  return { ok: true, slope, Aw, nPoints: n };
}
