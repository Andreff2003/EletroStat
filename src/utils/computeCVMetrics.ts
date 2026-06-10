import type { CVDataPoint } from "@/hooks/useSimulatedCVData";

export type CVReversibility = "reversible" | "quasi-reversible" | "irreversible";
export type BaselineMethod = "per-branch-linear" | "global-linear" | "none";

export interface CVMetrics {
  // Raw (uncorrected) peak currents in µA
  IpaRaw: number;
  IpcRaw: number;
  // Baseline-corrected peak currents in µA
  IpaCorrected: number;
  IpcCorrected: number;
  // Backward-compat aliases — equal to the corrected values
  Ipa: number;
  Ipc: number;
  // Peak potentials in V
  Epa: number;
  Epc: number;
  E0prime: number;
  // Spread
  deltaEp: number;          // mV
  IpaIpcRatio: number;      // |Ipa/Ipc|
  // Derived parameters — NaN when not physically valid
  n_electrons: number;      // from 59.16 / ΔEp, only valid for reversible @25°C
  n_est_valid: boolean;
  D_apparent: number;       // cm²/s
  D_valid: boolean;
  reversibility: CVReversibility;
  baselineMethod: BaselineMethod;
  hasAnodic: boolean;
  hasCathodic: boolean;
  warnings: string[];
}

export interface CVMetricsInput {
  scanRate_mVs: number;
  n: number;
  cMM: number;
  areaCm2: number;
}

// Randles-Ševčík prefactor at 25 °C (0.4463 · F · sqrt(F/RT)) ≈ 268648.45
const F = 96485.33212;
const R = 8.314462618;
const TEMP_K = 298.15;
export const RS_PREFACTOR = 0.4463 * F * Math.sqrt(F / (R * TEMP_K));

/** Locate switching index by following the actual sign of dE/dt. */
function findSwitchIdx(sample: CVDataPoint[]): { switchIdx: number; goesPositive: boolean } {
  let dE0 = 0;
  for (let i = 1; i < sample.length; i++) {
    const d = sample[i].E - sample[0].E;
    if (Math.abs(d) > 1e-6) { dE0 = d; break; }
  }
  const goesPositive = dE0 > 0;
  let switchIdx = 0;
  if (goesPositive) {
    let m = sample[0].E;
    for (let i = 1; i < sample.length; i++) {
      if (sample[i].E > m) { m = sample[i].E; switchIdx = i; }
    }
  } else {
    let m = sample[0].E;
    for (let i = 1; i < sample.length; i++) {
      if (sample[i].E < m) { m = sample[i].E; switchIdx = i; }
    }
  }
  return { switchIdx, goesPositive };
}

/** Linear baseline fit through the first ~15 % of a branch. */
function fitBranchBaseline(branch: CVDataPoint[]): ((E: number) => number) | null {
  if (branch.length < 4) return null;
  const nFit = Math.max(3, Math.floor(branch.length * 0.15));
  const seg = branch.slice(0, nFit);
  const sx = seg.reduce((a, p) => a + p.E, 0);
  const sy = seg.reduce((a, p) => a + p.I, 0);
  const sxx = seg.reduce((a, p) => a + p.E * p.E, 0);
  const sxy = seg.reduce((a, p) => a + p.E * p.I, 0);
  const m = seg.length;
  const denom = m * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) {
    const mean = sy / m;
    return () => mean;
  }
  const slope = (m * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / m;
  return (E: number) => intercept + slope * E;
}

/** 3-point boxcar smoothing — used only to locate the index of the peak. */
function smooth(branch: CVDataPoint[]): number[] {
  const out = branch.map((p) => p.I);
  for (let i = 1; i < branch.length - 1; i++) {
    out[i] = (branch[i - 1].I + branch[i].I + branch[i + 1].I) / 3;
  }
  return out;
}

/**
 * Find an extremum on a branch (max for "anodic", min for "cathodic"),
 * ignoring the outer 5 % of points so we don't pick the ramp endpoints.
 */
function findPeak(
  branch: CVDataPoint[],
  baseline: ((E: number) => number) | null,
  kind: "anodic" | "cathodic",
): { Iraw: number; Icorr: number; E: number; idx: number } | null {
  if (branch.length < 5) return null;
  const sm = smooth(branch);
  const edge = Math.max(1, Math.floor(branch.length * 0.05));
  let bestIdx = -1;
  let bestVal = kind === "anodic" ? -Infinity : Infinity;
  for (let i = edge; i < branch.length - edge; i++) {
    const corr = baseline ? sm[i] - baseline(branch[i].E) : sm[i];
    if (kind === "anodic" ? corr > bestVal : corr < bestVal) {
      bestVal = corr;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const Iraw = branch[bestIdx].I;
  const Icorr = baseline ? Iraw - baseline(branch[bestIdx].E) : Iraw;
  return { Iraw, Icorr, E: branch[bestIdx].E, idx: bestIdx };
}

export function computeCVMetrics(
  data: CVDataPoint[],
  input: CVMetricsInput,
): CVMetrics | null {
  if (data.length < 10) return null;

  // Operate on the first cycle when available.
  const cyc1 = data.filter((d) => d.cycle === 1);
  const sample = cyc1.length >= 10 ? cyc1 : data;
  if (sample.length < 10) return null;

  const warnings: string[] = [];

  const { switchIdx, goesPositive } = findSwitchIdx(sample);
  const fwd = sample.slice(0, switchIdx + 1);
  const rev = sample.slice(switchIdx);

  // Per-branch baseline.
  const fwdBase = fitBranchBaseline(fwd);
  const revBase = fitBranchBaseline(rev);
  let baselineMethod: BaselineMethod = "per-branch-linear";
  if (!fwdBase || !revBase) {
    baselineMethod = fwdBase || revBase ? "global-linear" : "none";
    if (baselineMethod === "none") warnings.push("baseline fit failed; using raw currents");
  }

  // If the scan goes positive first, the anodic peak lives on the forward
  // branch and the cathodic peak on the reverse branch (and vice versa).
  const anodicBranch = goesPositive ? fwd : rev;
  const anodicBase = goesPositive ? fwdBase : revBase;
  const cathodicBranch = goesPositive ? rev : fwd;
  const cathodicBase = goesPositive ? revBase : fwdBase;

  const anodic = findPeak(anodicBranch, anodicBase ?? null, "anodic");
  const cathodic = findPeak(cathodicBranch, cathodicBase ?? null, "cathodic");

  // SNR-style validity threshold — ignore peaks under 50 nA of baseline-
  // corrected current to avoid promoting noise to a "peak".
  const SNR_MIN_uA = 0.05;
  const hasAnodic = anodic != null && anodic.Icorr > SNR_MIN_uA;
  const hasCathodic = cathodic != null && cathodic.Icorr < -SNR_MIN_uA;

  if (!hasAnodic) warnings.push("no clear anodic peak detected");
  if (!hasCathodic) warnings.push("no clear cathodic peak detected");

  const IpaRaw = anodic ? anodic.Iraw : NaN;
  const IpcRaw = cathodic ? cathodic.Iraw : NaN;
  const IpaCorrected = anodic ? anodic.Icorr : NaN;
  const IpcCorrected = cathodic ? cathodic.Icorr : NaN;
  const Epa = anodic ? anodic.E : NaN;
  const Epc = cathodic ? cathodic.E : NaN;
  const deltaEp = hasAnodic && hasCathodic ? Math.abs(Epa - Epc) * 1000 : NaN;
  const E0prime = hasAnodic && hasCathodic ? (Epa + Epc) / 2 : NaN;
  const IpaIpcRatio =
    hasAnodic && hasCathodic ? Math.abs(IpaCorrected / IpcCorrected) : NaN;

  // Randles-Ševčík — only when current/area/conc/scan are physical and the
  // system is at least quasi-reversible.
  const cBulk = input.cMM * 1e-6;
  const vVs = input.scanRate_mVs / 1000;
  let D_apparent = NaN;
  let D_valid = false;
  if (
    hasAnodic &&
    IpaCorrected > 0 &&
    input.n > 0 &&
    input.areaCm2 > 0 &&
    cBulk > 0 &&
    vVs > 0
  ) {
    const ipaA = IpaCorrected * 1e-6;
    const denom =
      RS_PREFACTOR *
      Math.pow(input.n, 1.5) *
      input.areaCm2 *
      cBulk *
      Math.sqrt(vVs);
    if (denom > 0) {
      D_apparent = Math.pow(ipaA / denom, 2);
      D_valid = true;
    }
  }

  // Reversibility — compare to expected ΔEp for n electrons at 25 °C.
  const expectedDeltaEp = 59.16 / Math.max(1, input.n);
  let reversibility: CVReversibility;
  if (!hasAnodic || !hasCathodic) {
    reversibility = "irreversible";
  } else if (
    Math.abs(deltaEp - expectedDeltaEp) <= 20 &&
    IpaIpcRatio >= 0.9 &&
    IpaIpcRatio <= 1.1
  ) {
    reversibility = "reversible";
  } else if (deltaEp <= expectedDeltaEp + 150 && IpaIpcRatio >= 0.7 && IpaIpcRatio <= 1.5) {
    reversibility = "quasi-reversible";
  } else {
    reversibility = "irreversible";
  }

  if (D_valid && reversibility === "irreversible") {
    D_valid = false;
    D_apparent = NaN;
    warnings.push("D apparent suppressed — system is irreversible");
  }

  // n estimate — only meaningful for clean reversible diffusion-controlled
  // systems near 25 °C.
  let n_electrons = NaN;
  let n_est_valid = false;
  if (
    hasAnodic &&
    hasCathodic &&
    deltaEp > 0 &&
    reversibility === "reversible" &&
    IpaIpcRatio >= 0.9 &&
    IpaIpcRatio <= 1.1
  ) {
    n_electrons = 59.16 / deltaEp;
    n_est_valid = true;
  }

  return {
    IpaRaw,
    IpcRaw,
    IpaCorrected,
    IpcCorrected,
    Ipa: IpaCorrected,
    Ipc: IpcCorrected,
    Epa,
    Epc,
    E0prime,
    deltaEp,
    IpaIpcRatio,
    n_electrons,
    n_est_valid,
    D_apparent,
    D_valid,
    reversibility,
    baselineMethod,
    hasAnodic,
    hasCathodic,
    warnings,
  };
}
