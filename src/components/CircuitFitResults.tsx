import type { RandlesFitResult, WarburgResult, KKResult } from "@/utils/randlesFit";
import type { LinKKResult } from "@/utils/linKK";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoHint } from "@/components/InfoHint";
import { PARAM_HINTS } from "@/components/CNLSFitResults";

interface Props {
  fit: RandlesFitResult | null;
  warburg: WarburgResult | null;
  kk?: KKResult | null;
  linKK?: LinKKResult | null;
}

/**
 * Randles equivalent-circuit fit results + Warburg slope.
 * Rct is highlighted as the primary calibration parameter.
 */
const CircuitFitResults = ({ fit, warburg, kk, linKK }: Props) => {
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
  // f0 is rendered by the CNLS panel above to avoid showing the same number
  // twice — kept here in `fit.f0` for downstream consumers, not displayed.

  const fitAny = fit as RandlesFitResult & {
    warburgStartFreq?: number;
    warburgDominated?: boolean;
    rctResolved?: boolean;
    cdlResolved?: boolean;
  };
  const warburgStartFreq = fitAny.warburgStartFreq ?? 0;
  const hasWarburg = warburgStartFreq > 0;
  const warburgDominated = fitAny.warburgDominated === true;
  const rctResolved = fitAny.rctResolved !== false;
  const cdlResolved = fitAny.cdlResolved !== false;

  const isAuto = fit.auto === true;
  const errs = fit.errors;
  const fmtErr = (name: string): string => {
    const e = errs?.[name];
    return Number.isFinite(e) ? ` ± ${e!.toFixed(1)}%` : "";
  };

  const rsCard = (
    <div key="rs" className="bg-secondary rounded-md p-2">
      <div className="text-[10px] text-muted-foreground font-mono uppercase">Rs<InfoHint text={PARAM_HINTS.Rs} /></div>
      <div className="text-sm font-mono text-foreground">{fmt(fit.Rs, 1)} Ω<span className="text-[10px] text-muted-foreground">{fmtErr("Rs")}</span></div>
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
        Rct {rctResolved ? "★" : ""}<InfoHint text={PARAM_HINTS.Rct} />
      </div>
      <div
        className={
          rctResolved
            ? "text-sm font-mono text-primary font-semibold"
            : "text-sm font-mono text-muted-foreground"
        }
      >
        {fmt(fit.Rct, 1)} Ω<span className="text-[10px] text-muted-foreground font-normal">{fmtErr("Rct")}</span>
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
      <div className="text-[10px] text-muted-foreground font-mono uppercase">Cdl<InfoHint text={PARAM_HINTS.Cdl} /></div>
      <div className="text-sm font-mono text-foreground">
        {cdlMicroF >= 0.01 ? fmt(cdlMicroF, 3) : cdlMicroF.toExponential(2)} µF
        <span className="text-[10px] text-muted-foreground">{fmtErr("Cdl")}</span>
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
        Aw {warburgDominated ? "★" : ""}<InfoHint text={PARAM_HINTS.Aw} />
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-muted-foreground">
          Equivalent Circuit (Randles){isAuto ? " · auto" : ""}
        </h3>
        {isAuto && fit.chiSquared !== undefined && (
          fit.chiSquared < 0.01 ? (
            <span className="text-[10px] font-mono text-graph-primary">✓ good fit</span>
          ) : fit.chiSquared > 0.05 ? (
            <span className="text-[10px] font-mono text-destructive">⚠ poor fit</span>
          ) : null
        )}
      </div>

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

      {/* Weighted SSR / dof, f₀ and Approx KK rows are intentionally omitted
          here — the CNLS Fit panel above already reports them and showing the
          same numbers twice was misleading. */}



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

      {linKK && (
        <div className="border-t border-border pt-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Lin-KK validation
            </span>
            <span
              className={
                linKK.passed
                  ? "inline-flex items-center rounded-md border border-graph-primary/40 bg-graph-primary/10 px-2 py-0.5 text-[10px] font-mono text-graph-primary"
                  : linKK.residualRmsPct <= 10
                    ? "inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-mono text-yellow-500"
                    : "inline-flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-mono text-destructive"
              }
            >
              {linKK.passed ? "✓ Pass" : linKK.residualRmsPct <= 10 ? "⚠ Warning" : "✗ Fail"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-muted-foreground">
            <div>RMS: <span className="text-foreground">{linKK.residualRmsPct.toFixed(2)} %</span></div>
            <div>Max: <span className="text-foreground">{linKK.maxResidualPct.toFixed(2)} %</span></div>
            <div>RC: <span className="text-foreground">{linKK.tauCount}</span></div>
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/70 leading-snug">
            Passing supports consistency with linear, causal, stable EIS behavior within the measured frequency range.
          </div>
        </div>
      )}

      {/* Approx. KK badge removed from main UI — Lin-KK above is the
          consistency check shown to the user. Approx KK is kept in the
          CSV export (marked informational only). */}
      {kk == null && null}

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