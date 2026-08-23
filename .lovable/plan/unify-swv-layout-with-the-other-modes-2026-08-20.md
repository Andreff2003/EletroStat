# Unify SWV Layout with the Other Modes

Make the SWV mode look and behave like the other three modes (EIS, CV, BioFET) without touching any of the SWV math or data processing. The goal is visual and architectural consistency: same panel layout, same shared Signal Quality component, same shared Calibration panel, and the same toolbar/overlay patterns.

## Constraints

- **No math changes.** `src/utils/swvMetrics.ts`, `src/types/swv.ts`, `src/hooks/useSimulatedSWVData.ts`, `src/hooks/useWebSocketData.ts` (SWV parser), and `bridge.py` SWV logic stay exactly as they are.
- **No data-model changes.** `sessionStore.ts`, `csvExport.ts`, `csvImport.ts` keep their current SWV measurement shapes.
- **No test assertions about SWV numerical results change.** Existing tests must still pass; only test setup around shared components may need minor adjustments if component APIs change.
- The app target is a reliable internal-lab/demo tool, so the refactor should reduce long-term maintenance risk rather than add surface area.

## What will change

### 1. SWV layout → match EIS/CV/BioFET grid

Refactor `src/components/helpstat/SWVMode.tsx` so the main area uses the same two-column layout as the other modes:

- Left column: plot area + overlay/capture toolbar + sweep progress.
- Right column: shared Signal Quality + shared Calibration + shared Notes panel.

This means removing the SWV-specific inline Signal Quality and Calibration sections and reusing the common chrome.

### 2. Signal Quality → shared component

Add a SWV branch to `src/components/SignalQuality.tsx` that consumes the metrics already computed by `SWVMode.tsx` (or `IndexPage.tsx`).

- Keep the existing SWV quality logic intact — just move where the semaphore is rendered.
- Remove the self-contained SWV signal-quality block from `SWVMode.tsx`.
- Ensure the shared component still works for EIS, CV, and BioFET without regression.

### 3. Calibration → shared CalibrationPanel with `mode="swv"`

Extend `src/components/CalibrationPanel.tsx` to support `mode="swv"`:

- Accept SWV-specific fields and units (V/mV for potential, µA for current).
- Reuse the existing SWV calibration data already stored in the mode state.
- Remove the local SWV calibration panel from `SWVMode.tsx`.

### 4. Toolbar and overlay parity

Ensure SWV gets the same button group pattern as EIS/CV/BioFET:

- Start / Stop / Reset / Export CSV in the same order and position.
- Raw/Corrected toggle label consistent with CV.
- Overlay Mode + Capture + Clear All + point count badge, matching the other modes.
- Import CSV button placement consistent with the other modes.

### 5. Bug fixes allowed in this pass

While the refactor is active, fix any small, non-math issues that are directly exposed by the layout unification (for example, missing `aria-label` on icon-only buttons, inconsistent spacing, or a duplicate `<main>`). Anything that requires a scientific formula change is out of scope and will be reported separately.

## Verification

- `bun run test` continues to pass the full suite (currently 112 tests).
- Manual preview check: all four modes (EIS, CV, BioFET, SWV) render with the same two-column layout, the same toolbar, and the same sidebar structure.
- No new console errors when switching modes.

## Out of scope

- Changes to SWV simulation, peak detection, baseline correction, LOD/LOQ, or any other numeric algorithm.
- New measurement modes or features.
- Cloud/database/backend work.
- Large redesign beyond the consistency refactor.
