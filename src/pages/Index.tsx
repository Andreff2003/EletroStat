import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import NyquistPlot from "@/components/NyquistPlot";
import BodePlot from "@/components/BodePlot";
import FETTransferPlot from "@/components/FETTransferPlot";
import FETTimePlot from "@/components/FETTimePlot";
import StatusIndicator from "@/components/StatusIndicator";
import ConnectionPanel from "@/components/ConnectionPanel";
import SignalQuality from "@/components/SignalQuality";
import SweepProgress, { type SweepStatus } from "@/components/SweepProgress";
import {
  useSimulatedEIS,
  useSimulatedFETTransfer,
  useSimulatedFETTime,
} from "@/hooks/useSimulatedData";
import { exportEISData, exportFETTransferData, exportFETTimeData } from "@/utils/csvExport";
import { useWebSocketData } from "@/hooks/useWebSocketData";
import ParametersPanel, {
  DEFAULT_EIS_PARAMS,
  DEFAULT_FET_PARAMS,
  type EISParams,
  type FETParams,
} from "@/components/ParametersPanel";

const Index = () => {
  const [mode, setMode] = useState<"eis" | "fet">("eis");
  const [dataSource, setDataSource] = useState<"simulated" | "live">("simulated");
  const [eisParams, setEisParams] = useState<EISParams>(DEFAULT_EIS_PARAMS);
  const [fetParams, setFetParams] = useState<FETParams>(DEFAULT_FET_PARAMS);

  // Sweep status tracks completion separately from "is running"
  const [eisStatus, setEisStatus] = useState<SweepStatus>("idle");
  const [fetStatus, setFetStatus] = useState<SweepStatus>("idle");

  // Frozen snapshots for Signal Quality after sweep completes / stops
  const [frozenEis, setFrozenEis] = useState<ReturnType<typeof useWebSocketData>["eisData"] | null>(null);
  const [frozenFetBaseline, setFrozenFetBaseline] = useState<ReturnType<typeof useWebSocketData>["fetBaseline"] | null>(null);
  const [frozenFetAnalyte, setFrozenFetAnalyte] = useState<ReturnType<typeof useWebSocketData>["fetAnalyte"] | null>(null);

  // Simulated data hooks
  const eis = useSimulatedEIS(150);
  const fetTransfer = useSimulatedFETTransfer(80);
  const fetTime = useSimulatedFETTime(150);

  // Live WebSocket data hook
  const ws = useWebSocketData();

  // Pick the right data based on source
  const eisData = dataSource === "simulated" ? eis.data : ws.eisData;
  const fetBaselineData = dataSource === "simulated" ? fetTransfer.baseline : ws.fetBaseline;
  const fetAnalyteData = dataSource === "simulated" ? fetTransfer.withAnalyte : ws.fetAnalyte;
  const fetTimeDataArr = dataSource === "simulated" ? fetTime.data : ws.fetTimeData;

  // Expected counts based on configured parameters
  const expectedEisPoints = eisParams.points;
  const expectedFetTransferPoints = useMemo(
    () => Math.max(1, Math.round((fetParams.vgMax - fetParams.vgMin) / (fetParams.vgStep / 1000)) + 1),
    [fetParams.vgMin, fetParams.vgMax, fetParams.vgStep]
  );
  const expectedFetTimePoints = 60;
  const expectedFetTotal =
    expectedFetTransferPoints * 2 + expectedFetTimePoints;
  const fetReceivedTotal =
    fetBaselineData.length + fetAnalyteData.length + fetTimeDataArr.length;

  // Avoid double-firing the auto-stop
  const eisAutoStopFiredRef = useRef(false);
  const fetAutoStopFiredRef = useRef(false);

  const handleStartEIS = () => {
    eisAutoStopFiredRef.current = false;
    setFrozenEis(null);
    setEisStatus("running");
    if (dataSource === "simulated") {
      eis.start();
    } else {
      ws.clearEIS();
      ws.sendCommand("start_eis", {
        freqMin: eisParams.freqMin,
        freqMax: eisParams.freqMax,
        points: eisParams.points,
        amplitude: eisParams.amplitude,
      });
    }
  };

  const handleResetEIS = () => {
    eisAutoStopFiredRef.current = false;
    setFrozenEis(null);
    setEisStatus("idle");
    if (dataSource === "simulated") {
      eis.reset();
    } else {
      ws.clearEIS();
      ws.sendCommand("stop");
    }
  };

  const handleStartFET = () => {
    fetAutoStopFiredRef.current = false;
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    setFetStatus("running");
    if (dataSource === "simulated") {
      fetTransfer.start();
      fetTime.start();
    } else {
      ws.clearFET();
      ws.sendCommand("start_fet", {
        vgMin: fetParams.vgMin,
        vgMax: fetParams.vgMax,
        vgStep: fetParams.vgStep / 1000, // mV → V
        intervalMs: fetParams.intervalMs,
      });
    }
  };

  const handleResetFET = () => {
    fetAutoStopFiredRef.current = false;
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    setFetStatus("idle");
    if (dataSource === "simulated") {
      fetTransfer.reset();
      fetTime.reset();
    } else {
      ws.clearFET();
      ws.sendCommand("stop");
    }
  };

  // Manual stop (mid-sweep)
  const handleStopEIS = () => {
    if (eisStatus !== "running") return;
    eisAutoStopFiredRef.current = true;
    if (dataSource === "simulated") {
      eis.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenEis(eisData);
    setEisStatus("stopped");
    toast(`Stopped at ${eisData.length} / ${expectedEisPoints} points`);
  };

  const handleStopFET = () => {
    if (fetStatus !== "running") return;
    fetAutoStopFiredRef.current = true;
    if (dataSource === "simulated") {
      fetTransfer.stop();
      fetTime.stop();
    } else {
      ws.sendCommand("stop");
    }
    setFrozenFetBaseline(fetBaselineData);
    setFrozenFetAnalyte(fetAnalyteData);
    setFetStatus("stopped");
    toast(`Stopped at ${fetReceivedTotal} / ${expectedFetTotal} points`);
  };

  // Auto-completion detection — EIS
  useEffect(() => {
    if (eisStatus !== "running") return;
    if (eisAutoStopFiredRef.current) return;
    if (eisData.length >= expectedEisPoints && expectedEisPoints > 0) {
      eisAutoStopFiredRef.current = true;
      if (dataSource === "simulated") {
        eis.stop();
      } else {
        ws.sendCommand("stop");
      }
      setFrozenEis(eisData);
      setEisStatus("complete");
      toast.success(`Sweep complete — ${eisData.length} points collected`);
    }
  }, [eisData, eisStatus, expectedEisPoints, dataSource, eis, ws]);

  // Auto-completion detection — BioFET (all 3 phases done)
  useEffect(() => {
    if (fetStatus !== "running") return;
    if (fetAutoStopFiredRef.current) return;
    const baselineDone = fetBaselineData.length >= expectedFetTransferPoints;
    const analyteDone = fetAnalyteData.length >= expectedFetTransferPoints;
    const timeDone = fetTimeDataArr.length >= expectedFetTimePoints;
    if (baselineDone && analyteDone && timeDone) {
      fetAutoStopFiredRef.current = true;
      if (dataSource === "simulated") {
        fetTransfer.stop();
        fetTime.stop();
      } else {
        ws.sendCommand("stop");
      }
      setFrozenFetBaseline(fetBaselineData);
      setFrozenFetAnalyte(fetAnalyteData);
      setFetStatus("complete");
      toast.success(`Sweep complete — ${fetReceivedTotal} points collected`);
    }
  }, [
    fetBaselineData,
    fetAnalyteData,
    fetTimeDataArr,
    fetStatus,
    expectedFetTransferPoints,
    expectedFetTimePoints,
    fetReceivedTotal,
    dataSource,
    fetTransfer,
    fetTime,
    ws,
  ]);

  // "Running" now means status === running, not just connected/animating
  const isEISRunning = eisStatus === "running";
  const isFETRunning = fetStatus === "running";

  // Data shown in Signal Quality (frozen after stop/complete)
  const sqEisData = frozenEis ?? eisData;
  const sqFetBaseline = frozenFetBaseline ?? fetBaselineData;
  const sqFetAnalyte = frozenFetAnalyte ?? fetAnalyteData;

  const handleChangeSource = (source: "simulated" | "live") => {
    // Reset everything when switching
    eis.reset();
    fetTransfer.reset();
    fetTime.reset();
    ws.clearEIS();
    ws.clearFET();
    setEisStatus("idle");
    setFetStatus("idle");
    setFrozenEis(null);
    setFrozenFetBaseline(null);
    setFrozenFetAnalyte(null);
    eisAutoStopFiredRef.current = false;
    fetAutoStopFiredRef.current = false;
    if (source === "simulated" && ws.status === "connected") {
      ws.disconnect();
    }
    setDataSource(source);
  };

  const sourceLabel = dataSource === "simulated" ? "Simulated Data" : (
    ws.status === "connected" ? "Live — Connected" : "Live — Not Connected"
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight font-mono">
            HelpStat
            <span className="text-primary ml-2 text-sm font-normal">Biosensor Dashboard</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            ESP32-S3 / AD5941 — {sourceLabel}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <div className={`w-2 h-2 rounded-full ${
            dataSource === "simulated"
              ? "bg-graph-alt"
              : ws.status === "connected"
                ? "bg-graph-primary"
                : ws.status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground"
          }`} />
          <span>{dataSource === "simulated" ? "Simulated" : ws.status === "connected" ? "Live" : "Offline"}</span>
        </div>
      </header>

      {/* Connection Panel */}
      <div className="mb-4">
        <ConnectionPanel
          dataSource={dataSource}
          onChangeSource={handleChangeSource}
          connectionStatus={ws.status}
          errorMessage={ws.errorMessage}
          onConnect={ws.connect}
          onDisconnect={ws.disconnect}
        />
      </div>

      {/* Measurement Parameters */}
      <div className="mb-4">
        <ParametersPanel
          mode={mode}
          eisParams={eisParams}
          fetParams={fetParams}
          onChangeEIS={setEisParams}
          onChangeFET={setFetParams}
          disabled={mode === "eis" ? isEISRunning : isFETRunning}
        />
      </div>

      {/* Mode selection */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button
            variant={mode === "eis" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("eis")}
            className="font-mono text-xs"
          >
            EIS Mode
          </Button>
          <Button
            variant={mode === "fet" ? "default" : "secondary"}
            size="sm"
            onClick={() => setMode("fet")}
            className="font-mono text-xs"
          >
            BioFET Mode
          </Button>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          {mode === "eis" ? (
            <>
              <Button
                size="sm"
                onClick={handleStartEIS}
                disabled={
                  isEISRunning ||
                  (dataSource === "live" && ws.status !== "connected")
                }
                className="font-mono text-xs"
              >
                ▶ Start EIS
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopEIS}
                disabled={!isEISRunning}
                className="font-mono text-xs"
              >
                ■ Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetEIS} className="font-mono text-xs">
                ↺ Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportEISData(eisData)}
                disabled={eisData.length === 0}
                className="font-mono text-xs"
              >
                ⬇ Export CSV
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleStartFET}
                disabled={
                  isFETRunning ||
                  (dataSource === "live" && ws.status !== "connected")
                }
                className="font-mono text-xs"
              >
                ▶ Start FET
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStopFET}
                disabled={!isFETRunning}
                className="font-mono text-xs"
              >
                ■ Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetFET} className="font-mono text-xs">
                ↺ Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  exportFETTransferData(fetBaselineData, fetAnalyteData);
                  if (fetTimeDataArr.length > 0) exportFETTimeData(fetTimeDataArr);
                }}
                disabled={fetBaselineData.length === 0 && fetTimeDataArr.length === 0}
                className="font-mono text-xs"
              >
                ⬇ Export CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {/* EIS MODE */}
      {mode === "eis" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Tabs defaultValue="nyquist" className="w-full">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="bg-secondary">
              <TabsTrigger value="nyquist" className="font-mono text-xs">Nyquist Plot</TabsTrigger>
              <TabsTrigger value="bode" className="font-mono text-xs">Bode Plot</TabsTrigger>
            </TabsList>
            <StatusIndicator
              isRunning={isEISRunning && eisData.length > 0}
              label={isEISRunning && eisData.length > 0 ? "Sweeping..." : "Idle"}
              dataPoints={eisData.length}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <TabsContent value="nyquist" className="mt-0 h-[400px] md:h-[500px]">
              <NyquistPlot data={eisData} />
            </TabsContent>
            <TabsContent value="bode" className="mt-0 h-[400px] md:h-[500px]">
              <BodePlot data={eisData} />
            </TabsContent>
          </div>

          <SweepProgress
            status={eisStatus}
            current={eisData.length}
            expected={expectedEisPoints}
          />

          {eisData.length > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Rs (Solution)", value: `${eisData[0]?.zReal.toFixed(0)} Ω` },
                { label: "Rct (Charge Transfer)", value: dataSource === "simulated" ? "~500 Ω" : "—" },
                { label: "Freq Range", value: dataSource === "simulated" ? "0.1 Hz – 100 kHz" : `${eisData[0]?.frequency.toFixed(1)} – ${eisData[eisData.length - 1]?.frequency.toFixed(1)} Hz` },
                { label: "Points", value: `${eisData.length}` },
              ].map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </Tabs>
        <SignalQuality mode="eis" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} />
        </div>
      )}

      {/* BIOFET MODE */}
      {mode === "fet" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Transfer Curve — Id vs Vg</h2>
              <StatusIndicator
                isRunning={isFETRunning && fetBaselineData.length > 0}
                label={isFETRunning && fetBaselineData.length > 0 ? "Sweeping Vg..." : "Idle"}
                dataPoints={fetBaselineData.length}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTransferPlot baseline={fetBaselineData} withAnalyte={fetAnalyteData} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Time Response — Id vs Time</h2>
              <StatusIndicator
                isRunning={isFETRunning && fetTimeDataArr.length > 0}
                label={isFETRunning && fetTimeDataArr.length > 0 ? "Recording..." : "Idle"}
                dataPoints={fetTimeDataArr.length}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTimePlot data={fetTimeDataArr} />
            </div>
          </div>

          <SweepProgress
            status={fetStatus}
            current={fetReceivedTotal}
            expected={expectedFetTotal}
            phases={[
              { label: "Baseline", current: fetBaselineData.length, expected: expectedFetTransferPoints },
              { label: "Analyte", current: fetAnalyteData.length, expected: expectedFetTransferPoints },
              { label: "Time response", current: fetTimeDataArr.length, expected: expectedFetTimePoints },
            ]}
          />

          {fetBaselineData.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Vth (Baseline)", value: dataSource === "simulated" ? "0.30 V" : "—" },
                { label: "Vth Shift (Cortisol)", value: dataSource === "simulated" ? "+0.15 V" : "—" },
                { label: "Baseline Id", value: dataSource === "simulated" ? "~25 µA" : "—" },
                { label: "Signal Drop", value: dataSource === "simulated" ? "~8 µA" : "—" },
              ].map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <SignalQuality mode="fet" eisData={sqEisData} fetBaseline={sqFetBaseline} fetAnalyte={sqFetAnalyte} />
        </div>
      )}

      <footer className="mt-8 text-center text-[10px] text-muted-foreground font-mono">
        HelpStat Biosensor v0.2 — {dataSource === "simulated" ? "Simulated Mode" : "Live Mode"} — ESP32-S3 WebSocket
      </footer>
    </div>
  );
};

export default Index;
