import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";
import type { StoredMeasurement } from "./sessionStore";
import { getActivityLog, type ActivityEntry } from "./activityLog";

// ───────────────────────── helpers ─────────────────────────

const DELIM = "\t";
const BOM = "\uFEFF";

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
      return c;
    })
    .join(DELIM);
}

function downloadTSV(filename: string, content: string) {
  const blob = new Blob([BOM + content], { type: "text/tab-separated-values;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
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
  "Warburg Slope",
  "Fit Error (%)",
  "Freq Min (Hz)",
  "Freq Max (Hz)",
  "Points",
  "Amplitude (mV)",
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
  // First cell holds the bold section marker; remaining cells empty for spreadsheet clarity.
  return `=== ${label} ===`;
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
      lines.push(toRow([
        m.id, ts, "eis", fmtNum(m.concentration),
        fmtNum(e.Rs), fmtNum(e.Rct),
        e.Cdl != null && Number.isFinite(e.Cdl) ? (e.Cdl * 1e6).toFixed(3) : "N/A",
        fmtNum(e.Aw), fmtNum(e.warburgSlope), fmtNum(e.fitErrorPct),
        fmtNum(m.params.freqMin), fmtNum(m.params.freqMax),
        fmtNum(m.params.points), fmtNum(m.params.amplitude),
        "N/A", "N/A", "N/A", "N/A", "N/A",
        fmtStr(m.notes),
      ]));
    } else {
      lines.push(toRow([
        m.id, ts, "fet", fmtNum(m.concentration),
        "N/A", "N/A", "N/A", "N/A", "N/A", "N/A",
        "N/A", "N/A", "N/A", "N/A",
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
