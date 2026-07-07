---
phase: 90-dre-imposto-real-cmv-fechamento
plan: 01
status: complete
completed: 2026-07-07
commits:
  - 72589b2a  # migration RPC get_imposto_guia_by_competence
---

# 90-01 SUMMARY — RPC do imposto real por competência

**Status:** ✅ COMPLETE — 2026-07-07. RPC nova em prod, provada.

## O que foi feito
- **Migration `20260690000000_get_imposto_guia_by_competence.sql`** (commit `72589b2a`, escrita pelo executor) — RPC nova, isolada de `get_dre_operational_by_competence` (não arrisca o −R$29k de junho da Phase 88).
- **Aplicada em prod** (`ckcdevcxgvueywivefgx`) via Supabase MCP `apply_migration` (orquestrador; sem token CLI). `SECURITY INVOKER`, `search_path=public`, anon revogado, GRANT authenticated.
- Assinatura: `get_imposto_guia_by_competence(p_org_id uuid, p_competence date)` → `TABLE(category text, total numeric, status text, n integer)`, agrupado por categoria×status. **Fonte crua e testável** — régua S+1 e guarda de placeholder ficam no frontend (Plans 90-03/90-04).

## Provas (execute_sql em prod)
1. **Maio (fechado real):** 3 linhas `paid` — ICMS 12.000 · PIS 716,19 · COFINS 3.298,87. ✅
2. **Junho (placeholder):** 3 linhas `paid` — ICMS 4.793,21 · PIS **0,01** · COFINS **0,01** → guarda de placeholder do frontend vai reprovar (PIS/COFINS < R$1). ✅
3. **Julho (previsão):** 3 linhas `status='pending'` (≈16.015 copiado de maio) → gatilho `paid` reprova. ✅
4. **Anti-IDOR (empírico):** membro da org Thales (`4aed4678…`) impersonado via `set_config` + LATERAL, chamando com org_id da Pé Vermeio → **0 linhas, total 0**. RLS de `cash_outflows` + INVOKER bloqueiam cross-org. ✅
5. **get_advisors (security):** nenhum issue novo referente a `get_imposto_guia_by_competence` (todos os lints são pré-existentes de outras funções). ✅

## Must-haves
- ✅ RPC expõe `status` + `total` por categoria (granularidade p/ gatilho `paid` + guarda placeholder).
- ✅ `get_dre_operational_by_competence` (Phase 87) e migrations `20260687000000/…0100` intocadas.
- ✅ Anti-IDOR provado empiricamente (não só estrutural).

## Notas
- Deslocamento S+1 e guarda de placeholder NÃO estão nesta RPC (decisão de design: fonte crua) — implementados no Plan 90-03 (`evaluateGuiaReal`/`useImpostoGuia`).
- SC coberto: parte de SC2 (imposto real disponível) + SC6 (anti-IDOR).
