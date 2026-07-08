/**
 * Backwards-compatible wrapper around the generic MeasurementNotesPanel.
 * Existing imports of `CVNotesPanel` keep working.
 */
import MeasurementNotesPanel, {
  type MeasurementNotesPanelProps,
} from "./MeasurementNotesPanel";
import { sanitizeMeasurementNotes } from "@/utils/measurementNotes";

const CVNotesPanel = (props: Omit<MeasurementNotesPanelProps, "mode">) => (
  <MeasurementNotesPanel {...props} mode="cv" />
);

export default CVNotesPanel;
export { sanitizeMeasurementNotes as sanitizeCVMeasurementNotes };
