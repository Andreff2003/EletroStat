import type { EISDataPoint } from "@/hooks/useSimulatedData";
import { levenbergMarquardt } from "ml-levenberg-marquardt";
import { fitEIS } from "@/utils/eisFit";

/**
 * ============================================================
 *  ElectroStat — Randles Circuit Fitting + Warburg Analysis
 * ============================================================
 *
 *  Model: Z(ω) = Rs + 1 / (jωCdl + 1/(Rct + Aw/√ω · (1-j)))
 *
 *  Sign convention: zImag is true Im(Z) — NEGATIVE for capacitive
 *  behaviour (canonical Randles arc). Nyquist plots flip the sign at
 *  display time (y = -Im(Z)). All downstream consumers (WebSocket
 *  parser, CSV export, KK and Warburg helpers) follow the same rule.
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
  /** Modulus-weighted SSR / dof (legacy alias; same value as `weightedSsrPerDof`). Auto-fit only. */
  chiSquared?:       number;
  /** Degrees of freedom (2N − P). Auto-fit only. */
  dof?:              number;
  /** zReal of the auto-detected semicircle/Warburg separator. */
  autoSeparatorZReal?: number;
  /** Frequency interval (Hz) actually used by the fit. Auto-fit only. */
  fitFreqRange?:     { min: number; max: number };
  /** True when the auto-separator was geometrically weak (low prominence
   *  or fallback). Caller should advise manual adjustment. */
  separatorUncertain?: boolean;
  separatorWarning?: string;
  /** True when produced by fitRandlesAuto (vs. manual fitRandles). */
  auto?:             boolean;
}

export type WarburgMethod =
  | "regression_1_sqrt_omega_with_intercept"
  | "regression_1_sqrt_omega"
  | "endpoint";

export interface WarburgResult {
  ok:               boolean;
  /** Slope of -Im(Z) vs Z' on Nyquist (ideal Warburg ≈ 1). */
  slope?:           number;
  /** Alias for `slope` — explicit field name used in scientific exports. */
  slopeNyquist?:    number;
  /** Warburg coefficient Aw [Ω·s^(-1/2)] = slope of the -Im(Z) vs 1/√ω regression. */
  Aw?:              number;
  /** Intercept of the -Im(Z) vs 1/√ω regression [Ω] — non-zero when the
   *  Warburg tail is offset (mixed control, finite-length diffusion, or
   *  the selected tail still includes part of the semicircle). */
  interceptImag?:   number;
  /** R² of the -Im(Z) vs 1/√ω regression. */
  r2Imag?:          number;
  /** Alias for `r2Imag` — explicit name used in exports. */
  r2?:              number;
  /** R² of the Z' vs 1/√ω regression (after Rs/Rct offset removal). */
  r2Real?:          number;
  /**
   * Provenance of the Warburg fit. The current implementation is
   * `regression_1_sqrt_omega_with_intercept` — a linear regression of
   * −Im(Z) on 1/√ω that DOES fit a non-zero intercept (more robust to
   * mixed kinetic/diffusion control than an intercept-free fit).
   * `regression_1_sqrt_omega` is the legacy intercept-free label; kept
   * for backward compatibility when loading older sessions.
   */
  method?:          WarburgMethod;
  nPoints?:         number;
  /** Backwards-compatible single warning string. */
  warburgWarning?:  string;
  /** All warnings collected during the regression, in order. */
  warnings?:        string[];
}

export interface KKResult {
  passed:       boolean;
  residualPct:  number;
  /** Which check produced this result. "approximate_residual" = finite Hilbert
   *  approximation (not full Lin-KK). */
  method?:      "approximate_residual" | "lin_kk";
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

  // Vector splitting: xs and ys MUST share the same ordering so that
  // model(idx) interprets idx<nFit as real and idx>=nFit as imag. The
  // previous interleaved xs produced misaligned residuals.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nFit; i++) { xs.push(i);          ys.push(fitData[i].zReal / weights[i]); }
  for (let i = 0; i < nFit; i++) { xs.push(i + nFit);   ys.push(fitData[i].zImag / weights[i]); }

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
      parameterValues = result.parameterValues.map((v: number, i: number) =>
        clamp(v, lowerBounds[i], upperBounds[i])
      );
    }
  } catch (err) {
    console.warn("[ElectroStat] LM fit failed, using initial estimates", err);
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

export interface SplitRegionsResult {
  separatorZReal: number | null;
  separatorFrequency?: number;
  semicircle: EISDataPoint[];
  warburg: EISDataPoint[];
  /** True when the detected separator is geometrically weak (low prominence,
   *  no clear minimum after the peak, or a fallback was used). The fit and
   *  split still apply, but the UI should advise manual adjustment. */
  separatorUncertain?: boolean;
  separatorWarning?: string;
}

/** 3-point moving median — cheap noise rejection. Edges fall back to value. */
function movingMedian3(values: number[]): number[] {
  const n = values.length;
  if (n < 3) return values.slice();
  const out = new Array<number>(n);
  out[0] = values[0];
  out[n - 1] = values[n - 1];
  for (let i = 1; i < n - 1; i++) {
    const a = values[i - 1], b = values[i], c = values[i + 1];
    out[i] = a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
  }
  return out;
}

/**
 * Split a full EIS sweep into a semicircle region and a Warburg tail.
 *
 * Walks high→low frequency, finds the first prominent local maximum of a
 * lightly-smoothed |Im(Z)| (the semicircle peak), then the next local
 * minimum (the bottom of the arc) as the separator. Smoothing is applied
 * ONLY for the peak/separator search — the returned regions use raw points.
 *
 * Sets `separatorUncertain=true` (with a warning) when the peak prominence
 * is below threshold or no clear post-peak minimum exists, so the UI can
 * advise manual adjustment. Falls back to a conservative percentile-based
 * split rather than refusing to split on noisy data.
 */
export function splitRegionsAuto(data: EISDataPoint[]): SplitRegionsResult {
  const noSplit: SplitRegionsResult = {
    separatorZReal: null,
    semicircle: data.slice(),
    warburg: [] as EISDataPoint[],
  };
  if (!data || data.length < 5) return noSplit;

  const sorted = [...data].sort((a, b) => b.frequency - a.frequency);
  const n = sorted.length;

  const absImRaw = sorted.map((d) => Math.abs(d.zImag));
  // Smooth for SELECTION ONLY; the returned regions use raw points.
  const absIm = movingMedian3(absImRaw);

  // First local maximum walking high → low frequency.
  let peakIdx: number | null = null;
  for (let i = 1; i < n - 1; i++) {
    if (absIm[i] > absIm[i - 1] && absIm[i] > absIm[i + 1]) {
      peakIdx = i;
      break;
    }
  }
  let uncertain = false;
  const warnings: string[] = [];
  if (peakIdx === null) {
    // No local max: fall back to global max — but mark uncertain.
    let best = 0;
    for (let i = 1; i < n; i++) if (absIm[i] > absIm[best]) best = i;
    peakIdx = best;
    uncertain = true;
    warnings.push("No clear semicircle peak found — using global maximum.");
  }
  if (peakIdx >= n - 2) {
    // Peak at the very low-frequency end — no room for a separator.
    return {
      ...noSplit,
      separatorUncertain: true,
      separatorWarning:
        "Automatic separator uncertain — no measurable Warburg tail after the peak.",
    };
  }

  // ── Prominence check: peak must rise meaningfully above its neighbourhood.
  const peakVal = absIm[peakIdx];
  let localMin = peakVal;
  const winLo = Math.max(0, peakIdx - 3);
  const winHi = Math.min(n - 1, peakIdx + 3);
  for (let i = winLo; i <= winHi; i++) if (absIm[i] < localMin) localMin = absIm[i];
  const globalMaxAbsIm = Math.max(...absIm);
  const prominence = peakVal - localMin;
  if (peakVal <= 0 || prominence < 0.05 * Math.max(globalMaxAbsIm, 1e-12)) {
    uncertain = true;
    warnings.push("Semicircle peak prominence is low — separator may be unreliable.");
  }

  // After the peak (walking toward LOWER frequency), find the local minimum
  // of |Im(Z)| — that's the bottom of the semicircle, i.e. the separator.
  let sepIdx = peakIdx;
  let foundMin = false;
  for (let i = peakIdx + 1; i < n - 1; i++) {
    if (absIm[i] <= absIm[i - 1] && absIm[i] <= absIm[i + 1]) {
      sepIdx = i;
      foundMin = true;
      break;
    }
    sepIdx = i;
  }
  if (!foundMin) {
    uncertain = true;
    warnings.push("No clear minimum after the semicircle peak.");
    // Conservative fallback: use the 35th-percentile frequency on the
    // low-frequency side (avoids cutting too aggressively).
    const fallbackIdx = Math.min(
      n - 2,
      Math.max(peakIdx + 1, Math.floor(peakIdx + 0.35 * (n - peakIdx))),
    );
    sepIdx = fallbackIdx;
  }
  if (sepIdx <= peakIdx) return noSplit;

  // CRITICAL: Filter by FREQUENCY, not by zReal — Warburg can fold back to
  // lower zReal at low frequency; frequency is the monotonic axis.
  const separatorFrequency = sorted[sepIdx].frequency;
  const separatorZReal = sorted[sepIdx].zReal;
  const semicircle = data.filter((d) => d.frequency >= separatorFrequency);
  const warburg    = data.filter((d) => d.frequency <  separatorFrequency);
  if (semicircle.length < 4) return noSplit;

  return {
    separatorZReal,
    separatorFrequency,
    semicircle,
    warburg,
    separatorUncertain: uncertain || undefined,
    separatorWarning: uncertain
      ? `Automatic separator uncertain — adjust manually. (${warnings.join(" ")})`
      : undefined,
  };
}


// ─── Automatic Randles fit (runs on sweep completion) ─────────

/**
 * Automatic Randles fit. Uses the SAME modulus-weighted CNLS math as the
 * manual fit (delegates to `fitEIS`), but:
 *   - auto-detects the semicircle region via `splitRegionsAuto`
 *   - returns the result in `RandlesFitResult` shape (Aw=0 — Warburg is
 *     analyzed separately via `extractWarburgSlope`)
 *   - includes per-parameter standard errors and weighted SSR/dof.
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

  const semiFreqs = semi.map((d) => d.frequency).filter((f) => f > 0);
  const fitFreqRange = semiFreqs.length > 0
    ? { min: Math.min(...semiFreqs), max: Math.max(...semiFreqs) }
    : undefined;

  const warnFlags = [
    ...(cnls.warnings ?? []),
    ...(split.separatorWarning ? [split.separatorWarning] : []),
  ];

  return {
    Rs, Rct, Cdl, Aw: 0,
    // sqrt(weightedSsr/dof)*100 ≈ modulus-weighted RMSE %, consistent with CNLSFitResults.
    fitErrorPct: cnls.converged ? Math.sqrt(Math.max(cnls.chiSquared, 0)) * 100 : -1,
    fittedCurve: cnls.converged ? cnls.fittedCurve : [],
    f0,
    warnFlags: warnFlags.length > 0 ? warnFlags : undefined,
    semicirclePoints: cnls.nPoints,
    totalPoints: data.length,
    errors: cnls.errors,
    chiSquared: cnls.chiSquared,
    dof,
    autoSeparatorZReal: split.separatorZReal ?? undefined,
    fitFreqRange,
    separatorUncertain: split.separatorUncertain,
    separatorWarning: split.separatorWarning,
    auto: true,
  };
}



// ─── Warburg slope extraction ─────────────────────────────────

/** Linear regression helper: returns slope, intercept and R². */
function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssXX = 0, ssXY = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    ssXX += dx * dx; ssXY += dx * dy; ssYY += dy * dy;
  }
  if (ssXX < 1e-30) return null;
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssYY > 1e-30 ? 1 - ssRes / ssYY : 0;
  return { slope, intercept, r2 };
}

/**
 * Extract the Warburg coefficient Aw via linear regression of −Im(Z) on
 * 1/√ω WITH a fitted intercept (semi-infinite Warburg: −Z'' ≈ Aw/√ω + b,
 * with b ideally 0 but in practice non-zero for mixed kinetic/diffusion
 * control or when the selected tail still contains a small piece of the
 * semicircle). Also reports the Nyquist slope of −Im(Z) vs Z' (ideal ≈ 1)
 * and R² of both regressions so the UI can flag noisy or non-Warburg
 * tails. Returns ok=false when the regression degenerates.
 */
export function extractWarburgSlope(warburgData: EISDataPoint[]): WarburgResult {
  if (!warburgData || warburgData.length < 3) {
    return {
      ok: false,
      nPoints: warburgData?.length ?? 0,
      method: "regression_1_sqrt_omega_with_intercept",
      warnings: ["Not enough Warburg points (need ≥ 3)."],
    };
  }
  const warburg = [...warburgData].sort((a, b) => b.frequency - a.frequency);
  const n = warburg.length;


  // Regression of -Im(Z) on x = 1/√ω WITH a non-zero intercept. The
  // intercept is non-zero whenever the selected tail is offset (e.g. the
  // selection still includes part of the semicircle, or finite-length
  // diffusion has a non-Warburg DC offset). Fitting it explicitly is
  // more robust than the legacy intercept-free form and matches the
  // method label reported downstream.
  const invSqrtW = warburg.map(p => 1 / Math.sqrt(2 * Math.PI * Math.max(p.frequency, 1e-12)));
  const negIm    = warburg.map(p => -p.zImag);
  const regIm    = linreg(invSqrtW, negIm);
  // Nyquist slope of -Im(Z) vs Z' (ideal Warburg ≈ 1).
  const xsZ      = warburg.map(p => p.zReal);
  const regNyq   = linreg(xsZ, negIm);
  // Z' vs 1/√ω — diagnostic only, R² indicates quality.
  const regRe    = linreg(invSqrtW, warburg.map(p => p.zReal));

  const method: WarburgMethod = "regression_1_sqrt_omega_with_intercept";

  if (!regIm || !regNyq) {
    return {
      ok: false,
      nPoints: n,
      method,
      warnings: ["Warburg regression degenerated (collinear x or insufficient points)."],
    };
  }

  const Aw          = regIm.slope;
  const intercept   = regIm.intercept;
  const slope       = regNyq.slope;

  const warnings: string[] = [];
  if (n < 3) warnings.push("Not enough Warburg points (need ≥ 3).");
  if (!(Aw > 0))
    warnings.push("Warburg coefficient Aw ≤ 0 — not physically meaningful; check tail selection.");
  if (regIm.r2 < 0.8)
    warnings.push(
      `Warburg regression weak (R²=${regIm.r2.toFixed(2)}) — selected tail may not be pure diffusion.`,
    );
  if (slope < 0.7 || slope > 1.3)
    warnings.push(
      `Nyquist slope ${slope.toFixed(2)} outside informational band [0.7, 1.3] — diffusion may not be rate-limiting.`,
    );

  return {
    ok: true,
    slope,
    slopeNyquist: slope,
    Aw,
    interceptImag: intercept,
    r2Imag: regIm.r2,
    r2: regIm.r2,
    r2Real: regRe?.r2,
    method,
    nPoints: n,
    warburgWarning: warnings[0],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── Kramers-Kronig approximate residual check ────────────────
//
// NOTE: This is NOT a rigorous Lin-KK / Schönleber–Boukamp test. It is a
// finite-range discrete Hilbert-transform residual that depends on the
// frequency grid and edge handling. A passing result does NOT prove KK
// validity, and a failing result may simply reflect insufficient frequency
// span, drift, noise, or simply that the discrete transform is being
// applied near the band edges. For rigorous validation, run a proper
// Lin-KK fit on the spectrum. The UI labels this as "Approx. KK residual".

export function kramersKronigTest(data: EISDataPoint[]): KKResult {
  if (!data || data.length < 5) {
    return { passed: false, residualPct: 100, method: "approximate_residual", warning: "Not enough points for approx. KK residual check" };
  }

  const sorted = data
    .slice()
    .filter(d => d.frequency > 0)
    .sort((a, b) => a.frequency - b.frequency);
  const n = sorted.length;
  if (n < 5) return { passed: false, residualPct: 100, method: "approximate_residual", warning: "Not enough valid points for approx. KK residual check" };

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

  if (counted < 3) return { passed: true, residualPct: 0, method: "approximate_residual" };

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
    method: "approximate_residual",
    warning: passed
      ? undefined
      : `Approx. KK residual ${residualPct.toFixed(1)}% > threshold ${adaptiveThreshold}% (n=${n}). May indicate nonlinearity, instability, drift, noise, insufficient frequency range, or model mismatch. Use a rigorous Lin-KK fit for definitive validation.`,
  };
}
