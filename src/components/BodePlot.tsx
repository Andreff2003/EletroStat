import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import type { EISDataPoint } from "@/hooks/useSimulatedData";

/**
 * BODE PLOT — Shows impedance magnitude and phase vs frequency.
 * 
 * X-axis: Frequency (Hz) — logarithmic scale
 * Y-axis Left: |Z| magnitude (Ohms)
 * Y-axis Right: Phase angle (degrees)
 * 
 * Useful for identifying time constants and circuit elements.
 */
interface BodePlotProps {
  data: EISDataPoint[];
}

const BodePlot = ({ data }: BodePlotProps) => {
  const plotData = data.map(d => ({
    freq: d.frequency,
    zMag: d.zMag,
    // Capacitive systems: phase is negative (−90° to 0°)
    phase: -Math.abs(d.phase),
  }));

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={plotData} margin={{ top: 10, right: 30, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
          <XAxis
            dataKey="freq"
            type="number"
            scale="log"
            domain={['auto', 'auto']}
            label={{ value: "Frequency (Hz)", position: "bottom", offset: 20, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 10 }}
            stroke="hsl(220 15% 20%)"
            interval={9}
          />
          <YAxis
            yAxisId="left"
            scale="log"
            domain={['auto', 'auto']}
            allowDataOverflow
            label={{ value: "|Z| (Ω)", angle: -90, position: "insideLeft", offset: -5, fill: "hsl(160 70% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[-90, 0]}
            label={{ value: "Phase (°)", angle: 90, position: "insideRight", offset: -5, fill: "hsl(35 90% 55%)", fontSize: 12 }}
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
          />
          <Legend wrapperStyle={{ color: "hsl(215 15% 50%)", fontSize: 12 }} />
          <ReferenceLine
            yAxisId="right"
            y={-45}
            stroke="hsl(35 90% 55%)"
            strokeDasharray="4 4"
            label={{
              value: "-45° (ω = 1/RctCdl)",
              fill: "hsl(35 90% 55%)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="zMag"
            name="|Z| (Ω)"
            stroke="hsl(160 70% 50%)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="phase"
            name="Phase (°)"
            stroke="hsl(35 90% 55%)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BodePlot;
