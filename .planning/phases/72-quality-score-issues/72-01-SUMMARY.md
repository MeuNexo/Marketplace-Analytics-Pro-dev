---
phase: 72-quality-score-issues
plan: "01"
subsystem: edge-functions
tags: [ml-api, health, edge-function, anti-idor, deno]
dependency_graph:
  requires: []
  provides: [ml-listing-health-ef]
  affects: [ListingIndicatorsTab, Phase-72-02]
tech_stack:
  added: []
  patterns: [deno-ef-ml-token-pattern, zod-body-validation, is_org_member-anti-idor]
key_files:
  created:
    - supabase/functions/ml-listing-health/index.ts
  modified: []
decisions:
  - "score tipado como number | null: unavailable retorna null, evita banda 0 incorreta no ListingQualityScore"
  - "Fallback /performance → /health: /performance usa caminho singular 'item', /health usa plural 'items'"
  - "Issues desconhecidas no /performance usam wordings.title da API como fallback (melhor ES que ocultar issue real)"
  - "Token expirado ML retorna 401 explícito; ambas APIs falham retornam source=unavailable com score null (modal não quebra)"
  - "Nenhum decrypt AES-GCM: ml_tokens.access_token é texto plano neste projeto"
metrics:
  duration: "~12 min"
  completed: "2026-06-29"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 1
status: complete
---

# Phase 72 Plan 01: Edge Function ml-listing-health — Summary

**One-liner:** EF Deno `ml-listing-health` que busca saúde de anúncio ao vivo na API ML com guard anti-IDOR, normalização 0-1 e mapeamento PT-BR de issues.

## O que foi construído

Edge function Deno `supabase/functions/ml-listing-health/index.ts` (354 linhas).

Espelha exatamente o padrão canônico de `ml-reputation`/`ml-inventory`:
- Validação JWT via `supabase.auth.getUser`
- Token lookup em `ml_tokens` por `ml_user_id` com `ORDER BY updated_at DESC LIMIT 1`
- Guard anti-IDOR via `is_org_member(_user_id, _org_id)` → 403 se não-membro
- Fetch `GET https://api.mercadolibre.com/item/{id}/performance` (singular — landmine 4)
- Fallback `GET https://api.mercadolibre.com/items/{id}/health` (plural)
- Score normalizado: `/performance` divide `rawScore / 100`; `/health` usa `health` (já 0-1)
- `score: number | null` — nullable; `unavailable` retorna `null` (não confunde `0` com "sem dados")
- `GOAL_MAP`: 10 goals mapeados para PT-BR (categorias "Condições de venda" e "Dados do produto")
- `LEVEL_WORDING`: 6 níveis (`professional`→Profissional, `gold`→Ouro, etc.)
- Issues do `/performance` com rule key desconhecida usam `wordings.title` da API como fallback
- Estado `source: "unavailable"` com HTTP 200 quando ambas APIs falham (modal não quebra)
- Token ML expirado (ML retorna 401) → EF retorna 401 `{ error: "ML token expired" }`
- `console.log` de diagnóstico sem vazar `access_token`
- `try/catch` global → 500 `{ error: "Internal server error" }`

## Tasks concluídas

| # | Nome | Commit | Arquivo |
|---|------|--------|---------|
| 1 | Criar edge function ml-listing-health | fa2d101a | supabase/functions/ml-listing-health/index.ts |
| 2 | Deploy via MCP + smoke (orquestrador) | — (deploy via MCP, sem código) | EF `ml-listing-health` ACTIVE v1 |

## Task 2 — Deploy via MCP + smoke (concluída pelo orquestrador)

Deploy e smoke executados pelo ORQUESTRADOR no projeto Supabase real `ckcdevcxgvueywivefgx` (o executor não deploya EFs neste projeto).

**Evidência do deploy:**
- Deploy via MCP `deploy_edge_function`: função `ml-listing-health` **ACTIVE**, version 1, `verify_jwt=true`.

**Evidência do smoke (EF deployada):**
- POST sem `Authorization` → HTTP 401 (`UNAUTHORIZED_NO_AUTH_HEADER`, gateway verify_jwt ativo). ✓
- POST com anon key como Bearer → HTTP 401 `{"error":"Unauthorized"}` (guard `getUser` rejeita token que não é de usuário). ✓ auth guard funcional.
- OPTIONS/CORS → HTTP 200. ✓
- Anúncio/loja de referência: `item_id=MLB3621411217`, `ml_user_id=427063369` (loja maior da Pé Vermeio).

**Cobertura pendente (deferida para E2E do Wesley):**
- Smoke positivo com dados reais do ML e o 403 cross-org ao vivo NÃO foram executados — exigem um JWT de usuário logado, indisponível no ambiente do orquestrador. Esses dois ficam para a validação end-to-end do Wesley no preview após a Wave 2 (UI da Phase 72-02).
- Caminho positivo coberto indiretamente por: `deno check` OK, URLs espelhando a EF antiga em prod (`fetch-ml-listing-health`), e padrão idêntico ao `ml-reputation` (provado em produção).

| # | Nome | Status |
|---|------|--------|
| 2 | Deploy via MCP + smoke contra MLB real | ✅ Concluída — EF ACTIVE v1; auth guard validado; smoke positivo real deferido ao E2E do Wesley |

## Desvios do Plano

Nenhum — plano executado exatamente como especificado.

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-72-01 (IDOR cross-org) | Mitigado — `is_org_member` antes de qualquer fetch ML |
| T-72-02 (Spoofing JWT) | Mitigado — `auth.getUser(JWT)` → 401 se inválido |
| T-72-03 (item_id em logs URL) | Mitigado — item_id em body POST, não query string |
| T-72-04 (Rate limit) | Aceito — uso on-demand (1 req/modal) |
| T-72-SC (pacotes novos) | Mitigado — zero novos pacotes; imports pinados: std@0.168.0, @supabase/supabase-js@2, zod@v3.22.4 |

## Known Stubs

Nenhum. A EF está completa; o deploy + smoke ficam para o orquestrador (Task 2, checkpoint).

## Self-Check: PASSED

- `supabase/functions/ml-listing-health/index.ts` — FOUND
- Commit `fa2d101a` — FOUND
- `deno check` — PASSOU sem erros
