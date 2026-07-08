import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCVExportText,
  type CVExportParams,
} from "@/utils/csvExport";
import type { CVDataPoint } from "@/hooks/useSimulatedCVData";
import {
  sanitizeMeasurementNotes,
  createMeasurementId,
  shortNotesSummary,
  hasAnyNotes,
  type MeasurementNotes,
} from "@/utils/measurementNotes";
import {
  loadSession,
  saveSession,
  clearSession,
  type StoredCVMeasurement,
  type StoredEISMeasurement,
  type StoredFETMeasurement,
} from "@/utils/sessionStore";

const BASE_CV_PARAMS: CVExportParams = {
  scanRate: 100,
  eStart: -0.2,
  eVertex1: 0.6,
  eVertex2: -0.2,
  nCycles: 1,
  n: 1,
  cMM: 5,
  areaCm2: 0.07,
  cvModel: "reversible",
  measurementId: "cv_test_1",
  measurementTimestamp: 1700000000000,
};

const fakeData: CVDataPoint[] = [
  { t: 0, E: -0.2, I: 1, cycle: 1, branch: "forward" },
  { t: 1, E: 0.3, I: 5, cycle: 1, branch: "forward" },
  { t: 2, E: 0.3, I: -5, cycle: 1, branch: "reverse" },
];

describe("CV CSV — source-aware metadata", () => {
  it("simulated reversible — advertises solver provenance", () => {
    const csv = buildCVExportText(fakeData, null, BASE_CV_PARAMS, "simulated");
    expect(csv).toContain("simulation_model;reversible-diffusion");
    expect(csv).toContain("solver_type;implicit-diffusion-nernst");
    expect(csv).not.toContain("not_applicable");
  });

  it("live — never advertises solver as data source", () => {
    const csv = buildCVExportText(fakeData, null, BASE_CV_PARAMS, "live");
    expect(csv).toContain("simulation_model;not_applicable_live_hardware_data");
    expect(csv).toContain("solver_type;not_applicable");
    expect(csv).not.toContain("simulation_model;reversible-diffusion");
    expect(csv).not.toContain("solver_type;implicit-diffusion-nernst");
    expect(csv).toContain("solver_step_V;n/a");
    expect(csv).toContain("solver_D_cm2_s;n/a");
  });

  it("imported — uses imported provenance marker", () => {
    const csv = buildCVExportText(fakeData, null, BASE_CV_PARAMS, "imported");
    expect(csv).toContain("simulation_model;not_applicable_imported_data");
    expect(csv).toContain("solver_type;not_applicable");
  });

  it("quasi-reversible simulated — keeps butler-volmer marker", () => {
    const csv = buildCVExportText(fakeData, null, { ...BASE_CV_PARAMS, cvModel: "quasi-reversible" }, "simulated");
    expect(csv).toContain("simulation_model;quasi-reversible-approx");
    expect(csv).toContain("solver_type;butler-volmer-cottrell-approx");
  });
});

describe("Generic measurement notes helpers", () => {
  it("sanitizes and parity-checks CV alias", () => {
    const raw: MeasurementNotes = {
      title: "  My run  ",
      sampleId: "S-1",
      notes: "line1\nline2",
      tags: [" a ", "", "b"],
    };
    const s = sanitizeMeasurementNotes(raw);
    expect(s).toBeDefined();
    expect(s!.title).toBe("My run");
    expect(s!.tags).toEqual(["a", "b"]);
  });

  it("hasAnyNotes returns false for empty", () => {
    expect(hasAnyNotes(undefined)).toBe(false);
    expect(hasAnyNotes({})).toBe(false);
    expect(hasAnyNotes({ sampleId: "x" })).toBe(true);
  });

  it("shortNotesSummary collapses newlines", () => {
    const s = shortNotesSummary({ notes: "a\nb\nc", sampleId: "S" });
    expect(s).not.toContain("\n");
    expect(s).toContain("S");
  });

  it("createMeasurementId honors prefix", () => {
    const id = createMeasurementId("eis");
    expect(id.startsWith("eis_")).toBe(true);
    const id2 = createMeasurementId("fet");
    expect(id2.startsWith("fet_")).toBe(true);
  });
});

describe("sessionStore — StoredCVMeasurement & retrocompat", () => {
  beforeEach(() => {
    clearSession();
  });

  it("round-trips CV measurement with notes/metrics/data preserved", () => {
    const m: StoredCVMeasurement = {
      id: "m1",
      mode: "cv",
      timestamp: 123,
      measurementId: "cv_x",
      measurementTimestamp: 456,
      notes: { sampleId: "S-9", notes: "alpha" },
      params: {
        scanRate: 100, eStart: -0.2, eVertex1: 0.6, eVertex2: -0.2,
        nCycles: 1, n: 1, cMM: 5, areaCm2: 0.07, cvModel: "reversible",
      },
      data: fakeData,
      metrics: null,
    };
    saveSession([m]);
    const loaded = loadSession();
    expect(loaded).toHaveLength(1);
    const first = loaded[0];
    expect(first.mode).toBe("cv");
    if (first.mode !== "cv") throw new Error("type");
    expect(first.measurementId).toBe("cv_x");
    expect(first.notes?.sampleId).toBe("S-9");
    expect(first.data).toHaveLength(3);
  });

  it("legacy EIS measurement without notes still loads", () => {
    const legacy: StoredEISMeasurement = {
      id: "m2",
      mode: "eis",
      timestamp: 1,
      concentration: 0,
      params: { freqMin: 1, freqMax: 1e5, points: 50, amplitude: 10 },
      data: [],
      extracted: {},
    };
    saveSession([legacy]);
    const loaded = loadSession();
    expect(loaded[0].mode).toBe("eis");
  });

  it("legacy FET measurement without notes still loads", () => {
    const legacy: StoredFETMeasurement = {
      id: "m3",
      mode: "fet",
      timestamp: 1,
      concentration: 0,
      params: { vgMin: -0.5, vgMax: 0.5, vgStep: 10, intervalMs: 100 },
      baseline: [],
      analyte: [],
      timeData: [],
      markers: [],
      extracted: {},
    };
    saveSession([legacy]);
    const loaded = loadSession();
    expect(loaded[0].mode).toBe("fet");
  });
});

describe("CV CSV — notes with newlines stay safe", () => {
  it("multiline notes do not split rows", () => {
    const params: CVExportParams = {
      ...BASE_CV_PARAMS,
      notes: { notes: "line1\nline2\nline3", sampleId: "S" },
    };
    const csv = buildCVExportText(fakeData, null, params, "simulated");
    const notesRow = csv.split("\n").find((l) => l.startsWith("notes;"));
    expect(notesRow).toBeDefined();
    expect(notesRow!).toContain("|"); // newlines replaced with " | "
    expect(notesRow!).not.toContain("\nline2");
  });
});
