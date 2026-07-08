/**
 * ============================================================
 * REVERSIBLE CV — SEMI-INFINITE DIFFUSION + NERNST BOUNDARY
 * ------------------------------------------------------------
 * Solves
 *     ∂C_O/∂t = D ∂²C_O/∂x²
 *     ∂C_R/∂t = D ∂²C_R/∂x²
 * for a one-dimensional semi-infinite domain x ∈ [0, L], with
 * Dirichlet boundary conditions:
 *
 *  - At x = L (bulk): C_O = C*, C_R = 0
 *  - At x = 0 (electrode): the Nernst equilibrium
 *      C_O(0,t)/C_R(0,t) = exp(nF(E - E0')/(RT))
 *    is imposed with local mass conservation
 *      C_O(0) + C_R(0) ≈ clamp(C_O(1) + C_R(1), 0, C*)
 *
 * Time integration is backward Euler with a Thomas tridiagonal
 * solve, applied independently to O and R. Faradaic current is
 * computed from the diffusive flux of O at the surface:
 *     J_O = -D · (C_O[1] - C_O[0]) / dx
 *     I   =  n · F · A · J_O          (anodic +, cathodic −)
 *
 * Educational scope: D_O = D_R; single redox couple; no
 * coupled homogeneous chemistry; no double-layer capacitance.
 * This is NOT a full Nicholson–Shain finite-difference package
 * but a physically grounded reversible reference solver that
 * replaces the previous parametric Gaussian model.
 * ============================================================
 */
import {
  CV_F,
  CV_R,
  CV_T_DEFAULT_K,
  CV_DEFAULT_D_CM2_S,
  CV_E0_PRIME_DEFAULT_V,
  CV_SOLVER_DEFAULT_STEP_V,
  CV_SOLVER_DEFAULT_SPATIAL_NODES,
} from "./cvConstants";
import type { CVDataPoint } from "@/hooks/useSimulatedCVData";

export interface ReversibleDiffusionCVParams {
  eStart: number;
  eVertex1: number;
  eVertex2: number;
  scanRate_mVs: number;
  nCycles: number;
  n: number;
  areaCm2: number;
  cMM: number;
  D_cm2_s?: number;
  E0Prime_V?: number;
  temperature_K?: number;
  stepV?: number;
  spatialNodes?: number;
}

const safeExp = (x: number) => Math.exp(Math.max(-60, Math.min(60, x)));
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

/**
 * Thomas algorithm for a tridiagonal system A·x = d with
 * sub-diagonal a (a[0] unused), diagonal b, super-diagonal c
 * (c[n-1] unused). O(N), no matrix inversion.
 */
export function solveTridiagonal(
  a: number[],
  b: number[],
  c: number[],
  d: number[],
): number[] {
  const n = d.length;
  const cp = new Array<number>(n);
  const dp = new Array<number>(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array<number>(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

interface Seg {
  E: number;
  branch: "forward" | "reverse" | "return";
  cycle: number;
}

function buildProgram(
  eStart: number,
  eVertex1: number,
  eVertex2: number,
  nCycles: number,
  stepV: number,
): Seg[] {
  const segs: Seg[] = [{ E: eStart, branch: "forward", cycle: 1 }];
  const addRamp = (
    from: number,
    to: number,
    branch: Seg["branch"],
    cycle: number,
  ) => {
    const steps = Math.max(1, Math.round(Math.abs(to - from) / stepV));
    for (let i = 1; i <= steps; i++) {
      segs.push({ E: from + (to - from) * (i / steps), branch, cycle });
    }
  };
  let cur = eStart;
  for (let c = 1; c <= nCycles; c++) {
    addRamp(cur, eVertex1, "forward", c);
    cur = eVertex1;
    addRamp(cur, eVertex2, "reverse", c);
    cur = eVertex2;
    if (c < nCycles && Math.abs(cur - eStart) > 1e-9) {
      addRamp(cur, eStart, "return", c);
      cur = eStart;
    }
  }
  return segs;
}

export function simulateReversibleDiffusionCV(
  params: ReversibleDiffusionCVParams,
): CVDataPoint[] {
  const {
    eStart,
    eVertex1,
    eVertex2,
    scanRate_mVs,
    nCycles,
    n,
    areaCm2,
    cMM,
    D_cm2_s = CV_DEFAULT_D_CM2_S,
    E0Prime_V = CV_E0_PRIME_DEFAULT_V,
    temperature_K = CV_T_DEFAULT_K,
    stepV = CV_SOLVER_DEFAULT_STEP_V,
    spatialNodes = CV_SOLVER_DEFAULT_SPATIAL_NODES,
  } = params;

  // Strict validation — return [] on any invalid input rather than crashing.
  if (
    !(scanRate_mVs > 0) ||
    !(stepV > 0) ||
    !(nCycles >= 1) ||
    !(n > 0) ||
    !(areaCm2 > 0) ||
    !(D_cm2_s > 0) ||
    !(temperature_K > 0) ||
    ![eStart, eVertex1, eVertex2].every(Number.isFinite)
  ) {
    return [];
  }

  const v = scanRate_mVs / 1000; // V/s
  const dt = stepV / v;
  const segs = buildProgram(eStart, eVertex1, eVertex2, nCycles, stepV);
  const tMax = Math.max((segs.length - 1) * dt, dt);
  const cBulk = cMM * 1e-6; // mol/cm³

  // Blank: faradaic current is identically zero. Still emit a well-formed trace.
  if (cBulk <= 0) {
    return segs.map((s, i) => ({
      E: s.E,
      I: 0,
      cycle: s.cycle,
      t: i * dt,
      branch: s.branch,
    }));
  }

  // Spatial mesh — semi-infinite approximation L ≈ 6·√(D·tMax).
  const N = Math.max(20, Math.floor(spatialNodes));
  const L = 6 * Math.sqrt(D_cm2_s * tMax);
  const dx = L / (N - 1);
  const lambda = (D_cm2_s * dt) / (dx * dx);

  const CO = new Array<number>(N).fill(cBulk);
  const CR = new Array<number>(N).fill(0);

  // Pre-build the tridiagonal coefficient arrays for the interior unknowns
  // (indices 1..N-2). They are identical for O and R and never mutate.
  const M = N - 2;
  const a = new Array<number>(M).fill(-lambda);
  const b = new Array<number>(M).fill(1 + 2 * lambda);
  const c = new Array<number>(M).fill(-lambda);
  a[0] = 0;
  c[M - 1] = 0;

  const F = CV_F;
  const R = CV_R;
  const T = temperature_K;

  const out: CVDataPoint[] = [];

  for (let k = 0; k < segs.length; k++) {
    const { E, branch, cycle } = segs[k];
    const theta = safeExp((n * F * (E - E0Prime_V)) / (R * T));

    // Surface BC — local mass conservation with neighbour node.
    const surfTot0 = clamp(CO[1] + CR[1], 0, cBulk);
    const CsurfTotal = k === 0 ? cBulk : surfTot0;
    CO[0] = (CsurfTotal * theta) / (1 + theta);
    CR[0] = CsurfTotal / (1 + theta);

    // Solve interior — backward Euler, Dirichlet BCs at nodes 0 and N-1.
    if (M >= 1) {
      const dO = new Array<number>(M);
      const dR = new Array<number>(M);
      for (let i = 0; i < M; i++) {
        const idx = i + 1;
        dO[i] = CO[idx];
        dR[i] = CR[idx];
        if (i === 0) {
          dO[i] += lambda * CO[0];
          dR[i] += lambda * CR[0];
        }
        if (i === M - 1) {
          dO[i] += lambda * cBulk;
          dR[i] += lambda * 0;
        }
      }
      const xO = solveTridiagonal(a, b, c, dO);
      const xR = solveTridiagonal(a, b, c, dR);
      for (let i = 0; i < M; i++) {
        CO[i + 1] = Math.max(0, xO[i]);
        CR[i + 1] = Math.max(0, xR[i]);
      }
    }
    CO[N - 1] = cBulk;
    CR[N - 1] = 0;

    // Re-enforce Nernst at the surface after the interior update so the
    // flux evaluation uses a thermodynamically consistent surface pair.
    const surfTot1 = clamp(CO[1] + CR[1], 0, cBulk);
    CO[0] = (surfTot1 * theta) / (1 + theta);
    CR[0] = surfTot1 / (1 + theta);

    // Faradaic current from the diffusive flux of O at the electrode.
    // Sign convention: reduction (CO consumed) → CO[0] < CO[1] → J_O<0 → I<0.
    const J_O = -D_cm2_s * (CO[1] - CO[0]) / dx;
    const I_A = n * F * areaCm2 * J_O;
    const I_uA = I_A * 1e6;

    out.push({ E, I: I_uA, cycle, t: k * dt, branch });
  }

  return out;
}