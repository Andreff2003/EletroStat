import type { ReactNode } from "react";

interface DashboardCellProps {
  title: string;
  status: "idle" | "running" | "complete" | "error";
  onOpen: () => void;
  children: ReactNode;
}

const STATUS_DOT: Record<DashboardCellProps["status"], string> = {
  idle: "bg-muted-foreground/40",
  running: "bg-primary animate-pulse",
  complete: "bg-graph-primary",
  error: "bg-destructive",
};

const STATUS_TEXT: Record<DashboardCellProps["status"], string> = {
  idle: "Idle",
  running: "Running",
  complete: "Complete",
  error: "Error",
};

export function DashboardCell({ title, status, onOpen, children }: DashboardCellProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-xs font-mono text-foreground">{title}</span>
          <span className="text-[10px] text-muted-foreground">{STATUS_TEXT[status]}</span>
        </div>
        <button onClick={onOpen} className="text-[10px] text-primary hover:underline">
          Open →
        </button>
      </div>
      <div className="h-[300px]">{children}</div>
    </div>
  );
}

export default DashboardCell;
