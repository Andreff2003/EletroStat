/**
 * SWV numerical helpers — potential program, baseline correction and peak
 * detection.  All routines are unit-tested in `src/test/swv.test.ts`.
 *
 * Scientific notes
 * ----------------
 * - SWV analytical current is the differential I_net = I_forward - I_reverse.
 * - Baseline correction operates on I_net only. Raw I_forward, I_reverse and
 *   I_net are never mutated.
 * - Peak polarity: for surface-confined or reversible diffusion SWV the peak
 *   is bell-shaped; we detect the largest |signed| extremum outside the edges.
 * - Half-peak width depends on Esw, ν, kinetics and thermodynamic regime —
 *   we only interpolate the width where signal ≥ 50 % of the corrected peak.
 */

import type {
  SWVBaselineMethod,
  SWVDataPoint,
  SWVDirection,
  SWVMetrics,
  SWVParameters,
} from "@/types/swv";

// ────────────────── potential program ──────────────────

export interface SWVProgramStep {
  index: number;
  E: number;
  time: number;
  direction: SWVDirection;
}

/**
 * Generate the staircase potential program for an SWV sweep.  The number of
 * points is `floor(|endE - startE| / step) + 1` including both endpoints.
 * `time` = quietTime + index / frequency (period per staircase step).
 */
export function generateSWVProgram(params: SWVParameters): SWVProgramStep[] {
  const {
    startE,
    endE,
    step_mV,
    frequency_Hz,
    quietTime_s = 0,
    direction,
  } = params;
  if (!Number.isFinite(startE) || !Number.isFinite(endE)) return [];
  if (!(step_mV > 0) || !(frequency_Hz > 0)) return [];
  if (startE === endE) return [];
  const step_V = step_mV / 1000;
  const span = Math.abs(endE - startE);
  const nSteps = Math.floor(span / step_V + 1e-9) + 1;
  const sign =
    direction === "cathodic"
      ? endE < startE ? -1 : -1
      : endE > startE ? 1 : 1;
  // Actual sign follows startE -> endE regardless of the label, but we still
  // report `direction` so downstream can honour anodic/cathodic naming.
  const rampSign = endE >= startE ? 1 : -1;
  const period_s = 1 / frequency_Hz;
  const out: SWVProgramStep[] = [];
  for (let i = 0; i < nSteps; i++) {
    out.push({
      index: i,
      E: startE + rampSign * i * step_V,
      time: quietTime_s + i * period_s,
      direction,
    });
  }
  void sign;
  return out;
}

// ────────────────── I_net convenience ──────────────────

/** I_net = I_forward - I_reverse.  Returns NaN if either input is not finite. */
export function computeINet(iForward: number, iReverse: number): number {
  if (!Number.isFinite(iForward) || !Number.isFinite(iReverse)) return NaN;
  return iForward - iReverse;
}

// ────────────────── numerical helpers ──────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  return median(values.map((v) => Math.abs(v - med)));
}

/** Ordinary least-squares y = a·x + b. */
function linearFit(x: number[], y: number[]): { a: number; b: number } {
  const n = x.length;
  if (n < 2) return { a: 0, b: y[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-30) return { a: 0, b: sy / n };
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  return { a, b };
}

/** Order-2 polynomial fit via normal equations. */
function polyFit2(x: number[], y: number[]): [number, number, number] {
  const n = x.length;
  if (n < 3) {
    const lin = linearFit(x, y);
    return [0, lin.a, lin.b];
  }
  let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  let T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    const x2 = xi * xi;
    S1 += xi; S2 += x2; S3 += x2 * xi; S4 += x2 * x2;
    T0 += yi; T1 += yi * xi; T2 += yi * x2;
  }
  // Solve 3x3 by Cramer.
  const M = [
    [S0, S1, S2],
    [S1, S2, S3],
    [S2, S3, S4],
  ];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-30) {
    const lin = linearFit(x, y);
    return [0, lin.a, lin.b];
  }
  const col = (i: number, v: number[]) =>
    M.map((row, r) => row.map((c, cIdx) => (cIdx === i ? v[r] : c)));
  const T = [T0, T1, T2];
  const b0 = det(col(0, T)) / D;
  const b1 = det(col(1, T)) / D;
  const b2 = det(col(2, T)) / D;
  return [b2, b1, b0];
}

// ────────────────── baseline correction ──────────────────

export interface BaselineResult {
  methodUsed: SWVBaselineMethod;
  baseline: number[];        // per-point µA
  slope_uA_V: number | null; // only for linear fits
  intercept_uA: number | null;
  warnings: string[];
}

/**
 * Estimate the range (indices) most likely to contain the peak so we can
 * exclude it from the baseline fit.  Uses the point of maximum |I_net - median|.
 */
function guessPeakBand(iNet: number[]): { lo: number; hi: number } {
  const n = iNet.length;
  if (n < 5) return { lo: 0, hi: n };
  const med = median(iNet);
  let peakIdx = 0, peakVal = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(iNet[i] - med);
    if (v > peakVal) { peakVal = v; peakIdx = i; }
  }
  const half = Math.max(3, Math.floor(n * 0.15));
  return {
    lo: Math.max(0, peakIdx - half),
    hi: Math.min(n, peakIdx + half + 1),
  };
}

export function correctBaseline(
  E: number[],
  iNet: number[],
  method: SWVBaselineMethod,
): BaselineResult {
  const n = iNet.length;
  const warnings: string[] = [];
  if (method === "none" || n < 4) {
    if (n < 4 && method !== "none") {
      warnings.push("Baseline correction unreliable — too few points.");
    }
    return {
      methodUsed: method,
      baseline: new Array(n).fill(0),
      slope_uA_V: null,
      intercept_uA: null,
      warnings,
    };
  }

  const band = guessPeakBand(iNet);
  const xEdge: number[] = [];
  const yEdge: number[] = [];
  const edgeFraction = 0.2;
  const edgeCount = Math.max(2, Math.floor(n * edgeFraction));
  for (let i = 0; i < edgeCount; i++) {
    if (i < band.lo || i >= band.hi) { xEdge.push(E[i]); yEdge.push(iNet[i]); }
  }
  for (let i = n - edgeCount; i < n; i++) {
    if (i < band.lo || i >= band.hi) { xEdge.push(E[i]); yEdge.push(iNet[i]); }
  }
  if (xEdge.length < 4) {
    // Fall back to all points outside the peak band.
    for (let i = 0; i < n; i++) {
      if (i < band.lo || i >= band.hi) { xEdge.push(E[i]); yEdge.push(iNet[i]); }
    }
    warnings.push("Peak overlaps baseline region — using all non-peak points.");
  }
  if (xEdge.length < 3) {
    warnings.push("Baseline correction unreliable — too few points.");
    return {
      methodUsed: method,
      baseline: new Array(n).fill(0),
      slope_uA_V: null,
      intercept_uA: null,
      warnings,
    };
  }

  const chooseAuto = (): SWVBaselineMethod => {
    // Compare linear residual RMS against polynomial residual RMS on the edges.
    const lin = linearFit(xEdge, yEdge);
    const poly = polyFit2(xEdge, yEdge);
    const rmsLin = Math.sqrt(
      yEdge.reduce((a, y, i) => a + (y - (lin.a * xEdge[i] + lin.b)) ** 2, 0) / yEdge.length,
    );
    const rmsPoly = Math.sqrt(
      yEdge.reduce((a, y, i) => {
        const x = xEdge[i];
        const yh = poly[0] * x * x + poly[1] * x + poly[2];
        return a + (y - yh) ** 2;
      }, 0) / yEdge.length,
    );
    return rmsPoly < rmsLin * 0.6 ? "polynomial" : "linear_edges";
  };

  let effective: SWVBaselineMethod = method;
  if (method === "auto") effective = chooseAuto();

  if (effective === "linear_edges") {
    const { a, b } = linearFit(xEdge, yEdge);
    return {
      methodUsed: "linear_edges",
      baseline: E.map((x) => a * x + b),
      slope_uA_V: a,
      intercept_uA: b,
      warnings,
    };
  }

  // polynomial
  const [c2, c1, c0] = polyFit2(xEdge, yEdge);
  if (Math.abs(c2) > 0) {
    warnings.push("Polynomial baseline may overfit — verify with raw plot.");
  }
  return {
    methodUsed: "polynomial",
    baseline: E.map((x) => c2 * x * x + c1 * x + c0),
    slope_uA_V: null,
    intercept_uA: c0,
    warnings,
  };
}

// ────────────────── peak detection ──────────────────

export interface PeakResult extends SWVMetrics {}

/**
 * Detect the dominant SWV peak on I_corrected (or I_net if no correction).
 * Handles both anodic (positive) and cathodic (negative) peaks and returns
 * SNR, half-peak width and a rough peak area.
 */
export function detectSWVPeak(
  E: number[],
  iCorrected: number[],
  iRaw: number[],
  baselineMethod: SWVBaselineMethod,
  baselineMethodUsed: SWVBaselineMethod,
  baselineSlope: number | null,
  baselineIntercept: number | null,
  baselineWarnings: string[],
): PeakResult {
  const warnings = [...baselineWarnings];
  const n = iCorrected.length;
  if (n < 5) {
    warnings.push("Not enough points to detect a peak.");
    return {
      peakCurrentRaw_uA: null,
      peakCurrentCorrected_uA: null,
      peakPotential_V: null,
      halfPeakWidth_mV: null,
      baselineMethod,
      baselineMethodUsed,
      baselineSlope_uA_V: baselineSlope,
      baselineIntercept_uA: baselineIntercept,
      snr: null,
      noiseRms_uA: null,
      peakArea_uA_V: null,
      lodEstimate_nM: null,
      peakDetected: false,
      peakPolarity: "unknown",
      warnings,
    };
  }

  // Exclude the two outermost points from the candidate peak search (edges
  // are the most likely victims of baseline residuals).
  let maxIdx = 1, minIdx = 1;
  for (let i = 1; i < n - 1; i++) {
    if (iCorrected[i] > iCorrected[maxIdx]) maxIdx = i;
    if (iCorrected[i] < iCorrected[minIdx]) minIdx = i;
  }
  const maxVal = iCorrected[maxIdx];
  const minVal = iCorrected[minIdx];
  const polarity: "anodic" | "cathodic" =
    Math.abs(maxVal) >= Math.abs(minVal) ? "anodic" : "cathodic";
  const peakIdx = polarity === "anodic" ? maxIdx : minIdx;
  const peakVal = iCorrected[peakIdx];

  // Noise from points outside a ±10 % neighbourhood of the peak, via MAD.
  const halfWin = Math.max(3, Math.floor(n * 0.1));
  const outside: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(i - peakIdx) > halfWin) outside.push(iCorrected[i]);
  }
  const noiseRms = 1.4826 * mad(outside.length ? outside : iCorrected);
  const snr = noiseRms > 0 ? Math.abs(peakVal) / noiseRms : null;

  // Half-peak width: interpolate where |I| = 0.5 · |peak| left/right of the peak.
  const half = 0.5 * peakVal;
  const cmp =
    polarity === "anodic"
      ? (v: number) => v >= half
      : (v: number) => v <= half;
  const interp = (i0: number, i1: number, target: number): number | null => {
    const y0 = iCorrected[i0], y1 = iCorrected[i1];
    if (y1 === y0) return null;
    const t = (target - y0) / (y1 - y0);
    return E[i0] + t * (E[i1] - E[i0]);
  };
  let eLeft: number | null = null;
  for (let i = peakIdx; i > 0; i--) {
    if (!cmp(iCorrected[i - 1])) {
      eLeft = interp(i - 1, i, half); break;
    }
  }
  let eRight: number | null = null;
  for (let i = peakIdx; i < n - 1; i++) {
    if (!cmp(iCorrected[i + 1])) {
      eRight = interp(i, i + 1, half); break;
    }
  }
  const halfWidth_mV =
    eLeft != null && eRight != null ? Math.abs(eRight - eLeft) * 1000 : null;

  // Peak area (trapezoid) over the ±halfWin band, informational only.
  const lo = Math.max(0, peakIdx - halfWin);
  const hi = Math.min(n - 1, peakIdx + halfWin);
  let area = 0;
  for (let i = lo; i < hi; i++) {
    area += 0.5 * (iCorrected[i] + iCorrected[i + 1]) * (E[i + 1] - E[i]);
  }

  const peakDetected = Math.abs(peakVal) > 3 * (noiseRms || 0) && snr != null && snr >= 3;
  if (!peakDetected) warnings.push("No significant SWV peak (SNR < 3).");

  return {
    peakCurrentRaw_uA: iRaw[peakIdx],
    peakCurrentCorrected_uA: peakVal,
    peakPotential_V: E[peakIdx],
    halfPeakWidth_mV: halfWidth_mV,
    baselineMethod,
    baselineMethodUsed,
    baselineSlope_uA_V: baselineSlope,
    baselineIntercept_uA: baselineIntercept,
    snr,
    noiseRms_uA: noiseRms,
    peakArea_uA_V: area,
    lodEstimate_nM: null,
    peakDetected,
    peakPolarity: polarity,
    warnings,
  };
}

/**
 * Full pipeline: apply baseline correction to a set of SWVDataPoints and
 * return per-point corrected data + SWVMetrics.
 */
export function analyzeSWV(
  data: SWVDataPoint[],
  method: SWVBaselineMethod,
): { corrected: SWVDataPoint[]; metrics: SWVMetrics } {
  if (data.length === 0) {
    return {
      corrected: [],
      metrics: {
        peakCurrentRaw_uA: null,
        peakCurrentCorrected_uA: null,
        peakPotential_V: null,
        halfPeakWidth_mV: null,
        baselineMethod: method,
        peakDetected: false,
        peakPolarity: "unknown",
        warnings: ["No SWV data."],
      },
    };
  }
  const E = data.map((d) => d.E);
  const iNet = data.map((d) => d.INet);
  const baseline = correctBaseline(E, iNet, method);
  const iCorr = iNet.map((y, i) => y - baseline.baseline[i]);
  const metrics = detectSWVPeak(
    E,
    iCorr,
    iNet,
    method,
    baseline.methodUsed,
    baseline.slope_uA_V,
    baseline.intercept_uA,
    baseline.warnings,
  );
  const corrected: SWVDataPoint[] = data.map((d, i) => ({
    ...d,
    baseline: baseline.baseline[i],
    ICorrected: iCorr[i],
  }));
  return { corrected, metrics };
}

// ────────────────── UI parameter validation ──────────────────

export interface SWVValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSWVParameters(p: SWVParameters): SWVValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isFinite(p.startE) || !Number.isFinite(p.endE))
    errors.push("startE / endE must be finite.");
  if (p.startE === p.endE) errors.push("startE must differ from endE.");
  if (!(p.step_mV > 0)) errors.push("step_mV must be > 0.");
  if (!(p.amplitude_mV > 0)) errors.push("amplitude_mV must be > 0.");
  if (!(p.frequency_Hz > 0)) errors.push("frequency_Hz must be > 0.");
  if (p.quietTime_s < 0) errors.push("quietTime_s must be ≥ 0.");
  const nPts = Number.isFinite(p.startE) && Number.isFinite(p.endE) && p.step_mV > 0
    ? Math.floor(Math.abs(p.endE - p.startE) / (p.step_mV / 1000) + 1e-9) + 1
    : 0;
  if (nPts > 0 && nPts < 20) warnings.push("Fewer than 20 points — peak fit may be poor.");
  if (p.amplitude_mV > 50)
    warnings.push("Amplitude > 50 mV: increased peak broadening / distortion.");
  if (p.frequency_Hz > 500)
    warnings.push("Frequency > 500 Hz may exceed cell settling time.");
  if (Math.abs(p.startE) > 1.5 || Math.abs(p.endE) > 1.5)
    warnings.push("Potential |E| > 1.5 V — check electrode window.");
  return { ok: errors.length === 0, errors, warnings };
}
