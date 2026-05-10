## HelpStat Advanced Analysis Features — Implementation Plan

I'll implement these 7 features sequentially, one per round, so we can verify each before moving on. Below is the technical roadmap.

### 1. Randles Equivalent Circuit Fitting
- New file `src/utils/randlesFit.ts`:
  - Pure-JS Nelder-Mead simplex minimizer (no deps).
  - Model: `Z(ω) = Rs + 1 / (jωCdl + 1/(Rct + Aw/√ω))`.
  - Initial guesses from data (Rs=min zReal, Rct=range, Cdl from peak frequency, Aw=10).
  - Returns `{ Rs, Rct, Cdl, Aw, fitErrorPct, fittedCurve[] }`.
- Run fit in `Index.tsx` when sweep completes (in the existing auto-stop effect).
- Update `NyquistPlot.tsx` to overlay a dashed fitted curve (second `<Scatter>` with `line` + `strokeDasharray`).
- New `src/components/CircuitFitResults.tsx` panel showing Rs / Rct (highlighted) / Cdl / Aw / fit error.

### 2. Warburg Slope
- In same `randlesFit.ts`, add `extractWarburgSlope(eisData)`:
  - Filter points by `freq < 10 Hz` OR local slope ∈ [0.8, 1.2].
  - Linear regression of zImag vs zReal.
  - Returns `{ slope, Aw, ok }` or `{ ok: false }` if <3 points.
- Show "Warburg slope" + "Insufficient low-frequency data" fallback in same results panel.

### 3. Overlay Mode
- New state in `Index.tsx`: `overlayMode: boolean`, `eisOverlays: { id, label, color, data }[]` (max 8, FIFO).
- Toggle button + "Clear All" button above NyquistPlot.
- On sweep complete: if overlay on, push current run with palette color and label = `${concentration} nM` or `Measurement N`.
- `NyquistPlot` accepts optional `overlays` prop; render one `<Scatter>` per overlay.

### 4. Real-Time Calibration
- Extend existing `CalibrationPanel.tsx` (already has Langmuir + LOD) to add:
  - Manual "Add to Calibration" flow with concentration prompt after each sweep.
  - Linear regression (Rct vs C) → sensitivity + R².
  - Improved Langmuir using Nelder-Mead (reuses minimizer).
  - LOD = 3σ_baseline / slope.
  - "Export Calibration CSV" button.

### 5. BioFET Sample Addition Markers
- New state `fetMarkers: { time, label }[]`.
- "Add Sample" button on FET time view; on click, push current `t` from latest `fetTime` point.
- `FETTimePlot.tsx` renders `<ReferenceLine>` (dashed) per marker with label.
- Reset on Reset; included in CSV export.

### 6. Session Persistence (localStorage)
- New `src/utils/sessionStore.ts` wrapping `localStorage` (key: `helpstat-session-v1`).
- Note: `window.storage` is not a standard browser API; I'll use `localStorage` (works without backend, survives refresh). If you specifically need cloud sync, we can swap to Lovable Cloud later.
- Stores `Measurement[]` with raw points, extracted values, concentration, timestamp, params, mode.
- Save when sweep completes; load on app mount and rebuild calibration + (optionally) restore last plot.
- "Clear Session" button with `AlertDialog` confirmation.

### 7. CSV Export with Processed Data
- New `exportSessionCSV(measurements)` in `src/utils/csvExport.ts`:
  - Section 1: per-point raw rows.
  - Section 2: blank line + header + per-measurement processed rows.
- "Export Session CSV" button in header.

### Order of delivery
I will deliver feature 1 + 2 together (both touch the fit math and the same results panel — natural pairing), then 3, 4, 5, 6, 7 in separate rounds. After each round you can verify in the preview before I continue.

### Notes / assumptions
- `window.storage` → using `localStorage` (browser-native, no backend needed). Confirm if you want Lovable Cloud instead.
- Concentration unit: existing UI uses **nM**. New copy will say "nM" everywhere (calibration, CSV column `concentration_nM`) instead of µM, to stay consistent with current input. Tell me if you want to switch the whole app to µM.
- All math is pure frontend; no bridge.py / ESP32 changes.