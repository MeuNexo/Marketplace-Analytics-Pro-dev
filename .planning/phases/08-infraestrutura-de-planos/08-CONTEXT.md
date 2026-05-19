# Phase 8: Infraestrutura de Planos - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Criar as tabelas de controle de planos (`organization_plans`) e quotas diárias (`sync_quota_daily`) no banco de dados Supabase, com RLS adequado, e executar o seed que garante que todas as organizações existentes tenham um plano enterprise configurado.

Entrega: somente infraestrutura SQL — 2 migrations e RLS. Sem UI, sem frontend, sem edge functions.

</domain>

<decisions>
## Implementation Decisions

### RLS — organization_plans
- **D-01:** SELECT aberto para todos os membros da organização (`is_org_member(auth.uid(), organization_id)`)
- **D-02:** INSERT e UPDATE permitidos para owner (`get_org_role(auth.uid(), organization_id) = 'owner'`)
- **Rationale:** Frontend futuro precisará ler tier e sync_interval para exibir status de sync. Owner poderá eventualmente alterar plano via tela de upgrade.

### RLS — sync_quota_daily
- **D-03:** SELECT aberto para membros da organização (`is_org_member(auth.uid(), organization_id)`)
- **D-04:** INSERT e UPDATE somente via service_role (edge functions). Nenhuma política de escrita para authenticated — tabela é interna ao backend.
- **Rationale:** Usuários podem consultar o contador de quota para debug/status; escrita é responsabilidade exclusiva das edge functions.

### Estrutura de migrations
- **D-05:** 2 arquivos de migration separados:
  - Migration 1 (schema): cria ambas as tabelas (`organization_plans` + `sync_quota_daily`) + ENUM + RLS em um único arquivo
  - Migration 2 (seed): `INSERT INTO organization_plans ... ON CONFLICT DO NOTHING` para orgs existentes
- **Rationale:** Schema DDL e dados de seed têm ciclos de vida diferentes; separar facilita rollback granular e leitura no histórico.

### Tipo do plan_tier
- **D-06:** `CREATE TYPE public.plan_tier AS ENUM ('free', 'starter', 'pro', 'enterprise')` — PG ENUM público
- **Rationale:** Consistente com o padrão `public.tax_regime` já adotado no projeto. Valores fixos conhecidos justificam enum.

### Claude's Discretion
- Nomes dos arquivos de migration (timestamp + slug descritivo — seguir convenção do projeto)
- Índices adicionais em `organization_plans` se necessário para performance
- DELETE policy (pode ser service_role only ou omitida — não especificado)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos da fase
- `.planning/REQUIREMENTS.md` — PLANS-01, PLANS-02, PLANS-04 definem campo a campo as duas tabelas e o comportamento do seed

### Padrões de migration existentes
- `supabase/migrations/20260515120000_ml_tax_config.sql` — referência de como criar ENUM público, tabela com RLS, usando `is_org_member()` e `get_org_role()`
- `supabase/migrations/20260515200000_commercial_analysis_snapshots.sql` — referência de migration com tabela + índices + RLS

### Contexto do projeto
- `.planning/STATE.md` — decisões de arquitetura v3.0 (dispatcher, Postgres como fila, idempotência)
- `.planning/ROADMAP.md` — seção Phase 8 com success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public.is_org_member(uid, org_id)` — função RLS para check de membership, usada em todas as tabelas existentes
- `public.get_org_role(uid, org_id)` — função RLS para check de role, usada em ml_tax_config para owner-only

### Established Patterns
- Toda tabela com `organization_id` tem RLS habilitado e usa `is_org_member` para SELECT
- Tabelas com operações sensíveis usam `get_org_role(...) = 'owner'` para INSERT/UPDATE
- PG ENUMs criados como `public.{nome}` (namespace público)
- Migrations com seções comentadas: `-- ─── Enum ───`, `-- ─── Table ───`, `-- ─── Indexes ───`, `-- ─── RLS ───`

### Integration Points
- `organization_plans.organization_id` referencia `public.organizations(id) ON DELETE CASCADE`
- `sync_quota_daily.organization_id` referencia `public.organizations(id) ON DELETE CASCADE`
- O seed usa `SELECT id FROM organizations` para popular planos de todas as orgs existentes

</code_context>

<specifics>
## Specific Ideas

- Seed idempotente: `INSERT INTO organization_plans (organization_id, plan_tier, sync_interval_minutes, history_days) SELECT id, 'enterprise', -1, -1 FROM public.organizations WHERE id NOT IN (SELECT organization_id FROM organization_plans)`  
  **ou** a variante `ON CONFLICT (organization_id) DO NOTHING` — ambas são aceitáveis; a segunda é mais idiomática.
- `sync_interval_minutes = -1` e `history_days = -1` representam "ilimitado" para plano enterprise (conforme REQUIREMENTS.md)

</specifics>

<deferred>
## Deferred Ideas

- UI de gerenciamento de planos (upgrade/downgrade) — alocado para v3.1 conforme Out of Scope do milestone
- Hook React `useOrganizationPlan` para leitura do tier no frontend — necessário na Fase 11, não na Fase 8

</deferred>

---

*Phase: 8-infraestrutura-de-planos*
*Context gathered: 2026-05-19*
