/**
 * BioFET physical helpers — softplus-smoothed MOSFET model.
 *
 *     u  = (Vg − Vt) / (2 n VT)
 *     s  = 2 n VT · softplus(u)        (softplus(u) = ln(1 + exp(u)))
 *     Id = K · s²
 *
 * Properties:
 *   • Smooth in Vt (C^∞ — no piecewise corner).
 *   • For u → +∞ reduces to Id = K (Vg − Vt)²  (square-law saturation).
 *   • For u → −∞ reduces to Id = K · (2 n VT)² · exp((Vg − Vt) / (n VT))
 *     i.e. exponential sub-threshold with ideality factor n.
 *
 * Educational — not a TCAD-grade compact model.
 */

export const KT_Q_300K = 0.02585; // V (thermal voltage)

export interface FETParams {
  /** Trans-conductance pre-factor K (µA / V²). */
  K: number;
  /** Sub-threshold ideality factor (≈ 1.2 – 2.5). */
  n: number;
  /** Thermal voltage (V). Defaults to 300 K. */
  vt_thermal?: number;
}

/** Numerically-stable softplus: ln(1 + exp(x)). */
function softplus(x: number): number {
  if (x > 30) return x;
  if (x < -30) return Math.exp(x);
  return Math.log1p(Math.exp(x));
}

export function fetDrainCurrent(vg: number, vt: number, params: FETParams): number {
  const VT = params.vt_thermal ?? KT_Q_300K;
  const denom = 2 * params.n * VT;
  const u = (vg - vt) / denom;
  const s = denom * softplus(u);
  return params.K * s * s;
}

/** Gaussian noise via Box–Muller. */
export function gaussian(mean: number, std: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + std * r;
}

/**
 * Adds proportional + absolute noise and clamps the result to a strictly
 * positive floor so simulated currents never become negative (which would
 * blow up log/sqrt-based downstream metrics).
 */
export function addCurrentNoise(id: number, relNoise = 0.02, absNoise = 0.005): number {
  const sigma = absNoise + relNoise * Math.abs(id);
  const noisy = id + gaussian(0, sigma);
  return Math.max(noisy, 1e-6);
}
