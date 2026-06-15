import { useState, useEffect, useRef, useCallback } from "react";
import {
  CV_F as F,
  CV_R as R,
  CV_T_DEFAULT_K as T,
  CV_DEFAULT_D_CM2_S as D,
  CV_E0_PRIME_DEFAULT_V as E0_PRIME,
} from "@/utils/cvConstants";

/**
 * ============================================================
 * SIMULATED CV DATA — two educational models
 * ------------------------------------------------------------
 * Two CV models are exposed:
 *
 *  A) "reversible" — analytical / parametric reversible model.
 *     Produces two smooth Gaussian-like peaks placed at
 *       Epc = E0' - 59.16 mV / (2n)
 *       Epa = E0' + 59.16 mV / (2n)
 *     with peak current from Randles–Ševčík:
 *       ip = 0.4463 · n · F · A · C · sqrt(n·F·D·v / (R·T))
 *     plus a small capacitive baseline (Cdl · v).  This is the
 *     DEFAULT model and is meant to behave well: ΔEp ≈ 59/n mV,
 *     |Ipa/Ipc| ≈ 1, ip ∝ C·sqrt(v).  It is NOT a Nicholson–Shain
 *     digital simulation — it is an educational parametric shape.
 *
 *  B) "quasi-reversible" — Butler–Volmer kinetics + semi-infinite
 *     diffusion (product-integration of the Cottrell kernel),
 *     solved semi-implicitly per step.  Equal D for O and R,
 *     first-order mass balance CO_surf + CR_surf ≈ cBulk.
 *     Educational approximation only; D_apparent from
 *     Randles–Ševčík may be biased for this regime.
 *
 *  C) Reserved for future "live" / real-hardware data path.
 *
 * Sign convention (kept consistent across the whole project):
 *   anodic current  → positive (oxidation, R → O)
 *   cathodic current → negative (reduction, O → R)
 *   potentials in V vs reference, currents reported in µA
 * ============================================================
 */

export interface CVDataPoint {
  E: number;                                  // V vs reference
  I: number;                                  // µA (signed: anodic +, cathodic -)
  cycle: number;                              // 1-based
  t: number;                                  // s
  branch?: "forward" | "reverse" | "return"; // sweep segment
  baseline?: number;                          // µA — modelled baseline at this E (optional)
  Icorr?: number;                             // µA — baseline-corrected current (optional)
}

export type CVModel = "reversible" | "quasi-reversible";

export interface CVSimParams {
  scanRate: number;   // mV/s
  eStart: number;     // V
  eVertex1: number;   // V
  eVertex2: number;   // V
  nCycles: number;
  n: number;          // electrons transferred
  cMM: number;        // bulk concentration of O, mM
  areaCm2: number;    // electrode area, cm²
  cvModel?: CVModel;  // default: "reversible"
}

export const DEFAULT_CV_PARAMS: CVSimParams = {
  scanRate: 100,
  eStart: 0.6,
  eVertex1: -0.2,
  eVertex2: 0.6,
  nCycles: 1,
  n: 1,
  cMM: 5,
  areaCm2: 0.0707,
  cvModel: "reversible",
};

// Physical constants
const K0 = 0.01;       // cm/s
const ALPHA = 0.5;
const K_MAX = 10;      // cm/s — numerical safety ceiling (educational)
const CDL_PER_AREA = 20e-6; // F/cm² — typical aqueous double-layer capacitance

export const CV_E0_PRIME = E0_PRIME;

const safeExp = (x: number) => Math.exp(Math.max(-60, Math.min(60, x)));

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

function gaussianNoise(amp: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return amp * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function validateParams(p: CVSimParams): string | null {
  if (!(p.scanRate > 0)) return "scanRate must be > 0";
  if (!(p.nCycles >= 1)) return "nCycles must be >= 1";
  if (!(p.n > 0)) return "n must be > 0";
  if (!(p.cMM >= 0)) return "cMM must be >= 0";
  if (!(p.areaCm2 > 0)) return "areaCm2 must be > 0";
  if (![p.eStart, p.eVertex1, p.eVertex2].every(Number.isFinite)) {
    return "eStart, eVertex1, eVertex2 must be finite";
  }
  return null;
}

type Seg = { E: number; branch: "forward" | "reverse" | "return"; cycle: number; dir: 1 | -1 };

function buildPotentialProgram(params: CVSimParams): { segs: Seg[]; dt: number; stepV: number } {
  const v = params.scanRate / 1000; // V/s
  const stepV = 0.001;              // 1 mV per step
  const dt = stepV / v;

  let cur = params.eStart;
  const segs: Seg[] = [{ E: cur, branch: "forward", cycle: 1, dir: 1 }];
  const addRamp = (
    from: number,
    to: number,
    branch: Seg["branch"],
    cycle: number,
  ) => {
    const steps = Math.max(1, Math.round(Math.abs(to - from) / stepV));
    const dir: 1 | -1 = to >= from ? 1 : -1;
    for (let i = 1; i <= steps; i++) {
      segs.push({ E: from + (to - from) * (i / steps), branch, cycle, dir });
    }
  };
  for (let c = 1; c <= params.nCycles; c++) {
    addRamp(cur, params.eVertex1, "forward", c);
    cur = params.eVertex1;
    addRamp(cur, params.eVertex2, "reverse", c);
    cur = params.eVertex2;
    if (c < params.nCycles && Math.abs(cur - params.eStart) > 1e-9) {
      addRamp(cur, params.eStart, "return", c);
      cur = params.eStart;
    }
  }
  // first point has no defined direction yet; copy from next
  if (segs.length >= 2) segs[0].dir = segs[1].dir;
  return { segs, dt, stepV };
}

/**
 * Reversible parametric model — two Gaussian peaks (cathodic on the
 * decreasing-E branch, anodic on the increasing-E branch) plus a tiny
 * capacitive baseline. Designed to satisfy ΔEp≈59/n mV and |Ipa/Ipc|≈1.
 */
function buildReversibleCV(params: CVSimParams): CVDataPoint[] {
  const { segs, dt } = buildPotentialProgram(params);
  const { n, cMM, areaCm2, scanRate } = params;

  const cBulk = cMM * 1e-6; // mol/cm³
  const vVs = scanRate / 1000;

  // Randles–Ševčík peak current (A)
  const ipA =
    0.4463 *
    n *
    F *
    areaCm2 *
    cBulk *
    Math.sqrt((n * F * D * vVs) / (R * T));
  const ipUA = ipA * 1e6;

  const Epc = E0_PRIME - 0.05916 / (2 * n);
  const Epa = E0_PRIME + 0.05916 / (2 * n);
  const sigmaE = Math.max(0.035 / Math.sqrt(n), 0.015);
  const peakRatio = 1.0;

  // Capacitive baseline — Cdl·v. Tiny for typical defaults.
  const Cdl = CDL_PER_AREA * areaCm2;          // F
  const Icap_uA = Cdl * vVs * 1e6;             // µA per direction unit

  const noiseAmp = Math.sqrt(scanRate) * 0.005;

  const out: CVDataPoint[] = [];
  for (let i = 0; i < segs.length; i++) {
    const { E, branch, cycle, dir } = segs[i];
    // Cathodic peak on decreasing-E branch (dir=-1), anodic on increasing.
    const cath = -ipUA * Math.exp(-0.5 * ((E - Epc) / sigmaE) ** 2);
    const an   = peakRatio * ipUA * Math.exp(-0.5 * ((E - Epa) / sigmaE) ** 2);
    const faradaic = dir < 0 ? cath : an;
    const capacitive = dir * Icap_uA;
    const I = faradaic + capacitive + gaussianNoise(noiseAmp);
    out.push({ E, I, cycle, t: i * dt, branch });
  }
  return out;
}

/**
 * Quasi-reversible model — Butler–Volmer + semi-infinite diffusion
 * solved semi-implicitly. Educational approximation; D_apparent from
 * Randles–Ševčík may be biased when ΔEp > the reversible value.
 */
function buildQuasiReversibleCV(params: CVSimParams): CVDataPoint[] {
  const { segs, dt } = buildPotentialProgram(params);
  const { n, cMM, areaCm2, scanRate } = params;

  const cBulk = cMM * 1e-6;
  const sqrtPiD = Math.sqrt(Math.PI * D);
  const sqrtDt = Math.sqrt(dt);
  const noiseAmp = Math.sqrt(scanRate) * 0.005;

  const Afac = n * F * areaCm2;
  const beta = (2 * sqrtDt) / (Afac * sqrtPiD);

  const Iamps: number[] = [];
  const out: CVDataPoint[] = [];

  for (let i = 0; i < segs.length; i++) {
    const { E, branch, cycle } = segs[i];
    const eta = E - E0_PRIME;
    const kRed = Math.min(K_MAX, K0 * safeExp(-ALPHA * n * F * eta / (R * T)));
    const kOx  = Math.min(K_MAX, K0 * safeExp((1 - ALPHA) * n * F * eta / (R * T)));

    let sumHist = 0;
    for (let j = 0; j < i; j++) {
      const k = i - j;
      sumHist += Iamps[j] * 2 * (Math.sqrt(k) - Math.sqrt(k - 1));
    }
    const convKnown = (sumHist * sqrtDt) / (Afac * sqrtPiD);

    let Iamp = 0;
    if (cBulk > 0) {
      const denom = 1 + Afac * beta * (kOx + kRed);
      Iamp = -Afac * (kRed * cBulk + (kOx + kRed) * convKnown) / denom;

      // Mass-balance safety net: clamp surface CR to [0, cBulk]. If we hit a
      // boundary, fall back to a non-implicit step bounded by the clamped CR
      // so the reported current is physically consistent with the surface
      // concentrations. Educational approximation only — not a full
      // finite-difference Nicholson–Shain solver.
      const CR_raw = -(convKnown + beta * Iamp);
      const thetaR = clamp(CR_raw / cBulk, 0, 1);
      const CR = thetaR * cBulk;
      const CO = cBulk - CR;
      if (thetaR <= 0 || thetaR >= 1) {
        Iamp = Afac * (kOx * CR - kRed * CO);
      }
    }
    // For blank (cBulk = 0) faradaic current is identically zero.
    Iamps.push(Iamp);
    out.push({
      E,
      I: Iamp * 1e6 + gaussianNoise(noiseAmp),
      cycle,
      t: i * dt,
      branch,
    });
  }
  return out;
}

function buildCVPoints(params: CVSimParams): CVDataPoint[] {
  const invalid = validateParams(params);
  if (invalid) {
    console.warn(`[CV simulation] invalid params — ${invalid}`);
    return [];
  }
  const model = params.cvModel ?? "reversible";
  return model === "quasi-reversible"
    ? buildQuasiReversibleCV(params)
    : buildReversibleCV(params);
}

/** Exported for tests — pure, deterministic apart from gaussianNoise. */
export function buildCVPointsForTest(params: CVSimParams): CVDataPoint[] {
  return buildCVPoints(params);
}

/**
 * Parse a CV WebSocket frame into a CVDataPoint. Pure helper exposed for
 * unit testing — guarantees no NaN / Infinity leaks into the dataset.
 */
export function parseCVWebSocketMessage(msg: unknown): CVDataPoint | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "cv_data") return null;
  if (m.E == null || m.I == null) return null;
  const E = Number(m.E);
  const I = Number(m.I);
  if (!Number.isFinite(E) || !Number.isFinite(I)) return null;
  const cycleRaw = m.cycle != null ? Number(m.cycle) : 1;
  const cycle =
    Number.isFinite(cycleRaw) && cycleRaw >= 1 ? Math.floor(cycleRaw) : 1;
  const tRaw =
    m.t != null ? Number(m.t) : m.timestamp != null ? Number(m.timestamp) : 0;
  const t = Number.isFinite(tRaw) ? tRaw : 0;
  const branch =
    m.branch === "forward" || m.branch === "reverse" || m.branch === "return"
      ? (m.branch as "forward" | "reverse" | "return")
      : undefined;
  return { E, I, cycle, t, branch };
}

export function useSimulatedCVData(speed: number = 40) {
  const [data, setData] = useState<CVDataPoint[]>([]);
  const allRef = useRef<CVDataPoint[]>([]);
  const idxRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (idxRef.current >= allRef.current.length) {
        setIsRunning(false);
        return;
      }
      const batch = Math.max(1, Math.floor(allRef.current.length / 200));
      setData((prev) => {
        const next = prev.slice();
        for (let k = 0; k < batch && idxRef.current < allRef.current.length; k++) {
          next.push(allRef.current[idxRef.current]);
          idxRef.current++;
        }
        return next;
      });
    }, speed);
    return () => clearInterval(interval);
  }, [isRunning, speed]);

  const start = useCallback((params: CVSimParams) => {
    const points = buildCVPoints(params);
    if (points.length === 0) {
      console.warn("[CV simulation] aborted: invalid parameters");
      return;
    }
    allRef.current = points;
    idxRef.current = 0;
    setData([]);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => setIsRunning(false), []);
  const reset = useCallback(() => {
    setIsRunning(false);
    setData([]);
    idxRef.current = 0;
    allRef.current = [];
  }, []);

  return { data, isRunning, start, stop, reset };
}
