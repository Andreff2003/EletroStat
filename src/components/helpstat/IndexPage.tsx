import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import SWVMode, { type SWVController } from "@/components/helpstat/SWVMode";
import type { SWVParameters } from "@/types/swv";
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
import { useSimulatedCVData, CV_E0_PRIME } from "@/hooks/useSimulatedCVData";
import CVPlot from "@/components/CVPlot";
import type { CVDataPoint } from "@/hooks/useSimulatedCVData";
import { computeCVMetrics } from "@/utils/computeCVMetrics";
import {
  exportEISData,
  exportFETTransferData,
  exportFETTimeData,
  exportFETData,
  exportSessionCSV,
  exportCalibrationCSV as exportCalibrationTSV,
  exportCVData,
  exportCVCalibrationCSV,
} from "@/utils/csvExport";
import { useWebSocketData } from "@/hooks/useWebSocketData";
import ParametersPanel, {
  DEFAULT_EIS_PARAMS,
  DEFAULT_FET_PARAMS,
  DEFAULT_CV_PARAMS,
  type EISParams,
  type FETParams,
  type CVParams,
} from "@/components/ParametersPanel";
import CalibrationPanel, {
  type CalibrationPoint,
  computeEISParams,
  computeFETVt,
} from "@/components/CalibrationPanel";
import { computeFETVtDetailed } from "@/utils/fetVt";
import {
  computeFETTransferMetrics,
  inferFETResponseSign,
  applyFETResponseMode,
  type FETResponseMode,
} from "@/utils/fetMetrics";
import CVCalibrationPanel from "@/components/CVCalibrationPanel";
import MeasurementNotesPanel from "@/components/MeasurementNotesPanel";
import {
  buildCVCalibrationPoint,
  randlesSevcikIpUA,
  responseFor,
  type CVCalibrationPoint,
  type CVResponseMode,
} from "@/utils/cvCalibration";
import {
  createMeasurementId,
  sanitizeMeasurementNotes,
  shortNotesSummary,
  hasAnyNotes,
  type MeasurementNotes,
} from "@/utils/measurementNotes";
import { EXPECTED_FET_TIME_POINTS } from "@/utils/fetConstants";

import CNLSFitResults from "@/components/CNLSFitResults";
import {
  fitRandles,
  fitRandlesAuto,
  splitRegionsAuto,
  extractWarburgSlope,
  kramersKronigTest,
  type RandlesFitResult,
  type WarburgResult,
  type KKResult,
} from "@/utils/randlesFit";
import { linKKTest, type LinKKResult } from "@/utils/linKK";
import { fitEIS, type CircuitModel, type EISFitResult } from "@/utils/eisFit";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  loadSession,
  saveSession,
  clearSession,
  newId,
  type StoredMeasurement,
  type StoredEISMeasurement,
  type StoredFETMeasurement,
  type StoredCVMeasurement,
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

interface CVOverlayCurve {
  id: string;
  label: string;
  color: string;
  data: CVDataPoint[];
}

interface FETOverlayCurve {
  id: string;
  label: string;
  color: string;
  baseline: import("@/hooks/useSimulatedData").FETTransferPoint[];
  withAnalyte: import("@/hooks/useSimulatedData").FETTransferPoint[];
}

const Index = () => {
  const [mode, setMode] = useState<"eis" | "fet" | "cv" | "swv">("eis");
  const [dataSource, setDataSource] = useState<"simulated" | "live">("simulated");
  const [eisParams, setEisParams] = useState<EISParams>(DEFAULT_EIS_PARAMS);
  const [fetParams, setFetParams] = useState<FETParams>(DEFAULT_FET_PARAMS);
  const [cvParams, setCvParams] = useState<CVParams>(DEFAULT_CV_PARAMS);
  const [swvParams, setSwvParams] = useState<SWVParameters>({
    startE: -0.2, endE: 0.6, step_mV: 2, amplitude_mV: 25, frequency_Hz: 25,
    quietTime_s: 2, direction: "anodic", concentration_nM: 10, area_cm2: 0.0707,
    nElectrons: 1, temperature_K: 298.15, baselineMethod: "auto",
    smoothing: "none", model: "empirical_peak",
  });
  const [swvCtrl, setSwvCtrl] = useState<SWVController | null>(null);

  // Concentration & Calibration state (per mode)
  const [concentration, setConcentration] = useState<number>(0);
  const [eisCalibration, setEisCalibration] = useState<CalibrationPoint[]>([]);
  const [fetCalibration, setFetCalibration] = useState<CalibrationPoint[]>([]);
  const [cvCalibration, setCvCalibration] = useState<CVCalibrationPoint[]>([]);
  const [cvResponseMode, setCvResponseMode] = useState<CVResponseMode>("mean");
  const [fetResponseMode, setFetResponseMode] = useState<FETResponseMode>("auto");

  // Randles equivalent-circuit fit + Warburg slope (computed on sweep complete)
  const [randlesFit, setRandlesFit] = useState<RandlesFitResult | null>(null);
  const [warburg, setWarburg] = useState<WarburgResult | null>(null);
  const [kk, setKk] = useState<KKResult | null>(null);
  const [linKK, setLinKK] = useState<LinKKResult | null>(null);
  const [geometricFallback, setGeometricFallback] = useState(false);

  // Manual semicircle/Warburg separator (set after sweep completes)
  const [separatorZReal, setSeparatorZReal] = useState<number | null>(null);
  const [eisFitted, setEisFitted] = useState(false);

  // Scientific CNLS fit (Randles or Randles + CPE)
  const [circuitModel, setCircuitModel] = useState<CircuitModel>("randles");
  const [cnlsFit, setCnlsFit] = useState<EISFitResult | null>(null);


  // Overlay mode (Nyquist)
  const [overlayMode, setOverlayMode] = useState(false);
  const [eisOverlays, setEisOverlays] = useState<OverlayCurve[]>([]);

  // Overlay mode (CV)
  const [cvOverlayMode, setCvOverlayMode] = useState(false);
  const [cvOverlays, setCvOverlays] = useState<CVOverlayCurve[]>([]);

  // Overlay mode (BioFET)
  const [fetOverlayMode, setFetOverlayMode] = useState(false);
  const [fetOverlays, setFetOverlays] = useState<FETOverlayCurve[]>([]);
  const [cvPlotMode, setCvPlotMode] = useState<"raw" | "corrected">("raw");
  const [cvBaselineMethod, setCvBaselineMethod] = useState<
    "auto" | "none" | "linear-first-15" | "linear-edges"
  >("auto");
  const [cvShowBaseline, setCvShowBaseline] = useState(false);

  // Live CV state — separate from the simulated hook so the live ESP32 path
  // does not depend on cv.isRunning (which is tied to the simulator).
  const [isLiveCVRunning, setIsLiveCVRunning] = useState(false);

  // ──────────────────────────────────────────────────────────────
  // CV Logbook / Notes — pure metadata. Never sent to hardware,
  // never influences solver / baseline / metrics.
  // ──────────────────────────────────────────────────────────────
  const [cvNotes, setCvNotes] = useState<MeasurementNotes>({});
  const [cvPreviousNotes, setCvPreviousNotes] = useState<MeasurementNotes | null>(null);
  // IDs/timestamps minted on the client to avoid SSR/CSR hydration mismatches.
  const [cvMeasurementId, setCvMeasurementId] = useState<string>("");
  const [cvMeasurementTimestamp, setCvMeasurementTimestamp] = useState<number>(0);

  // EIS Logbook
  const [eisNotes, setEisNotes] = useState<MeasurementNotes>({});
  const [eisPreviousNotes, setEisPreviousNotes] = useState<MeasurementNotes | null>(null);
  const [eisMeasurementId, setEisMeasurementId] = useState<string>("");
  const [eisMeasurementTimestamp, setEisMeasurementTimestamp] = useState<number>(0);

  // BioFET Logbook
  const [fetNotes, setFetNotes] = useState<MeasurementNotes>({});
  const [fetPreviousNotes, setFetPreviousNotes] = useState<MeasurementNotes | null>(null);
  const [fetMeasurementId, setFetMeasurementId] = useState<string>("");
  const [fetMeasurementTimestamp, setFetMeasurementTimestamp] = useState<number>(0);

  useEffect(() => {
    const now = Date.now();
    setCvMeasurementId((v) => v || createMeasurementId("cv"));
    setCvMeasurementTimestamp((v) => v || now);
    setEisMeasurementId((v) => v || createMeasurementId("eis"));
    setEisMeasurementTimestamp((v) => v || now);
    setFetMeasurementId((v) => v || createMeasurementId("fet"));
    setFetMeasurementTimestamp((v) => v || now);
  }, []);

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
  const cv = useSimulatedCVData(40);

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
  const expectedFetTimePoints = EXPECTED_FET_TIME_POINTS;
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

  // Shared EIS completion logic — used by both count-based and inactivity-based triggers.
  // NOTE: fitting is NOT run here. The user drags the separator then clicks "Fit Randles Circuit".
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
    toast.success(`Sweep complete — ${finalData.length} points collected. Auto-fit ready; drag the separator and click Fit to refine.`);

    // Auto-detect semicircle/Warburg split & seed the default separator with it.
    let defaultSep: number | null = null;
    let autoSemiCircle: typeof finalData = finalData;
    if (finalData.length > 0) {
      const split = splitRegionsAuto(finalData);
      autoSemiCircle = split.semicircle.length >= 5 ? split.semicircle : finalData;
      if (split.separatorZReal != null) {
        defaultSep = split.separatorZReal;
      } else {
        // Fallback: zReal at point of minimum |zImag| (right side of semicircle).
        let minIdx = 0;
        for (let i = 1; i < finalData.length; i++) {
          if (Math.abs(finalData[i].zImag) < Math.abs(finalData[minIdx].zImag)) minIdx = i;
        }
        const maxZ = Math.max(...finalData.map(d => d.zReal));
        const candidate = finalData[minIdx].zReal;
        defaultSep = Number.isFinite(candidate) ? candidate : maxZ * 0.6;
      }
    }
    setSeparatorZReal(defaultSep);
    setEisFitted(false);

    // Automatic Randles CNLS fit (same math as manual CNLS panel).
    const autoFit = finalData.length >= 5 ? fitRandlesAuto(finalData) : null;
    const autoWb  = extractWarburgSlope(
      defaultSep != null ? finalData.filter(d => d.frequency < autoSemiCircle.reduce(
        (min, d) => Math.min(min, d.frequency), Infinity)) : [],
    );
    // KK on semicircle region only — Warburg tail causes false KK failures.
    const autoKk  = kramersKronigTest(autoSemiCircle);
    // Lin-KK runs on the FULL spectrum — it is KK-compliant by construction
    // and provides a rigorous data-consistency check independent of the
    // chosen equivalent circuit.
    const autoLinKK = linKKTest(finalData);
    setRandlesFit(autoFit);
    setWarburg(autoWb);
    setKk(autoKk);
    setLinKK(autoLinKK);
    setCnlsFit(null);
    setGeometricFallback(autoFit == null || autoFit.fitErrorPct === -1);
    if (autoFit?.separatorUncertain) {
      toast.warning(autoFit.separatorWarning ?? "Automatic separator uncertain — adjust manually.");
    }

    const params = computeEISParams(finalData);
    logActivity(
      "measurement",
      `EIS completed — concentration=${concentration} nM, points=${finalData.length} · auto-fit saved; manual re-fit available`,
    );

    const rctForCalib = params?.rct ?? 0;
    const rsForCalib = params?.rs ?? 0;
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
      const cleanEisNotes = sanitizeMeasurementNotes(eisNotes);
      const autoConverged = autoFit != null && autoFit.fitErrorPct !== -1;
      const autoFitErrorPct = autoConverged
        ? autoFit!.chiSquared != null
          ? Math.sqrt(Math.max(autoFit!.chiSquared, 0)) * 100
          : autoFit!.fitErrorPct
        : undefined;
      const stored: StoredEISMeasurement = {
        id: newId(),
        mode: "eis",
        timestamp: Date.now(),
        concentration,
        measurementId: eisMeasurementId,
        measurementTimestamp: eisMeasurementTimestamp,
        notes: cleanEisNotes,
        params: {
          freqMin: eisParams.freqMin,
          freqMax: eisParams.freqMax,
          points: eisParams.points,
          amplitude: eisParams.amplitude,
        },
        data: finalData.slice(),
        extracted: autoConverged
          ? {
              Rs: autoFit!.Rs,
              Rct: autoFit!.Rct,
              Cdl: autoFit!.Cdl,
              Aw: autoWb?.Aw ?? autoFit!.Aw,
              warburgAw: autoWb?.Aw,
              warburgSlope: autoWb?.slope,
              warburgR2: autoWb?.r2Imag,
              warburgIntercept: autoWb?.interceptImag,
              warburgMethod: autoWb?.method ?? "regression_1_sqrt_omega_with_intercept",
              fitErrorPct: autoFitErrorPct,
              f0: autoFit!.f0,
              kkResidualPct: autoKk?.residualPct,
              kkPassed: autoKk?.passed,
              kkMethod: autoKk?.method ?? "approximate_residual",
              fitConverged: true,
              geometricFallback: false,
              warnFlags: [
                ...(autoFit!.warnFlags ?? []),
                ...(autoWb?.warnings ?? (autoWb?.warburgWarning ? [autoWb.warburgWarning] : [])),
              ],
              fitModel: "randles",
              fitSource: "auto_cnls_randles",
              weightedSsrPerDof: autoFit!.chiSquared,
              rmseWeightedPercent: autoFitErrorPct,
              fitRangeMinHz: autoFit!.fitFreqRange?.min,
              fitRangeMaxHz: autoFit!.fitFreqRange?.max,
              covarianceMethod: "log_space",
              linKKPassed: autoLinKK?.passed,
              linKKRmsResidualPct: autoLinKK?.residualRmsPct,
              linKKMaxResidualPct: autoLinKK?.maxResidualPct,
              linKKTauCount: autoLinKK?.tauCount,
              linKKNegativeRkCount: autoLinKK?.negativeRkCount,
              linKKNegativeRkPct: autoLinKK?.negativeRkPct,
              approxKkInformationalOnly: true,
            }
          : {
              Rs: rsForCalib,
              Rct: rctForCalib,
              fitConverged: false,
              geometricFallback: true,
              fitSource: "geometric_fallback",
              linKKPassed: autoLinKK?.passed,
              linKKRmsResidualPct: autoLinKK?.residualRmsPct,
              linKKMaxResidualPct: autoLinKK?.maxResidualPct,
              linKKTauCount: autoLinKK?.tauCount,
              linKKNegativeRkCount: autoLinKK?.negativeRkCount,
              linKKNegativeRkPct: autoLinKK?.negativeRkPct,
              approxKkInformationalOnly: true,
            },
      };

      if (hasAnyNotes(cleanEisNotes)) setEisPreviousNotes(cleanEisNotes!);
      setSessionMeasurements((prev) => [...prev, stored]);
    } catch (err) {
      console.warn("Session store failed", err);
    }
  };

  // Run the Randles fit on the user-selected semicircle region.
  const handleFitRandles = () => {
    if (separatorZReal == null) return;
    const finalData = frozenEis ?? eisData;
    // Filter by frequency — NOT by zReal.
    // The Warburg tail can fold back to lower zReal values, so zReal-based
    // filtering includes Warburg points in the semicircle region.
    // The separator zReal value corresponds to a specific frequency point;
    // find that frequency and split there.
    const sepPoint = finalData.reduce((best, d) =>
      Math.abs(d.zReal - separatorZReal) < Math.abs(best.zReal - separatorZReal) ? d : best,
      finalData[0]
    );
    const sepFreq = sepPoint.frequency;
    const semi = finalData.filter(d => d.frequency >= sepFreq);
    const warb = finalData.filter(d => d.frequency <  sepFreq);
    if (semi.length < 5) {
      toast.error(`Semicircle region has only ${semi.length} pts — need at least 5. Move the separator right.`);
      return;
    }
    const fit = fitRandles(semi, finalData);
    const wb = extractWarburgSlope(warb);
    // KK test on semicircle region only — the Warburg tail causes false failures
    // because the discrete Hilbert transform is unreliable at low frequencies.
    const kkRes = kramersKronigTest(semi.length >= 5 ? semi : finalData);
    const linKKRes = linKKTest(finalData);
    const cnls = fitEIS(semi, circuitModel, finalData);
    setRandlesFit(fit);
    setWarburg(wb);
    setKk(kkRes);
    setLinKK(linKKRes);
    setCnlsFit(cnls);
    const fitConverged = fit != null && fit.fitErrorPct !== -1;
    setGeometricFallback(!fitConverged);
    setEisFitted(true);

    const rctForCalib = cnls?.params.Rct ?? fit?.Rct ?? 0;
    if (rctForCalib > 0) {
      const baseline = eisCalibration.find((p) => p.concentration === 0);
      const deltaRct =
        concentration === 0 ? 0 : rctForCalib - (baseline?.raw ?? rctForCalib);
      // Replicates allowed — never replace points at the same concentration.
      // Multiple measurements at the same concentration (including blanks)
      // are required for LOD/LOQ statistics and repeatability assessment.
      setEisCalibration((prev) => [
        ...prev,
        {
          concentration,
          signal: deltaRct,
          raw: rctForCalib,
          timestamp: Date.now(),
          measurementId: eisMeasurementId,
          sampleId: eisNotes.sampleId,
          electrodeId: eisNotes.electrodeId,
          notesShort: shortNotesSummary(eisNotes)?.slice(0, 80),
        },
      ]);
    }
    const wssrStr = cnls ? cnls.chiSquared.toExponential(2) : "n/a";
    logActivity(
      "measurement",
      `CNLS fit (${circuitModel}) — Rct=${rctForCalib.toFixed(1)} Ω, wSSR/dof=${wssrStr}, semi=${semi.length} pts`,
    );

    // ── Update the existing session measurement (same measurementId) so the
    // session export reflects the FINAL fit instead of the initial geometric
    // estimate. Never create a duplicate.
    setSessionMeasurements((prev) => {
      const idx = prev.findIndex(
        (m) => m.mode === "eis" && (m as StoredEISMeasurement).measurementId === eisMeasurementId,
      );
      if (idx < 0) return prev;
      const target = prev[idx] as StoredEISMeasurement;
      const fitErrorPct = cnls ? Math.sqrt(Math.max(cnls.chiSquared, 0)) * 100 : fit?.fitErrorPct;
      // f0 model-aware: Randles vs Randles-CPE.
      let f0: number | undefined = fit?.f0;
      if (cnls) {
        const Rct = cnls.params.Rct;
        if (circuitModel === "randles-cpe") {
          const Q = cnls.params.Q;
          const nCpe = cnls.params.n;
          if (Rct && Q && nCpe && nCpe > 0) f0 = Math.pow(Rct * Q, -1 / nCpe) / (2 * Math.PI);
        } else {
          const Cdl = cnls.params.Cdl;
          if (Rct && Cdl) f0 = 1 / (2 * Math.PI * Rct * Cdl);
        }
      }
      const fitSource: NonNullable<StoredEISMeasurement["extracted"]["fitSource"]> =
        cnls
          ? circuitModel === "randles-cpe"
            ? "manual_cnls_randles_cpe"
            : "manual_cnls_randles"
          : fit
            ? "manual_randles"
            : "geometric";
      const updated: StoredEISMeasurement = {
        ...target,
        extracted: {
          ...target.extracted,
          Rs: cnls?.params.Rs ?? fit?.Rs ?? target.extracted.Rs,
          Rct: cnls?.params.Rct ?? fit?.Rct ?? target.extracted.Rct,
          Cdl: cnls?.params.Cdl ?? fit?.Cdl ?? target.extracted.Cdl,
          Q: cnls?.params.Q,
          n: cnls?.params.n,
          Aw: wb?.Aw ?? fit?.Aw ?? target.extracted.Aw,
          warburgAw: wb?.Aw,
          warburgSlope: wb?.slope,
          warburgR2: wb?.r2Imag,
          warburgIntercept: wb?.interceptImag,
          warburgMethod: wb?.method ?? "regression_1_sqrt_omega_with_intercept",
          fitErrorPct,
          f0,
          kkResidualPct: kkRes?.residualPct,
          kkPassed: kkRes?.passed,
          kkMethod: kkRes?.method ?? "approximate_residual",
          fitConverged: cnls ? cnls.converged : (fit ? fit.fitErrorPct !== -1 : false),
          geometricFallback: !cnls && !(fit && fit.fitErrorPct !== -1),
          warnFlags: [
            ...(cnls?.warnings ?? []),
            ...(fit?.warnFlags ?? []),
            ...(wb?.warnings ?? (wb?.warburgWarning ? [wb.warburgWarning] : [])),
          ],
          fitModel: cnls ? circuitModel : undefined,
          fitSource,
          weightedSsrPerDof: cnls?.chiSquared,
          rmseWeightedPercent: cnls ? Math.sqrt(Math.max(cnls.chiSquared, 0)) * 100 : undefined,
          fitRangeMinHz: cnls?.fitFreqRange?.min,
          fitRangeMaxHz: cnls?.fitFreqRange?.max,
          covarianceWarning: cnls?.covarianceWarning,
          covarianceMethod: cnls?.covarianceMethod ?? "log_space",
          extrapolationPresent: cnls?.extrapolationPresent,
          linKKPassed: linKKRes?.passed,
          linKKRmsResidualPct: linKKRes?.residualRmsPct,
          linKKMaxResidualPct: linKKRes?.maxResidualPct,
          linKKTauCount: linKKRes?.tauCount,
          linKKNegativeRkCount: linKKRes?.negativeRkCount,
          linKKNegativeRkPct: linKKRes?.negativeRkPct,
          approxKkInformationalOnly: true,
        },
      };

      const next = prev.slice();
      next[idx] = updated;
      return next;
    });

    toast.success(`Fit complete — Rct = ${rctForCalib.toFixed(1)} Ω · wSSR/dof = ${wssrStr}`);
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
    // Vt + ΔVt + Ion/Ioff + SS + stability from THIS measurement, via the
    // centralised helper so UI/session/CSV/calibration all agree.
    const priorSigned = fetCalibration
      .filter((p) => p.concentration > 0 && typeof p.deltaVt_mV_signed === "number")
      .map((p) => p.deltaVt_mV_signed as number);
    const inferredSign = inferFETResponseSign(priorSigned);
    const metrics = computeFETTransferMetrics(finalBaseline, finalAnalyte, {
      responseMode: fetResponseMode,
      responseSign: inferredSign,
    });
    const vt = metrics.vtAnalyte;
    const vtBaseline = metrics.vtBaseline;
    const deltaVt_mV = metrics.deltaVt_mV;
    const deltaVt_mV_signed = metrics.deltaVt_mV_signed;
    const calibrationSignal_mV_used = metrics.calibrationSignal_mV_used;
    logActivity(
      "measurement",
      `BioFET completed — concentration=${concentration} nM, Vt=${
        vt != null ? vt.toFixed(3) : "n/a"
      } V, ΔVt=${deltaVt_mV != null ? deltaVt_mV.toFixed(1) + " mV" : "n/a"} (${metrics.vtMethod}; mode=${fetResponseMode})`,
    );
    if (vt != null && vtBaseline != null && deltaVt_mV != null) {
      setFetCalibration((prev) => [
        ...prev,
        {
          concentration,
          // For Langmuir fit consumption: use calibrationSignal_mV_used when
          // present (sign already aligned), else fall back to signed ΔVt.
          signal: calibrationSignal_mV_used ?? deltaVt_mV,
          raw: vt,
          timestamp: Date.now(),
          measurementId: fetMeasurementId,
          sampleId: fetNotes.sampleId,
          electrodeId: fetNotes.electrodeId,
          notesShort: shortNotesSummary(fetNotes)?.slice(0, 80),
          deltaVt_mV_signed: deltaVt_mV_signed ?? undefined,
          calibrationSignal_mV_used: calibrationSignal_mV_used ?? undefined,
          responseMode: fetResponseMode,
          responseSign: metrics.responseSign,
          vtBaseline: vtBaseline ?? undefined,
          vtAnalyte: vt ?? undefined,
          vtMethod: metrics.vtMethod,
          vtFitR2: metrics.vtFitR2 ?? null,
          vtRegionPoints: metrics.vtRegionPoints,
          vtWarning: metrics.vtWarning,
        },
      ]);
    } else {
      toast.warning("ΔVt unavailable — baseline/analyte Vt extraction failed");
    }
    const cleanFetNotes = sanitizeMeasurementNotes(fetNotes);
    const storedFet: StoredFETMeasurement = {
      id: newId(),
      mode: "fet",
      timestamp: Date.now(),
      concentration,
      measurementId: fetMeasurementId,
      measurementTimestamp: fetMeasurementTimestamp,
      notes: cleanFetNotes,
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
      extracted: {
        Vt: vt ?? undefined,
        vtBaseline: vtBaseline ?? undefined,
        vtAnalyte: vt ?? undefined,
        deltaVt_mV: deltaVt_mV ?? undefined,
        deltaVt_mV_signed: deltaVt_mV_signed ?? undefined,
        calibrationSignal_mV_used: calibrationSignal_mV_used ?? undefined,
        vtMethod: metrics.vtMethod,
        vtFitR2: metrics.vtFitR2 ?? undefined,
        vtRegionPoints: metrics.vtRegionPoints,
        vtIoffUsed: metrics.vtIoffUsed,
        vtWarning: metrics.vtWarning,
        vtBaselineMethod: metrics.vtBaselineMethod,
        vtBaselineFitR2: metrics.vtBaselineFitR2 ?? undefined,
        vtBaselineRegionPoints: metrics.vtBaselineRegionPoints,
        vtBaselineIoffUsed: metrics.vtBaselineIoffUsed,
        vtBaselineWarning: metrics.vtBaselineWarning,
        vtAnalyteMethod: metrics.vtAnalyteMethod,
        vtAnalyteFitR2: metrics.vtAnalyteFitR2 ?? undefined,
        vtAnalyteRegionPoints: metrics.vtAnalyteRegionPoints,
        vtAnalyteIoffUsed: metrics.vtAnalyteIoffUsed,
        vtAnalyteWarning: metrics.vtAnalyteWarning,
        ion_uA: metrics.ion_uA,
        ioff_uA: metrics.ioff_uA,
        ionIoffRatio: metrics.ionIoffRatio,
        subthresholdSlope_mV_dec: metrics.subthresholdSlope_mV_dec,
        baselineStabilityNoisePct: metrics.baselineStabilityNoisePct,
        responseMode: fetResponseMode,
        responseSign: metrics.responseSign,
      },
    };
    if (hasAnyNotes(cleanFetNotes)) setFetPreviousNotes(cleanFetNotes!);
    setSessionMeasurements((prev) => [...prev, storedFet]);
  };

  const handleStartEIS = () => {
    eisAutoStopFiredRef.current = false;
    setFrozenEis(null);
    setRandlesFit(null);
    setWarburg(null);
    setKk(null);
    setCnlsFit(null);
    setGeometricFallback(false);
    setSeparatorZReal(null);
    setEisFitted(false);
    setEisStatus("running");
    setEisMeasurementId(createMeasurementId("eis"));
    setEisMeasurementTimestamp(Date.now());
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
    setCnlsFit(null);
    setGeometricFallback(false);
    setSeparatorZReal(null);
    setEisFitted(false);
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
    setFetMeasurementId(createMeasurementId("fet"));
    setFetMeasurementTimestamp(Date.now());
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

  // Live CV — react to cv_done / cv_error from ESP32.
  useEffect(() => {
    if (dataSource !== "live") return;
    if (ws.cvStatus === "done" || ws.cvStatus === "error" || ws.cvStatus === "idle") {
      setIsLiveCVRunning(false);
      if (ws.cvStatus === "error" && ws.cvError) {
        toast.error(`CV error: ${ws.cvError}`);
      }
    }
    if (ws.cvStatus === "running") setIsLiveCVRunning(true);
  }, [ws.cvStatus, ws.cvError, dataSource]);

  // ─── CV auto-save: persist the completed sweep as a StoredCVMeasurement
  // exactly once per measurementId. Mirrors EIS/FET completion flow.
  const cvSavedIdRef = useRef<string | null>(null);
  const cvWasRunningRef = useRef(false);
  useEffect(() => {
    const isCVRunning = dataSource === "simulated" ? cv.isRunning : isLiveCVRunning;
    const cvDataLive = dataSource === "simulated" ? cv.data : ws.cvData;
    // Detect transition true → false with sufficient data.
    const justFinished = cvWasRunningRef.current && !isCVRunning;
    cvWasRunningRef.current = isCVRunning;
    if (!justFinished) return;
    if (!cvMeasurementId) return;
    if (cvSavedIdRef.current === cvMeasurementId) return;
    if (cvDataLive.length < 3) return;
    const metrics = computeCVMetrics(cvDataLive, {
      scanRate_mVs: cvParams.scanRate,
      n: cvParams.n,
      cMM: cvParams.cMM,
      areaCm2: cvParams.areaCm2,
      baselineMethodInput: cvBaselineMethod,
    });
    const cleanNotes = sanitizeMeasurementNotes(cvNotes);
    const storedCv: StoredCVMeasurement = {
      id: newId(),
      mode: "cv",
      timestamp: Date.now(),
      concentration: cvParams.cMM,
      measurementId: cvMeasurementId,
      measurementTimestamp: cvMeasurementTimestamp,
      notes: cleanNotes,
      params: { ...cvParams },
      data: cvDataLive.slice(),
      metrics: metrics ?? null,
    };
    cvSavedIdRef.current = cvMeasurementId;
    if (hasAnyNotes(cleanNotes)) setCvPreviousNotes(cleanNotes!);
    setSessionMeasurements((prev) => [...prev, storedCv]);
    logActivity(
      "measurement",
      `CV measurement saved — id=${cvMeasurementId}, pts=${cvDataLive.length}, C=${cvParams.cMM} mM`,
    );
  }, [
    dataSource, cv.isRunning, cv.data, isLiveCVRunning, ws.cvData,
    cvMeasurementId, cvMeasurementTimestamp, cvParams, cvBaselineMethod, cvNotes,
  ]);

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
  const liveFetVtBaseline = useMemo(() => computeFETVt(sqFetBaseline), [sqFetBaseline]);

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
    setCvCalibration([]);
      setCvOverlays([]);
    toast("Session cleared");
  };

  // Export calibration table as TSV
  const exportCalibrationCSV = () => {
    if (mode === "cv" || mode === "swv") return;
    const list = mode === "eis" ? eisCalibration : fetCalibration;
    if (list.length === 0) return;
    exportCalibrationTSV(mode, list, dataSource);
  };

  const handleChangeSource = (source: "simulated" | "live") => {
    // Reset everything when switching
    eis.reset();
    fetTransfer.reset();
    fetTime.reset();
    cv.reset();
    ws.clearCV();
    setIsLiveCVRunning(false);
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
          cvParams={cvParams}
          swvParams={swvParams}
          onChangeEIS={setEisParams}
          onChangeFET={setFetParams}
          onChangeCV={setCvParams}
          onChangeSWV={setSwvParams}
          disabled={
            mode === "eis" ? isEISRunning :
            mode === "fet" ? isFETRunning :
            mode === "swv" ? (swvCtrl?.isRunning ?? false) :
            (dataSource === "simulated" ? cv.isRunning : isLiveCVRunning)
          }
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
          <Button
            variant={mode === "cv" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("cv")}
            className="font-mono text-xs"
          >
            CV Mode
          </Button>
          <Button
            variant={mode === "swv" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("swv")}
            className="font-mono text-xs"
          >
            SWV Mode
          </Button>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          {mode === "eis" && (
            <>
              <Button size="sm" onClick={handleStartEIS} disabled={isEISRunning || (dataSource === "live" && ws.status !== "connected")} className="font-mono text-xs">▶ Start EIS</Button>
              <Button size="sm" variant="destructive" onClick={handleStopEIS} disabled={!isEISRunning} className="font-mono text-xs">■ Stop</Button>
              <Button size="sm" variant="secondary" onClick={handleResetEIS} className="font-mono text-xs">↺ Reset</Button>
              <Button size="sm" variant="outline" onClick={() => exportEISData(eisData, dataSource, {
                notes: sanitizeMeasurementNotes(eisNotes),
                measurementId: eisMeasurementId,
                measurementTimestamp: eisMeasurementTimestamp,
                cnlsFit,
                randlesFit,
                linKK,
                warburg,
                fitRangeMinHz: cnlsFit?.fitFreqRange?.min ?? randlesFit?.fitFreqRange?.min,
                fitRangeMaxHz: cnlsFit?.fitFreqRange?.max ?? randlesFit?.fitFreqRange?.max,
                fitSource: cnlsFit ? (circuitModel === "randles-cpe" ? "manual_cnls_randles_cpe" : "manual_cnls_randles") : randlesFit?.auto ? "auto_cnls_randles" : randlesFit ? "manual_randles" : "geometric",
              })} disabled={eisData.length === 0} className="font-mono text-xs">⬇ Export CSV</Button>
            </>
          )}
          {mode === "fet" && (
            <>
              <Button size="sm" onClick={handleStartFET} disabled={isFETRunning || (dataSource === "live" && ws.status !== "connected")} className="font-mono text-xs">▶ Start FET</Button>
              <Button size="sm" variant="destructive" onClick={handleStopFET} disabled={!isFETRunning} className="font-mono text-xs">■ Stop</Button>
              <Button size="sm" variant="secondary" onClick={handleResetFET} className="font-mono text-xs">↺ Reset</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const meta = { notes: sanitizeMeasurementNotes(fetNotes), measurementId: fetMeasurementId, measurementTimestamp: fetMeasurementTimestamp };
                  const priorSigned = fetCalibration
                    .filter((p) => p.concentration > 0 && typeof p.deltaVt_mV_signed === "number")
                    .map((p) => p.deltaVt_mV_signed as number);
                  const sign = inferFETResponseSign(priorSigned);
                  const m = computeFETTransferMetrics(fetBaselineData, fetAnalyteData, {
                    responseMode: fetResponseMode,
                    responseSign: sign,
                  });
                  exportFETData({
                    baseline: fetBaselineData,
                    analyte: fetAnalyteData,
                    timeData: fetTimeDataArr,
                    markers: fetMarkers,
                    source: dataSource,
                    meta,
                    concentration,
                    params: {
                      vgMin: fetParams.vgMin,
                      vgMax: fetParams.vgMax,
                      vgStep: fetParams.vgStep,
                      intervalMs: fetParams.intervalMs,
                    },
                    metrics: m,
                    responseMode: fetResponseMode,
                    responseSign: m.responseSign,
                  });
                }}
                disabled={fetBaselineData.length === 0 && fetTimeDataArr.length === 0}
                className="font-mono text-xs"
              >⬇ Export CSV</Button>
            </>
          )}
          {mode === "cv" && (
            <>
              <Button
                size="sm"
                onClick={() => {
                  // Mint a fresh measurement id + timestamp for this sweep.
                  // Notes already on screen ride along with this measurement.
                  setCvMeasurementId(createMeasurementId("cv"));
                  setCvMeasurementTimestamp(Date.now());
                  if (dataSource === "simulated") {
                    cv.start(cvParams);
                  } else {
                    ws.clearCV();
                    setIsLiveCVRunning(true);
                    ws.sendCommand("start_cv", { ...cvParams });
                  }
                }}
                disabled={
                  (dataSource === "simulated" ? cv.isRunning : isLiveCVRunning) ||
                  (dataSource === "live" && ws.status !== "connected")
                }
                className="font-mono text-xs"
              >▶ Start CV</Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (dataSource === "simulated") cv.stop();
                  else { setIsLiveCVRunning(false); ws.sendCommand("stop"); }
                }}
                disabled={dataSource === "simulated" ? !cv.isRunning : !isLiveCVRunning}
                className="font-mono text-xs"
              >■ Stop</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  cv.reset(); ws.clearCV(); setIsLiveCVRunning(false);
                }}
                className="font-mono text-xs"
              >↺ Reset</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const data = dataSource === "simulated" ? cv.data : ws.cvData;
                  const metrics = computeCVMetrics(data, {
                    scanRate_mVs: cvParams.scanRate,
                    n: cvParams.n,
                    cMM: cvParams.cMM,
                    areaCm2: cvParams.areaCm2,
                    baselineMethodInput: cvBaselineMethod,
                  });
                  const cleanNotes = sanitizeMeasurementNotes(cvNotes);
                  exportCVData(
                    data,
                    metrics,
                    {
                      ...cvParams,
                      notes: cleanNotes,
                      measurementId: cvMeasurementId,
                      measurementTimestamp: cvMeasurementTimestamp,
                    },
                    dataSource,
                    cvPlotMode,
                  );
                }}
                disabled={(dataSource === "simulated" ? cv.data.length : ws.cvData.length) === 0}
                className="font-mono text-xs"
              >⬇ Export CSV</Button>
            </>
          )}
          {mode === "swv" && (
            <>
              <Button size="sm" onClick={() => swvCtrl?.start()} disabled={!swvCtrl || swvCtrl.isRunning || (dataSource === "live" && ws.status !== "connected")} className="font-mono text-xs">▶ Start SWV</Button>
              <Button size="sm" variant="destructive" onClick={() => swvCtrl?.stop()} disabled={!swvCtrl?.isRunning} className="font-mono text-xs">■ Stop</Button>
              <Button size="sm" variant="secondary" onClick={() => swvCtrl?.reset()} className="font-mono text-xs">↺ Reset</Button>
              <Button size="sm" variant="outline" onClick={() => swvCtrl?.exportCsv()} disabled={!swvCtrl?.hasData} className="font-mono text-xs">⬇ Export CSV</Button>
              <Button size="sm" variant="outline" onClick={() => swvCtrl?.addCalibration()} disabled={!swvCtrl?.hasData} className="font-mono text-xs">+ Calibration Point</Button>
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
                variant="outline"
                onClick={() => {
                  if (eisData.length === 0) return;
                  setEisOverlays((prev) => {
                    const label =
                      concentration > 0 ? `${concentration} nM` : `Measurement ${prev.length + 1}`;
                    const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length];
                    const next = [
                      ...prev,
                      { id: newId(), label, color, data: eisData.slice() },
                    ];
                    return next.length > 8 ? next.slice(next.length - 8) : next;
                  });
                }}
                disabled={eisData.length === 0}
                className="font-mono text-xs"
              >＋ Capture</Button>
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
            <TabsContent value="nyquist" className="mt-0 h-[440px] md:h-[540px]">
              <NyquistPlot
                data={eisData}
                fittedCurve={cnlsFit?.fittedCurve ?? randlesFit?.fittedCurve}
                overlays={eisOverlays}
                showSeparator={eisStatus === "complete" && separatorZReal != null}
                separatorZReal={separatorZReal}
                onSeparatorChange={(v) => setSeparatorZReal(v)}
              />
            </TabsContent>
            <TabsContent value="bode" className="mt-0 h-[400px] md:h-[500px]">
              <BodePlot data={eisData} />
            </TabsContent>
          </div>

          {eisStatus === "complete" && separatorZReal != null && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-mono text-muted-foreground">
                {eisFitted
                  ? "Fit applied. Adjust separator or model and click Re-fit."
                  : "Sweep complete. Choose a circuit, adjust the separator, then click Fit."}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={circuitModel}
                  onValueChange={(v) => setCircuitModel(v as CircuitModel)}
                >
                  <SelectTrigger className="h-8 w-[210px] font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="randles" className="font-mono text-xs">
                      Randles (Rs + Rct ∥ Cdl)
                    </SelectItem>
                    <SelectItem value="randles-cpe" className="font-mono text-xs">
                      Randles + CPE
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleFitRandles}
                  className="font-mono text-xs"
                >
                  {eisFitted ? "↻ Re-fit" : "▶ Fit Circuit"}
                </Button>
              </div>
            </div>
          )}

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
                // Prefer CNLS fit result over auto Randles fit
                const rs = cnlsFit?.params?.Rs ?? randlesFit?.Rs ?? eisData[0]?.zReal ?? null;
                const rct = cnlsFit?.params?.Rct ?? randlesFit?.Rct ?? null;
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
          <SignalQuality mode="eis" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} cnlsChiSquared={cnlsFit?.chiSquared ?? null} separatorZReal={separatorZReal} separatorFreq={(() => { if (separatorZReal == null || sqEisData.length === 0) return null; const c = sqEisData.reduce((b, d) => Math.abs(d.zReal - separatorZReal) < Math.abs(b.zReal - separatorZReal) ? d : b, sqEisData[0]); return c.frequency; })()} linKKResidualPct={linKK?.residualRmsPct ?? null} linKKPassed={linKK?.passed ?? null} />
          <CNLSFitResults fit={cnlsFit} model={circuitModel} randlesFit={randlesFit} warburg={warburg} kk={kk} linKK={linKK} />
          <MeasurementNotesPanel
            mode="eis"
            value={eisNotes}
            onChange={setEisNotes}
            onClear={() => {
              setEisPreviousNotes(hasAnyNotes(eisNotes) ? eisNotes : eisPreviousNotes);
              setEisNotes({});
            }}
            onCopyFromPrevious={
              eisPreviousNotes ? () => setEisNotes({ ...eisPreviousNotes }) : undefined
            }
            hasPrevious={!!eisPreviousNotes}
            measurementId={eisMeasurementId}
            measurementTimestamp={eisMeasurementTimestamp}
          />
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
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Transfer Curve — Id vs Vg</h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={fetOverlayMode ? "default" : "outline"}
                  onClick={() => setFetOverlayMode((v) => !v)}
                  className="font-mono text-xs"
                >
                  Overlay {fetOverlayMode ? "ON" : "OFF"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (fetBaselineData.length === 0) return;
                    setFetOverlays((prev) => {
                      const label =
                        concentration > 0 ? `${concentration} nM` : `Measurement ${prev.length + 1}`;
                      const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length];
                      const next = [
                        ...prev,
                        {
                          id: newId(),
                          label,
                          color,
                          baseline: fetBaselineData.slice(),
                          withAnalyte: fetAnalyteData.slice(),
                        },
                      ];
                      return next.length > 8 ? next.slice(next.length - 8) : next;
                    });
                  }}
                  disabled={fetBaselineData.length === 0}
                  className="font-mono text-xs"
                >＋ Capture</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFetOverlays([])}
                  disabled={fetOverlays.length === 0}
                  className="font-mono text-xs"
                >Clear ({fetOverlays.length})</Button>
                <StatusIndicator
                  isRunning={isFETRunning && fetBaselineData.length > 0}
                  label={isFETRunning && fetBaselineData.length > 0 ? "Sweeping Vg..." : "Idle"}
                  dataPoints={fetBaselineData.length}
                />
              </div>
            </div>
            {fetOverlayMode && fetOverlays.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 text-[10px] font-mono">
                {fetOverlays.map((ov) => (
                  <span
                    key={ov.id}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5"
                  >
                    <span style={{ background: ov.color, width: 8, height: 8, borderRadius: 999 }} />
                    {ov.label}
                    <button
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => setFetOverlays((prev) => prev.filter((p) => p.id !== ov.id))}
                      title="Remove overlay"
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTransferPlot
                baseline={fetBaselineData}
                withAnalyte={fetAnalyteData}
                overlays={fetOverlayMode ? fetOverlays : []}
              />
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
          <SignalQuality mode="fet" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} fetVtBaseline={liveFetVtBaseline} fetVtAnalyte={liveFetVt} />
          <MeasurementNotesPanel
            mode="fet"
            value={fetNotes}
            onChange={setFetNotes}
            onClear={() => {
              setFetPreviousNotes(hasAnyNotes(fetNotes) ? fetNotes : fetPreviousNotes);
              setFetNotes({});
            }}
            onCopyFromPrevious={
              fetPreviousNotes ? () => setFetNotes({ ...fetPreviousNotes }) : undefined
            }
            hasPrevious={!!fetPreviousNotes}
            measurementId={fetMeasurementId}
            measurementTimestamp={fetMeasurementTimestamp}
          />
          <CalibrationPanel
            mode="fet"
            concentration={concentration}
            onChangeConcentration={handleChangeConcentration}
            points={fetCalibration}
            onClear={() => setFetCalibration([])}
            onExport={exportCalibrationCSV}
            currentVt={liveFetVt ?? undefined}
            currentVtBaseline={liveFetVtBaseline ?? null}
            currentVtAnalyte={liveFetVt ?? null}
            currentDeltaVt_mV={
              liveFetVt != null && liveFetVtBaseline != null
                ? (liveFetVt - liveFetVtBaseline) * 1000
                : null
            }
            currentDeltaVtSigned_mV={
              liveFetVt != null && liveFetVtBaseline != null
                ? (liveFetVt - liveFetVtBaseline) * 1000
                : null
            }
            responseMode={fetResponseMode}
            onResponseModeChange={setFetResponseMode}
          />
        </div>
        </div>
      )}

      {/* CV MODE */}
      {mode === "cv" && (() => {
        const cvDataLive = dataSource === "simulated" ? cv.data : ws.cvData;
        const cvMetrics = computeCVMetrics(cvDataLive, {
          scanRate_mVs: cvParams.scanRate,
          n: cvParams.n,
          cMM: cvParams.cMM,
          areaCm2: cvParams.areaCm2,
          baselineMethodInput: cvBaselineMethod,
        });
        const isCVRunning = dataSource === "simulated" ? cv.isRunning : isLiveCVRunning;
        const canAddCalibration = !!cvMetrics && cvDataLive.length > 0 && !isCVRunning;
        const correctedAvailable =
          !!cvMetrics?.correctedData &&
          cvMetrics.correctedData.length === cvDataLive.length &&
          cvMetrics.correctedData.some((p) => Number.isFinite(p.Icorr));
        const baselineAvailable =
          !!cvMetrics?.correctedData &&
          cvMetrics.correctedData.some((p) => Number.isFinite(p.baseline));
        return (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-mono text-muted-foreground">Cyclic Voltammogram — I vs E</h2>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={cvOverlayMode ? "default" : "outline"}
                    onClick={() => setCvOverlayMode((v) => !v)}
                    className="font-mono text-xs"
                  >
                    Overlay {cvOverlayMode ? "ON" : "OFF"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (cvDataLive.length === 0) return;
                      const label =
                        cvParams.cMM > 0 ? `${cvParams.cMM} mM` : `Blank ${cvOverlays.length + 1}`;
                      const color = OVERLAY_COLORS[cvOverlays.length % OVERLAY_COLORS.length];
                      setCvOverlays((prev) => {
                        const next = [...prev, { id: newId(), label, color, data: cvDataLive.slice() }];
                        return next.length > 8 ? next.slice(next.length - 8) : next;
                      });
                    }}
                    disabled={cvDataLive.length === 0}
                    className="font-mono text-xs"
                  >＋ Capture</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCvOverlays([])}
                    disabled={cvOverlays.length === 0}
                    className="font-mono text-xs"
                  >Clear ({cvOverlays.length})</Button>
                  <Button
                    size="sm"
                    variant={cvPlotMode === "corrected" ? "default" : "outline"}
                    onClick={() => setCvPlotMode((m) => m === "raw" ? "corrected" : "raw")}
                    disabled={cvPlotMode === "raw" && !correctedAvailable}
                    className="font-mono text-xs"
                    title={
                      correctedAvailable
                        ? "Toggle raw (measured) vs baseline-subtracted current"
                        : "Corrected view unavailable — fit a baseline first"
                    }
                  >
                    {cvPlotMode === "corrected" ? "Corrected" : "Raw"}
                  </Button>
                  <Button
                    size="sm"
                    variant={cvShowBaseline ? "default" : "outline"}
                    onClick={() => setCvShowBaseline((v) => !v)}
                    disabled={!baselineAvailable}
                    className="font-mono text-xs"
                    title={
                      baselineAvailable
                        ? "Overlay baseline (raw) or zero reference (corrected)"
                        : "Baseline not available"
                    }
                  >
                    Baseline {cvShowBaseline ? "ON" : "OFF"}
                  </Button>
                  <select
                    value={cvBaselineMethod}
                    onChange={(e) =>
                      setCvBaselineMethod(
                        e.target.value as typeof cvBaselineMethod,
                      )
                    }
                    className="h-7 rounded-md border border-input bg-background px-2 font-mono text-[11px]"
                    title="Baseline subtraction method"
                  >
                    <option value="auto">Baseline: Auto</option>
                    <option value="none">Baseline: None</option>
                    <option value="linear-first-15">Baseline: Linear first 15%</option>
                    <option value="linear-edges">Baseline: Linear edges</option>
                  </select>
                  <StatusIndicator
                    isRunning={isCVRunning && cvDataLive.length > 0}
                    label={isCVRunning ? "Sweeping..." : "Idle"}
                    dataPoints={cvDataLive.length}
                  />
                </div>
              </div>
              {dataSource === "live" && ws.cvError && (
                <div className="text-[11px] font-mono text-destructive border border-destructive/40 bg-destructive/10 rounded-md p-2">
                  CV hardware error: {ws.cvError}
                </div>
              )}
              {cvOverlays.length > 0 && (
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                  {cvOverlays.map((ov) => (
                    <span key={ov.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                      <span style={{ background: ov.color, width: 8, height: 8, borderRadius: 999 }} />
                      {ov.label}
                      <button
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setCvOverlays((prev) => prev.filter((p) => p.id !== ov.id))}
                        title="Remove overlay"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-border bg-card p-3 h-[440px] md:h-[540px]">
                <CVPlot
                  data={cvDataLive}
                  metrics={cvMetrics}
                  e0Prime={CV_E0_PRIME}
                  plotMode={cvPlotMode}
                  overlays={cvOverlays}
                  showBaseline={cvShowBaseline}
                />
              </div>
              {cvMetrics && (
                <>
                  <div className="text-[11px] font-mono text-muted-foreground border border-border bg-secondary/40 rounded-md p-2">
                    {cvParams.cvModel === "reversible" ? (
                      <>
                        <span className="text-foreground">Reversible diffusion model</span>
                        {" — "}solves 1D semi-infinite diffusion (finite-domain
                        approximation, L = 6·√(D·tMax)) with a Nernst surface
                        boundary. ΔEp, |Ipa/Ipc| and ip ∝ C·√v emerge from the
                        physics. Reversibility / D_status decisions use the
                        baseline-corrected peak currents — raw extrema can
                        deviate because they include baseline/tail contributions.
                      </>
                    ) : (
                      <>
                        <span className="text-foreground">Quasi-reversible model</span>
                        {" — "}Butler–Volmer + Cottrell convolution. Educational
                        approximation; D apparent from Randles–Ševčík may be biased
                        and n estimate is only valid for reversible systems at 25 °C.
                      </>
                    )}
                  </div>
                  {cvParams.cvModel === "quasi-reversible" && (
                    <div className="text-[11px] font-mono text-yellow-500 border border-yellow-500/40 bg-yellow-500/10 rounded-md p-2">
                      ⚠ Quasi-reversible model — D apparent from
                      Randles–Ševčík may be biased.
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { label: "Ipa raw", value: Number.isFinite(cvMetrics.IpaRaw) ? `${cvMetrics.IpaRaw.toFixed(2)} µA` : "—", t: "Anodic peak current — uncorrected" },
                      { label: "Ipc raw", value: Number.isFinite(cvMetrics.IpcRaw) ? `${cvMetrics.IpcRaw.toFixed(2)} µA` : "—", t: "Cathodic peak current — uncorrected" },
                      { label: "Ipa corr", value: Number.isFinite(cvMetrics.IpaCorrected) ? `${cvMetrics.IpaCorrected.toFixed(2)} µA` : "—", t: "Baseline-corrected anodic peak" },
                      { label: "Ipc corr", value: Number.isFinite(cvMetrics.IpcCorrected) ? `${cvMetrics.IpcCorrected.toFixed(2)} µA` : "—", t: "Baseline-corrected cathodic peak" },
                      { label: "Epa", value: Number.isFinite(cvMetrics.Epa) ? `${cvMetrics.Epa.toFixed(3)} V` : "—" },
                      { label: "Epc", value: Number.isFinite(cvMetrics.Epc) ? `${cvMetrics.Epc.toFixed(3)} V` : "—" },
                      { label: "ΔEp", value: Number.isFinite(cvMetrics.deltaEp) ? `${cvMetrics.deltaEp.toFixed(0)} mV` : "—", t: `Expected ≈ ${(59.16 / Math.max(1, cvParams.n)).toFixed(0)} mV for n=${cvParams.n} at 25 °C` },
                      { label: "E°'", value: Number.isFinite(cvMetrics.E0prime) ? `${cvMetrics.E0prime.toFixed(3)} V` : "—" },
                      { label: "|Ipa/Ipc|", value: Number.isFinite(cvMetrics.IpaIpcRatio) ? cvMetrics.IpaIpcRatio.toFixed(2) : "—" },
                      { label: "n est.", value: cvMetrics.n_est_valid ? cvMetrics.n_electrons.toFixed(2) : "—", t: "Valid only for reversible diffusion-controlled systems at 25 °C." },
                      {
                        label: `D apparent (${cvMetrics.D_status})`,
                        value: Number.isFinite(cvMetrics.D_apparent)
                          ? `${cvMetrics.D_apparent.toExponential(2)} cm²/s`
                          : "—",
                        t: "valid → reversible only · apparent → quasi-reversible informational · invalid → not applicable",
                      },
                      { label: "SNR (min)", value: `${Math.min(cvMetrics.SNR_anodic, cvMetrics.SNR_cathodic).toFixed(1)}`, t: "min(SNR_anodic, SNR_cathodic) — corrected peak ÷ noise (1.4826·MAD)" },
                      { label: "Noise", value: `${cvMetrics.noise_uA.toFixed(3)} µA`, t: "Robust noise estimate (1.4826·MAD of baseline residuals)" },
                      { label: "Reversibility", value: cvMetrics.reversibility },
                      {
                        label: "Baseline",
                        value:
                          cvMetrics.baselineMethodInput === "auto"
                            ? `Auto → ${cvMetrics.baselineResolvedMethod}`
                            : cvMetrics.baselineResolvedMethod,
                        t: `Input: ${cvMetrics.baselineMethodInput} · Method: ${cvMetrics.baselineMethod}`,
                      },
                      {
                        label: "Metrics cycle",
                        value: `${cvMetrics.metricsCycle}${
                          cvParams.nCycles > 1 ? ` / ${cvParams.nCycles}` : ""
                        }`,
                        t: "Main metrics are calculated from this cycle. Corrected view spans all cycles when available.",
                      },
                    ].map((it) => (
                      <div key={it.label} className="bg-secondary rounded-md p-2" title={it.t}>
                        <div className="text-[10px] text-muted-foreground font-mono uppercase">
                          {it.label}{it.t ? <span className="ml-1 opacity-60">ⓘ</span> : null}
                        </div>
                        <div className="text-sm font-mono text-foreground">{it.value}</div>
                      </div>
                    ))}
                  </div>
                  {cvMetrics.warnings.length > 0 && (
                    <div className="text-[11px] font-mono text-muted-foreground border border-border rounded-md p-2 bg-secondary/40">
                      ⚠ {cvMetrics.warnings.join(" · ")}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="space-y-4">
              <SignalQuality
                mode="cv"
                eisData={[]}
                fetBaseline={[]}
                fetAnalyte={[]}
                cvMetrics={cvMetrics}
                cvNElectrons={cvParams.n}
              />
              <MeasurementNotesPanel
                mode="cv"
                value={cvNotes}
                onChange={setCvNotes}
                onClear={() => {
                  setCvPreviousNotes(hasAnyNotes(cvNotes) ? cvNotes : cvPreviousNotes);
                  setCvNotes({});
                }}
                onCopyFromPrevious={
                  cvPreviousNotes
                    ? () => setCvNotes({ ...cvPreviousNotes })
                    : undefined
                }
                hasPrevious={!!cvPreviousNotes}
                measurementId={cvMeasurementId}
                measurementTimestamp={cvMeasurementTimestamp}
              />
              <CVCalibrationPanel
                points={cvCalibration}
                concentration_mM={cvParams.cMM}
                onChangeConcentration={(v) =>
                  setCvParams((prev) => ({ ...prev, cMM: v }))
                }
                responseMode={cvResponseMode}
                onChangeResponseMode={setCvResponseMode}
                onAddCurrent={() => {
                  if (!cvMetrics) {
                    toast.error("No CV metrics yet — run a CV sweep first.");
                    return;
                  }
                  const cleanNotes = sanitizeMeasurementNotes(cvNotes);
                  const pt = buildCVCalibrationPoint(
                    cvParams.cMM,
                    cvMetrics,
                    cvParams.cvModel,
                    {
                      measurementId: cvMeasurementId,
                      sampleId: cleanNotes?.sampleId,
                      electrodeId: cleanNotes?.electrodeId,
                      notes: shortNotesSummary(cleanNotes),
                      timestamp: cvMeasurementTimestamp,
                    },
                  );
                  // Always append — replicates (including blank replicates) are
                  // required for LOD estimation.
                  setCvCalibration((prev) => [...prev, pt]);
                  // Remember the notes so the next sweep can copy-from-previous.
                  if (hasAnyNotes(cleanNotes)) setCvPreviousNotes(cleanNotes!);
                  logActivity(
                    "calibration",
                    `CV calibration point added — C=${cvParams.cMM} mM, response=${
                      responseFor(pt, cvResponseMode)?.toFixed(2) ?? "n/a"
                    } µA`,
                  );
                  toast.success(`Added CV point at ${cvParams.cMM} mM`);
                }}
                onClear={() => {
                  setCvCalibration([]);
                  toast("CV calibration cleared");
                }}
                onExport={() =>
                  exportCVCalibrationCSV(cvCalibration, {
                    source: dataSource,
                    responseMode: cvResponseMode,
                    n: cvParams.n,
                    areaCm2: cvParams.areaCm2,
                    scanRate_mVs: cvParams.scanRate,
                  })
                }
                canAdd={canAddCalibration}
                currentMeasuredUA={(() => {
                  if (!cvMetrics) return null;
                  const tmp = buildCVCalibrationPoint(
                    cvParams.cMM,
                    cvMetrics,
                    cvParams.cvModel,
                  );
                  return responseFor(tmp, cvResponseMode);
                })()}
                currentExpectedUA={randlesSevcikIpUA({
                  n: cvParams.n,
                  areaCm2: cvParams.areaCm2,
                  cMM: cvParams.cMM,
                  scanRate_mVs: cvParams.scanRate,
                })}
                cvModel={cvParams.cvModel}
                n={cvParams.n}
                areaCm2={cvParams.areaCm2}
                scanRate_mVs={cvParams.scanRate}
              />
            </div>
          </div>
        );
      })()}

      {mode === "swv" && (
        <SWVMode
          dataSource={dataSource}
          ws={ws}
          externalParams={swvParams}
          onChangeParams={setSwvParams}
          onController={setSwvCtrl}
        />
      )}

      <footer className="mt-8 text-center text-[10px] text-muted-foreground font-mono">
        HelpStat Biosensor v0.2 — {dataSource === "simulated" ? "Simulated Mode" : "Live Mode"} — ESP32-S3 WebSocket
      </footer>
    </div>
  );
};

export default Index;
