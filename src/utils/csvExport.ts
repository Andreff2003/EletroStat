import Papa from "papaparse";
import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";
import type { StoredMeasurement } from "./sessionStore";
import { getActivityLog, formatTimestamp, type ActivityEntry } from "./activityLog";

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportEISData(data: EISDataPoint[]) {
  const csv = Papa.unparse(
    data.map((d) => ({
      "Frequency (Hz)": d.frequency,
      "Z' Real (Ohms)": d.zReal,
      "Z'' Imag (Ohms)": d.zImag,
      "|Z| Magnitude (Ohms)": d.zMag,
      "Phase (degrees)": d.phase,
    })),
  );
  downloadCSV(`eis_data_${Date.now()}.csv`, csv);
}

export function exportFETTransferData(baseline: FETTransferPoint[], analyte: FETTransferPoint[]) {
  const maxLen = Math.max(baseline.length, analyte.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push({
      "Vg (V)": baseline[i]?.vg ?? analyte[i]?.vg ?? "",
      "Id Baseline (µA)": baseline[i]?.id ?? "",
      "Id Analyte (µA)": analyte[i]?.id ?? "",
    });
  }
  downloadCSV(`fet_transfer_${Date.now()}.csv`, Papa.unparse(rows));
}

export function exportFETTimeData(data: FETTimePoint[]) {
  const csv = Papa.unparse(data.map((d) => ({ "Time (s)": d.time, "Id (µA)": d.id })));
  downloadCSV(`fet_time_${Date.now()}.csv`, csv);
}

/** Two-section session CSV + appended activity log. */
export function exportSessionCSV(measurements: StoredMeasurement[]) {
  // SECTION 1 — raw per-point rows
  const rawRows: Record<string, unknown>[] = [];
  for (const m of measurements) {
    const ts = new Date(m.timestamp).toISOString();
    if (m.mode === "eis") {
      for (const p of m.data) {
        rawRows.push({
          measurement_id: m.id,
          timestamp: ts,
          mode: "eis",
          concentration_nM: m.concentration,
          frequency_Hz: p.frequency,
          zReal_ohm: p.zReal,
          zImag_ohm: p.zImag,
          zMag_ohm: p.zMag,
          phase_deg: p.phase,
          vg_V: "",
          id_uA: "",
          time_s: "",
          marker_label: "",
        });
      }
    } else {
      for (const p of m.baseline) {
        rawRows.push({
          measurement_id: m.id, timestamp: ts, mode: "fet_baseline",
          concentration_nM: m.concentration, frequency_Hz: "", zReal_ohm: "", zImag_ohm: "",
          zMag_ohm: "", phase_deg: "", vg_V: p.vg, id_uA: p.id, time_s: "", marker_label: "",
        });
      }
      for (const p of m.analyte) {
        rawRows.push({
          measurement_id: m.id, timestamp: ts, mode: "fet_analyte",
          concentration_nM: m.concentration, frequency_Hz: "", zReal_ohm: "", zImag_ohm: "",
          zMag_ohm: "", phase_deg: "", vg_V: p.vg, id_uA: p.id, time_s: "", marker_label: "",
        });
      }
      for (const p of m.timeData) {
        rawRows.push({
          measurement_id: m.id, timestamp: ts, mode: "fet_time",
          concentration_nM: m.concentration, frequency_Hz: "", zReal_ohm: "", zImag_ohm: "",
          zMag_ohm: "", phase_deg: "", vg_V: "", id_uA: p.id, time_s: p.time, marker_label: "",
        });
      }
      for (const mk of m.markers) {
        rawRows.push({
          measurement_id: m.id, timestamp: ts, mode: "fet_marker",
          concentration_nM: m.concentration, frequency_Hz: "", zReal_ohm: "", zImag_ohm: "",
          zMag_ohm: "", phase_deg: "", vg_V: "", id_uA: "", time_s: mk.time, marker_label: mk.label,
        });
      }
    }
  }

  // SECTION 2 — processed per-measurement rows
  const procRows = measurements.map((m) => {
    const ts = new Date(m.timestamp).toISOString();
    if (m.mode === "eis") {
      const e = m.extracted;
      return {
        measurement_id: m.id, timestamp: ts, mode: "eis", concentration_nM: m.concentration,
        Rs_ohm: fmt(e.Rs), Rct_ohm: fmt(e.Rct),
        Cdl_uF: e.Cdl != null ? (e.Cdl * 1e6).toFixed(4) : "",
        Aw: fmt(e.Aw), warburg_slope: fmt(e.warburgSlope), fit_error_pct: fmt(e.fitErrorPct),
        Vt_V: "", freqMin: m.params.freqMin, freqMax: m.params.freqMax,
        points: m.params.points, amplitude_mV: m.params.amplitude,
        vgMin: "", vgMax: "", vgStep_mV: "", intervalMs: "", notes: m.notes ?? "",
      };
    }
    return {
      measurement_id: m.id, timestamp: ts, mode: "fet", concentration_nM: m.concentration,
      Rs_ohm: "", Rct_ohm: "", Cdl_uF: "", Aw: "", warburg_slope: "", fit_error_pct: "",
      Vt_V: fmt(m.extracted.Vt), freqMin: "", freqMax: "", points: "", amplitude_mV: "",
      vgMin: m.params.vgMin, vgMax: m.params.vgMax, vgStep_mV: m.params.vgStep,
      intervalMs: m.params.intervalMs, notes: m.notes ?? "",
    };
  });

  // SECTION 3 — activity log
  const log = getActivityLog();
  const logRows = log.map((e: ActivityEntry) => ({
    timestamp: formatTimestamp(e.timestamp),
    iso: new Date(e.timestamp).toISOString(),
    category: e.category,
    message: e.message,
  }));

  const out = [
    "# SECTION 1 — Raw data",
    Papa.unparse(rawRows),
    "",
    "# SECTION 2 — Processed results",
    Papa.unparse(procRows),
    "",
    "# SECTION 3 — Activity log",
    Papa.unparse(logRows),
  ].join("\n");

  downloadCSV(`helpstat_session_${Date.now()}.csv`, out);
}

function fmt(v: number | undefined) {
  return v == null || !Number.isFinite(v) ? "" : v.toString();
}
