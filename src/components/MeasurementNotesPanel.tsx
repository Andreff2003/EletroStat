import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { MeasurementNotes } from "@/utils/measurementNotes";

export interface MeasurementNotesPanelProps {
  value: MeasurementNotes;
  onChange: (next: MeasurementNotes) => void;
  onClear: () => void;
  mode?: "eis" | "fet" | "cv" | "swv";
  onCopyFromPrevious?: () => void;
  hasPrevious?: boolean;
  previousNotes?: MeasurementNotes | null;
  measurementId?: string;
  measurementTimestamp?: number;
}

const HEADERS: Record<NonNullable<MeasurementNotesPanelProps["mode"]>, string> = {
  eis: "EIS Logbook",
  fet: "BioFET Logbook",
  cv: "CV Logbook",
  swv: "SWV Logbook",
};

/**
 * Generic logbook / measurement notes panel shared by EIS, BioFET and CV.
 *
 * Purely metadata — never influences solver, baseline, fitting or metrics.
 * `tagsDraft` is synced to `value.tags` so external mutations (copy from
 * previous, load measurement, clear) update the visible chip input.
 */
const MeasurementNotesPanel = ({
  value,
  onChange,
  onClear,
  mode = "cv",
  onCopyFromPrevious,
  hasPrevious,
  previousNotes,
  measurementId,
  measurementTimestamp,
}: MeasurementNotesPanelProps) => {
  const [showConditions, setShowConditions] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string>(
    (value.tags ?? []).join(", "),
  );

  // Keep the visible tags input in sync when `value.tags` changes from outside
  // (copy-from-previous, clear, loading another measurement…).
  useEffect(() => {
    setTagsDraft((value.tags ?? []).join(", "));
  }, [value.tags]);

  const update = <K extends keyof MeasurementNotes>(
    key: K,
    v: MeasurementNotes[K],
  ) => {
    onChange({ ...value, [key]: v });
  };

  const updateNum = (key: "temperature_C" | "pH", raw: string) => {
    if (raw === "") {
      const next = { ...value };
      delete next[key];
      onChange(next);
      return;
    }
    const n = Number(raw);
    onChange({ ...value, [key]: Number.isFinite(n) ? n : undefined });
  };

  const handleTagsBlur = () => {
    const tags = tagsDraft
      .split(/[,\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    onChange({ ...value, tags: tags.length ? tags : undefined });
  };

  const tsLabel = useMemo(() => {
    if (!measurementTimestamp) return "";
    return new Date(measurementTimestamp).toLocaleString();
  }, [measurementTimestamp]);

  const canCopyPrevious = !!onCopyFromPrevious && (hasPrevious ?? !!previousNotes);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-foreground">{HEADERS[mode]}</h3>
        <div className="flex gap-1">
          {canCopyPrevious && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCopyFromPrevious}
              className="h-7 text-[10px] font-mono"
            >
              Copy from previous
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onClear();
              setTagsDraft("");
            }}
            className="h-7 text-[10px] font-mono"
          >
            Clear
          </Button>
        </div>
      </div>

      {measurementId && (
        <div className="text-[10px] font-mono text-muted-foreground">
          ID: {measurementId}
          {tsLabel ? ` · ${tsLabel}` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">
            Title
          </Label>
          <Input
            value={value.title ?? ""}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Short title"
            className="h-8 font-mono text-xs"
            maxLength={200}
          />
        </div>
        <div>
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">
            Sample ID
          </Label>
          <Input
            value={value.sampleId ?? ""}
            onChange={(e) => update("sampleId", e.target.value)}
            placeholder="e.g. S-014"
            className="h-8 font-mono text-xs"
            maxLength={200}
          />
        </div>
        <div>
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">
            Electrode ID
          </Label>
          <Input
            value={value.electrodeId ?? ""}
            onChange={(e) => update("electrodeId", e.target.value)}
            placeholder="e.g. SPE-A3"
            className="h-8 font-mono text-xs"
            maxLength={200}
          />
        </div>
        <div className="col-span-2">
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">
            Operator
          </Label>
          <Input
            value={value.operator ?? ""}
            onChange={(e) => update("operator", e.target.value)}
            placeholder="Initials"
            className="h-8 font-mono text-xs"
            maxLength={200}
          />
        </div>
      </div>

      <div>
        <Label className="text-[10px] font-mono uppercase text-muted-foreground">
          Notes
        </Label>
        <Textarea
          value={value.notes ?? ""}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Free-form observations (electrolyte, preconditioning, batch...)"
          className="font-mono text-xs min-h-[80px]"
          maxLength={5000}
        />
        <div className="text-[9px] font-mono text-muted-foreground text-right mt-1">
          {(value.notes ?? "").length} / 5000
        </div>
      </div>

      <div>
        <Label className="text-[10px] font-mono uppercase text-muted-foreground">
          Tags
        </Label>
        <Input
          value={tagsDraft}
          onChange={(e) => setTagsDraft(e.target.value)}
          onBlur={handleTagsBlur}
          placeholder="Comma-separated, up to 10"
          className="h-8 font-mono text-xs"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowConditions((v) => !v)}
        className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
      >
        {showConditions ? "▾" : "▸"} Conditions (analyte, electrolyte, electrodes, T, pH)
      </button>

      {showConditions && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Analyte
            </Label>
            <Input
              value={value.analyte ?? ""}
              onChange={(e) => update("analyte", e.target.value)}
              className="h-8 font-mono text-xs"
              maxLength={200}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Electrolyte
            </Label>
            <Input
              value={value.electrolyte ?? ""}
              onChange={(e) => update("electrolyte", e.target.value)}
              className="h-8 font-mono text-xs"
              maxLength={200}
              placeholder="e.g. PBS pH 7.4"
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Reference
            </Label>
            <Input
              value={value.referenceElectrode ?? ""}
              onChange={(e) => update("referenceElectrode", e.target.value)}
              className="h-8 font-mono text-xs"
              maxLength={200}
              placeholder="Ag/AgCl"
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Counter
            </Label>
            <Input
              value={value.counterElectrode ?? ""}
              onChange={(e) => update("counterElectrode", e.target.value)}
              className="h-8 font-mono text-xs"
              maxLength={200}
              placeholder="Pt"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Working electrode
            </Label>
            <Input
              value={value.workingElectrode ?? ""}
              onChange={(e) => update("workingElectrode", e.target.value)}
              className="h-8 font-mono text-xs"
              maxLength={200}
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              Temperature (°C)
            </Label>
            <Input
              type="number"
              value={value.temperature_C ?? ""}
              onChange={(e) => updateNum("temperature_C", e.target.value)}
              className="h-8 font-mono text-xs"
              step="0.1"
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase text-muted-foreground">
              pH
            </Label>
            <Input
              type="number"
              value={value.pH ?? ""}
              onChange={(e) => updateNum("pH", e.target.value)}
              className="h-8 font-mono text-xs"
              step="0.1"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default MeasurementNotesPanel;
