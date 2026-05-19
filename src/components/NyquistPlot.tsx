import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
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
}

const NyquistPlot = ({ data, fittedCurve, overlays }: NyquistPlotProps) => {
  const plotData = data.map(d => ({ x: d.zReal, y: d.zImag }));
  const fitData = (fittedCurve ?? []).map(d => ({ x: d.zReal, y: d.zImag }));
  const ovs = overlays ?? [];

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
          {fitData.length > 0 && (
            <Scatter
              data={fitData}
              fill="transparent"
              stroke="hsl(30 90% 60%)"
              r={0}
              line={{ stroke: "hsl(30 90% 60%)", strokeWidth: 2, strokeDasharray: "6 4" }}
              lineType="joint"
              isAnimationActive={false}
              name="Randles fit"
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
