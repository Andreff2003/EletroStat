import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from "recharts";
import type { CVDataPoint } from "@/hooks/useSimulatedCVData";
import type { CVMetrics } from "@/utils/computeCVMetrics";

const PALETTE = [
  "hsl(160 70% 55%)",
  "hsl(30 90% 60%)",
  "hsl(200 80% 60%)",
  "hsl(280 70% 65%)",
  "hsl(50 90% 55%)",
  "hsl(340 80% 60%)",
  "hsl(120 60% 55%)",
  "hsl(0 75% 60%)",
];

interface CVPlotProps {
  data: CVDataPoint[];
  metrics: CVMetrics | null;
  e0Prime: number;
  /**
   * "positive-right" (default) puts positive E on the right axis.
   * "positive-left" matches the classic electrochemistry convention.
   */
  axisConvention?: "positive-right" | "positive-left";
  /**
   * "raw" (default) plots the acquired I and marks IpaRaw/IpcRaw on the curve.
   * "corrected" plots Icorr (baseline subtracted) and uses the corrected peaks.
   * Markers always sit on the curve they reference.
   */
  plotMode?: "raw" | "corrected";
  /** Optional saved curves drawn underneath the live trace. */
  overlays?: { id: string; label: string; color: string; data: CVDataPoint[] }[];
}

type ChartMouseEvent = {
  activeLabel?: number | string;
  activePayload?: Array<{ payload?: { E?: number } }>;
};

type SeriesRow = { E: number } & Record<string, number | undefined>;

const CVPlot = ({
  data,
  metrics,
  e0Prime,
  axisConvention = "positive-right",
  plotMode = "raw",
  overlays = [],
}: CVPlotProps) => {
  // One series per (cycle, branch). Repeated E values across forward / reverse
  // sweeps must NOT be joined; emitting one row per acquisition sample with
  // only the active series populated keeps the polyline in acquisition order.
  const corrIndex = useMemo(() => {
    const m = new Map<number, number>();
    if (plotMode === "corrected" && metrics?.correctedData?.length === data.length) {
      metrics.correctedData.forEach((p, i) => {
        if (typeof p.Icorr === "number") m.set(i, p.Icorr);
      });
    }
    return m;
  }, [plotMode, metrics, data]);

  const { rows, seriesKeys } = useMemo(() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    const rowsLocal: SeriesRow[] = [];
    // Overlay series first so live trace stays on top.
    for (const ov of overlays) {
      const key = `ov_${ov.id}`;
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
      for (const p of ov.data) {
        rowsLocal.push({ E: p.E, [key]: p.I });
      }
    }
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      const branch = p.branch ?? "forward";
      const key = `c${p.cycle}_${branch}`;
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
      const y = corrIndex.has(i) ? corrIndex.get(i)! : p.I;
      rowsLocal.push({ E: p.E, [key]: y });
    }
    return { rows: rowsLocal, seriesKeys: keys };
  }, [data, overlays, corrIndex]);

  const colorOf = (key: string): string => {
    if (key.startsWith("ov_")) {
      const ov = overlays.find((o) => `ov_${o.id}` === key);
      return ov?.color ?? "hsl(220 10% 50%)";
    }
    const m = /^c(\d+)_/.exec(key);
    const c = m ? parseInt(m[1], 10) : 1;
    return PALETTE[(c - 1) % PALETTE.length];
  };

  const [zoomArea, setZoomArea] = useState<{ x1: number; x2: number } | null>(null);
  const [zoomDomain, setZoomDomain] = useState<{
    x: [number, number];
    y: [number, number];
  } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const getX = (e: ChartMouseEvent | null | undefined): number | null => {
    if (!e) return null;
    if (typeof e.activeLabel === "number") return e.activeLabel;
    const p = e.activePayload?.[0]?.payload;
    if (p && typeof p.E === "number") return p.E;
    return null;
  };

  const handleMouseDown = (e: ChartMouseEvent) => {
    const x = getX(e);
    if (x == null) return;
    setIsSelecting(true);
    setZoomArea({ x1: x, x2: x });
  };
  const handleMouseMove = (e: ChartMouseEvent) => {
    if (!isSelecting) return;
    const x = getX(e);
    if (x == null) return;
    setZoomArea((prev) => (prev ? { ...prev, x2: x } : null));
  };
  const handleMouseUp = () => {
    if (!isSelecting || !zoomArea) {
      setIsSelecting(false);
      return;
    }
    setIsSelecting(false);
    const x1 = Math.min(zoomArea.x1, zoomArea.x2);
    const x2 = Math.max(zoomArea.x1, zoomArea.x2);
    if (Math.abs(x2 - x1) < 1e-6) {
      setZoomArea(null);
      return;
    }
    const visible = data.filter((d) => d.E >= x1 && d.E <= x2);
    const ys = visible.map((d) => d.I).filter((v) => Number.isFinite(v));
    if (ys.length === 0) {
      setZoomArea(null);
      return;
    }
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.05 || Math.abs(yMax) * 0.05 || 1;
    setZoomDomain({ x: [x1, x2], y: [yMin - pad, yMax + pad] });
    setZoomArea(null);
  };

  const reversed = axisConvention === "positive-left";

  return (
    <div className="w-full h-full flex flex-col" style={{ position: "relative" }}>
      {zoomDomain && (
        <button
          onClick={() => setZoomDomain(null)}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 10,
            fontSize: "11px",
            padding: "3px 10px",
            borderRadius: "4px",
            cursor: "pointer",
            background: "hsl(220 18% 14%)",
            border: "1px solid hsl(220 15% 22%)",
            color: "hsl(210 20% 80%)",
          }}
        >
          Reset Zoom
        </button>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 10, right: 20, bottom: 40, left: 20 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
            <XAxis
              dataKey="E"
              type="number"
              reversed={reversed}
              domain={zoomDomain ? zoomDomain.x : ["auto", "auto"]}
              allowDataOverflow
              allowDuplicatedCategory={false}
              label={{
                value: `E / V vs reference (${reversed ? "positive-left" : "positive-right"})`,
                position: "bottom",
                offset: 20,
                fill: "hsl(215 15% 50%)",
                fontSize: 12,
              }}
              tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
              stroke="hsl(220 15% 20%)"
              tickFormatter={(v: number) => Number(v).toFixed(2)}
            />
            <YAxis
              type="number"
              domain={zoomDomain ? zoomDomain.y : ["auto", "auto"]}
              allowDataOverflow
              label={{
                value: "I / µA",
                angle: -90,
                position: "insideLeft",
                offset: -5,
                fill: "hsl(215 15% 50%)",
                fontSize: 12,
              }}
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
                `${Number(value).toFixed(2)} µA`,
                name,
              ]}
              labelFormatter={(v: number) => `E = ${Number(v).toFixed(3)} V`}
            />
            <ReferenceLine
              x={e0Prime}
              stroke="hsl(50 90% 55%)"
              strokeDasharray="4 3"
              label={{
                value: "E°'",
                position: "top",
                fill: "hsl(50 90% 55%)",
                fontSize: 11,
              }}
            />
            {seriesKeys.map((k) => (
              <Line
                key={k}
                type="linear"
                dataKey={k}
                stroke={colorOf(k)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name={k.replace(/^c(\d+)_/, "Cycle $1 · ")}
                connectNulls={false}
              />
            ))}
            {metrics?.hasAnodic && (
              <ReferenceDot
                x={metrics.Epa}
                y={plotMode === "corrected" ? metrics.IpaCorrected : metrics.IpaRaw}
                r={5}
                fill="hsl(160 70% 55%)"
                stroke="hsl(160 70% 55%)"
                label={{
                  value: `Epa ${metrics.Epa.toFixed(3)}V`,
                  position: "top",
                  fill: "hsl(160 70% 55%)",
                  fontSize: 10,
                }}
              />
            )}
            {metrics?.hasCathodic && (
              <ReferenceDot
                x={metrics.Epc}
                y={plotMode === "corrected" ? metrics.IpcCorrected : metrics.IpcRaw}
                r={5}
                fill="hsl(340 80% 60%)"
                stroke="hsl(340 80% 60%)"
                label={{
                  value: `Epc ${metrics.Epc.toFixed(3)}V`,
                  position: "bottom",
                  fill: "hsl(340 80% 60%)",
                  fontSize: 10,
                }}
              />
            )}
            {seriesKeys.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }} />
            )}
            {isSelecting && zoomArea && zoomArea.x1 !== zoomArea.x2 && (
              <ReferenceArea
                x1={Math.min(zoomArea.x1, zoomArea.x2)}
                x2={Math.max(zoomArea.x1, zoomArea.x2)}
                strokeOpacity={0.3}
                fill="hsl(160 70% 55%)"
                fillOpacity={0.15}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CVPlot;
