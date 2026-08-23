/**
 * Owns all SWV mode state that must survive mode switches.
 *
 * Same pattern as CV/EIS: the simulation hook and the mode's persistent
 * state live in the always-mounted parent (IndexPage) and are handed down
 * to the (conditionally mounted) view component. Nothing here changes any
 * SWV math — it only relocates ownership of the state.
 */
import { useRef, useState } from "react";
import {
  useSimulatedSWVData,
  type UseSimulatedSWVDataReturn,
} from "@/hooks/useSimulatedSWVData";
import { createMeasurementId, type MeasurementNotes } from "@/utils/measurementNotes";
import type { CalibrationPoint } from "@/components/CalibrationPanel";

export interface SWVModeState {
  sim: UseSimulatedSWVDataReturn;
  notes: MeasurementNotes;
  setNotes: React.Dispatch<React.SetStateAction<MeasurementNotes>>;
  measurementId: string;
  setMeasurementId: React.Dispatch<React.SetStateAction<string>>;
  measurementTimestamp: number;
  setMeasurementTimestamp: React.Dispatch<React.SetStateAction<number>>;
  calibration: CalibrationPoint[];
  setCalibration: React.Dispatch<React.SetStateAction<CalibrationPoint[]>>;
  showFR: boolean;
  setShowFR: React.Dispatch<React.SetStateAction<boolean>>;
  showBaseline: boolean;
  setShowBaseline: React.Dispatch<React.SetStateAction<boolean>>;
  plotMode: "raw" | "corrected";
  setPlotMode: React.Dispatch<React.SetStateAction<"raw" | "corrected">>;
  overlayMode: boolean;
  setOverlayMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** Measurement ids already auto-captured as overlays (demo only). */
  autoCapturedRef: React.MutableRefObject<Set<string>>;
  /** Tracks running→stopped transitions across remounts. */
  wasRunningRef: React.MutableRefObject<boolean>;
}

export function useSWVModeState(): SWVModeState {
  const sim = useSimulatedSWVData();
  const [notes, setNotes] = useState<MeasurementNotes>({});
  const [measurementId, setMeasurementId] = useState<string>(() =>
    createMeasurementId("swv"),
  );
  const [measurementTimestamp, setMeasurementTimestamp] = useState<number>(() => Date.now());
  const [calibration, setCalibration] = useState<CalibrationPoint[]>([]);
  const [showFR, setShowFR] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [plotMode, setPlotMode] = useState<"raw" | "corrected">("raw");
  const [overlayMode, setOverlayMode] = useState(false);
  const autoCapturedRef = useRef<Set<string>>(new Set());
  const wasRunningRef = useRef(false);

  return {
    sim,
    notes,
    setNotes,
    measurementId,
    setMeasurementId,
    measurementTimestamp,
    setMeasurementTimestamp,
    calibration,
    setCalibration,
    showFR,
    setShowFR,
    showBaseline,
    setShowBaseline,
    plotMode,
    setPlotMode,
    overlayMode,
    setOverlayMode,
    autoCapturedRef,
    wasRunningRef,
  };
}
