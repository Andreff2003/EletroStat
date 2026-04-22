import { useState, useEffect, useRef, useCallback } from "react";

/**
 * ============================================================
 * SIMULATED DATA HOOKS FOR HELPSTAT BIOSENSOR
 * ============================================================
 * These hooks generate fake sensor data for testing.
 * 
 * WHEN YOU CONNECT REAL HARDWARE:
 * Replace the simulated data generation with real data
 * received via WebSocket from your ESP32-S3.
 * Look for comments marked with ">>> REAL HARDWARE >>>"
 * ============================================================
 */

// --- EIS Data Types ---
export interface EISDataPoint {
  /** Real impedance Z' in Ohms (X-axis of Nyquist plot) */
  zReal: number;
  /** Imaginary impedance -Z'' in Ohms (Y-axis of Nyquist plot) */
  zImag: number;
  /** Frequency in Hz (X-axis of Bode plot) */
  frequency: number;
  /** Impedance magnitude |Z| in Ohms */
  zMag: number;
  /** Phase angle in degrees */
  phase: number;
}

// --- BioFET Data Types ---
export interface FETTransferPoint {
  /** Gate voltage Vg in Volts (X-axis) */
  vg: number;
  /** Drain current Id in microamps (Y-axis) */
  id: number;
}

export interface FETTimePoint {
  /** Time in seconds (X-axis) */
  time: number;
  /** Drain current Id in microamps (Y-axis) */
  id: number;
}

/**
 * Generates simulated EIS data (Nyquist semicircle).
 * 
 * The model: Z = Rs + Rct / (1 + j*w*Rct*Cdl)
 * Rs = solution resistance, Rct = charge transfer resistance
 * Cdl = double-layer capacitance
 * 
 * >>> REAL HARDWARE >>>
 * Replace this with data from AD5941 EIS measurement.
 * The ESP32 should send {zReal, zImag, frequency} per point.
 */
export function useSimulatedEIS(speed: number = 200) {
  const [data, setData] = useState<EISDataPoint[]>([]);
  const indexRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  // EIS circuit parameters (Randles cell model)
  const Rs = 100;    // Solution resistance (Ohms)
  const Rct = 500;   // Charge transfer resistance (Ohms)
  const Cdl = 1e-6;  // Double-layer capacitance (Farads)

  // Pre-compute all points across frequency range
  const allPoints = useRef<EISDataPoint[]>([]);

  useEffect(() => {
    const points: EISDataPoint[] = [];
    // Sweep from 0.1 Hz to 100 kHz (logarithmic)
    for (let i = 0; i <= 60; i++) {
      const freq = Math.pow(10, -1 + (i / 60) * 6); // 0.1 Hz to 100 kHz
      const omega = 2 * Math.PI * freq;
      const denom = 1 + Math.pow(omega * Rct * Cdl, 2);
      
      const zReal = Rs + Rct / denom;
      const zImag = (omega * Rct * Rct * Cdl) / denom; // positive = -Z''
      const zMag = Math.sqrt(zReal * zReal + zImag * zImag);
      const phase = -Math.atan2(zImag, zReal) * (180 / Math.PI);

      points.push({
        zReal: Math.round(zReal * 10) / 10,
        zImag: Math.round(zImag * 10) / 10,
        frequency: Math.round(freq * 100) / 100,
        zMag: Math.round(zMag * 10) / 10,
        phase: Math.round(phase * 10) / 10,
      });
    }
    allPoints.current = points;
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

  const start = useCallback(() => {
    setData([]);
    indexRef.current = 0;
    setIsRunning(true);
  }, []);

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
 * Generates simulated BioFET transfer curve (Id vs Vg).
 * 
 * Model: MOSFET-like transfer characteristic
 * Id = k * (Vg - Vth)^2 for Vg > Vth
 * 
 * Shows two curves: baseline and with cortisol (shifted Vth).
 * 
 * >>> REAL HARDWARE >>>
 * Replace with actual drain current readings from ESP32.
 * Sweep Vg on the device, send {vg, id} per point.
 */
export function useSimulatedFETTransfer(speed: number = 100) {
  const [baseline, setBaseline] = useState<FETTransferPoint[]>([]);
  const [withAnalyte, setWithAnalyte] = useState<FETTransferPoint[]>([]);
  const indexRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  const allBaseline = useRef<FETTransferPoint[]>([]);
  const allAnalyte = useRef<FETTransferPoint[]>([]);

  useEffect(() => {
    const base: FETTransferPoint[] = [];
    const analyte: FETTransferPoint[] = [];
    const k = 50; // Transconductance parameter (µA/V²)
    const VthBase = 0.3; // Threshold voltage (baseline)
    const VthShift = 0.15; // Vth shift due to cortisol binding

    for (let i = 0; i <= 50; i++) {
      const vg = -0.5 + (i / 50) * 2.0; // -0.5V to 1.5V
      
      const idBase = vg > VthBase ? k * Math.pow(vg - VthBase, 2) : 0.01;
      const idAnalyte = vg > (VthBase + VthShift) 
        ? k * Math.pow(vg - VthBase - VthShift, 2) 
        : 0.01;

      base.push({ vg: Math.round(vg * 100) / 100, id: Math.round(idBase * 100) / 100 });
      analyte.push({ vg: Math.round(vg * 100) / 100, id: Math.round(idAnalyte * 100) / 100 });
    }
    allBaseline.current = base;
    allAnalyte.current = analyte;
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

  const start = useCallback(() => {
    setBaseline([]);
    setWithAnalyte([]);
    indexRef.current = 0;
    setIsRunning(true);
  }, []);

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
 * Generates simulated BioFET time-response data (Id vs time).
 * 
 * Shows how drain current changes when cortisol is introduced.
 * The signal drops/shifts when analyte binds to the aptamer/MIP.
 * 
 * >>> REAL HARDWARE >>>
 * Replace with continuous Id readings from ESP32 at fixed Vg.
 * The ESP32 should send {time, id} periodically.
 */
export function useSimulatedFETTime(speed: number = 200) {
  const [data, setData] = useState<FETTimePoint[]>([]);
  const timeRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;

    const baselineCurrent = 25; // µA baseline
    const signalDrop = 8; // µA drop when cortisol binds
    const injectionTime = 10; // seconds — when analyte is added
    const bindingRate = 0.5; // how fast binding occurs

    const interval = setInterval(() => {
      const t = timeRef.current * (speed / 1000);
      
      let id: number;
      if (t < injectionTime) {
        // Before injection: stable baseline with small noise
        id = baselineCurrent + (Math.random() - 0.5) * 0.5;
      } else {
        // After injection: exponential decay (binding kinetics)
        const elapsed = t - injectionTime;
        const shift = signalDrop * (1 - Math.exp(-bindingRate * elapsed));
        id = baselineCurrent - shift + (Math.random() - 0.5) * 0.3;
      }

      setData(prev => [...prev, {
        time: Math.round(t * 10) / 10,
        id: Math.round(id * 100) / 100,
      }]);
      timeRef.current++;

      // Stop after 40 seconds of data
      if (t > 40) {
        setIsRunning(false);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [isRunning, speed]);

  const start = useCallback(() => {
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
