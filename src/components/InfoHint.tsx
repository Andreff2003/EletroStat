import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Small ⓘ icon that opens a styled tooltip with a short explanation.
 * Rendered as a real <button> (not a bare SVG) so the hint is reachable by
 * Tab and has an accessible name — a screen reader announces `text` on
 * focus instead of skipping the icon entirely.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            className="inline-flex h-3 w-3 items-center justify-center align-[-1px] ml-1 border-0 bg-transparent p-0 text-muted-foreground/70 hover:text-foreground cursor-help"
          >
            <Info className="h-3 w-3" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Wraps an existing control (button, toggle…) with a styled tooltip. */
export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default InfoHint;
