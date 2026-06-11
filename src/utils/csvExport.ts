import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";
import type { CVDataPoint } from "@/hooks/useSimulatedCVData";
import type { CVMetrics } from "@/utils/computeCVMetrics";
import type {
  CVCalibrationPoint,
  CVResponseMode,
} from "@/utils/cvCalibration";
import {
  summarizeCalibration,
  randlesSevcikIpUA,
  responseFor,
} from "@/utils/cvCalibration";
import type { StoredMeasurement } from "./sessionStore";
import { getActivityLog, type ActivityEntry } from "./activityLog";

// ───────────────────────── helpers ─────────────────────────

const DELIM = ",";
const BOM = "\uFEFF";
const SECTION_PAD = 8; // empty columns after section header

/** Escape a CSV field per RFC 4180: quote if it contains comma, quote, CR or LF. */
function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

/** Format timestamp as ISO 8601 "YYYY-MM-DD HH:MM:SS" (local time). */
function fmtTs(ts: number | string | Date | undefined | null): string {
  if (ts == null) return "N/A";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "N/A";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** Round numeric values to 3 decimal places. "N/A" if null/undefined/NaN. */
function fmtNum(v: unknown): string {
  if (v == null) return "N/A";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(3);
}

/** Pass-through for strings, else "N/A". */
function fmtStr(v: unknown): string {
  if (v == null || v === "") return "N/A";
  return String(v).replace(/[\t\r\n]+/g, " ");
}

function toRow(cells: (string | number)[]): string {
  return cells
    .map((c) => {
      if (typeof c === "number") return Number.isFinite(c) ? c.toString() : "N/A";
      return csvEscape(c);
    })
    .join(DELIM);
}

function downloadTSV(filename: string, content: string) {
  const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.tsv$/i, ".csv");
  link.click();
  URL.revokeObjectURL(url);
}

function metaRow(measurementsCount: number, source: ExportSource): string {
  return toRow([
    "HelpStat Export",
    fmtTs(Date.now()),
    `Measurements: ${measurementsCount}`,
    `Source: ${source}`,
  ]);
}

const BLANK = "\n\n";

export type ExportSource = "simulated" | "live";

export interface CalibrationExportPoint {
  concentration: number;
  signal: number;
  raw: number;
  timestamp: number;
  mode?: "eis" | "fet";
}

// ───────────────────────── section builders ─────────────────────────

const RAW_EIS_HEADERS = [
  "Measurement ID",
  "Timestamp",
  "Mode",
  "Concentration (nM)",
  "Frequency (Hz)",
  "Z Real (Ω)",
  "Z Imag (Ω)",
  "|Z| (Ω)",
  "Phase (°)",
];

const RAW_FET_HEADERS = [
  "Measurement ID",
  "Timestamp",
  "Mode",
  "Concentration (nM)",
  "Vg (V)",
  "Id (µA)",
  "Time (s)",
  "Marker",
];

const PROC_HEADERS = [
  "Measurement ID",
  "Timestamp",
  "Mode",
  "Concentration (nM)",
  "Rs (Ω)",
  "Rct (Ω)",
  "Cdl (µF)",
  "Aw (Ω/√s)",
  "f0 (Hz)",
  "Warburg Slope",
  "Warburg Aw",
  "KK Residual (%)",
  "KK Passed",
  "Fit Error (%)",
  "Fit Converged",
  "ΔRct (Ω)",
  "ΔRct normalised (%)",
  "Freq Min (Hz)",
  "Freq Max (Hz)",
  "Points",
  "Amplitude (mV)",
  "Warn Flags",
  "Vt (V)",
  "Vg Min (V)",
  "Vg Max (V)",
  "Vg Step (mV)",
  "Interval (ms)",
  "Notes",
];

const CAL_HEADERS = [
  "Concentration (nM)",
  "Signal (ΔRct Ω or ΔVt mV)",
  "Raw Value",
  "Timestamp",
];

function sectionHeader(label: string): string {
  // First cell holds the section marker; pad with empty cells so it sits alone in column A.
  return `=== ${label} ===` + DELIM.repeat(SECTION_PAD);
}

function buildRawSection(measurements: StoredMeasurement[]): string {
  // Decide which raw schema to use.
  const hasFet = measurements.some((m) => m.mode === "fet");
  const hasEis = measurements.some((m) => m.mode === "eis");
  const lines: string[] = [];
  lines.push(sectionHeader("RAW DATA"));

  if (hasEis && !hasFet) {
    lines.push(toRow(RAW_EIS_HEADERS));
    for (const m of measurements) {
      if (m.mode !== "eis") continue;
      const ts = fmtTs(m.timestamp);
      for (const p of m.data) {
        lines.push(
          toRow([
            m.id,
            ts,
            "eis",
            fmtNum(m.concentration),
            fmtNum(p.frequency),
            fmtNum(p.zReal),
            fmtNum(p.zImag),
            fmtNum(p.zMag),
            fmtNum(p.phase),
          ]),
        );
      }
    }
  } else if (hasFet && !hasEis) {
    lines.push(toRow(RAW_FET_HEADERS));
    for (const m of measurements) {
      if (m.mode !== "fet") continue;
      const ts = fmtTs(m.timestamp);
      for (const p of m.baseline) {
        lines.push(toRow([m.id, ts, "fet_baseline", fmtNum(m.concentration), fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
      }
      for (const p of m.analyte) {
        lines.push(toRow([m.id, ts, "fet_analyte", fmtNum(m.concentration), fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
      }
      for (const p of m.timeData) {
        lines.push(toRow([m.id, ts, "fet_time", fmtNum(m.concentration), "N/A", fmtNum(p.id), fmtNum(p.time), "N/A"]));
      }
      for (const mk of m.markers) {
        lines.push(toRow([m.id, ts, "fet_marker", fmtNum(m.concentration), "N/A", "N/A", fmtNum(mk.time), fmtStr(mk.label)]));
      }
    }
  } else {
    // Mixed: use a unified superset schema.
    const headers = [
      "Measurement ID", "Timestamp", "Mode", "Concentration (nM)",
      "Frequency (Hz)", "Z Real (Ω)", "Z Imag (Ω)", "|Z| (Ω)", "Phase (°)",
      "Vg (V)", "Id (µA)", "Time (s)", "Marker",
    ];
    lines.push(toRow(headers));
    for (const m of measurements) {
      const ts = fmtTs(m.timestamp);
      if (m.mode === "eis") {
        for (const p of m.data) {
          lines.push(toRow([
            m.id, ts, "eis", fmtNum(m.concentration),
            fmtNum(p.frequency), fmtNum(p.zReal), fmtNum(p.zImag), fmtNum(p.zMag), fmtNum(p.phase),
            "N/A", "N/A", "N/A", "N/A",
          ]));
        }
      } else {
        for (const p of m.baseline) {
          lines.push(toRow([m.id, ts, "fet_baseline", fmtNum(m.concentration), "N/A", "N/A", "N/A", "N/A", "N/A", fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
        }
        for (const p of m.analyte) {
          lines.push(toRow([m.id, ts, "fet_analyte", fmtNum(m.concentration), "N/A", "N/A", "N/A", "N/A", "N/A", fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
        }
        for (const p of m.timeData) {
          lines.push(toRow([m.id, ts, "fet_time", fmtNum(m.concentration), "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", fmtNum(p.id), fmtNum(p.time), "N/A"]));
        }
        for (const mk of m.markers) {
          lines.push(toRow([m.id, ts, "fet_marker", fmtNum(m.concentration), "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", fmtNum(mk.time), fmtStr(mk.label)]));
        }
      }
    }
  }

  return lines.join("\n");
}

function buildProcessedSection(measurements: StoredMeasurement[]): string {
  const lines: string[] = [];
  lines.push(sectionHeader("PROCESSED RESULTS"));
  lines.push(toRow(PROC_HEADERS));
  for (const m of measurements) {
    const ts = fmtTs(m.timestamp);
    if (m.mode === "eis") {
      const e = m.extracted;
      const fitErrPctStr =
        e.fitErrorPct == null
          ? "N/A"
          : e.fitErrorPct === -1
            ? "-1"
            : Number(e.fitErrorPct).toFixed(3);
      lines.push(toRow([
        m.id, ts, "eis", fmtNum(m.concentration),
        fmtNum(e.Rs), fmtNum(e.Rct),
        e.Cdl != null && Number.isFinite(e.Cdl) ? (e.Cdl * 1e6).toFixed(3) : "N/A",
        fmtNum(e.Aw),
        fmtNum(e.f0),
        fmtNum(e.warburgSlope),
        fmtNum(e.warburgAw),
        fmtNum(e.kkResidualPct),
        e.kkPassed == null ? "N/A" : e.kkPassed ? "Yes" : "No",
        fitErrPctStr,
        e.fitConverged == null ? "N/A" : e.fitConverged ? "Yes" : "No",
        fmtNum(e.deltaRct),
        fmtNum(e.deltaRctNormPct),
        fmtNum(m.params.freqMin), fmtNum(m.params.freqMax),
        fmtNum(m.params.points), fmtNum(m.params.amplitude),
        e.warnFlags && e.warnFlags.length > 0 ? e.warnFlags.join(" | ") : "N/A",
        "N/A", "N/A", "N/A", "N/A", "N/A",
        fmtStr(m.notes),
      ]));
    } else {
      lines.push(toRow([
        m.id, ts, "fet", fmtNum(m.concentration),
        // Rs, Rct, Cdl, Aw, f0, Warburg Slope, Warburg Aw, KK Residual, KK Passed,
        // Fit Error, Fit Converged, ΔRct, ΔRct%, freqMin, freqMax, points, amplitude, warnFlags
        "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A",
        "N/A", "N/A", "N/A", "N/A",
        "N/A", "N/A", "N/A", "N/A", "N/A",
        fmtNum(m.extracted.Vt),
        fmtNum(m.params.vgMin), fmtNum(m.params.vgMax),
        fmtNum(m.params.vgStep), fmtNum(m.params.intervalMs),
        fmtStr(m.notes),
      ]));
    }
  }
  return lines.join("\n");
}

function buildCalibrationSection(points: CalibrationExportPoint[]): string {
  const lines: string[] = [];
  lines.push(sectionHeader("CALIBRATION"));
  lines.push(toRow(CAL_HEADERS));
  if (points.length === 0) {
    lines.push(toRow(["N/A", "N/A", "N/A", "N/A"]));
  } else {
    for (const p of [...points].sort((a, b) => a.concentration - b.concentration)) {
      lines.push(toRow([fmtNum(p.concentration), fmtNum(p.signal), fmtNum(p.raw), fmtTs(p.timestamp)]));
    }
  }
  return lines.join("\n");
}

function buildActivitySection(): string {
  const lines: string[] = [];
  lines.push(sectionHeader("ACTIVITY LOG"));
  lines.push(toRow(["Timestamp", "Category", "Message"]));
  const log = getActivityLog();
  if (log.length === 0) {
    lines.push(toRow(["N/A", "N/A", "N/A"]));
  } else {
    for (const e of log as ActivityEntry[]) {
      lines.push(toRow([fmtTs(e.timestamp), fmtStr(e.category), fmtStr(e.message)]));
    }
  }
  return lines.join("\n");
}

// ───────────────────────── public exports ─────────────────────────

export function exportEISData(data: EISDataPoint[], source: ExportSource = "simulated") {
  const id = `eis_${Date.now()}`;
  const ts = fmtTs(Date.now());
  const rawLines = [sectionHeader("RAW DATA"), toRow(RAW_EIS_HEADERS)];
  for (const p of data) {
    rawLines.push(toRow([
      id, ts, "eis", "N/A",
      fmtNum(p.frequency), fmtNum(p.zReal), fmtNum(p.zImag), fmtNum(p.zMag), fmtNum(p.phase),
    ]));
  }
  const out = [
    metaRow(1, source),
    rawLines.join("\n"),
    [sectionHeader("PROCESSED RESULTS"), toRow(PROC_HEADERS)].join("\n"),
    [sectionHeader("CALIBRATION"), toRow(CAL_HEADERS)].join("\n"),
  ].join(BLANK);
  downloadTSV(`eis_data_${Date.now()}.tsv`, out);
}

export function exportFETTransferData(
  baseline: FETTransferPoint[],
  analyte: FETTransferPoint[],
  source: ExportSource = "simulated",
) {
  const id = `fet_${Date.now()}`;
  const ts = fmtTs(Date.now());
  const rawLines = [sectionHeader("RAW DATA"), toRow(RAW_FET_HEADERS)];
  for (const p of baseline) {
    rawLines.push(toRow([id, ts, "fet_baseline", "N/A", fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
  }
  for (const p of analyte) {
    rawLines.push(toRow([id, ts, "fet_analyte", "N/A", fmtNum(p.vg), fmtNum(p.id), "N/A", "N/A"]));
  }
  const out = [
    metaRow(1, source),
    rawLines.join("\n"),
    [sectionHeader("PROCESSED RESULTS"), toRow(PROC_HEADERS)].join("\n"),
    [sectionHeader("CALIBRATION"), toRow(CAL_HEADERS)].join("\n"),
  ].join(BLANK);
  downloadTSV(`fet_transfer_${Date.now()}.tsv`, out);
}

export function exportFETTimeData(data: FETTimePoint[], source: ExportSource = "simulated") {
  const id = `fet_time_${Date.now()}`;
  const ts = fmtTs(Date.now());
  const rawLines = [sectionHeader("RAW DATA"), toRow(RAW_FET_HEADERS)];
  for (const p of data) {
    rawLines.push(toRow([id, ts, "fet_time", "N/A", "N/A", fmtNum(p.id), fmtNum(p.time), "N/A"]));
  }
  const out = [
    metaRow(1, source),
    rawLines.join("\n"),
    [sectionHeader("PROCESSED RESULTS"), toRow(PROC_HEADERS)].join("\n"),
    [sectionHeader("CALIBRATION"), toRow(CAL_HEADERS)].join("\n"),
  ].join(BLANK);
  downloadTSV(`fet_time_${Date.now()}.tsv`, out);
}

export function exportSessionCSV(
  measurements: StoredMeasurement[],
  options: { source?: ExportSource; calibration?: CalibrationExportPoint[] } = {},
) {
  const source = options.source ?? "simulated";
  const calibration = options.calibration ?? [];
  const out = [
    metaRow(measurements.length, source),
    buildRawSection(measurements),
    buildProcessedSection(measurements),
    buildCalibrationSection(calibration),
    buildActivitySection(),
  ].join(BLANK);
  downloadTSV(`helpstat_session_${Date.now()}.tsv`, out);
}

export function exportCalibrationCSV(
  mode: "eis" | "fet",
  points: CalibrationExportPoint[],
  source: ExportSource = "simulated",
) {
  const out = [
    metaRow(points.length, source),
    buildCalibrationSection(points),
  ].join(BLANK);
  downloadTSV(`calibration_${mode}_${Date.now()}.tsv`, out);
}

// ───────────────────────── CV ─────────────────────────

const RAW_CV_HEADERS = [
  "measurement_id", "timestamp", "time_s", "cycle", "branch",
  "E_V", "I_uA", "baseline_uA", "I_corrected_uA",
];

/** Format a number with 6 sig figs, scientific for tiny values. */
function fmtSig(v: unknown): string {
  if (v == null) return "N/A";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "N/A";
  if (n !== 0 && (Math.abs(n) < 1e-3 || Math.abs(n) >= 1e6)) {
    return n.toExponential(6);
  }
  return n.toPrecision(7);
}

export function exportCVData(
  data: CVDataPoint[],
  metrics: CVMetrics | null,
  scanRate_mVs: number,
  source: ExportSource = "simulated",
  cvModel: string = "reversible",
) {
  const id = `cv_${Date.now()}`;
  const ts = fmtTs(Date.now());
  const raw = [sectionHeader("RAW DATA"), toRow(RAW_CV_HEADERS)];
  // Prefer the per-point baseline/Icorr from metrics.correctedData when available.
  const corrIdx = new Map<number, CVDataPoint>();
  if (metrics?.correctedData) {
    metrics.correctedData.forEach((p, i) => corrIdx.set(i, p));
  }
  const useCorrected =
    metrics?.correctedData && metrics.correctedData.length === data.length;
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    const cp = useCorrected ? metrics!.correctedData![i] : undefined;
    raw.push(toRow([
      id, ts,
      fmtSig(p.t), `${p.cycle}`, fmtStr(p.branch ?? ""),
      fmtSig(p.E), fmtSig(p.I),
      fmtSig(cp?.baseline ?? p.baseline),
      fmtSig(cp?.Icorr ?? p.Icorr),
    ]));
  }
  const procHeaders = [
    "measurement_id", "timestamp", "scan_rate_mVs", "cv_model",
    "Ipa_raw_uA", "Ipc_raw_uA",
    "Ipa_corrected_uA", "Ipc_corrected_uA",
    "Epa_V", "Epc_V", "E0prime_V",
    "deltaEp_mV", "abs_Ipa_over_Ipc",
    "n_est", "n_est_valid",
    "D_apparent_cm2_s", "D_status",
    "noise_uA", "SNR_anodic", "SNR_cathodic",
    "reversibility", "baseline_method", "warnings",
  ];
  const proc = [sectionHeader("PROCESSED RESULTS"), toRow(procHeaders)];
  if (metrics) {
    proc.push(toRow([
      id, ts, fmtSig(scanRate_mVs), fmtStr(cvModel),
      fmtSig(metrics.IpaRaw), fmtSig(metrics.IpcRaw),
      fmtSig(metrics.IpaCorrected), fmtSig(metrics.IpcCorrected),
      fmtSig(metrics.Epa), fmtSig(metrics.Epc), fmtSig(metrics.E0prime),
      fmtSig(metrics.deltaEp), fmtSig(metrics.IpaIpcRatio),
      fmtSig(metrics.n_electrons), metrics.n_est_valid ? "Yes" : "No",
      fmtSig(metrics.D_apparent), metrics.D_status,
      fmtSig(metrics.noise_uA), fmtSig(metrics.SNR_anodic), fmtSig(metrics.SNR_cathodic),
      metrics.reversibility, metrics.baselineMethod,
      metrics.warnings.length ? metrics.warnings.join(" | ") : "N/A",
    ]));
  } else {
    proc.push(toRow(procHeaders.map(() => "N/A")));
  }
  const out = [metaRow(1, source), raw.join("\n"), proc.join("\n")].join(BLANK);
  downloadTSV(`cv_data_${Date.now()}.tsv`, out);
}

// ───────────────────────── CV Calibration ─────────────────────────

const CV_CAL_HEADERS = [
  "concentration_mM",
  "Ipa_corrected_uA",
  "Ipc_abs_corrected_uA",
  "response_mean_uA",
  "expected_ip_uA",
  "residual_uA",
  "deltaEp_mV",
  "abs_Ipa_over_Ipc",
  "D_apparent_cm2_s",
  "cv_model",
  "timestamp",
];

export interface CVCalibrationExportOptions {
  source?: ExportSource;
  responseMode: CVResponseMode;
  n: number;
  areaCm2: number;
  scanRate_mVs: number;
}

export function exportCVCalibrationCSV(
  points: CVCalibrationPoint[],
  opts: CVCalibrationExportOptions,
) {
  const source = opts.source ?? "simulated";
  const summary = summarizeCalibration(points, opts.responseMode);
  const lines: string[] = [];
  lines.push(metaRow(points.length, source));
  lines.push(sectionHeader("CV CALIBRATION"));
  lines.push(toRow(CV_CAL_HEADERS));
  const sorted = [...points].sort((a, b) => a.concentration_mM - b.concentration_mM);
  for (const p of sorted) {
    const expected = randlesSevcikIpUA({
      n: opts.n,
      areaCm2: opts.areaCm2,
      cMM: p.concentration_mM,
      scanRate_mVs: opts.scanRate_mVs,
    });
    const measured = responseFor(p, opts.responseMode);
    const residual =
      summary.fit != null && measured != null
        ? measured - (summary.fit.slope * p.concentration_mM + summary.fit.intercept)
        : null;
    lines.push(
      toRow([
        fmtSig(p.concentration_mM),
        fmtSig(p.Ipa_uA),
        fmtSig(p.IpcAbs_uA),
        fmtSig(p.responseMean_uA),
        fmtSig(expected),
        fmtSig(residual),
        fmtSig(p.deltaEp_mV),
        fmtSig(p.ratio),
        fmtSig(p.Dapparent),
        fmtStr(p.cvModel),
        fmtTs(p.timestamp),
      ]),
    );
  }
  // Summary block
  lines.push("");
  lines.push(sectionHeader("CV CALIBRATION SUMMARY"));
  lines.push(
    toRow([
      "response_mode",
      "slope_uA_per_mM",
      "intercept_uA",
      "r2",
      "n_points",
      "sigma_blank_uA",
      "LOD_mM",
      "LOQ_mM",
      "sigma_source",
      "quality",
    ]),
  );
  lines.push(
    toRow([
      opts.responseMode,
      fmtSig(summary.fit?.slope),
      fmtSig(summary.fit?.intercept),
      fmtSig(summary.fit?.r2),
      `${summary.fit?.nPoints ?? 0}`,
      fmtSig(summary.sigma_uA),
      fmtSig(summary.lod_mM),
      fmtSig(summary.loq_mM),
      summary.sigmaSource,
      summary.quality,
    ]),
  );
  downloadTSV(`cv_calibration_${Date.now()}.tsv`, lines.join("\n"));
}
