import type { CircuitModel, EISFitResult } from "@/utils/eisFit";
import { formatParamValue, getCircuitLabel } from "@/utils/eisFit";
import type { RandlesFitResult, WarburgResult, KKResult } from "@/utils/randlesFit";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  fit: EISFitResult | null;
  model: CircuitModel;
  randlesFit?: RandlesFitResult | null;
  warburg?: WarburgResult | null;
  kk?: KKResult | null;
}

/**
 * Scientific CNLS fit results.
 * Each parameter is shown with its modulus-weighted standard error (%),
 * plus the reduced χ² as the global quality-of-fit indicator.
 */
const CNLSFitResults = ({ fit, model, randlesFit, warburg, kk }: Props) => {
  if (!fit) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-sm font-mono text-muted-foreground mb-2">
          CNLS Fit — {getCircuitLabel(model)}
        </h3>
        <p className="text-xs text-muted-foreground font-mono">
          Select a circuit, set the separator and click <span className="text-foreground">Fit</span>.
        </p>
      </div>
    );
  }

  const fmtErr = (e: number) =>
    Number.isFinite(e) ? `±${e < 0.01 ? e.toExponential(1) : e.toFixed(2)}%` : "±—";

  const chi = fit.chiSquared;
  const chiStr =
    chi >= 0.01 && chi < 1e4 ? chi.toFixed(4) : chi.toExponential(3);

  const chiClass =
    chi < 1e-3 ? "text-graph-primary"
    : chi < 1e-2 ? "text-foreground"
    : "text-destructive";

  // Warburg region present?
  const hasWarburg = !!(warburg && warburg.ok && (warburg.nPoints ?? 0) >= 3);
  const awValue = warburg?.Aw ?? randlesFit?.Aw;
  const awErr = randlesFit?.errors?.Aw;
  const slope = warburg?.slope;
  const slopeBad = typeof slope === "number" && (slope < 0.5 || slope > 2.0);

  // f₀ characteristic frequency from CNLS params
  const Rct = fit.params.Rct;
  const Cdl = fit.params.Cdl;
  const f0 = Rct && Cdl
    ? 1 / (2 * Math.PI * Rct * Cdl)
    : randlesFit?.f0;
  const f0Str = Number.isFinite(f0 ?? NaN)
    ? (f0! >= 0.01 && f0! < 1e6 ? f0!.toFixed(2) : f0!.toExponential(2))
    : "—";

  // Fit error % — prefer CNLS chi-squared (modulus-weighted), fall back to randlesFit
  // Convert chiSquared (dimensionless weighted SSR/dof) to a % for display:
  //   chiSquared ~ 1e-5 for excellent fit, ~1e-2 for poor fit
  //   Display as sqrt(chiSquared)*100 so units are comparable to RMSE %
  const fitErrorPct = fit?.chiSquared != null
    ? Math.sqrt(fit.chiSquared) * 100
    : randlesFit?.fitErrorPct;
  // Fit error = sqrt(chi2_red)*100: <2% excellent, <8% good, >=8% poor
  const fitErrColor = (v: number) =>
    v < 2 ? "text-graph-primary" : v < 8 ? "text-foreground" : "text-destructive";

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-mono text-muted-foreground">
          CNLS Fit
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground text-right">
          {getCircuitLabel(model)}
        </span>
      </div>

      <div className="space-y-1.5">
        {Object.keys(fit.params).map((name) => {
          const v   = fit.params[name];
          const e   = fit.errors[name];
          const u   = fit.units[name] ?? "";
          const errPct = Number.isFinite(e) ? e : Infinity;
          const errClass =
            errPct < 5  ? "text-graph-primary"
            : errPct < 20 ? "text-foreground"
            : "text-destructive";
          return (
            <div
              key={name}
              className="flex items-center justify-between bg-secondary rounded-md p-2"
            >
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">
                  {name}
                </span>
                <span className="text-sm font-mono text-foreground">
                  {formatParamValue(name, v, u)}
                </span>
              </div>
              <span className={`text-xs font-mono ${errClass}`}>
                {fmtErr(errPct)}
              </span>
            </div>
          );
        })}
      </div>

      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-between text-xs font-mono cursor-help border-t border-border pt-2">
              <span className="text-muted-foreground">Weighted SSR / dof</span>
              <span className={chiClass}>{chiStr}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs font-mono">
            Σ wᵢ [(Z' − Z'ₑ)² + (Z'' − Z''ₑ)²] / (2N − P) with wᵢ = 1/|Zᵢ|².
            Note: modulus weights are unitless (not 1/σ²), so the classical
            χ²≈1 criterion does NOT apply. Use this as a relative goodness
            indicator — lower = better fit.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>N = {fit.nPoints} points</span>
        <span>P = {fit.nFreeParams} free params</span>
        <span>dof = {Math.max(2 * fit.nPoints - fit.nFreeParams, 0)}</span>
      </div>

      {/* Aw card or "no Warburg" notice */}
      {hasWarburg && Number.isFinite(awValue ?? NaN) ? (
        <div className="flex items-center justify-between bg-secondary rounded-md p-2">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-muted-foreground uppercase">Aw</span>
            <span className="text-sm font-mono text-foreground">
              {awValue!.toFixed(3)} Ω/√s
            </span>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            {Number.isFinite(awErr) ? `±${awErr!.toFixed(2)}%` : "±—"}
          </span>
        </div>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground border-t border-border pt-2">
          Aw — no Warburg region detected
        </div>
      )}

      {/* Fit error % */}
      {Number.isFinite(fitErrorPct ?? NaN) && (
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground">Fit error</span>
          <span className={fitErrColor(fitErrorPct!)}>{fitErrorPct!.toFixed(2)} %</span>
        </div>
      )}

      {/* f₀ characteristic */}
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-between text-xs font-mono cursor-help">
              <span className="text-muted-foreground">f₀ (characteristic)</span>
              <span className="text-foreground">{f0Str} Hz</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs font-mono">
            = 1 / (2π · Rct · Cdl)
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* KK test */}
      {kk && (
        <div className="border-t border-border pt-2 space-y-1">
          <span
            className={
              kk.passed
                ? "inline-flex items-center rounded-md border border-graph-primary/40 bg-graph-primary/10 px-2 py-0.5 text-[10px] font-mono text-graph-primary"
                : "inline-flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-mono text-destructive"
            }
          >
            {kk.passed ? "✓" : "✗"} KK {kk.passed ? "passed" : "failed"} ({kk.residualPct.toFixed(1)}%)
          </span>
          {!kk.passed && kk.warning && (
            <div className="text-[10px] font-mono text-destructive leading-snug">
              {kk.warning}
            </div>
          )}
        </div>
      )}

      {/* Warburg slope */}
      {hasWarburg && typeof slope === "number" && (
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground">Warburg slope</span>
          <span className="flex items-center gap-2">
            <span className="text-foreground">
              {slope.toFixed(2)}
              <span className="text-muted-foreground ml-2">(ideal 1.00)</span>
            </span>
            {slopeBad && (
              <span className="inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[9px] font-mono text-yellow-500">
                ⚠
              </span>
            )}
          </span>
        </div>
      )}

      {/* Existing CNLS warnings */}
      {fit.warnings && fit.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {fit.warnings.map((w, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-mono text-yellow-500"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}

      {/* Randles warn flags */}
      {randlesFit?.warnFlags && randlesFit.warnFlags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {randlesFit.warnFlags.map((w, i) => (
            <span
              key={`rf-${i}`}
              className="inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-mono text-yellow-500"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default CNLSFitResults;
