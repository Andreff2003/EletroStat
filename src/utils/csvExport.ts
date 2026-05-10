import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";
import type { StoredMeasurement } from "./sessionStore";

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
  const header = "Frequency (Hz),Z' Real (Ohms),Z'' Imag (Ohms),|Z| Magnitude (Ohms),Phase (degrees)\n";
  const rows = data.map(d =>
    `${d.frequency},${d.zReal},${d.zImag},${d.zMag},${d.phase}`
  ).join("\n");
  downloadCSV(`eis_data_${Date.now()}.csv`, header + rows);
}

export function exportFETTransferData(baseline: FETTransferPoint[], analyte: FETTransferPoint[]) {
  const header = "Vg (V),Id Baseline (µA),Id Analyte (µA)\n";
  const maxLen = Math.max(baseline.length, analyte.length);
  const rows: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const vg = baseline[i]?.vg ?? analyte[i]?.vg ?? "";
    const idB = baseline[i]?.id ?? "";
    const idA = analyte[i]?.id ?? "";
    rows.push(`${vg},${idB},${idA}`);
  }
  downloadCSV(`fet_transfer_${Date.now()}.csv`, header + rows.join("\n"));
}

export function exportFETTimeData(data: FETTimePoint[]) {
  const header = "Time (s),Id (µA)\n";
  const rows = data.map(d => `${d.time},${d.id}`).join("\n");
  downloadCSV(`fet_time_${Date.now()}.csv`, header + rows);
}

/** Two-section session CSV: raw points + processed results per measurement. */
export function exportSessionCSV(measurements: StoredMeasurement[]) {
  const lines: string[] = [];

  // SECTION 1 — Raw data
  lines.push("# SECTION 1 — Raw data");
  lines.push(
    "measurement_id,timestamp,mode,concentration_nM,frequency_Hz,zReal_ohm,zImag_ohm,zMag_ohm,phase_deg,vg_V,id_uA,time_s,marker_label",
  );
  for (const m of measurements) {
    const ts = new Date(m.timestamp).toISOString();
    if (m.mode === "eis") {
      for (const p of m.data) {
        lines.push(
          [
            m.id,
            ts,
            "eis",
            m.concentration,
            p.frequency,
            p.zReal,
            p.zImag,
            p.zMag,
            p.phase,
            "",
            "",
            "",
            "",
          ].join(","),
        );
      }
    } else {
      // FET transfer (baseline + analyte) and time response
      for (const p of m.baseline) {
        lines.push([m.id, ts, "fet_baseline", m.concentration, "", "", "", "", "", p.vg, p.id, "", ""].join(","));
      }
      for (const p of m.analyte) {
        lines.push([m.id, ts, "fet_analyte", m.concentration, "", "", "", "", "", p.vg, p.id, "", ""].join(","));
      }
      for (const p of m.timeData) {
        lines.push([m.id, ts, "fet_time", m.concentration, "", "", "", "", "", "", p.id, p.time, ""].join(","));
      }
      for (const mk of m.markers) {
        lines.push([m.id, ts, "fet_marker", m.concentration, "", "", "", "", "", "", "", mk.time, escapeCSV(mk.label)].join(","));
      }
    }
  }

  // Blank line + SECTION 2 — Processed results
  lines.push("");
  lines.push("# SECTION 2 — Processed results");
  lines.push(
    "measurement_id,timestamp,mode,concentration_nM,Rs_ohm,Rct_ohm,Cdl_uF,Aw,warburg_slope,fit_error_pct,Vt_V,freqMin,freqMax,points,amplitude_mV,vgMin,vgMax,vgStep_mV,intervalMs,notes",
  );
  for (const m of measurements) {
    const ts = new Date(m.timestamp).toISOString();
    if (m.mode === "eis") {
      const e = m.extracted;
      lines.push(
        [
          m.id,
          ts,
          "eis",
          m.concentration,
          fmt(e.Rs),
          fmt(e.Rct),
          e.Cdl != null ? (e.Cdl * 1e6).toFixed(4) : "",
          fmt(e.Aw),
          fmt(e.warburgSlope),
          fmt(e.fitErrorPct),
          "",
          m.params.freqMin,
          m.params.freqMax,
          m.params.points,
          m.params.amplitude,
          "",
          "",
          "",
          "",
          escapeCSV(m.notes ?? ""),
        ].join(","),
      );
    } else {
      lines.push(
        [
          m.id,
          ts,
          "fet",
          m.concentration,
          "",
          "",
          "",
          "",
          "",
          "",
          fmt(m.extracted.Vt),
          "",
          "",
          "",
          "",
          m.params.vgMin,
          m.params.vgMax,
          m.params.vgStep,
          m.params.intervalMs,
          escapeCSV(m.notes ?? ""),
        ].join(","),
      );
    }
  }

  downloadCSV(`helpstat_session_${Date.now()}.csv`, lines.join("\n"));
}

function fmt(v: number | undefined) {
  return v == null || !Number.isFinite(v) ? "" : v.toString();
}

function escapeCSV(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
