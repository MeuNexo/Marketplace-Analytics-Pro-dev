# Requirements — v3.0 Sync Engine & Arquitetura DB-First

## Milestone Goal

Eliminar todas as consultas diretas à API do ML durante a navegação do usuário.
Sync automático agendado (pg_cron) abastece o banco de madrugada; o front-end lê
apenas o banco. Base de infraestrutura preparada para controle de planos e quotas
por assinatura no próximo milestone.

---

## Active Requirements — v3.0

### SYNC — Job Queue & Dispatcher por Intervalo

- [ ] **SYNC-01**: Sistema possui tabela `sync_jobs` com campos: `id`, `organization_id`, `ml_user_id`, `job_type` (daily_cache | orders | inventory), `date_from`, `date_to`, `status` (pending | running | completed | failed), `retries`, `error_msg`, `started_at`, `finished_at`, `created_at`
- [ ] **SYNC-02**: Edge function `process-sync-job` pega o próximo job `pending` da fila (ORDER BY created_at), executa o sync correspondente ao `job_type`, atualiza status para `completed` ou `failed` com `finished_at`; não executa diretamente — só consome jobs criados pelo dispatcher
- [ ] **SYNC-03**: Jobs com status `failed` e `retries < 3` são reinseridos como `pending` pelo pg_cron watchdog com backoff de 5/15/30 minutos entre tentativas
- [ ] **SYNC-04**: Função SQL `dispatch_sync_jobs()` — para cada `(organization_id, ml_user_id, job_type)` ativo, verifica se o último job `completed` tem `finished_at + sync_interval_minutes <= NOW()`; se vencido e sem job `pending`/`running` em aberto para o par, insere um novo job `pending` na fila
- [ ] **SYNC-05**: pg_cron executa `SELECT dispatch_sync_jobs()` a cada 30 minutos (cobre qualquer intervalo ≥ 30 min; near-realtime futuro reduz para 5 min)
- [ ] **SYNC-06**: pg_cron invoca a edge function `process-sync-job` via `pg_net.http_post` a cada 5 minutos para drenar a fila de jobs pendentes
- [ ] **SYNC-07**: `dispatch_sync_jobs()` nunca cria job duplicado para um par `(organization_id, ml_user_id, job_type)` que já tenha job com status `pending` ou `running`

### INV — Inventory Cache (DB-First)

- [ ] **INV-01**: Sistema possui tabela `ml_inventory_cache` com campos: `id`, `organization_id`, `ml_user_id`, `item_id`, `title`, `price`, `available_quantity`, `thumbnail`, `listing_type`, `status`, `sold_quantity`, `synced_at`; constraint UNIQUE em `(organization_id, ml_user_id, item_id)`
- [ ] **INV-02**: Edge function `sync-ml-inventory` busca o inventário completo da ML API (paginada) e salva/atualiza `ml_inventory_cache` via upsert atômico
- [ ] **INV-03**: pg_cron executa sync de inventário diariamente às 04:00 BRT para todas as organizações com `ml_tokens` ativos
- [ ] **INV-04**: `MLInventoryContext` lê de `ml_inventory_cache` via query Supabase em vez de invocar a edge function `ml-inventory` a cada carregamento de página
- [ ] **INV-05**: Tela Estoque (`MLEstoque`) e tela Anúncios (`MLAnuncios`) consomem dados de `ml_inventory_cache` sem nenhuma chamada live à ML API durante a navegação

### PLANS — Infraestrutura de Planos (tabelas + quota check)

- [ ] **PLANS-01**: Sistema possui tabela `organization_plans` com campos: `organization_id` (PK), `plan_tier` (free | starter | pro | enterprise), `sync_interval_minutes` (int: 1440=free, 720=starter, 180=pro, 60=enterprise; -1=unlimited/custom), `history_days` (int, -1 = unlimited), `created_at`, `updated_at`
- [ ] **PLANS-02**: Sistema possui tabela `sync_quota_daily` com campos: `organization_id`, `date` (date), `sync_count` (int default 0); PRIMARY KEY em `(organization_id, date)`
- [ ] **PLANS-03**: Edge functions de sync verificam quota antes de executar: se `sync_count >= sync_limit_daily` (e `sync_limit_daily != -1`), retornam erro 429 com `{ error: "sync_limit_reached", resets_at: "tomorrow" }`; em caso de sucesso, incrementam `sync_count` atomicamente
- [ ] **PLANS-04**: Migration seed insere registro `organization_plans` com `plan_tier = 'enterprise'` e limites `-1` (unlimited) para todas as organizações existentes que ainda não possuem plano configurado

---

## Future Requirements — v3.0 (deferred)

- Painel de status de sync no app (último sync, próximo sync, status OK/falha)
- Sync de Publicidade (anúncios ML Ads) automático
- Sync de Reputação e Perguntas (atualmente mock)
- Sync a cada 4h para inventário (freqüência maior)
- UI de gerenciamento de planos e limites para owners
- Notificação quando sync falha 3x consecutivas

---

## Out of Scope — v3.0

- **UI de planos** — tabelas e quota check são infraestrutura; tela de upgrade/downgrade fica no v3.1
- **Webhooks da ML API** — a ML não oferece webhooks confiáveis para BR; pg_cron cobre o caso
- **Redis/BullMQ para filas** — volume atual (< 100 orgs) não justifica infra adicional; Postgres é suficiente
- **Sync em tempo real** — requisito futuro; modelo scheduled cobre o SLA adequado para analytics
- **Migração de dados históricos antigos** — orders e daily_cache já existentes não são retroativamente normalizados

---

## Traceability — v3.0

| Requirement | Phase | Plan |
|---|---|---|
| SYNC-01 | TBD | TBD |
| SYNC-02 | TBD | TBD |
| SYNC-03 | TBD | TBD |
| SYNC-04 | TBD | TBD |
| SYNC-05 | TBD | TBD |
| SYNC-06 | TBD | TBD |
| SYNC-07 | TBD | TBD |
| INV-01 | TBD | TBD |
| INV-02 | TBD | TBD |
| INV-03 | TBD | TBD |
| INV-04 | TBD | TBD |
| INV-05 | TBD | TBD |
| PLANS-01 | TBD | TBD |
| PLANS-02 | TBD | TBD |
| PLANS-03 | TBD | TBD |
| PLANS-04 | TBD | TBD |
