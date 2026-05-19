import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import type { EISDataPoint } from "@/hooks/useSimulatedData";

/**
 * NYQUIST PLOT — The most important EIS visualization.
 * 
 * X-axis: Real impedance Z' (Ohms) — resistive component
 * Y-axis: -Imaginary impedance Z'' (Ohms) — capacitive component
 * 
 * A perfect semicircle indicates a simple Randles cell.
 * The diameter of the semicircle = charge transfer resistance (Rct).
 * The left intercept = solution resistance (Rs).
 */
interface NyquistPlotProps {
  data: EISDataPoint[];
  fittedCurve?: { zReal: number; zImag: number }[];
  overlays?: { label: string; color: string; data: EISDataPoint[] }[];
  warburgStartFreq?: number;
}

const NyquistPlot = ({ data, fittedCurve, overlays, warburgStartFreq }: NyquistPlotProps) => {
  const plotData = data.map(d => ({ x: d.zReal, y: d.zImag }));
  const ovs = overlays ?? [];

  // Split the fitted curve into the semicircle region (above warburgStartFreq)
  // and the Warburg extrapolation (below) so they can be rendered differently.
  const fitAll = (fittedCurve ?? []) as { zReal: number; zImag: number; frequency?: number }[];
  const hasSplit = !!warburgStartFreq && warburgStartFreq > 0;
  const fitSemi = hasSplit
    ? fitAll.filter(d => (d.frequency ?? Infinity) >= warburgStartFreq!)
    : fitAll;
  const fitWarb = hasSplit
    ? fitAll.filter(d => (d.frequency ?? Infinity) < warburgStartFreq!)
    : [];
  const fitSemiData = fitSemi.map(d => ({ x: d.zReal, y: d.zImag }));
  const fitWarbData = fitWarb.map(d => ({ x: d.zReal, y: d.zImag }));

  // Vertical reference line at the split point's zReal value.
  const splitPoint =
    hasSplit
      ? [...data]
          .sort((a, b) => Math.abs(a.frequency - warburgStartFreq!) - Math.abs(b.frequency - warburgStartFreq!))[0]
      : undefined;

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
          <XAxis
            dataKey="x"
            type="number"
            name="Z' (Ω)"
            label={{ value: "Z' (Ohms) — Real Impedance", position: "bottom", offset: 20, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <YAxis
            dataKey="y"
            type="number"
            name="-Z'' (Ω)"
            label={{ value: "-Z'' (Ohms) — Imaginary", angle: -90, position: "insideLeft", offset: -5, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(220 18% 10%)",
              border: "1px solid hsl(220 15% 18%)",
              borderRadius: "6px",
              color: "hsl(210 20% 90%)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} Ω`,
              name,
            ]}
          />
          <Scatter
            data={plotData}
            fill="hsl(160 70% 50%)"
            stroke="hsl(160 70% 60%)"
            strokeWidth={1}
            r={3}
            line={{ stroke: "hsl(160 70% 45%)", strokeWidth: 2 }}
            lineType="joint"
            name="Current"
          />
          {ovs.map((o, i) => (
            <Scatter
              key={`ov-${i}-${o.label}`}
              data={o.data.map(d => ({ x: d.zReal, y: d.zImag }))}
              fill={o.color}
              stroke={o.color}
              r={2}
              line={{ stroke: o.color, strokeWidth: 2 }}
              lineType="joint"
              isAnimationActive={false}
              name={o.label}
            />
          ))}
          {fitSemiData.length > 0 && (
            <Scatter
              data={fitSemiData}
              fill="transparent"
              stroke="hsl(170 80% 55%)"
              r={0}
              line={{ stroke: "hsl(170 80% 55%)", strokeWidth: 2 }}
              lineType="joint"
              isAnimationActive={false}
              name="Semicircle fit"
            />
          )}
          {fitWarbData.length > 0 && (
            <Scatter
              data={fitWarbData}
              fill="transparent"
              stroke="hsl(30 90% 60%)"
              r={0}
              line={{ stroke: "hsl(30 90% 60%)", strokeWidth: 2, strokeDasharray: "6 4" }}
              lineType="joint"
              isAnimationActive={false}
              name="Warburg extrapolation"
            />
          )}
          {splitPoint && (
            <ReferenceLine
              x={splitPoint.zReal}
              stroke="hsl(215 15% 50%)"
              strokeDasharray="4 4"
              label={{
                value: "← semicircle | Warburg →",
                position: "top",
                fill: "hsl(215 15% 60%)",
                fontSize: 10,
              }}
            />
          )}
          {ovs.length > 0 && (
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default NyquistPlot;
