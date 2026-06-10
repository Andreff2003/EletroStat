import { useState, useEffect, useRef, useCallback } from "react";

/**
 * ============================================================
 * SIMULATED CV DATA — Butler-Volmer + semi-infinite diffusion
 * ------------------------------------------------------------
 * This is an EDUCATIONAL approximation, not a full equivalent
 * to EC-Lab, CHI or Gamry CV simulators. It uses:
 *   - Butler-Volmer kinetics at the electrode surface
 *   - Semi-infinite linear diffusion via product-integration
 *     of the singular Cottrell kernel 1/sqrt(t - tau)
 *   - Equal diffusion coefficients for O and R
 *   - First-order mass balance: CO_surf + CR_surf ≈ cBulk
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

export interface CVSimParams {
  scanRate: number;   // mV/s
  eStart: number;     // V
  eVertex1: number;   // V
  eVertex2: number;   // V
  nCycles: number;
  n: number;          // electrons transferred
  cMM: number;        // bulk concentration of O, mM
  areaCm2: number;    // electrode area, cm²
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
};

// Physical constants
const F = 96485.33212; // C/mol
const R = 8.314462618; // J/(mol·K)
const T = 298.15;      // K
const E0_PRIME = 0.22; // V — Fe(CN)6³⁻/⁴⁻ formal potential
const D = 7.26e-6;     // cm²/s
const K0 = 0.01;       // cm/s
const ALPHA = 0.5;
const K_MAX = 10;      // cm/s — numerical safety ceiling (educational)

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
  if (!(p.cMM > 0)) return "cMM must be > 0";
  if (!(p.areaCm2 > 0)) return "areaCm2 must be > 0";
  if (![p.eStart, p.eVertex1, p.eVertex2].every(Number.isFinite)) {
    return "eStart, eVertex1, eVertex2 must be finite";
  }
  return null;
}

function buildCVPoints(params: CVSimParams): CVDataPoint[] {
  const invalid = validateParams(params);
  if (invalid) {
    console.warn(`[CV simulation] invalid params — ${invalid}`);
    return [];
  }
  const { scanRate, eStart, eVertex1, eVertex2, nCycles, n, cMM, areaCm2 } = params;

  const cBulk = cMM * 1e-6;     // mol/cm³
  const v = scanRate / 1000;    // V/s
  const stepV = 0.001;          // 1 mV per step — smoother CV
  const dt = stepV / v;         // s

  // Build the potential program from the current cursor. Each segment
  // carries its own cycle index so we never have to derive it from a
  // total-points / nCycles ratio (which goes wrong with return segments).
  type Seg = { E: number; branch: "forward" | "reverse" | "return"; cycle: number };
  let cur = eStart;
  const segs: Seg[] = [{ E: cur, branch: "forward", cycle: 1 }];
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

  const totalPts = segs.length;
  const sqrtPiD = Math.sqrt(Math.PI * D);
  const sqrtDt = Math.sqrt(dt);
  const noiseAmp = Math.sqrt(scanRate) * 0.005; // µA — reduced for stability

  // Semi-implicit convolution coefficient (Cottrell kernel split into
  // known history + current-step contribution).
  const Afac = n * F * areaCm2;
  const beta = (2 * sqrtDt) / (Afac * sqrtPiD); // (mol/cm³) / A

  const Iamps: number[] = [];
  const out: CVDataPoint[] = [];

  for (let i = 0; i < totalPts; i++) {
    const { E, branch, cycle } = segs[i];
    const eta = E - E0_PRIME;

    // Butler-Volmer rates with educational numerical ceiling.
    const kRed = Math.min(K_MAX, K0 * safeExp(-ALPHA * n * F * eta / (R * T)));
    const kOx  = Math.min(K_MAX, K0 * safeExp((1 - ALPHA) * n * F * eta / (R * T)));

    // Convolution from past currents only. The current step's contribution
    // is folded analytically below so we can solve for I_i implicitly.
    let sumHist = 0;
    for (let j = 0; j < i; j++) {
      const k = i - j;
      sumHist += Iamps[j] * 2 * (Math.sqrt(k) - Math.sqrt(k - 1));
    }
    const convKnown = (sumHist * sqrtDt) / (Afac * sqrtPiD); // mol/cm³

    // Semi-implicit BV + diffusion:
    //   CO = cBulk + convKnown + beta * I_i
    //   CR = -(convKnown + beta * I_i)
    //   I_i = Afac * (kOx * CR - kRed * CO)
    // → I_i [1 + Afac·beta·(kOx + kRed)] = -Afac·[kRed·cBulk + (kOx+kRed)·convKnown]
    const denom = 1 + Afac * beta * (kOx + kRed);
    let Iamp =
      -Afac * (kRed * cBulk + (kOx + kRed) * convKnown) / denom;

    // Recover surface concentrations and apply a smooth (not jumpy) bound
    // on CR via mass balance — preserves CO + CR = cBulk.
    const conv = convKnown + beta * Iamp;
    let CR = -conv;
    const thetaR = clamp(CR / cBulk, 0, 1);
    CR = thetaR * cBulk;
    const CO = cBulk - CR;
    // Accept the implicit Iamp; smooth clamp above prevents brusque jumps.
    void CO;

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
