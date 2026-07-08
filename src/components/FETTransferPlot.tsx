import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceArea,
} from "recharts";
import type { FETTransferPoint } from "@/hooks/useSimulatedData";

interface FETOverlay {
  id: string;
  label: string;
  color: string;
  baseline: FETTransferPoint[];
  withAnalyte: FETTransferPoint[];
}

interface FETTransferPlotProps {
  baseline: FETTransferPoint[];
  withAnalyte: FETTransferPoint[];
  overlays?: FETOverlay[];
}

const FETTransferPlot = ({ baseline, withAnalyte, overlays = [] }: FETTransferPlotProps) => {
  const plotData = baseline.map((b, i) => ({
    vg: b.vg,
    baseline: b.id,
    cortisol: withAnalyte[i]?.id ?? 0,
  }));

  const [zoomArea, setZoomArea] = useState<{ x1: number; x2: number } | null>(null);
  const [zoomDomain, setZoomDomain] = useState<{ x: [number, number]; y: [number, number] } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const handleMouseDown = (e: any) => {
    const xVal = e?.activePayload?.[0]?.payload?.vg;
    if (xVal == null) return;
    setIsSelecting(true);
    setZoomArea({ x1: xVal, x2: xVal });
  };
  const handleMouseMove = (e: any) => {
    if (!isSelecting) return;
    const xVal = e?.activePayload?.[0]?.payload?.vg;
    if (xVal == null) return;
    setZoomArea((prev) => (prev ? { ...prev, x2: xVal } : null));
  };
  const handleMouseUp = () => {
    if (!isSelecting || !zoomArea) { setIsSelecting(false); return; }
    setIsSelecting(false);
    const x1 = Math.min(zoomArea.x1, zoomArea.x2);
    const x2 = Math.max(zoomArea.x1, zoomArea.x2);
    if (Math.abs(x2 - x1) < 1e-6) { setZoomArea(null); return; }
    const visible = plotData.filter((p) => p.vg >= x1 && p.vg <= x2);
    const ys = visible.flatMap((p) => [p.baseline, p.cortisol]).filter((v) => Number.isFinite(v));
    if (ys.length === 0) { setZoomArea(null); return; }
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.05 || Math.abs(yMax) * 0.05 || 1;
    setZoomDomain({ x: [x1, x2], y: [yMin - pad, yMax + pad] });
    setZoomArea(null);
  };

  return (
    <div className="w-full h-full" style={{ position: "relative" }}>
      {zoomDomain && (
        <button
          onClick={() => setZoomDomain(null)}
          style={{
            position: "absolute", top: 8, right: 8, zIndex: 10,
            fontSize: "11px", padding: "3px 10px",
            borderRadius: "4px", cursor: "pointer",
            background: "hsl(220 18% 14%)",
            border: "1px solid hsl(220 15% 22%)",
            color: "hsl(210 20% 80%)",
          }}
        >
          Reset Zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={plotData}
          margin={{ top: 10, right: 20, bottom: 40, left: 20 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 15%)" />
          <XAxis
            dataKey="vg"
            type="number"
            domain={zoomDomain ? zoomDomain.x : ["auto", "auto"]}
            allowDataOverflow
            label={{ value: "Gate Voltage Vg (V)", position: "bottom", offset: 20, fill: "hsl(215 15% 50%)", fontSize: 12 }}
            tick={{ fill: "hsl(215 15% 50%)", fontSize: 11 }}
            stroke="hsl(220 15% 20%)"
          />
          <YAxis
            domain={zoomDomain ? zoomDomain.y : ["auto", "auto"]}
            allowDataOverflow
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
          {overlays.map((ov) => {
            const ovData = ov.baseline.map((b, i) => ({
              vg: b.vg,
              [`ov_base_${ov.id}`]: b.id,
              [`ov_ana_${ov.id}`]: ov.withAnalyte[i]?.id ?? null,
            }));
            return (
              <>
                <Line
                  key={`ovb_${ov.id}`}
                  type="monotone"
                  data={ovData}
                  dataKey={`ov_base_${ov.id}`}
                  name={`${ov.label} · baseline`}
                  stroke={ov.color}
                  strokeWidth={1.2}
                  strokeDasharray="2 2"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  key={`ova_${ov.id}`}
                  type="monotone"
                  data={ovData}
                  dataKey={`ov_ana_${ov.id}`}
                  name={`${ov.label} · analyte`}
                  stroke={ov.color}
                  strokeWidth={1.2}
                  strokeDasharray="6 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            );
          })}
          <Line type="monotone" dataKey="baseline" name="Baseline (no analyte)" stroke="hsl(200 80% 55%)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="cortisol" name="With Cortisol" stroke="hsl(35 90% 55%)" strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />

          {isSelecting && zoomArea && zoomArea.x1 !== zoomArea.x2 && (
            <ReferenceArea x1={zoomArea.x1} x2={zoomArea.x2} strokeOpacity={0.3} fill="hsl(200 80% 55%)" fillOpacity={0.15} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default FETTransferPlot;
