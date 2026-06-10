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

export const CV_E0_PRIME = E0_PRIME;

const safeExp = (x: number) => Math.exp(Math.max(-700, Math.min(700, x)));

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
  const stepV = 0.005;          // 5 mV per step
  const dt = stepV / v;         // s

  // Build the potential program. For nCycles > 1 we close the cycle by
  // returning to eStart before starting the next one — comparable to a
  // standard closed CV.
  type Seg = { E: number; branch: "forward" | "reverse" | "return" };
  const segs: Seg[] = [{ E: eStart, branch: "forward" }];
  const addRamp = (from: number, to: number, branch: Seg["branch"]) => {
    const steps = Math.max(1, Math.round(Math.abs(to - from) / stepV));
    for (let i = 1; i <= steps; i++) {
      segs.push({ E: from + (to - from) * (i / steps), branch });
    }
  };
  for (let c = 0; c < nCycles; c++) {
    addRamp(eStart, eVertex1, "forward");
    addRamp(eVertex1, eVertex2, "reverse");
    if (c < nCycles - 1 && Math.abs(eVertex2 - eStart) > 1e-9) {
      addRamp(eVertex2, eStart, "return");
    }
  }

  const totalPts = segs.length;
  const pointsPerCycle = Math.max(1, Math.floor(totalPts / Math.max(1, nCycles)));
  const sqrtPiD = Math.sqrt(Math.PI * D);
  const sqrtDt = Math.sqrt(dt);
  const noiseAmp = Math.sqrt(scanRate) * 0.02; // µA

  const Iamps: number[] = [];
  const out: CVDataPoint[] = [];

  for (let i = 0; i < totalPts; i++) {
    const { E, branch } = segs[i];
    const eta = E - E0_PRIME;

    // Butler-Volmer: kRed reduces O→R, kOx oxidises R→O.
    const kRed = K0 * safeExp(-ALPHA * n * F * eta / (R * T));
    const kOx  = K0 * safeExp((1 - ALPHA) * n * F * eta / (R * T));

    // Product-integration of the Cottrell kernel 1/sqrt(t - tau).
    // For a uniform grid t_i = i*dt this gives weights
    //   w_k = 2 * (sqrt(k) - sqrt(k-1))      with k = i - j   (k = 1..i)
    // and the convolution ∫I(τ)/√(t-τ)dτ ≈ √dt · Σ_j I_j · w_{i-j}.
    let sumHist = 0;
    for (let j = 0; j < i; j++) {
      const k = i - j;
      sumHist += Iamps[j] * 2 * (Math.sqrt(k) - Math.sqrt(k - 1));
    }
    const conv = (sumHist * sqrtDt) / (n * F * areaCm2 * sqrtPiD); // mol/cm³

    // Mass balance: positive (anodic) I produces O at the surface, consumes R.
    let CO = cBulk + conv;
    let CR = -conv;
    // Soft clipping that preserves total — physically required for K0/D in
    // strongly-driven regimes. Note this is an approximation.
    if (CO < 0) { CR += CO; CO = 0; }
    if (CR < 0) { CO += CR; CR = 0; }
    if (CO < 0) CO = 0;
    if (CR < 0) CR = 0;

    const Iamp = n * F * areaCm2 * (kOx * CR - kRed * CO); // A
    Iamps.push(Iamp);

    const cycleIdx = Math.min(
      Math.max(1, nCycles),
      Math.floor(i / pointsPerCycle) + 1,
    );

    out.push({
      E,
      I: Iamp * 1e6 + gaussianNoise(noiseAmp),
      cycle: cycleIdx,
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
