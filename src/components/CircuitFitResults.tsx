import type { RandlesFitResult, WarburgResult } from "@/utils/randlesFit";

interface Props {
  fit: RandlesFitResult | null;
  warburg: WarburgResult | null;
}

/**
 * Randles equivalent-circuit fit results + Warburg slope.
 * Rct is highlighted as the primary calibration parameter.
 */
const CircuitFitResults = ({ fit, warburg }: Props) => {
  if (!fit) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-mono text-muted-foreground mb-2">
          Equivalent Circuit (Randles)
        </h3>
        <p className="text-xs text-muted-foreground font-mono">
          Fit will run automatically when a sweep completes.
        </p>
      </div>
    );
  }

  const fmt = (v: number, digits = 2) =>
    Number.isFinite(v) ? v.toFixed(digits) : "—";

  const cdlMicroF = fit.Cdl * 1e6;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <h3 className="text-sm font-mono text-muted-foreground">
        Equivalent Circuit (Randles)
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-secondary rounded-md p-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Rs</div>
          <div className="text-sm font-mono text-foreground">{fmt(fit.Rs, 1)} Ω</div>
        </div>
        <div className="bg-primary/15 border border-primary/40 rounded-md p-2">
          <div className="text-[10px] text-primary font-mono uppercase">Rct ★</div>
          <div className="text-sm font-mono text-primary font-semibold">{fmt(fit.Rct, 1)} Ω</div>
        </div>
        <div className="bg-secondary rounded-md p-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Cdl</div>
          <div className="text-sm font-mono text-foreground">
            {cdlMicroF >= 0.01 ? fmt(cdlMicroF, 3) : cdlMicroF.toExponential(2)} µF
          </div>
        </div>
        <div className="bg-secondary rounded-md p-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase">Aw</div>
          <div className="text-sm font-mono text-foreground">{fmt(fit.Aw, 2)} Ω/√s</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground">Fit error</span>
        <span className={fit.fitErrorPct < 5 ? "text-graph-primary" : fit.fitErrorPct < 15 ? "text-foreground" : "text-destructive"}>
          {fmt(fit.fitErrorPct, 2)} %
        </span>
      </div>

      <div className="border-t border-border pt-2 space-y-1">
        <div className="text-[10px] text-muted-foreground font-mono uppercase">Warburg (low-freq tail)</div>
        {warburg && warburg.ok ? (
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">Slope</span>
            <span className="text-foreground">
              {fmt(warburg.slope!, 2)}
              <span className="text-muted-foreground ml-2">(ideal 1.00)</span>
            </span>
          </div>
        ) : (
          <div className="text-xs font-mono text-muted-foreground">
            Insufficient low-frequency data
          </div>
        )}
      </div>
    </div>
  );
};

export default CircuitFitResults;