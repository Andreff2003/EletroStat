import type { EISDataPoint } from "@/hooks/useSimulatedData";

/**
 * ============================================================
 *  HelpStat — Lin-KK inspired consistency check
 * ============================================================
 *
 *  Linear KK consistency check inspired by the Schönleber /
 *  Boukamp formulation. Fits the measured spectrum to a sum
 *  of M parallel RC elements with τ_k distributed
 *  logarithmically across the measurement frequency window:
 *
 *     Z(ω) = R∞ + Σ_k R_k / (1 + jωτ_k)
 *
 *  Solved as a SINGLE weighted linear least squares problem
 *  (real + imag stacked, rows scaled by 1/|Z_i| so the
 *  residual reported below matches the modulus-normalized
 *  residual). This circuit is Kramers-Kronig compliant by
 *  construction, so the residual measures consistency of the
 *  data with linear, causal, stable EIS behavior within the
 *  measured frequency range.
 *
 *  IMPORTANT: This is an "inspired" implementation, not a full
 *  Lin-KK algorithm with M-selection (Schönleber 2014). Passing
 *  supports data consistency but does NOT prove that any
 *  particular equivalent circuit (e.g. Randles) is the correct
 *  physical model. Negative R_k weights or an excessive number
 *  of RC elements relative to the data may indicate overfitting.
 * ============================================================
 */

export interface LinKKResult {
  method: "lin-kk-inspired";
  /** true when residualRmsPct <= 5% */
  passed: boolean;
  /** RMS of normalized residuals (% of |Z|). */
  residualRmsPct: number;
  /** Worst-point residual magnitude (% of |Z|). */
  maxResidualPct: number;
  /** Number of RC time constants used. */
  tauCount: number;
  /** Count of negative R_k weights (possible overfitting indicator). */
  negativeRkCount: number;
  /** Percent of negative R_k weights vs tauCount. */
  negativeRkPct: number;
  fittedCurve: {
    frequency: number;
    zReal: number;
    zImag: number;
    residualRealPct: number;
    residualImagPct: number;
  }[];
  warnings: string[];
}

const TWO_PI = 2 * Math.PI;

/** Gauss-Jordan inverse; null when singular, ill-conditioned flag separately. */
function invertMatrix(m: number[][]): { inv: number[][] | null; illConditioned: boolean } {
  const n = m.length;
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, Math.abs(m[i][i]));
  const relTol = Math.max(1e-14, 1e-12 * maxDiag);
  let illConditioned = false;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++)
      if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    const piv = Math.abs(a[pivot][i]);
    if (piv < 1e-30) return { inv: null, illConditioned: true };
    if (piv < relTol) illConditioned = true;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const div = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= div;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = a[k][i];
      for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return { inv: a.map((row) => row.slice(n)), illConditioned };
}

export function linKKTest(data: EISDataPoint[]): LinKKResult {
  const warnings: string[] = [];

  const empty = (extra?: string): LinKKResult => ({
    method: "lin-kk-inspired",
    passed: false,
    residualRmsPct: 100,
    maxResidualPct: 100,
    tauCount: 0,
    negativeRkCount: 0,
    negativeRkPct: 0,
    fittedCurve: [],
    warnings: extra ? [extra] : ["Not enough data for Lin-KK inspired check."],
  });

  if (!data || data.length < 6) {
    return empty("Not enough points for Lin-KK inspired check (need ≥ 6).");
  }

  const sorted = data
    .slice()
    .filter((d) => d.frequency > 0)
    .sort((a, b) => a.frequency - b.frequency);
  const N = sorted.length;
  if (N < 6) return empty("Not enough valid frequency points for Lin-KK inspired check.");

  const omegas = sorted.map((d) => TWO_PI * d.frequency);
  const wMin = omegas[0];
  const wMax = omegas[N - 1];

  // Modulus per point (used for row weighting and residual normalization).
  const mods = sorted.map((d) =>
    Math.max(Math.sqrt(d.zReal * d.zReal + d.zImag * d.zImag), 1e-9),
  );

  // Tau grid: spans the full ω range, log-spaced. M ≤ N/4 caps overfit risk.
  const M = Math.max(8, Math.min(20, Math.floor(N / 4)));
  const tauMin = 1 / wMax;
  const tauMax = 1 / wMin;
  const logTauMin = Math.log10(tauMin);
  const logTauMax = Math.log10(tauMax);
  const taus = Array.from(
    { length: M },
    (_, k) => Math.pow(10, logTauMin + ((logTauMax - logTauMin) * k) / (M - 1)),
  );

  // Unknowns: [R∞, R_1, ..., R_M] — size P = M + 1
  const P = M + 1;

  // Build A (2N × P) and y (2N), each row weighted by 1/|Z_i| so the least
  // squares minimizes Σ ((Z' − Ẑ')/|Z|)² + ((Z'' − Ẑ'')/|Z|)² — the same
  // normalization used to report residualRmsPct below.
  const A: number[][] = Array.from({ length: 2 * N }, () => new Array(P).fill(0));
  const y: number[] = new Array(2 * N);
  for (let i = 0; i < N; i++) {
    const w = omegas[i];
    const s = 1 / mods[i];
    // Real row
    A[i][0] = 1 * s;
    for (let m = 0; m < M; m++) {
      const wt = w * taus[m];
      A[i][m + 1] = (1 / (1 + wt * wt)) * s;
    }
    y[i] = sorted[i].zReal * s;
    // Imag row
    A[i + N][0] = 0;
    for (let m = 0; m < M; m++) {
      const wt = w * taus[m];
      A[i + N][m + 1] = (-wt / (1 + wt * wt)) * s;
    }
    y[i + N] = sorted[i].zImag * s;
  }

  // Normal equations: (AᵀA + λI) x = Aᵀ y
  const lambda = 1e-8;
  const AtA: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  const Aty: number[] = new Array(P).fill(0);
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      let s = 0;
      for (let i = 0; i < 2 * N; i++) s += A[i][a] * A[i][b];
      AtA[a][b] = s;
    }
    AtA[a][a] += lambda;
    let s = 0;
    for (let i = 0; i < 2 * N; i++) s += A[i][a] * y[i];
    Aty[a] = s;
  }
  const { inv, illConditioned } = invertMatrix(AtA);
  if (!inv) return empty("Lin-KK inspired normal equations singular — insufficient data.");
  if (illConditioned)
    warnings.push("Lin-KK inspired system ill-conditioned — residuals may be unreliable.");

  const x: number[] = new Array(P).fill(0);
  for (let a = 0; a < P; a++) {
    let s = 0;
    for (let b = 0; b < P; b++) s += inv[a][b] * Aty[b];
    x[a] = s;
  }

  // Count negative R_k weights (excluding R∞ at index 0).
  let negativeRk = 0;
  for (let k = 1; k < P; k++) if (x[k] < 0) negativeRk++;
  const negativeRkPct = M > 0 ? (negativeRk / M) * 100 : 0;

  // Residuals (recompute in unweighted space for transparency).
  let sumSq = 0;
  let maxRel = 0;
  const fittedCurve: LinKKResult["fittedCurve"] = [];
  for (let i = 0; i < N; i++) {
    let zR = 0;
    let zI = 0;
    // Reconstruct from solved coefficients in unweighted form.
    zR += x[0];
    const w = omegas[i];
    for (let m = 0; m < M; m++) {
      const wt = w * taus[m];
      zR += x[m + 1] / (1 + wt * wt);
      zI += -x[m + 1] * wt / (1 + wt * wt);
    }
    const magZ = mods[i];
    const rR = (sorted[i].zReal - zR) / magZ;
    const rI = (sorted[i].zImag - zI) / magZ;
    sumSq += rR * rR + rI * rI;
    const m = Math.sqrt(rR * rR + rI * rI);
    if (m > maxRel) maxRel = m;
    fittedCurve.push({
      frequency: sorted[i].frequency,
      zReal: zR,
      zImag: zI,
      residualRealPct: 100 * rR,
      residualImagPct: 100 * rI,
    });
  }
  const residualRmsPct = 100 * Math.sqrt(sumSq / N);
  const maxResidualPct = 100 * maxRel;

  const passed = residualRmsPct <= 5;
  if (residualRmsPct > 10) {
    warnings.push(
      `Lin-KK inspired RMS residual ${residualRmsPct.toFixed(1)}% > 10% — data may be non-stationary, non-linear, or contain drift / artefacts.`,
    );
  } else if (residualRmsPct > 5) {
    warnings.push(
      `Lin-KK inspired RMS residual ${residualRmsPct.toFixed(1)}% in 5–10% range — borderline consistency; inspect for drift or noise.`,
    );
  }
  if (negativeRkPct > 30) {
    warnings.push(
      `${negativeRk}/${M} negative R_k weights (${negativeRkPct.toFixed(0)}%) — likely overfitting; treat residuals with caution.`,
    );
  }
  if (M > N / 3) {
    warnings.push(
      `tauCount=${M} is high relative to N=${N} points — overfitting possible.`,
    );
  }

  return {
    method: "lin-kk-inspired",
    passed,
    residualRmsPct,
    maxResidualPct,
    tauCount: M,
    negativeRkCount: negativeRk,
    negativeRkPct,
    fittedCurve,
    warnings,
  };
}
