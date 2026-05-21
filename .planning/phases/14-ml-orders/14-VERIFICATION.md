---
phase: 14-ml-orders
verified: 2026-05-21T00:00:00Z
status: gaps_found
score: 3/5 success criteria verified
gaps:
  - truth: "Tabela orders existe e RLS restringe por organization_id"
    status: failed
    reason: "A tabela public.orders existe (confirmado via types.ts e migrations de ALTER TABLE), mas nenhuma migration contém ENABLE ROW LEVEL SECURITY nem CREATE POLICY para ela. Sem RLS, qualquer usuário autenticado pode ler orders de qualquer organização."
    artifacts:
      - path: "supabase/migrations/ (todos os arquivos)"
        issue: "Nenhum migration contém ENABLE ROW LEVEL SECURITY para public.orders nem CREATE POLICY sobre ela"
    missing:
      - "Migration com ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY"
      - "Policy SELECT: organization_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())"
      - "Policy INSERT/UPDATE: service role via SECURITY DEFINER (edge functions usam service role key)"

  - truth: "Unique constraint existe para o upsert funcionar"
    status: failed
    reason: "O upsert em mercado-libre-integration/index.ts usa onConflict: 'ml_order_id,ml_user_id,item_id,variation_id' mas nenhuma migration cria esse UNIQUE CONSTRAINT em public.orders. A tabela é drift pré-migration. Se o constraint não existir no banco de produção, o upsert fará INSERT duplicado ou erro."
    artifacts:
      - path: "supabase/migrations/ (todos os arquivos)"
        issue: "Nenhuma migration cria UNIQUE (ml_order_id, ml_user_id, item_id, variation_id) em public.orders"
    missing:
      - "Migration com: ALTER TABLE public.orders ADD CONSTRAINT orders_upsert_key UNIQUE (ml_order_id, ml_user_id, item_id, variation_id)"
      - "Ou CREATE UNIQUE INDEX se preferir index ao invés de constraint"
human_verification:
  - test: "Verificar RLS no banco de produção via Supabase Dashboard > Database > Tables > orders > RLS"
    expected: "RLS deve estar habilitado com policy de select por organization_id"
    why_human: "A tabela existe como drift pré-migration; seu estado de RLS só pode ser confirmado no banco ao vivo, não nos arquivos de migration"
  - test: "Verificar unique constraint no banco de produção via Supabase Dashboard > Database > Tables > orders > Constraints"
    expected: "Deve existir unique constraint em (ml_order_id, ml_user_id, item_id, variation_id)"
    why_human: "Constraint pode ter sido criado diretamente no banco como drift, não capturado em migration"
---

# Phase 14: ml-orders Verification Report

**Phase Goal:** Dashboard de Vendas exibe comissão real, frete real e ticket médio correto — calculados de orders individuais, não de percentuais hardcoded.
**Verified:** 2026-05-21
**Status:** FAIL — 3/5 success criteria verified; 2 gaps bloqueando goal de segurança e confiabilidade do upsert
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Tabela `orders` existe com `comissao` e `frete` | VERIFIED | `types.ts` linhas 995-1024: tabela `orders` com `comissao: number | null` e `frete: number | null`; migrations de `ALTER TABLE public.orders` (20260515133645, 20260520190000) confirmam existência pré-migration |
| 2 | RLS restringe `orders` por `organization_id` | FAILED | Nenhuma migration em `/supabase/migrations/` contém `ENABLE ROW LEVEL SECURITY` para `public.orders`. Grep de todos os 63 arquivos: zero resultados para `orders` + RLS |
| 3 | Dashboard usa `SUM(orders.comissao)` e `SUM(orders.frete)`, não 11%/5% | VERIFIED | `MercadoLivre.tsx` linhas 300-313: `costSummary` usa `ordersSummary?.total_comissao ?? grossRevenue * 0.11` e `ordersSummary?.total_frete ?? grossRevenue * 0.05` — hardcoded apenas como fallback |
| 4 | Ticket médio = `paid_revenue / COUNT(paid orders)` — cancela cancelados | VERIFIED | `MercadoLivre.tsx` linhas 267-273: `paidCount = ordersSummary?.paid_orders_count ?? m.total_orders`; `useMLOrders.ts` linhas 50-55: filtra `status === 'paid'` antes de contar e somar revenue |
| 5 | KPIs de visitas e conversão não regridem | VERIFIED | `MercadoLivre.tsx` linhas 262-264: `unique_visits` e `unique_buyers` continuam vindos de `effectiveDaily` (ml_daily_cache), sem alteração. `conversion_rate` calculado em linha 274 da mesma fonte |

**Score:** 3/5 truths verified (2 gaps são de schema/segurança, não de lógica de negócio)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260521180000_orders_indexes.sql` | Indexes de performance para queries do hook | VERIFIED | 2 composite indexes criados: `(org_id, ml_user_id, data_pedido)` e `(org_id, status, data_pedido)` |
| `supabase/functions/mercado-libre-integration/index.ts` | upsert em `orders` com `comissao` via `sale_fee` e `frete` via `shipping.cost`/`base_cost` | VERIFIED | Linhas 787-865: `orderRows` construídos com `comissao: item.sale_fee`, `frete` calculado com fallback `buyerCost || base_cost`, upsert fire-and-forget com `onConflict: "ml_order_id,ml_user_id,item_id,variation_id"` |
| `src/hooks/useMLOrders.ts` | Hook que agrega `total_comissao`, `total_frete`, `paid_orders_count`, `paid_revenue` de `public.orders` | VERIFIED | 62 linhas substantivas; query Supabase correta com filtros `organization_id`, `ml_user_id`, `data_pedido`; reduce client-side para os 4 valores esperados |
| `src/pages/MercadoLivre.tsx` | `costSummary` usa valores reais; `avg_ticket` usa contagem de paid orders | VERIFIED | Linha 118: `useMLOrders(currentFrom, currentTo)` importado e usado; linhas 300-313: `costSummary` com fallback correto; linhas 267-273: `avg_ticket` com `paid_orders_count` |
| RLS em `public.orders` | `ENABLE ROW LEVEL SECURITY` + policy por `organization_id` | MISSING | Nenhuma migration, nenhum arquivo de supabase contém RLS para `public.orders` |
| Unique constraint `(ml_order_id, ml_user_id, item_id, variation_id)` | Necessário para upsert funcionar corretamente | MISSING IN MIGRATIONS | Constraint referenciado em 2 edge functions mas ausente em qualquer migration. Estado real do banco desconhecido (drift pré-migration) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MercadoLivre.tsx` | `useMLOrders` hook | import + `useMLOrders(currentFrom, currentTo)` linha 118 | WIRED | Linha 118 importa e chama; `ordersSummary` usado em linhas 267, 304, 305 |
| `useMLOrders.ts` | `public.orders` (Supabase) | `supabase.from("orders").select(...)` | WIRED | Query substantiva com 5 filtros e reduce client-side |
| `mercado-libre-integration` | `public.orders` | `supabase.from("orders").upsert(...)` linhas 851-858 | WIRED | upsert fire-and-forget correto |
| `costSummary` | `ordersSummary.total_comissao` / `total_frete` | `?? fallback` pattern | WIRED | Fallback a 11%/5% quando sem dados — comportamento correto |
| upsert key | unique constraint no banco | `onConflict: "ml_order_id,ml_user_id,item_id,variation_id"` | UNVERIFIABLE | Constraint pode existir como drift no banco; não está em nenhuma migration |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `MercadoLivre.tsx` costSummary | `ordersSummary.total_comissao` | `useMLOrders` → `public.orders` → `item.sale_fee` via sync | Yes, quando orders estão no banco | FLOWING (com fallback) |
| `MercadoLivre.tsx` avg_ticket | `ordersSummary.paid_orders_count` + `paid_revenue` | `useMLOrders` → filtra `status='paid'` | Yes | FLOWING (com fallback) |

---

## Behavioral Spot-Checks

Step 7b: SKIPPED — frontend SPA + edge functions; não há entry points runnáveis sem servidor.

---

## Requirements Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| ORDERS-01: tabela com comissao/frete | `types.ts` linhas 995-1024 confirmam schema | SATISFIED (tabela existe) |
| ORDERS-01: RLS por organization_id | Nenhuma migration cria RLS/policy | BLOCKED |
| ORDERS-02: sync preenche comissao/frete | `mercado-libre-integration/index.ts` linhas 831, 804-807 | SATISFIED |
| ORDERS-03: dashboard usa SUM real | `MercadoLivre.tsx` linhas 304-305 | SATISFIED |
| ORDERS-04: ticket médio exclui cancelados | `useMLOrders.ts` linhas 50-55; `MercadoLivre.tsx` linhas 267-272 | SATISFIED |
| ORDERS-05: visitas/conversão não regridem | `MercadoLivre.tsx` linhas 262-264, 274 — mesma fonte de antes | SATISFIED |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase/migrations/` (ausência) | — | RLS ausente em `public.orders` | BLOCKER | Qualquer usuário autenticado pode SELECT all orders de qualquer org |
| `supabase/migrations/` (ausência) | — | UNIQUE constraint não capturado em migration | WARNING | Drift: se constraint não existir no banco ao vivo, upsert em `mercado-libre-integration` inserirá duplicatas silenciosamente |
| `supabase/functions/mercado-libre-integration/index.ts` | 844-865 | upsert orders é fire-and-forget; errors são apenas `console.error` (não fatais) | INFO | Se upsert falhar (ex: constraint missing), o response da edge function ainda retorna success=true mas orders não foram salvas |

---

## Human Verification Required

### 1. Verificar RLS no banco de produção

**Test:** No Supabase Dashboard (projeto `gionpsuunfkkzzjdubfy`), ir em Database > Tables > orders > clicar "RLS" ou "Policies"
**Expected:** RLS habilitado (`ALTER TABLE orders ENABLE ROW LEVEL SECURITY`) com ao menos uma policy de SELECT que filtre por `organization_id`
**Why human:** A tabela `orders` existe como drift pré-migration. Seu estado RLS no banco ao vivo pode diferir dos arquivos de migration. Se RLS não estiver habilitado, é um gap crítico de segurança que precisa de migration imediata.

### 2. Verificar unique constraint no banco de produção

**Test:** No Supabase Dashboard, ir em Database > Tables > orders > aba "Constraints" ou rodar: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'orders' AND constraint_type = 'UNIQUE';`
**Expected:** Deve existir constraint UNIQUE em `(ml_order_id, ml_user_id, item_id, variation_id)`
**Why human:** O upsert em `mercado-libre-integration` e `sync-ml-orders` depende dessa constraint. Se ela não existir, cada sync inserirá linhas duplicadas em vez de fazer upsert, corrompendo os totais de comissao/frete.

---

## Gaps Summary

Dois gaps bloqueiam o goal completo desta fase:

**Gap 1 — RLS ausente (segurança crítica):** A tabela `public.orders` contém dados sensíveis de pedidos (comprador, preço, comissão) e não tem Row Level Security em nenhuma migration. Sem RLS, qualquer usuário autenticado na plataforma pode ler orders de qualquer outra organização via `supabase.from("orders").select(...)`. Este é um gap de segurança, não de funcionalidade — o dashboard funciona corretamente, mas os dados estão expostos entre tenants.

**Gap 2 — Unique constraint não em migration (confiabilidade):** O upsert em ambas as edge functions (`mercado-libre-integration` e `sync-ml-orders`) depende de `onConflict: "ml_order_id,ml_user_id,item_id,variation_id"`. Esta constraint pode existir no banco de produção como drift, mas não está capturada em nenhuma migration. Se o banco de produção não tiver a constraint (ou se for recriado/migrado), os upserts falharão silenciosamente (fire-and-forget) e inserirão duplicatas, corrompendo os KPIs.

Os 3 critérios de negócio (SC-3, SC-4, SC-5) estão implementados corretamente na lógica de frontend/edge function. Os gaps são de schema/segurança.

---

_Verified: 2026-05-21_
_Verifier: Claude (gsd-verifier)_
