/**
 * SWV Mode component.
 *
 * Owns:
 *  - parameter panel, validation and warnings
 *  - start / stop / reset / export controls (simulated + live)
 *  - SWV plot with raw/corrected/baseline/forward-reverse toggles
 *  - metrics cards
 *  - measurement notes (via MeasurementNotesPanel with mode="swv")
 *
 * Shared components used:
 *  - SignalQuality.tsx for the SWV signal-quality semaphore
 *  - CalibrationPanel.tsx for calibration (replicates + blanks + LOD/LOQ)
 *
 * All exports go through the shared csvExport helpers so the session CSV
 * automatically picks up SWV measurements written to the session store.
 */
import { Hint } from "@/components/InfoHint";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import SWVPlot from "@/components/SWVPlot";
import SignalQuality from "@/components/SignalQuality";
import MeasurementNotesPanel from "@/components/MeasurementNotesPanel";
import CalibrationPanel, {
  type CalibrationPoint,
} from "@/components/CalibrationPanel";
import ParametersPanel, {
  DEFAULT_EIS_PARAMS,
  DEFAULT_FET_PARAMS,
} from "@/components/ParametersPanel";

import { SWV_SIMULATION_MODEL_ID } from "@/hooks/useSimulatedSWVData";
import type { SWVModeState } from "@/hooks/useSWVModeState";
import {
  analyzeSWV,
  validateSWVParameters,
} from "@/utils/swvMetrics";
import type {
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
  type StoredMeasurement,
} from "@/utils/sessionStore";
import { exportCalibrationCSV, exportSWVData } from "@/utils/csvExport";
import { parseImportedCsv } from "@/utils/csvImport";

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
  /** Latest acquired points, exposed so parent views (dashboard) can read them. */
  data: SWVDataPoint[];
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
  /** If provided, SWV measurements are pushed into the parent's shared
   *  session state (which owns localStorage persistence). Without it,
   *  SWVMode falls back to writing directly to localStorage. */
  onSessionUpdate?: (updater: (prev: StoredMeasurement[]) => StoredMeasurement[]) => void;
  /** Overlay curves are owned by the parent so they survive mode switches. */
  overlays: { id: string; label: string; color: string; data: SWVDataPoint[] }[];
  setOverlays: React.Dispatch<
    React.SetStateAction<{ id: string; label: string; color: string; data: SWVDataPoint[] }[]>
  >;
  /** Overlay auto-capture only happens during the guided demo. */
  demoRunning: boolean;
  /** Persistent SWV state owned by the parent (survives mode switches). */
  state: SWVModeState;
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
  diffusionCoeff: 7.26e-6,
  formalPotential: 0.22,
  k0: 0.01,
  alpha: 0.5,
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



export default function SWVMode({ dataSource, ws, externalParams, onChangeParams, onController, onSessionUpdate, overlays, setOverlays, demoRunning, state }: Props) {
  const [internalParams, setInternalParams] = useState<SWVParameters>(DEFAULT_PARAMS);
  const params = externalParams ?? internalParams;
  const setParams = onChangeParams ?? setInternalParams;
  const isControlled = !!onController;
  // All state below is owned by the parent so it survives mode switches
  // (same lifecycle as CV/EIS).
  const {
    sim,
    notes, setNotes,
    measurementId, setMeasurementId,
    measurementTimestamp, setMeasurementTimestamp,
    calibration, setCalibration,
    showFR, setShowFR,
    showBaseline, setShowBaseline,
    plotMode, setPlotMode,
    overlayMode, setOverlayMode,
    autoCapturedRef,
    wasRunningRef,
  } = state;
  // overlays / setOverlays also come from props (lifted to IndexPage).
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
      // Auto-capture into the overlay comparison view (same logic as the
      // manual "＋ Capture" button), once per measurement — demo only.
      if (demoRunning && !autoCapturedRef.current.has(measurementId)) {
        autoCapturedRef.current.add(measurementId);
        const snapshot = data.slice();
        setOverlays((prev) => {
          const label =
            (concentration ?? 0) > 0 ? `${concentration} nM` : `Blank ${prev.length + 1}`;
          const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length];
          const next = [...prev, { id: newId(), label, color, data: snapshot }];
          return next.length > 8 ? next.slice(next.length - 8) : next;
        });
      }
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
      if (onSessionUpdate) {
        onSessionUpdate((prev) => {
          const idx = prev.findIndex(
            (m) => m.mode === "swv" && (m as StoredSWVMeasurement).measurementId === measurementId,
          );
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = stored;
            return next;
          }
          return [...prev, stored];
        });
      } else {
        const session = loadSession();
        const idx = session.findIndex(
          (m) => m.mode === "swv" && (m as StoredSWVMeasurement).measurementId === measurementId,
        );
        if (idx >= 0) session[idx] = stored; else session.push(stored);
        saveSession(session);
      }
      return stored;
    },
    [corrected, data, dataSource, measurementId, measurementTimestamp, metrics, notes, params, onSessionUpdate, demoRunning, setOverlays],
  );

  // Persist + auto-capture as soon as a sweep finishes, so the overlay
  // comparison view already has the just-finished scan available.
  useEffect(() => {
    const justFinished = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    if (!justFinished || data.length === 0) return;
    persistMeasurement(params.concentration_nM);
  }, [isRunning, data.length, params.concentration_nM, persistMeasurement]);



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
    const point: CalibrationPoint = {
      concentration: params.concentration_nM ?? 0,
      signal:
        metrics?.peakCurrentCorrected_uA ?? metrics?.peakCurrentRaw_uA ?? 0,
      raw: metrics?.peakCurrentRaw_uA ?? 0,
      peakPotential_V: metrics?.peakPotential_V ?? null,
      snr: metrics?.snr ?? null,
      timestamp: Date.now(),
      measurementId,
      sampleId: notes.sampleId,
      electrodeId: notes.electrodeId,
      notesShort: shortNotesSummary(notes) ?? undefined,
    };
    setCalibration((prev) => [...prev, point]);
    persistMeasurement(params.concentration_nM);
    toast.success(`Added SWV calibration point @ ${point.concentration} nM.`);
  }, [metrics, notes, params, persistMeasurement, measurementId]);


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
      data,
    });
  }, [onController, isRunning, data]);

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
              <Hint text="Import a previously exported ElectroStat SWV CSV as an overlay">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".csv,text/csv";
                    input.onchange = async () => {
                      const f = input.files?.[0];
                      if (!f) return;
                      try {
                        const text = await f.text();
                        const r = parseImportedCsv(text, "swv");
                        if ("error" in r) { toast.error(r.error); return; }
                        if (r.mode !== "swv") return;
                        const fileLabel = f.name.replace(/\.[^.]+$/, "");
                        const multi = r.measurements.length > 1;
                        setOverlays((prev) => {
                          let next = prev.slice();
                          r.measurements.forEach((m) => {
                            const suffix = m.concentration != null ? `${m.concentration} nM` : m.id;
                            const label = multi ? `${fileLabel} · ${suffix}` : fileLabel;
                            const color = OVERLAY_COLORS[next.length % OVERLAY_COLORS.length];
                            next = [...next, { id: newId(), label, color, data: m.points }];
                          });
                          return next.length > 8 ? next.slice(next.length - 8) : next;
                        });
                        if (r.skipped > 0) {
                          toast.warning(`${r.skipped} linha(s) inválida(s) descartadas.`);
                        }
  
                      } catch (err) {
                        toast.error(
                          `Falha ao ler CSV: ${err instanceof Error ? err.message : String(err)}`,
                        );
                      }
                    };
                    input.click();
                  }}
                  className="font-mono text-xs"
                >⇪ Import CSV</Button>
              </Hint>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOverlays([])}
                disabled={overlays.length === 0}
                className="font-mono text-xs"
              >Clear ({overlays.length})</Button>
              <Hint text="Show pulse-sampled forward and reverse currents">
                <Button
                  size="sm"
                  variant={showFR ? "default" : "outline"}
                  onClick={() => setShowFR((v) => !v)}
                  className="font-mono text-xs"
                >
                  Forward/Reverse {showFR ? "ON" : "OFF"}
                </Button>
              </Hint>
              <Hint text="Overlay estimated baseline">
                <Button
                  size="sm"
                  variant={showBaseline ? "default" : "outline"}
                  onClick={() => setShowBaseline((v) => !v)}
                  className="font-mono text-xs"
                >
                  Baseline {showBaseline ? "ON" : "OFF"}
                </Button>
              </Hint>
              <Hint text="Toggle raw (measured) vs baseline-subtracted I_net">
                <Button
                  size="sm"
                  variant={plotMode === "corrected" ? "default" : "outline"}
                  onClick={() => setPlotMode((m) => (m === "raw" ? "corrected" : "raw"))}
                  className="font-mono text-xs"
                >
                  {plotMode === "corrected" ? "Corrected" : "Raw"}
                </Button>
              </Hint>
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
                  <Hint text="Remove overlay">
                    <button
                      type="button"
                      aria-label={`Remove overlay: ${ov.label}`}
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setOverlays((prev) => prev.filter((p) => p.id !== ov.id))
                      }
                    >×</button>
                  </Hint>
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

          <CalibrationPanel
            mode="swv"
            concentration={params.concentration_nM ?? 0}
            onChangeConcentration={(v) =>
              setParams({ ...params, concentration_nM: v })
            }
            points={calibration}
            onClear={() => setCalibration([])}
            onExport={() => exportCalibrationCSV("swv", calibration, dataSource)}
            currentPeakCurrentRaw_uA={metrics?.peakCurrentRaw_uA ?? null}
            currentPeakCurrentCorrected_uA={metrics?.peakCurrentCorrected_uA ?? null}
            currentPeakPotential_V={metrics?.peakPotential_V ?? null}
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


