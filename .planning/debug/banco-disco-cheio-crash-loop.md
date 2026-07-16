---
status: resolved
trigger: "banco colapsou — dashboard não funciona"
created: 2026-07-10
updated: 2026-07-10
severity: critical-production-down
---

## RESOLUÇÃO (2026-07-10)
1. Upgrade org Nexo → **Pro** (US$25/mês, cobre os 2 projetos da org).
2. **Disk size 2 GB → 8 GB** (Settings → Compute and Disk; +$0,00, dentro do incluído).
   Postgres bootou, crash loop parou. (Compute/nano→micro NÃO era necessário — problema era só disco.)
3. Catch-up dos syncs: tokens ML válidos até 09:00 UTC; dispatch_orders/sales/ads + process-sync-job
   (6 jobs completos) + resync_billing_daily + custos + releases. Pipeline saudável (401 nos logs
   não afeta process-sync-job com service_role_key).
4. **Prevenção:** apagado log de cron >7d (111.347 linhas, 58→9,5 MB + VACUUM FULL) +
   2 crons de retenção: `prune-cron-logs-daily` (04:10), `prune-webhook-events-daily` (04:20).
5. Motor real do estouro: **ml_webhook_events** cresceu ~31 mil/dia (86 MB em 4 dias) SEM retenção +
   log de cron nunca limpo. No disco free de 2 GB era questão de tempo.

## PENDENTE / OBSERVAR
- `ml_webhook_events`: 95.977 em status 'received' (4 dias). Verificar se reprocess-webhook-events
  está dando conta ou se há backlog real de processamento.
- Auto-scale do Pro agora previne colapso por disco; manter spend cap ligado (teto 8 GB).

# Banco colapsou — disco cheio → Postgres em crash loop

## Symptoms
- Dashboard (garment-glow-test) não funciona / não carrega dados.
- Sessão anterior relatou "o banco colapsou".

## Root Cause (CONFIRMADO)
O disco do Supabase do dashboard (`ckcdevcxgvueywivefgx` — "Marketplace Analytics Pro - Dev")
encheu 100%. O Postgres não consegue nem iniciar:

```
FATAL: could not write to file "pg_wal/xlogtemp.NNNNN": No space left on device
LOG:   startup process exited with exit code 1
LOG:   shutting down due to startup process failure
LOG:   database system is shut down
```

Isso se repete em loop (crash loop) a cada ~5s. Consequência em cascata:
- API REST responde **503** em tudo (ex.: `/rest/v1/rpc/get_ml_webhook_secret` → 503 contínuo).
- Frontend não recebe dados → dashboard "quebrado".

## Evidence
- `get_logs postgres` → dezenas de `No space left on device` em pg_wal, crash loop.
- `get_logs api` → torrente de `503` em todas as rotas RPC.
- `execute_sql` (2026-07-10, ao vivo) → `ECONNREFUSED ...:5432` → banco **ainda caído agora**.
- `get_advisors` → também falha com ECONNREFUSED (control plane não conecta no DB).
- `list_projects` → status `ACTIVE_HEALTHY` (control plane atrasado; não reflete o crash).
- `get_organization eyywycmyzmstvxclolxk` → **plano `free`**.

## Por que encheu
Org no plano **free** do Supabase (disco fixo, sem auto-scale). Os syncs contínuos
(orders, faturamento ML diário `ml_billing_daily`, backfills de claims/orders) acumularam
dados até estourar o volume.

## Fix (bloqueado — exige ação de billing do Wesley)
No plano free NÃO é possível, via ferramentas/MCP:
- Rodar SQL de limpeza → banco não aceita conexão nenhuma.
- Aumentar disco → é add-on pago (só no Pro), exige billing na conta do Wesley.

Caminho de recuperação recomendado:
1. Upgrade da org para **Pro** (~US$25/mês) no dashboard Supabase (Settings → Billing).
   → disco cresce + auto-scale → Postgres consegue bootar.
2. Assim que bootar: `VACUUM FULL` / limpar/rotacionar dados antigos (ml_billing histórico,
   logs, backfills) para reduzir uso.
3. Definir retenção/rotação para não reestourar (dev em free é frágil p/ esse volume).

## Next action
Aguardando decisão do Wesley sobre upgrade Pro (custo + billing).
