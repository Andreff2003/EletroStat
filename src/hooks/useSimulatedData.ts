import { useState, useEffect, useRef, useCallback } from "react";

/**
 * ============================================================
 * SIMULATED DATA HOOKS FOR HELPSTAT BIOSENSOR
 * ============================================================
 * Curves change with the user-supplied "concentration" (nM)
 * using a Langmuir binding model.
 * ============================================================
 */

export interface EISDataPoint {
  zReal: number;
  zImag: number;
  frequency: number;
  zMag: number;
  phase: number;
}

export interface FETTransferPoint {
  vg: number;
  id: number;
}

export interface FETTimePoint {
  time: number;
  id: number;
}

// Shared simulated binding parameters
const KD = 25;          // nM — simulated aptamer dissociation constant
const RCT_MIN = 300;    // Ω
const RCT_MAX = 800;    // Ω
const RS = 200;         // Ω — solution resistance (constant)
const CDL = 20e-6;      // F — double-layer capacitance (20 µF)
const AW_BASE = 80;     // Ω/√s — Warburg coefficient (concentration-independent)
const VT_BASELINE = 0.30;   // V
const VT_MAX_SHIFT = 0.40;  // V
const ID_MAX = 50;          // µA at top of analyte curve

function noise(amp: number) {
  return (Math.random() - 0.5) * amp;
}

/**
 * EIS — Nyquist semicircle whose diameter Rct grows with concentration.
 */
export function useSimulatedEIS(speed: number = 200) {
  const [data, setData] = useState<EISDataPoint[]>([]);
  const indexRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const allPoints = useRef<EISDataPoint[]>([]);

  const buildPoints = useCallback((concentration: number, totalPoints = 61) => {
    const deltaRct =
      concentration > 0
        ? (RCT_MAX - RCT_MIN) * concentration / (concentration + KD)
        : 0;
    const Rct = RCT_MIN + deltaRct;

    const freqMin = 0.1;
    const freqMax = 1e5;
    const logMin = Math.log10(freqMin);
    const logMax = Math.log10(freqMax);

    const points: EISDataPoint[] = [];
    for (let i = 0; i < totalPoints; i++) {
      const frequency = Math.pow(10, logMax - (i / (totalPoints - 1)) * (logMax - logMin));
      const omega = 2 * Math.PI * frequency;

      // Warburg impedance: Zw = Aw/√ω · (1 − j)
      const wMag = AW_BASE / Math.sqrt(omega);
      const zwRe = wMag;
      const zwIm = -wMag;

      // Faradaic branch: Zf = Rct + Zw
      const zfRe = Rct + zwRe;
      const zfIm = zwIm;

      // Admittance of faradaic branch: Yf = 1/Zf
      const zfMag2 = zfRe * zfRe + zfIm * zfIm;
      const yfRe = zfRe / zfMag2;
      const yfIm = -zfIm / zfMag2;

      // Parallel with Cdl: Ycdl = jωCdl
      const yTotRe = yfRe;
      const yTotIm = yfIm + omega * CDL;

      // Parallel impedance: Zp = 1/Ytot
      const yMag2 = yTotRe * yTotRe + yTotIm * yTotIm;
      const zpRe = yTotRe / yMag2;
      const zpIm = -yTotIm / yMag2;

      // Total impedance: Z = Rs + Zp
      const zReal = RS + zpRe + noise(2);
      const zImag = -zpIm + noise(2); // store as positive (negative imag flipped)
      const zMag = Math.sqrt(zReal * zReal + zImag * zImag);
      const phase = Math.atan2(-zImag, zReal) * (180 / Math.PI);
      points.push({
        zReal: Math.round(zReal * 10) / 10,
        zImag: Math.round(zImag * 10) / 10,
        frequency: Math.round(frequency * 100) / 100,
        zMag: Math.round(zMag * 10) / 10,
        phase: Math.round(phase * 10) / 10,
      });
    }
    return points;
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (indexRef.current >= allPoints.current.length) {
        setIsRunning(false);
        return;
      }
      setData(prev => [...prev, allPoints.current[indexRef.current]]);
      indexRef.current++;
    }, speed);
    return () => clearInterval(interval);
  }, [isRunning, speed]);

  const start = useCallback((concentration: number = 0, totalPoints?: number) => {
    allPoints.current = buildPoints(concentration, totalPoints);
    setData([]);
    indexRef.current = 0;
    setIsRunning(true);
  }, [buildPoints]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setData([]);
    indexRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  return { data, isRunning, start, reset, stop };
}

/**
 * BioFET — transfer curve. Analyte Vt shifts right with concentration.
 */
export function useSimulatedFETTransfer(speed: number = 100) {
  const [baseline, setBaseline] = useState<FETTransferPoint[]>([]);
  const [withAnalyte, setWithAnalyte] = useState<FETTransferPoint[]>([]);
  const indexRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  const allBaseline = useRef<FETTransferPoint[]>([]);
  const allAnalyte = useRef<FETTransferPoint[]>([]);

  const buildPoints = useCallback((concentration: number, vgMin = -0.5, vgMax = 1.5, totalPoints = 51) => {
    const deltaVt =
      concentration > 0
        ? VT_MAX_SHIFT * concentration / (concentration + KD)
        : 0;
    const VtBase = VT_BASELINE;
    const VtAnalyte = VT_BASELINE + deltaVt;

    const base: FETTransferPoint[] = [];
    const analyte: FETTransferPoint[] = [];

    for (let i = 0; i < totalPoints; i++) {
      const vg = vgMin + (i / (totalPoints - 1)) * (vgMax - vgMin);

      const normB = (vg - VtBase) / (vgMax - VtBase);
      const idB = ID_MAX * Math.max(0, normB) ** 2 + noise(0.2) + 0.05;

      const normA = (vg - VtAnalyte) / (vgMax - VtBase);
      const idA = ID_MAX * Math.max(0, normA) ** 2 + noise(0.2) + 0.05;

      base.push({ vg: Math.round(vg * 100) / 100, id: Math.round(idB * 100) / 100 });
      analyte.push({ vg: Math.round(vg * 100) / 100, id: Math.round(idA * 100) / 100 });
    }
    return { base, analyte };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      if (indexRef.current >= allBaseline.current.length) {
        setIsRunning(false);
        return;
      }
      const idx = indexRef.current;
      setBaseline(prev => [...prev, allBaseline.current[idx]]);
      setWithAnalyte(prev => [...prev, allAnalyte.current[idx]]);
      indexRef.current++;
    }, speed);
    return () => clearInterval(interval);
  }, [isRunning, speed]);

  const start = useCallback((concentration: number = 0, vgMin?: number, vgMax?: number, totalPoints?: number) => {
    const { base, analyte } = buildPoints(concentration, vgMin, vgMax, totalPoints);
    allBaseline.current = base;
    allAnalyte.current = analyte;
    setBaseline([]);
    setWithAnalyte([]);
    indexRef.current = 0;
    setIsRunning(true);
  }, [buildPoints]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setBaseline([]);
    setWithAnalyte([]);
    indexRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  return { baseline, withAnalyte, isRunning, start, reset, stop };
}

/**
 * BioFET time response — drop magnitude scales with concentration.
 */
export function useSimulatedFETTime(speed: number = 200) {
  const [data, setData] = useState<FETTimePoint[]>([]);
  const timeRef = useRef(0);
  const concRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;

    const baselineCurrent = 25;
    const maxDrop = 12;
    const concentration = concRef.current;
    const signalDrop =
      concentration > 0 ? maxDrop * concentration / (concentration + KD) : 0;
    const injectionTime = 10;
    const bindingRate = 0.5;

    const interval = setInterval(() => {
      const t = timeRef.current * (speed / 1000);
      let id: number;
      if (t < injectionTime) {
        id = baselineCurrent + noise(0.5);
      } else {
        const elapsed = t - injectionTime;
        const shift = signalDrop * (1 - Math.exp(-bindingRate * elapsed));
        id = baselineCurrent - shift + noise(0.3);
      }
      setData(prev => [...prev, {
        time: Math.round(t * 10) / 10,
        id: Math.round(id * 100) / 100,
      }]);
      timeRef.current++;
      if (t > 40) setIsRunning(false);
    }, speed);

    return () => clearInterval(interval);
  }, [isRunning, speed]);

  const start = useCallback((concentration: number = 0) => {
    concRef.current = concentration;
    setData([]);
    timeRef.current = 0;
    setIsRunning(true);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setData([]);
    timeRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  return { data, isRunning, start, reset, stop };
}
