/**
 * SWV simulation hook.
 *
 * MODEL — empirical/educational, not a rigorous SWV solver.
 * ---------------------------------------------------------
 * The differential current is generated as a Gaussian peak at Epeak whose
 * amplitude follows a Langmuir isotherm in concentration, modulated by
 * empirical gains that capture the first-order dependences observed in
 * real reversible SWV responses:
 *
 *   Ipeak = Imax · C/(C+Kd) · G_f · G_A · G_amp
 *   G_f   = clamp((f / fRef)^0.4, 0.3, 3)          (Ip ≈ ∝ √f softened)
 *   G_A   = clamp(A / A_ref, 0.1, 20)              (Randles–Ševčík: Ip ∝ A)
 *   G_amp = (Esw/(Esw+E0)) / (Eref/(Eref+E0))       (saturating in amplitude)
 *
 *   I_net(E) = Ipeak · exp(-0.5 · ((E - Epeak) / σ)²) + baseline(E) + η(I)
 *   baseline(E) = a + b·E + c·E²                   (mild curvature)
 *   η(I)        = N(0, σ0 + k·√|I|)                (shot/ADC-like scaling)
 *
 * Forward / reverse currents are split so their difference reproduces the
 * differential peak, plus a common capacitive background and independent
 * pulse noise on each half-cycle:
 *
 *   I_forward = C_bg + 0.5 · I_net + η_f
 *   I_reverse = C_bg - 0.5 · I_net + η_r
 *
 * Export/metadata always advertises `simulation_model = empirical_swv_peak_langmuir`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateSWVProgram,
  validateSWVParameters,
} from "@/utils/swvMetrics";
import type { SWVDataPoint, SWVParameters } from "@/types/swv";

const IMAX_UA = 1.6;   // saturation peak current
const KD_NM = 30;      // apparent Langmuir Kd for cortisol demo
const EPEAK_V = 0.22;  // default cortisol redox-label peak position
const FREQ_REF_HZ = 25;       // reference frequency for the gain normalisation
const AREA_REF_CM2 = 0.07;    // reference electrode area (typical SPE)
const AMP_REF_MV = 25;        // reference SWV amplitude
const AMP_HALFSAT_MV = 20;    // Esw where the amplitude gain reaches 0.5

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface UseSimulatedSWVDataReturn {
  data: SWVDataPoint[];
  isRunning: boolean;
  isComplete: boolean;
  start: (params: SWVParameters) => void;
  stop: () => void;
  reset: () => void;
}

function gaussianNoise(sigma: number): number {
  const u1 = Math.max(Number.EPSILON, Math.random());
  const u2 = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function useSimulatedSWVData(): UseSimulatedSWVDataReturn {
  const [data, setData] = useState<SWVDataPoint[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setData([]);
    setIsComplete(false);
  }, [stop]);

  const start = useCallback(
    (params: SWVParameters) => {
      const v = validateSWVParameters(params);
      if (!v.ok) return;
      reset();
      const program = generateSWVProgram(params);
      if (program.length === 0) return;
      const C = Math.max(0, params.concentration_nM ?? 0);
      // ── empirical scaling gains ────────────────────────────────────────
      const freqGain = clamp(
        Math.pow(Math.max(params.frequency_Hz, 1e-3) / FREQ_REF_HZ, 0.4),
        0.3,
        3,
      );
      const area = params.area_cm2 && params.area_cm2 > 0 ? params.area_cm2 : AREA_REF_CM2;
      const areaGain = clamp(area / AREA_REF_CM2, 0.1, 20);
      const ampSat = (esw: number) => esw / (esw + AMP_HALFSAT_MV);
      const ampGain = ampSat(Math.max(params.amplitude_mV, 1e-3)) / ampSat(AMP_REF_MV);
      const Ipeak = IMAX_UA * (C / (C + KD_NM)) * freqGain * areaGain * ampGain;
      // σ (V) related to half-peak width; rough dependence on amplitude.
      const sigma = Math.max(0.02, 0.03 + params.amplitude_mV / 4000);
      const Epeak = Number.isFinite(params.simulationEpeak_V as number)
        ? (params.simulationEpeak_V as number)
        : EPEAK_V;
      // Baseline: mild polynomial (a + b·E + c·E²). c kept small on purpose
      // so linear_edges baseline correction still recovers the peak well.
      const cBg = 0.05;      // µA — capacitive background (a)
      const bgSlope = 0.02;  // µA/V — linear tilt (b)
      const bgCurv = 0.015;  // µA/V² — small curvature (c)
      // Signal-dependent noise: σ(I) = σ0 + k·√|I|. Mimics shot/ADC noise
      // without going full flicker/50-Hz territory (out of scope).
      const noiseFloor = 0.008; // µA independent baseline noise
      const noiseGain = 0.006;  // µA per √µA of signal
      const noiseAt = (i: number) =>
        noiseFloor + noiseGain * Math.sqrt(Math.max(0, Math.abs(i)));
      let i = 0;
      setIsRunning(true);
      setIsComplete(false);
      const period_ms = Math.max(5, 1000 / params.frequency_Hz);
      timerRef.current = setInterval(() => {
        if (i >= program.length) {
          stop();
          setIsComplete(true);
          return;
        }
        const step = program[i];
        const baseline = cBg + bgSlope * step.E + bgCurv * step.E * step.E;
        const iNetClean =
          Ipeak * Math.exp(-0.5 * ((step.E - Epeak) / sigma) ** 2) + baseline;
        const netNoise = gaussianNoise(noiseAt(iNetClean));
        const iNet = iNetClean + netNoise;
        const commonCap = cBg + bgSlope * step.E * 0.5;
        const halfDiff = 0.5 * (iNet - baseline);
        const iForward = commonCap + halfDiff + gaussianNoise(noiseAt(commonCap + halfDiff));
        const iReverse = commonCap - halfDiff + gaussianNoise(noiseAt(commonCap - halfDiff));
        const pt: SWVDataPoint = {
          E: step.E,
          IForward: iForward,
          IReverse: iReverse,
          INet: iForward - iReverse,
          time: step.time,
          index: step.index,
          direction: step.direction,
        };
        setData((prev) => [...prev, pt]);
        i++;
      }, period_ms);
    },
    [reset, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { data, isRunning, isComplete, start, stop, reset };
}

export const SWV_SIMULATION_MODEL_ID = "empirical_swv_peak_langmuir";
