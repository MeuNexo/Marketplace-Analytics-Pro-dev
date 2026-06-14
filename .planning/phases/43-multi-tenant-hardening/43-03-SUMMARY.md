---
phase: 43-multi-tenant-hardening
plan: 03
subsystem: ui
tags: [onboarding, react-hook-form, shadcn, supabase, rls, multi-tenant, wizard]

# Dependency graph
requires:
  - phase: 43-01
    provides: "Helpers RLS org-first (is_org_member, get_org_role), enum org_role, RLS consolidada de caches"
provides:
  - "Tabela onboarding_progress (org-scoped) + RLS ob_select(member)/ob_write(owner) — APLICADA EM PRODUÇÃO via MCP (ckcdevcxgvueywivefgx, 2026-06-14, aprovada por Wesley)"
  - "Hook useOnboardingProgress: lê persistido + auto-detecta passos pelo estado real (ml_tokens, ml_product_costs, ml_tax_config)"
  - "OnboardingWizard (rhf + shadcn Dialog/Progress) — 5 passos ML->Tiny(opcional)->Custos->Fiscal->Pronto, não-bloqueante"
  - "OnboardingBanner não-bloqueante no topo do dashboard com Progress + CTA"
  - "Wiring: MercadoLivre.tsx (banner + CTA no empty state), AcceptInvite.tsx (owner novo -> '/' sem route-guard)"
affects: [43-04, onboarding, multi-tenant, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wizard multi-step hand-rolled com react-hook-form + shadcn (sem nova dependência, CLAUDE.md)"
    - "Auto-detecção de progresso a partir do estado real do DB + persistência opcional de retomada"
    - "Onboarding não-bloqueante (D-07): banner/wizard dispensáveis, sem route-guard"

key-files:
  created:
    - supabase/migrations/20260614123000_tenant04_onboarding_progress.sql
    - src/hooks/useOnboardingProgress.ts
    - src/components/onboarding/OnboardingWizard.tsx
    - src/components/onboarding/OnboardingBanner.tsx
  modified:
    - src/integrations/supabase/types.ts
    - src/pages/MercadoLivre.tsx
    - src/pages/AcceptInvite.tsx

key-decisions:
  - "Tiny é passo opcional (botão Pular); onboarding considerado completo com connect_ml + costs + fiscal"
  - "ob_write restrita a owner (FOR ALL) — onboarding é config de organização (CLAUDE.md)"
  - "Banner usa forceShow={!hasMLConnection || !onboardingComplete} no dashboard"

patterns-established:
  - "Auto-detecção de estado de onboarding via query react-query a ml_tokens/ml_product_costs/ml_tax_config"
  - "Wizard como Dialog dispensável que apenas navega para rotas existentes (nunca bloqueia)"

requirements-completed: [TENANT-04]

# Metrics
duration: 5min
completed: 2026-06-14
---

# Phase 43 Plan 03: Wizard de Onboarding Não-Bloqueante Summary

**Wizard de onboarding guiado (ML -> Tiny opcional -> Custos -> Fiscal -> Pronto) com react-hook-form + shadcn, banner não-bloqueante no dashboard, progresso org-scoped em onboarding_progress com auto-detecção pelo estado real — migration escrita aguardando aprovação de Wesley (Task 4).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-14T11:51:50Z
- **Completed:** 2026-06-14T11:56:02Z
- **Tasks:** 3 de 4 (Task 4 = checkpoint blocking-human, AGUARDANDO)
- **Files modified:** 7 (4 criados, 3 modificados)

## Accomplishments
- Migration `onboarding_progress` org-scoped com RLS ob_select(member)/ob_write(owner), CHECK em current_step, idempotente — **escrita no disco, ainda NÃO aplicada**.
- `useOnboardingProgress`: lê o persistido + auto-detecta os 4 passos pelo estado real (ml_tokens com access_token, tiny_access_token, ml_product_costs cost>0, ml_tax_config), expõe currentStep/completedSteps/isComplete/completeStep via react-query.
- `OnboardingWizard` (rhf + shadcn Dialog/Progress/Card/Button): 5 passos na ordem correta, Tiny com "Pular", CTAs para /integracoes e /precos-custos, dispensável, restrito a owner.
- `OnboardingBanner`: banner compacto com Progress (X de N) + CTA "Continuar configuração" que abre o wizard, botão de dispensar, não-bloqueante.
- Wiring: banner no topo do dashboard (acima do conteúdo), CTA "Começar configuração" no empty state "sem ML", AcceptInvite mantém redirect a "/" para owner novo sem route-guard bloqueante.

## Task Commits

1. **Task 1: Migration onboarding_progress + hook useOnboardingProgress** - `3f85e4dc` (feat)
2. **Task 2: OnboardingWizard + OnboardingBanner (rhf + shadcn)** - `8cfc84a6` (feat)
3. **Task 3: Wiring no dashboard e AcceptInvite + CTA no empty state** - `d05066a3` (feat)
4. **Task 4: [BLOCKING] Aplicar migration via MCP + checkpoint visual (Wesley)** - **AGUARDANDO CHECKPOINT** (human-action, gate=blocking-human)

## Files Created/Modified
- `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql` - Tabela onboarding_progress (org-scoped) + RLS member-read/owner-write. **NÃO APLICADA.**
- `src/hooks/useOnboardingProgress.ts` - Read/write de onboarding_progress + auto-detecção de passos pelo estado real.
- `src/components/onboarding/OnboardingWizard.tsx` - Wizard multi-step rhf + shadcn, não-bloqueante, owner-only.
- `src/components/onboarding/OnboardingBanner.tsx` - Banner/CTA não-bloqueante no topo do dashboard.
- `src/integrations/supabase/types.ts` - Adicionada (à mão) a tabela onboarding_progress.
- `src/pages/MercadoLivre.tsx` - Render do OnboardingBanner no topo + CTA no empty state que abre o wizard.
- `src/pages/AcceptInvite.tsx` - Owner novo segue para "/" onde o banner aparece (comentário de intenção; sem route-guard).

## Verification Results
- **Task 1 verify:** grep PASS (CREATE TABLE, onboarding_progress, is_org_member, hook contém onboarding_progress + completeStep/currentStep).
- **Task 2 verify:** grep PASS (react-hook-form, useOnboardingProgress, Progress); tsc sem erro nos arquivos de onboarding.
- **Task 3 verify:** grep PASS (OnboardingBanner em MercadoLivre.tsx); `npx tsc --noEmit` = **0 erros**; `npm run build` = **EXIT 0** (built in 18.29s).
- Aviso de chunk >500kB no build é pré-existente e fora de escopo.

## Decisions Made
- Coluna Tiny no `ml_tokens` é `tiny_access_token` (não `tiny_token`) — corrigido no hook durante a Task 1 (ver Deviations).
- Onboarding "completo" exige apenas os passos obrigatórios (connect_ml, costs, fiscal); Tiny é opcional e pulável.
- `OnboardingWizard` e `OnboardingBanner` renderizam `null` para não-owner — alinhado ao RoleRoute pattern e à regra CLAUDE.md de config restrita a owner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Nome de coluna Tiny incorreto no hook de auto-detecção**
- **Found during:** Task 1 (useOnboardingProgress)
- **Issue:** O hook referenciava `tiny_token` em `ml_tokens`, que não existe no schema/types — causaria erro de tipo no tsc e detecção quebrada do passo Tiny.
- **Fix:** Trocado para `tiny_access_token` (coluna real verificada em types.ts).
- **Files modified:** src/hooks/useOnboardingProgress.ts
- **Verification:** `npx tsc --noEmit` = 0 erros.
- **Committed in:** 3f85e4dc (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Correção mínima de nome de coluna; sem scope creep.

## Issues Encountered
None - as três tasks auto executaram conforme planejado.

## Known Stubs
None - todos os componentes recebem dados reais via useOnboardingProgress (que consulta tabelas reais). A tabela onboarding_progress ainda não existe em produção (Task 4 pendente), mas o hook degrada graciosamente (maybeSingle retorna null e os passos são auto-detectados pelo estado real existente).

## User Setup Required
None - sem configuração de serviço externo. **PORÉM:** a migration `20260614123000_tenant04_onboarding_progress.sql` precisa ser aplicada em produção (`ckcdevcxgvueywivefgx`) via Supabase MCP `apply_migration` — Task 4, com aprovação de Wesley. NUNCA `supabase db push` (CLI linkado no projeto errado).

## Next Phase Readiness
- Frontend pronto: deploya via push -> Vercel.
- **Task 4 (checkpoint blocking-human) — RESOLVIDA (2026-06-14):** Wesley aprovou; migration aplicada via MCP `apply_migration` no `ckcdevcxgvueywivefgx`. Auditoria pré-apply confirmou schema (organizations PK id uuid; is_org_member/get_org_role com ordem `(_user_id, _org_id)`; enum org_role tem 'owner'). Validado via execute_sql: tabela existe, RLS ativo, 5 colunas, policies ob_select+ob_write, check constraint OK. **Pendente apenas o checkpoint VISUAL** (Wesley verificar banner/wizard no frontend após push->Vercel).
- Wave 3 (43-04, isolamento) liberada.

## Self-Check: PASSED

- FOUND: supabase/migrations/20260614123000_tenant04_onboarding_progress.sql
- FOUND: src/hooks/useOnboardingProgress.ts
- FOUND: src/components/onboarding/OnboardingWizard.tsx
- FOUND: src/components/onboarding/OnboardingBanner.tsx
- FOUND commit 3f85e4dc (Task 1), 8cfc84a6 (Task 2), d05066a3 (Task 3)

---
*Phase: 43-multi-tenant-hardening*
*Completed: 2026-06-14*
