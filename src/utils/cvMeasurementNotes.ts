/**
 * Backwards-compatible re-exports — the generic implementation lives in
 * `measurementNotes.ts`. Older imports of `CVMeasurementNotes` / `newCVMeasurementId`
 * / `sanitizeCVMeasurementNotes` continue to work via aliases.
 */
import {
  type MeasurementNotes,
  sanitizeMeasurementNotes,
  createMeasurementId,
  hasAnyNotes,
  shortNotesSummary,
} from "./measurementNotes";

export type CVMeasurementNotes = MeasurementNotes;

export const sanitizeCVMeasurementNotes = sanitizeMeasurementNotes;
export const newCVMeasurementId = (now: Date = new Date()) =>
  createMeasurementId("cv", now);

export { hasAnyNotes, shortNotesSummary };
