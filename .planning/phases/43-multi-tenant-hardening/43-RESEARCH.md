# Phase 43: Multi-Tenant Hardening - Research

**Researched:** 2026-06-13
**Domain:** Supabase Postgres RLS multi-tenancy, Edge Function quota enforcement, React SPA onboarding wizard
**Confidence:** HIGH (codebase-verified) / MEDIUM (live-DB state needs MCP confirmation at plan time)

## Summary

Esta fase **não tem stack nova** — é endurecimento do que já existe. O projeto já é multi-tenant: todas as tabelas de cache têm `organization_id` (adicionado em `20260423153544`), há um sistema de quota (`organization_plans` + `sync_quota_daily` + `dispatch_sync_jobs`), e o scoping de leitura faz fallback `user_id` → `organization_id` em `mlCacheService.ts`. O trabalho é fechar buracos: RLS inconsistente em `ml_product_costs`, linhas órfãs (`organization_id NULL`), quota só por intervalo (sem `check_quota` RPC), ausência total de wizard de onboarding, e três achados de segurança deferidos da Phase 41 (ME-04/05/06).

Achados-chave verificados no código: (1) `ml_product_costs` tem **duas migrations conflitantes** definindo RLS — a antiga (`auth.uid()=user_id` FOR ALL) e a nova org-aware (`20260515133732`); a INSERT policy ainda exige `WITH CHECK (user_id = auth.uid())`, o que **não** bloqueia service role (que ignora RLS) mas trava qualquer caminho que não seta `user_id` corretamente. (2) `ml_billing_monthly` usa `FOR ALL` com `is_org_member` — qualquer membro, inclusive viewer, pode INSERT/UPDATE/DELETE billing (ME-06). (3) O lookup de token em todas as EFs de sync é `.eq("ml_user_id", X).limit(1).maybeSingle()` **sem `ORDER BY`** — não-determinístico se duas orgs conectarem o mesmo `ml_user_id` (ME-04). (4) `sync-ml-inventory` já tem um `checkAndIncrementQuota()` que é o padrão de referência para portar à TENANT-03. (5) Após aceitar convite, o owner novo cai direto em `/` sem wizard (TENANT-04).

**Primary recommendation:** Consolidar RLS de `ml_product_costs` em uma única migration org-first idempotente (DROP de todas as policies antigas + recriar), backfill+`NOT NULL` de `organization_id` nas tabelas de cache, criar RPC `check_quota(organization_id, job_type)` reaproveitando o padrão de `sync-ml-inventory` e injetá-la no `dispatch_sync_jobs`/`process-sync-job`, e construir o wizard de onboarding com react-hook-form + shadcn (sem dependência nova), persistindo progresso em nova tabela `onboarding_progress`. Endurecer ME-04 (ORDER BY determinístico + filtro por org), ME-05 (sempre validar `is_org_member` antes de aceitar `ml_user_id` de input) e ME-06 (trocar `FOR ALL` por `FOR SELECT` em billing).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Isolamento de dados entre orgs (RLS) | Database (Postgres RLS) | — | Única fronteira confiável; frontend filter é defesa em profundidade, não isolamento |
| Upsert de custos via sync | API / Edge Function (service role) | Database (RLS bypass) | EFs escrevem com SERVICE_ROLE_KEY; RLS protege leitura por org |
| Quota enforcement | Database (RPC `check_quota`) + API (EF gate) | — | RPC é SECURITY DEFINER, fonte única de verdade; EF chama antes de processar |
| Backfill / limpeza de órfãos | Database (migration) | — | Operação de dados, idempotente, via migration commitada |
| Wizard de onboarding (UI + progresso) | Frontend SPA (React) | Database (`onboarding_progress`) | Passos e CTA são UI; progresso persistido no DB para cross-session |
| CTA de empty state | Frontend SPA | — | Dashboard detecta `!hasMLConnection` e roteia para wizard/integrações |
| Token lookup determinístico (ME-04) | API / Edge Function | Database (índice) | Lookup acontece nas EFs; precisa ORDER BY + filtro org |

## Standard Stack

### Core (já presente — nenhuma instalação nova)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | 2.98.0 | Cliente + RLS + RPC | Já é o BaaS do projeto [VERIFIED: package.json/STACK.md] |
| Postgres RLS | (Supabase) | Isolamento de tenant | Fronteira de segurança canônica multi-tenant [CITED: supabase.com/docs/guides/database/postgres/row-level-security] |
| Deno EF runtime | std@0.168.0 | Sync + quota gate | Padrão do projeto para todas as EFs [VERIFIED: codebase] |
| react-hook-form | 7.61.1 | Estado do wizard multi-step | Já usado em forms do projeto [VERIFIED: STACK.md] |
| zod | 3.25.76 | Validação por passo do wizard | Já usado front + EF [VERIFIED: STACK.md] |
| shadcn/ui (Progress, Card, Button, Dialog) | — | UI do wizard | Radix Progress já instalado [VERIFIED: STACK.md] |
| @tanstack/react-query | 5.83.0 | Refetch de estado de onboarding | Padrão de data fetching [VERIFIED: STACK.md] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Wizard hand-rolled (rhf + shadcn) | OnboardJS + Supabase plugin | Nova dependência — **viola CLAUDE.md "sem novas dependências"**; descartado. OnboardJS só é vantajoso em fluxos muito maiores [CITED: docs.onboardjs.com/plugins/supabase] |
| RLS org-first | Filtro só no frontend (`mlCacheService`) | Frontend filter NÃO é isolamento — service role e queries diretas furam; RLS é obrigatório [CITED: supabase RLS docs] |
| `check_quota` RPC dedicado | Lógica inline em cada EF (como hoje) | Inline duplica e diverge (ver ME: `sync-ml-inventory` tem; `process-sync-job` não tem) — RPC centraliza |

**Installation:** Nenhuma. Todas as libs já estão no `package.json`.

## Package Legitimacy Audit

> Não aplicável a esta fase — **nenhum pacote novo é instalado**. Todo o trabalho usa dependências já presentes (verificadas em `STACK.md`/`package.json`) e mudanças de Postgres/Deno. Se o planner decidir (contra a recomendação) introduzir OnboardJS, rodar `gsd-tools query package-legitimacy check --ecosystem npm onboardjs @onboardjs/react` e adicionar `checkpoint:human-verify` antes do install.

## Architecture Patterns

### System Architecture Diagram

```
                         NEW OWNER (via convite)
                                │
                  org-invite-accept (EF, service role)
                  ├─ insere organization_members (role)
                  ├─ se role=owner → transfere owner_id
                  └─ [GAP TENANT-04] hoje navega direto p/ "/"
                                │
                                ▼
        ┌──────────── Dashboard "/" (MercadoLivre.tsx) ───────────┐
        │  hasMLConnection? ── NÃO ──► [TENANT-04] CTA → WIZARD     │
        │                              (Conectar ML→Tiny→Custos→    │
        │                               Fiscal→Pronto)              │
        │                              progresso ↔ onboarding_progress│
        └──────────────────────────────┬──────────────────────────┘
                                        │ (org conectada)
                  ┌─────────────────────┼─────────────────────┐
                  ▼ leitura             ▼ sync (cron)          ▼ custos
        mlCacheService.ts        dispatch_sync_jobs()    useMLProductCosts
        scope: user_id ||        (pg_cron */30)          .upsert(org_id)
        organization_id          │  [TENANT-03] +check_quota
        (RLS reforça)            ▼                       │
                          process-sync-job (EF)          ▼
                          [TENANT-03] gate check_quota   ml_product_costs
                          claim_next_sync_job()          [TENANT-01] RLS org-first
                          │                              (service role escreve;
                          ▼                               membros leem por org)
                  sync-ml-orders / sync-ml-billing / ...
                  token lookup [ME-04] ── ORDER BY + org filter
                  │
                  ▼  escreve com organization_id (nunca NULL) [TENANT-02]
            ml_*_cache  ◄── RLS: is_org_member(auth.uid(), organization_id)
                  ▲
                  └─ [TENANT-05] teste: org A não vê linhas de org B
```

### Recommended Project Structure (arquivos a tocar/criar)
```
supabase/migrations/
├── 2026XXXX_tenant01_ml_product_costs_rls_orgfirst.sql   # consolida RLS (DROP+CREATE idempotente)
├── 2026XXXX_tenant02_backfill_orphans_and_notnull.sql     # backfill + NOT NULL org_id caches
├── 2026XXXX_tenant03_check_quota_rpc.sql                  # RPC check_quota + ajuste dispatch
├── 2026XXXX_tenant04_onboarding_progress.sql             # tabela + RLS
└── 2026XXXX_me040506_hardening.sql                        # billing FOR SELECT, índices token
supabase/functions/
├── process-sync-job/index.ts          # injeta check_quota antes de claim/dispatch
├── sync-ml-orders/index.ts            # ME-04: ORDER BY no token lookup
├── sync-ml-billing/index.ts          # ME-04: idem
├── sync-ml-inventory/index.ts        # alinhar ao check_quota RPC (hoje inline)
├── ml-inventory|ml-ads|ml-reputation # ME-05: validar is_org_member antes de aceitar ml_user_id
src/
├── components/onboarding/OnboardingWizard.tsx   # NOVO — rhf + shadcn Progress
├── hooks/useOnboardingProgress.ts               # NOVO — read/write onboarding_progress
├── pages/MercadoLivre.tsx                        # CTA empty-state → wizard (TENANT-04)
└── pages/AcceptInvite.tsx                        # owner novo → wizard em vez de "/"
```

### Pattern 1: RLS org-first com escrita por service role
**What:** Service role **ignora RLS** (escreve livre); usuários autenticados leem/escrevem só por membership de org. INSERT não deve depender de `user_id = auth.uid()` para o caminho de service role — esse caminho já passa por cima do RLS. O que importa é (a) leitura escopada por org, (b) escrita de usuário (custos manuais) permitida a owner/admin/member da org.
**When to use:** `ml_product_costs` (TENANT-01) e qualquer cache.
**Example:**
```sql
-- Source: padrão já usado em ml_billing_daily / organization_plans (codebase)
-- TENANT-01 — consolidação idempotente (DROP de TODAS as policies antigas primeiro)
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Users can manage own product costs" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs select" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs insert" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs update" ON public.ml_product_costs';
  EXECUTE 'DROP POLICY IF EXISTS "ml_product_costs delete" ON public.ml_product_costs';
END $$;

CREATE POLICY "mpc_select" ON public.ml_product_costs FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "mpc_write" ON public.ml_product_costs FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner','admin','member']::org_role[]));

CREATE POLICY "mpc_update" ON public.ml_product_costs FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL
    AND public.get_org_role(auth.uid(), organization_id)
        = ANY (ARRAY['owner','admin','member']::org_role[]));
-- service role: NÃO precisa de policy (bypassa RLS). recalc-order-costs / sync-tiny-costs
-- escrevem via SERVICE_ROLE_KEY e funcionam para qualquer org.
```
> **AÇÃO no plano:** o frontend `useMLProductCosts.fetchAll` lê hoje **só por `user_id`** (linha 39). Com RLS org-first, mudar para `.eq("organization_id", currentOrg.id)`; senão custos cadastrados por outro membro da org não aparecem.

### Pattern 2: check_quota RPC (TENANT-03)
**What:** RPC SECURITY DEFINER que, dado `organization_id` (+ opcional `job_type`), incrementa `sync_quota_daily` e retorna se excedeu o limite derivado do `plan_tier`. Centraliza a lógica que hoje só existe inline em `sync-ml-inventory`.
**When to use:** chamado por `dispatch_sync_jobs()` (antes de inserir job) e/ou `process-sync-job` (antes de processar).
**Example:**
```sql
-- Source: deriva do checkAndIncrementQuota em sync-ml-inventory/index.ts:95-130 (codebase)
CREATE OR REPLACE FUNCTION public.check_quota(_org_id uuid)
RETURNS boolean  -- true = dentro da quota; false = excedeu
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_interval int;
  v_count    int;
  v_limit    int;
BEGIN
  SELECT sync_interval_minutes INTO v_interval
  FROM public.organization_plans WHERE organization_id = _org_id;
  IF v_interval IS NULL OR v_interval = -1 THEN RETURN true; END IF;  -- enterprise/unlimited

  INSERT INTO public.sync_quota_daily (organization_id, date, sync_count)
  VALUES (_org_id, current_date, 1)
  ON CONFLICT (organization_id, date)
    DO UPDATE SET sync_count = sync_quota_daily.sync_count + 1
  RETURNING sync_count INTO v_count;

  v_limit := greatest(1, floor(1440.0 / v_interval));
  RETURN v_count <= v_limit;
END $$;
```
> **DECISÃO P/ DISCUSS:** o significado de "quota" hoje é ambíguo — `sync_interval_minutes` é reusado para derivar contagem diária. O Success Criteria 3 fala em "quota por plan_tier". Confirmar com Wesley **o que** limitar: nº de syncs/dia, `history_days`, ou nº de lojas ML por org. PAY-04 (Phase 44) também aplica `history_days`/`sync_interval_minutes` — alinhar para não duplicar. [ASSUMED]

### Pattern 3: Wizard de onboarding com progresso persistido (TENANT-04)
**What:** Componente multi-step (rhf controla estado; cada passo = um "commit"). Progresso gravado em `onboarding_progress` (org-scoped) a cada passo concluído → resume cross-session.
**When to use:** owner novo sem ML conectado; CTA no empty-state do dashboard.
**Example:**
```sql
-- tabela de progresso (TENANT-04)
CREATE TABLE public.onboarding_progress (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  current_step    text NOT NULL DEFAULT 'connect_ml',   -- connect_ml|tiny|costs|fiscal|done
  completed_steps text[] NOT NULL DEFAULT '{}',
  completed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ob_select" ON public.onboarding_progress FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "ob_write" ON public.onboarding_progress FOR ALL TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner')
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');
```
> Passos = derivam do estado real: ML conectado? (`ml_tokens`), Tiny? (`ml_tokens.tiny_*`), Custos? (`ml_product_costs` count>0), Fiscal? (`ml_tax_config` existe). O wizard pode **auto-detectar** passos já feitos e marcar como completos, não só ler `onboarding_progress`. Recomendado: derivar do estado + persistir `current_step` para UX de retomada.

### Anti-Patterns to Avoid
- **Confiar em filtro de frontend para isolamento:** `mlCacheService` faz dois queries (`user_id` e `organization_id`) e mescla — isso é UX, não segurança. RLS é a fronteira. [CITED: supabase RLS docs]
- **`CREATE POLICY` sem DROP prévio em migration idempotente:** as duas migrations conflitantes de `ml_product_costs` mostram o risco — sempre `DROP POLICY IF EXISTS` antes.
- **`.eq("ml_user_id", X).limit(1)` sem ORDER BY:** não-determinístico em multi-tenant (ME-04).
- **`FOR ALL` em tabela read-only para membros:** `ml_billing_monthly` permite viewer escrever billing (ME-06).
- **Aplicar migration via `supabase db push`:** o CLI local está linkado no projeto ERRADO (`gionpsuunfkkzzjdubfy`). Usar **MCP `apply_migration` no `ckcdevcxgvueywivefgx`**. [VERIFIED: STATE.md:55]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Isolamento de tenant | Filtro manual em cada query | Postgres RLS + `is_org_member`/`get_org_role` | Helpers SECURITY DEFINER já existem e são auditáveis |
| Quota counting | Contador em memória na EF | `sync_quota_daily` + `check_quota` RPC | Atômico (ON CONFLICT), persistente, já modelado |
| Claim de job concorrente | SELECT+UPDATE manual | `claim_next_sync_job()` (FOR UPDATE SKIP LOCKED) | Já implementado, concorrência-safe |
| Wizard state machine | Lib externa (OnboardJS) | rhf + shadcn Progress + tabela | CLAUDE.md proíbe novas deps; escopo é 5 passos |
| Auth de org-role | Checar role no client | `get_org_role`/`has_org_role` no RLS | Client check é bypassável |

**Key insight:** Quase tudo de infra já existe (quota, jobs, helpers RLS, scoping). O erro mais provável é **reconstruir** algo que já está pronto em vez de consolidar. Inventariar antes de criar.

## Runtime State Inventory

> Esta fase mexe em RLS, backfill de dados e EFs — há estado em runtime além do código.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Linhas órfãs `organization_id NULL`** nas 16 tabelas com a coluna (sellers, seller_stores, sales_data, shopee_orders/sales, audit_log, ml_tokens, ml_user_cache, ml_daily/hourly/product_daily/state_daily_cache, ml_ads_daily/campaigns/products_cache, ml_sync_log). `ml_product_costs` também (`organization_id` nullable). **Contagens exatas: rodar via MCP no plan time** (ver Open Questions Q1). | Backfill via `organization_members` (padrão `20260515140258`) → depois `NOT NULL` |
| Live service config | **pg_cron schedules** (`sync-dispatch-every-30min`, `sync-process-job-every-5min`, watchdogs, questions/claims cron) — definidos em migrations mas vivem no DB. A migration `20260519140000` referencia URL do projeto **ERRADO** (`gionpsuunfkkzzjdubfy`) e um anon JWT legado embutido. | Verificar via MCP `SELECT * FROM cron.job`; se schedules apontam p/ projeto errado ou usam JWT legado, recriar Pattern B (vault `SERVICE_ROLE_KEY = sb_secret_`) |
| OS-registered state | Nenhum (sem cron de OS; tudo é pg_cron no Supabase). | None — verified by ausência de scheduler externo |
| Secrets/env vars | `vault.decrypted_secrets`: `CRON_SECRET`, `SERVICE_ROLE_KEY` (Pattern B). EFs leem `SUPABASE_SERVICE_ROLE_KEY` do env (= `sb_secret_`, não JWT legado). | Confirmar que vault tem `SERVICE_ROLE_KEY` antes de qualquer pg_cron novo (Pattern B) — ver STATE.md:102 |
| Build artifacts | `src/integrations/supabase/types.ts` (gerado) — já contém `organization_id` em `ml_product_costs`. Após novas colunas/tabelas (`onboarding_progress`), **regenerar ou editar manualmente** (projeto edita à mão — STATE.md:88). | Atualizar types.ts após migrations |

**Pergunta canônica:** depois que todo arquivo for atualizado, que estado de runtime ainda guarda o problema? → as **linhas órfãs** (dados), os **pg_cron jobs** (config viva possivelmente apontando p/ projeto errado), e o **vault** (segredo do cron).

## Common Pitfalls

### Pitfall 1: RLS de `ml_product_costs` em estado ambíguo (duas migrations)
**What goes wrong:** Existem `20260514120000` (`FOR ALL auth.uid()=user_id`) e `20260515133732` (org-aware). Qual está ativa no DB depende da ordem de aplicação e se houve `CREATE POLICY` duplicado (que erra). O frontend lê só por `user_id`.
**Why it happens:** Evolução incremental sem consolidação.
**How to avoid:** No plan time, **consultar policies reais via MCP** (`SELECT * FROM pg_policies WHERE tablename='ml_product_costs'`), depois aplicar migration que DROPa todas e recria org-first. Atualizar `useMLProductCosts.fetchAll` para filtrar por org.
**Warning signs:** custo cadastrado por um membro não aparece para outro membro da mesma org.

### Pitfall 2: Backfill de órfãos com ambiguidade (usuário em 2 orgs)
**What goes wrong:** O backfill `UPDATE ... FROM organization_members WHERE user_id = m.user_id` (padrão `20260515140258`) duplica linhas se o `user_id` pertence a >1 org.
**Why it happens:** `organization_members` é 1:N por usuário.
**How to avoid:** Para tabelas com `ml_user_id`, preferir backfill via `ml_tokens` (que já tem `organization_id` + `ml_user_id`) em vez de `organization_members`. Decidir delete vs backfill por tabela (cache regenerável → pode deletar órfão; config → backfill). Ver Open Questions Q2.
**Warning signs:** contagem de linhas cresce após backfill; KPIs duplicados.

### Pitfall 3: `NOT NULL` quebra inserts existentes
**What goes wrong:** Adicionar `NOT NULL` em `organization_id` após backfill quebra EFs/paths que ainda inserem sem org.
**How to avoid:** Auditar TODOS os writers (EFs + hooks) antes do `NOT NULL`. `recalc-order-costs` já filtra `organization_id.eq.X OR is.null` — esse `OR is.null` deve sumir após backfill. `ml_daily_cache` upsert no frontend exige `organization_id` (já obrigatório no signature).
**Warning signs:** EF retorna erro `null value in column organization_id violates not-null constraint`.

### Pitfall 4: pg_cron apontando para projeto errado
**What goes wrong:** `20260519140000` embute `https://gionpsuunfkkzzjdubfy.supabase.co` (projeto ERRADO) e um anon JWT legado. Se aplicado assim no DB correto, o cron chama um projeto que não é este.
**How to avoid:** Verificar `cron.job` via MCP; recriar com URL `ckcdevcxgvueywivefgx` e Pattern B (vault `SERVICE_ROLE_KEY`). Migrations mais recentes (questions/claims) já usam o padrão correto — espelhar.
**Warning signs:** jobs `pending` nunca processados; logs sem invocação de `process-sync-job`.

### Pitfall 5: Quota duplicada entre Phase 43 e Phase 44
**What goes wrong:** TENANT-03 (check_quota) e PAY-04 (`history_days`/`sync_interval_minutes` enforcement) podem implementar a mesma coisa de formas divergentes.
**How to avoid:** Definir em discuss qual fase é dona de qual limite. Recomendação: Phase 43 entrega o RPC `check_quota` e o gate de **nº de syncs**; Phase 44 conecta Stripe ao `plan_tier` e aplica `history_days` na leitura.

## Code Examples

### ME-04: token lookup determinístico
```typescript
// Source: sync-ml-orders/index.ts:440 (atual, NÃO-determinístico)
const { data: tokenRow } = await supabaseAdmin
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id")
  .eq("ml_user_id", ml_user_id)
  .not("access_token", "is", null)
  .limit(1).maybeSingle();   // ⚠ sem ORDER BY → arbitrário se 2 orgs têm o mesmo ml_user_id

// CORRIGIDO: filtrar por org quando conhecida + ORDER BY determinístico
const q = supabaseAdmin
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id, updated_at")
  .eq("ml_user_id", ml_user_id)
  .not("access_token", "is", null);
if (organization_id) q.eq("organization_id", organization_id);   // quando o caller sabe a org
const { data: tokenRow } = await q
  .order("updated_at", { ascending: false })   // determinístico: o mais recente
  .limit(1).maybeSingle();
```

### ME-05: prevenir enumeração de ml_user_id
```typescript
// Source: ml-ads/index.ts:344 / ml-inventory:166 (padrão a reforçar)
// SEMPRE validar membership ANTES de usar o ml_user_id vindo de input do usuário.
// Já existe em ml-inventory; auditar ml-ads e ml-reputation para o MESMO guard.
if (authResult.userId) {            // chamada de usuário (não service role)
  const { data: tok } = await sb.from("ml_tokens")
    .select("organization_id").eq("ml_user_id", ml_user_id).limit(1).maybeSingle();
  const { data: ok } = await sb.rpc("is_org_member",
    { _user_id: authResult.userId, _org_id: tok?.organization_id });
  if (!ok) return json({ error: "Forbidden" }, 403);  // não vazar existência/dados de outra org
}
```

### ME-06: billing read-only para membros
```sql
-- Source: ml_billing_monthly RLS atual (20260612140000) — FOR ALL permite viewer escrever
DROP POLICY IF EXISTS "org_member_billing" ON public.ml_billing_monthly;
-- leitura: qualquer membro; escrita: somente service role (EF sync-ml-billing) → sem policy de write
CREATE POLICY "org_member_billing_select" ON public.ml_billing_monthly
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cache por `user_id` (mono-tenant) | `organization_id` em todas as tabelas | `20260423153544` | Base multi-tenant já existe; falta endurecer |
| Quota inline na EF | `check_quota` RPC centralizado | Phase 43 (proposto) | Fonte única; evita divergência |
| Sem onboarding | Wizard guiado + progresso | Phase 43 (novo) | TENANT-04 |

**Deprecated/outdated:**
- Migration `20260514120000` (RLS `auth.uid()=user_id` de `ml_product_costs`): superada pela org-aware — consolidar.
- `recalc-order-costs` `organization_id.is.null` fallback: remover após backfill (TENANT-02).
- URL/JWT legado em `20260519140000` pg_cron: substituir por Pattern B.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Quota" = nº de syncs/dia derivado de `sync_interval_minutes` | Pattern 2 / TENANT-03 | Se Wesley quer limitar `history_days` ou nº de lojas, o RPC muda de assinatura |
| A2 | Wizard hand-rolled (sem OnboardJS) é suficiente p/ 5 passos | Stack / Pattern 3 | Se fluxo crescer muito, refactor; baixo risco |
| A3 | Backfill via `ml_tokens` resolve ambiguidade de user-em-2-orgs | Pitfall 2 | Tabelas sem `ml_user_id` (audit_log, sales_data) precisam outra estratégia |
| A4 | pg_cron em produção pode apontar p/ projeto errado | Pitfall 4 / Runtime State | Se já corrigido em sessão anterior, é no-op — verificar via MCP |
| A5 | Phase 43 dona do gate de syncs; Phase 44 dona de history_days | Pitfall 5 | Divisão precisa confirmação no discuss |

## Open Questions

1. **Quantas linhas órfãs (`organization_id NULL`) existem em cada tabela?**
   - O que sabemos: 16+ tabelas têm a coluna; backfill anterior (`20260515140258`) rodou só p/ `ml_product_costs`.
   - O que falta: contagens reais por tabela em `ckcdevcxgvueywivefgx`.
   - Recomendação: no início do plano, rodar via MCP `SELECT count(*) FILTER (WHERE organization_id IS NULL) FROM <tabela>` para cada tabela; decide delete vs backfill por volume.

2. **Delete vs backfill por tabela?**
   - Caches regeneráveis (ml_daily/hourly/product/state/ads) → órfãos podem ser **deletados** (re-sync repopula).
   - Config/histórico (ml_tokens, ml_product_costs, ml_tax_config, sellers, ml_sync_log) → **backfill** obrigatório.
   - Recomendação: confirmar matriz delete/backfill no discuss.

3. **check_quota: o que exatamente limitar e onde fica o gate?**
   - Ver A1. Confirmar métrica e ponto de injeção (`dispatch_sync_jobs` vs `process-sync-job` vs ambos).

4. **Estado real do RLS de `ml_product_costs` e dos pg_cron jobs em produção?**
   - Resolver via MCP no plan time (`pg_policies`, `cron.job`) — as migrations são conflitantes/possivelmente desatualizadas.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project `ckcdevcxgvueywivefgx` | Todas as migrations/EFs | ✓ (MCP) | — | — |
| Supabase MCP (apply_migration, execute_sql) | Aplicar migrations (CLI linkado no projeto errado) | ✓ | — | Nenhum — CLI `db push` NÃO pode ser usado |
| vault `SERVICE_ROLE_KEY` (Pattern B) | pg_cron novos/recriados | A confirmar | — | Inserir via SQL antes do cron (checkpoint) |
| Node/npm (tsc, build) | QA local | ✓ | — | — |
| Deno (EF runtime) | Deploy EFs | ✓ (Supabase-hosted) | std@0.168.0 | — |

**Missing dependencies with no fallback:** Nenhuma bloqueante — mas o `SUPABASE_ACCESS_TOKEN` para deploy de EFs foi um bloqueio em sessão anterior (STATE 2026-06-11b). Confirmar disponibilidade antes de planejar deploy de EF.

## Security Domain

> `security_enforcement` não está `false` no config → seção incluída. Esta fase é **majoritariamente segurança**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Isolamento multi-tenant via RLS como fronteira única |
| V2 Authentication | no (não muda auth) | Supabase Auth já existente |
| V4 Access Control | **yes (núcleo)** | RLS org-first + `get_org_role`/`is_org_member`; viewer default-deny; ME-06 (viewer não escreve billing) |
| V5 Input Validation | yes | zod nas EFs; ME-05 (validar `ml_user_id` contra membership) |
| V7 Error Handling/Logging | yes | Não vazar existência de recurso de outra org (403 genérico) |
| V8 Data Protection | yes | TENANT-02 (sem órfãos); isolamento de dados entre orgs |

### Known Threat Patterns for Supabase RLS multi-tenant

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Vazamento cross-tenant via query direta | Information Disclosure | RLS org-first em TODAS as tabelas de dados (TENANT-01/05) |
| Enumeração de `ml_user_id` de outra org | Information Disclosure | Validar `is_org_member` antes de aceitar input (ME-05) |
| Viewer altera/apaga billing | Tampering / Elevation | `FOR SELECT` em vez de `FOR ALL` (ME-06) |
| Token de org errada usado em sync | Spoofing | Token lookup determinístico + filtro por org (ME-04) |
| Org bypassa limite de plano | — (abuse) | `check_quota` RPC com enforcement real (TENANT-03) |
| Dado órfão acessível sem dono | Information Disclosure | Backfill + `NOT NULL` (TENANT-02) |

## Project Constraints (from CLAUDE.md + STATE.md)

- **Supabase project correto = `ckcdevcxgvueywivefgx`** — o `gionpsuunfkkzzjdubfy` do CLAUDE.md está DESATUALIZADO. Aplicar migrations via **MCP apply_migration**, nunca `supabase db push` (CLI linkado no projeto errado). [VERIFIED: STATE.md:55,95]
- **Sem novas dependências** de cálculo/lib externa (CLAUDE.md "Stack: React + TS + shadcn/ui + Supabase — sem novas dependências"). Wizard usa rhf+shadcn já presentes.
- **Scope sempre `organization_id` + `ml_user_id`** (não só `seller_id`). [VERIFIED: STATE.md:93]
- **DDL só via migration commitada** em `supabase/migrations/` — proibido drift via SQL Editor. [feedback_no_drift_via_sql_editor]
- **pg_cron Pattern B**: vault guarda `SERVICE_ROLE_KEY = sb_secret_` (não JWT legado). [VERIFIED: STATE.md:181, sessão 2026-06-13b]
- **PostgREST trunca em 1000 linhas** — paginar select/rpc com `.range()` em qualquer query de inventário/backfill que possa exceder. [feedback_postgrest_pagination]
- **Role config restrita a `owner`** quando aplicável (wizard de onboarding = owner). [CLAUDE.md]
- **EF Deno**: cuidado com tamanho de função ao adicionar lógica (STATE blocker).
- **Deploy de EF** pode exigir `SUPABASE_ACCESS_TOKEN` (foi bloqueio antes) — verificar antes de planejar deploy.

## Validation Architecture

> `workflow.nyquist_validation` = **false** no config.json → seção OMITIDA conforme protocolo. (Testes manuais de isolamento TENANT-05 ainda são exigidos pelo Success Criteria 5 — ver abaixo.)

**Teste de isolamento TENANT-05 (manual, exigido pelo Success Criteria):**
- Criar 2 orgs (A e B) com 2 usuários distintos. Cada uma conecta uma loja ML diferente.
- Logado como A: query direta a cada tabela de cache → **zero** linhas de B. Repetir como B.
- Tentar (como viewer de A) INSERT em `ml_billing_monthly` → deve falhar (ME-06).
- Tentar (como usuário de A) chamar `ml-ads`/`ml-inventory` com `ml_user_id` de B → 403 (ME-05).
- Confirmar em logs que `check_quota` bloqueia quando org excede limite (Success Criteria 3).
- Existe infra vitest (`vitest.config.ts`) e alguns `*.test.ts` — opcionalmente cobrir helpers de scope, mas RLS exige teste de integração contra DB (manual ou via SQL no MCP).

## Sources

### Primary (HIGH confidence)
- Codebase `/root/garment-glow-test/supabase/migrations/` — RLS, quota, sync_jobs, billing (verificado linha a linha)
- Codebase `/root/garment-glow-test/supabase/functions/` — process-sync-job, sync-ml-inventory (quota pattern), sync-ml-orders/billing (token lookup ME-04), ml-ads/inventory (ME-05)
- Codebase `/root/garment-glow-test/src/` — mlCacheService.ts, OrganizationContext.tsx, useMLProductCosts.ts, AcceptInvite.tsx, MercadoLivre.tsx
- `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — decisões, ME-04/05/06, project ID correto

### Secondary (MEDIUM confidence)
- [supabase.com/docs/guides/database/postgres/row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security) — service role bypassa RLS; padrão org-scoped
- [docs.onboardjs.com/plugins/supabase](https://docs.onboardjs.com/plugins/supabase) — referência de persistência de onboarding (descartado por nova dep)

### Tertiary (LOW confidence)
- WebSearch sobre padrões de wizard multi-step React/Supabase (usado só para confirmar que hand-roll é aceitável)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nenhuma lib nova; tudo verificado em STACK.md/package.json
- Architecture (RLS/quota/sync): HIGH — lido direto das migrations e EFs
- Estado real do DB (policies ativas, órfãos, cron): MEDIUM — migrations conflitantes; confirmar via MCP no plan time
- Pitfalls: HIGH — derivados de inconsistências reais encontradas no código
- ME-04/05/06: HIGH — root cause localizado no código exato

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (estável; reconfirmar estado do DB via MCP antes de planejar)
