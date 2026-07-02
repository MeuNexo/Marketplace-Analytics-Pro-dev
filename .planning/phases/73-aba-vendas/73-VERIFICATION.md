---
phase: 73-aba-vendas
verified: 2026-06-29T14:52:00Z
status: passed
score: 6/6 must-haves verificados
behavior_unverified: 0
overrides_applied: 0
---

# Phase 73: Aba Vendas — Relatório de Verificação

**Goal:** A aba "Vendas" do modal (hoje desabilitada "em breve") passa a mostrar um gráfico do histórico de vendas do anúncio aberto, a partir da tabela `orders` já existente — com toggle unidades vendidas/receita (R$) e seletor de janela 30/90 dias. Busca via query direta no client (RLS org-scoped, sem EF/RPC nova).
**Verificado:** 2026-06-29T14:52:00Z
**Status:** PASSED
**Branch:** `gsd/phase-73-aba-vendas`
**Re-verificação:** Não — verificação inicial

---

## Critérios de Sucesso

### Verdades Observáveis

| # | Verdade | Status | Evidência |
|---|---------|--------|-----------|
| SC-1 | Aba "Vendas" deixou de ser `DisabledTabTrigger` e renderiza gráfico recharts | VERIFIED | `ListingDetailModal.tsx` L153: `<TabsTrigger value="vendas">Vendas</TabsTrigger>` (ativo); L163-165: `<TabsContent value="vendas"><ListingSalesTab item={item} /></TabsContent>`. `ListingSalesTab.tsx` importa `ResponsiveContainer`, `ComposedChart`, `Bar`, `Area` do recharts. |
| SC-2 | Toggle unidades/receita + seletor 30/90d que refaz consulta | VERIFIED | `ListingSalesTab.tsx` L61-91: dois `ToggleGroup` shadcn (métrica + janela). `useMLListingSales.ts` L130: `}, [item?.id, windowDays]);` — `windowDays` nas deps do `useEffect` garante refetch ao trocar janela. |
| SC-3 | Dados de `orders` via query direta por `item_id` + `status='paid'`, agregados por dia; cast `data_pedido` TEXT; sem EF/RPC nova | VERIFIED | `useMLListingSales.ts` L86-92: `.from("orders").select(...).eq("item_id", itemId).eq("status", "paid").gte("data_pedido", startIso)`. `listingSalesAgg.ts` L67: `const key = row.data_pedido.slice(0, 10)`. Nenhuma EF nova criada na Phase 73 (git log confirma). |
| SC-4 | Estados loading/skeleton, vazio/"sem vendas", erro — sem quebrar modal nem outras abas | VERIFIED | `ListingSalesTab.tsx` L95-124: quatro branches explícitos (`loading` → Skeleton, `empty` → div com texto, `error` → AlertCircle, `success` → SalesChart). `ListingIndicatorsTab` intacta (L159-161). Nenhum `throw` propagado. |
| SC-5 | Multi-tenant: client autenticado (RLS), sem service role nem filtro `organization_id` manual; lazy (guard `!item?.id`) | VERIFIED | `useMLListingSales.ts` L17: `import { supabase } from "@/integrations/supabase/client"` (client autenticado). L6: comentário "Nunca service role, nunca filtro manual de organization_id". `grep` confirma ausência de `serviceRole`/`organization_id` no arquivo. Guard L65: `if (!item?.id) { setStatus("idle"); ... return; }`. Cleanup L128-130: `return () => { cancelled = true; }`. Testes de guard passando (2/2). |
| SC-6 | `tsc` 0 erros + `build` ok + testes do utilitário de agregação passando | VERIFIED | `npx tsc --noEmit` → saída vazia (0 erros). `npm run build` → `built in 16.46s` (sucesso). `npx vitest run listingSalesAgg.test.ts useMLListingSales.test.ts` → 8/8 testes passando. Suite completa: 309/309 testes, 21 arquivos, zero regressões. |

**Score:** 6/6 verdades verificadas

---

## Artefatos Verificados

| Artefato | Status | Detalhes |
|----------|--------|----------|
| `src/components/mercadolivre/anuncios/listingSalesAgg.ts` | VERIFIED | 104 linhas; exports `aggregateListingSales` + `SalesRow` + `ListingSalesPoint`; lógica UTC completa; sem stub |
| `src/components/mercadolivre/anuncios/listingSalesAgg.test.ts` | VERIFIED | 6 testes TDD (RED→GREEN): comprimento/contiguidade, soma por dia, zeros, data fora da janela, array vazio, label DD/MM |
| `src/components/mercadolivre/anuncios/useMLListingSales.ts` | VERIFIED | 134 linhas; hook lazy com guard, paginação `.range()`, `MAX_ROWS=5000`, cleanup `cancelled`; wired em `ListingSalesTab` |
| `src/components/mercadolivre/anuncios/useMLListingSales.test.ts` | VERIFIED | 2 testes de guard (item=null → idle; id vazio → idle); mock supabase via `vi.mock` |
| `src/components/mercadolivre/anuncios/ListingSalesTab.tsx` | VERIFIED | 226 linhas; dois ToggleGroups + 4 estados + SalesChart (Bar/Area recharts); wired no modal |
| `src/components/mercadolivre/anuncios/ListingDetailModal.tsx` | VERIFIED (modificado) | `vendas` aba ativa (L153); `ListingSalesTab` importado e usado (L20, L164); `DisabledTabTrigger` = 4 ocorrências (1 definição + 3 usos: precificacao/avaliacoes/historico — correto) |

---

## Links Críticos (Wiring)

| De | Para | Via | Status |
|----|------|-----|--------|
| `ListingDetailModal.tsx` | `ListingSalesTab.tsx` | import + `<ListingSalesTab item={item} />` L164 | WIRED |
| `ListingSalesTab.tsx` | `useMLListingSales.ts` | import + `useMLListingSales(item, window)` L54 | WIRED |
| `useMLListingSales.ts` | `listingSalesAgg.ts` | import + `aggregateListingSales(allRows, windowDays)` L112 | WIRED |
| `useMLListingSales.ts` | `supabase.from("orders")` | `supabase.from("orders").eq("item_id", ...).eq("status","paid")` L85-92 | WIRED |
| `ListingSalesTab.tsx` | `listingHelpers.currencyFmt` | import + `currencyFmt(value)` no tooltip de receita | WIRED |

---

## Data-Flow Trace (Level 4)

| Artefato | Variável de dado | Fonte | Dados reais | Status |
|----------|-----------------|-------|-------------|--------|
| `ListingSalesTab.tsx` | `points` (via `status`) | `useMLListingSales(item, window)` → `supabase.from("orders")` | Query real por `item_id`+`status=paid` na tabela `orders` (sem mock no prod) | FLOWING |

---

## Spot-Checks Comportamentais

| Comportamento | Comando | Resultado | Status |
|---------------|---------|-----------|--------|
| 6 testes utilitário agregação | `npx vitest run listingSalesAgg.test.ts` | 6/6 pass (8ms) | PASS |
| 2 testes guard hook | `npx vitest run useMLListingSales.test.ts` | 2/2 pass (15ms) | PASS |
| Suite completa sem regressão | `npx vitest run` | 309/309 pass, 21 arquivos | PASS |
| TypeScript 0 erros | `npx tsc --noEmit` | saída vazia = 0 erros | PASS |
| Build de produção | `npm run build` | built in 16.46s, sem erros | PASS |

---

## Verificacao de Commits

| Commit | Mensagem | Status |
|--------|----------|--------|
| `f65f30cc` | test(73-01): add failing tests for listingSalesAgg pure utility | FOUND |
| `b17c036a` | feat(73-01): implement listingSalesAgg pure aggregation utility | FOUND |
| `d5ebcded` | feat(73-01): implement useMLListingSales lazy hook with guard and pagination | FOUND |
| `82cc9065` | feat(73-01): add ListingSalesTab and activate vendas tab in modal | FOUND |

---

## Verificacao de Nao-Regressao (Phases 71/72)

- `ListingIndicatorsTab` (Phase 71): importada em `ListingDetailModal.tsx` L19, wired em `TabsContent value="indicadores"` L159-161 — intacta.
- `listingIndicators.test.ts` (Phase 72): 17/17 testes passando na suite completa.
- Abas `precificacao`, `avaliacoes`, `historico`: continuam como `DisabledTabTrigger` (3 usos confirmados) — sem regressao.

---

## Anti-Patterns

Nenhum encontrado. Ausencia de TBD/FIXME/XXX/HACK/PLACEHOLDER nos 4 arquivos criados/modificados.
A EF `ml-listing-health` preexistente e da Phase 72 (confirmado por `git log`).

---

## Nota sobre Smoke Visual (E2E)

Conforme alinhado no objetivo da verificacao, o smoke visual com dados reais (Wesley logado no preview) e o E2E humano fora do escopo desta verificacao automatizada. Toda a logica de acesso a dados e RLS esta corretamente implementada; a validacao visual fica para o Wesley no preview do PR.

---

_Verificado: 2026-06-29T14:52:00Z_
_Verificador: Claude (gsd-verifier) — Phase 73 Aba Vendas_
