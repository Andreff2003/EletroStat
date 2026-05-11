import type { EISDataPoint } from "@/hooks/useSimulatedData";
// Levenberg-Marquardt least-squares from ml-levenberg-marquardt.
import { levenbergMarquardt } from "ml-levenberg-marquardt";

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
  warburgWarning?: string;
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

  // If fewer than 5 unique frequency values, skip LM and return a simple geometric estimate.
  const uniqueFreqs = new Set(data.map(d => d.frequency));
  if (uniqueFreqs.size < 5) {
    const Rs = Math.min(...zReals);
    const Rct = Math.max(...zReals) - Rs;
    return {
      Rs,
      Rct,
      Cdl: 1e-6,
      Aw: 10,
      fitErrorPct: -1,
      fittedCurve: [],
    };
  }

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

  // Stack real + imaginary residuals into a single vector for LM.
  // x = index; y = [zReal_0..zReal_{n-1}, zImag_0..zImag_{n-1}]
  const n = data.length;
  const xs = new Array(2 * n);
  const ys = new Array(2 * n);
  for (let i = 0; i < n; i++) {
    xs[i] = i;
    xs[i + n] = i + n;
    ys[i] = data[i].zReal;
    ys[i + n] = data[i].zImag;
  }

  // Fit in log-space to keep parameters positive.
  // params = [logRs, logRct, logCdl, logAw]
  const modelFn = ([lRs, lRct, lCdl, lAw]: number[]) => (idx: number) => {
    const p: RandlesParams = {
      Rs: Math.exp(lRs),
      Rct: Math.exp(lRct),
      Cdl: Math.exp(lCdl),
      Aw: Math.exp(lAw),
    };
    const which = idx < n ? "re" : "im";
    const i = idx < n ? idx : idx - n;
    const m = modelZ(2 * Math.PI * data[i].frequency, p);
    return which === "re" ? m.zReal : m.zImag;
  };

  const initial = [Math.log(Rs0), Math.log(Rct0), Math.log(Cdl0), Math.log(Aw0)];
  let parameterValues: number[];
  let lmConverged = true;
  try {
    const result = levenbergMarquardt({ x: xs, y: ys }, modelFn, {
      initialValues: initial,
      damping: 1e-3,
      maxIterations: 200,
      errorTolerance: 1e-8,
    });
    if (!result || !result.parameterValues || result.parameterValues.length < 4) {
      lmConverged = false;
      parameterValues = initial;
    } else {
      parameterValues = result.parameterValues;
    }
  } catch (err) {
    console.warn("LM fit failed, falling back to initial guess", err);
    parameterValues = initial;
    lmConverged = false;
  }

  const fitted: RandlesParams = {
    Rs: Math.exp(parameterValues[0]),
    Rct: Math.exp(parameterValues[1]),
    Cdl: Math.exp(parameterValues[2]),
    Aw: Math.exp(parameterValues[3]),
  };

  // Compute final RMSE as % of mean |Z|
  let sse = 0;
  for (const pt of data) {
    const m = modelZ(2 * Math.PI * pt.frequency, fitted);
    const dr = m.zReal - pt.zReal;
    const di = m.zImag - pt.zImag;
    sse += dr * dr + di * di;
  }
  const rmse = Math.sqrt(sse / (2 * data.length));
  const meanZ = data.reduce((s, d) => s + Math.sqrt(d.zReal * d.zReal + d.zImag * d.zImag), 0) / data.length;
  const fitErrorPct = lmConverged ? (rmse / Math.max(meanZ, 1e-9)) * 100 : -1;

  // Build fitted curve sampled at the same frequencies (sorted by freq desc to draw nicely)
  const fittedCurve = data
    .slice()
    .sort((a, b) => b.frequency - a.frequency)
    .map(d => {
      const m = modelZ(2 * Math.PI * d.frequency, fitted);
      return { zReal: m.zReal, zImag: m.zImag, frequency: d.frequency };
    });

  return { ...fitted, fitErrorPct, fittedCurve: lmConverged ? fittedCurve : [] };
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
  let region = Array.from(set);
  let usedFallback = false;

  if (region.length < 3) {
    // Fallback: 5 lowest-frequency points regardless of slope
    region = sorted.slice(0, Math.min(5, sorted.length));
    usedFallback = true;
    if (region.length < 3) return { ok: false, nPoints: region.length };
  }

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

  let warburgWarning: string | undefined;
  if (usedFallback) {
    warburgWarning =
      "Based on lowest-frequency points (strict Warburg region not detected)";
  } else if (slope < 0.5 || slope > 2.0) {
    warburgWarning =
      "Slope deviates from ideal Warburg (1.0) — diffusion may not be rate-limiting";
  }

  return { ok: true, slope, Aw, nPoints: n, warburgWarning };
}
