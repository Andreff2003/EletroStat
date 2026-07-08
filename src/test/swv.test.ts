import { describe, expect, it } from "vitest";
import {
  analyzeSWV,
  computeINet,
  correctBaseline,
  detectSWVPeak,
  generateSWVProgram,
  validateSWVParameters,
} from "@/utils/swvMetrics";
import type { SWVDataPoint, SWVParameters } from "@/types/swv";

const baseParams: SWVParameters = {
  startE: -0.2,
  endE: 0.6,
  step_mV: 4,
  amplitude_mV: 25,
  frequency_Hz: 25,
  quietTime_s: 1,
  direction: "anodic",
  baselineMethod: "auto",
};

function makeGaussianData(sign = 1, noise = 0.005): SWVDataPoint[] {
  const prog = generateSWVProgram({ ...baseParams, step_mV: 4 });
  const Ep = 0.22, sigma = 0.04, Ipk = 1.0 * sign;
  return prog.map((s) => {
    const iNet = Ipk * Math.exp(-0.5 * ((s.E - Ep) / sigma) ** 2)
      + 0.02 + 0.05 * s.E // baseline
      + (Math.random() - 0.5) * noise;
    const iFwd = 0.1 + 0.5 * iNet;
    const iRev = 0.1 - 0.5 * iNet;
    return {
      E: s.E,
      IForward: iFwd,
      IReverse: iRev,
      INet: iFwd - iRev,
      time: s.time,
      index: s.index,
      direction: s.direction,
    };
  });
}

describe("SWV — potential program", () => {
  it("generates expected number of steps", () => {
    const p = generateSWVProgram({ ...baseParams, step_mV: 10 }); // 0.8 V / 0.01 = 80 → 81 pts
    expect(p.length).toBe(81);
    expect(p[0].E).toBeCloseTo(-0.2, 6);
    expect(p[p.length - 1].E).toBeCloseTo(0.6, 6);
  });
  it("supports cathodic sweep (endE < startE)", () => {
    const p = generateSWVProgram({ ...baseParams, startE: 0.5, endE: -0.1, direction: "cathodic" });
    expect(p[0].E).toBe(0.5);
    expect(p[p.length - 1].E).toBeLessThan(0);
  });
});

describe("SWV — INet", () => {
  it("computes IForward - IReverse", () => {
    expect(computeINet(2.5, 1.0)).toBeCloseTo(1.5);
    expect(Number.isNaN(computeINet(NaN, 1))).toBe(true);
  });
});

describe("SWV — baseline correction", () => {
  it("removes a known linear baseline from a Gaussian", () => {
    const prog = generateSWVProgram({ ...baseParams, step_mV: 4 });
    const E = prog.map((s) => s.E);
    const a = 0.1, b = 0.02;
    const gauss = E.map((e) => Math.exp(-0.5 * ((e - 0.22) / 0.04) ** 2));
    const iNet = gauss.map((g, i) => g + a * E[i] + b);
    const res = correctBaseline(E, iNet, "linear_edges");
    // Peak-side corrected value should be close to Gaussian peak (~1), not raw (~1 + a*E+b).
    const corr = iNet.map((y, i) => y - res.baseline[i]);
    const peak = Math.max(...corr);
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.1);
  });
});

describe("SWV — peak detection", () => {
  it("detects positive (anodic) peak", () => {
    const d = makeGaussianData(1, 0.002);
    const { metrics } = analyzeSWV(d, "linear_edges");
    expect(metrics.peakDetected).toBe(true);
    expect(metrics.peakPolarity).toBe("anodic");
    expect(metrics.peakPotential_V ?? 0).toBeGreaterThan(0.15);
    expect(metrics.peakPotential_V ?? 0).toBeLessThan(0.30);
    expect((metrics.snr ?? 0)).toBeGreaterThan(5);
    expect(metrics.halfPeakWidth_mV ?? 0).toBeGreaterThan(20);
    expect(metrics.halfPeakWidth_mV ?? 0).toBeLessThan(300);
  });
  it("detects negative (cathodic) peak", () => {
    const d = makeGaussianData(-1, 0.002);
    const { metrics } = analyzeSWV(d, "linear_edges");
    expect(metrics.peakDetected).toBe(true);
    expect(metrics.peakPolarity).toBe("cathodic");
  });
});

describe("SWV — validation", () => {
  it("flags invalid parameters", () => {
    const v = validateSWVParameters({ ...baseParams, startE: 0.1, endE: 0.1 });
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
  it("warns on high amplitude", () => {
    const v = validateSWVParameters({ ...baseParams, amplitude_mV: 80 });
    expect(v.ok).toBe(true);
    expect(v.warnings.join("|")).toMatch(/Amplitude/);
  });
});

describe("SWV — analyze pipeline empty guard", () => {
  it("handles empty input", () => {
    const { metrics } = analyzeSWV([], "auto");
    expect(metrics.peakDetected).toBe(false);
  });
});

describe("SWV — detectSWVPeak edge case", () => {
  it("returns unknown polarity when too few points", () => {
    const r = detectSWVPeak([0, 0.1], [0.1, 0.2], [0.1, 0.2], "none", "none", null, null, []);
    expect(r.peakDetected).toBe(false);
    expect(r.peakPolarity).toBe("unknown");
  });
});

describe("SWV — invariants", () => {
  it("INet equals IForward - IReverse in the generator", () => {
    const d = makeGaussianData(1, 0);
    for (const p of d) {
      expect(p.INet).toBeCloseTo(p.IForward - p.IReverse, 12);
    }
  });
  it("baseline correction does not mutate raw forward/reverse currents", () => {
    const d = makeGaussianData(1, 0.002);
    const snapshot = d.map((p) => ({ f: p.IForward, r: p.IReverse, net: p.INet }));
    const { corrected } = analyzeSWV(d, "linear_edges");
    for (let i = 0; i < d.length; i++) {
      expect(d[i].IForward).toBe(snapshot[i].f);
      expect(d[i].IReverse).toBe(snapshot[i].r);
      expect(d[i].INet).toBe(snapshot[i].net);
      // Corrected block carries baseline & ICorrected without touching the raw fields.
      expect(corrected[i].IForward).toBe(snapshot[i].f);
      expect(corrected[i].IReverse).toBe(snapshot[i].r);
    }
  });
  it("SNR remains finite for noise-free data (fallback engaged)", () => {
    const d = makeGaussianData(1, 0); // zero noise
    const { metrics } = analyzeSWV(d, "linear_edges");
    expect(metrics.snr).not.toBeNull();
    expect(Number.isFinite(metrics.snr as number)).toBe(true);
    expect(metrics.peakDetected).toBe(true);
  });
  it("peakCurrentCorrected differs from raw when baseline is non-zero", () => {
    const d = makeGaussianData(1, 0.001);
    const { metrics } = analyzeSWV(d, "linear_edges");
    expect(metrics.peakCurrentRaw_uA).not.toBeNull();
    expect(metrics.peakCurrentCorrected_uA).not.toBeNull();
    expect(
      Math.abs((metrics.peakCurrentRaw_uA as number) - (metrics.peakCurrentCorrected_uA as number)),
    ).toBeGreaterThan(1e-6);
  });
  it("empty data returns a full SWVMetrics shape (no missing fields)", () => {
    const { metrics } = analyzeSWV([], "auto");
    expect(metrics).toMatchObject({
      peakDetected: false,
      peakPolarity: "unknown",
      baselineMethod: "auto",
      baselineMethodUsed: "auto",
      snr: null,
      noiseRms_uA: null,
    });
  });
});
