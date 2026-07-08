import { describe, it, expect } from "vitest";
import {
  computeFETTransferMetrics,
  inferFETResponseSign,
  applyFETResponseMode,
} from "@/utils/fetMetrics";
import { fetDrainCurrent } from "@/utils/fetModel";
import type { FETTransferPoint } from "@/hooks/useSimulatedData";

function syntheticTransfer(vt: number, npts = 51): FETTransferPoint[] {
  const out: FETTransferPoint[] = [];
  for (let i = 0; i < npts; i++) {
    const vg = -0.5 + (2.0 * i) / (npts - 1);
    out.push({ vg, id: fetDrainCurrent(vg, vt, { K: 50, n: 2 }) });
  }
  return out;
}

describe("computeFETTransferMetrics", () => {
  it("computes ΔVt from baseline/analyte of the same measurement", () => {
    const baseline = syntheticTransfer(0.30);
    const analyte = syntheticTransfer(0.35);
    const m = computeFETTransferMetrics(baseline, analyte, { responseMode: "signed" });
    expect(m.vtBaseline).not.toBeNull();
    expect(m.vtAnalyte).not.toBeNull();
    expect(m.deltaVt_mV).not.toBeNull();
    expect(m.deltaVt_mV!).toBeGreaterThan(30);
    expect(m.deltaVt_mV!).toBeLessThan(70);
    expect(m.deltaVt_mV_signed).toBe(m.deltaVt_mV);
    expect(m.calibrationSignal_mV_used).toBe(m.deltaVt_mV);
  });

  it("auto mode infers negative sign and aligns Langmuir signal positive", () => {
    const baseline = syntheticTransfer(0.30);
    const analyte = syntheticTransfer(0.25); // negative ΔVt
    const sign = inferFETResponseSign([-12, -10, -15]);
    expect(sign).toBe(-1);
    const m = computeFETTransferMetrics(baseline, analyte, { responseMode: "auto", responseSign: sign });
    expect(m.deltaVt_mV!).toBeLessThan(0);
    expect(m.calibrationSignal_mV_used!).toBeGreaterThan(0);
  });

  it("absolute mode returns |ΔVt|", () => {
    const r = applyFETResponseMode(-25, "absolute");
    expect(r.calibrationSignal_mV_used).toBe(25);
  });
});
