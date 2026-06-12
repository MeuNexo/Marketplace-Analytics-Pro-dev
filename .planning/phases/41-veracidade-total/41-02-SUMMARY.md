---
phase: 41-veracidade-total
plan: 02
subsystem: api
tags: [supabase, edge-function, ml-billing-api, react-query, rls, postgres, cffe, cfonpn]

# Dependency graph
requires:
  - phase: 41-veracidade-total (plan 01)
    provides: "DATA-01/02/03 consolidados — useMLCostWaterfall como fonte autoritativa do card Custos"
  - phase: 38
    provides: "Padrão de EF sync-ml-orders (auth dual-path, mlFetch, token lookup ml_tokens)"
provides:
  - "Tabela ml_billing_monthly (org+ml_user_id+period_month UNIQUE, RLS is_org_member) em produção ckcdevcxgvueywivefgx"
  - "EF sync-ml-billing v2 ACTIVE — 2-call flow ML Billing API, extrai CFFE/CFONPN, deny-by-default"
  - "Hook useMLBilling(periodMonth) lendo ml_billing_monthly escopado por org+resolvedMLUserIds"
  - "Trigger de produção em useMLSync: sync-ml-billing non-fatal por ml_user_id ao fim do sync"
  - "MLCostCard com linha 'Parcelamento (CFONPN)' e indicador 'billing'/'estimado' no Frete"
affects: [41-veracidade-total plans 03+, financeiro, anuncios, billing, v8-difal-cshia]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Billing 2-call flow: /billing/integration/monthly/periods → /periods/key/{key}/summary/details"
    - "Deny-by-default em EFs: não-service-role com organization_id NULL → 403"
    - "Trigger frontend de sync secundário non-fatal (mesmo padrão sync-ml-orders no useMLSync)"

key-files:
  created:
    - supabase/migrations/20260612140000_ml_billing_monthly.sql
    - supabase/functions/sync-ml-billing/index.ts
    - src/hooks/useMLBilling.ts
  modified:
    - src/hooks/useMLSync.ts
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx
    - src/integrations/supabase/types.ts

key-decisions:
  - "verify_jwt=false na EF sync-ml-billing: auth dual-path no código (service role + JWT user), precedente mercado-libre-integration v13 — gateway Supabase rejeita sb_secret"
  - "Deny-by-default (fix orquestrador 86aaacc9): loja sem organization_id só acessível via service role — fail-open original exporia billing de lojas órfãs a qualquer usuário autenticado"
  - "Sem billing (404/sem Full): pular upsert em vez de gravar zeros — preserva dados anteriores"
  - "billingMonth deriva de currentFrom (período selecionado), não de monthlyFrom — indicador acompanha o filtro do usuário"

patterns-established:
  - "fetchBillingPeriod: matching flexível de period key (YYYY-MM | YYYYMM | YYYY-MM-DD)"
  - "Tipos Supabase adicionados manualmente em types.ts (padrão do projeto, sem regenerar)"

requirements-completed: [DATA-04]

# Metrics
duration: ~45min (código) + infra via orquestrador
completed: 2026-06-12
---

# Phase 41 Plan 02: Billing CFFE/CFONPN Real Summary

**CFFE real (R$33,3k) e nova linha Parcelamento CFONPN (R$14k) no card Custos de /vendas via ML Billing API, com tabela ml_billing_monthly, EF sync-ml-billing e trigger automático no fluxo de sync**

## Performance

- **Duration:** ~45 min (código) + ações de infra pelo orquestrador
- **Completed:** 2026-06-12
- **Tasks:** 4/4 + checkpoint infra (orquestrador) + smoke produção (Wesley)
- **Files modified:** 7

## Accomplishments

- Tabela `ml_billing_monthly` criada e aplicada em produção (ckcdevcxgvueywivefgx) com RLS `org_member_billing` via `is_org_member` — confirmado via information_schema, 1 policy ativa
- EF `sync-ml-billing` v2 ACTIVE: fluxo de 2 chamadas da ML Billing API (periods → summary/details), parse de CFFE/CFONPN de `bill_includes.charges`, upsert escopado por org+ml_user_id+period_month
- Hook `useMLBilling(periodMonth)` + trigger non-fatal no `useMLSync` — tabela populada automaticamente a cada sync, sem invocação manual
- MLCostCard: linha "Parcelamento (CFONPN)" (ícone CreditCard violet, somado em operationalCosts) + indicador "billing"/"estimado" junto ao Frete; frete usa CFFE real com fallback para orders

## Task Commits

1. **Tasks 1+2: Migration ml_billing_monthly + tipos + EF sync-ml-billing** - `d0f61815` (feat)
2. **Task 3: useMLBilling + trigger useMLSync + MLCostCard CFONPN + wiring MercadoLivre** - `7c241b03` (feat)
3. **Task 4: push origin main** - incluído em `7c241b03` (Vercel auto-deploy)
4. **Fix de segurança (orquestrador): deny-by-default na EF** - `86aaacc9` (fix)

## Files Created/Modified

- `supabase/migrations/20260612140000_ml_billing_monthly.sql` - DDL + RLS is_org_member (aplicada via MCP apply_migration)
- `supabase/functions/sync-ml-billing/index.ts` - EF com fetchBillingPeriod, auth dual-path, zod YYYY-MM, deny-by-default
- `src/hooks/useMLBilling.ts` - hook React Query lendo ml_billing_monthly (staleTime 30min)
- `src/hooks/useMLSync.ts` - trigger non-fatal sync-ml-billing por ml_user_id para o mês corrente
- `src/components/mercadolivre/MLCostCard.tsx` - props cfonpn/billingSource, linha CFONPN, indicador de fonte
- `src/pages/MercadoLivre.tsx` - billingMonth de currentFrom, frete=CFFE-com-fallback, wiring completo
- `src/integrations/supabase/types.ts` - entrada ml_billing_monthly (manual, padrão do projeto)

## Decisions Made

- **verify_jwt=false** na EF: auth tratada no código (dual-path service role + JWT + is_org_member). Precedente: mercado-libre-integration v13 — o gateway do Supabase rejeita tokens sb_secret quando verify_jwt=true.
- **Pular upsert quando billing indisponível** (404 = conta sem Full): não sobrescrever dados anteriores com zeros; frontend cai em fallback "estimado".
- **billingMonth derivado de `currentFrom`** (período selecionado pelo usuário) em vez de `monthlyFrom` — o card reflete o filtro ativo.

## Deviations from Plan

### Fix de segurança aplicado pelo orquestrador (pós-execução)

**1. [Rule 2 - Security] Deny-by-default para lojas sem organization_id**
- **Found during:** Revisão automática de segurança no deploy da EF (orquestrador)
- **Issue:** O membership check original (`if (!isServiceRole && userId && organizationId)`) falhava ABERTO quando `organization_id` era NULL — qualquer usuário autenticado poderia disparar sync de billing de lojas órfãs
- **Fix:** Não-service-role com `organization_id` NULL → 403 Forbidden (loja sem org só acessível via service role)
- **Files modified:** supabase/functions/sync-ml-billing/index.ts
- **Verification:** Smoke negativo — invocação com token inválido retornou 401; deploy v2 ACTIVE
- **Committed in:** `86aaacc9` (commit do orquestrador, já pushed)

---

**Total deviations:** 1 fix de segurança (aplicado pelo orquestrador após o commit do executor)
**Impact on plan:** Endurecimento necessário do controle de acesso (T-41-02-04). Sem scope creep.

## Issues Encountered

None — a divisão executor (arquivos) / orquestrador (infra MCP) funcionou conforme planejado.

## Evidência de Produção (smoke validado)

- **Caminho real:** Wesley disparou sync em /vendas → trigger do useMLSync invocou sync-ml-billing → `SELECT` em ml_billing_monthly retornou 1 linha: `ml_user_id=1639558873`, `period_month=2026-06`, `resumo.cffe=33353.16`, `resumo.cfonpn=14021.05`, 17 charges
- **Visual confirmado por Wesley:** linha "Parcelamento (CFONPN)" e indicador de fonte aparecem no card Custos
- **Smoke negativo:** invocação com token inválido → 401 (auth negando corretamente)
- **Infra:** migration aplicada via MCP apply_migration; EF v2 ACTIVE em ckcdevcxgvueywivefgx

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DATA-04 completo: CFFE/CFONPN reais visíveis em /vendas (~R$15,9k/mês de CFONPN antes invisível)
- Tabela ml_billing_monthly disponível para DATA-06 (validação cruzada contra referência Nexo Abril/2026) e para futuros DIFAL/CSHIA (v8+)
- Backfill de meses anteriores (ex.: 2026-04 para validação de referência) pode ser feito invocando a EF com period_month específico

## Self-Check: PASSED

- Arquivos criados existem (migration, EF, hook): FOUND
- Commits d0f61815, 7c241b03, 86aaacc9: FOUND no git log
- tsc --noEmit: exit 0

---
*Phase: 41-veracidade-total*
*Completed: 2026-06-12*
