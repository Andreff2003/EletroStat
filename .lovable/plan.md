# SWV Mode — Verificação de aplicação

Verifiquei o estado atual do modo SWV no repositório contra o checklist §25 do pedido. Tudo o que foi combinado está implementado e os 89 testes (10 SWV) passam.

## Estado por área

**Core**
- [Sim] Botão SWV Mode e toggle `mode: "eis" | "fet" | "cv" | "swv"` em `IndexPage.tsx`.
- [Sim] `SWVParametersPanel` (dentro de `SWVMode.tsx`) com Start / Stop / Reset / Export.
- [Sim] WebSocket parser em `useWebSocketData.ts` aceita `swv_data`, `swv_status`, `swv_done`, `swv_error`, com aliases (E/e/potential, IForward/ifwd, IReverse/irev, INet/inet/current) e cálculo de INet quando falta.
- [Sim] `bridge.py` com comando `start_swv` e loop simulado + skeleton hardware.

**Dados**
- [Sim] `src/types/swv.ts` com `SWVDataPoint` (E, IForward, IReverse, INet, time, index, direction, baseline, ICorrected), `SWVParameters`, `SWVMetrics`, `SWVCalibrationPoint`.
- [Sim] Raw e corrected preservados separadamente.
- [Sim] Unidades explícitas (V, mV, µA, Hz, nM, s).

**Análise (`src/utils/swvMetrics.ts`)**
- [Sim] `generateSWVProgram`, `computeINet`, `correctBaseline` (linear_edges / polynomial / auto), `detectSWVPeak` (polaridade, Ep, Ip raw/corr, half-peak width por interpolação, SNR, noise RMS, warnings), `validateSWVParameters`.
- [Sim] Signal Quality SWV — implementado dentro de `SWVMode.tsx` (self-contained) em vez de adicionar branch em `SignalQuality.tsx`. Funciona, mas é uma diferença arquitetural em relação a EIS/CV/FET.

**Calibração**
- [Sim] Calibração SWV com replicados, blanks, LOD/LOQ implementada dentro de `SWVMode.tsx` (não usa `CalibrationPanel` genérico). Metadata (sample/electrode/notes) presente.

**Sessão / export**
- [Sim] `StoredSWVMeasurement` adicionado à união em `sessionStore.ts`.
- [Sim] `exportSWVData` em `csvExport.ts` com secções METADATA / RAW / BASELINE-CORRECTED / PROCESSED / CALIBRATION e `sep=;`.
- [Sim] Session export inclui linhas SWV.
- [Sim] `MeasurementNotesPanel` + `measurementNotes.ts` suportam prefixo `"swv"`.

**Testes**
- [Sim] `src/test/swv.test.ts` (10 testes: programa, INet, baseline linear, pico anódico/catódico, validação, half-width, guards).
- [Sim] `bun run test` → **89/89 passam** (7/7 files).

**Segurança/não-regressão**
- [Sim] EIS, CV, BioFET, Lin-KK, CNLS, solver CV intactos (todos os testes prévios continuam verdes).
- [Sim] Exports existentes preservados.

## Pontos a assinalar (não são bugs, mas divergem do enunciado literal)

1. **`SignalQuality.tsx` não tem branch SWV.** O semáforo SWV vive dentro de `SWVMode.tsx`. Se preferires alinhar com a arquitetura EIS/CV/FET, posso mover para o componente partilhado.
2. **`CalibrationPanel.tsx` genérico não recebeu `mode="swv"`.** A calibração SWV é local ao `SWVMode.tsx`. Mesma opção de refactor se quiseres unificar.
3. **Firmware ESP32 real** não está incluído (só protocolo/skeleton no `bridge.py`), como previsto no enunciado (§7 permite skeleton se AD5941 SWV ainda não validado).

## Recomendação

Se aceitares o modelo "SWV self-contained" (Signal Quality + Calibration dentro do módulo), o modo está **fechado e verificado**. Se preferires unificar §12 e §13 nos componentes partilhados, posso fazê-lo como refactor cosmético sem tocar na matemática.

Qual queres seguir?
- (A) Deixar como está — SWV self-contained, marcar como concluído.
- (B) Refactor: mover semáforo para `SignalQuality.tsx` e calibração para `CalibrationPanel.tsx` com `mode="swv"`.
