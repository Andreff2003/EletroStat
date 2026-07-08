import { describe, expect, it } from "vitest";
import { computeFETVtDetailed, computeFETVt } from "@/utils/fetVt";
import { fetDrainCurrent, addCurrentNoise } from "@/utils/fetModel";
import { EXPECTED_FET_TIME_POINTS, FET_TIME_DURATION_S, FET_TIME_DT_S } from "@/utils/fetConstants";

function syntheticTransfer(vt: number, K = 50, n = 2.0, npts = 51) {
  const out: { vg: number; id: number }[] = [];
  for (let i = 0; i < npts; i++) {
    const vg = -0.5 + (2.0 * i) / (npts - 1);
    out.push({ vg, id: fetDrainCurrent(vg, vt, { K, n }) });
  }
  return out;
}

describe("computeFETVt (sqrt extrapolation)", () => {
  it("recovers Vt within a few mV on a clean synthetic curve", () => {
    const vtTrue = 0.30;
    const curve = syntheticTransfer(vtTrue);
    const r = computeFETVtDetailed(curve);
    expect(r.method).toBe("sqrt_extrapolation");
    expect(r.vt).not.toBeNull();
    expect(Math.abs((r.vt as number) - vtTrue)).toBeLessThan(0.020);
  });

  it("ΔVt preserves sign and magnitude on shifted curves", () => {
    const a = computeFETVt(syntheticTransfer(0.30))!;
    const b = computeFETVt(syntheticTransfer(0.50))!;
    expect((b - a) * 1000).toBeGreaterThan(150); // ≈ 200 mV
  });

  it("returns invalid on too-few points", () => {
    const r = computeFETVtDetailed([{ vg: 0, id: 1 }]);
    expect(r.method).toBe("invalid");
    expect(r.vt).toBeNull();
  });
});

describe("simulation guarantees", () => {
  it("addCurrentNoise never produces negative current", () => {
    for (let i = 0; i < 10000; i++) {
      expect(addCurrentNoise(0.0001, 0.1, 0.5)).toBeGreaterThan(0);
    }
  });
  it("fetDrainCurrent is smooth and monotonic increasing around Vt", () => {
    const vt = 0.3;
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const vg = -0.2 + (1.5 * i) / 99;
      ids.push(fetDrainCurrent(vg, vt, { K: 50, n: 2 }));
    }
    for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThanOrEqual(ids[i - 1] - 1e-9);
  });
});

describe("fet constants", () => {
  it("time response spans 60 s with 0.5 s steps", () => {
    expect(FET_TIME_DURATION_S).toBe(60);
    expect(FET_TIME_DT_S).toBe(0.5);
    expect(EXPECTED_FET_TIME_POINTS).toBe(121);
  });
});
