import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * Measurement parameters for both EIS and BioFET modes.
 * These values are sent with the start command to the ESP32.
 */
export interface EISParams {
  freqMin: number;
  freqMax: number;
  points: number;
  amplitude: number; // mV
}

export interface FETParams {
  vgMin: number; // V
  vgMax: number; // V
  vgStep: number; // mV (converted to V before sending)
  intervalMs: number;
}

export const DEFAULT_EIS_PARAMS: EISParams = {
  freqMin: 100,
  freqMax: 100000,
  points: 60,
  amplitude: 10,
};

export const DEFAULT_FET_PARAMS: FETParams = {
  vgMin: -0.5,
  vgMax: 1.5,
  vgStep: 40,
  intervalMs: 200,
};

interface ParametersPanelProps {
  mode: "eis" | "fet";
  eisParams: EISParams;
  fetParams: FETParams;
  onChangeEIS: (params: EISParams) => void;
  onChangeFET: (params: FETParams) => void;
  disabled?: boolean;
}

interface NumFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}

const NumField = ({ label, value, min, max, step, onChange, disabled, hint }: NumFieldProps) => (
  <div className="flex flex-col gap-1">
    <Label className="text-[10px] font-mono uppercase text-muted-foreground">{label}</Label>
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step ?? "any"}
      disabled={disabled}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) {
          onChange(Math.min(max, Math.max(min, n)));
        }
      }}
      className="h-8 font-mono text-xs"
    />
    {hint && <span className="text-[10px] text-muted-foreground font-mono">{hint}</span>}
  </div>
);

const ParametersPanel = ({
  mode,
  eisParams,
  fetParams,
  onChangeEIS,
  onChangeFET,
  disabled,
}: ParametersPanelProps) => {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm text-foreground">Measurement Parameters</span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase">
            {mode === "eis" ? "EIS" : "BioFET"}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t border-border px-3 pb-3 pt-3">
        {mode === "eis" ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumField
              label="Frequency Min (Hz)"
              value={eisParams.freqMin}
              min={1}
              max={100000}
              onChange={(v) => onChangeEIS({ ...eisParams, freqMin: v })}
              disabled={disabled}
            />
            <NumField
              label="Frequency Max (Hz)"
              value={eisParams.freqMax}
              min={100}
              max={1000000}
              onChange={(v) => onChangeEIS({ ...eisParams, freqMax: v })}
              disabled={disabled}
            />
            <NumField
              label="Number of Points"
              value={eisParams.points}
              min={10}
              max={200}
              step={1}
              onChange={(v) => onChangeEIS({ ...eisParams, points: Math.round(v) })}
              disabled={disabled}
              hint="10 – 200"
            />
            <NumField
              label="Excitation Amp (mV)"
              value={eisParams.amplitude}
              min={1}
              max={200}
              onChange={(v) => onChangeEIS({ ...eisParams, amplitude: v })}
              disabled={disabled}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumField
              label="Vg Min (V)"
              value={fetParams.vgMin}
              min={-2}
              max={0}
              onChange={(v) => onChangeFET({ ...fetParams, vgMin: v })}
              disabled={disabled}
            />
            <NumField
              label="Vg Max (V)"
              value={fetParams.vgMax}
              min={0}
              max={3}
              onChange={(v) => onChangeFET({ ...fetParams, vgMax: v })}
              disabled={disabled}
            />
            <NumField
              label="Vg Step (mV)"
              value={fetParams.vgStep}
              min={1}
              max={200}
              onChange={(v) => onChangeFET({ ...fetParams, vgStep: v })}
              disabled={disabled}
            />
            <NumField
              label="Sampling Interval (ms)"
              value={fetParams.intervalMs}
              min={50}
              max={2000}
              step={1}
              onChange={(v) => onChangeFET({ ...fetParams, intervalMs: Math.round(v) })}
              disabled={disabled}
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default ParametersPanel;
