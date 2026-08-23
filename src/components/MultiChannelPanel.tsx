import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectionStatus } from "@/hooks/useWebSocketData";

/**
 * Multi-channel connection manager — up to 3 independent Live devices,
 * each backed by its own useWebSocketData() instance in the parent.
 * No math here: pure connection UI.
 */

export interface Channel {
  id: 1 | 2 | 3;
  label: string;
  url: string;
  enabled: boolean;
  color: string;
  /** Auto-reconnect with backoff after an unexpected drop (Multi-Channel only). */
  autoReconnect: boolean;
}

interface Props {
  channels: Channel[];
  statuses: ConnectionStatus[];
  errors: string[];
  onToggleEnabled: (index: number, enabled: boolean) => void;
  onChangeUrl: (index: number, url: string) => void;
  onRename: (index: number, label: string) => void;
  onToggleAutoReconnect: (index: number, autoReconnect: boolean) => void;
  onConnect: (index: number) => void;
  onDisconnect: (index: number) => void;
  layout: "combined" | "separate";
  onChangeLayout: (layout: "combined" | "separate") => void;
  showLayoutToggle: boolean;
}

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

export default function MultiChannelPanel({
  channels,
  statuses,
  errors,
  onToggleEnabled,
  onChangeUrl,
  onRename,
  onToggleAutoReconnect,
  onConnect,
  onDisconnect,
  layout,
  onChangeLayout,
  showLayoutToggle,
}: Props) {
  const [renaming, setRenaming] = useState<number | null>(null);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-mono text-muted-foreground uppercase">Channels</span>
        {showLayoutToggle && (
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono text-muted-foreground">Display:</span>
            <Button
              size="sm"
              variant={layout === "combined" ? "default" : "outline"}
              onClick={() => onChangeLayout("combined")}
              className="font-mono text-xs h-7 px-3"
            >
              Combined (1 plot)
            </Button>
            <Button
              size="sm"
              variant={layout === "separate" ? "default" : "outline"}
              onClick={() => onChangeLayout("separate")}
              className="font-mono text-xs h-7 px-3"
            >
              Separate (3 plots)
            </Button>
          </div>
        )}
      </div>

      {channels.map((c, i) => {
        const status = statuses[i] ?? "disconnected";
        const connected = status === "connected";
        return (
          <div key={c.id} className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => onToggleEnabled(i, e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
                aria-label={`Enable ${c.label}`}
              />
              {renaming === i ? (
                <Input
                  autoFocus
                  value={c.label}
                  onChange={(e) => onRename(i, e.target.value)}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => { if (e.key === "Enter") setRenaming(null); }}
                  className="font-mono text-xs h-8 w-32 bg-secondary"
                />
              ) : (
                <span className="font-mono text-xs w-24 truncate" style={{ color: c.color }}>
                  {c.label}
                </span>
              )}
              <Input
                value={c.url}
                onChange={(e) => onChangeUrl(i, e.target.value)}
                placeholder="ws://127.0.0.1:81"
                disabled={!c.enabled || connected || status === "connecting"}
                className="font-mono text-xs h-8 bg-secondary flex-1 min-w-[160px]"
              />
              <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground w-32">
                <span className={`w-2 h-2 rounded-full ${statusColor[status]}`} />
                {statusLabel[status]}
              </span>
              {connected ? (
                <Button size="sm" variant="destructive" onClick={() => onDisconnect(i)} className="font-mono text-xs h-8 px-3">
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => onConnect(i)}
                  disabled={!c.enabled || !c.url || status === "connecting"}
                  className="font-mono text-xs h-8 px-3"
                >
                  Connect
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setRenaming(i)} className="font-mono text-xs h-8 px-2">
                ✎
              </Button>
              <label className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                <input
                  type="checkbox"
                  checked={c.autoReconnect}
                  onChange={(e) => onToggleAutoReconnect(i, e.target.checked)}
                  className="accent-primary h-3 w-3"
                />
                auto-reconnect
              </label>
            </div>
            {errors[i] && <p className="text-xs font-mono text-destructive pl-6">{errors[i]}</p>}
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">
        Each enabled channel keeps its own independent connection. Start/Stop/Reset are broadcast
        to every enabled and connected channel. With auto-reconnect on, a dropped channel retries
        automatically with increasing backoff (1s → 30s).
      </p>
    </div>
  );
}
