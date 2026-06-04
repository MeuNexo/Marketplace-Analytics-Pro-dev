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

---

## CAUSA RAIZ CONFIRMADA (investigação 2026-06-04)

Sintoma do usuário: empty-state pedindo sync; **não é crash; já vinha de antes**
(NÃO é regressão dos fixes de hoje 34-37).

### Pipeline de sync por cron está QUEBRADO no backend (não é o frontend)

Crons ativos (cron.job): `sync-orders-daily` (9h), `sync-sales-daily` (9h),
`sync-dispatch-every-30min`, `sync-process-job-every-5min`, etc.
Eles inserem em `sync_jobs`; `process-sync-job` drena a fila chamando as EFs.

**Estado de sync_jobs:**
| job_type | completed | failed | observação |
|----------|-----------|--------|-----------|
| daily_cache | 0 | 874 | TODOS falhando, contínuo até hoje |
| orders | 69 | 912 | failed pararam 05-29; "completed" não gravam |
| inventory | 231 | 0 | OK |
| ads | 111 | 0 | OK |

**error_msg revelador:**
1. **daily_cache → 401**: `mercado-libre-integration responded 401:
   UNAUTHORIZED_INVALID_JWT_FORMAT / Invalid JWT`.
   - `process-sync-job` chama com `Bearer SUPABASE_SERVICE_ROLE_KEY`. A Supabase
     rotacionou as keys para formato `sb_secret_…` (NÃO é JWT). EFs com
     `verify_jwt=true` (mercado-libre-integration, sync-ml-orders) são rejeitadas
     no gateway antes de entrar na função.
   - (Mesma classe de bug já visto no projeto nexo-mcp — ver memória
     "pg_cron auth Supabase rotacionou para sb_secret_".)
2. **orders → 400 (histórico, até 05-29)**: `sync-ml-orders responded 400:
   date_from/date_to Expected string, received null`. Jobs do dispatcher de 30min
   vinham com data nula. "Corrigido" em process-sync-job com `?? today`.

### Por que ml_daily_cache parece fresco (06-03) mas orders congelou (05-27)
- `ml_daily_cache` é mantido fresco pelo **auto-sync do FRONTEND** (usuário abre
  /vendas → mercado-libre-integration roda com JWT de usuário válido → grava).
  O cron de daily_cache falha (401) mas ninguém percebe pq o frontend cobre.
- `orders` NÃO tem backfill de dias passados no frontend (só "hoje"). Como o cron
  está quebrado, o gap 05-28..06-03 (~325 pedidos reais, comprovados no daily
  cache) nunca foi gravado → /pedidos e /margem vazios para período recente.

### Falha silenciosa que mascara o problema
- `process-sync-job` (orders) só checa `resp.ok` (HTTP 200), NÃO o `orders_synced`.
- `sync-ml-orders` retorna `200 {success:true, orders_synced:0}` mesmo quando
  `batch_upsert_orders` falha (linhas 562-568) ou quando busca 0 da API.
- Resultado: job marcado "completed" sem gravar nada. `ml_sync_log` tem ZERO
  rows de source='orders' (a EF nunca chega a registrar sync de orders bem-sucedido).
- Job orders de 06-02 (32 pedidos reais) "completou" em ~2s — rápido demais para
  buscar pedidos+fretes+marcas → confirma que não está processando de fato.

## PLANO DE FIX (proposto)
1. **Auth do cron**: resolver o 401. Opções:
   a. `verify_jwt=false` em mercado-libre-integration + sync-ml-orders (elas já
      têm auth interna por service-role/isServiceRole) — alinha com process-sync-job.
   b. process-sync-job enviar um JWT válido (anon key JWT) em vez de sb_secret.
   Preferir (a) com cuidado de manter a checagem interna isServiceRole robusta.
2. **process-sync-job**: checar `orders_synced` no corpo da resposta; se 0 com
   período que tinha vendas, marcar job como failed (não mascarar).
3. **sync-ml-orders**: lançar erro (não engolir) quando `batch_upsert_orders`
   falhar, para o job refletir failure.
4. **Backfill**: rodar sync de orders para 2026-05-28..2026-06-04 (ambas contas)
   após o fix de auth — repopula /pedidos e /margem.
5. **Verificar** ml_daily_cache cron também volta a 200 (mesmo fix de auth).
6. Validar as 5 páginas em produção.

## NOTA DE RISCO
Fixes 1-3 mexem em AUTH de edge functions e 4 é um backfill que grava muitos
registros. Confirmar com Wesley antes de aplicar (mudança outward/segurança).
