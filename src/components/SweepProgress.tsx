import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";

export type SweepStatus = "idle" | "running" | "complete" | "stopped";

interface PhaseProgress {
  label: string;
  current: number;
  expected: number;
}

interface SweepProgressProps {
  status: SweepStatus;
  current: number;
  expected: number;
  /** Optional sub-phases (BioFET mode) */
  phases?: PhaseProgress[];
}

const SweepProgress = ({ status, current, expected, phases }: SweepProgressProps) => {
  const pct =
    expected > 0 ? Math.min(100, Math.round((current / expected) * 100)) : 0;

  let label: string;
  if (status === "complete") {
    label = `Complete — ${current} points collected`;
  } else if (status === "stopped") {
    label = `Stopped at ${current} / ${expected} points`;
  } else if (status === "running") {
    label = `Sweeping — ${current} / ${expected} points (${pct}%)`;
  } else {
    label = `Ready — 0 / ${expected} points`;
  }

  const isDone = status === "complete";

  return (
    <div className="rounded-lg border border-border bg-card p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isDone && <CheckCircle2 className="h-4 w-4 text-graph-eis" />}
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
            Sweep Progress
          </span>
        </div>
        <span
          className={`text-xs font-mono tabular-nums ${
            isDone ? "text-graph-eis" : "text-foreground"
          }`}
        >
          {label}
        </span>
      </div>

      <Progress
        value={pct}
        className={`h-2 ${isDone ? "[&>div]:bg-graph-eis" : ""}`}
      />

      {phases && phases.length > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {phases.map((p) => {
            const phasePct =
              p.expected > 0
                ? Math.min(100, Math.round((p.current / p.expected) * 100))
                : 0;
            const phaseDone = p.current >= p.expected && p.expected > 0;
            return (
              <div key={p.label} className="bg-secondary/60 rounded-md p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    {p.label}
                  </span>
                  <span
                    className={`text-[10px] font-mono tabular-nums ${
                      phaseDone ? "text-graph-eis" : "text-foreground"
                    }`}
                  >
                    {p.current}/{p.expected} pts
                  </span>
                </div>
                <Progress
                  value={phasePct}
                  className={`h-1.5 ${phaseDone ? "[&>div]:bg-graph-eis" : ""}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SweepProgress;