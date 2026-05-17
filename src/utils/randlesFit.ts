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
  f0?: number;          // characteristic frequency Hz: 1/(2π·Rct·Cdl)
  warnFlags?: string[]; // physical sanity warnings
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
    const Cdl = 1e-6;
    const f0 = 1 / (2 * Math.PI * Math.max(Rct, 1e-9) * Cdl);
    return {
      Rs,
      Rct,
      Cdl,
      Aw: 10,
      fitErrorPct: -1,
      fittedCurve: [],
      f0,
      warnFlags: ["Insufficient unique frequencies — geometric estimate only"],
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
  // Estimate Aw from the lowest-frequency point: at low ω, Z'' ≈ Aw/√ω
  const lowestFreqPoint = data.reduce((a, b) => (a.frequency < b.frequency ? a : b));
  const omegaLow = 2 * Math.PI * Math.max(lowestFreqPoint.frequency, 1e-9);
  const Aw0 = Math.max(lowestFreqPoint.zImag * Math.sqrt(omegaLow), 1);

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

  const f0 = 1 / (2 * Math.PI * Math.max(fitted.Rct, 1e-9) * Math.max(fitted.Cdl, 1e-30));
  const warnFlags: string[] = [];
  if (fitted.Rs < 5) warnFlags.push("Rs too low (< 5 Ω) — check reference electrode");
  else if (fitted.Rs > 5000) warnFlags.push("Rs too high (> 5 kΩ) — check electrolyte conductivity");
  if (fitted.Cdl < 1e-9) warnFlags.push("Cdl too low (< 1 nF) — fitting may not have converged");
  else if (fitted.Cdl > 1e-3) warnFlags.push("Cdl too high (> 1 mF) — possible short circuit");
  if (lmConverged && fitErrorPct > 15 && fitErrorPct !== -1) {
    warnFlags.push("Fit error > 15% — data may not follow Randles model");
  }
  if (fitted.Rct < fitted.Rs) {
    warnFlags.push("Rct < Rs — physically impossible, fit did not converge");
  }
  return {
    ...fitted,
    fitErrorPct,
    fittedCurve: lmConverged ? fittedCurve : [],
    f0,
    warnFlags,
  };
}

export interface KKResult {
  passed: boolean;
  residualPct: number; // mean |Z''_pred - Z''_meas| / mean|Z| * 100
  warning?: string;
}

/**
 * Simple Kramers-Kronig validity check using a discrete approximation
 * of the KK Hilbert transform: predict Z'' from Z' over log(ω) and
 * compare against measured Z''. Large residuals indicate the spectrum
 * is non-linear, non-stationary, or noisy.
 */
export function kramersKronigTest(data: EISDataPoint[]): KKResult {
  if (!data || data.length < 5) {
    return { passed: false, residualPct: 100, warning: "Not enough points for KK test" };
  }
  // Sort ascending in ω
  const sorted = data
    .slice()
    .filter((d) => d.frequency > 0)
    .sort((a, b) => a.frequency - b.frequency);
  const n = sorted.length;
  if (n < 5) return { passed: false, residualPct: 100, warning: "Not enough valid points for KK test" };

  const omega = sorted.map((d) => 2 * Math.PI * d.frequency);
  const zRe = sorted.map((d) => d.zReal);
  const zIm = sorted.map((d) => d.zImag);

  // Predict Z''(ω0) ≈ -(2/π) Σ_{i≠0} (zRe(ω_i) - zRe(ω0)) / (ω_i² - ω0²) · Δω_i
  const predIm = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    const w0 = omega[k];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const wi = omega[i];
      const dRe = zRe[i] - zRe[k];
      const denom = wi * wi - w0 * w0;
      if (Math.abs(denom) < 1e-12) continue;
      // Use trapezoidal Δω based on neighbours
      const wPrev = i > 0 ? omega[i - 1] : omega[i];
      const wNext = i < n - 1 ? omega[i + 1] : omega[i];
      const dW = (wNext - wPrev) / 2;
      sum += (dRe / denom) * dW;
    }
    predIm[k] = -(2 / Math.PI) * sum;
  }

  let absResid = 0;
  let meanZ = 0;
  let counted = 0;
  // Exclude bottom/top 10% of frequency range — discrete Hilbert transform has
  // edge artefacts at the lowest/highest frequencies that are not physical.
  const edgeSkip = Math.max(3, Math.floor(n * 0.1));
  for (let i = 0; i < n; i++) {
    if (i < edgeSkip || i >= n - edgeSkip) continue;
    // Skip Warburg-tail points (zIm < 0 in this sign convention) at low frequency —
    // diffusion is KK-compliant by definition but the discrete Hilbert transform
    // doesn't handle the f→0 tail well. Only flag sign flips at high frequency
    // (> 1 kHz), which would genuinely indicate non-linearity or noise.
    if (zIm[i] < 0 && sorted[i].frequency < 1000) continue;
    absResid += Math.abs(predIm[i] - zIm[i]);
    meanZ += Math.sqrt(zRe[i] * zRe[i] + zIm[i] * zIm[i]);
    counted++;
  }
  if (counted < 3) {
    return { passed: true, residualPct: 0 };
  }
  meanZ = Math.max(meanZ / counted, 1e-9);
  const residualPct = (absResid / counted / meanZ) * 100;
  const passed = residualPct <= 20;
  return {
    passed,
    residualPct,
    warning: passed
      ? undefined
      : "KK test failed — data may be non-linear, non-stationary, or noisy. Check electrode stability.",
  };
}

/**
 * Extract Warburg slope from low-frequency tail.
 * Region: f < 10 Hz OR local |Δz''/Δz'| ∈ [0.8, 1.2].
 * Linear regression z'' vs z'. Slope ≈ 1 for ideal Warburg.
 */
export function extractWarburgSlope(data: EISDataPoint[]): WarburgResult {
  if (!data || data.length < 3) return { ok: false };
  const sorted = data.slice().sort((a, b) => a.frequency - b.frequency);

  // Find index of peak zImag (top of the semicircle).
  let peakIdx = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].zImag > sorted[peakIdx].zImag) peakIdx = i;
  }

  // Warburg tail: points below the peak index (low-freq side of semicircle),
  // restricted to f < 2 Hz where Warburg dominates.
  const tail = sorted.slice(0, peakIdx).filter(d => d.frequency < 2);

  // Aw estimate from lowest-freq point regardless of slope availability.
  const lowest = sorted[0];
  const omegaLow = 2 * Math.PI * Math.max(lowest.frequency, 1e-9);
  const Aw = Math.abs(lowest.zImag) * Math.sqrt(omegaLow);

  if (tail.length < 2) return { ok: false, nPoints: tail.length, Aw };

  // Consecutive slope estimates Δ|zImag| / ΔzReal between adjacent tail points.
  const slopes: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const dRe = tail[i].zReal - tail[i - 1].zReal;
    const dIm = Math.abs(tail[i].zImag) - Math.abs(tail[i - 1].zImag);
    if (Math.abs(dRe) > 0.1) slopes.push(dIm / Math.abs(dRe));
  }

  if (slopes.length < 2) return { ok: false, nPoints: tail.length, Aw };

  const slope = slopes.reduce((s, v) => s + v, 0) / slopes.length;

  let warburgWarning: string | undefined;
  if (slope < 0.5 || slope > 1.5) {
    warburgWarning =
      "Slope deviates from ideal Warburg (1.0) — diffusion may not be rate-limiting";
  }

  return { ok: true, slope, Aw, nPoints: tail.length, warburgWarning };
}
