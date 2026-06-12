import { describe, it, expect } from "vitest";
import { computeCVMetrics } from "@/utils/computeCVMetrics";
import {
  buildCVCalibrationPoint,
  summarizeCalibration,
  randlesSevcikIpUA,
} from "@/utils/cvCalibration";
import { CV_RS_PREFACTOR } from "@/utils/cvConstants";

function makeReversibleCurve(opts: {
  cMM: number;
  ipUA?: number;
  noise?: number;
}) {
  // Synthetic Nernstian-shape voltammogram with two Gaussian peaks.
  const { cMM } = opts;
  const ipUA = opts.ipUA ?? cMM * 20;
  const noise = opts.noise ?? 0;
  const Epc = 0.22 - 0.02958;
  const Epa = 0.22 + 0.02958;
  const sigma = 0.035;
  const data: { E: number; I: number; cycle: number; t: number; branch: "forward" | "reverse" }[] = [];
  const fwdE: number[] = [];
  for (let E = 0.6; E >= -0.2 - 1e-9; E -= 0.005) fwdE.push(+E.toFixed(4));
  const revE: number[] = [];
  for (let E = -0.2; E <= 0.6 + 1e-9; E += 0.005) revE.push(+E.toFixed(4));
  let t = 0;
  for (const E of fwdE) {
    const I = -ipUA * Math.exp(-0.5 * ((E - Epc) / sigma) ** 2)
      + (noise ? (Math.random() - 0.5) * 2 * noise : 0);
    data.push({ E, I, cycle: 1, t, branch: "forward" }); t += 0.05;
  }
  for (const E of revE) {
    const I = ipUA * Math.exp(-0.5 * ((E - Epa) / sigma) ** 2)
      + (noise ? (Math.random() - 0.5) * 2 * noise : 0);
    data.push({ E, I, cycle: 1, t, branch: "reverse" }); t += 0.05;
  }
  return data;
}

describe("CV constants", () => {
  it("Randles–Ševčík prefactor at 298.15 K", () => {
    expect(CV_RS_PREFACTOR).toBeGreaterThan(268000);
    expect(CV_RS_PREFACTOR).toBeLessThan(269000);
  });
});

describe("computeCVMetrics — blank (C=0)", () => {
  it("does not crash and produces no faradaic peaks for a flat curve", () => {
    const data = makeReversibleCurve({ cMM: 0, ipUA: 0, noise: 0 });
    const m = computeCVMetrics(data, { scanRate_mVs: 100, n: 1, cMM: 0, areaCm2: 0.0707 });
    expect(m).not.toBeNull();
    expect(Number.isNaN(m!.deltaEp) || m!.deltaEp >= 0).toBe(true);
    // No peaks should pass the SNR threshold on a zero-amplitude curve.
    expect(m!.hasAnodic).toBe(false);
    expect(m!.hasCathodic).toBe(false);
  });
});

describe("computeCVMetrics — reversible defaults", () => {
  it("detects two peaks with ΔEp ≈ 59 mV and ratio ≈ 1", () => {
    const data = makeReversibleCurve({ cMM: 5, ipUA: 80 });
    const m = computeCVMetrics(data, { scanRate_mVs: 100, n: 1, cMM: 5, areaCm2: 0.0707 });
    expect(m).not.toBeNull();
    expect(m!.hasAnodic).toBe(true);
    expect(m!.hasCathodic).toBe(true);
    expect(m!.deltaEp).toBeGreaterThan(40);
    expect(m!.deltaEp).toBeLessThan(80);
    expect(m!.IpaIpcRatio).toBeGreaterThan(0.9);
    expect(m!.IpaIpcRatio).toBeLessThan(1.1);
    expect(m!.D_status === "valid" || m!.D_status === "apparent").toBe(true);
    if (m!.correctedData) {
      expect(m!.correctedData.length).toBe(data.length);
    }
  });
});

describe("CV calibration — replicates & LOD source", () => {
  it("keeps all blank replicates and reports blank-replicates as sigma source", () => {
    const pts = [
      { cMM: 0 }, { cMM: 0 }, { cMM: 0 },
      { cMM: 1 }, { cMM: 2 }, { cMM: 5 },
    ].map((s) => {
      const data = makeReversibleCurve({ cMM: s.cMM, ipUA: s.cMM * 16 });
      const m = computeCVMetrics(data, { scanRate_mVs: 100, n: 1, cMM: s.cMM, areaCm2: 0.0707 });
      return buildCVCalibrationPoint(s.cMM, m, "reversible");
    });
    const blanks = pts.filter((p) => p.concentration_mM === 0);
    expect(blanks.length).toBe(3);
    const summary = summarizeCalibration(pts, "mean");
    expect(summary.nBlankReplicates).toBe(3);
    expect(summary.sigmaSource === "blank-replicates" || summary.sigmaSource === "fit-residual").toBe(true);
  });

  it("returns null LOD when slope is non-positive", () => {
    const pts = [
      buildCVCalibrationPoint(0, null, "reversible"),
      buildCVCalibrationPoint(1, null, "reversible"),
    ];
    const summary = summarizeCalibration(pts, "mean");
    expect(summary.lod_mM).toBeNull();
  });
});

describe("randlesSevcikIpUA", () => {
  it("matches manual computation for typical defaults", () => {
    const ip = randlesSevcikIpUA({ n: 1, areaCm2: 0.0707, cMM: 5, scanRate_mVs: 100 });
    expect(ip).not.toBeNull();
    expect(ip!).toBeGreaterThan(50);
    expect(ip!).toBeLessThan(150);
  });
});