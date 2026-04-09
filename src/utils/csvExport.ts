import type { EISDataPoint, FETTransferPoint, FETTimePoint } from "@/hooks/useSimulatedData";

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
