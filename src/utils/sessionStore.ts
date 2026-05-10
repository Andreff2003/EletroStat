import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";

export interface StoredEISMeasurement {
  id: string;
  mode: "eis";
  timestamp: number;
  concentration: number;
  notes?: string;
  params: {
    freqMin: number;
    freqMax: number;
    points: number;
    amplitude: number;
  };
  data: EISDataPoint[];
  extracted: {
    Rs?: number;
    Rct?: number;
    Cdl?: number;
    Aw?: number;
    warburgSlope?: number;
    fitErrorPct?: number;
  };
}

export interface StoredFETMeasurement {
  id: string;
  mode: "fet";
  timestamp: number;
  concentration: number;
  notes?: string;
  params: {
    vgMin: number;
    vgMax: number;
    vgStep: number;
    intervalMs: number;
  };
  baseline: FETTransferPoint[];
  analyte: FETTransferPoint[];
  timeData: FETTimePoint[];
  markers: { time: number; label: string }[];
  extracted: { Vt?: number };
}

export type StoredMeasurement = StoredEISMeasurement | StoredFETMeasurement;

const KEY = "helpstat-session-v1";

export function loadSession(): StoredMeasurement[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to load session", err);
    return [];
  }
}

export function saveSession(measurements: StoredMeasurement[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(measurements));
  } catch (err) {
    console.warn("Failed to save session", err);
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    console.warn("Failed to clear session", err);
  }
}

export function newId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}