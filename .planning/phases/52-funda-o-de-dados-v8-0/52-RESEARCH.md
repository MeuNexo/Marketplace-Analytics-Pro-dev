# Phase 52: Fundação de Dados v8.0 — Research

**Researched:** 2026-06-24
**Domain:** Schema Postgres multi-tenant (Supabase) — tabelas + RPCs + RLS org-first + state-machine de ações, sobre o Consultor v1 em produção
**Confidence:** HIGH (todo o DDL e os padrões derivam de inspeção direta do código real do projeto; o milestone-level research `.planning/research/` é HIGH e já especificou as decisões de modelo)

---

## Overview

Phase 52 é uma fase de **dados pura** (migrations + RPCs + regeneração de `types.ts`). Não há UI nem Edge Functions novas nesta fase — ela apenas cria o schema e o gate atômico que as fases 53–56 consomem. **Bloqueia 53–56.**

O que a fase entrega, mapeado aos 6 Success Criteria do ROADMAP (linhas 32–37):

| SC | Entrega | Status no codebase |
|----|---------|--------------------|
| 1 | `llm_analysis_cache` (org-first, 1 linha/org/dia) + RLS | **NOVA** |
| 2 | `proposed_actions` (state-machine 6 estados) + índice dedup parcial | **NOVA** |
| 3 | `action_audit_log` append-only/imutável + RLS | **NOVA** |
| 4 | `insights.snoozed_until` + `consultor_config` (limiares editáveis já existem; falta `llm_enabled`) | **ALTER** |
| 5 | RPC de transição atômica `UPDATE ... WHERE status='approved' RETURNING *` (SECURITY INVOKER + REVOKE) | **NOVA** |
| 6 | `types.ts` atualizado + migrations aplicadas via MCP + advisors limpos | processo |

**Recomendação primária:** Replicar verbatim os padrões de `20260645000000_consultor_tables.sql` (org-first RLS, `is_org_member`/`get_org_role`, dedup via coluna helper, idempotência DO/EXCEPTION) e de `20260615120100_consultor_config_ads_cols.sql` (ALTER ... ADD COLUMN IF NOT EXISTS). Todo o DDL desta fase já está especificado em `.planning/research/ARCHITECTURE.md` linhas 92–276 — esta pesquisa o valida contra o estado atual do banco e aponta os ajustes finos.

> **ALERTA DE PROJETO (project ID):** O `CLAUDE.md` diz `gionpsuunfkkzzjdubfy`. **Isso está desatualizado.** O projeto Supabase correto para esta plataforma é **`ckcdevcxgvueywivefgx`** (STATE.md:150; ROADMAP linha 9; comentário no topo de `20260645000000_consultor_tables.sql:34`). O Supabase CLI local está linkado no projeto ERRADO — **não usar `db push`**; aplicar migrations via MCP `apply_migration` no `ckcdevcxgvueywivefgx` (STATE.md:98). `[VERIFIED: STATE.md:98,150 + migration comment]`

---

## Phase Requirements

| ID | Descrição | Research Support |
|----|-----------|------------------|
| (base LLM-*) | `llm_analysis_cache` cache por org/dia/prompt_version | Tabela nova abaixo; key org-first valida anti-leak (Pitfall 2) |
| (base ACT-*) | state-machine + audit imutável + gate atômico | `proposed_actions` + `action_audit_log` + RPC de transição |
| (base SNZ-*) | `insights.snoozed_until` server-side por linha | ALTER em `insights` (coluna por-linha, não tabela à parte) |
| (base TUNE-*) | limiares editáveis + `llm_enabled` em `consultor_config` | Limiares já existem; falta `llm_enabled` (e opcionalmente `llm_model`) |
| (base STORE-*) | identificação de loja em insights/snapshots | `insights.ml_user_id`/`ml_user_id_key` **já existem**; `consultor_health_snapshots` precisa de `ml_user_id_key` |

---

## Current Schema (estado real verificado)

### `insights` — `supabase/migrations/20260645000000_consultor_tables.sql:41-114`

Colunas atuais (confirmadas em migration **e** em `src/integrations/supabase/types.ts:238-296`):

```
id uuid PK, organization_id uuid NOT NULL FK→organizations,
ml_user_id text NULL,                 -- JÁ EXISTE (SC-4 "store ref" parcialmente satisfeito)
ml_user_id_key text NOT NULL DEFAULT '',  -- JÁ EXISTE (coluna helper de dedup)
rule_key text, category text, severity text, title text, body text,
action_label text, action_href text, impact_brl numeric NULL,
status text NOT NULL DEFAULT 'active',
created_at, updated_at, resolved_at NULL, dismissed_at NULL
```

- CHECK `severity IN ('critical','high','medium')` (linha 64-70)
- CHECK `status IN ('active','resolved','dismissed')` (linha 73-79)
- UNIQUE dedup `insights_dedup_idx (organization_id, rule_key, ml_user_id_key)` (linha 83-84)
- Index `insights_org_status_idx (organization_id, status, severity)` (linha 87-88)
- RLS: `insights_select` (membro lê) + `insights_dismiss` (membro UPDATE). INSERT/DELETE = service role only.

**O que falta para Phase 52:**
- `snoozed_until timestamptz NULL` — **NOVO** (SC-4, SNZ-02). A policy `insights_dismiss` (UPDATE para qualquer membro) **já cobre** a escrita de snooze — nenhuma mudança de RLS necessária. `[VERIFIED: migration:104-111]`
- `snooze_count int NOT NULL DEFAULT 0` — opcional (ARCHITECTURE.md:186 sugere; não está nos Success Criteria — tratar como discricionário).
- **Identificação de loja: já satisfeita** por `ml_user_id` + `ml_user_id_key`. O planner NÃO precisa adicionar coluna de loja em `insights`. `[VERIFIED: types.ts:248-249]`

### `consultor_config` — `20260645000000_consultor_tables.sql:125-169` + `20260615120100_consultor_config_ads_cols.sql`

PK = `organization_id` (1 linha por org). Limiares editáveis **já existem** (todos `numeric/integer NOT NULL DEFAULT`):

```
margin_critical_pct=0, margin_alert_pct=10,
tacos_alert_pct=15, acos_alert_pct=30, roas_min=3, ads_no_sale_days=7,
stock_critical_days=7, stock_alert_days=15,
ticket_drop_pct=10, claims_spike_pct=20, goal_risk_pct=10,
paused_ads_lookback_days=30, updated_at,
ads_eating_critical_pct=0, ads_eating_alert_pct=10   -- (migration 20260615120100)
```

- RLS: `consultor_config_select` (membro lê) + `consultor_config_write` (FOR ALL, **owner only** via `get_org_role(...)='owner'::org_role`). `[VERIFIED: migration:157-169]`

**O que falta para Phase 52:**
- `llm_enabled boolean NOT NULL DEFAULT true` — **NOVO** (SC-4, LLM-07 kill-switch).
- `llm_model text NOT NULL DEFAULT 'claude-haiku-4-5'` — opcional (ARCHITECTURE.md:215; permite upgrade a Sonnet por org). Recomendado incluir agora pois é barato e a fase 53 já o consome.
- **Limiares editáveis "novos": NÃO precisam ser criados** — os 14 limiares já existem. O que muda na fase 56 é a UI poder escrevê-los; a policy owner-only já permite. O planner deve confirmar se TUNE-01 (margem alvo, TACoS alvo, dias cobertura) mapeia 1:1 aos limiares existentes — **mapeia** (`margin_alert_pct`, `tacos_alert_pct`, `stock_alert_days`). Ver Open Questions Q1.

### `consultor_health_snapshots` — `20260645000000_consultor_tables.sql:180-214`

```
id uuid PK, organization_id uuid NOT NULL FK, score int,
score_margin/ads/estoque/reputacao/completude int DEFAULT 0,
insights_total/insights_critical int DEFAULT 0,
snapshot_month char(7) NOT NULL,  -- 'YYYY-MM'
CONSTRAINT snapshots_org_month UNIQUE (organization_id, snapshot_month)
```

- RLS: `snapshots_select` (membro lê). INSERT/UPDATE = service role only.

**O que falta (para suportar STORE-01..04 na fase 55, mas a coluna é fundação — incluir na 52):**
- `ml_user_id_key text NOT NULL DEFAULT ''` — **NOVO** (mesmo padrão de `insights`).
- Trocar UNIQUE `(organization_id, snapshot_month)` → `(organization_id, ml_user_id_key, snapshot_month)`. **Ponto de atenção:** ver Pitfall 3 (DROP/ADD constraint não-idempotente se feito ingênuo).

---

## Migration Plan

Convenção de nomenclatura (verificada): timestamp `YYYYMMDDHHMMSS_descricao.sql`. Migrations consultor v1 usam o bloco `20260645*`. As de tesouraria/phase 51 já avançaram para `20260650*`. **A última migration no diretório é `20260650000400_phase47_security_hardening.sql`.** Phase 52 deve usar um prefixo que ordene **depois** desta — recomendado **`20260652*`** (ou `20260655*` para folga). `[VERIFIED: ls supabase/migrations | tail]`

Sugestão de divisão (1 plano de migration por arquivo, igual ao padrão consultor v1 que separou tables / rpcs / revoke / cron):

| # | Arquivo sugerido | Conteúdo | Padrão a replicar |
|---|------------------|----------|-------------------|
| M1 | `20260652000000_v8_action_tables.sql` | `proposed_actions` + `action_audit_log` (CREATE TABLE IF NOT EXISTS + CHECKs idempotentes + índices + RLS) | `consultor_tables.sql:41-214` |
| M2 | `20260652000100_v8_llm_cache.sql` | `llm_analysis_cache` (org-first UNIQUE + RLS) | `consultor_tables.sql` (tabela 3) |
| M3 | `20260652000200_v8_alter_existing.sql` | ALTERs: `insights.snoozed_until`; `consultor_config.llm_enabled`(+`llm_model`); `consultor_health_snapshots.ml_user_id_key` + troca de UNIQUE | `consultor_config_ads_cols.sql` (ALTER pattern) |
| M4 | `20260652000300_v8_action_transition_rpc.sql` | RPC `claim_approved_action()` (SECURITY INVOKER) + `REVOKE EXECUTE ... FROM PUBLIC, anon` | `margin_with_ads_rpc.sql` (INVOKER) + `consultor_rpcs_revoke_public_execute.sql` (REVOKE) |

> **Pitfall observado:** Cada migration deve ser **idempotente e re-entrant** — `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, CHECK via `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`, índices via `CREATE ... IF NOT EXISTS`. Isto é o que `consultor_tables.sql` faz (linhas 64-79, 92-95, 151-154) e o que o orquestrador re-aplica via MCP sem medo de duplicar. `[VERIFIED: migration pattern]`

### DDL: `proposed_actions` (M1)

Replicar verbatim `ARCHITECTURE.md:96-134`. Pontos críticos a NÃO perder:

```sql
CREATE TABLE IF NOT EXISTS public.proposed_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id text NULL,
  insight_id uuid NULL REFERENCES public.insights(id) ON DELETE SET NULL,
  rule_key text NOT NULL,
  action_type text NOT NULL,
  target_ref text NOT NULL,
  current_value jsonb NULL,
  proposed_value jsonb NOT NULL,
  estimated_impact_brl numeric NULL,
  status text NOT NULL DEFAULT 'proposed',
  proposed_by uuid NOT NULL,
  approved_by uuid NULL, approved_at timestamptz NULL,
  executed_at timestamptz NULL,
  result_summary text NULL,
  dry_run_preview jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- CHECK status (6 estados) e CHECK action_type via DO/EXCEPTION (idempotente)
-- status IN ('proposed','approved','rejected','executing','done','failed')
-- action_type IN ('update_price','pause_ads_campaign','update_ads_budget','activate_listing','pause_listing')

-- DEDUP PARCIAL (SC-2) — uma ação aberta por (org, rule_key, target_ref):
CREATE UNIQUE INDEX IF NOT EXISTS proposed_actions_open_dedup
  ON public.proposed_actions (organization_id, rule_key, target_ref)
  WHERE status IN ('proposed','approved','executing');

CREATE INDEX IF NOT EXISTS proposed_actions_org_status_idx
  ON public.proposed_actions (organization_id, status, created_at DESC);
```

Audit columns (`approved_by`, `approved_at`, `executed_at`, `result_summary`) **devem entrar já agora**, não em patch posterior (PITFALLS Pitfall 6). `[CITED: ARCHITECTURE.md:96-134; PITFALLS:115-135]`

### DDL: `action_audit_log` (M1) — ver "Immutability" abaixo

### DDL: `llm_analysis_cache` (M2)

A coluna `organization_id` **deve ser a primeira** no UNIQUE (anti cross-tenant leak, Pitfall 2). Os Success Criteria pedem PK org-first `(organization_id, analysis_date, prompt_version)` — **note a divergência com ARCHITECTURE.md** que usa `UNIQUE (organization_id, analysis_date)` + coluna `prompt_hash`. Ver Open Questions Q2.

```sql
CREATE TABLE IF NOT EXISTS public.llm_analysis_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  analysis_date date NOT NULL,
  prompt_version text NOT NULL DEFAULT 'v1',   -- SC-1 pede esta coluna na key
  model_used text NOT NULL,
  prompt_hash text NULL,                        -- staleness check (LLM-06)
  analysis_text text NOT NULL,
  insight_count int NOT NULL DEFAULT 0,
  tokens_used int NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_cache_org_date_version UNIQUE (organization_id, analysis_date, prompt_version)
);
CREATE INDEX IF NOT EXISTS llm_cache_org_date_idx
  ON public.llm_analysis_cache (organization_id, analysis_date DESC);
```

`prompt_version` na key é o que SC-1 exige; isola caches quando o system prompt da fase 53 mudar (sem invalidar tudo). `[CITED: ROADMAP SC-1 linha 32; SUMMARY:31]`

### DDL: ALTERs (M3)

```sql
-- insights: snooze por-linha (cobertura RLS via insights_dismiss já existe)
ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS snooze_count  int NOT NULL DEFAULT 0;

-- consultor_config: kill-switch LLM (policy owner-only já cobre escrita)
ALTER TABLE public.consultor_config
  ADD COLUMN IF NOT EXISTS llm_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS llm_model   text    NOT NULL DEFAULT 'claude-haiku-4-5';

-- snapshots: suporte por-loja + troca de UNIQUE (idempotente — ver Pitfall 3)
ALTER TABLE public.consultor_health_snapshots
  ADD COLUMN IF NOT EXISTS ml_user_id_key text NOT NULL DEFAULT '';
ALTER TABLE public.consultor_health_snapshots
  DROP CONSTRAINT IF EXISTS snapshots_org_month;
DO $$ BEGIN
  ALTER TABLE public.consultor_health_snapshots
    ADD CONSTRAINT snapshots_org_store_month
    UNIQUE (organization_id, ml_user_id_key, snapshot_month);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

`[CITED: ARCHITECTURE.md:182-218]`

---

## RLS & Security — padrão a replicar

**Regra de projeto (memória + STATE):** `is_org_member(auth.uid(), organization_id)` para SELECT; `get_org_role(...)='owner'::org_role` para escrita restrita. Assinaturas reais (SECURITY DEFINER, STABLE, `SET search_path=public`):

- `public.is_org_member(_user_id uuid, _org_id uuid) → boolean` `[VERIFIED: 20260414200325...:29-40]`
- `public.get_org_role(_user_id uuid, _org_id uuid) → org_role` `[VERIFIED: 20260414200325...:43-53]`
- enum `public.org_role = ('owner','admin','member')` `[VERIFIED: 20260414200325...:2]`

> **Importante:** `is_org_member`/`get_org_role` são `SECURITY DEFINER` **de propósito** — são helpers que leem `organization_members`; não é o mesmo caso que uma RPC de negócio. A regra "tenant RPC = SECURITY INVOKER" (`feedback_supabase_security_invoker.md`) aplica-se às **RPCs de dados de negócio** (que retornam linhas de tabelas com RLS), não a estes helpers de membership.

Bloco de policy representativo para tabela nova org-first (copiar de `consultor_tables.sql:90-114`):

```sql
ALTER TABLE public.proposed_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_select" ON public.proposed_actions';
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_insert" ON public.proposed_actions';
  EXECUTE 'DROP POLICY IF EXISTS "proposed_actions_update" ON public.proposed_actions';
END $$;

-- SELECT: qualquer membro lê as ações da própria org
CREATE POLICY "proposed_actions_select" ON public.proposed_actions
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT: membro propõe; força proposed_by=auth.uid() e status='proposed'
CREATE POLICY "proposed_actions_insert" ON public.proposed_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND proposed_by = auth.uid()
    AND status = 'proposed'
  );

-- UPDATE: OWNER only; só pode mover para 'approved' ou 'rejected'.
-- executing/done/failed ficam EXCLUSIVAMENTE no executor via service_role.
CREATE POLICY "proposed_actions_update" ON public.proposed_actions
  FOR UPDATE TO authenticated
  USING  (public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role)
  WITH CHECK (
    public.get_org_role(auth.uid(), organization_id) = 'owner'::public.org_role
    AND status IN ('approved','rejected')
  );
```

`action_audit_log` e `llm_analysis_cache`: somente policy de SELECT (`is_org_member`); INSERT/UPDATE via service_role (que ignora RLS). `[CITED: ARCHITECTURE.md:224-276]`

**Anti-pattern de RLS (Anti-Pattern 3, ARCHITECTURE.md:576):** a policy de UPDATE para `authenticated` NUNCA pode permitir `status='executing'/'done'/'failed'` no WITH CHECK — senão um owner forja "done" sem execução real no ML. O WITH CHECK acima restringe a `('approved','rejected')`.

---

## State-machine + transição atômica (SC-2, SC-5)

**Modelagem do status:** usar `text NOT NULL DEFAULT 'proposed'` + **CHECK constraint** (não enum nativo). Razão: é o padrão já usado em `insights.status` (`20260645000000_consultor_tables.sql:73-79`) e em `proposed_actions` no ARCHITECTURE; CHECK é trivialmente alterável por migration (enum exige `ALTER TYPE ... ADD VALUE`, que não roda em transação e é doloroso). `[VERIFIED: insights pattern; CITED: PITFALLS:71]`

Os 6 estados e transições (ARCHITECTURE.md:282-307):

```
proposed --owner approve--> approved --EF claim--> executing --> done | failed
   |                            |
   +--owner reject--> rejected  +--owner reject--> rejected (antes do executor pegar)
```

- `proposed→approved|rejected` e `approved→rejected`: via UPDATE authenticated (owner), gated pela RLS WITH CHECK.
- `approved→executing`: **gate atômico** no executor (fase 54), via service_role.
- `executing→done|failed`: service_role no executor; ou pg_cron sweep marca `executing` órfão (>1h) como `failed`.

**RPC de transição atômica (SC-5)** — a fase 52 entrega a função; a fase 54 a chama. Modelar como SECURITY INVOKER + REVOKE de anon/public:

```sql
-- M4: claim atômico — UPDATE WHERE status='approved' RETURNING * (anti TOCTOU)
CREATE OR REPLACE FUNCTION public.claim_approved_action(p_action_id uuid)
RETURNS public.proposed_actions
LANGUAGE sql
SECURITY INVOKER          -- RLS de proposed_actions enforça escopo de org (anti-IDOR)
SET search_path = public
AS $$
  UPDATE public.proposed_actions
     SET status = 'executing', updated_at = now()
   WHERE id = p_action_id
     AND status = 'approved'
  RETURNING *;
$$;

-- Postgres concede EXECUTE a PUBLIC por padrão → revogar explicitamente:
REVOKE EXECUTE ON FUNCTION public.claim_approved_action(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_approved_action(uuid) TO service_role;
```

Notas:
- **Por que SECURITY INVOKER:** se a RPC corre como INVOKER, a RLS de `proposed_actions` (org-first) restringe automaticamente — mesmo passando um `p_action_id` de outra org, o UPDATE não casa nenhuma linha visível ao caller. Combinado com o REVOKE, só service_role (executor, que ignora RLS mas filtra por org no código) a chama. Isto espelha exatamente o que `20260645011000_consultor_rpcs_revoke_public_execute.sql` faz para as RPCs do v1 (que eram DEFINER e vazavam por default EXECUTE a PUBLIC — detectado por `get_advisors`). `[VERIFIED: 20260645011000...:1-25]`
- **Zero linhas retornadas = já reivindicada** → o executor aborta antes de chamar a API do ML (Pitfall 3). `[CITED: PITFALLS:63-67]`
- **Decisão a registrar:** o gate pode ser ou (a) esta RPC, ou (b) um `UPDATE ... RETURNING` inline no EF com service_role. ARCHITECTURE.md:544-552 mostra a variante inline. Ambas são corretas; SC-5 fala em "RPC de transição atômica" → preferir a RPC nomeada (testável isoladamente, REVOKE explícito). Ver Open Questions Q3.

---

## Immutability do `action_audit_log` (SC-3)

Tabela append-only. **Mecanismo de imutabilidade = ausência de GRANT de UPDATE/DELETE** (não trigger). Em Postgres + Supabase, o caminho `authenticated`/`anon` só pode fazer o que as RLS policies permitem; sem policy de UPDATE/DELETE, esses verbos são negados por default-deny. O service_role ignora RLS, mas o **executor nunca emite UPDATE/DELETE** nesta tabela — só INSERT. Isto é suficiente e é o padrão do projeto (insights/snapshots usam "sem policy = sem acesso").

```sql
CREATE TABLE IF NOT EXISTS public.action_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.proposed_actions(id) ON DELETE CASCADE,
  actor_id uuid NULL,           -- null = transição de sistema/EF
  from_status text NOT NULL,
  to_status   text NOT NULL,
  detail jsonb NULL,            -- resposta ML trimada ≤ ~4KB
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.action_audit_log (action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_org_idx    ON public.action_audit_log (organization_id, created_at DESC);

ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_select" ON public.action_audit_log
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
-- SEM policy de INSERT/UPDATE/DELETE para authenticated → escrita só via service_role.
```

**Cap de 4KB no `detail`:** o ML pode devolver respostas grandes; o executor (fase 54) deve trimar a `detail` antes do INSERT. SC-3 menciona "≤4KB" — a aplicação do cap é responsabilidade do código do executor, não do schema (Postgres jsonb não tem limite de coluna prático). Opcionalmente adicionar CHECK `pg_column_size(detail) <= 4096` se quiser enforce no banco (ver Open Questions Q4). `[CITED: ROADMAP SC-3 linha 34; ARCHITECTURE.md:139-155]`

**Append-only "endurecido" (opcional, defensivo):** se quiser garantia além de ausência-de-grant, um trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` impede mutação mesmo por service_role. Não é exigido pelos Success Criteria; o padrão do projeto não usa isso. Discricionário.

---

## types.ts — abordagem de atualização (SC-6)

`src/integrations/supabase/types.ts` **não é regenerado automaticamente** neste projeto — é editado **manualmente**. Precedente direto: "Phase 18-02: tiny token columns added to types.ts manually (not regenerated from Supabase schema)" `[VERIFIED: STATE.md:143]`. O motivo é o mesmo problema do CLI linkado no projeto errado (`gionpsuunfkkzzjdubfy`) — `supabase gen types` apontaria para o schema errado.

Abordagem para Phase 52:
1. Adicionar manualmente os blocos `Row`/`Insert`/`Update`/`Relationships` para as 3 tabelas novas (`proposed_actions`, `action_audit_log`, `llm_analysis_cache`), seguindo o formato exato dos blocos existentes (ex.: `insights:` em `types.ts:238`, `consultor_config:` em `:120`).
2. Adicionar os campos novos aos blocos existentes: `insights` (+`snoozed_until: string|null`, `snooze_count: number`), `consultor_config` (+`llm_enabled: boolean`, `llm_model: string`), `consultor_health_snapshots` (+`ml_user_id_key: string`).
3. Manter `nullable` correto: colunas `NOT NULL DEFAULT` viram `string`/`number`/`boolean` no `Row` e opcionais (`?`) no `Insert`. Colunas `NULL` viram `| null`.

Não há geração automática a confiar; o planner deve incluir a edição manual de `types.ts` como tarefa explícita com verificação `tsc`/build. `[VERIFIED: STATE.md:143; types.ts structure]`

---

## Como as migrations são aplicadas

- **Aplicação:** via MCP `apply_migration` no project **`ckcdevcxgvueywivefgx`** (NÃO `db push`, NÃO o projeto do CLI). `[VERIFIED: STATE.md:98]`
- **gsd-executor não tem MCP/deploy Supabase** — o orquestrador aplica as migrations e roda os advisors; o executor escreve os arquivos `.sql`. `[VERIFIED: STATE.md:237]`
- **Pós-apply obrigatório:** rodar `get_advisors` (security + performance) e confirmar **nenhum erro crítico novo** (SC-6). Precedente: a Wave 1 do consultor v1 foi pega por `get_advisors` (`anon/authenticated_security_definer_function_executable`) e corrigida com REVOKE (`20260645011000`). `[VERIFIED: 20260645011000...:9-11]`

---

## Pitfalls / Landmines (cite file:line)

### P1 — `organization_id` precisa LIDERAR a key de cache (anti cross-tenant leak)
`llm_analysis_cache` UNIQUE deve começar por `organization_id`. Nunca cache module-level/in-memory na EF (containers Deno quentes compartilham memória). RLS `is_org_member` no SELECT. `[CITED: PITFALLS:32-41 (Pitfall 2); SUMMARY:79]`. Verificação: `EXPLAIN` do SELECT de cache deve usar `organization_id` como coluna líder do índice.

### P2 — `prompt_version` na cache-key (SC-1) diverge do ARCHITECTURE
ARCHITECTURE.md:170 usa `UNIQUE (organization_id, analysis_date)` + coluna `prompt_hash`. **Os Success Criteria (ROADMAP:32) exigem `(organization_id, analysis_date, prompt_version)`.** Seguir os Success Criteria (incluir `prompt_version` na UNIQUE) e manter `prompt_hash` como coluna de staleness adicional. Sem `prompt_version` na key, um bump de prompt na fase 53 invalidaria/colidiria caches de todas as orgs ao mesmo tempo. `[CITED: ROADMAP:32 vs ARCHITECTURE.md:160-171]`. Ver Open Questions Q2.

### P3 — Troca de UNIQUE em `consultor_health_snapshots` não-idempotente
`DROP CONSTRAINT IF EXISTS snapshots_org_month` antes de adicionar `snapshots_org_store_month`, e envolver o ADD em `DO/EXCEPTION WHEN duplicate_object`. Se a migration rodar 2x sem isso, falha. Além disso: **só adicionar a constraint nova depois de garantir que não há linhas duplicadas** sob a nova chave (linhas org-level antigas têm `ml_user_id_key=''` por default — não colidem). `[VERIFIED: padrão em consultor_tables.sql:64-79; CITED: ARCHITECTURE.md:199-205]`

### P4 — Default EXECUTE a PUBLIC nas RPCs (advisor crítico)
Toda função criada concede EXECUTE a PUBLIC por default. A RPC `claim_approved_action` **precisa** de `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT TO service_role`, senão `get_advisors` acusa `anon/authenticated_security_definer_function_executable` (mesmo que seja INVOKER — o default grant é o problema). Precedente exato: `20260645011000_consultor_rpcs_revoke_public_execute.sql:7-25`. `[VERIFIED: 20260645011000...]`

### P5 — Status como CHECK, nunca enum nativo
Modelar `status`/`action_type` como `text` + CHECK idempotente (`DO/EXCEPTION`). Enum nativo (`ALTER TYPE ADD VALUE`) não roda em transação e trava futuras migrations. Espelha `insights.status` (`consultor_tables.sql:73-79`). `[VERIFIED: migration:73-79]`

### P6 — Snooze é coluna por-LINHA, nunca tabela à parte
`snoozed_until` vai em `insights` (por-linha), preservando a dimensão `ml_user_id_key`. Uma tabela `snooze_state(organization_id, rule_key)` separada perderia o escopo por-loja e faria o snooze de uma loja sumir o alerta de outra. `[CITED: PITFALLS:221-241 (Pitfall 11)]`

### P7 — Anti-Pattern 3: WITH CHECK do UPDATE não pode permitir estados de execução
A policy authenticated de UPDATE em `proposed_actions` deve limitar `status IN ('approved','rejected')`. Permitir `'done'` ali deixaria um owner forjar execução sem tocar o ML. `[CITED: ARCHITECTURE.md:576-578]`

### P8 — `insights.snoozed_until` já tem cobertura de RLS — não criar policy nova
A policy `insights_dismiss` (UPDATE para qualquer membro, `consultor_tables.sql:104-111`) já permite escrever `snoozed_until`. Adicionar uma policy nova seria redundante e arriscaria conflito. `[VERIFIED: consultor_tables.sql:104-111]`

### P9 — Project ID errado no CLAUDE.md
Aplicar TUDO em `ckcdevcxgvueywivefgx`. O CLI local linkado em `gionpsuunfkkzzjdubfy` aplicaria no banco errado silenciosamente. `[VERIFIED: STATE.md:98,150]`

---

## State of the Art

| Decisão | Escolha | Razão |
|---------|---------|-------|
| Status do state-machine | `text` + CHECK | Alterável por migration; padrão do projeto (insights.status) |
| Dedup de ações abertas | índice UNIQUE **parcial** `WHERE status IN (...)` | Permite re-propor após done/failed sem violar unique |
| Gate de execução | `UPDATE ... WHERE status='approved' RETURNING *` | Único padrão TOCTOU-safe; sem SELECT-then-UPDATE |
| Imutabilidade do audit | ausência de GRANT UPDATE/DELETE | Padrão do projeto; trigger é opcional/defensivo |
| types.ts | edição manual | CLI linkado no projeto errado; precedente Phase 18 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `llm_model` deve entrar já na 52 (não só `llm_enabled`) | consultor_config ALTER | Baixo — coluna barata; se não, fase 53 adiciona |
| A2 | `snooze_count` é discricionário (não nos SC) | insights ALTER | Baixo — coluna informativa |
| A3 | `prompt_version` default `'v1'` é aceitável | llm_analysis_cache | Baixo — fase 53 define os valores reais |
| A4 | Os 14 limiares existentes cobrem TUNE-01..05 | consultor_config | Médio — se Wesley quiser novos limiares, é ALTER extra (ver Q1) |
| A5 | Cap 4KB do `detail` é responsabilidade do executor (código), não CHECK no schema | action_audit_log | Baixo — pode-se adicionar CHECK depois |

---

## Open Questions

1. **TUNE-01 mapeia 1:1 aos limiares existentes?**
   - Sabemos: `consultor_config` já tem 14 limiares (`margin_alert_pct`, `tacos_alert_pct`, `stock_alert_days`, etc.).
   - Incerto: se "margem alvo / TACoS alvo / dias de cobertura" da UI da fase 56 são exatamente esses, ou se Wesley quer limiares **novos** (ex.: `margin_target_pct` distinto de `margin_alert_pct`).
   - Recomendação: confirmar o mapeamento com Wesley na discuss da fase 56; **Phase 52 não precisa adicionar limiares novos** — os existentes bastam. Se surgir gap, é um ALTER trivial.

2. **`prompt_version` (SC-1) vs `prompt_hash` (ARCHITECTURE) — manter ambos?**
   - Recomendação: **sim**. UNIQUE inclui `prompt_version` (versão do template do system prompt, muda raramente); `prompt_hash` é coluna de staleness (hash dos insight IDs ativos, muda no dia). Os dois servem propósitos diferentes (LLM-04 cache vs LLM-06 "análise desatualizada").

3. **Gate atômico: RPC nomeada vs UPDATE inline na EF?**
   - SC-5 diz "RPC de transição atômica". Recomendação: criar a RPC `claim_approved_action` na fase 52 (testável + REVOKE explícito), e a EF da fase 54 a chama via `supabase.rpc()`. Confirmar se o planner prefere inline (ARCHITECTURE.md:544) — funcionalmente equivalente.

4. **CHECK `pg_column_size(detail) <= 4096` no schema, ou trim só no código?**
   - Recomendação: trim no executor (fase 54). Um CHECK rígido faria o INSERT de auditoria **falhar** se a resposta ML viesse grande — pior que truncar. Deixar o schema permissivo.

5. **`consultor_health_snapshots.ml_user_id_key` entra na 52 ou na 55?**
   - É coluna de fundação consumida pela 55, mas adicioná-la agora (junto da troca de UNIQUE) evita um segundo round de migration org-first. Recomendação: **incluir na 52** (M3). Confirmar com o planner se prefere isolar na 55.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Supabase project `ckcdevcxgvueywivefgx` | aplicar migrations | ✓ (via MCP `apply_migration`) | — | nenhum — bloqueia |
| MCP `apply_migration` + `get_advisors` | aplicar + auditar | ✓ (orquestrador) | — | gsd-executor NÃO tem; orquestrador aplica |
| Helpers `is_org_member`/`get_org_role` + enum `org_role` | RLS de todas as tabelas novas | ✓ (já em prod) | — | — |
| `organizations`/`insights` (FKs) | FKs das tabelas novas | ✓ | — | — |
| `supabase gen types` CLI | regen types.ts | ✗ (CLI no projeto errado) | — | edição **manual** de types.ts (precedente Phase 18) |

**Missing com fallback:** geração automática de types.ts → edição manual.
**Missing sem fallback:** nenhum bloqueante (todas as dependências de schema já existem em prod).

---

## Validation Architecture

> `workflow.nyquist_validation` — verificar `.planning/config.json`. Como esta é uma fase de schema/DDL, a validação é via MCP, não via vitest.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 (frontend) — **não aplicável a DDL**; validação real = MCP `execute_sql` + `get_advisors` |
| Config file | `vitest.config.ts` (existe) |
| Quick run command | `npx tsc --noEmit` (valida types.ts após edição manual) |
| Full suite command | `npm run build` (garante que types.ts novo compila com os hooks/consumidores) |

### Phase Requirements → Test Map
| SC | Behavior | Test Type | Validação | Existe? |
|----|----------|-----------|-----------|---------|
| 1 | `llm_analysis_cache` org-first + RLS | DDL | `execute_sql`: inserir 2 orgs, confirmar isolamento RLS | ❌ Wave 0 (manual via MCP) |
| 2 | `proposed_actions` 6 estados + dedup parcial | DDL | `execute_sql`: tentar 2ª ação aberta mesmo (org,rule,target) → viola unique | ❌ Wave 0 |
| 3 | `action_audit_log` append-only | DDL | `execute_sql` como authenticated: UPDATE/DELETE → negado | ❌ Wave 0 |
| 4 | colunas novas presentes | DDL | `list_tables` confirma colunas | ❌ Wave 0 |
| 5 | `claim_approved_action` atômico + REVOKE | RPC | `execute_sql`: 2 chamadas concorrentes → 1 retorna linha, 1 retorna 0 | ❌ Wave 0 |
| 6 | types.ts + advisors limpos | build | `tsc --noEmit` + `get_advisors` sem erro crítico novo | ❌ Wave 0 |

### Sampling Rate
- **Por migration aplicada:** `get_advisors` (security) imediatamente após `apply_migration`.
- **Por wave:** `tsc --noEmit` após editar types.ts.
- **Phase gate:** todas as 3 tabelas + 4 colunas + 1 RPC confirmadas via `list_tables`/`execute_sql`; advisors sem crítico novo; build verde.

### Wave 0 Gaps
- [ ] Não há teste automatizado de DDL no repo — a validação é manual via MCP pelo orquestrador (padrão estabelecido em Phase 43/48). Não criar harness de teste de banco.
- [ ] `tsc --noEmit` deve passar após a edição manual de types.ts (única validação automatizada relevante).

---

## Security Domain

> `security_enforcement` ativo (default). Esta fase é fundação de segurança multi-tenant.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V4 Access Control | **yes** | RLS org-first (`is_org_member`/`get_org_role`); IDOR é o risco #1 (Pitfall 5) |
| V5 Input Validation | yes | CHECK constraints em status/action_type; FKs |
| V6 Cryptography | no | sem cripto nesta fase (ANTHROPIC_API_KEY = fase 53) |
| V2/V3 Auth/Session | parcial | herda dual-auth do projeto; RPC com REVOKE anon/public |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR cross-org (executar ação de outra org) | Elevation/Tampering | RLS `is_org_member` + RPC SECURITY INVOKER + escopo `(organization_id, ml_user_id)` no token |
| Default EXECUTE a PUBLIC em RPC | Elevation | `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` |
| Forjar `status='done'` sem execução | Tampering | RLS WITH CHECK limita authenticated a `('approved','rejected')` |
| Cross-tenant cache leak (LLM) | Info Disclosure | `organization_id` líder na UNIQUE + RLS SELECT |
| Mutação de audit log | Repudiation | append-only (sem GRANT UPDATE/DELETE) |

---

## Sources

### Primary (HIGH confidence — código real + research HIGH)
- `supabase/migrations/20260645000000_consultor_tables.sql` — padrão org-first RLS, dedup helper, idempotência (THE pattern to match)
- `supabase/migrations/20260615120100_consultor_config_ads_cols.sql` — padrão ALTER ADD COLUMN IF NOT EXISTS
- `supabase/migrations/20260645011000_consultor_rpcs_revoke_public_execute.sql` — REVOKE EXECUTE pattern
- `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` — SECURITY INVOKER RPC pattern
- `supabase/migrations/20260414200325_*.sql` — `is_org_member`/`get_org_role`/enum `org_role`
- `supabase/migrations/20260614120000_tenant01_*.sql` — RLS org-first com `get_org_role = ANY(ARRAY[...])`
- `src/integrations/supabase/types.ts:120-296` — estrutura dos blocos a editar manualmente
- `.planning/research/ARCHITECTURE.md:92-307` — DDL completo das tabelas novas (HIGH, codebase inspection)
- `.planning/research/PITFALLS.md` — Pitfalls 2,3,5,6,11
- `.planning/research/SUMMARY.md` — decisões de modelo locked
- `.planning/STATE.md:98,143,150,237` — project ID, types.ts manual, fluxo de aplicação MCP

### Secondary (MEDIUM)
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — Success Criteria + reqs

---

## Metadata

**Confidence breakdown:**
- Schema/DDL: HIGH — todo o DDL deriva de inspeção direta do banco + ARCHITECTURE HIGH
- RLS/Security: HIGH — padrões idênticos já em produção (consultor v1, tenant01)
- State-machine/atomic: HIGH — gate `UPDATE WHERE RETURNING` é padrão canônico, REVOKE tem precedente exato
- types.ts/aplicação: HIGH — precedente Phase 18/43 documentado em STATE.md
- Mapeamento TUNE→limiares existentes: MEDIUM — confirmar com Wesley (Q1)

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (schema estável; project ID e padrões não mudam em 30 dias)
