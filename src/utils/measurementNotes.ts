/**
 * Generic measurement notes / logbook for EIS, BioFET and CV.
 *
 * Pure metadata held in the frontend. Never serialized to the ESP32, never
 * influences solver / fitting / metrics — these are additive traceability
 * fields that flow into stored sessions and CSV exports.
 *
 * Limits enforced by `sanitizeMeasurementNotes`:
 *  - notes: up to 5000 chars
 *  - tags: up to 10, each up to 40 chars
 *  - other string fields: up to 200 chars
 */

export interface MeasurementNotes {
  title?: string;
  operator?: string;
  sampleId?: string;
  electrodeId?: string;
  analyte?: string;
  electrolyte?: string;
  referenceElectrode?: string;
  counterElectrode?: string;
  workingElectrode?: string;
  temperature_C?: number;
  pH?: number;
  notes?: string;
  tags?: string[];
}

export interface MeasurementMetadata {
  measurementId: string;
  measurementTimestamp: number;
  notes?: MeasurementNotes;
}

const MAX_NOTES_CHARS = 5000;
const MAX_TAGS = 10;
const MAX_TAG_CHARS = 40;
const MAX_FIELD_CHARS = 200;

function trimStr(s: unknown, max = MAX_FIELD_CHARS): string | undefined {
  if (s == null) return undefined;
  const str = String(s);
  const t = str.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

function clampNum(n: unknown): number | undefined {
  if (n == null || n === "") return undefined;
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

export function sanitizeMeasurementNotes(
  raw: MeasurementNotes | undefined | null,
): MeasurementNotes | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: MeasurementNotes = {};
  const t = trimStr(raw.title); if (t) out.title = t;
  const op = trimStr(raw.operator); if (op) out.operator = op;
  const sid = trimStr(raw.sampleId); if (sid) out.sampleId = sid;
  const eid = trimStr(raw.electrodeId); if (eid) out.electrodeId = eid;
  const an = trimStr(raw.analyte); if (an) out.analyte = an;
  const el = trimStr(raw.electrolyte); if (el) out.electrolyte = el;
  const re = trimStr(raw.referenceElectrode); if (re) out.referenceElectrode = re;
  const ce = trimStr(raw.counterElectrode); if (ce) out.counterElectrode = ce;
  const we = trimStr(raw.workingElectrode); if (we) out.workingElectrode = we;
  const tc = clampNum(raw.temperature_C); if (tc != null) out.temperature_C = tc;
  const ph = clampNum(raw.pH); if (ph != null) out.pH = ph;
  const n = trimStr(raw.notes, MAX_NOTES_CHARS); if (n) out.notes = n;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags
      .map((tag) => trimStr(tag, MAX_TAG_CHARS))
      .filter((tag): tag is string => !!tag)
      .slice(0, MAX_TAGS);
    if (tags.length) out.tags = tags;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Generate a stable, human-readable measurement id. */
export function createMeasurementId(
  prefix: "eis" | "fet" | "cv" | "swv",
  now: Date = new Date(),
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = now.getFullYear();
  const stamp =
    `${yyyy}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}_${rand}`;
}

/** True iff a notes object has any user-supplied content. */
export function hasAnyNotes(n: MeasurementNotes | undefined | null): boolean {
  return !!sanitizeMeasurementNotes(n ?? undefined);
}

/** Short single-line summary of notes for compact UIs / CSV columns. */
export function shortNotesSummary(
  n: MeasurementNotes | undefined | null,
  max = 120,
): string {
  if (!n) return "";
  const parts: string[] = [];
  if (n.title) parts.push(n.title);
  if (n.sampleId) parts.push(`sample=${n.sampleId}`);
  if (n.electrodeId) parts.push(`electrode=${n.electrodeId}`);
  if (n.notes) parts.push(n.notes.replace(/[\r\n]+/g, " "));
  const joined = parts.join(" — ");
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

/** Sanitise free-form notes for safe CSV embedding (preserves words, drops line breaks). */
export function sanitizeNotesForCSV(s: string | undefined | null): string {
  if (s == null) return "N/A";
  const cleaned = String(s).replace(/[\r\n]+/g, " | ").trim();
  return cleaned.length === 0 ? "N/A" : cleaned;
}
