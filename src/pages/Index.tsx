import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import NyquistPlot from "@/components/NyquistPlot";
import BodePlot from "@/components/BodePlot";
import FETTransferPlot from "@/components/FETTransferPlot";
import FETTimePlot from "@/components/FETTimePlot";
import StatusIndicator from "@/components/StatusIndicator";
import ConnectionPanel from "@/components/ConnectionPanel";
import SignalQuality from "@/components/SignalQuality";
import SweepProgress, { type SweepStatus } from "@/components/SweepProgress";
import {
  useSimulatedEIS,
  useSimulatedFETTransfer,
  useSimulatedFETTime,
} from "@/hooks/useSimulatedData";
import {
  exportEISData,
  exportFETTransferData,
  exportFETTimeData,
  exportSessionCSV,
  exportCalibrationCSV as exportCalibrationTSV,
} from "@/utils/csvExport";
import { useWebSocketData } from "@/hooks/useWebSocketData";
import ParametersPanel, {
  DEFAULT_EIS_PARAMS,
  DEFAULT_FET_PARAMS,
  type EISParams,
  type FETParams,
} from "@/components/ParametersPanel";
import CalibrationPanel, {
  type CalibrationPoint,
  computeEISParams,
  computeFETVt,
} from "@/components/CalibrationPanel";
import CircuitFitResults from "@/components/CircuitFitResults";
import {
  fitRandles,
  extractWarburgSlope,
  kramersKronigTest,
  type RandlesFitResult,
  type WarburgResult,
  type KKResult,
} from "@/utils/randlesFit";
import {
  loadSession,
  saveSession,
  clearSession,
  newId,
  type StoredMeasurement,
  type StoredEISMeasurement,
  type StoredFETMeasurement,
} from "@/utils/sessionStore";
import { logActivity, clearActivityLog } from "@/utils/activityLog";
import type { EISDataPoint } from "@/hooks/useSimulatedData";

// 8-color palette for overlays
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

interface OverlayCurve {
  id: string;
  label: string;
  color: string;
  data: EISDataPoint[];
}

const Index = () => {
  const [mode, setMode] = useState<"eis" | "fet">("eis");
  const [dataSource, setDataSource] = useState<"simulated" | "live">("simulated");
  const [eisParams, setEisParams] = useState<EISParams>(DEFAULT_EIS_PARAMS);
  const [fetParams, setFetParams] = useState<FETParams>(DEFAULT_FET_PARAMS);

  // Concentration & Calibration state (per mode)
  const [concentration, setConcentration] = useState<number>(0);
  const [eisCalibration, setEisCalibration] = useState<CalibrationPoint[]>([]);
  const [fetCalibration, setFetCalibration] = useState<CalibrationPoint[]>([]);

  // Randles equivalent-circuit fit + Warburg slope (computed on sweep complete)
  const [randlesFit, setRandlesFit] = useState<RandlesFitResult | null>(null);
  const [warburg, setWarburg] = useState<WarburgResult | null>(null);
  const [kk, setKk] = useState<KKResult | null>(null);
  const [geometricFallback, setGeometricFallback] = useState(false);

  // Overlay mode (Nyquist)
  const [overlayMode, setOverlayMode] = useState(false);
  const [eisOverlays, setEisOverlays] = useState<OverlayCurve[]>([]);

  // BioFET sample-addition markers
  const [fetMarkers, setFetMarkers] = useState<{ time: number; label: string }[]>([]);

  // Persisted session of all completed measurements
  const [sessionMeasurements, setSessionMeasurements] = useState<StoredMeasurement[]>([]);

  // Sweep status tracks completion separately from "is running"
  const [eisStatus, setEisStatus] = useState<SweepStatus>("idle");
  const [fetStatus, setFetStatus] = useState<SweepStatus>("idle");

  // Frozen snapshots for Signal Quality after sweep completes / stops
  const [frozenEis, setFrozenEis] = useState<ReturnType<typeof useWebSocketData>["eisData"] | null>(null);
  const [frozenFetBaseline, setFrozenFetBaseline] = useState<ReturnType<typeof useWebSocketData>["fetBaseline"] | null>(null);
  const [frozenFetAnalyte, setFrozenFetAnalyte] = useState<ReturnType<typeof useWebSocketData>["fetAnalyte"] | null>(null);

  // Simulated data hooks
  const eis = useSimulatedEIS(150);
  const fetTransfer = useSimulatedFETTransfer(80);
  const fetTime = useSimulatedFETTime(150);

  // Live WebSocket data hook
  const ws = useWebSocketData();

  // Restore session on mount
  useEffect(() => {
    const stored = loadSession();
    if (stored.length === 0) return;
    setSessionMeasurements(stored);
    const eisBaselineRct = stored.find(
      (m): m is StoredEISMeasurement => m.mode === "eis" && m.concentration === 0,
    )?.extracted.Rct;
    const fetBaselineVt = stored.find(
      (m): m is StoredFETMeasurement => m.mode === "fet" && m.concentration === 0,
    )?.extracted.Vt;
    const eisCal: CalibrationPoint[] = [];
    const fetCal: CalibrationPoint[] = [];
    for (const m of stored) {
      if (m.mode === "eis" && m.extracted.Rct != null) {
        const delta =
          m.concentration === 0 ? 0 : m.extracted.Rct - (eisBaselineRct ?? m.extracted.Rct);
        eisCal.push({
          concentration: m.concentration,
          signal: delta,
          raw: m.extracted.Rct,
          timestamp: m.timestamp,
        });
      } else if (m.mode === "fet" && m.extracted.Vt != null) {
        const delta =
          m.concentration === 0 ? 0 : (m.extracted.Vt - (fetBaselineVt ?? m.extracted.Vt)) * 1000;
        fetCal.push({
          concentration: m.concentration,
          signal: delta,
          raw: m.extracted.Vt,
          timestamp: m.timestamp,
        });
      }
    }
    setEisCalibration(eisCal);
    setFetCalibration(fetCal);
    toast.success(`Restored ${stored.length} measurement(s) from previous session`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever session changes
  useEffect(() => {
    saveSession(sessionMeasurements);
  }, [sessionMeasurements]);

  // Log WebSocket connection status transitions
  const lastWsStatusRef = useRef(ws.status);
  useEffect(() => {
    if (lastWsStatusRef.current === ws.status) return;
    if (ws.status === "connected") {
      logActivity("connection", "WebSocket connection established");
    } else if (ws.status === "disconnected" && lastWsStatusRef.current === "connected") {
      logActivity("connection", "WebSocket disconnected");
    } else if (ws.status === "error") {
      logActivity("connection", `WebSocket error${ws.errorMessage ? ": " + ws.errorMessage : ""}`);
    }
    lastWsStatusRef.current = ws.status;
  }, [ws.status, ws.errorMessage]);

  // Log concentration entry (debounced via ref so we don't spam on every keystroke commit)
  const lastLoggedConcentrationRef = useRef<number | null>(null);
  const handleChangeConcentration = (v: number) => {
    setConcentration(v);
    if (lastLoggedConcentrationRef.current !== v) {
      lastLoggedConcentrationRef.current = v;
      logActivity("calibration", `Concentration set to ${v} nM (${mode.toUpperCase()})`);
    }
  };

  // Pick the right data based on source
  const eisData = dataSource === "simulated" ? eis.data : ws.eisData;
  const fetBaselineData = dataSource === "simulated" ? fetTransfer.baseline : ws.fetBaseline;
  const fetAnalyteData = dataSource === "simulated" ? fetTransfer.withAnalyte : ws.fetAnalyte;
  const fetTimeDataArr = dataSource === "simulated" ? fetTime.data : ws.fetTimeData;

  // Expected counts based on configured parameters
  const expectedEisPoints = eisParams.points;
  const expectedFetTransferPoints = useMemo(
    () => Math.max(1, Math.round((fetParams.vgMax - fetParams.vgMin) / (fetParams.vgStep / 1000)) + 1),
    [fetParams.vgMin, fetParams.vgMax, fetParams.vgStep]
  );
  const expectedFetTimePoints = 60;
  const expectedFetTotal =
    expectedFetTransferPoints * 2 + expectedFetTimePoints;
  const fetReceivedTotal =
    fetBaselineData.length + fetAnalyteData.length + fetTimeDataArr.length;

  // Avoid double-firing the auto-stop
  const eisAutoStopFiredRef = useRef(false);
  const fetAutoStopFiredRef = useRef(false);

  // Inactivity timers for completion when expected point count is wrong
  const eisInactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetInactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEisInactivity = () => {
    if (eisInactivityRef.current) {
      clearTimeout(eisInactivityRef.current);
      eisInactivityRef.current = null;
    }
  };
  const clearFetInactivity = () => {
    if (fetInactivityRef.current) {
      clearTimeout(fetInactivityRef.current);
      fetInactivityRef.current = null;
    }
  };

  // Shared EIS completion logic — used by both count-based and inactivity-based triggers
  const completeEISSweep = (finalData: typeof eisData) => {
    if (eisAutoStopFiredRef.current) return;
    eisAutoStopFiredRef.current = true;
    clearEisInactivity();
    if (dataSource === "simulated") {
      eis.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenEis(finalData);
    setEisStatus("complete");
    toast.success(`Sweep complete — ${finalData.length} points collected`);
    const params = computeEISParams(finalData);
    let fit: ReturnType<typeof fitRandles> = null;
    let wb: ReturnType<typeof extractWarburgSlope> = { ok: false };
    let kkRes: KKResult | null = null;
    try {
      fit = fitRandles(finalData);
      wb = extractWarburgSlope(finalData);
      kkRes = kramersKronigTest(finalData);
      setRandlesFit(fit);
      setWarburg(wb);
      setKk(kkRes);
      const rctVal = fit?.Rct ?? params?.rct;
      logActivity(
        "measurement",
        `EIS completed — concentration=${concentration} nM, Rct=${
          rctVal != null ? rctVal.toFixed(1) : "n/a"
        } Ω, points=${finalData.length}`,
      );
    } catch (err) {
      console.warn("Randles fit error", err);
    }
    const fitConverged = fit != null && fit.fitErrorPct !== -1;
    setGeometricFallback(!fitConverged);
    const rctForCalib = fit?.Rct ?? params?.rct ?? 0;
    const rsForCalib = fit?.Rs ?? params?.rs ?? 0;
    if (rctForCalib != null) {
      const baseline = eisCalibration.find((p) => p.concentration === 0);
      const deltaRct =
        concentration === 0 ? 0 : rctForCalib - (baseline?.raw ?? rctForCalib);
      setEisCalibration((prev) => [
        ...prev.filter((p) => p.concentration !== concentration),
        { concentration, signal: deltaRct, raw: rctForCalib, timestamp: Date.now() },
      ]);
    }
    try {
      if (overlayMode) {
        setEisOverlays((prev) => {
          const label =
            dataSource === "live" && ws.lastFilename
              ? ws.lastFilename.replace(/\.xlsx$/i, "").replace(/\.xls$/i, "")
              : concentration > 0
                ? `${concentration} nM`
                : `Measurement ${prev.length + 1}`;
          const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length];
          const next = [
            ...prev,
            { id: newId(), label, color, data: finalData.slice() },
          ];
          return next.length > 8 ? next.slice(next.length - 8) : next;
        });
      }
      const stored: StoredEISMeasurement = {
        id: newId(),
        mode: "eis",
        timestamp: Date.now(),
        concentration,
        params: {
          freqMin: eisParams.freqMin,
          freqMax: eisParams.freqMax,
          points: eisParams.points,
          amplitude: eisParams.amplitude,
        },
        data: finalData.slice(),
        extracted: {
          Rs: rsForCalib,
          Rct: rctForCalib,
          Cdl: fit?.Cdl,
          Aw: fit?.Aw,
          warburgSlope: wb.ok ? wb.slope : undefined,
          warburgAw: wb.ok ? wb.Aw : undefined,
          fitErrorPct: fit?.fitErrorPct,
          f0: fit?.f0,
          kkResidualPct: kkRes?.residualPct,
          kkPassed: kkRes?.passed,
          fitConverged,
          geometricFallback: !fitConverged,
          deltaRct:
            concentration === 0
              ? 0
              : rctForCalib -
                (eisCalibration.find((p) => p.concentration === 0)?.raw ?? rctForCalib),
          deltaRctNormPct: (() => {
            const base = eisCalibration.find((p) => p.concentration === 0)?.raw;
            if (base == null || base <= 0 || concentration === 0) return undefined;
            return ((rctForCalib - base) / base) * 100;
          })(),
          warnFlags: fit?.warnFlags,
        },
      };
      setSessionMeasurements((prev) => [...prev, stored]);
    } catch (err) {
      console.warn("Randles fit failed", err);
    }
  };

  // Shared FET completion logic
  const completeFETSweep = (
    finalBaseline: typeof fetBaselineData,
    finalAnalyte: typeof fetAnalyteData,
    finalTime: typeof fetTimeDataArr,
  ) => {
    if (fetAutoStopFiredRef.current) return;
    fetAutoStopFiredRef.current = true;
    clearFetInactivity();
    if (dataSource === "simulated") {
      fetTransfer.stop();
      fetTime.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenFetBaseline(finalBaseline);
    setFrozenFetAnalyte(finalAnalyte);
    setFetStatus("complete");
    const total = finalBaseline.length + finalAnalyte.length + finalTime.length;
    toast.success(`Sweep complete — ${total} points collected`);
    const vt = computeFETVt(finalAnalyte);
    logActivity(
      "measurement",
      `BioFET completed — concentration=${concentration} nM, Vt=${
        vt != null ? vt.toFixed(3) : "n/a"
      } V`,
    );
    if (vt != null) {
      const baseline = fetCalibration.find((p) => p.concentration === 0);
      const deltaVt =
        concentration === 0 ? 0 : (vt - (baseline?.raw ?? vt)) * 1000;
      setFetCalibration((prev) => [
        ...prev.filter((p) => p.concentration !== concentration),
        { concentration, signal: deltaVt, raw: vt, timestamp: Date.now() },
      ]);
    }
    const storedFet: StoredFETMeasurement = {
      id: newId(),
      mode: "fet",
      timestamp: Date.now(),
      concentration,
      params: {
        vgMin: fetParams.vgMin,
        vgMax: fetParams.vgMax,
        vgStep: fetParams.vgStep,
        intervalMs: fetParams.intervalMs,
      },
      baseline: finalBaseline.slice(),
      analyte: finalAnalyte.slice(),
      timeData: finalTime.slice(),
      markers: fetMarkers.slice(),
      extracted: { Vt: vt ?? undefined },
    };
    setSessionMeasurements((prev) => [...prev, storedFet]);
  };

  const handleStartEIS = () => {
    eisAutoStopFiredRef.current = false;
    setFrozenEis(null);
    setRandlesFit(null);
    setWarburg(null);
    setKk(null);
    setGeometricFallback(false);
    setEisStatus("running");
    logActivity(
      "measurement",
      `EIS measurement started — concentration=${concentration} nM, source=${dataSource}, points=${eisParams.points}`,
    );
    if (dataSource === "simulated") {
      eis.start(concentration, eisParams.points);
    } else {
      ws.clearEIS();
      ws.sendCommand("start_eis", {
        freqMin: eisParams.freqMin,
        freqMax: eisParams.freqMax,
        points: eisParams.points,
        amplitude: eisParams.amplitude,
        concentration,
      });
    }
  };

  const handleResetEIS = () => {
    eisAutoStopFiredRef.current = false;
    clearEisInactivity();
    setFrozenEis(null);
    setEisStatus("idle");
    setRandlesFit(null);
    setWarburg(null);
    setKk(null);
    setGeometricFallback(false);
    if (dataSource === "simulated") {
      eis.reset();
    } else {
      ws.clearEIS();
      ws.sendCommand("stop");
    }
  };

  const handleStartFET = () => {
    fetAutoStopFiredRef.current = false;
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    setFetMarkers([]);
    setFetStatus("running");
    logActivity(
      "measurement",
      `BioFET measurement started — concentration=${concentration} nM, source=${dataSource}`,
    );
    if (dataSource === "simulated") {
      fetTransfer.start(
        concentration,
        fetParams.vgMin,
        fetParams.vgMax,
        expectedFetTransferPoints,
      );
      fetTime.start(concentration);
    } else {
      ws.clearFET();
      ws.sendCommand("start_fet", {
        vgMin: fetParams.vgMin,
        vgMax: fetParams.vgMax,
        vgStep: fetParams.vgStep / 1000, // mV → V
        intervalMs: fetParams.intervalMs,
        concentration,
      });
    }
  };

  const handleResetFET = () => {
    fetAutoStopFiredRef.current = false;
    clearFetInactivity();
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    setFetStatus("idle");
    setFetMarkers([]);
    if (dataSource === "simulated") {
      fetTransfer.reset();
      fetTime.reset();
    } else {
      ws.clearFET();
      ws.sendCommand("stop");
    }
  };

  // Manual stop (mid-sweep)
  const handleStopEIS = () => {
    if (eisStatus !== "running") return;
    eisAutoStopFiredRef.current = true;
    clearEisInactivity();
    if (dataSource === "simulated") {
      eis.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenEis(eisData);
    setEisStatus("stopped");
    toast(`Stopped at ${eisData.length} / ${expectedEisPoints} points`);
  };

  const handleStopFET = () => {
    if (fetStatus !== "running") return;
    fetAutoStopFiredRef.current = true;
    clearFetInactivity();
    if (dataSource === "simulated") {
      fetTransfer.stop();
      fetTime.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenFetBaseline(fetBaselineData);
    setFrozenFetAnalyte(fetAnalyteData);
    setFetStatus("stopped");
    toast(`Stopped at ${fetReceivedTotal} / ${expectedFetTotal} points`);
  };

  // Auto-completion detection — EIS
  useEffect(() => {
    if (eisStatus !== "running") return;
    if (eisAutoStopFiredRef.current) return;
    if (eisData.length >= expectedEisPoints && expectedEisPoints > 0) {
      completeEISSweep(eisData);
    }
  }, [eisData, eisStatus, expectedEisPoints, dataSource, eis, ws]);

  // Inactivity-based completion — EIS (fires after 2s of no new points, once >=10 collected)
  useEffect(() => {
    if (eisStatus !== "running") {
      clearEisInactivity();
      return;
    }
    if (eisData.length < 10) return;
    if (eisAutoStopFiredRef.current) return;
    clearEisInactivity();
    const snapshot = eisData;
    eisInactivityRef.current = setTimeout(() => {
      completeEISSweep(snapshot);
    }, 2000);
    return () => clearEisInactivity();
  }, [eisData, eisStatus]);

  // Auto-completion detection — BioFET (all 3 phases done)
  useEffect(() => {
    if (fetStatus !== "running") return;
    if (fetAutoStopFiredRef.current) return;
    const baselineDone = fetBaselineData.length >= expectedFetTransferPoints;
    const analyteDone = fetAnalyteData.length >= expectedFetTransferPoints;
    const timeDone = fetTimeDataArr.length >= expectedFetTimePoints;
    if (baselineDone && analyteDone && timeDone) {
      completeFETSweep(fetBaselineData, fetAnalyteData, fetTimeDataArr);
    }
  }, [
    fetBaselineData,
    fetAnalyteData,
    fetTimeDataArr,
    fetStatus,
    expectedFetTransferPoints,
    expectedFetTimePoints,
    fetReceivedTotal,
    dataSource,
    fetTransfer,
    fetTime,
    ws,
  ]);

  // Inactivity-based completion — BioFET (2s after fetTimeDataArr stops growing, once >=5)
  useEffect(() => {
    if (fetStatus !== "running") {
      clearFetInactivity();
      return;
    }
    if (fetTimeDataArr.length < 5) return;
    if (fetAutoStopFiredRef.current) return;
    clearFetInactivity();
    const b = fetBaselineData;
    const a = fetAnalyteData;
    const t = fetTimeDataArr;
    fetInactivityRef.current = setTimeout(() => {
      completeFETSweep(b, a, t);
    }, 2000);
    return () => clearFetInactivity();
  }, [fetBaselineData, fetAnalyteData, fetTimeDataArr, fetStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearEisInactivity();
      clearFetInactivity();
    };
  }, []);

  // "Running" now means status === running, not just connected/animating
  const isEISRunning = eisStatus === "running";
  const isFETRunning = fetStatus === "running";

  // Data shown in Signal Quality (frozen after stop/complete)
  const sqEisData = frozenEis ?? eisData;
  const sqFetBaseline = frozenFetBaseline ?? fetBaselineData;
  const sqFetAnalyte = frozenFetAnalyte ?? fetAnalyteData;

  // Live computed parameters for the calibration panel
  const liveEisParams = useMemo(() => computeEISParams(sqEisData), [sqEisData]);
  const liveFetVt = useMemo(() => computeFETVt(sqFetAnalyte), [sqFetAnalyte]);

  // Add a sample-addition marker at the current time on the FET time trace
  const handleAddFetMarker = () => {
    const last = fetTimeDataArr[fetTimeDataArr.length - 1];
    const t = last ? last.time : 0;
    const label = `Sample added — t = ${t.toFixed(1)} s`;
    setFetMarkers((prev) => [...prev, { time: t, label }]);
    logActivity("sample", `Sample added at t=${t.toFixed(1)} s (concentration=${concentration} nM)`);
    toast.success(label);
  };

  // Clear the entire stored session
  const handleClearSession = () => {
    clearSession();
    clearActivityLog();
    logActivity("system", "Session cleared by user");
    setSessionMeasurements([]);
    setEisCalibration([]);
    setFetCalibration([]);
    setEisOverlays([]);
    toast("Session cleared");
  };

  // Export calibration table as TSV
  const exportCalibrationCSV = () => {
    const list = mode === "eis" ? eisCalibration : fetCalibration;
    if (list.length === 0) return;
    exportCalibrationTSV(mode, list, dataSource);
  };

  const handleChangeSource = (source: "simulated" | "live") => {
    // Reset everything when switching
    eis.reset();
    fetTransfer.reset();
    fetTime.reset();
    ws.clearEIS();
    ws.clearFET();
    setEisStatus("idle");
    setFetStatus("idle");
    setFrozenEis(null);
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    eisAutoStopFiredRef.current = false;
    fetAutoStopFiredRef.current = false;
    if (source === "simulated" && ws.status === "connected") {
      ws.disconnect();
    }
    setDataSource(source);
  };

  const sourceLabel = dataSource === "simulated" ? "Simulated Data" : (
    ws.status === "connected" ? "Live — Connected" : "Live — Not Connected"
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight font-mono">
            HelpStat
            <span className="text-primary ml-2 text-sm font-normal">Biosensor Dashboard</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            ESP32-S3 / AD5941 — {sourceLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportSessionCSV(sessionMeasurements, {
                source: dataSource,
                calibration: [
                  ...eisCalibration.map((p) => ({ ...p, mode: "eis" as const })),
                  ...fetCalibration.map((p) => ({ ...p, mode: "fet" as const })),
                ],
              })
            }
            disabled={sessionMeasurements.length === 0}
            className="font-mono text-xs"
          >
            ⬇ Export Session CSV ({sessionMeasurements.length})
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={sessionMeasurements.length === 0}
                className="font-mono text-xs"
              >
                Clear Session
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all stored measurements?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure? This cannot be undone. All saved EIS/BioFET sweeps and the calibration history will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearSession}>
                  Yes, clear everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground ml-2">
            <div className={`w-2 h-2 rounded-full ${
              dataSource === "simulated"
                ? "bg-graph-alt"
                : ws.status === "connected"
                  ? "bg-graph-primary"
                  : ws.status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground"
            }`} />
            <span>{dataSource === "simulated" ? "Simulated" : ws.status === "connected" ? "Live" : "Offline"}</span>
          </div>
        </div>
      </header>

      {/* Connection Panel */}
      <div className="mb-4">
        <ConnectionPanel
          dataSource={dataSource}
          onChangeSource={handleChangeSource}
          connectionStatus={ws.status}
          errorMessage={ws.errorMessage}
          onConnect={ws.connect}
          onDisconnect={ws.disconnect}
        />
      </div>

      {/* Measurement Parameters */}
      <div className="mb-4">
        <ParametersPanel
          mode={mode}
          eisParams={eisParams}
          fetParams={fetParams}
          onChangeEIS={setEisParams}
          onChangeFET={setFetParams}
          disabled={mode === "eis" ? isEISRunning : isFETRunning}
        />
      </div>

      {/* Mode selection */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button
            variant={mode === "eis" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("eis")}
            className="font-mono text-xs"
          >
            EIS Mode
          </Button>
          <Button
            variant={mode === "fet" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("fet")}
            className="font-mono text-xs"
          >
            BioFET Mode
          </Button>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          {mode === "eis" ? (
            <>
              <Button
                size="sm"
                onClick={handleStartEIS}
                disabled={
                  isEISRunning ||
                  (dataSource === "live" && ws.status !== "connected")
                }
                className="font-mono text-xs"
              >
                ▶ Start EIS
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopEIS}
                disabled={!isEISRunning}
                className="font-mono text-xs"
              >
                ■ Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetEIS} className="font-mono text-xs">
                ↺ Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportEISData(eisData, dataSource)}
                disabled={eisData.length === 0}
                className="font-mono text-xs"
              >
                ⬇ Export CSV
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleStartFET}
                disabled={
                  isFETRunning ||
                  (dataSource === "live" && ws.status !== "connected")
                }
                className="font-mono text-xs"
              >
                ▶ Start FET
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopFET}
                disabled={!isFETRunning}
                className="font-mono text-xs"
              >
                ■ Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetFET} className="font-mono text-xs">
                ↺ Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  exportFETTransferData(fetBaselineData, fetAnalyteData, dataSource);
                  if (fetTimeDataArr.length > 0) exportFETTimeData(fetTimeDataArr, dataSource);
                }}
                disabled={fetBaselineData.length === 0 && fetTimeDataArr.length === 0}
                className="font-mono text-xs"
              >
                ⬇ Export CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {/* EIS MODE */}
      {mode === "eis" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Tabs defaultValue="nyquist" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <TabsList className="bg-secondary">
              <TabsTrigger value="nyquist" className="font-mono text-xs">Nyquist Plot</TabsTrigger>
              <TabsTrigger value="bode" className="font-mono text-xs">Bode Plot</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={overlayMode ? "default" : "outline"}
                onClick={() => setOverlayMode((v) => !v)}
                className="font-mono text-xs"
              >
                Overlay Mode {overlayMode ? "ON" : "OFF"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEisOverlays([])}
                disabled={eisOverlays.length === 0}
                className="font-mono text-xs"
              >
                Clear All ({eisOverlays.length})
              </Button>
              <StatusIndicator
                isRunning={isEISRunning && eisData.length > 0}
                label={isEISRunning && eisData.length > 0 ? "Sweeping..." : "Idle"}
                dataPoints={eisData.length}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <TabsContent value="nyquist" className="mt-0 h-[400px] md:h-[500px]">
              <NyquistPlot
                data={eisData}
                fittedCurve={randlesFit?.fittedCurve}
                overlays={eisOverlays}
              />
            </TabsContent>
            <TabsContent value="bode" className="mt-0 h-[400px] md:h-[500px]">
              <BodePlot data={eisData} />
            </TabsContent>
          </div>

          <SweepProgress
            status={eisStatus}
            current={eisData.length}
            expected={expectedEisPoints}
          />

          {dataSource === "live" && ws.lastFilename && (
            <div className="mt-2 text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-graph-primary animate-pulse" />
              Receiving: <span className="text-foreground">{ws.lastFilename}</span>
              <span className="text-muted-foreground">— {eisData.length} / {expectedEisPoints} pts</span>
            </div>
          )}

          {eisData.length > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {(() => {
                const rs = randlesFit?.Rs ?? eisData[0]?.zReal ?? null;
                const rct = randlesFit?.Rct ?? null;
                const fLo = eisData[0]?.frequency;
                const fHi = eisData[eisData.length - 1]?.frequency;
                return [
                  { label: "Rs (Solution)", value: rs != null ? `${rs.toFixed(1)} Ω` : "—" },
                  { label: "Rct (Charge Transfer)", value: rct != null ? `${rct.toFixed(1)} Ω` : "—" },
                  {
                    label: "Freq Range",
                    value:
                      fLo != null && fHi != null
                        ? `${fLo.toFixed(1)} – ${fHi.toFixed(1)} Hz`
                        : "—",
                  },
                  { label: "Points", value: `${eisData.length}` },
                ];
              })().map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </Tabs>
        <div className="space-y-4">
          <SignalQuality mode="eis" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} />
          <CircuitFitResults fit={randlesFit} warburg={warburg} kk={kk} />
          <CalibrationPanel
            mode="eis"
            concentration={concentration}
            onChangeConcentration={handleChangeConcentration}
            points={eisCalibration}
            onClear={() => setEisCalibration([])}
            onExport={exportCalibrationCSV}
            currentRs={randlesFit?.Rs ?? liveEisParams?.rs}
            currentRct={randlesFit?.Rct ?? liveEisParams?.rct}
            geometricFallback={geometricFallback && eisStatus === "complete"}
          />
        </div>
        </div>
      )}

      {/* BIOFET MODE */}
      {mode === "fet" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Transfer Curve — Id vs Vg</h2>
              <StatusIndicator
                isRunning={isFETRunning && fetBaselineData.length > 0}
                label={isFETRunning && fetBaselineData.length > 0 ? "Sweeping Vg..." : "Idle"}
                dataPoints={fetBaselineData.length}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTransferPlot baseline={fetBaselineData} withAnalyte={fetAnalyteData} />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Time Response — Id vs Time</h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleAddFetMarker}
                  disabled={!isFETRunning && fetTimeDataArr.length === 0}
                  className="font-mono text-xs"
                >
                  ＋ Add Sample
                </Button>
                <StatusIndicator
                  isRunning={isFETRunning && fetTimeDataArr.length > 0}
                  label={isFETRunning && fetTimeDataArr.length > 0 ? "Recording..." : "Idle"}
                  dataPoints={fetTimeDataArr.length}
                />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTimePlot data={fetTimeDataArr} markers={fetMarkers} />
            </div>
            {fetMarkers.length > 0 && (
              <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                Markers: {fetMarkers.map((m) => `t=${m.time.toFixed(1)}s`).join(" · ")}
              </div>
            )}
          </div>

          <SweepProgress
            status={fetStatus}
            current={fetReceivedTotal}
            expected={expectedFetTotal}
            phases={[
              { label: "Baseline", current: fetBaselineData.length, expected: expectedFetTransferPoints },
              { label: "Analyte", current: fetAnalyteData.length, expected: expectedFetTransferPoints },
              { label: "Time response", current: fetTimeDataArr.length, expected: expectedFetTimePoints },
            ]}
          />

          {fetBaselineData.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(() => {
                const vtBase = computeFETVt(fetBaselineData);
                const vtShift =
                  liveFetVt != null && vtBase != null ? liveFetVt - vtBase : null;
                const baselineId =
                  fetBaselineData.length > 0
                    ? Math.min(...fetBaselineData.map((p) => p.id))
                    : null;
                const signalDrop =
                  fetAnalyteData.length > 0
                    ? Math.max(...fetAnalyteData.map((p) => p.id)) -
                      Math.min(...fetAnalyteData.map((p) => p.id))
                    : null;
                return [
                  { label: "Vth (Baseline)", value: vtBase != null ? `${vtBase.toFixed(3)} V` : "—" },
                  {
                    label: "Vth Shift",
                    value:
                      vtShift != null
                        ? `${vtShift >= 0 ? "+" : ""}${vtShift.toFixed(3)} V`
                        : "—",
                  },
                  { label: "Baseline Id", value: baselineId != null ? `${baselineId.toFixed(1)} µA` : "—" },
                  { label: "Signal Drop", value: signalDrop != null ? `${signalDrop.toFixed(1)} µA` : "—" },
                ];
              })().map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <SignalQuality mode="fet" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} />
          <CalibrationPanel
            mode="fet"
            concentration={concentration}
            onChangeConcentration={handleChangeConcentration}
            points={fetCalibration}
            onClear={() => setFetCalibration([])}
            onExport={exportCalibrationCSV}
            currentVt={liveFetVt ?? undefined}
          />
        </div>
        </div>
      )}

      <footer className="mt-8 text-center text-[10px] text-muted-foreground font-mono">
        HelpStat Biosensor v0.2 — {dataSource === "simulated" ? "Simulated Mode" : "Live Mode"} — ESP32-S3 WebSocket
      </footer>
    </div>
  );
};

export default Index;
