import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import NyquistPlot from "@/components/NyquistPlot";
import BodePlot from "@/components/BodePlot";
import FETTransferPlot from "@/components/FETTransferPlot";
import FETTimePlot from "@/components/FETTimePlot";
import StatusIndicator from "@/components/StatusIndicator";
import {
  useSimulatedEIS,
  useSimulatedFETTransfer,
  useSimulatedFETTime,
} from "@/hooks/useSimulatedData";

/**
 * ============================================================
 * HELPSTAT BIOSENSOR DASHBOARD
 * ============================================================
 * Main page with two measurement modes:
 * 
 * 1. EIS Mode — Nyquist plot + Bode plot
 *    For electrochemical impedance spectroscopy
 * 
 * 2. BioFET Mode — Transfer curve + Time response
 *    For cortisol detection using aptamers or MIPs
 * 
 * >>> REAL HARDWARE CONNECTION >>>
 * To connect to ESP32-S3 via WiFi:
 * 1. ESP32 runs a WebSocket server (e.g., on port 81)
 * 2. Connect from this app: new WebSocket("ws://ESP32_IP:81")
 * 3. Parse incoming JSON data and feed to the plots
 * 4. See useSimulatedData.ts for the data format expected
 * ============================================================
 */

const Index = () => {
  const [mode, setMode] = useState<"eis" | "fet">("eis");

  // EIS simulation hooks
  const eis = useSimulatedEIS(150);

  // BioFET simulation hooks
  const fetTransfer = useSimulatedFETTransfer(80);
  const fetTime = useSimulatedFETTime(150);

  const handleStartEIS = () => eis.start();
  const handleResetEIS = () => eis.reset();

  const handleStartFET = () => {
    fetTransfer.start();
    fetTime.start();
  };
  const handleResetFET = () => {
    fetTransfer.reset();
    fetTime.reset();
  };

  const isEISRunning = eis.isRunning;
  const isFETRunning = fetTransfer.isRunning || fetTime.isRunning;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight font-mono">
            HelpStat
            <span className="text-primary ml-2 text-sm font-normal">Biosensor Dashboard</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            ESP32-S3 / AD5941 — Simulated Data Mode
          </p>
        </div>

        {/* Connection status — will be useful for real hardware */}
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-graph-alt" />
          <span>Simulated</span>
          {/* >>> REAL HARDWARE >>> Change to "Connected" when WebSocket is open */}
        </div>
      </header>

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
              <Button size="sm" onClick={handleStartEIS} disabled={isEISRunning} className="font-mono text-xs">
                ▶ Start EIS
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetEIS} className="font-mono text-xs">
                ↺ Reset
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={handleStartFET} disabled={isFETRunning} className="font-mono text-xs">
                ▶ Start FET
              </Button>
              <Button size="sm" variant="secondary" onClick={handleResetFET} className="font-mono text-xs">
                ↺ Reset
              </Button>
            </>
          )}
        </div>
      </div>

      {/* EIS MODE */}
      {mode === "eis" && (
        <Tabs defaultValue="nyquist" className="w-full">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="bg-secondary">
              <TabsTrigger value="nyquist" className="font-mono text-xs">Nyquist Plot</TabsTrigger>
              <TabsTrigger value="bode" className="font-mono text-xs">Bode Plot</TabsTrigger>
            </TabsList>
            <StatusIndicator
              isRunning={isEISRunning}
              label={isEISRunning ? "Sweeping..." : "Idle"}
              dataPoints={eis.data.length}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-3">
            <TabsContent value="nyquist" className="mt-0 h-[400px] md:h-[500px]">
              <NyquistPlot data={eis.data} />
            </TabsContent>
            <TabsContent value="bode" className="mt-0 h-[400px] md:h-[500px]">
              <BodePlot data={eis.data} />
            </TabsContent>
          </div>

          {/* Data info panel */}
          {eis.data.length > 0 && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Rs (Solution)", value: `${eis.data[0]?.zReal.toFixed(0)} Ω` },
                { label: "Rct (Charge Transfer)", value: `~500 Ω` },
                { label: "Freq Range", value: "0.1 Hz – 100 kHz" },
                { label: "Points", value: `${eis.data.length}` },
              ].map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </Tabs>
      )}

      {/* BIOFET MODE */}
      {mode === "fet" && (
        <div className="space-y-4">
          {/* Transfer Curve */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Transfer Curve — Id vs Vg</h2>
              <StatusIndicator
                isRunning={fetTransfer.isRunning}
                label={fetTransfer.isRunning ? "Sweeping Vg..." : "Idle"}
                dataPoints={fetTransfer.baseline.length}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTransferPlot baseline={fetTransfer.baseline} withAnalyte={fetTransfer.withAnalyte} />
            </div>
          </div>

          {/* Time Response */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-mono text-muted-foreground">Time Response — Id vs Time</h2>
              <StatusIndicator
                isRunning={fetTime.isRunning}
                label={fetTime.isRunning ? "Recording..." : "Idle"}
                dataPoints={fetTime.data.length}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3 h-[300px] md:h-[350px]">
              <FETTimePlot data={fetTime.data} />
            </div>
          </div>

          {/* Info panel */}
          {fetTransfer.baseline.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Vth (Baseline)", value: "0.30 V" },
                { label: "Vth Shift (Cortisol)", value: "+0.15 V" },
                { label: "Baseline Id", value: "~25 µA" },
                { label: "Signal Drop", value: "~8 µA" },
              ].map((item) => (
                <div key={item.label} className="bg-secondary rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground font-mono uppercase">{item.label}</div>
                  <div className="text-sm font-mono text-foreground">{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 text-center text-[10px] text-muted-foreground font-mono">
        HelpStat Biosensor v0.1 — Simulated Mode — Connect ESP32-S3 via WebSocket for live data
      </footer>
    </div>
  );
};

export default Index;
