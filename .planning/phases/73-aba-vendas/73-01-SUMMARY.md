---
phase: 73-aba-vendas
plan: "01"
subsystem: anuncios-modal
status: complete
tags: [recharts, supabase-direct, rls, tdd, orders, modal]
dependency_graph:
  requires: [Phase 71 (ListingDetailModal), Phase 72 (ListingIssues/Health)]
  provides: [aba Vendas ativa no modal, histórico diário por item_id]
  affects: [src/components/mercadolivre/anuncios/ListingDetailModal.tsx]
tech_stack:
  added: []
  patterns:
    - query direta supabase.from("orders") com RLS org-scoped (client autenticado)
    - paginação .range() de 1000 + teto MAX_ROWS
    - hook lazy com guard item.id + flag cancelled
    - gráfico recharts: Bar (unidades) + Area (receita) com tokens CSS
    - TDD RED→GREEN para utilitário puro
key_files:
  created:
    - src/components/mercadolivre/anuncios/listingSalesAgg.ts
    - src/components/mercadolivre/anuncios/listingSalesAgg.test.ts
    - src/components/mercadolivre/anuncios/useMLListingSales.ts
    - src/components/mercadolivre/anuncios/useMLListingSales.test.ts
    - src/components/mercadolivre/anuncios/ListingSalesTab.tsx
  modified:
    - src/components/mercadolivre/anuncios/ListingDetailModal.tsx
decisions:
  - "chave de dia via data_pedido.slice(0,10) — campo TEXT (lição Phase 63)"
  - "âncora UTC no aggregateListingSales para evitar drift de fuso"
  - "status 'empty' ainda expõe pontos zerados — componente decide como exibir"
  - "MAX_ROWS=5000 como teto de segurança (1 anúncio/90d raramente excede)"
  - "ToggleGroup shadcn para toggle métrica e seletor de janela"
metrics:
  duration: "~5 minutos"
  completed: "2026-06-29T14:48:38Z"
  tasks_completed: 3
  files_created: 5
  files_modified: 1
---

# Phase 73 Plan 01: Aba Vendas do Modal — Summary

Gráfico de histórico de vendas por item_id (unidades/dia e receita/dia) na aba "Vendas" do modal de detalhe do anúncio, com dados lidos diretamente de `orders` via client Supabase (RLS org-scoped).

## Objetivos Alcançados

| Critério | Status |
|----------|--------|
| SC-1: aba Vendas ativa com gráfico recharts | PASS |
| SC-2: toggle unidades/receita + seletor 30/90d que refaz consulta | PASS |
| SC-3: dados de orders via query direta por item_id + status=paid, agregados por dia | PASS |
| SC-4: estados loading/vazio/erro sem quebrar modal nem outras abas | PASS |
| SC-5: RLS org-scoped; lazy (guard item.id); cleanup cancelled | PASS |
| SC-6: tsc 0 erros + build ok + 8 testes verdes | PASS |

## Tarefas Executadas

| Task | Arquivo-chave | Commits | Descrição |
|------|---------------|---------|-----------|
| 1 (TDD RED) | listingSalesAgg.test.ts | f65f30cc | 6 testes vitest (RED — módulo inexistente) |
| 1 (TDD GREEN) | listingSalesAgg.ts | b17c036a | Utilitário puro: bucketização UTC + zeros |
| 2 | useMLListingSales.ts + test | d5ebcded | Hook lazy + 2 testes de guard |
| 3 | ListingSalesTab.tsx + Modal | 82cc9065 | Componente + wiring no modal |

## Commits

- `f65f30cc` — test(73-01): add failing tests for listingSalesAgg pure utility
- `b17c036a` — feat(73-01): implement listingSalesAgg pure aggregation utility
- `d5ebcded` — feat(73-01): implement useMLListingSales lazy hook with guard and pagination
- `82cc9065` — feat(73-01): add ListingSalesTab and activate vendas tab in modal

## Decisões Tomadas

1. **`data_pedido.slice(0,10)` para chave do dia** — campo é TEXT no Supabase; nunca `new Date(...)` diretamente (lição Phase 63).
2. **Âncora UTC em `aggregateListingSales`** — `today.toISOString().slice(0,10)` → `Date.UTC()` para construção da janela; evita drift em fusos negativos.
3. **`status='empty'` expõe pontos zerados** — o componente decide renderizar mensagem "Sem vendas" mas os pontos ficam disponíveis para extensões futuras.
4. **`MAX_ROWS=5000`** — teto de segurança (T-73-03); 1 anúncio com 90 dias de vendas intensas dificilmente supera 5.000 linhas.
5. **`ToggleGroup` do shadcn** — já disponível no projeto; consistente com o design system.
6. **Intervalo adaptativo no eixo X** — `interval=8` para janela 90d, `interval=4` para 30d; evita sobreposição de labels DD/MM.

## Desvios do Plano

### Esclarecimento — grep count DisabledTabTrigger

O critério `grep -c "DisabledTabTrigger" ListingDetailModal.tsx` retorna **4** (não 3 como o plano previa), pois a contagem inclui a definição da função `DisabledTabTrigger` na linha 59 (que existia antes desta phase). No arquivo original havia 5 ocorrências (definição + 4 usos); agora são 4 (definição + 3 usos: precificação/avaliações/histórico). O requisito semântico está satisfeito — a aba "vendas" não usa mais `DisabledTabTrigger`.

### Testes do hook (recomendação plan-checker)

Adicionados 2 testes vitest para o guard lazy de `useMLListingSales` (item=null e item com id vazio → idle). A abordagem inicial usou `require()` com alias `@/`, incompatível com ESM/vitest; corrigido usando `vi.mock` com mock inline sem acesso ao mock no corpo do teste.

**Nenhum outro desvio** — plano executado conforme especificado.

## Known Stubs

Nenhum. Todos os dados vêm de `orders` real via Supabase (RLS); nenhum placeholder ou mock no componente de produção.

## Threat Flags

Nenhum novo endpoint, EF ou RPC introduzido. A query usa o client autenticado sobre RLS existente — superfície de ameaça já coberta pelo threat model do plano (T-73-01/02/03).

## Self-Check

- [x] `listingSalesAgg.ts` — FOUND
- [x] `listingSalesAgg.test.ts` — FOUND
- [x] `useMLListingSales.ts` — FOUND
- [x] `useMLListingSales.test.ts` — FOUND
- [x] `ListingSalesTab.tsx` — FOUND
- [x] `ListingDetailModal.tsx` modificado — FOUND
- [x] commit f65f30cc — FOUND
- [x] commit b17c036a — FOUND
- [x] commit d5ebcded — FOUND
- [x] commit 82cc9065 — FOUND
- [x] 8 testes verdes (6 util + 2 hook guard)
- [x] 309 testes totais passando (zero regressões)
- [x] tsc 0 erros
- [x] build ok

## Self-Check: PASSED
