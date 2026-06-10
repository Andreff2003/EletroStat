import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  glow?: boolean;
}

export function Panel({ title, subtitle, right, children, className = "", glow }: Props) {
  return (
    <section className={`panel ${glow ? "panel-glow" : ""} ${className}`}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{subtitle}</p>
          )}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
