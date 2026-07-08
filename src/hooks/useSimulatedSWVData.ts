/**
 * SWV simulation hook.
 *
 * MODEL — empirical/educational, not a rigorous SWV solver.
 * ---------------------------------------------------------
 * The differential current is generated as a Gaussian peak at Epeak whose
 * amplitude follows a Langmuir isotherm in concentration:
 *
 *   I_net(E) = Ipeak · exp(-0.5 · ((E - Epeak) / σ)²) + baseline(E) + noise
 *   Ipeak    = Imax · C / (C + Kd)     (Langmuir)
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
      const Ipeak = IMAX_UA * (C / (C + KD_NM));
      // σ (V) related to half-peak width; rough dependence on amplitude.
      const sigma = Math.max(0.02, 0.03 + params.amplitude_mV / 4000);
      const cBg = 0.05; // capacitive background µA
      const bgSlope = 0.02; // µA/V mild baseline slope
      const noiseSigma = 0.01; // µA independent pulse noise
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
        const baseline = cBg + bgSlope * step.E;
        const iNetClean =
          Ipeak * Math.exp(-0.5 * ((step.E - EPEAK_V) / sigma) ** 2) + baseline;
        const netNoise = gaussianNoise(noiseSigma);
        const iNet = iNetClean + netNoise;
        const commonCap = cBg + bgSlope * step.E * 0.5;
        const iForward = commonCap + 0.5 * (iNet - baseline) + gaussianNoise(noiseSigma);
        const iReverse = commonCap - 0.5 * (iNet - baseline) + gaussianNoise(noiseSigma);
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
