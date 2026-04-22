import { useMemo } from "react";
import type { EISDataPoint, FETTransferPoint } from "@/hooks/useSimulatedData";

/**
 * ============================================================
 * SIGNAL QUALITY PANEL
 * ============================================================
 * Computes real-time quality metrics from incoming EIS or
 * BioFET data and shows a traffic light + per-metric dots.
 *
 * EIS metrics:
 *  - Semicircle Fit (%): how well points form a semicircle
 *  - Point Noise (Ω):    avg jump between consecutive points
 *  - Rs Stability (Ω):   leftmost Z' value (solution resistance)
 *  - Total Points:       counter
 *
 * BioFET metrics:
 *  - Ion/Ioff Ratio
 *  - Subthreshold Slope (mV/dec)
 *  - Ioff current (µA)
 *  - Baseline Stability (%)
 * ============================================================
 */

type Level = "green" | "yellow" | "red" | "idle";

interface SignalQualityProps {
  mode: "eis" | "fet";
  eisData: EISDataPoint[];
  fetBaseline: FETTransferPoint[];
  fetAnalyte: FETTransferPoint[];
}

// ---- helpers ----

const dotClass = (level: Level) => {
  switch (level) {
    case "green":
      return "bg-graph-eis shadow-[0_0_8px_hsl(var(--graph-line-eis))]";
    case "yellow":
      return "bg-graph-alt shadow-[0_0_8px_hsl(var(--graph-line-alt))]";
    case "red":
      return "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]";
    default:
      return "bg-muted-foreground/40";
  }
};

const lightClass = (level: Level, active: boolean) => {
  if (!active) return "bg-muted/40";
  switch (level) {
    case "green":
      return "bg-graph-eis shadow-[0_0_20px_hsl(var(--graph-line-eis))]";
    case "yellow":
      return "bg-graph-alt shadow-[0_0_20px_hsl(var(--graph-line-alt))]";
    case "red":
      return "bg-destructive shadow-[0_0_20px_hsl(var(--destructive))]";
    default:
      return "bg-muted/40";
  }
};

/** Compute EIS quality metrics. */
function computeEISMetrics(data: EISDataPoint[]) {
  if (data.length < 3) {
    return {
      level: "idle" as Level,
      semicircleFit: 0,
      pointNoise: 0,
      rsStability: 0,
      totalPoints: data.length,
      semicircleLevel: "idle" as Level,
      noiseLevel: "idle" as Level,
      rsLevel: "idle" as Level,
      pointsLevel: "idle" as Level,
    };
  }

  // Rs ≈ leftmost Z' (smallest real part)
  const rs = Math.min(...data.map((d) => d.zReal));

  // Point noise: average Euclidean jump between consecutive (Z', Z'') points
  let noiseSum = 0;
  for (let i = 1; i < data.length; i++) {
    const dx = data[i].zReal - data[i - 1].zReal;
    const dy = data[i].zImag - data[i - 1].zImag;
    noiseSum += Math.sqrt(dx * dx + dy * dy);
  }
  const pointNoise = noiseSum / (data.length - 1);

  // Semicircle fit: fit a circle through (Z', -Z'') and measure RMS residual
  // as a percentage of the radius. 100% = perfect circle.
  const xs = data.map((d) => d.zReal);
  const ys = data.map((d) => -d.zImag); // Nyquist convention
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  // Algebraic circle fit (Kåsa method)
  let Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0;
  for (let i = 0; i < n; i++) {
    const u = xs[i] - meanX;
    const v = ys[i] - meanY;
    const z = u * u + v * v;
    Sxx += u * u;
    Syy += v * v;
    Sxy += u * v;
    Sxz += u * z;
    Syz += v * z;
  }
  const det = Sxx * Syy - Sxy * Sxy;
  let fitPct = 0;
  if (Math.abs(det) > 1e-9) {
    const uc = (Sxz * Syy - Syz * Sxy) / (2 * det);
    const vc = (Sxx * Syz - Sxy * Sxz) / (2 * det);
    const cx = uc + meanX;
    const cy = vc + meanY;
    const r = Math.sqrt(uc * uc + vc * vc + (Sxx + Syy) / n);
    let resSum = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt((xs[i] - cx) ** 2 + (ys[i] - cy) ** 2) - r;
      resSum += d * d;
    }
    const rms = Math.sqrt(resSum / n);
    fitPct = Math.max(0, Math.min(100, (1 - rms / Math.max(r, 1e-6)) * 100));
  }

  // Per-metric levels
  const semicircleLevel: Level =
    fitPct > 85 ? "green" : fitPct > 65 ? "yellow" : "red";
  const noiseLevel: Level =
    pointNoise < 15 ? "green" : pointNoise < 30 ? "yellow" : "red";
  const rsLevel: Level = rs > 0 && rs < 1e5 ? "green" : "yellow";
  const pointsLevel: Level = data.length >= 20 ? "green" : "yellow";

  // Overall traffic light
  let level: Level = "red";
  if (fitPct > 85 && pointNoise < 15) level = "green";
  else if (fitPct > 65 || pointNoise < 30) level = "yellow";

  return {
    level,
    semicircleFit: fitPct,
    pointNoise,
    rsStability: rs,
    totalPoints: data.length,
    semicircleLevel,
    noiseLevel,
    rsLevel,
    pointsLevel,
  };
}

/** Compute BioFET quality metrics from baseline transfer curve. */
function computeFETMetrics(data: FETTransferPoint[]) {
  if (data.length < 5) {
    return {
      level: "idle" as Level,
      ionIoff: 0,
      subthresholdSlope: 0,
      ioff: 0,
      baselineStability: 0,
      ionLevel: "idle" as Level,
      ssLevel: "idle" as Level,
      ioffLevel: "idle" as Level,
      stabilityLevel: "idle" as Level,
    };
  }

  const ids = data.map((d) => Math.abs(d.id));
  const ion = Math.max(...ids);
  const ioff = Math.max(Math.min(...ids), 1e-6); // avoid div-by-zero
  const ionIoff = ion / ioff;

  // Subthreshold slope: dVg / d(log10(Id)) in mV/dec, computed in subthreshold region
  // Use the lower 30% of currents (excluding the absolute minimum noise band).
  const sortedByVg = [...data].sort((a, b) => a.vg - b.vg);
  const subThreshold = sortedByVg.filter((p) => {
    const ratio = Math.abs(p.id) / ion;
    return ratio > 0.001 && ratio < 0.3;
  });
  let ss = 0;
  if (subThreshold.length >= 2) {
    const first = subThreshold[0];
    const last = subThreshold[subThreshold.length - 1];
    const dVg = (last.vg - first.vg) * 1000; // V → mV
    const dLog = Math.log10(Math.abs(last.id)) - Math.log10(Math.abs(first.id));
    if (Math.abs(dLog) > 1e-6) ss = Math.abs(dVg / dLog);
  }

  // Baseline stability: 100 * (1 - stdev/mean) of the OFF region (lowest 20% currents)
  const offBand = [...ids].sort((a, b) => a - b).slice(0, Math.max(3, Math.floor(ids.length * 0.2)));
  const mean = offBand.reduce((a, b) => a + b, 0) / offBand.length;
  const variance = offBand.reduce((a, b) => a + (b - mean) ** 2, 0) / offBand.length;
  const std = Math.sqrt(variance);
  const stability = mean > 0 ? Math.max(0, Math.min(100, (1 - std / mean) * 100)) : 0;

  const ionLevel: Level = ionIoff > 100 ? "green" : ionIoff > 20 ? "yellow" : "red";
  const ssLevel: Level = ss > 0 && ss < 200 ? "green" : ss < 400 ? "yellow" : "red";
  const ioffLevel: Level = ioff < 1 ? "green" : ioff < 5 ? "yellow" : "red";
  const stabilityLevel: Level = stability > 90 ? "green" : stability > 70 ? "yellow" : "red";

  let level: Level = "red";
  if (ionIoff > 100 && ss > 0 && ss < 200) level = "green";
  else if (ionIoff > 20 || (ss > 0 && ss < 400)) level = "yellow";

  return {
    level,
    ionIoff,
    subthresholdSlope: ss,
    ioff,
    baselineStability: stability,
    ionLevel,
    ssLevel,
    ioffLevel,
    stabilityLevel,
  };
}

const DIAGNOSTICS: Record<Level, string> = {
  green: "Electrode ready. Clean signal detected.",
  yellow: "Acceptable signal. Consider cleaning electrode.",
  red: "Poor signal. Check connections and electrode surface.",
  idle: "Waiting for measurement data...",
};

const HEADLINES: Record<Level, string> = {
  green: "Good Signal",
  yellow: "Acceptable",
  red: "Poor Signal — Check Electrode",
  idle: "Idle",
};

interface MetricRowProps {
  label: string;
  value: string;
  level: Level;
}

const MetricRow = ({ label, value, level }: MetricRowProps) => (
  <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass(level)}`} />
      <span className="text-[11px] font-mono text-muted-foreground truncate">{label}</span>
    </div>
    <span className="text-xs font-mono text-foreground tabular-nums">{value}</span>
  </div>
);

const SignalQuality = ({ mode, eisData, fetBaseline }: SignalQualityProps) => {
  const eisMetrics = useMemo(() => computeEISMetrics(eisData), [eisData]);
  const fetMetrics = useMemo(() => computeFETMetrics(fetBaseline), [fetBaseline]);

  const m = mode === "eis" ? eisMetrics : fetMetrics;
  const level: Level = m.level;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Signal Quality
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {mode === "eis" ? "EIS" : "BioFET"}
        </span>
      </div>

      {/* Traffic light */}
      <div className="flex items-center gap-4 mb-4 p-3 rounded-md bg-secondary/40">
        <div className="flex flex-col gap-2 p-2 rounded-md bg-background/60 border border-border">
          <div className={`w-6 h-6 rounded-full transition-all ${lightClass("red", level === "red")}`} />
          <div className={`w-6 h-6 rounded-full transition-all ${lightClass("yellow", level === "yellow")}`} />
          <div className={`w-6 h-6 rounded-full transition-all ${lightClass("green", level === "green")}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono font-semibold text-foreground">
            {HEADLINES[level]}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 leading-snug">
            {DIAGNOSTICS[level]}
          </div>
        </div>
      </div>

      {/* Per-metric rows */}
      <div className="space-y-0">
        {mode === "eis" ? (
          <>
            <MetricRow
              label="Semicircle Fit"
              value={`${eisMetrics.semicircleFit.toFixed(1)} %`}
              level={eisMetrics.semicircleLevel}
            />
            <MetricRow
              label="Point Noise"
              value={`${eisMetrics.pointNoise.toFixed(1)} Ω`}
              level={eisMetrics.noiseLevel}
            />
            <MetricRow
              label="Rs Stability"
              value={`${eisMetrics.rsStability.toFixed(0)} Ω`}
              level={eisMetrics.rsLevel}
            />
            <MetricRow
              label="Total Points"
              value={`${eisMetrics.totalPoints}`}
              level={eisMetrics.pointsLevel}
            />
          </>
        ) : (
          <>
            <MetricRow
              label="Ion / Ioff Ratio"
              value={fetMetrics.ionIoff > 0 ? fetMetrics.ionIoff.toFixed(1) : "—"}
              level={fetMetrics.ionLevel}
            />
            <MetricRow
              label="Subthreshold Slope"
              value={fetMetrics.subthresholdSlope > 0 ? `${fetMetrics.subthresholdSlope.toFixed(0)} mV/dec` : "—"}
              level={fetMetrics.ssLevel}
            />
            <MetricRow
              label="Ioff Current"
              value={`${fetMetrics.ioff.toFixed(2)} µA`}
              level={fetMetrics.ioffLevel}
            />
            <MetricRow
              label="Baseline Stability"
              value={`${fetMetrics.baselineStability.toFixed(1)} %`}
              level={fetMetrics.stabilityLevel}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SignalQuality;