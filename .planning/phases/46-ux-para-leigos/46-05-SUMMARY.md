---
phase: 46-ux-para-leigos
plan: "05"
subsystem: frontend-ui
tags: [glossary, kpi, tooltip, ux, precificacao, kpi-tokens, visual-consistency]
dependency_graph:
  requires:
    - src/lib/kpi-glossary.ts (plan 01)
    - src/components/dashboard/KPICard.tsx (plan 01)
  provides:
    - UX-01 total coverage: all reachable KPICard sites have glossary tooltip or are explicitly documented as no-tooltip by design
    - UX-04 /precificacao audit complete: semantic colors migrated to kpi tokens
  affects:
    - src/pages/mercadolivre/MLPublicidade.tsx
    - src/pages/mercadolivre/MLRelatorios.tsx
    - src/pages/TVModeVendas.tsx
    - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
    - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
    - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
tech_stack:
  added: []
  patterns:
    - tip(key) helper from KPI_GLOSSARY for tooltip wiring (same pattern as MLKPIGrid plan 02)
    - text-kpi-positive / text-kpi-negative substitution for semantic emerald-600/red-600
key_files:
  created: []
  modified:
    - src/pages/mercadolivre/MLPublicidade.tsx
    - src/pages/mercadolivre/MLRelatorios.tsx
    - src/pages/TVModeVendas.tsx
    - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
    - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
    - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
decisions:
  - "MLPublicidade: 4 KPICards wired (publicidade/roas/acos/tacos); Impressões and Cliques no tooltip by design (no glossary term)"
  - "MLRelatorios TabHorario: Pico de receita no tooltip (no key); Total pedidos→pedidos, Receita total→receita_total wired"
  - "MLRelatorios TabTicket: Ticket médio→ticket_medio; Melhor dia/Pior dia/Tendência no tooltip by design"
  - "MLRelatorios TabFunil: Tx. geral→conversao, Ticket médio→ticket_medio; Visita→Comprador/Comprador→Pedido no tooltip by design"
  - "TVModeVendas: all 5 KPICards wired (receita_total/pedidos/ticket_medio/visitas/conversao)"
  - "AnalisePrecosTable L31 STRATEGY_CELL_CLASSES: gmv/neutral/margin are category highlights, NOT semantic pos/neg — preserved"
  - "text-amber-600 (warning tier) and text-destructive (already a token) preserved in SimuladorPrecificacao"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-18"
  tasks_completed: 2
  files_changed: 6
---

# Phase 46 Plan 05: Cobertura KPI e Precificacao Summary

**One-liner:** UX-01 cobertura total — KPICards reachable de 8 páginas auditados com glossário (11 tooltips wired, exceções documentadas); UX-04 /precificacao (6ª página D-08) com 4 cores semânticas migradas para tokens kpi.

## What Was Built

### Task 1 — Varredura UX-01: tooltip do glossário em TODO site reachable de KPICard

Aplicado o padrão `tip(key)` (mesmo padrão de MLKPIGrid) nos sites de KPICard reachable fora do radar dos planos 02/03.

**MLPublicidade.tsx** — 4 KPICards com tooltip:
- "Gasto Total" → `tip("publicidade")`
- "ROAS Global" → `tip("roas")`
- "ACoS Global" → `tip("acos")`
- "TACoS Global" → `tip("tacos")`
- "Impressões", "Cliques" → sem tooltip por design (sem chave no glossário — são contagens de mídia, não KPIs de negócio)

**MLRelatorios.tsx** — 5 KPICards com tooltip (em 2 tabs):
- TabHorario: "Total pedidos" → `tip("pedidos")`, "Receita total" → `tip("receita_total")`; "Pico de receita" sem tooltip (hora específica, não KPI de glossário)
- TabTicket: "Ticket médio" → `tip("ticket_medio")`; "Melhor dia", "Pior dia", "Tendência" sem tooltip por design (são analytics de data/tendência, sem chave no glossário)
- TabFunil: "Tx. geral" → `tip("conversao")`, "Ticket médio" → `tip("ticket_medio")`; "Visita → Comprador", "Comprador → Pedido" sem tooltip por design (são micro-taxas do funil, sem chave específica no glossário)

**TVModeVendas.tsx** — 5 KPICards com tooltip (cobertura total):
- "Receita Total" → `tip("receita_total")`, "Pedidos" → `tip("pedidos")`, "Ticket Médio" → `tip("ticket_medio")`, "Visitas" → `tip("visitas")`, "Conversão" → `tip("conversao")`

**Commit:** 6b6abe29

### Task 2 — Auditoria UX-04 /precificacao (6ª página D-08)

Migradas as cores semânticas positivo/negativo de 3 componentes filhos de /precificacao para tokens kpi:

**SimuladorPrecificacao.tsx:**
- L289 `tierColor`: `"text-emerald-600"` → `"text-kpi-positive"` (margem boa — semântico positivo)
- L709 `breakEven`: `"text-emerald-600"` → `"text-kpi-positive"` (receita ≥ breakeven)
- `"text-amber-600"` (tier=warn) PRESERVADO — é aviso, não positivo/negativo
- `"text-destructive"` PRESERVADO — já é token

**HistoricoComparacaoPanel.tsx:**
- L23 `priceDiff` return: `"text-emerald-600"` → `"text-kpi-positive"`, `"text-red-600"` → `"text-kpi-negative"` (delta de preço — semântico positivo/negativo)

**CompraRecomendadaPanel.tsx:**
- L185: `"text-emerald-600"` → `"text-kpi-positive"` (compra recomendada > 0 — semântico positivo)

**AnalisePrecosTable.tsx:**
- `STRATEGY_CELL_CLASSES` (L31): `bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-700` para estratégia `gmv` PRESERVADO — é highlight de CATEGORIA (coluna de estratégia de precificação), não semântica positivo/negativo. Idem para neutral (blue) e margin (amber). Esta decisão é explícita per plano.

**Commit:** d86fa72e

## Verification Results

- `npx tsc --noEmit` — PASS (exit 0, nenhum erro nos 7 arquivos modificados)
- `npm run build` — PASS (clean build; chunk size warning pré-existente não relacionado)
- `grep -q "KPI_GLOSSARY" MLPublicidade.tsx` — OK
- `grep -q "KPI_GLOSSARY" MLRelatorios.tsx` — OK
- `grep -q "KPI_GLOSSARY" TVModeVendas.tsx` — OK
- `grep -q "text-kpi-positive" SimuladorPrecificacao.tsx` — OK
- `grep -q "text-kpi-negative" HistoricoComparacaoPanel.tsx` — OK

## KPIs sem termo de glossário (sem tooltip por design)

Estes KPICards foram auditados e NÃO receberam tooltip porque não existe chave correspondente no `GlossaryKey` definido no plano 01. A ausência é intencional, não um esquecimento:

| Arquivo | KPI | Razão |
|---------|-----|-------|
| MLPublicidade | Impressões | Contagem de exibições de anúncio — métrica de mídia, sem chave no glossário |
| MLPublicidade | Cliques | Contagem de cliques em anúncio — métrica de mídia, sem chave no glossário |
| MLRelatorios/TabHorario | Pico de receita | Valor de hora específica do dia — analítica temporal, sem chave |
| MLRelatorios/TabTicket | Melhor dia | Melhor dia do período — analítica comparativa, sem chave |
| MLRelatorios/TabTicket | Pior dia | Pior dia do período — analítica comparativa, sem chave |
| MLRelatorios/TabTicket | Tendência | Slope de regressão linear — analítica de tendência, sem chave |
| MLRelatorios/TabFunil | Visita → Comprador | Micro-taxa do funil — sem chave específica (conversao cobre a taxa geral) |
| MLRelatorios/TabFunil | Comprador → Pedido | Micro-taxa do funil — sem chave específica |
| MLReputacao | Avaliações positivas | Métrica de reputação ML — sem chave no glossário |
| MLReputacao | Avaliações negativas | Métrica de reputação ML — sem chave no glossário |
| MLReputacao | Taxa de reclamações | Métrica de reputação ML — sem chave no glossário |
| MLReputacao | Transações | Contagem de transações completadas — sem chave |
| MLDevolucoes | Reclamações abertas | Métrica de atendimento — sem chave no glossário |
| MLDevolucoes | Taxa de resolução | Métrica de atendimento — sem chave no glossário |
| MLDevolucoes | Resolvidas | Contagem de casos encerrados — sem chave |
| MLDevolucoes | Total na base | Contagem total — sem chave |
| MLPerguntas | Perguntas pendentes | Métrica de atendimento — sem chave no glossário |
| MLPerguntas | Taxa de resposta | Métrica de atendimento — sem chave no glossário |
| MLPerguntas | Respondidas | Contagem — sem chave |
| MLPerguntas | Total de perguntas | Contagem — sem chave |
| MLMetas | (nenhum KPICard) | MLMetas usa KpiInput (form fields), não KPICard para exibição de KPI |
| Integrations | Marketplaces conectados | Contagem de integrações — sem chave no glossário |
| Integrations | Lojas conectadas | Contagem de lojas — sem chave |
| Integrations | Disponíveis | Contagem de integrações disponíveis — sem chave |
| Integrations | Autenticação | Status de protocolo OAuth — sem chave |

## Deviations from Plan

None — plan executed exactly as written. Todos os arquivos da lista de `files_modified` foram auditados; os 3 que não apareceram no grep inicial (MLReputacao, MLDevolucoes, MLPerguntas) foram inspecionados e confirmados como "sem tooltip por design" conforme a REGRA do plano.

## Known Stubs

None. As alterações são puramente presentacionais (strings de tooltip + classes CSS). Nenhum dado de negócio deferido.

## Threat Flags

None. Apenas wiring de strings estáticas do glossário (já validadas no plano 01 como T-46-09 mitigado) e substituição de classes CSS. Sem nova superfície de rede, auth ou input.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/pages/mercadolivre/MLPublicidade.tsx | FOUND |
| src/pages/mercadolivre/MLRelatorios.tsx | FOUND |
| src/pages/TVModeVendas.tsx | FOUND |
| src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx | FOUND |
| src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx | FOUND |
| src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx | FOUND |
| commit 6b6abe29 (UX-01 varredura) | FOUND |
| commit d86fa72e (UX-04 precificacao) | FOUND |
| tsc --noEmit clean | PASS |
| npm run build clean | PASS |
