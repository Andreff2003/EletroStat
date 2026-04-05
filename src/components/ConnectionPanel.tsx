import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectionStatus } from "@/hooks/useWebSocketData";

/**
 * Panel for switching between Simulated and Live data modes.
 * In Live mode, lets you enter the ESP32's WebSocket URL.
 */

interface ConnectionPanelProps {
  dataSource: "simulated" | "live";
  onChangeSource: (source: "simulated" | "live") => void;
  connectionStatus: ConnectionStatus;
  errorMessage: string;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
}

export default function ConnectionPanel({
  dataSource,
  onChangeSource,
  connectionStatus,
  errorMessage,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const [wsUrl, setWsUrl] = useState("ws://192.168.4.1:81");

  const statusColor: Record<ConnectionStatus, string> = {
    disconnected: "bg-muted-foreground",
    connecting: "bg-yellow-400 animate-pulse",
    connected: "bg-graph-primary",
    error: "bg-destructive",
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    connected: "Connected",
    error: "Error",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground uppercase">Data Source:</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={dataSource === "simulated" ? "default" : "outline"}
            onClick={() => onChangeSource("simulated")}
            className="font-mono text-xs h-7 px-3"
          >
            Simulated
          </Button>
          <Button
            size="sm"
            variant={dataSource === "live" ? "default" : "outline"}
            onClick={() => onChangeSource("live")}
            className="font-mono text-xs h-7 px-3"
          >
            Live (ESP32)
          </Button>
        </div>
      </div>

      {dataSource === "live" && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              placeholder="ws://192.168.4.1:81"
              className="font-mono text-xs h-8 bg-secondary"
              disabled={connectionStatus === "connected" || connectionStatus === "connecting"}
            />
            {connectionStatus === "connected" ? (
              <Button size="sm" variant="destructive" onClick={onDisconnect} className="font-mono text-xs h-8 px-3 shrink-0">
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onConnect(wsUrl)}
                disabled={connectionStatus === "connecting" || !wsUrl}
                className="font-mono text-xs h-8 px-3 shrink-0"
              >
                Connect
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <div className={`w-2 h-2 rounded-full ${statusColor[connectionStatus]}`} />
            <span>{statusLabel[connectionStatus]}</span>
          </div>

          {errorMessage && (
            <p className="text-xs font-mono text-destructive">{errorMessage}</p>
          )}

          {connectionStatus === "disconnected" && (
            <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">
              Enter the WebSocket URL of your ESP32-S3. Default AP mode address is ws://192.168.4.1:81.
              If connected to your WiFi network, use the ESP32's local IP.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
