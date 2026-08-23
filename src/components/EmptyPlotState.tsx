import type React from "react";

interface EmptyPlotStateProps {
  icon?: React.ReactNode;
  title: string;
  hint: string;
}

export function EmptyPlotState({ icon, title, hint }: EmptyPlotStateProps) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center px-6">
      {icon}
      <p className="text-sm text-foreground/80">{title}</p>
      <p className="text-xs text-muted-foreground max-w-[320px]">{hint}</p>
    </div>
  );
}

export default EmptyPlotState;
