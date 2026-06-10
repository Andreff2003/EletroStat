import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, Line, LineChart, Legend,
} from "recharts";
import type { EISDataPoint } from "@/hooks/useSimulatedData";
import type { RandlesFitResult } from "@/utils/randlesFit";

const axis = { stroke: "var(--muted-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" };
const grid = { stroke: "var(--grid)", strokeDasharray: "2 4" };

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  color: "var(--popover-foreground)",
};

export function NyquistChart({ data, fit }: { data: EISDataPoint[]; fit: RandlesFitResult | null }) {
  const fitLine = fit?.fittedCurve ?? [];
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 30 }}>
        <CartesianGrid {...grid} />
        <XAxis
          type="number" dataKey="zReal" name="Z'"
          tick={axis} stroke="var(--border)"
          label={{ value: "Z′ (Ω)", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          type="number" dataKey="zImag" name="-Z''"
          tick={axis} stroke="var(--border)"
          label={{ value: "-Z″ (Ω)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: "var(--primary)", strokeOpacity: 0.3 }}
          formatter={(v: number) => v.toFixed(1)}
        />
        <Scatter name="measured" data={data} fill="var(--signal)" />
        {fitLine.length > 0 && (
          <Scatter name="Randles fit" data={fitLine} line={{ stroke: "var(--fit)", strokeWidth: 2 }} shape={() => <></>} />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function BodeChart({ data }: { data: EISDataPoint[] }) {
  const series = [...data].sort((a, b) => a.frequency - b.frequency);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={series} margin={{ top: 10, right: 20, bottom: 24, left: 30 }}>
        <CartesianGrid {...grid} />
        <XAxis
          dataKey="frequency" scale="log" domain={["auto", "auto"]}
          type="number" tick={axis} stroke="var(--border)"
          tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(1)}
          label={{ value: "f (Hz)", position: "insideBottom", offset: -8, fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis yAxisId="mag" tick={axis} stroke="var(--border)"
          label={{ value: "|Z| (Ω)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <YAxis yAxisId="phase" orientation="right" tick={axis} stroke="var(--border)"
          label={{ value: "φ (°)", angle: 90, position: "insideRight", fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(1)}/>
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }}/>
        <Line yAxisId="mag" type="monotone" dataKey="zMag" stroke="var(--signal)" strokeWidth={1.5} dot={false} name="|Z|"/>
        <Line yAxisId="phase" type="monotone" dataKey="phase" stroke="var(--fit)" strokeWidth={1.5} dot={false} name="phase"/>
      </LineChart>
    </ResponsiveContainer>
  );
}

interface TransferProps {
  baseline: { vg: number; id: number }[];
  withAnalyte: { vg: number; id: number }[];
}

export function TransferChart({ baseline, withAnalyte }: TransferProps) {
  // merge for shared X
  const merged = baseline.map((b, i) => ({ vg: b.vg, baseline: b.id, analyte: withAnalyte[i]?.id }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={merged} margin={{ top: 10, right: 20, bottom: 30, left: 30 }}>
        <CartesianGrid {...grid}/>
        <XAxis dataKey="vg" type="number" tick={axis} stroke="var(--border)"
          label={{ value: "Vg (V)", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <YAxis tick={axis} stroke="var(--border)"
          label={{ value: "Id (µA)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v?.toFixed(2)}/>
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }}/>
        <Line type="monotone" dataKey="baseline" stroke="var(--signal)" strokeWidth={1.8} dot={false} name="baseline"/>
        <Line type="monotone" dataKey="analyte" stroke="var(--fit)" strokeWidth={1.8} dot={false} name="+ analyte"/>
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TimeChart({ data }: { data: { time: number; id: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 30, left: 30 }}>
        <CartesianGrid {...grid}/>
        <XAxis dataKey="time" type="number" tick={axis} stroke="var(--border)"
          label={{ value: "t (s)", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <YAxis tick={axis} stroke="var(--border)" domain={["auto", "auto"]}
          label={{ value: "Id (µA)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }}/>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(2)}/>
        <Line type="monotone" dataKey="id" stroke="var(--signal)" strokeWidth={1.8} dot={false}/>
      </LineChart>
    </ResponsiveContainer>
  );
}
