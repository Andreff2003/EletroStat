
# Auditoria SWV — plano de correção e refactor

Escopo: apenas o modo SWV. Sem alterações a EIS, CV ou BioFET. Sem funcionalidades novas — só correções científicas, consolidação de tipos, remoção de duplicações e reforço de testes.

## 1. Problemas encontrados (a corrigir)

### 1.1 Matemática SWV
- `generateSWVProgram` tem uma expressão morta (`direction === "cathodic" ? endE<startE ? -1 : -1 : ...`) seguida de `void sign`. Ruído; remover.
- `analyzeSWV` no ramo `data.length === 0` devolve um `SWVMetrics` com campos em falta (`baselineMethodUsed`, `baselineSlope_uA_V`, `baselineIntercept_uA`, `snr`, `noiseRms_uA`, `peakArea_uA_V`, `lodEstimate_nM`). Uniformizar shape.
- **Bug SNR = 0 (mesmo padrão já corrigido em CV):** em `detectSWVPeak`, se `noiseRms === 0` (dados sintéticos limpos) `snr` fica `null` e `peakDetected` fica sempre `false`. Aplicar fallback: usar `std(iCorrected fora do pico)` e, se ainda zero, usar `max(|iCorrected|) * 1e-4` como piso; marcar `noiseFallback: true` em warnings.
- `polyFit2` warning "Polynomial baseline may overfit" dispara sempre que `|c2|>0` (isto é, sempre). Elevar threshold para |c2| relativo ao span de E (ex.: `|c2|·span² > 0.2·|peak|`) ou remover o warning por omissão.
- Half-peak width: quando o pico está no bordo e a curva não cai a 50 %, devolve `null` silenciosamente. Adicionar warning `Half-peak width not resolvable — peak too close to sweep edge`.
- Confirmar em todo o pipeline (`useSimulatedSWVData`, `bridge.py`, `useWebSocketData`, `analyzeSWV`) que `INet = IForward − IReverse` — atualmente é consistente; adicionar teste explícito de invariante.

### 1.2 Baseline / correção
- Baseline aplicada apenas a `INet` — confirmado. Adicionar assert de teste que `IForward` e `IReverse` originais não são mutados.
- `correctBaseline("polynomial", …)` sem guardar mínimo de pontos: exigir `xEdge.length ≥ 6`, cair para linear se não houver.
- Auto baseline: expor no metrics o método resolvido (`baselineMethodUsed`) — já existe, mas garantir que também vai para CSV METADATA (hoje só `params.baselineMethod`); acrescentar linha `baseline_method_resolved`.

### 1.3 Peak detection
- Usar corrente corrigida quando existe — já é o caso. Adicionar teste garantindo que `peakCurrentCorrected_uA ≠ peakCurrentRaw_uA` quando baseline ≠ 0.
- Polaridade ambígua (`||max|−|min|| < 5% do maior`): emitir warning `Peak polarity ambiguous`.

### 1.4 Bridge (`bridge.py`)
- Comando `stop` não envia `swv_done` — mantém-se `swv_status:idle`. Confirmar que o frontend não fica preso em "running". (Actualmente `useWebSocketData` trata `idle`, ok — validar.)
- Sem eco para comandos desconhecidos: adicionar `swv_error` com `unknown command`.
- Validar payload de `start_swv` no bridge (mesmas validações do frontend) e emitir `swv_error` explícito em vez de deixar a simulação abortar silenciosamente.
- `_stream_swv_simulated`: em cancelamento por meio, enviar `swv_status:idle`. Já está no handler externo (`await send({"type":"swv_status","status":"idle"})`), confirmar caminho para SWV (o `cancel()` interno não emite). Adicionar `try/except CancelledError` interno.
- Garantir nunca propagar `NaN` (dados atuais já usam `round(...,6)`, mas revalidar após adicionar validação).

### 1.5 `useWebSocketData` (ingest live)
- Fallback `iFwd/iRev = 0` quando ausentes → mostra falsas linhas F/R a zero. Trocar por `NaN` (typed) e o `SWVPlot` já tolera via recharts (que ignora NaN).
- `time` fallback `idx * 0.04` é magic number: substituir por `NaN` (o CSV faz `fmtSig(NaN) → "N/A"`) ou calcular a partir de `1/frequency_Hz` se disponível — preferir `NaN` para não inventar dados.
- Validar `msg.E` e rejeitar NaN silenciosamente com `console.warn` (já feito).

### 1.6 Calibração (SWVMode)
- Regressão linear já usa `signal_uA` (corrigido quando existe, fallback raw). Confirmar comportamento em bloco.
- Replicados aceites (sem agregação) — confirmado.
- Blanks (C=0) aceites — confirmado; se ≥2 replicate blanks, σ_blank = SD(blanks); caso contrário, σ = RMSE dos resíduos. Correto.
- LOD = 3σ/|slope|, LOQ = 10σ/|slope| — correto. Adicionar warning quando `|slope| < 1e-9` (evita valores absurdos).
- Não aplicar Langmuir por omissão — apenas linear. Confirmar que não há chamada Langmuir escondida no modo (apenas no simulador, que está OK e devidamente documentado).

### 1.7 SignalQuality
- Faixa aceitável de half-peak width (30–250 mV / 15–350 mV) é conservadora e pode dar vermelhos falsos para picos adsorvidos estreitos (≈ 90.6/n mV teórico Nernstian). Aceitar 15–300 mV como amarelo alargado, verde 25–250 mV. Documentar no comentário.
- `peakDetected==true` já é boa base; quando `snr==null` mas `peakDetected==true`, mostrar amarelo em vez de vermelho.
- Depois da correção do SNR fallback, o semáforo deixa de reportar "Poor" em dados simulados limpos.

### 1.8 CSV / Export
- Individual (`exportSWVData`): já inclui METADATA, RAW, BASELINE/CORRECTED, PROCESSED, CALIBRATION. Adicionar em METADATA: `baseline_method_input`, `baseline_method_resolved`, `simulation_model_id` sempre que `source==="simulated"` (não só quando fornecido pelo caller).
- Session CSV (bloco `RAW SWV DATA`): incluir também colunas `snr`, `peak_potential_V`, `peak_current_corrected_uA` no summary (linha 492 do `csvExport.ts` — hoje só regista `id, ts, "swv", concentration`, muito pobre).
- `simulation_model` no tipo `SWVSimulationModel` não inclui `"empirical_swv_peak_langmuir"` (o valor real emitido). Alinhar: adicionar literal ou renomear para `"empirical_peak"` de forma consistente em `DEFAULT_PARAMS.model`, `SWV_SIMULATION_MODEL_ID` e no CSV.

### 1.9 Session / persistência
- `StoredSWVMeasurement` já persiste `params`, `data`, `correctedData`, `extracted`, `notes`, `source`. Confirmar recuperação após refresh via `loadSession` e mostrar contagem no header (não é feature nova — apenas verificar). Adicionar teste de round-trip JSON.
- `notes: MeasurementNotes | string` (legado). Ao carregar, converter `string` em `{ notes: string }` para SWV como já é feito para EIS/FET; adicionar util `normaliseNotes` reutilizado.

### 1.10 Overlay
- Sobreposição, legendas, remoção independente — todos funcionais em `SWVMode.tsx`. Nada a corrigir. Adicionar teste de unidade leve para o helper de rótulos.

### 1.11 Duplicações / código
- `SWVMode.tsx` re-exporta `computeINet` só para os testes — remover; testes já importam de `@/utils/swvMetrics`.
- `IMAX_UA/KD_NM/EPEAK_V` estão duplicados em `bridge.py` e `useSimulatedSWVData.ts`. Documentar explicitamente no comentário de ambos que são espelhos intencionais (não há partilha possível Python↔TS) e alinhar valores num único bloco de constantes com o mesmo header.
- `SWVMode.tsx` tem `\n\n` extra e o texto "empirical / educational approximation" no rodapé — manter, mas passar o `SWV_SIMULATION_MODEL_ID` para o mesmo literal usado em `params.model`.

## 2. Ficheiros afetados

- `src/utils/swvMetrics.ts` — SNR fallback, warnings ajustadas, uniformizar SWVMetrics vazio, guardas polinomial, warning de meia-altura, warning polaridade ambígua, cleanup de `generateSWVProgram`.
- `src/types/swv.ts` — alinhar `SWVSimulationModel` com o ID real; ajustar comentários.
- `src/hooks/useSimulatedSWVData.ts` — usar mesmo ID de modelo; comentário de "espelho do bridge".
- `src/hooks/useWebSocketData.ts` — F/R e time NaN em vez de 0/magic.
- `bridge.py` — validação start_swv, cancel emite idle, unknown command emite swv_error, comentário de constantes.
- `src/components/SignalQuality.tsx` — thresholds SWV mais realistas, degradação suave quando SNR=null.
- `src/components/helpstat/SWVMode.tsx` — remover re-export `computeINet`, warning slope≈0 na calibração, `normaliseNotes` para persistência.
- `src/utils/csvExport.ts` — metadata resolved baseline + simulation_model_id sempre em modo simulado; enriquecer o RAW SWV summary do session CSV.
- `src/utils/sessionStore.ts` — helper `normaliseNotes` partilhado.
- `src/test/swv.test.ts` — novos testes: invariância `INet=Ifwd−Irev`, imutabilidade de F/R após baseline, SNR fallback com dados ruído-zero, peak edge sem meia-altura, polaridade ambígua, calibração com replicados e blanks (LOD/LOQ), round-trip de session, ingest WS com campos alternativos e NaN.

## 3. Verificação

- `bun run typecheck` e `bunx vitest run src/test/swv.test.ts` limpos.
- `bun run build` continua a compilar.
- Nada tocado em `useSimulatedCVData`, `computeCVMetrics`, `useSimulatedData` (EIS), `fetMetrics`, `cvCalibration`.

## 4. Relatório final (a produzir na resposta pós-implementação)

- Lista dos problemas encontrados (esta secção).
- Diffs por ficheiro com racional científico.
- Pontos ainda pendentes (ex.: solver quasi-reversível SWV rigoroso, se aplicável) — nada implementado nesta task.
- Confirmação explícita de que o modo SWV fica consistente em rigor com EIS (CNLS Randles/CPE, lin-KK), CV (solver Nernstiano por difusão) e BioFET (Vt sqrt-extrapolation, subthreshold, etc.).
