/**
 * Small status LED indicator — mimics lab equipment status lights.
 */
interface StatusIndicatorProps {
  isRunning: boolean;
  label: string;
  dataPoints: number;
}

const StatusIndicator = ({ isRunning, label, dataPoints }: StatusIndicatorProps) => {
  return (
    <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full ${
            isRunning
              ? "bg-primary animate-pulse"
              : dataPoints > 0
              ? "bg-graph-alt"
              : "bg-muted-foreground"
          }`}
        />
        <span>{label}</span>
      </div>
      <span className="text-muted-foreground/60">|</span>
      <span>{dataPoints} pts</span>
    </div>
  );
};

export default StatusIndicator;
