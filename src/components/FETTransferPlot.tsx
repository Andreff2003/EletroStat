import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { FETTransferPoint } from "@/hooks/useSimulatedData";

/**
 * FET TRANSFER CURVE — Id vs Vg
 * 
 * X-axis: Gate voltage Vg (Volts)
 * Y-axis: Drain current Id (µA)
 * 
 * Shows TWO curves:
 * - Baseline (no analyte)
 * - With cortisol (threshold voltage shifts)
 * 
 * The shift in Vth indicates cortisol binding to the
 * aptamer or MIP on the gate surface.
 */
interface FETTransferPlotProps {
  baseline: FETTransferPoint[];
  withAnalyte: FETTransferPoint[];
}

const FETTransferPlot = ({ baseline, withAnalyte }: FETTransferPlotProps) => {
  // Merge both datasets by index
  const plotData = baseline.map((b, i) => ({
    vg: b.vg,
    baseline: b.id,
    cortisol: withAnalyte[i]?.id ?? 0,
  }));

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={plotData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
          <XAxis
            dataKey="vg"
            type="number"
            label={{ value: "Gate Voltage Vg (V)", position: "bottom", offset: 20, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <YAxis
            label={{ value: "Drain Current Id (µA)", angle: -90, position: "insideLeft", offset: -5, fill: "hsl(215 15% 50%)", fontSize: 12 }}
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
            formatter={(value: number) => [`${value.toFixed(2)} µA`]}
          />
          <Legend wrapperStyle={{ color: "hsl(215 15% 50%)", fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="baseline"
            name="Baseline (no analyte)"
            stroke="hsl(200 80% 55%)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cortisol"
            name="With Cortisol"
            stroke="hsl(35 90% 55%)"
            strokeWidth={2}
            dot={false}
            strokeDasharray="6 3"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default FETTransferPlot;
