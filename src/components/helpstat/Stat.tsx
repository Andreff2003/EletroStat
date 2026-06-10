interface Props {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "muted";
}

export function Stat({ label, value, unit, hint, tone = "default" }: Props) {
  const toneClass =
    tone === "ok" ? "text-[var(--ok)]"
    : tone === "warn" ? "text-[var(--warn)]"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg leading-none ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
