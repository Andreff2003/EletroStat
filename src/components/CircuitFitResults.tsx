import type { RandlesFitResult, WarburgResult, KKResult } from "@/utils/randlesFit";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  fit: RandlesFitResult | null;
  warburg: WarburgResult | null;
  kk?: KKResult | null;
}

/**
 * Randles equivalent-circuit fit results + Warburg slope.
 * Rct is highlighted as the primary calibration parameter.
 */
const CircuitFitResults = ({ fit, warburg, kk }: Props) => {
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
  const f0 = fit.f0 ?? (1 / (2 * Math.PI * Math.max(fit.Rct, 1e-9) * Math.max(fit.Cdl, 1e-30)));
  const f0Str = Number.isFinite(f0)
    ? f0 >= 0.01 && f0 < 1e6
      ? f0.toFixed(2)
      : f0.toExponential(2)
    : "—";

  const warburgStartFreq = fit.warburgStartFreq ?? 0;
  const hasWarburg = warburgStartFreq > 0;
  const warburgDominated = fit.warburgDominated === true;
  const rctResolved = fit.rctResolved !== false;
  const cdlResolved = fit.cdlResolved !== false;

  const rsCard = (
    <div key="rs" className="bg-secondary rounded-md p-2">
      <div className="text-[10px] text-muted-foreground font-mono uppercase">Rs</div>
      <div className="text-sm font-mono text-foreground">{fmt(fit.Rs, 1)} Ω</div>
    </div>
  );
  const rctCard = (
    <div
      key="rct"
      className={
        rctResolved
          ? "bg-primary/15 border border-primary/40 rounded-md p-2"
          : "bg-muted/40 border border-border rounded-md p-2"
      }
    >
      <div
        className={
          rctResolved
            ? "text-[10px] text-primary font-mono uppercase"
            : "text-[10px] text-muted-foreground font-mono uppercase"
        }
      >
        Rct {rctResolved ? "★" : ""}
      </div>
      <div
        className={
          rctResolved
            ? "text-sm font-mono text-primary font-semibold"
            : "text-sm font-mono text-muted-foreground"
        }
      >
        {fmt(fit.Rct, 1)} Ω
      </div>
      {!rctResolved && (
        <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
          (not resolved — diffusion-limited)
        </div>
      )}
    </div>
  );
  const cdlCard = (
    <div key="cdl" className="bg-secondary rounded-md p-2">
      <div className="text-[10px] text-muted-foreground font-mono uppercase">Cdl</div>
      <div className="text-sm font-mono text-foreground">
        {cdlMicroF >= 0.01 ? fmt(cdlMicroF, 3) : cdlMicroF.toExponential(2)} µF
      </div>
      {!cdlResolved && (
        <div className="text-[9px] font-mono text-muted-foreground mt-0.5">(default)</div>
      )}
    </div>
  );
  const awCard = (
    <div
      key="aw"
      className={
        warburgDominated
          ? "bg-primary/15 border border-primary/40 rounded-md p-2"
          : "bg-secondary rounded-md p-2"
      }
    >
      <div
        className={
          warburgDominated
            ? "text-[10px] text-primary font-mono uppercase"
            : "text-[10px] text-muted-foreground font-mono uppercase"
        }
      >
        Aw {warburgDominated ? "★" : ""}
      </div>
      <div
        className={
          warburgDominated
            ? "text-sm font-mono text-primary font-semibold"
            : "text-sm font-mono text-foreground"
        }
      >
        {fmt(fit.Aw, 2)} Ω/√s
      </div>
    </div>
  );

  const paramCards = warburgDominated
    ? [rsCard, awCard, rctCard, cdlCard]
    : [rsCard, rctCard, cdlCard, awCard];

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <h3 className="text-sm font-mono text-muted-foreground">
        Equivalent Circuit (Randles)
      </h3>

      <div className="grid grid-cols-2 gap-2">{paramCards}</div>

      {fit.semicirclePoints !== undefined && fit.totalPoints !== undefined && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Fit region:{" "}
          {hasWarburg ? `${warburgStartFreq.toFixed(1)} Hz` : "full sweep"}
          {hasWarburg ? " – 100 kHz" : ""}
          {" "}({fit.semicirclePoints} of {fit.totalPoints} points)
        </div>
      )}

      {hasWarburg && (
        <div className="bg-blue-950/40 border border-blue-700/40 rounded p-2 text-xs">
          <p className="text-blue-300 font-semibold">
            ℹ Warburg tail detected below {warburgStartFreq.toFixed(1)} Hz
          </p>
          <p className="text-muted-foreground mt-1">
            Rct and Cdl extracted from semicircle region only.
            Aw (diffusion coefficient) extracted from Warburg tail.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground">Fit error</span>
        <span className={fit.fitErrorPct < 5 ? "text-graph-primary" : fit.fitErrorPct < 15 ? "text-foreground" : "text-destructive"}>
          {fmt(fit.fitErrorPct, 2)} %
        </span>
      </div>

      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-between text-xs font-mono cursor-help border-t border-border pt-2">
              <span className="text-muted-foreground">f₀ (characteristic)</span>
              <span className="text-foreground">{f0Str} Hz</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs font-mono">
            Peak frequency of the semicircle. Confirms Rct × Cdl product.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {fit.warnFlags && fit.warnFlags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {fit.warnFlags.map((w, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-mono text-yellow-500"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}

      {kk && (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="border-t border-border pt-2 cursor-help space-y-1">
                <span
                  className={
                    kk.passed
                      ? "inline-flex items-center rounded-md border border-graph-primary/40 bg-graph-primary/10 px-2 py-0.5 text-[10px] font-mono text-graph-primary"
                      : "inline-flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-mono text-destructive"
                  }
                >
                  {kk.passed ? "✓" : "✗"} KK Test {kk.passed ? "passed" : "failed"} ({kk.residualPct.toFixed(1)}%)
                </span>
                {!kk.passed && kk.warning && (
                  <div className="text-[10px] font-mono text-destructive leading-snug">
                    {kk.warning}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs font-mono">
              Kramers-Kronig test verifies that the system is linear, causal and stable during the measurement. A passing result validates that the EIS spectrum is physically meaningful.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="border-t border-border pt-2 space-y-1">
        <div className="text-[10px] text-muted-foreground font-mono uppercase">Warburg (low-freq tail)</div>
        {warburg && warburg.ok ? (
          <>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground">Slope</span>
              <span className="text-foreground">
                {fmt(warburg.slope!, 2)}
                <span className="text-muted-foreground ml-2">(ideal 1.00)</span>
              </span>
            </div>
            {warburg.warburgWarning && (
              <div className="text-[10px] font-mono text-yellow-500 leading-snug pt-1">
                ⚠ {warburg.warburgWarning}
              </div>
            )}
          </>
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