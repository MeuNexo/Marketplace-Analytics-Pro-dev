# Phase 43: Multi-Tenant Hardening - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Endurecer o sistema para múltiplas organizações operarem isoladas e auto-suficientes: qualquer org nova entra por convite e chega ao dashboard com dados reais **sem passo manual de super-admin além de criar org + convite**.

Entrega: RLS org-first consolidada, dados órfãos resolvidos, enforcement de quota de sync por tier, wizard de onboarding guiado (não-bloqueante) e correção dos deferidos de segurança ME-04/05/06 da Phase 41.

**Supabase project correto: `ckcdevcxgvueywivefgx`** (o `gionpsuunfkkzzjdubfy` citado no CLAUDE.md está desatualizado — NÃO usar).

**Fora de escopo (vão para outras fases):** Stripe/Checkout/tiers pagos (Phase 44 — PAY), enforcement de `history_days` e nº de lojas por tier (Phase 44, alinhado a billing), self-service signup público (v8.0).
</domain>

<decisions>
## Implementation Decisions

### Dados órfãos (TENANT-02)
- **D-01:** Estratégia **híbrida** por tipo de tabela. Caches **regeneráveis** (vendas/ads diários — o sync recria) com `organization_id` NULL → **DELETE**. Config **não-regenerável** (ex: `ml_product_costs`, configuração fiscal/tax) → **BACKFILL** para a org Pé Vermeio. O planner define a matriz exata por tabela com base nas contagens reais (via MCP).
- **D-02:** Backfill resolve `organization_id` **via `ml_tokens`** (ml_user_id → org), NÃO via `organization_members` — `organization_members` duplica quando um user pertence a 2 orgs.
- **D-03:** Após resolver órfãos, tornar `organization_id` NOT NULL onde for seguro e adicionar guard nas EFs para nunca mais gravar NULL.

### Enforcement de quota de sync (TENANT-03)
- **D-04:** Ao exceder a quota, **bloquear no dispatch + registrar no log** (não dispara o sync). `check_quota` roda ANTES de iniciar. Tier `enterprise` (sync_interval_minutes=-1, history_days=-1) **nunca** bloqueia.
- **D-05:** Escopo do enforcement na Phase 43 = **apenas sync**: `sync_interval_minutes` + contagem diária (`sync_quota_daily`). `history_days` e nº de lojas ML ficam para a Phase 44 (alinhado a billing/PAY-04) — não duplicar.
- **D-06:** Reusar o padrão já existente `checkAndIncrementQuota()` de `supabase/functions/sync-ml-inventory/index.ts` como base do RPC `check_quota` / da lógica de dispatch. As tabelas (`organization_plans`, `sync_quota_daily`) já existem — não recriar.

### Wizard de onboarding (TENANT-04)
- **D-07:** **Não-bloqueante.** Card/banner de progresso no topo do dashboard + CTA nos empty states. Owner navega livre, mas é guiado. Sem route-guard que trave o app.
- **D-08:** Passos: **Conectar ML → Tiny (opcional) → Custos → Fiscal → Pronto**. Progresso persistido entre sessões em **nova tabela `onboarding_progress`** (escopo organization_id).
- **D-09:** Hand-roll com `react-hook-form` + shadcn/ui — **sem novas dependências** (CLAUDE.md proíbe). Biblioteca OnboardJS avaliada na pesquisa e descartada por isso.

### RLS org-first (TENANT-01)
- **D-10:** Policies de `ml_product_costs` passam a usar **`organization_id` via `is_org_member`**; `user_id` mantido como **coluna de auditoria** (não como scope de RLS). Service role faz upsert para qualquer org (já ignora RLS).
- **D-11:** Existem **duas migrations conflitantes** de RLS em `ml_product_costs` (a antiga `auth.uid()=user_id FOR ALL` + uma org-aware). Consolidar numa policy org-first única. Ajustar `useMLProductCosts.fetchAll` que hoje lê só por `user_id` → ler por org.
- **D-12:** Backfillar `organization_id` em `ml_product_costs` (via D-02) antes de apertar a policy.

### Segurança — deferidos da Phase 41 (ME-04/05/06)
- **D-13:** **ME-04** (lookup `ml_tokens` não-determinístico): o lookup `.eq(ml_user_id).limit(1)` sem `ORDER BY` é não-determinístico cross-tenant. Adicionar ordenação determinística (ex: por `created_at`/escopo org) ao selecionar o token.
- **D-14:** **ME-05** (enumeração de `ml_user_id`): aplicar o guard `is_org_member` nas EFs `ml-ads` e `ml-reputation` — o mesmo que `ml-inventory` já tem. Sem o guard, um membro de uma org pode consultar dados de outra via `ml_user_id`.
- **D-15:** **ME-06** (RLS viewer em billing): `ml_billing_monthly` usa policy `FOR ALL` → viewer consegue INSERT/UPDATE/DELETE em billing. Trocar por `FOR SELECT` (leitura apenas); escrita exclusiva de service role.

### Validação de isolamento (TENANT-05)
- **D-16:** Teste manual com 2 orgs em paralelo confirmando que dados de uma não aparecem na outra (RLS + caches + queries do frontend). O planner define o roteiro de teste.

### Claude's Discretion
- Matriz exata delete-vs-backfill por tabela (D-01) — planner decide caso a caso pelas contagens reais.
- Forma do RPC `check_quota` (RPC SQL puro vs lógica inline na EF de dispatch) — desde que bloqueie no dispatch e logue (D-04).
- Layout visual do banner/wizard (segue tokens existentes + UI-SPEC se gerado).

### Pré-requisito de planejamento (MCP)
- O planner DEVE confirmar o estado **real** do banco via Supabase MCP no projeto `ckcdevcxgvueywivefgx` ANTES de finalizar as tasks:
  1. `pg_policies` de `ml_product_costs` e `ml_billing_monthly` (quais policies realmente existem)
  2. Contagens de linhas órfãs (`organization_id IS NULL`) por tabela de cache
  3. `cron.job` — **pitfall:** o pg_cron de `20260519140000_sync_jobs.sql` embute a URL do projeto ERRADO (`gionpsuunfkkzzjdubfy`) + JWT legado. Verificar e recriar Pattern B (vault com `SERVICE_ROLE_KEY` = chave nova `sb_secret_`, não JWT legacy).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pesquisa e roadmap desta fase
- `.planning/phases/43-multi-tenant-hardening/43-RESEARCH.md` — inventário técnico completo, root-cause de ME-04/05/06, pitfalls de infra, padrões existentes
- `.planning/ROADMAP.md` §"Phase 43: Multi-Tenant Hardening" — goal + success criteria
- `.planning/REQUIREMENTS.md` — TENANT-01..05 (linhas 33-37)
- `.planning/STATE.md` — deferidos ME-04/05/06 da Phase 41; aprendizados de domínio (sb_secret_ vault, project id correto)

### Quota (infra existente — reusar, não recriar)
- `supabase/migrations/20260519120000_organization_plans_quota.sql` — tabelas `organization_plans`, `sync_quota_daily`, enum `plan_tier`
- `supabase/migrations/20260519130000_seed_enterprise_plans.sql` — seed enterprise (-1 ilimitado)
- `supabase/migrations/20260519140000_sync_jobs.sql` — pg_cron de dispatch (⚠ contém project id ERRADO — recriar)
- `supabase/functions/sync-ml-inventory/index.ts` — `checkAndIncrementQuota()` = padrão de referência para `check_quota`

### RLS / escopo
- `supabase/migrations/20260514120000_ml_product_costs.sql` — RLS antiga `auth.uid()=user_id` (a corrigir)
- `src/hooks/useMLProductCosts.ts` — `fetchAll` lê por user_id (ajustar para org)
- `src/contexts/OrganizationContext.tsx` — modelo de escopo org + roles
- `/root/nexo-mcp/` — padrões de RLS/sync/EF já validados que podem ser portados

### Segurança (deferidos Phase 41)
- `supabase/functions/ml-ads/`, `supabase/functions/ml-reputation/` — faltam guard `is_org_member` (ME-05)
- `supabase/functions/ml-inventory/` — guard `is_org_member` de referência
- migration de `ml_billing_monthly` — policy `FOR ALL` a trocar por `FOR SELECT` (ME-06)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkAndIncrementQuota()` em `sync-ml-inventory/index.ts` — base direta do enforcement de quota (TENANT-03)
- Guard `is_org_member` já usado em `ml-inventory` — replicar em `ml-ads`/`ml-reputation` (ME-05)
- `RoleRoute` / `is_org_member` / `get_org_role` (SQL) — base para policies org-first e gating do wizard
- shadcn/ui + react-hook-form já no projeto — base do wizard sem novas deps

### Established Patterns
- Escopo de dados: sempre `organization_id` + `ml_user_id` (não apenas seller_id)
- pg_cron Pattern B: vault guarda `SERVICE_ROLE_KEY` = chave nova `sb_secret_` (não JWT legacy)
- Migrations via MCP `apply_migration` no `ckcdevcxgvueywivefgx` (CLI local linkado no projeto errado — não usar `db push`)
- Service role ignora RLS — upserts de EF já escrevem livre; o gap é a policy do role `authenticated`

### Integration Points
- Wizard: novo `onboarding_progress` + componente no topo do dashboard (`/`) + CTAs em empty states existentes
- Quota: injeção no dispatch (pg_cron job / EF de dispatch) antes de chamar as EFs de sync
- RLS: migration consolidada + ajuste de leitura no frontend (`useMLProductCosts`)
</code_context>

<specifics>
## Specific Ideas

- Tier `enterprise` (-1) é o estado atual de todas as orgs (seed) — enforcement de quota não deve afetar a operação atual da Pé Vermeio; só morde tiers menores (futuros).
- Backfill via `ml_tokens` é decisão explícita para evitar duplicação em users multi-org.
- "Híbrido órfãos": preferir delete para o que o sync recria — mantém o banco limpo sem perder dado real.
</specifics>

<deferred>
## Deferred Ideas

- Enforcement de `history_days` por tier e limite de nº de lojas ML — **Phase 44 (PAY-04)**, alinhado a billing
- Stripe Checkout / webhooks / /planos / tiers pagos — **Phase 44**
- Self-service signup público — **v8.0**
- Consultor v1 (score de saúde, insights) — **Phase 45**

None além dos acima — discussão ficou dentro do escopo da fase.
</deferred>

---

*Phase: 43-multi-tenant-hardening*
*Context gathered: 2026-06-13*
