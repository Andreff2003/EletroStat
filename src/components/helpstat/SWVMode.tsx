/**
 * Self-contained SWV Mode component.
 *
 * Owns:
 *  - parameter panel, validation and warnings
 *  - start / stop / reset / export controls (simulated + live)
 *  - SWV plot with raw/corrected/baseline/forward-reverse toggles
 *  - metrics cards
 *  - calibration table (replicates + blanks + LOD/LOQ)
 *  - SWV-only Signal Quality semaphore
 *  - measurement notes (via MeasurementNotesPanel with mode="swv")
 *
 * All exports go through the shared csvExport helpers so the session CSV
 * automatically picks up SWV measurements written to the session store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import SWVPlot from "@/components/SWVPlot";
import SignalQuality from "@/components/SignalQuality";
import MeasurementNotesPanel from "@/components/MeasurementNotesPanel";
import ParametersPanel, {
  DEFAULT_EIS_PARAMS,
  DEFAULT_FET_PARAMS,
} from "@/components/ParametersPanel";


import { useSimulatedSWVData, SWV_SIMULATION_MODEL_ID } from "@/hooks/useSimulatedSWVData";
import {
  analyzeSWV,
  validateSWVParameters,
} from "@/utils/swvMetrics";
import type {
  SWVCalibrationPoint,
  SWVDataPoint,
  SWVParameters,
} from "@/types/swv";

import {
  createMeasurementId,
  sanitizeMeasurementNotes,
  shortNotesSummary,
  type MeasurementNotes,
} from "@/utils/measurementNotes";
import {
  loadSession,
  saveSession,
  newId,
  type StoredSWVMeasurement,
} from "@/utils/sessionStore";
import { exportSWVData } from "@/utils/csvExport";

type LiveWs = {
  swvData?: SWVDataPoint[];
  swvStatus?: "idle" | "running" | "done" | "error";
  swvError?: string | null;
  clearSWV?: () => void;
  sendCommand?: (command: string, payload?: Record<string, unknown>) => void;
  status?: string;
};

export interface SWVController {
  start: () => void;
  stop: () => void;
  reset: () => void;
  exportCsv: () => void;
  addCalibration: () => void;
  isRunning: boolean;
  hasData: boolean;
}

interface Props {
  dataSource: "simulated" | "live";
  ws?: LiveWs;
  /** If provided, externally controls the SWV parameters (lifted state). */
  externalParams?: SWVParameters;
  onChangeParams?: (p: SWVParameters) => void;
  /** If provided, hides internal ParametersPanel and controls row and
   *  exposes start/stop/reset/export handlers to the parent. */
  onController?: (ctrl: SWVController) => void;
}

const DEFAULT_PARAMS: SWVParameters = {
  startE: -0.2,
  endE: 0.6,
  step_mV: 2,
  amplitude_mV: 25,
  frequency_Hz: 25,
  quietTime_s: 2,
  direction: "anodic",
  concentration_nM: 10,
  area_cm2: 0.0707,
  nElectrons: 1,
  temperature_K: 298.15,
  baselineMethod: "auto",
  smoothing: "none",
  model: "empirical_peak",
};



const OVERLAY_COLORS = [
  "hsl(160 70% 55%)",
  "hsl(30 90% 60%)",
  "hsl(200 80% 60%)",
  "hsl(280 70% 65%)",
  "hsl(50 90% 55%)",
  "hsl(340 80% 60%)",
  "hsl(120 60% 55%)",
  "hsl(0 75% 60%)",
];



export default function SWVMode({ dataSource, ws, externalParams, onChangeParams, onController }: Props) {
  const [internalParams, setInternalParams] = useState<SWVParameters>(DEFAULT_PARAMS);
  const params = externalParams ?? internalParams;
  const setParams = onChangeParams ?? setInternalParams;
  const isControlled = !!onController;
  const [notes, setNotes] = useState<MeasurementNotes>({});
  const [measurementId, setMeasurementId] = useState<string>(() => createMeasurementId("swv"));
  const [measurementTimestamp, setMeasurementTimestamp] = useState<number>(() => Date.now());
  const [calibration, setCalibration] = useState<SWVCalibrationPoint[]>([]);
  const [showFR, setShowFR] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [plotMode, setPlotMode] = useState<"raw" | "corrected">("raw");
  const [overlayMode, setOverlayMode] = useState(false);
  const [overlays, setOverlays] = useState<
    { id: string; label: string; color: string; data: SWVDataPoint[] }[]
  >([]);

  const sim = useSimulatedSWVData();
  const isLive = dataSource === "live";
  const liveData = ws?.swvData ?? [];
  const data: SWVDataPoint[] = isLive ? liveData : sim.data;
  const isRunning = isLive
    ? ws?.swvStatus === "running"
    : sim.isRunning;

  const validation = useMemo(() => validateSWVParameters(params), [params]);

  const { corrected, metrics } = useMemo(
    () => analyzeSWV(data, params.baselineMethod ?? "auto"),
    [data, params.baselineMethod],
  );



  const startMeasurement = useCallback(() => {
    if (!validation.ok) {
      toast.error(validation.errors[0] ?? "Invalid parameters");
      return;
    }
    validation.warnings.forEach((w) => toast.warning(w));
    const mid = createMeasurementId("swv");
    setMeasurementId(mid);
    setMeasurementTimestamp(Date.now());
    if (isLive) {
      ws?.clearSWV?.();
      ws?.sendCommand?.("start_swv", {
        startE: params.startE,
        endE: params.endE,
        step_mV: params.step_mV,
        amplitude_mV: params.amplitude_mV,
        frequency_Hz: params.frequency_Hz,
        quietTime_s: params.quietTime_s,
        direction: params.direction,
        concentration: params.concentration_nM,
      });
    } else {
      sim.start(params);
    }
  }, [isLive, params, sim, validation, ws]);

  const stopMeasurement = useCallback(() => {
    if (isLive) ws?.sendCommand?.("stop");
    else sim.stop();
  }, [isLive, sim, ws]);

  const resetMeasurement = useCallback(() => {
    if (isLive) ws?.clearSWV?.();
    else sim.reset();
  }, [isLive, sim, ws]);

  const persistMeasurement = useCallback(
    (concentration?: number) => {
      if (data.length === 0) return null;
      const stored: StoredSWVMeasurement = {
        id: newId(),
        mode: "swv",
        timestamp: Date.now(),
        source: dataSource,
        concentration,
        measurementId,
        measurementTimestamp,
        notes: sanitizeMeasurementNotes(notes) ? notes : undefined,
        params,
        data,
        correctedData: corrected,
        extracted: metrics,
      };
      const session = loadSession();
      const idx = session.findIndex(
        (m) => m.mode === "swv" && (m as StoredSWVMeasurement).measurementId === measurementId,
      );
      if (idx >= 0) session[idx] = stored; else session.push(stored);
      saveSession(session);
      return stored;
    },
    [corrected, data, dataSource, measurementId, measurementTimestamp, metrics, notes, params],
  );

  const handleExport = useCallback(() => {
    if (data.length === 0) {
      toast.error("No SWV data to export.");
      return;
    }
    persistMeasurement(params.concentration_nM);
    exportSWVData({
      data,
      corrected,
      metrics,
      params,
      source: dataSource,
      measurementId,
      measurementTimestamp,
      notes: sanitizeMeasurementNotes(notes),
      calibration,
      simulationModel: dataSource === "simulated" ? SWV_SIMULATION_MODEL_ID : undefined,
    });
    toast.success("SWV CSV exported.");
  }, [calibration, corrected, data, dataSource, measurementId, measurementTimestamp, metrics, notes, params, persistMeasurement]);

  const addCalibrationPoint = useCallback(() => {
    if (!metrics?.peakDetected && !(metrics?.peakCurrentRaw_uA != null)) {
      toast.error("No peak — cannot add calibration point.");
      return;
    }
    const point: SWVCalibrationPoint = {
      concentration_nM: params.concentration_nM ?? 0,
      signal_uA:
        metrics?.peakCurrentCorrected_uA ?? metrics?.peakCurrentRaw_uA ?? 0,
      raw_uA: metrics?.peakCurrentRaw_uA ?? 0,
      peakPotential_V: metrics?.peakPotential_V ?? null,
      baselineMethod: params.baselineMethod ?? "auto",
      snr: metrics?.snr ?? null,
      timestamp: Date.now(),
      measurementId,
      sampleId: notes.sampleId,
      electrodeId: notes.electrodeId,
      notesShort: shortNotesSummary(notes) ?? undefined,
    };
    setCalibration((prev) => [...prev, point]);
    persistMeasurement(params.concentration_nM);
    toast.success(`Added SWV calibration point @ ${point.concentration_nM} nM.`);
  }, [metrics, notes, params, persistMeasurement, measurementId]);

  // Linear regression on calibration for LOD/LOQ.
  const calibFit = useMemo(() => {
    if (calibration.length < 3) return null;
    const positive = calibration.filter((p) => p.concentration_nM > 0);
    if (positive.length < 2) return null;
    const n = positive.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of positive) {
      sx += p.concentration_nM; sy += p.signal_uA;
      sxx += p.concentration_nM ** 2; sxy += p.concentration_nM * p.signal_uA;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    // sigma_blank from replicate blanks (concentration = 0) if present,
    // else from residuals of the linear fit.
    const blanks = calibration.filter((p) => p.concentration_nM === 0);
    let sigmaBlank: number | null = null;
    if (blanks.length >= 2) {
      const mean = blanks.reduce((a, p) => a + p.signal_uA, 0) / blanks.length;
      sigmaBlank = Math.sqrt(
        blanks.reduce((a, p) => a + (p.signal_uA - mean) ** 2, 0) / (blanks.length - 1),
      );
    } else {
      const residSq = positive.reduce(
        (a, p) => a + (p.signal_uA - (slope * p.concentration_nM + intercept)) ** 2,
        0,
      );
      sigmaBlank = Math.sqrt(residSq / Math.max(1, n - 2));
    }
    const lod = slope !== 0 ? (3 * sigmaBlank) / Math.abs(slope) : null;
    const loq = slope !== 0 ? (10 * sigmaBlank) / Math.abs(slope) : null;
    const slopeWarning = Math.abs(slope) < 1e-9
      ? "Slope ≈ 0 — calibration not usable for quantitation."
      : null;
    return { slope, intercept, sigmaBlank, lod, loq, n, blanks: blanks.length, slopeWarning };
  }, [calibration]);

  // Keep latest handlers in a ref so the controller identity is stable and
  // does not create an infinite setState loop in the parent.
  const handlersRef = useRef({
    start: startMeasurement,
    stop: stopMeasurement,
    reset: resetMeasurement,
    exportCsv: handleExport,
    addCalibration: addCalibrationPoint,
  });
  useEffect(() => {
    handlersRef.current = {
      start: startMeasurement,
      stop: stopMeasurement,
      reset: resetMeasurement,
      exportCsv: handleExport,
      addCalibration: addCalibrationPoint,
    };
  }, [startMeasurement, stopMeasurement, resetMeasurement, handleExport, addCalibrationPoint]);

  // Publish controller to parent only when reactive state changes.
  useEffect(() => {
    if (!onController) return;
    onController({
      start: () => handlersRef.current.start(),
      stop: () => handlersRef.current.stop(),
      reset: () => handlersRef.current.reset(),
      exportCsv: () => handlersRef.current.exportCsv(),
      addCalibration: () => handlersRef.current.addCalibration(),
      isRunning,
      hasData: data.length > 0,
    });
  }, [onController, isRunning, data.length]);

  return (
    <div className="flex flex-col gap-4">
      {!isControlled && (
        <>
          {/* Measurement Parameters — shared component, same look as CV */}
          <ParametersPanel
            mode="swv"
            eisParams={DEFAULT_EIS_PARAMS}
            fetParams={DEFAULT_FET_PARAMS}
            swvParams={params}
            onChangeEIS={() => {}}
            onChangeFET={() => {}}
            onChangeSWV={setParams}
            disabled={isRunning}
          />

          {/* Controls row — same alignment as CV mode */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={startMeasurement} disabled={isRunning} className="font-mono text-xs">▶ Start SWV</Button>
            <Button size="sm" variant="destructive" onClick={stopMeasurement} disabled={!isRunning} className="font-mono text-xs">■ Stop</Button>
            <Button size="sm" variant="secondary" onClick={resetMeasurement} className="font-mono text-xs">↺ Reset</Button>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={data.length === 0} className="font-mono text-xs">⬇ Export CSV</Button>
            <Button size="sm" variant="outline" onClick={addCalibrationPoint} disabled={data.length === 0} className="font-mono text-xs">+ Calibration Point</Button>
          </div>
        </>
      )}

      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="text-[11px] font-mono">
          {validation.errors.map((e) => <div key={e} className="text-destructive">Error: {e}</div>)}
          {validation.warnings.map((w) => <div key={w} className="text-yellow-600">Warning: {w}</div>)}
        </div>
      )}

      {/* Main grid — plot left (~70%), sidebar right (320px) — same as CV */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-mono text-muted-foreground">SWV — I_net vs E</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={overlayMode ? "default" : "outline"}
                onClick={() => setOverlayMode((v) => !v)}
                className="font-mono text-xs"
              >
                Overlay {overlayMode ? "ON" : "OFF"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (data.length === 0) return;
                  const label =
                    (params.concentration_nM ?? 0) > 0
                      ? `${params.concentration_nM} nM`
                      : `Blank ${overlays.length + 1}`;
                  const color = OVERLAY_COLORS[overlays.length % OVERLAY_COLORS.length];
                  setOverlays((prev) => {
                    const next = [
                      ...prev,
                      { id: newId(), label, color, data: data.slice() },
                    ];
                    return next.length > 8 ? next.slice(next.length - 8) : next;
                  });
                }}
                disabled={data.length === 0}
                className="font-mono text-xs"
              >＋ Capture</Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOverlays([])}
                disabled={overlays.length === 0}
                className="font-mono text-xs"
              >Clear ({overlays.length})</Button>
              <Button
                size="sm"
                variant={showFR ? "default" : "outline"}
                onClick={() => setShowFR((v) => !v)}
                className="font-mono text-xs"
                title="Show pulse-sampled forward and reverse currents"
              >
                Forward/Reverse {showFR ? "ON" : "OFF"}
              </Button>
              <Button
                size="sm"
                variant={showBaseline ? "default" : "outline"}
                onClick={() => setShowBaseline((v) => !v)}
                className="font-mono text-xs"
                title="Overlay estimated baseline"
              >
                Baseline {showBaseline ? "ON" : "OFF"}
              </Button>
              <Button
                size="sm"
                variant={plotMode === "corrected" ? "default" : "outline"}
                onClick={() => setPlotMode((m) => (m === "raw" ? "corrected" : "raw"))}
                className="font-mono text-xs"
                title="Toggle raw (measured) vs baseline-subtracted I_net"
              >
                {plotMode === "corrected" ? "Corrected" : "Raw"}
              </Button>
            </div>
          </div>
          {overlayMode && overlays.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[10px] font-mono">
              {overlays.map((ov) => (
                <span
                  key={ov.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5"
                >
                  <span
                    style={{ background: ov.color, width: 8, height: 8, borderRadius: 999 }}
                  />
                  {ov.label}
                  <button
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setOverlays((prev) => prev.filter((p) => p.id !== ov.id))
                    }
                    title="Remove overlay"
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <div className="rounded-lg border border-border bg-card p-3 h-[440px] md:h-[540px]">
            <SWVPlot
              data={data}
              corrected={corrected}
              metrics={metrics}
              showForwardReverse={showFR}
              showBaseline={showBaseline}
              plotMode={plotMode}
              overlays={overlayMode ? overlays : []}
            />
          </div>

          <div className="text-[11px] font-mono text-muted-foreground border border-border bg-secondary/40 rounded-md p-2">
            Simulation model: {SWV_SIMULATION_MODEL_ID} (empirical / educational approximation).
          </div>

          {/* Calibration */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm font-mono">SWV Calibration</CardTitle></CardHeader>
            <CardContent>
              {calibration.length === 0 && <div className="text-xs font-mono text-muted-foreground">No calibration points yet. Run an SWV sweep and click “+ Calibration Point”.</div>}
              {calibration.length > 0 && (
                <div className="overflow-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left px-1">C (nM)</th>
                        <th className="text-left px-1">signal (µA)</th>
                        <th className="text-left px-1">raw (µA)</th>
                        <th className="text-left px-1">Ep (V)</th>
                        <th className="text-left px-1">SNR</th>
                        <th className="text-left px-1">sample</th>
                        <th className="text-left px-1">electrode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibration.map((p, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-1">{p.concentration_nM.toFixed(3)}</td>
                          <td className="px-1">{p.signal_uA.toFixed(4)}</td>
                          <td className="px-1">{p.raw_uA.toFixed(4)}</td>
                          <td className="px-1">{p.peakPotential_V?.toFixed(3) ?? "N/A"}</td>
                          <td className="px-1">{p.snr?.toFixed(1) ?? "N/A"}</td>
                          <td className="px-1">{p.sampleId ?? "—"}</td>
                          <td className="px-1">{p.electrodeId ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {calibFit && (
                <div className="mt-3 text-[11px] font-mono">
                  <div>Linear: signal = {calibFit.slope.toExponential(3)}·C + {calibFit.intercept.toExponential(3)}</div>
                  <div>σ_blank: {calibFit.sigmaBlank?.toExponential(3)} µA {calibFit.blanks >= 2 ? "(replicate blanks)" : "(fit residuals — no blank replicates)"}</div>
                  <div>LOD: {calibFit.lod != null ? calibFit.lod.toFixed(3) + " nM" : "N/A"} | LOQ: {calibFit.loq != null ? calibFit.loq.toFixed(3) + " nM" : "N/A"}</div>
                  {calibFit.slopeWarning && (
                    <div className="text-destructive">⚠ {calibFit.slopeWarning}</div>
                  )}
                </div>
              )}
              {calibration.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-7 text-[11px]"
                  onClick={() => setCalibration([])}
                >Clear calibration</Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          <SignalQuality
            mode="swv"
            eisData={[]}
            fetBaseline={[]}
            fetAnalyte={[]}
            swvData={data}
            swvMetrics={metrics}
          />

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm font-mono">SWV Metrics</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>Ep: {metrics?.peakPotential_V?.toFixed(3) ?? "N/A"} V</div>
              <div>Ip (raw): {metrics?.peakCurrentRaw_uA?.toFixed(4) ?? "N/A"} µA</div>
              <div>Ip (corr): {metrics?.peakCurrentCorrected_uA?.toFixed(4) ?? "N/A"} µA</div>
              <div>Half-width: {metrics?.halfPeakWidth_mV?.toFixed(1) ?? "N/A"} mV</div>
              <div>SNR: {metrics?.snr?.toFixed(2) ?? "N/A"}</div>
              <div>Noise RMS: {metrics?.noiseRms_uA?.toExponential(2) ?? "N/A"} µA</div>
              <div>Polarity: {metrics?.peakPolarity ?? "N/A"}</div>
              <div>Baseline used: {metrics?.baselineMethodUsed ?? metrics?.baselineMethod ?? "none"}</div>
              <div className="col-span-2 text-muted-foreground">
                {(metrics?.warnings ?? []).map((w) => <div key={w}>⚠ {w}</div>)}
              </div>
            </CardContent>
          </Card>

          <MeasurementNotesPanel
            value={notes}
            onChange={setNotes}
            onClear={() => setNotes({})}
            mode="swv"
            measurementId={measurementId}
            measurementTimestamp={measurementTimestamp}
          />
        </div>
      </div>
    </div>
  );
}


