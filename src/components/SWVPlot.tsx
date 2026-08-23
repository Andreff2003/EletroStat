import { EmptyPlotState } from "@/components/EmptyPlotState";
import { useMemo } from "react";
import {
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { SWVDataPoint, SWVMetrics } from "@/types/swv";

interface SWVOverlay {
  id: string;
  label: string;
  color: string;
  data: SWVDataPoint[];
}

interface Props {
  data: SWVDataPoint[];
  corrected?: SWVDataPoint[];
  metrics?: SWVMetrics | null;
  showForwardReverse?: boolean;
  showBaseline?: boolean;
  /** "raw" (default) plots INet; "corrected" plots baseline-subtracted INet. */
  plotMode?: "raw" | "corrected";
  overlays?: SWVOverlay[];
  height?: number;
  /** Compact read-only rendering for the dashboard grid. */
  compact?: boolean;
}

const fmt = (v: unknown, unit: string, digits = 3) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : "N/A";

/**
 * SWV plot — differential I_net vs E as the primary trace, with optional
 * forward/reverse and baseline overlays. Note: forward/reverse here are
 * pulse-sampled currents, NOT CV forward/backward scan branches.
 */
export default function SWVPlot({
  data,
  corrected,
  metrics,
  showForwardReverse = false,
  showBaseline = false,
  plotMode = "raw",
  overlays = [],
  height = 360,
  compact = false,
}: Props) {
  const correctedAvailable =
    !!corrected &&
    corrected.length === data.length &&
    corrected.some((p) => Number.isFinite(p.ICorrected));
  const effectiveMode: "raw" | "corrected" =
    plotMode === "corrected" && correctedAvailable ? "corrected" : "raw";
  const seriesCount =
    1 + // main I net line
    (showForwardReverse ? 2 : 0) +
    (showBaseline ? 1 : 0) +
    overlays.length;
  const rows = useMemo(() => {
    const src = corrected && corrected.length === data.length ? corrected : data;
    return src.map((p, i) => ({
      E: p.E,
      IForward: p.IForward,
      IReverse: p.IReverse,
      INet:
        effectiveMode === "corrected" && Number.isFinite(p.ICorrected as number)
          ? (p.ICorrected as number)
          : p.INet,
      baseline: p.baseline ?? data[i]?.baseline ?? null,
      ICorrected: p.ICorrected ?? null,
    }));
  }, [data, corrected, effectiveMode]);

  if (data.length === 0 && overlays.length === 0) {
    return (
      <EmptyPlotState
        title="No SWV scan yet"
        hint="Click Start SWV to run a square-wave voltammetry scan."
      />
    );
  }

  return (
    <div style={{ width: "100%", height: compact ? "100%" : height }}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={compact ? { top: 8, right: 8, bottom: 8, left: 8 } : { top: 10, right: 20, left: 10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="E"
            type="number"
            domain={["auto", "auto"]}
            label={compact ? undefined : { value: "E / V", position: "insideBottom", offset: -5 }}
            tick={{ fontSize: compact ? 9 : 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <YAxis
            label={compact ? undefined : { value: "I / µA", angle: -90, position: "insideLeft" }}
            tick={{ fontSize: compact ? 9 : 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            formatter={(v: number | string, name: string) => [fmt(Number(v), "µA"), name]}
            labelFormatter={(v: number) => `E = ${Number(v).toFixed(3)} V`}
          />
          {!compact && seriesCount > 1 && (
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
          )}
          {overlays.map((ov) => (
            <Line
              key={ov.id}
              type="monotone"
              data={ov.data}
              dataKey="INet"
              name={`${ov.label}${effectiveMode === "corrected" ? " (corrected)" : " (raw)"}`}
              stroke={ov.color}
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="2 2"
              isAnimationActive={false}
            />
          ))}
          <Line
            type="monotone"
            dataKey="INet"
            name={effectiveMode === "corrected" ? "I net (corrected)" : "I net (raw)"}
            stroke="#3b82f6"
            dot={false}
            strokeWidth={2}
          />
          {showForwardReverse && (
            <>
              <Line type="monotone" dataKey="IForward" name="I forward" stroke="#10b981" dot={false} strokeWidth={1} />
              <Line type="monotone" dataKey="IReverse" name="I reverse" stroke="#ef4444" dot={false} strokeWidth={1} />
            </>
          )}
          {showBaseline && (
            <Line type="monotone" dataKey="baseline" name="Baseline" stroke="#9ca3af" dot={false} strokeDasharray="4 4" />
          )}
          {metrics?.peakPotential_V != null && metrics.peakCurrentCorrected_uA != null && (
            <ReferenceDot
              x={metrics.peakPotential_V}
              y={metrics.peakCurrentCorrected_uA}
              r={5}
              fill="#f59e0b"
              stroke="#78350f"
              label={{ value: "peak", position: "top", fill: "#f59e0b", fontSize: 10 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
