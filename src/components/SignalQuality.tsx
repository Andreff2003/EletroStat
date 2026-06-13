import { useMemo } from "react";
import type { EISDataPoint, FETTransferPoint } from "@/hooks/useSimulatedData";
import type { CVMetrics } from "@/utils/computeCVMetrics";

/**
 * ============================================================
 * SIGNAL QUALITY PANEL — EIS / BioFET / CV
 * ============================================================
 */

type Level = "green" | "yellow" | "red" | "idle";

interface SignalQualityProps {
  mode: "eis" | "fet" | "cv";
  eisData: EISDataPoint[];
  fetBaseline: FETTransferPoint[];
  fetAnalyte: FETTransferPoint[];
  cnlsChiSquared?: number | null;
  separatorZReal?: number | null;
  fetVtBaseline?: number | null;
  fetVtAnalyte?: number | null;
  cvMetrics?: CVMetrics | null;
  cvNElectrons?: number;
  cvDeltaEpToleranceMv?: number;
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
function computeEISMetrics(
  dataAll: EISDataPoint[],
  cnlsChiSquared?: number | null,
  separatorZReal?: number | null,
) {
  // Restrict the geometric semicircle metric to the semicircle region when a
  // separator is available (Warburg tail would otherwise corrupt circle fit).
  const data = dataAll;
  const semiData =
    separatorZReal != null
      ? dataAll.filter((d) => d.zReal <= separatorZReal)
      : dataAll;

  if (data.length < 10) {
    return {
      level: "idle" as Level,
      ready: false,
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

  const reals = data.map((d) => d.zReal);
  const maxR = Math.max(...reals);
  const minR = Math.min(...reals);

  // 1. Semicircle Fit (%) — when the manual CNLS fit is available, derive from
  // its modulus-weighted chi² (sqrt(chi²)*100 ≈ RMSE %). Otherwise fall back to
  // a purely geometric circle-fit on the semicircle region only.
  let fitPct: number;
  if (Number.isFinite(cnlsChiSquared ?? NaN) && (cnlsChiSquared as number) >= 0) {
    const errPct = Math.sqrt(cnlsChiSquared as number) * 100;
    fitPct = Math.max(0, Math.min(100, 100 - errPct));
  } else {
    const sReals = semiData.map((d) => d.zReal);
    const sMax = sReals.length ? Math.max(...sReals) : maxR;
    const sMin = sReals.length ? Math.min(...sReals) : minR;
    const centerX = (sMax + sMin) / 2;
    const R = (sMax - sMin) / 2;
    const pts = semiData.length >= 5 ? semiData : data;
    const distances = pts.map((d) =>
      Math.sqrt((d.zReal - centerX) ** 2 + d.zImag ** 2)
    );
    const meanD = distances.reduce((a, b) => a + b, 0) / distances.length;
    const variance =
      distances.reduce((a, b) => a + (b - meanD) ** 2, 0) / distances.length;
    const stdDev = Math.sqrt(variance);
    fitPct = R > 1e-6
      ? Math.max(0, Math.min(100, 100 - (stdDev / R) * 100))
      : 0;
  }

  // 2. Point Noise (Ω) — avg consecutive Euclidean delta (need ≥5 points)
  let pointNoise = 0;
  if (data.length >= 5) {
    let noiseSum = 0;
    for (let i = 1; i < data.length; i++) {
      const dx = data[i].zReal - data[i - 1].zReal;
      const dy = data[i].zImag - data[i - 1].zImag;
      noiseSum += Math.sqrt(dx * dx + dy * dy);
    }
    pointNoise = noiseSum / (data.length - 1);
  }

  // 3. Rs Stability — minimum Z' (typical 50–2000 Ω)
  const rs = minR;

  // Per-metric levels
  const semicircleLevel: Level =
    fitPct > 90 ? "green" : fitPct > 77 ? "yellow" : "red";
  const noiseLevel: Level =
    pointNoise < 15 ? "green" : pointNoise < 30 ? "yellow" : "red";
  const rsLevel: Level =
    rs >= 50 && rs <= 2000 ? "green" : rs > 0 && rs < 5000 ? "yellow" : "red";
  const pointsLevel: Level = data.length >= 20 ? "green" : "yellow";

  // Overall traffic light
  let level: Level = "red";
  if (fitPct > 90 && pointNoise < 15) level = "green";
  else if (fitPct > 77 || pointNoise < 30) level = "yellow";

  return {
    level,
    ready: true,
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

/** Compute BioFET quality metrics from analyte + baseline curves. */
function computeFETMetrics(analyte: FETTransferPoint[], baseline: FETTransferPoint[]) {
  if (analyte.length < 10) {
    return {
      level: "idle" as Level,
      ready: false,
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

  const ids = analyte.map((d) => Math.abs(d.id));

  // 1. Ion / Ioff Ratio (clamp Ioff at 0.01 to avoid div-by-zero)
  const ion = Math.max(...ids);
  const ioffRaw = Math.min(...ids);
  const ioffSafe = Math.max(ioffRaw, 0.01);
  const ionIoff = ion / ioffSafe;

  // 2. Subthreshold Slope (mV/dec)
  // Fit local log10(id) vs Vg windows in the rising transition region. This
  // avoids depending on the Ioff floor and ignores noisy deep-cutoff points.
  const sortedByVg = [...analyte].sort((a, b) => a.vg - b.vg);
  const transRegion = sortedByVg.filter((p) => {
    const v = Math.abs(p.id);
    return v > 1e-6 && v < 0.2 * ion;
  });
  let ss = 0;
  let bestSlope = 0;
  for (let windowSize = 4; windowSize <= 6; windowSize++) {
    for (let start = 0; start + windowSize <= transRegion.length; start++) {
      const window = transRegion.slice(start, start + windowSize);
      const xs = window.map((p) => p.vg);
      const ys = window.map((p) => Math.log10(Math.max(Math.abs(p.id), 1e-12)));
      const n = xs.length;
      const sumX = xs.reduce((a, b) => a + b, 0);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumXY = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
      const sumX2 = xs.reduce((a, b) => a + b * b, 0);
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) <= 1e-12) continue;

      const slope = (n * sumXY - sumX * sumY) / denom;
      if (slope <= 0.1) continue;

      const intercept = (sumY - slope * sumX) / n;
      const meanY = sumY / n;
      const total = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
      const residual = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
      const rSquared = total > 1e-12 ? 1 - residual / total : 0;
      if (rSquared > 0.8 && slope > bestSlope) bestSlope = slope;
    }
  }
  if (bestSlope > 0) ss = 1000 / bestSlope;

  // 3. Ioff (µA) — minimum id in analyte
  const ioff = ioffRaw;

  // 4. Baseline Stability (%) — noise floor of deep cutoff relative to Ion
  let stability = 0;
  if (baseline.length >= 5) {
    const baseSorted = [...baseline].sort((a, b) => a.vg - b.vg);
    const nDeep = Math.max(3, Math.floor(baseSorted.length * 0.1));
    const deepRegion = baseSorted.slice(0, nDeep);
    const deepIds = deepRegion.map((p) => Math.abs(p.id));
    const mean = deepIds.reduce((a, b) => a + b, 0) / deepIds.length;
    const variance = deepIds.reduce((a, b) => a + (b - mean) ** 2, 0) / deepIds.length;
    const std = Math.sqrt(variance);
    const baseIon = Math.max(...baseline.map((d) => Math.abs(d.id)));
    stability = baseIon > 1e-9
      ? Math.max(0, Math.min(100, 100 - (std / baseIon) * 100))
      : 100;
  }

  const ionLevel: Level = ionIoff > 100 ? "green" : ionIoff > 20 ? "yellow" : "red";
  const ssLevel: Level = ss > 0 && ss < 200 ? "green" : ss < 400 ? "yellow" : "red";
  const ioffLevel: Level = ioff < 1 ? "green" : ioff < 5 ? "yellow" : "red";
  const stabilityLevel: Level = stability > 90 ? "green" : stability > 70 ? "yellow" : "red";

  let level: Level = "red";
  if (ionIoff > 100 && ioff < 1 && stability > 70) level = "green";
  else if (ionIoff > 20 || stability > 50) level = "yellow";

  return {
    level,
    ready: true,
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

const MetricRow = ({ label, value, level, title }: MetricRowProps & { title?: string }) => (
  <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0" title={title}>
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass(level)}`} />
      <span className="text-[11px] font-mono text-muted-foreground truncate">
        {label}
        {title ? <span className="ml-1 opacity-60">ⓘ</span> : null}
      </span>
    </div>
    <span className="text-xs font-mono text-foreground tabular-nums">{value}</span>
  </div>
);

const SignalQuality = ({ mode, eisData, fetBaseline, fetAnalyte, cnlsChiSquared, separatorZReal, fetVtBaseline, fetVtAnalyte, cvMetrics, cvNElectrons = 1, cvDeltaEpToleranceMv = 20 }: SignalQualityProps) => {
  const eisMetrics = useMemo(
    () => computeEISMetrics(eisData, cnlsChiSquared, separatorZReal),
    [eisData, cnlsChiSquared, separatorZReal],
  );
  const fetMetrics = useMemo(
    () => computeFETMetrics(fetAnalyte, fetBaseline),
    [fetAnalyte, fetBaseline]
  );

  const deltaVtMv =
    fetVtBaseline != null && fetVtAnalyte != null && Number.isFinite(fetVtBaseline) && Number.isFinite(fetVtAnalyte)
      ? (fetVtAnalyte - fetVtBaseline) * 1000
      : null;
  const deltaVtLevel: Level =
    deltaVtMv == null
      ? "idle"
      : Math.abs(deltaVtMv) > 50
        ? "green"
        : Math.abs(deltaVtMv) > 10
          ? "yellow"
          : "red";
  const deltaVtStr =
    deltaVtMv == null
      ? "—"
      : `${deltaVtMv >= 0 ? "+" : ""}${deltaVtMv.toFixed(0)} mV`;

  const cvLevels = useMemo(() => {
    if (!cvMetrics) {
      return {
        level: "idle" as Level, ready: false,
        reversibilityLevel: "idle" as Level, deltaEpLevel: "idle" as Level,
        ratioLevel: "idle" as Level, peakLevel: "idle" as Level,
        dLevel: "idle" as Level, snrLevel: "idle" as Level,
      };
    }
    const { reversibility, deltaEp, IpaIpcRatio, hasAnodic, hasCathodic, D_status, SNR_anodic, SNR_cathodic } = cvMetrics;
    const reversibilityLevel: Level =
      reversibility === "reversible" ? "green"
      : reversibility === "quasi-reversible" ? "yellow"
      : "red";

    // ΔEp gated by the EXPECTED ΔEp for the configured n (59.16/n at 25 °C).
    const expected = 59.16 / Math.max(1, cvNElectrons);
    const tol = Math.max(5, cvDeltaEpToleranceMv);
    let deltaEpLevel: Level = "red";
    if (Number.isFinite(deltaEp)) {
      const dev = Math.abs(deltaEp - expected);
      if (dev <= tol) deltaEpLevel = "green";
      else if (dev <= 3 * tol) deltaEpLevel = "yellow";
    }

    const ratioLevel: Level =
      Number.isFinite(IpaIpcRatio) && IpaIpcRatio >= 0.9 && IpaIpcRatio <= 1.1 ? "green"
      : Number.isFinite(IpaIpcRatio) && IpaIpcRatio >= 0.7 && IpaIpcRatio <= 1.3 ? "yellow"
      : "red";
    const peaksFound = (hasAnodic ? 1 : 0) + (hasCathodic ? 1 : 0);
    const peakLevel: Level = peaksFound === 2 ? "green" : peaksFound === 1 ? "yellow" : "red";
    const snr = Math.min(SNR_anodic, SNR_cathodic);
    const snrLevel: Level =
      snr >= 10 ? "green" : snr >= 3 ? "yellow" : "red";
    // D is informational only — never sets the overall traffic light.
    const dLevel: Level =
      D_status === "valid" ? "green"
      : D_status === "apparent" ? "yellow"
      : "idle";

    let overall: Level = "red";
    if (
      peakLevel === "green" &&
      deltaEpLevel === "green" &&
      ratioLevel === "green" &&
      snrLevel === "green"
    ) {
      overall = "green";
    } else if (peakLevel !== "red" && snrLevel !== "red") {
      overall = "yellow";
    }
    return { level: overall, ready: true, reversibilityLevel, deltaEpLevel, ratioLevel, peakLevel, dLevel, snrLevel };
  }, [cvMetrics, cvNElectrons, cvDeltaEpToleranceMv]);

  const m = mode === "eis" ? eisMetrics : mode === "fet" ? fetMetrics : cvLevels;
  const level: Level = m.level;
  const ready = m.ready;
  const pending = "Calculating...";
  const modeLabel = mode === "eis" ? "EIS" : mode === "fet" ? "BioFET" : "CV";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Signal Quality
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {modeLabel}
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

      <div className="space-y-0">
        {mode === "eis" && (
          <>
            <MetricRow label="Semicircle Fit" value={ready ? `${eisMetrics.semicircleFit.toFixed(1)} %` : pending} level={eisMetrics.semicircleLevel} />
            <MetricRow label="Point Noise" value={ready ? `${eisMetrics.pointNoise.toFixed(1)} Ω` : pending} level={eisMetrics.noiseLevel} />
            <MetricRow label="Rs (Ω)" value={ready ? `${eisMetrics.rsStability.toFixed(0)} Ω` : pending} level={eisMetrics.rsLevel} />
            <MetricRow label="Total Points" value={`${eisMetrics.totalPoints}`} level={eisMetrics.pointsLevel} />
          </>
        )}
        {mode === "fet" && (
          <>
            <MetricRow label="Ion / Ioff Ratio" value={ready ? fetMetrics.ionIoff.toFixed(1) : pending} level={fetMetrics.ionLevel} />
            <MetricRow label="ΔVt" value={deltaVtStr} level={deltaVtLevel} />
            <MetricRow
              label="Subthreshold Slope"
              title="SS is approximate — quadratic model only"
              value={ready ? (fetMetrics.subthresholdSlope > 0 ? `${fetMetrics.subthresholdSlope.toFixed(0)} mV/dec` : "—") : pending}
              level={fetMetrics.ssLevel}
            />
            <MetricRow label="Ioff Current" value={ready ? `${fetMetrics.ioff.toFixed(2)} µA` : pending} level={fetMetrics.ioffLevel} />
            <MetricRow label="Baseline Stability" value={ready ? `${fetMetrics.baselineStability.toFixed(1)} %` : pending} level={fetMetrics.stabilityLevel} />
          </>
        )}
        {mode === "cv" && (
          <>
            <MetricRow label="Reversibility" value={cvMetrics ? cvMetrics.reversibility : pending} level={cvLevels.reversibilityLevel} />
            <MetricRow
              label={`ΔEp (exp. ${(59.16 / Math.max(1, cvNElectrons)).toFixed(0)} mV)`}
              title={`Expected ΔEp = 59.16 / n at 25 °C for n=${cvNElectrons}`}
              value={cvMetrics && Number.isFinite(cvMetrics.deltaEp) ? `${cvMetrics.deltaEp.toFixed(0)} mV` : "—"}
              level={cvLevels.deltaEpLevel}
            />
            <MetricRow label="|Ipa/Ipc|" value={cvMetrics && Number.isFinite(cvMetrics.IpaIpcRatio) ? cvMetrics.IpaIpcRatio.toFixed(2) : "—"} level={cvLevels.ratioLevel} />
            <MetricRow label="Peaks Detected" value={cvMetrics ? `${(cvMetrics.hasAnodic ? 1 : 0) + (cvMetrics.hasCathodic ? 1 : 0)} / 2` : pending} level={cvLevels.peakLevel} />
            <MetricRow
              label="SNR (min)"
              title="min(SNR_anodic, SNR_cathodic) — corrected peak current ÷ noise estimate"
              value={cvMetrics ? `${Math.min(cvMetrics.SNR_anodic, cvMetrics.SNR_cathodic).toFixed(1)}` : pending}
              level={cvLevels.snrLevel}
            />
            <MetricRow
              label="D apparent"
              title="valid → reversible only · apparent → quasi-reversible (informational) · invalid → not applicable"
              value={cvMetrics && Number.isFinite(cvMetrics.D_apparent)
                ? `${cvMetrics.D_apparent.toExponential(2)} cm²/s (${cvMetrics.D_status})`
                : cvMetrics ? `— (${cvMetrics.D_status})` : "—"}
              level={cvLevels.dLevel}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SignalQuality;