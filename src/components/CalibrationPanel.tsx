import { useMemo } from "react";
import { AlertTriangle, Beaker, Download } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EISDataPoint, FETTransferPoint } from "@/hooks/useSimulatedData";

export interface CalibrationPoint {
  concentration: number; // nM
  signal: number; // ΔRct (Ω) for EIS, ΔVt (mV) for FET
  raw: number; // Rct (Ω) or Vt (V)
  timestamp: number;
}

interface CalibrationPanelProps {
  mode: "eis" | "fet";
  concentration: number;
  onChangeConcentration: (v: number) => void;
  points: CalibrationPoint[];
  onClear: () => void;
  onExport: () => void;
  /** Latest computed parameters from current/last sweep */
  currentRs?: number;
  currentRct?: number;
  currentVt?: number;
}

/** Find baseline (concentration === 0) point */
function findBaseline(points: CalibrationPoint[]) {
  return points.find((p) => p.concentration === 0);
}

/** Compute Rs (min zReal) and Rct (max-min zReal) from EIS sweep */
export function computeEISParams(data: EISDataPoint[]): { rs: number; rct: number } | null {
  if (data.length < 5) return null;
  const reals = data.map((d) => d.zReal);
  const minR = Math.min(...reals);
  const maxR = Math.max(...reals);
  return { rs: minR, rct: maxR - minR };
}

/** Compute Vt: Vg where Id reaches 10% of Ion (max Id) */
export function computeFETVt(curve: FETTransferPoint[]): number | null {
  if (curve.length < 5) return null;
  const ids = curve.map((p) => p.id);
  const ion = Math.max(...ids);
  const target = ion * 0.1;
  // Find first point that crosses target (assuming Vg ascending)
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].id >= target) {
      // Linear interp between i-1 and i
      const a = curve[i - 1];
      const b = curve[i];
      if (b.id === a.id) return b.vg;
      const t = (target - a.id) / (b.id - a.id);
      return a.vg + t * (b.vg - a.vg);
    }
  }
  return curve[curve.length - 1].vg;
}

/**
 * Langmuir fit: Signal = Smax * C / (C + Kd)
 * Linearize via Scatchard-like: 1/Signal = (Kd/Smax)*(1/C) + 1/Smax
 * Use only points with C > 0.
 */
function fitLangmuir(points: CalibrationPoint[]): { kd: number; sMax: number } | null {
  const nonZero = points.filter((p) => p.concentration > 0 && p.signal > 0);
  if (nonZero.length < 3) return null;
  // Linear regression on (1/C, 1/S)
  const xs = nonZero.map((p) => 1 / p.concentration);
  const ys = nonZero.map((p) => 1 / p.signal);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, _, i) => a + xs[i] * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  if (intercept <= 0 || slope <= 0) return null;
  const sMax = 1 / intercept;
  const kd = slope * sMax;
  if (!Number.isFinite(kd) || !Number.isFinite(sMax) || kd <= 0) return null;
  return { kd, sMax };
}

/** LOD = 3 * sigma_baseline / slope, where slope = ΔSignal/ΔC over lowest 2 non-zero points */
function computeLOD(points: CalibrationPoint[]): number | null {
  const baseline = findBaseline(points);
  if (!baseline) return null;
  // Use raw values to estimate baseline noise; if only one baseline, fall back to small fraction
  const baselines = points.filter((p) => p.concentration === 0);
  let sigma: number;
  if (baselines.length >= 2) {
    const vals = baselines.map((p) => p.raw);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    sigma = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  } else {
    sigma = Math.abs(baseline.raw) * 0.02; // 2% assumed noise
  }
  const nonZero = points
    .filter((p) => p.concentration > 0)
    .sort((a, b) => a.concentration - b.concentration);
  if (nonZero.length === 0) return null;
  const lowest = nonZero[0];
  const slope = lowest.signal / lowest.concentration;
  if (slope <= 0) return null;
  return (3 * sigma) / slope;
}

const CalibrationPanel = ({
  mode,
  concentration,
  onChangeConcentration,
  points,
  onClear,
  onExport,
  currentRs,
  currentRct,
  currentVt,
}: CalibrationPanelProps) => {
  const baseline = findBaseline(points);
  const hasBaseline = !!baseline;

  const sampleLabel =
    concentration === 0
      ? "Baseline (no cortisol)"
      : `Sample — ${concentration} nM cortisol`;

  const signalUnit = mode === "eis" ? "Ω" : "mV";
  const signalKey = mode === "eis" ? "ΔRct" : "ΔVt";

  // Sort points by concentration for plotting
  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => a.concentration - b.concentration),
    [points]
  );

  // Decide log scale if span > 2 decades
  const useLog = useMemo(() => {
    const nz = sortedPoints.filter((p) => p.concentration > 0);
    if (nz.length < 2) return false;
    const min = Math.min(...nz.map((p) => p.concentration));
    const max = Math.max(...nz.map((p) => p.concentration));
    return max / Math.max(min, 1e-9) > 100;
  }, [sortedPoints]);

  const fit = useMemo(() => (points.length >= 4 ? fitLangmuir(points) : null), [points]);
  const lod = useMemo(() => computeLOD(points), [points]);

  // Build smooth Langmuir curve points using fit
  const fitCurve = useMemo(() => {
    if (!fit) return [];
    const nz = sortedPoints.filter((p) => p.concentration > 0);
    if (nz.length < 1) return [];
    const minC = Math.min(...nz.map((p) => p.concentration));
    const maxC = Math.max(...nz.map((p) => p.concentration));
    const N = 50;
    const out: { concentration: number; fitSignal: number }[] = [];
    for (let i = 0; i <= N; i++) {
      let c: number;
      if (useLog) {
        const lo = Math.log10(Math.max(minC, 1e-3));
        const hi = Math.log10(maxC);
        c = Math.pow(10, lo + ((hi - lo) * i) / N);
      } else {
        c = minC + ((maxC - minC) * i) / N;
      }
      out.push({ concentration: c, fitSignal: (fit.sMax * c) / (c + fit.kd) });
    }
    return out;
  }, [fit, sortedPoints, useLog]);

  // Combine measured + fit for the chart
  const chartData = useMemo(() => {
    type Row = { concentration: number; measured?: number; fitSignal?: number };
    const map = new Map<number, Row>();
    for (const p of sortedPoints) {
      if (p.concentration <= 0) continue;
      map.set(p.concentration, { concentration: p.concentration, measured: p.signal });
    }
    for (const f of fitCurve) {
      const existing = map.get(f.concentration);
      if (existing) existing.fitSignal = f.fitSignal;
      else map.set(f.concentration, { concentration: f.concentration, fitSignal: f.fitSignal });
    }
    return Array.from(map.values()).sort((a, b) => a.concentration - b.concentration);
  }, [sortedPoints, fitCurve]);

  // Currently-displayed parameters
  const sampleRct = currentRct ?? null;
  const baselineRct = points.find((p) => p.concentration === 0)?.raw ?? null;
  const deltaRct =
    sampleRct != null && baselineRct != null && concentration > 0
      ? sampleRct - baselineRct
      : 0;

  const sampleVt = currentVt ?? null;
  const baselineVt = points.find((p) => p.concentration === 0)?.raw ?? null;
  const deltaVt =
    sampleVt != null && baselineVt != null && concentration > 0
      ? (sampleVt - baselineVt) * 1000
      : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Beaker className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm text-foreground">Concentration & Calibration</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground uppercase">
          {mode === "eis" ? "EIS" : "BioFET"}
        </span>
      </div>

      {/* Concentration input */}
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 items-end">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">
            Sample Concentration (nM)
          </Label>
          <Input
            type="number"
            value={Number.isFinite(concentration) ? concentration : ""}
            min={0}
            step="any"
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              onChangeConcentration(Number.isFinite(n) ? Math.max(0, n) : 0);
            }}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          {sampleLabel}
        </div>
      </div>

      {!hasBaseline && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs font-mono text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Please measure baseline (0 nM) first
        </div>
      )}

      {/* Live parameters box */}
      {mode === "eis" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-secondary rounded-md p-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Rs</div>
            <div className="text-sm font-mono text-foreground">
              {currentRs != null ? `${currentRs.toFixed(1)} Ω` : "—"}
            </div>
          </div>
          <div className="bg-secondary rounded-md p-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Rct</div>
            <div className="text-sm font-mono text-foreground">
              {currentRct != null ? `${currentRct.toFixed(1)} Ω` : "—"}
            </div>
          </div>
          <div className="bg-secondary rounded-md p-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">ΔRct</div>
            <div className="text-sm font-mono text-foreground">
              {`${deltaRct.toFixed(1)} Ω`}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-secondary rounded-md p-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Vt</div>
            <div className="text-sm font-mono text-foreground">
              {currentVt != null ? `${currentVt.toFixed(3)} V` : "—"}
            </div>
          </div>
          <div className="bg-secondary rounded-md p-2">
            <div className="text-[10px] text-muted-foreground font-mono uppercase">ΔVt</div>
            <div className="text-sm font-mono text-foreground">{`${deltaVt.toFixed(1)} mV`}</div>
          </div>
        </div>
      )}

      {/* Calibration chart */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">
            Calibration Curve
          </span>
          {fit && (
            <span className="text-[10px] font-mono text-primary">
              Kd = {fit.kd.toFixed(2)} nM · Max {signalKey} = {fit.sMax.toFixed(1)} {signalUnit}
            </span>
          )}
        </div>
        <div className="h-[180px] bg-background rounded-md border border-border p-1">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[11px] font-mono text-muted-foreground">
              No measurements yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="concentration"
                  type="number"
                  scale={useLog ? "log" : "linear"}
                  domain={useLog ? ["auto", "auto"] : [0, "auto"]}
                  tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: "Concentration (nM)",
                    position: "insideBottom",
                    offset: -2,
                    style: { fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" },
                  }}
                  allowDataOverflow
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                  label={{
                    value: `${signalKey} (${signalUnit})`,
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontFamily: "monospace",
                    fontSize: "11px",
                  }}
                  formatter={(value: number) =>
                    typeof value === "number" ? value.toFixed(2) : value
                  }
                />
                {lod != null && (
                  <ReferenceLine
                    x={lod}
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="4 4"
                    label={{
                      value: `LOD ${lod.toFixed(2)} nM`,
                      fill: "hsl(var(--destructive))",
                      fontSize: 10,
                      position: "top",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="fitSignal"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Scatter dataKey="measured" fill="hsl(var(--primary))" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Kd estimation summary */}
      {points.length >= 4 && fit && (
        <div className="rounded-md bg-secondary/60 p-2 text-xs font-mono text-foreground">
          <div>Estimated Kd: <span className="text-primary">{fit.kd.toFixed(2)} nM</span></div>
          <div>Max {signalKey}: <span className="text-primary">{fit.sMax.toFixed(2)} {signalUnit}</span></div>
        </div>
      )}
      {points.length > 0 && points.length < 4 && (
        <div className="text-[11px] font-mono text-muted-foreground">
          Need {4 - points.length} more measurement(s) for Kd estimation
        </div>
      )}

      {/* Calibration table */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">
            Measurements ({points.length})
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={onExport}
              disabled={points.length === 0}
              className="h-7 font-mono text-[11px]"
            >
              <Download className="h-3 w-3" /> Export CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={points.length === 0}
              className="h-7 font-mono text-[11px]"
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border max-h-[160px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-[10px] font-mono uppercase">Conc (nM)</TableHead>
                <TableHead className="h-8 text-[10px] font-mono uppercase">
                  {signalKey} ({signalUnit})
                </TableHead>
                <TableHead className="h-8 text-[10px] font-mono uppercase">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-[11px] font-mono text-muted-foreground py-3 text-center">
                    No measurements yet
                  </TableCell>
                </TableRow>
              ) : (
                sortedPoints.map((p, i) => (
                  <TableRow key={`${p.timestamp}-${i}`}>
                    <TableCell className="py-1.5 text-xs font-mono">{p.concentration}</TableCell>
                    <TableCell className="py-1.5 text-xs font-mono">{p.signal.toFixed(2)}</TableCell>
                    <TableCell className="py-1.5 text-xs font-mono">
                      {new Date(p.timestamp).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default CalibrationPanel;