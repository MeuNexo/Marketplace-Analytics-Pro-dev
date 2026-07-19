---
phase: quick-260719-o6q
plan: 01
subsystem: api
tags: [supabase-edge-function, mercado-livre, product-ads, deno]

requires:
  - phase: quick-260719-nov
    provides: "sync-ads preserva cache existente quando o fetch de ads no ML falha (não apaga silenciosamente)"
provides:
  - "sync-ads apontando para os endpoints novos de Product Ads do ML (item search + campaign search), com site_id capturado do advertiser"
affects: [sync-ads, process-sync-job, ml_ads_daily_cache, ml_ads_products_cache, ml_ads_campaigns_cache]

tech-stack:
  added: []
  patterns:
    - "Endpoints Product Ads do ML exigem {SITE_ID} no path desde a migração de 26/02/2026 (/advertising/{SITE_ID}/advertisers/{ADVERTISER_ID}/product_ads/{ads,campaigns}/search)"

key-files:
  created: []
  modified:
    - supabase/functions/sync-ads/index.ts

key-decisions:
  - "site_id capturado da mesma resposta de /advertising/advertisers?product_id=PADS (advData.advertisers[0].site_id), com guard de erro simétrico ao advertiser_id"
  - "daily_budget passa a ler c.budget como primeira opção do fallback (Number(c.budget ?? c.budget_amount ?? c.daily_budget ?? 0)), preservando compatibilidade se o ML ainda devolver os campos antigos em algum cenário"

requirements-completed: [ADS-MIGRATE-01]

duration: ~5min
completed: 2026-07-19
status: complete
---

# Quick Task 260719-o6q: Migrar sync-ads para os novos endpoints Product Ads Summary

**sync-ads migrado dos endpoints Product Ads descontinuados (404 desde 26/02/2026) para os novos endpoints `/advertising/{siteId}/advertisers/{advertiserId}/product_ads/{ads,campaigns}/search`, capturando `site_id` do advertiser e lendo `budget` das campanhas.**

## Performance

- **Duration:** ~5min
- **Tasks:** 2 planejadas (1 código executada e commitada; 1 deploy documentada como pendência para o orquestrador)
- **Files modified:** 1

## Accomplishments
- `site_id` agora é capturado de `advData.advertisers[0].site_id` (mesma chamada que já retornava `advertiser_id`), com guard de erro `No site_id for ml_user_id=...` simétrico ao guard existente de `advertiser_id`.
- URL de busca de items migrada de `/advertising/advertisers/{advertiserId}/product_ads/items` (descontinuada, 404) para `/advertising/{siteId}/advertisers/{advertiserId}/product_ads/ads/search`, preservando os query params (`date_from`, `date_to`, `metrics`, `metrics_summary`, `limit`, `offset`).
- URL de busca de campanhas migrada de `/advertising/advertisers/{advertiserId}/product_ads/campaigns` para `/advertising/{siteId}/advertisers/{advertiserId}/product_ads/campaigns/search`.
- Campo de orçamento (`daily_budget`) agora lê `c.budget` (campo novo) como primeira opção, com fallback para `c.budget_amount`/`c.daily_budget` (campos antigos).
- Nenhuma referência restante ao path antigo `product_ads/items` no arquivo.
- `normalizeMetrics()`, extração de métricas (`m.prints`/`m.clicks`/`m.cost`/`m.units_quantity`/`m.total_amount`/`m.direct_amount`), lógica de paginação (`offset += items.length; if (items.length === 0 || offset >= total) break;`) e mapeamento `campaign_id: String(c.id ?? c.campaign_id ?? "")` mantidos intocados, conforme escopo do plano.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrar URLs do sync-ads para os novos endpoints Product Ads (+ capturar site_id)** - `b6deb3fb` (feat)
2. **Task 2: Deployar sync-ads em prod preservando verify_jwt=false** - NÃO EXECUTADA pelo executor (ver "Pendências" abaixo); sem commit de código associado (nenhuma mudança adicional de arquivo).

## Files Created/Modified
- `supabase/functions/sync-ads/index.ts` - migração de `syncUser()`: captura de `siteId` + guard, URLs de items/campaigns migradas para os novos endpoints `/product_ads/ads/search` e `/product_ads/campaigns/search`, `daily_budget` lendo `c.budget`.

## Decisions Made
- `site_id` obtido da mesma chamada `/advertising/advertisers?product_id=PADS` que já fornecia `advertiser_id` — nenhuma chamada extra ao ML necessária.
- Guard de `site_id` ausente lança erro (mesmo padrão do guard de `advertiser_id`), garantindo falha explícita em vez de URL malformada.
- Fallback de `daily_budget` mantém compatibilidade retroativa (`c.budget_amount`/`c.daily_budget`) caso o ML devolva campos antigos em algum cenário transitório.

## Deviations from Plan

None - plan executado exatamente como escrito para Task 1.

## Issues Encountered

**Task 2 (deploy) não pôde ser executada por este executor:** este agente (subagente executor GSD) não tem acesso à tool MCP Supabase de deploy (`mcp__claude_ai_Supabase__deploy_edge_function`) nem a um Supabase CLI autenticado no ambiente. Conforme instrução explícita do plano e das constraints da task, NÃO foi tentado `supabase functions deploy` via CLI (confirmado em task anterior que o CLI não está autenticado neste ambiente) e nenhuma alternativa de contorno foi tentada.

## Pendências (para o orquestrador)

**Deploy pendente:** o orquestrador (ou quem tiver acesso à tool MCP Supabase) deve executar:

```
mcp__claude_ai_Supabase__deploy_edge_function
  project_id: ckcdevcxgvueywivefgx
  name: sync-ads
  verify_jwt: false
```

Usando o conteúdo atualizado de `supabase/functions/sync-ads/index.ts` (commit `b6deb3fb`, branch atual `gsd/phase-99-dre-caixa-mp`). `verify_jwt=false` deve ser preservado — a função usa `requireServiceRole()` interno (Bearer = `SUPABASE_SERVICE_ROLE_KEY`), não JWT do Supabase Auth.

Após o deploy, recomenda-se disparar um sync manual (via `process-sync-job`/fila `sync_jobs` ou chamada direta com o service role key) para confirmar que os endpoints novos retornam 200 (não mais 404) e que o cache de ads volta a ser populado para o período de 15–19/07 que ficou sem dados (achado documentado na quick task anterior 260719-nov).

## Next Phase Readiness
- Código pronto e commitado (`b6deb3fb`); só falta o deploy da edge function em produção para o fix ter efeito real.
- Nenhum blocker de código. Blocker operacional: deploy exige tool/token que este executor não possui.

---
*Phase: quick-260719-o6q*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: supabase/functions/sync-ads/index.ts
- FOUND: commit b6deb3fb
- FOUND: .planning/quick/260719-o6q-migrar-sync-ads-para-os-novos-endpoints-/260719-o6q-SUMMARY.md
