# ElectroStat — plano de melhorias (UX, qualidade de código, PWA)

Baseado numa auditoria ao código atual. Foco escolhido: **UX/interface**, **qualidade de código**, **PWA/instalação**. Sem novas funcionalidades científicas neste plano.

## 1. PWA / instalação (novo)

Hoje não existe sequer a pasta `public/` — sem favicon, manifest ou ícones.

- Criar `public/manifest.webmanifest` com nome "ElectroStat", `display: "standalone"`, `theme_color`/`background_color` alinhados com o tema escuro lab-instrument.
- Gerar ícones da app (192px, 512px + maskable) e favicon, em `public/`.
- Adicionar tags no head (`__root.tsx`): `manifest`, `theme-color`, `apple-touch-icon`, favicon.
- Melhorar meta tags: description real (EIS/CV/SWV/BioFET para ESP32-S3/AD5941) em `index.tsx`, com og:title/og:description/og:type e twitter:card.
- **Sem service worker nem modo offline** (não pedido) — apenas instalável no ecrã inicial do telemóvel/desktop.

## 2. Qualidade de código

- **sessionStore — proteção contra perda de dados:** debounce no `saveSession` (hoje escreve todo o dataset no localStorage a cada mudança, sincronamente) + guarda de tamanho com `try/catch` de `QuotaExceededError` e toast de aviso ao utilizador em vez de apenas `console.warn`.
- **Acessibilidade mínima:** adicionar `aria-label`/texto alternativo nos semáforos do `SignalQuality` (hoje a cor é o único canal — problema para daltonismo/leitores de ecrã) e `aria-label` nos botões de ícone principais (exportar, overlay, ligar/desligar).
- **Partir o IndexPage (~3100 linhas) em fases seguras:** extrair primeiro os blocos mais isolados — painel de ligação/reconnect e o cabeçalho — para componentes próprios, sem mudar comportamento. Não é uma reescrita total; só extrações de baixo risco.
- **Consolidar o reconnect do WebSocket:** mover a lógica de retry/backoff (hoje espalhada em IndexPage) para dentro de `useWebSocketData`, mantendo a API pública do hook.
- **Helper partilhado "worst-of" para o SignalQuality:** as 3 regras de rollup (EIS/FET/SWV) passam por uma função única, eliminando divergências.
- **Logging em vez de `catch {}` silencioso** no `useWebSocketData` (JSON malformado → `console.warn`), útil para depuração no hardware real.

## 3. UX / interface

- **Estado "ligação perdida a meio do sweep":** quando o socket fecha durante uma medição, mostrar toast/banner "Connection lost mid-sweep — Reconnect" com ação direta.
- **Feedback de persistência:** indicador discreto "Session saved / not saved" quando o autosave corre ou falha.
- **Favicon + título de tab dinâmico** (ex.: "● Recording — ElectroStat" durante um sweep) — pequeno detalhe útil em ambiente de laboratório.
- Atalhos de teclado básicos: `Space` para start/stop do sweep ativo, `E` para exportar (com `title` nos botões a documentar).

## Verificação

- `bunx vitest run` e typecheck limpos; testes novos para o debounce/guarda do sessionStore e para o helper worst-of.
- Build OK e manifest válido (verificado via preview).

## Fora de âmbito (fica para depois, se quiseres)

- Modo offline completo (service worker), barras de erro nos gráficos, calibração sigmoidal 4PL, compensação de temperatura, LOD/LOQ global — possíveis próximos passos científicos.
