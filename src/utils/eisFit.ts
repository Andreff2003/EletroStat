import { levenbergMarquardt } from "ml-levenberg-marquardt";
import type { EISDataPoint } from "@/hooks/useSimulatedData";

/**
 * ============================================================
 *  HelpStat — Scientific CNLS EIS Fitting
 * ============================================================
 *
 *  Implements Complex Non-Linear Least Squares fitting using
 *  the "vector splitting" trick to allow the real-valued LM
 *  algorithm to fit complex impedance:
 *
 *     Y_exp = [Z'_1, ..., Z'_N, Z''_1, ..., Z''_N]
 *
 *  Weighting: MODULUS weighting
 *     w_i = 1 / |Z_exp,i|^2
 *
 *  Quality indicator: Reduced chi-squared
 *     χ²_red = Σ w_i ((Z'-Z'_c)^2 + (Z''-Z''_c)^2) / (2N - P)
 *
 *  Parameter uncertainty: Standard error (%) per parameter,
 *  derived from the covariance matrix
 *     Cov ≈ χ²_red · (Jᵀ J)⁻¹
 *  where J is the numerical Jacobian in NATURAL parameter
 *  space evaluated at the converged point.
 *
 *  Supported equivalent circuits:
 *    1. "randles"      Rs + (Rct // Cdl)
 *    2. "randles-cpe"  Rs + (Rct // CPE), Z_CPE = 1/(Q(jω)^n)
 * ============================================================
 */

export type CircuitModel = "randles" | "randles-cpe";

export interface EISFitResult {
  model:        CircuitModel;
  params:       Record<string, number>; // natural-space values
  errors:       Record<string, number>; // standard error in %
  units:        Record<string, string>;
  chiSquared:   number;                  // reduced χ²
  fittedCurve:  { zReal: number; zImag: number; frequency: number }[];
  nPoints:      number;
  nFreeParams:  number;
  converged:    boolean;
  warnings?:    string[];
}

const TWO_PI = 2 * Math.PI;

interface ModelDef {
  paramNames: string[];
  units:      Record<string, string>;
  /** true if the parameter is fitted in log-space (must be > 0). */
  isLog:      boolean[];
  initial:    (d: EISDataPoint[]) => number[]; // returns log-space where applicable
  bounds:     { lower: number[]; upper: number[] };
  Z:          (lp: number[], omega: number) => { re: number; im: number };
}

// ─── Randles simplified: Rs + (Rct // Cdl) ───────────────────
// Z(ω) = Rs + Rct / (1 + jωRctCdl)
const MODEL_RANDLES: ModelDef = {
  paramNames: ["Rs", "Rct", "Cdl"],
  units:      { Rs: "Ω", Rct: "Ω", Cdl: "F" },
  isLog:      [true, true, true],
  initial: (d) => {
    const s   = [...d].sort((a, b) => b.frequency - a.frequency);
    const Rs  = Math.max(s[0].zReal, 1);
    const Rct = Math.max(s[s.length - 1].zReal - Rs, 10);
    const peak = s.reduce(
      (b, p) => (Math.abs(p.zImag) > Math.abs(b.zImag) ? p : b),
      s[0],
    );
    const Cdl = 1 / (TWO_PI * Math.max(peak.frequency, 1) * Math.max(Rct, 1));
    return [Math.log(Rs), Math.log(Rct), Math.log(Cdl)];
  },
  bounds: {
    lower: [Math.log(0.01), Math.log(0.01), Math.log(1e-12)],
    upper: [Math.log(1e6),  Math.log(1e9),  Math.log(1.0)],
  },
  Z: (lp, omega) => {
    const Rs = Math.exp(lp[0]), Rct = Math.exp(lp[1]), Cdl = Math.exp(lp[2]);
    // Rct / (1 + jωRctCdl)
    const dRe = 1;
    const dIm = omega * Rct * Cdl;
    const m2  = dRe * dRe + dIm * dIm;
    return {
      re: Rs + (Rct * dRe) / m2,
      im: -(Rct * dIm) / m2,
    };
  },
};

// ─── Randles + CPE: Rs + (Rct // CPE) ────────────────────────
// Y_CPE = Q (jω)^n = Q ω^n (cos(nπ/2) + j sin(nπ/2))
const MODEL_RANDLES_CPE: ModelDef = {
  paramNames: ["Rs", "Rct", "Q", "n"],
  units:      { Rs: "Ω", Rct: "Ω", Q: "S·sⁿ", n: "" },
  isLog:      [true, true, true, false],   // n stays in raw space (0–1)
  initial: (d) => {
    const s   = [...d].sort((a, b) => b.frequency - a.frequency);
    const Rs  = Math.max(s[0].zReal, 1);
    const Rct = Math.max(s[s.length - 1].zReal - Rs, 10);
    const peak = s.reduce(
      (b, p) => (Math.abs(p.zImag) > Math.abs(b.zImag) ? p : b),
      s[0],
    );
    const Q0  = 1 / (TWO_PI * Math.max(peak.frequency, 1) * Math.max(Rct, 1));
    return [Math.log(Rs), Math.log(Rct), Math.log(Q0), 0.9];
  },
  bounds: {
    lower: [Math.log(0.01), Math.log(0.01), Math.log(1e-12), 0.3],
    upper: [Math.log(1e6),  Math.log(1e9),  Math.log(1.0),   1.0],
  },
  Z: (lp, omega) => {
    const Rs  = Math.exp(lp[0]);
    const Rct = Math.exp(lp[1]);
    const Q   = Math.exp(lp[2]);
    const n   = lp[3];
    const a   = (n * Math.PI) / 2;
    const wn  = Math.pow(omega, n);
    const ycRe = Q * wn * Math.cos(a);
    const ycIm = Q * wn * Math.sin(a);
    const yRe  = 1 / Rct + ycRe;
    const yIm  = ycIm;
    const m2   = yRe * yRe + yIm * yIm || 1e-30;
    return {
      re: Rs +  yRe / m2,
      im: -yIm / m2,
    };
  },
};

const MODELS: Record<CircuitModel, ModelDef> = {
  "randles":     MODEL_RANDLES,
  "randles-cpe": MODEL_RANDLES_CPE,
};

export function getCircuitParamNames(m: CircuitModel): string[] {
  return MODELS[m].paramNames.slice();
}

export function getCircuitLabel(m: CircuitModel): string {
  return m === "randles"
    ? "Randles (Rs + Rct ∥ Cdl)"
    : "Randles + CPE (Rs + Rct ∥ CPE)";
}

// ─── Core fitter ─────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export function fitEIS(
  data: EISDataPoint[],
  model: CircuitModel,
  fullData?: EISDataPoint[],
): EISFitResult | null {
  if (!data || data.length < 4) return null;

  const def = MODELS[model];
  const P   = def.paramNames.length;
  const fit = [...data].sort((a, b) => b.frequency - a.frequency);
  const N   = fit.length;

  // Modulus weighting: residual divided by |Z|  →  weight = 1/|Z|²
  const invMod = fit.map(d =>
    1 / Math.max(Math.sqrt(d.zReal * d.zReal + d.zImag * d.zImag), 1e-9),
  );

  // Vector splitting:  y = [Z'/|Z|, Z''/|Z|]
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < N; i++) { xs.push(i);     ys.push(fit[i].zReal * invMod[i]); }
  for (let i = 0; i < N; i++) { xs.push(i + N); ys.push(fit[i].zImag * invMod[i]); }

  const initial = def
    .initial(fit)
    .map((v, i) => clamp(v, def.bounds.lower[i], def.bounds.upper[i]));

  const modelFn = (p: number[]) => (idx: number) => {
    const isReal = idx < N;
    const i      = isReal ? idx : idx - N;
    const z      = def.Z(p, TWO_PI * fit[i].frequency);
    return (isReal ? z.re : z.im) * invMod[i];
  };

  let converged = true;
  let params    = initial;
  try {
    const r = levenbergMarquardt({ x: xs, y: ys }, modelFn, {
      initialValues:  initial,
      damping:        1e-3,
      maxIterations:  500,
      errorTolerance: 1e-10,
    });
    if (r?.parameterValues?.length === P) {
      params = r.parameterValues.map((v, i) =>
        clamp(v, def.bounds.lower[i], def.bounds.upper[i]),
      );
    } else converged = false;
  } catch (err) {
    console.warn("[HelpStat] CNLS LM failed", err);
    converged = false;
  }

  // ── Reduced χ² ─────────────────────────────────────────────
  let chiNum = 0;
  for (let i = 0; i < N; i++) {
    const z  = def.Z(params, TWO_PI * fit[i].frequency);
    const wi = invMod[i] * invMod[i];
    const dr = fit[i].zReal - z.re;
    const di = fit[i].zImag - z.im;
    chiNum += wi * (dr * dr + di * di);
  }
  const dof = Math.max(2 * N - P, 1);
  const chiSquared = chiNum / dof;

  // ── Convert to natural-space parameter values ──────────────
  const realParams = params.map((v, i) => (def.isLog[i] ? Math.exp(v) : v));

  // ── Numerical Jacobian in natural space (central differences)
  // residual_i = (y_exp - y_pred) / |Z|   →  ∂r/∂p = -(∂y_pred/∂p)/|Z|
  const eps = 1e-6;
  const Znat = (rp: number[], omega: number) => {
    const lp = rp.map((v, i) => (def.isLog[i] ? Math.log(Math.max(v, 1e-30)) : v));
    return def.Z(lp, omega);
  };

  const J: number[][] = Array.from({ length: 2 * N }, () => new Array(P).fill(0));
  for (let p = 0; p < P; p++) {
    const scale = Math.max(Math.abs(realParams[p]) * eps, 1e-12);
    const plus  = realParams.slice(); plus[p]  += scale;
    const minus = realParams.slice(); minus[p] -= scale;
    for (let i = 0; i < N; i++) {
      const om = TWO_PI * fit[i].frequency;
      const zP = Znat(plus,  om);
      const zM = Znat(minus, om);
      J[i][p]     = -((zP.re - zM.re) / (2 * scale)) * invMod[i];
      J[i + N][p] = -((zP.im - zM.im) / (2 * scale)) * invMod[i];
    }
  }

  // (JᵀJ)
  const JtJ: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      let s = 0;
      for (let i = 0; i < 2 * N; i++) s += J[i][a] * J[i][b];
      JtJ[a][b] = s;
    }
  }
  const cov = invertMatrix(JtJ);

  const errors: Record<string, number> = {};
  for (let i = 0; i < P; i++) {
    const stdSq = cov ? cov[i][i] * chiSquared : NaN;
    const std   = Number.isFinite(stdSq) && stdSq >= 0 ? Math.sqrt(stdSq) : NaN;
    const pct   = Number.isFinite(std) && realParams[i] !== 0
      ? (std / Math.abs(realParams[i])) * 100
      : NaN;
    errors[def.paramNames[i]] = pct;
  }

  const paramsOut: Record<string, number> = {};
  def.paramNames.forEach((n, i) => { paramsOut[n] = realParams[i]; });

  // ── Fitted curve on a DENSE log-spaced frequency grid ──────
  // Scoped to the FILTERED selection only — do not extrapolate
  // Extend fittedCurve over the FULL measurement range (not just the
  // selected semicircle region), so the user can see how the model
  // extrapolates into the Warburg tail and judge separator quality.
  // Generate fittedCurve over FULL measurement range (not just selected region)
  // so the user can see how the model extrapolates and judge separator placement.
  const allFreq = (fullData ?? fit).map(d => d.frequency).filter(f => f > 0);
  const fMin = Math.max(Math.min(...allFreq), 1e-12);
  const fMax = Math.max(...allFreq);
  const DENSE = 250;
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  const fittedCurve: { zReal: number; zImag: number; frequency: number }[] = [];
  for (let k = 0; k < DENSE; k++) {
    const f = Math.pow(10, logMax - (k * (logMax - logMin)) / (DENSE - 1));
    const z = def.Z(params, TWO_PI * f);
    fittedCurve.push({ zReal: z.re, zImag: z.im, frequency: f });
  }

  const warnings: string[] = [];
  if (!converged) warnings.push("LM did not converge — using initial estimates");
  if (chiSquared > 1e-2)
    warnings.push(`High weighted SSR/dof (${chiSquared.toExponential(2)}) — model may not describe the data`);
  for (const name of def.paramNames) {
    const e = errors[name];
    if (Number.isFinite(e) && e > 50)
      warnings.push(`${name} poorly determined (±${e.toFixed(0)}%)`);
  }

  // ── Guardrail: parameter hit a bound (within 1%) ───────────
  for (let i = 0; i < P; i++) {
    const lo = def.bounds.lower[i];
    const hi = def.bounds.upper[i];
    const v  = params[i];
    const span = Math.max(Math.abs(hi - lo), 1e-9);
    const dLo = Math.abs(v - lo) / span;
    const dHi = Math.abs(hi - v) / span;
    if (dLo < 0.01) warnings.push(`${def.paramNames[i]} hit lower bound — fit unreliable`);
    else if (dHi < 0.01) warnings.push(`${def.paramNames[i]} hit upper bound — fit unreliable`);
  }

  // ── Guardrail: peak of −Im(Z) must be interior to selection ─
  let peakIdx = 0;
  let peakVal = -Infinity;
  for (let i = 0; i < N; i++) {
    const v = -fit[i].zImag;
    if (v > peakVal) { peakVal = v; peakIdx = i; }
  }
  if (N >= 3 && (peakIdx === 0 || peakIdx === N - 1)) {
    warnings.push("Semicircle peak not interior to selection — move separator RIGHT to include more of the arc");
  }

  // ── Guardrail: geometric consistency checks ────────────────
  // (a) Rs should match Z'(f_max) within ~20%
  const hiF = fit[0]; // sorted high→low
  if (hiF && paramsOut.Rs > 0) {
    const rel = Math.abs(paramsOut.Rs - hiF.zReal) / Math.max(paramsOut.Rs, 1e-9);
    if (rel > 0.2)
      warnings.push(`Rs (${paramsOut.Rs.toFixed(2)}Ω) inconsistent with Z'(f_max)=${hiF.zReal.toFixed(2)}Ω`);
  }
  // (b) model peak frequency vs. observed peak frequency (≤1 decade)
  const fPeakObs = fit[peakIdx]?.frequency;
  let fPeakModel = NaN;
  if (model === "randles") {
    const Rct = paramsOut.Rct, Cdl = paramsOut.Cdl;
    if (Rct > 0 && Cdl > 0) fPeakModel = 1 / (TWO_PI * Rct * Cdl);
  } else {
    const Rct = paramsOut.Rct, Q = paramsOut.Q, n = paramsOut.n;
    if (Rct > 0 && Q > 0 && n > 0)
      fPeakModel = Math.pow(Q * Rct, -1 / n) / TWO_PI;
  }
  if (Number.isFinite(fPeakModel) && fPeakObs && fPeakObs > 0) {
    const decades = Math.abs(Math.log10(fPeakModel / fPeakObs));
    if (decades > 1)
      warnings.push(`Model peak (${fPeakModel.toExponential(2)}Hz) ≠ data peak (${fPeakObs.toExponential(2)}Hz) — geometry mismatch`);
  }

  return {
    model,
    params:      paramsOut,
    errors,
    units:       def.units,
    chiSquared,
    fittedCurve,
    nPoints:     N,
    nFreeParams: P,
    converged,
    warnings:    warnings.length ? warnings : undefined,
  };
}

// ─── Gauss–Jordan matrix inverse ─────────────────────────────
function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    if (Math.abs(a[pivot][i]) < 1e-20) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const div = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= div;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = a[k][i];
      for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return a.map(row => row.slice(n));
}

// ─── Pretty-print helpers for the UI ─────────────────────────

/** Format a value with SI prefix for capacitance-like (F) quantities, etc. */
export function formatParamValue(name: string, value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  if (unit === "F") {
    if (value >= 1e-3) return `${(value * 1e3).toFixed(3)} mF`;
    if (value >= 1e-6) return `${(value * 1e6).toFixed(3)} µF`;
    if (value >= 1e-9) return `${(value * 1e9).toFixed(3)} nF`;
    return `${(value * 1e12).toFixed(3)} pF`;
  }
  if (unit === "S·sⁿ") {
    // CPE pre-factor — keep scientific for clarity
    return `${value.toExponential(3)} S·sⁿ`;
  }
  if (unit === "Ω") {
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(3)} MΩ`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(3)} kΩ`;
    return `${value.toFixed(2)} Ω`;
  }
  if (unit === "") {
    return value.toFixed(3);
  }
  return `${value.toPrecision(4)} ${unit}`;
}
