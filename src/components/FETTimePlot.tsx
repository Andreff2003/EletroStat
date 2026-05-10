import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { FETTimePoint } from "@/hooks/useSimulatedData";

/**
 * FET TIME RESPONSE — Id vs Time
 * 
 * X-axis: Time (seconds)
 * Y-axis: Drain current Id (µA)
 * 
 * Shows real-time current measurement at fixed gate voltage.
 * When cortisol is injected (~10s), the current drops due to
 * analyte binding on the gate surface.
 * 
 * The vertical reference line marks analyte injection time.
 */
interface FETTimePlotProps {
  data: FETTimePoint[];
  markers?: { time: number; label: string }[];
}

const FETTimePlot = ({ data, markers }: FETTimePlotProps) => {
  const lines = markers && markers.length > 0
    ? markers
    : [{ time: 10, label: "Cortisol injection" }];
  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
          <XAxis
            dataKey="time"
            type="number"
            domain={[0, 40]}
            label={{ value: "Time (s)", position: "bottom", offset: 20, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <YAxis
            domain={[14, 28]}
            label={{ value: "Id (µA)", angle: -90, position: "insideLeft", offset: -5, fill: "hsl(215 15% 50%)", fontSize: 12 }}
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
            formatter={(value: number) => [`${value.toFixed(2)} µA`, "Id"]}
          />
          {lines.map((m, i) => (
            <ReferenceLine
              key={`mk-${i}-${m.time}`}
              x={m.time}
              stroke="hsl(0 65% 50%)"
              strokeDasharray="4 4"
              label={{
                value: m.label,
                fill: "hsl(0 65% 60%)",
                fontSize: 11,
                position: "top",
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="id"
            stroke="hsl(200 80% 55%)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default FETTimePlot;
