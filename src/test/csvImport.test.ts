import { describe, it, expect } from "vitest";
import { parseImportedCsv } from "@/utils/csvImport";

function makeEISCsv(): string {
  return [
    "sep=;",
    "=== RAW EIS DATA ===;;;;;;;;",
    "Measurement ID;Timestamp;Mode;Concentration (nM);Frequency (Hz);Z Real (Ω);Z Imag (Ω);|Z| (Ω);Phase (°)",
    "eis_1;2026-01-01 10:00:00;eis;N/A;100000.000;150.000;-20.000;151.327;-7.595",
    "eis_1;2026-01-01 10:00:00;eis;N/A;10000.000;180.000;-90.000;201.246;-26.565",
    "eis_1;2026-01-01 10:00:00;eis;N/A;1000.000;350.000;-250.000;430.116;-35.538",
  ].join("\n");
}

function makeCVCsv(): string {
  return [
    "sep=;",
    "=== RAW CV DATA ===;;;;;;;;",
    "measurement_id;timestamp;mode;concentration_mM;point_index;time_s;cycle;branch;E_V;I_raw_uA;baseline_uA;I_corrected_uA",
    "cv_1;2026-01-01 10:00:00;cv;1.000000;0;0.000000;1;forward;-0.200000;-1.500000;0.100000;-1.600000",
    "cv_1;2026-01-01 10:00:00;cv;1.000000;1;0.100000;1;forward;-0.150000;-0.800000;0.100000;-0.900000",
    "cv_1;2026-01-01 10:00:00;cv;1.000000;2;0.200000;1;forward;-0.100000;0.500000;0.100000;0.400000",
  ].join("\n");
}

function makeSWVCsv(): string {
  return [
    "sep=;",
    "=== RAW SWV DATA ===;;;;;;;;",
    "index;time_s;E_V;I_forward_uA;I_reverse_uA;I_net_raw_uA;direction",
    "0;0.040000;-0.200000;0.050000;0.020000;0.030000;anodic",
    "1;0.080000;-0.180000;0.080000;0.030000;0.050000;anodic",
    "2;0.120000;-0.160000;0.120000;0.040000;0.080000;anodic",
  ].join("\n");
}

describe("parseImportedCsv", () => {
  it("parses a valid EIS export", () => {
    const r = parseImportedCsv(makeEISCsv(), "eis");
    if ("error" in r) throw new Error(r.error);
    expect(r.mode).toBe("eis");
    if (r.mode !== "eis") return;
    expect(r.measurements).toHaveLength(1);
    const pts = r.measurements[0].points;
    expect(pts).toHaveLength(3);
    expect(pts[0].frequency).toBe(100000);
    expect(pts[0].zReal).toBe(150);
    expect(pts[0].zImag).toBe(-20);
    expect(r.skipped).toBe(0);
  });

  it("parses a valid CV export", () => {
    const r = parseImportedCsv(makeCVCsv(), "cv");
    if ("error" in r) throw new Error(r.error);
    expect(r.mode).toBe("cv");
    if (r.mode !== "cv") return;
    expect(r.measurements).toHaveLength(1);
    const pts = r.measurements[0].points;
    expect(pts).toHaveLength(3);
    expect(pts[0].E).toBe(-0.2);
    expect(pts[0].I).toBe(-1.5);
    expect(pts[0].branch).toBe("forward");
    expect(pts[0].baseline).toBeCloseTo(0.1, 6);
    expect(pts[0].Icorr).toBeCloseTo(-1.6, 6);
  });

  it("parses a valid SWV export", () => {
    const r = parseImportedCsv(makeSWVCsv(), "swv");
    if ("error" in r) throw new Error(r.error);
    expect(r.mode).toBe("swv");
    if (r.mode !== "swv") return;
    expect(r.measurements).toHaveLength(1);
    const pts = r.measurements[0].points;
    expect(pts).toHaveLength(3);
    expect(pts[0].E).toBe(-0.2);
    expect(pts[0].IForward).toBe(0.05);
    expect(pts[0].INet).toBeCloseTo(0.03, 6);
    expect(pts[0].direction).toBe("anodic");
  });

  it("returns an error when no RAW section is present", () => {
    const r = parseImportedCsv("sep=;\n=== METADATA ===\nkey;value\n", "eis");
    expect("error" in r).toBe(true);
  });

  it("skips corrupted rows and counts them", () => {
    const csv = [
      "sep=;",
      "=== RAW EIS DATA ===;;;;;;;;",
      "Measurement ID;Timestamp;Mode;Concentration (nM);Frequency (Hz);Z Real (Ω);Z Imag (Ω);|Z| (Ω);Phase (°)",
      "eis_1;t;eis;N/A;100000;150;-20;151.3;-7.6",
      "eis_1;t;eis;N/A;abc;xxx;yyy;zzz;www",
      "eis_1;t;eis;N/A;1000;350;-250;430.1;-35.5",
    ].join("\n");
    const r = parseImportedCsv(csv, "eis");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "eis") throw new Error("expected EIS");
    expect(r.measurements).toHaveLength(1);
    expect(r.measurements[0].points).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });

  it("round-trips numeric precision through scientific notation", () => {
    const csv = [
      "sep=;",
      "=== RAW SWV DATA ===;;;;;;;;",
      "index;time_s;E_V;I_forward_uA;I_reverse_uA;I_net_raw_uA;direction",
      "0;4.000000e-2;-2.000000e-1;5.000000e-2;2.000000e-2;3.000000e-2;anodic",
    ].join("\n");
    const r = parseImportedCsv(csv, "swv");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "swv") throw new Error("expected SWV");
    const pts = r.measurements[0].points;
    expect(pts[0].time).toBeCloseTo(0.04, 8);
    expect(pts[0].E).toBeCloseTo(-0.2, 8);
    expect(pts[0].INet).toBeCloseTo(0.03, 8);
  });

  it("stops reading rows at the next section header", () => {
    const csv = [
      "sep=;",
      "=== RAW EIS DATA ===;;;;;;;;",
      "Measurement ID;Timestamp;Mode;Concentration (nM);Frequency (Hz);Z Real (Ω);Z Imag (Ω);|Z| (Ω);Phase (°)",
      "eis_1;t;eis;N/A;100000;150;-20;151.3;-7.6",
      "eis_1;t;eis;N/A;10000;180;-90;201.2;-26.6",
      "",
      "=== PROCESSED RESULTS ===;;;;;;;;",
      "col;col2",
      "x;y",
    ].join("\n");
    const r = parseImportedCsv(csv, "eis");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "eis") throw new Error("expected EIS");
    expect(r.measurements).toHaveLength(1);
    expect(r.measurements[0].points).toHaveLength(2);
  });

  it("splits a session EIS section into one group per measurement_id", () => {
    const csv = [
      "sep=;",
      "=== RAW EIS DATA ===;;;;;;;;",
      "Measurement ID;Timestamp;Mode;Concentration (nM);Frequency (Hz);Z Real (Ω);Z Imag (Ω);|Z| (Ω);Phase (°)",
      "m_a;t;eis;10;100000;150;-20;151.3;-7.6",
      "m_a;t;eis;10;10000;180;-90;201.2;-26.6",
      "m_b;t;eis;50;100000;140;-25;142.2;-10",
      "m_b;t;eis;50;10000;170;-95;194.7;-29",
      "m_b;t;eis;50;1000;340;-260;428.1;-37",
    ].join("\n");
    const r = parseImportedCsv(csv, "eis");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "eis") throw new Error("expected EIS");
    expect(r.measurements).toHaveLength(2);
    expect(r.measurements[0].id).toBe("m_a");
    expect(r.measurements[0].concentration).toBe(10);
    expect(r.measurements[0].points).toHaveLength(2);
    expect(r.measurements[1].id).toBe("m_b");
    expect(r.measurements[1].concentration).toBe(50);
    expect(r.measurements[1].points).toHaveLength(3);
  });

  it("splits a session CV section into groups by measurement_id", () => {
    const csv = [
      "sep=;",
      "=== RAW CV DATA ===;;;;;;;;",
      "measurement_id;timestamp;mode;concentration_mM;point_index;time_s;cycle;branch;E_V;I_raw_uA;baseline_uA;I_corrected_uA",
      "cv_a;t;cv;1;0;0;1;forward;-0.2;-1.5;0.1;-1.6",
      "cv_a;t;cv;1;1;0.1;1;forward;-0.15;-0.8;0.1;-0.9",
      "cv_b;t;cv;5;0;0;1;forward;-0.2;-2.5;0.1;-2.6",
    ].join("\n");
    const r = parseImportedCsv(csv, "cv");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "cv") throw new Error("expected CV");
    expect(r.measurements).toHaveLength(2);
    expect(r.measurements[0].points).toHaveLength(2);
    expect(r.measurements[1].points).toHaveLength(1);
    expect(r.measurements[1].concentration).toBe(5);
  });

  it("splits a session SWV section into groups by measurement_id", () => {
    const csv = [
      "sep=;",
      "=== RAW SWV DATA ===;;;;;;;;",
      "measurement_id;timestamp;mode;concentration_nM;point_index;time_s;E_V;I_forward_uA;I_reverse_uA;I_net_raw_uA;baseline_uA;I_net_corrected_uA;direction",
      "swv_a;t;swv;10;0;0.04;-0.2;0.05;0.02;0.03;N/A;N/A;anodic",
      "swv_a;t;swv;10;1;0.08;-0.18;0.08;0.03;0.05;N/A;N/A;anodic",
      "swv_b;t;swv;100;0;0.04;-0.2;0.2;0.02;0.18;N/A;N/A;anodic",
      "swv_b;t;swv;100;1;0.08;-0.18;0.25;0.03;0.22;N/A;N/A;anodic",
    ].join("\n");
    const r = parseImportedCsv(csv, "swv");
    if ("error" in r) throw new Error(r.error);
    if (r.mode !== "swv") throw new Error("expected SWV");
    expect(r.measurements).toHaveLength(2);
    expect(r.measurements[0].id).toBe("swv_a");
    expect(r.measurements[0].concentration).toBe(10);
    expect(r.measurements[1].concentration).toBe(100);
    expect(r.measurements[0].points).toHaveLength(2);
    expect(r.measurements[1].points).toHaveLength(2);
  });
});
