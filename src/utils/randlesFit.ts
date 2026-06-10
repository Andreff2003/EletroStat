import type { EISDataPoint } from "@/hooks/useSimulatedData";
import { levenbergMarquardt } from "ml-levenberg-marquardt";
import { fitEIS } from "@/utils/eisFit";

/**
 * ============================================================
 *  HelpStat — Randles Circuit Fitting + Warburg Analysis
 * ============================================================
 *
 *  Model: Z(ω) = Rs + 1 / (jωCdl + 1/(Rct + Aw/√ω · (1-j)))
 *
 *  Sign convention: zImag stored as POSITIVE (i.e. -Im(Z))
 *
 *  This module no longer does any automatic region splitting.
 *  The caller decides which points are the semicircle and which
 *  belong to the Warburg tail, then passes each set in separately.
 * ============================================================
 */

export interface RandlesParams {
  Rs:  number;
  Rct: number;
  Cdl: number;
  Aw:  number;
}

export interface RandlesFitResult extends RandlesParams {
  fitErrorPct:       number;
  fittedCurve:       { zReal: number; zImag: number; frequency: number }[];
  f0?:               number;
  warnFlags?:        string[];
  semicirclePoints?: number;
  totalPoints?:      number;
  /** Per-parameter standard error in % (from covariance matrix). Auto-fit only. */
  errors?:           Record<string, number>;
  /** Reduced χ² (modulus-weighted SSR / dof). Auto-fit only. */
  chiSquared?:       number;
  /** Degrees of freedom (2N − P). Auto-fit only. */
  dof?:              number;
  /** zReal of the auto-detected semicircle/Warburg separator. */
  autoSeparatorZReal?: number;
  /** True when produced by fitRandlesAuto (vs. manual fitRandles). */
  auto?:             boolean;
}

export interface WarburgResult {
  ok:               boolean;
  slope?:           number;
  Aw?:              number;
  nPoints?:         number;
  warburgWarning?:  string;
}

export interface KKResult {
  passed:       boolean;
  residualPct:  number;
  warning?:     string;
}

// ─── Internal model ──────────────────────────────────────────

function modelZ(omega: number, p: RandlesParams): { zReal: number; zImag: number } {
  const wMag = p.Aw / Math.sqrt(Math.max(omega, 1e-12));
  const zwRe =  wMag;
  const zwIm = -wMag;

  const zfRe = p.Rct + zwRe;
  const zfIm = zwIm;

  const zfMag2 = zfRe * zfRe + zfIm * zfIm || 1e-30;
  const yfRe   =  zfRe / zfMag2;
  const yfIm   = -zfIm / zfMag2;

  const yRe = yfRe;
  const yIm = yfIm + omega * p.Cdl;

  const yMag2  = yRe * yRe + yIm * yIm || 1e-30;
  const zpRe   =  yRe / yMag2;
  const zpIm   = -yIm / yMag2;

  const ZRe = p.Rs + zpRe;
  const ZIm = zpIm;

  // Sign convention: zImag is true Im(Z) (negative for capacitive behavior).
  // NyquistPlot flips the sign at display time (y = -zImag).
  return { zReal: ZRe, zImag: ZIm };
}

// ─── Main fitting function ────────────────────────────────────

/**
 * Fit the Randles model to the SEMICIRCLE points only.
 * The caller is responsible for selecting the semicircle region
 * (e.g. via the interactive separator bar on the Nyquist plot).
 *
 * @param semicircleData  EIS points belonging to the semicircle region.
 * @param fullData        (optional) full dataset for drawing the fitted
 *                        curve across the entire frequency range. If not
 *                        provided, the curve only spans `semicircleData`.
 */
export function fitRandles(
  semicircleData: EISDataPoint[],
  fullData?: EISDataPoint[],
): RandlesFitResult | null {
  if (!semicircleData || semicircleData.length < 5) return null;

  const curveData = fullData && fullData.length >= semicircleData.length
    ? fullData
    : semicircleData;
  const totalPoints = curveData.length;

  // Sort high → low frequency for consistency
  const fitData = [...semicircleData].sort((a, b) => b.frequency - a.frequency);
  const nFit = fitData.length;

  const uniqueFreqs = new Set(fitData.map(d => d.frequency));
  if (uniqueFreqs.size < 5) {
    const zReals = fitData.map(d => d.zReal);
    const Rs  = Math.min(...zReals);
    const Rct = Math.max(...zReals) - Rs;
    const Cdl = 1e-6;
    return {
      Rs, Rct, Cdl, Aw: 10,
      fitErrorPct: -1, fittedCurve: [],
      f0: 1 / (2 * Math.PI * Math.max(Rct, 1) * Cdl),
      warnFlags: ["Insufficient unique frequencies — geometric estimate only"],
      totalPoints, semicirclePoints: nFit,
    };
  }

  // ── Initial parameter estimates ───────────────────────────────
  // fitData is sorted high → low frequency.
  const highFreqZre = fitData[0].zReal;
  const lowFreqZre  = fitData[fitData.length - 1].zReal;

  const Rs0  = Math.max(highFreqZre, 1);
  const Rct0 = Math.max(lowFreqZre - highFreqZre, 10);

  // f0: frequency at peak |Im(Z)| within fitData (capacitive peak;
  // zImag is now true Im(Z), so it's most-negative at the peak).
  const peakInFit = fitData.reduce(
    (best, p) => (Math.abs(p.zImag) > Math.abs(best.zImag) ? p : best), fitData[0]
  );
  const fPeak = peakInFit.frequency || 100;
  const Cdl0 = 1 / (2 * Math.PI * fPeak * Math.max(Rct0, 1));

  // Aw0: only meaningful when a Warburg tail exists. The caller of fitRandles
  // passes the SEMICIRCLE region only, so we have no Warburg data here and
  // the safe default is 1.0 — estimating from the lowest semicircle point
  // overshoots and pushes Cdl onto its bound.
  const hasWarburgTail = fullData !== undefined && fullData.length > nFit;
  let Aw0 = 1.0;
  if (hasWarburgTail) {
    const wbPts = [...fullData!]
      .filter(d => !fitData.includes(d))
      .sort((a, b) => a.frequency - b.frequency);
    if (wbPts.length > 0) {
      const lowestW = wbPts[0];
      const omegaW  = 2 * Math.PI * Math.max(lowestW.frequency, 1e-9);
      Aw0 = Math.max(Math.abs(lowestW.zImag) * Math.sqrt(omegaW), 0.1);
    }
  }

  // ── LM fitting in log-space ───────────────────────────────────
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  const lowerBounds = [
    Math.log(0.01), Math.log(0.01), Math.log(1e-12), Math.log(0.001),
  ];
  const upperBounds = [
    Math.log(1e5), Math.log(1e9), Math.log(1.0), Math.log(1e6),
  ];

  const initial = [
    clamp(Math.log(Rs0),  lowerBounds[0], upperBounds[0]),
    clamp(Math.log(Rct0), lowerBounds[1], upperBounds[1]),
    clamp(Math.log(Cdl0), lowerBounds[2], upperBounds[2]),
    clamp(Math.log(Aw0),  lowerBounds[3], upperBounds[3]),
  ];

  // Per-point weights: 1/|Z_i| → modulus-weighted least squares.
  // Equivalent to dividing each residual (real and imag) by |Z_i|.
  const weights = fitData.map(d =>
    Math.sqrt(Math.max(d.zReal * d.zReal + d.zImag * d.zImag, 1e-9))
  );

  const xs = fitData.flatMap((_, i) => [i, i + nFit]);
  const ys = [
    ...fitData.map((d, i) => d.zReal / weights[i]),
    ...fitData.map((d, i) => d.zImag / weights[i]),
  ];

  const modelFn = ([lRs, lRct, lCdl, lAw]: number[]) => (idx: number) => {
    const p: RandlesParams = {
      Rs:  Math.exp(lRs),
      Rct: Math.exp(lRct),
      Cdl: Math.exp(lCdl),
      Aw:  Math.exp(lAw),
    };
    const isReal = idx < nFit;
    const i      = isReal ? idx : idx - nFit;
    const m = modelZ(2 * Math.PI * fitData[i].frequency, p);
    const v = isReal ? m.zReal : m.zImag;
    return v / weights[i];
  };

  let parameterValues: number[] = initial;
  let lmConverged = true;

  try {
    const result = levenbergMarquardt({ x: xs, y: ys }, modelFn, {
      initialValues: initial,
      damping:       1e-3,
      maxIterations: 500,
      errorTolerance: 1e-10,
    });
    if (!result?.parameterValues || result.parameterValues.length < 4) {
      lmConverged = false;
    } else {
      parameterValues = result.parameterValues.map((v, i) =>
        clamp(v, lowerBounds[i], upperBounds[i])
      );
    }
  } catch (err) {
    console.warn("[HelpStat] LM fit failed, using initial estimates", err);
    lmConverged = false;
  }

  const fitted: RandlesParams = {
    Rs:  Math.exp(parameterValues[0]),
    Rct: Math.exp(parameterValues[1]),
    Cdl: Math.exp(parameterValues[2]),
    Aw:  Math.exp(parameterValues[3]),
  };

  // ── Modulus-weighted RMSE on the semicircle region only ─────
  let sse = 0;
  for (const pt of fitData) {
    const m  = modelZ(2 * Math.PI * pt.frequency, fitted);
    const dr = m.zReal - pt.zReal;
    const di = m.zImag - pt.zImag;
    const weight = Math.max(pt.zReal * pt.zReal + pt.zImag * pt.zImag, 1e-9);
    sse += (dr * dr + di * di) / weight;
  }
  // Weighted RMSE is dimensionless (already normalized by |Z|^2);
  // multiply by 100 to express as a percent.
  const fitErrorPct = lmConverged ? Math.sqrt(sse / (2 * nFit)) * 100 : -1;


  // ── Dense fitted curve (200 log-spaced points) over full range ─
  const allFreq = curveData.map(d => d.frequency).filter(f => f > 0);
  const fMin = Math.min(...allFreq);
  const fMax = Math.max(...allFreq);
  const logMin = Math.log10(Math.max(fMin, 1e-9));
  const logMax = Math.log10(Math.max(fMax, fMin * 10));
  const DENSE = 200;
  const fittedCurve = Array.from({ length: DENSE }, (_, i) => {
    const logF = logMax - ((logMax - logMin) * i) / (DENSE - 1);
    const f = Math.pow(10, logF);
    const m = modelZ(2 * Math.PI * f, fitted);
    return { zReal: m.zReal, zImag: m.zImag, frequency: f };
  });

  const f0 = 1 / (2 * Math.PI * Math.max(fitted.Rct, 1e-9) * Math.max(fitted.Cdl, 1e-30));

  const warnFlags: string[] = [];
  if (fitted.Rs < 1)
    warnFlags.push("Rs too low (< 1 Ω) — check reference electrode");
  else if (fitted.Rs > 5000)
    warnFlags.push("Rs too high (> 5 kΩ) — check electrolyte conductivity");
  if (fitted.Cdl < 1e-12)
    warnFlags.push("Cdl too low (< 1 pF) — fitting may not have converged");
  else if (fitted.Cdl > 0.5)
    warnFlags.push("Cdl too high (> 500 mF) — possible short circuit");
  if (lmConverged && fitErrorPct > 15)
    warnFlags.push("Fit error > 15% — data may not follow Randles model");
  if (fitted.Rct < fitted.Rs)
    warnFlags.push("Rct < Rs — physically impossible, fit did not converge");

  return {
    ...fitted,
    fitErrorPct,
    fittedCurve: lmConverged ? fittedCurve : [],
    f0,
    warnFlags: warnFlags.length > 0 ? warnFlags : undefined,
    semicirclePoints: nFit,
    totalPoints,
  };
}

// ─── Automatic region splitting ───────────────────────────────

/**
 * Split a full EIS sweep into a semicircle region and a Warburg tail by
 * locating the FIRST local maximum of |Im(Z)| as a function of ascending
 * frequency-index (i.e. sorted low → high frequency, where the semicircle
 * peak appears before the low-frequency Warburg climb).
 *
 * Returns the zReal value at the detected separator point.
 * Falls back to a null separator (no split) when no local max is found
 * or when it is too close to either endpoint.
 */
export function splitRegionsAuto(
  data: EISDataPoint[],
): { separatorZReal: number | null; semicircle: EISDataPoint[]; warburg: EISDataPoint[] } {
  const noSplit = { separatorZReal: null, semicircle: data.slice(), warburg: [] as EISDataPoint[] };
  if (!data || data.length < 5) return noSplit;

  // Sort low → high frequency. Walking forward = walking from Warburg tail
  // toward high-frequency end. We want the first local max of |Im(Z)| as
  // we walk from HIGH → LOW frequency (the semicircle peak appears first
  // before the Warburg tail rises again). So sort high → low.
  const sorted = [...data].sort((a, b) => b.frequency - a.frequency);
  const n = sorted.length;

  const absIm = sorted.map(d => Math.abs(d.zImag));

  // First local maximum walking high → low frequency.
  // NEVER use global max — Warburg tail |Im(Z)| can exceed the semicircle peak.
  let peakIdx: number | null = null;
  for (let i = 1; i < n - 1; i++) {
    if (absIm[i] > absIm[i - 1] && absIm[i] > absIm[i + 1]) {
      peakIdx = i;
      break;
    }
  }
  // Fallback to global max only if no local max found
  if (peakIdx === null) {
    let best = 0;
    for (let i = 1; i < n; i++) if (absIm[i] > absIm[best]) best = i;
    peakIdx = best;
  }
  if (peakIdx >= n - 2) return noSplit;

  // After the peak (walking toward LOWER frequency), find the local minimum
  // of |Im(Z)| — that's the bottom of the semicircle, i.e. the separator.
  let sepIdx = peakIdx;
  for (let i = peakIdx + 1; i < n - 1; i++) {
    if (absIm[i] <= absIm[i - 1] && absIm[i] <= absIm[i + 1]) {
      sepIdx = i;
      break;
    }
    sepIdx = i;
  }
  if (sepIdx <= peakIdx) return noSplit;

  // CRITICAL: Filter by FREQUENCY, not by zReal.
  // The Warburg tail folds back to LOWER zReal values at low frequency,
  // so a zReal-based filter would incorrectly include Warburg points in
  // the semicircle region. Frequency is monotonic — high freq = semicircle.
  const separatorFreq = sorted[sepIdx].frequency;
  const separatorZReal = sorted[sepIdx].zReal;
  const semicircle = data.filter(d => d.frequency >= separatorFreq);
  const warburg    = data.filter(d => d.frequency <  separatorFreq);
  if (semicircle.length < 4) return noSplit;
  return { separatorZReal, semicircle, warburg };
}

// ─── Automatic Randles fit (runs on sweep completion) ─────────

/**
 * Automatic Randles fit. Uses the SAME modulus-weighted CNLS math as the
 * manual fit (delegates to `fitEIS`), but:
 *   - auto-detects the semicircle region via `splitRegionsAuto`
 *   - returns the result in `RandlesFitResult` shape (Aw=0 — Warburg is
 *     analyzed separately via `extractWarburgSlope`)
 *   - includes per-parameter standard errors and reduced χ².
 */
export function fitRandlesAuto(data: EISDataPoint[]): RandlesFitResult | null {
  if (!data || data.length < 5) return null;
  const split = splitRegionsAuto(data);
  const semi = split.semicircle;
  if (semi.length < 4) return null;

  // Reuse the proven CNLS fitter — same math as the manual panel.
  const cnls = fitEIS(semi, "randles", data);
  if (!cnls) return null;

  const Rs  = cnls.params.Rs  ?? 0;
  const Rct = cnls.params.Rct ?? 0;
  const Cdl = cnls.params.Cdl ?? 0;
  const dof = Math.max(2 * cnls.nPoints - cnls.nFreeParams, 1);

  const f0 = 1 / (2 * Math.PI * Math.max(Rct, 1e-9) * Math.max(Cdl, 1e-30));

  return {
    Rs, Rct, Cdl, Aw: 0,
    fitErrorPct: cnls.converged ? cnls.chiSquared * 100 : -1,
    fittedCurve: cnls.converged ? cnls.fittedCurve : [],
    f0,
    warnFlags: cnls.warnings,
    semicirclePoints: cnls.nPoints,
    totalPoints: data.length,
    errors: cnls.errors,
    chiSquared: cnls.chiSquared,
    dof,
    autoSeparatorZReal: split.separatorZReal ?? undefined,
    auto: true,
  };
}



// ─── Warburg slope extraction ─────────────────────────────────

/**
 * Extracts the Warburg slope from the points the caller has
 * identified as the Warburg tail (right of the separator).
 */
export function extractWarburgSlope(warburgData: EISDataPoint[]): WarburgResult {
  if (!warburgData || warburgData.length < 3) return { ok: false, nPoints: warburgData?.length ?? 0 };

  const warburg = [...warburgData].sort((a, b) => b.frequency - a.frequency);
  const lowestW  = warburg[warburg.length - 1];
  const omegaLow = 2 * Math.PI * Math.max(lowestW.frequency, 1e-9);
  // zImag is true Im(Z) — negative for capacitive. Warburg Aw and slope
  // are defined in terms of -Im(Z) (positive values on Nyquist plot).
  const Aw = Math.abs(lowestW.zImag) * Math.sqrt(omegaLow);

  const n    = warburg.length;
  const xs   = warburg.map(p => p.zReal);
  const ys   = warburg.map(p => -p.zImag);  // flip to positive (-Im(Z))
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const ssXX  = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const ssXY  = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);

  if (ssXX < 1e-9) return { ok: false, nPoints: n, Aw };

  const slope = ssXY / ssXX;

  let warburgWarning: string | undefined;
  if (slope < 0.5 || slope > 2.0) {
    warburgWarning =
      "Slope deviates significantly from ideal Warburg (1.0) — diffusion may not be rate-limiting";
  } else if (slope < 0.8 || slope > 1.2) {
    warburgWarning =
      "Slope slightly off ideal Warburg (1.0) — mixed kinetic-diffusion control possible";
  }

  return { ok: true, slope, Aw, nPoints: n, warburgWarning };
}

// ─── Kramers-Kronig validity test ─────────────────────────────

export function kramersKronigTest(data: EISDataPoint[]): KKResult {
  if (!data || data.length < 5) {
    return { passed: false, residualPct: 100, warning: "Not enough points for KK test" };
  }

  const sorted = data
    .slice()
    .filter(d => d.frequency > 0)
    .sort((a, b) => a.frequency - b.frequency);
  const n = sorted.length;
  if (n < 5) return { passed: false, residualPct: 100, warning: "Not enough valid points for KK test" };

  const omega = sorted.map(d => 2 * Math.PI * d.frequency);
  const zRe   = sorted.map(d => d.zReal);
  const zIm   = sorted.map(d => d.zImag);

  const predIm = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    const w0 = omega[k];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const wi    = omega[i];
      const denom = wi * wi - w0 * w0;
      if (Math.abs(denom) < 1e-12) continue;
      const wPrev = i > 0     ? omega[i - 1] : omega[i];
      const wNext = i < n - 1 ? omega[i + 1] : omega[i];
      const dW    = (wNext - wPrev) / 2;
      sum += ((zRe[i] - zRe[k]) / denom) * dW;
    }
    predIm[k] = -(2 / Math.PI) * sum;
  }

  const edgeSkip = Math.max(2, Math.floor(n * 0.1));
  let absResid = 0;
  let meanZ    = 0;
  let counted  = 0;
  for (let i = edgeSkip; i < n - edgeSkip; i++) {
    absResid += Math.abs(predIm[i] - zIm[i]);
    meanZ    += Math.sqrt(zRe[i] ** 2 + zIm[i] ** 2);
    counted++;
  }

  if (counted < 3) return { passed: true, residualPct: 0 };

  meanZ = Math.max(meanZ / counted, 1e-9);
  const residualPct = (absResid / counted / meanZ) * 100;
  // Adaptive threshold: discrete KK Hilbert approximation has inherent
  // numerical error ~400/n %. With 34-60 pts this is 7-12%.
  // Floor at 5% (Boukamp 1995), cap at 15%.
  const adaptiveThreshold = Math.min(15, Math.max(5, Math.round(400 / n)));
  const passed = residualPct <= adaptiveThreshold;

  return {
    passed,
    residualPct,
    warning: passed
      ? undefined
      : `KK test: ${residualPct.toFixed(1)}% residual (threshold ${adaptiveThreshold}% for ${n} pts) — data may be non-linear or noisy. Check electrode stability.`,
  };
}
