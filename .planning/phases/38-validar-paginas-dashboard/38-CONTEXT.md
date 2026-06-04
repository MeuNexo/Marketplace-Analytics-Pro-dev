# Phase 38 — Contexto: Validar Páginas do Dashboard

## Problema relatado (Wesley, 2026-06-04)
"Os dados em sua maioria estão zerados, pedindo sincronização, sendo que antes
funcionava normal. E agora não carrega todos os dados corretamente."

Páginas afetadas: **Publicidade, Margem, Anúncios, Estoque, Pedidos**.

## Investigação realizada

### Backend (edge functions) — SAUDÁVEL
Logs (últimas 24h) mostram quase 100% HTTP 200:
- `mercado-libre-integration` v11 → 200 (2.4–3.5s)
- `sync-ml-orders` v17 → 200 (2–6s)
- `ml-inventory` v8 → 200 (13–15s)
- `ml-ads` v12 → 200
- `ml-products-aggregated` v9 → 200
- `recalc-order-costs` v12 → 200
- Anomalias isoladas: 1× `process-sync-job` 500, 1× `mercado-libre-integration` 401
  (coincide com token-refresh imediatamente após — transitório, não recorrente).

### Estado dos dados (DB, 2026-06-04)
| Tabela | Última data | Observação |
|--------|-------------|------------|
| ml_daily_cache | 2026-06-03 | ontem |
| ml_product_daily_cache | 2026-06-03 | ontem (9004 rows) |
| ml_hourly_cache | 2026-06-03 | ontem |
| **orders** | **2026-05-27** | **1 semana parado** |
| ml_ads_daily_cache | 2026-06-04 | fresco (cron próprio) |

## Hipóteses (ordenar por verificação)

### H1 — Auto-sync do frontend não dispara sync principal (MAIS PROVÁVEL)
O filtro padrão inclui "hoje" (2026-06-04), mas os caches param em 2026-06-03.
Se `useMLSync.syncFromAPI()` / auto-sync on mount não está chamando
`mercado-libre-integration` para o dia atual, o dashboard mostra zeros e pede sync.
- Verificar: `src/hooks/useMLSync.ts` (auto-sync stale > 10min), `useAutoRecalc.ts`.
- Mudanças recentes em useAutoRecalc (commits 31/33/34/35) podem ter quebrado o gatilho.

### H2 — Hook compartilhado regrediu (afeta TODAS as páginas de uma vez)
`resolvedMLUserIds` (MLStoreContext) ou `orgId` (OrganizationContext) vindo vazio/errado
faz todas as queries retornarem vazio simultaneamente.
- Verificar: `MLStoreContext`, `OrganizationContext`, resolução de contas ML.

### H3 — orders parado há 1 semana é problema separado
`sync-ml-orders` retorna 200 mas grava 0 (já visto na Phase 35/36: API ML
`/orders/search` retorna vazio para o período). Afeta /pedidos e margem real.
- Verificar: por que orders não avança desde 2026-05-27. Token? Scope? Range de data?

### H4 — Crash TDZ em página específica
Commit `7108053a` corrigiu um TDZ crash em MLCostCard. Pode haver outro caso
não coberto que derruba uma página inteira (tela branca).
- Verificar: console do browser em cada página.

## Suspeitos (commits que mexeram em fluxo de dados compartilhado)
- `6b34b393 feat(31)` auto-recalc CMV/impostos + auto-sync pedidos de hoje
- `5146749c fix(33)` auto-sync orders de hoje quando waterfall vazio
- `61b028ff fix(34)` + `382a67b5 fix(34b)` invalidação ["ml"] global
- `fd1798fa fix(34c)` sync-ml-orders direto em vez de fila
- `9a844ddb fix(35)` + Phase 36/37 (useMLOrdersByBrand, fallbacks)

## Critérios de sucesso
Ver ROADMAP.md Phase 38 (7 critérios).

## Método sugerido
1. Reproduzir cada página em produção (marketplace-analytics-pro-dev.vercel.app)
   com DevTools aberto — capturar erro real (zero vs crash vs empty-state).
2. Confirmar qual hipótese por página.
3. Bisect nos commits suspeitos se for regressão de código.
4. Corrigir causa raiz (provavelmente 1 fix cobre múltiplas páginas se for H1/H2).
