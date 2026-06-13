# Phase 43: Multi-Tenant Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 43-multi-tenant-hardening
**Areas discussed:** Órfãos (TENANT-02), Quota (TENANT-03), Wizard (TENANT-04), RLS org-first (TENANT-01)

---

## Órfãos (TENANT-02)

### Rodada 1 — estratégia geral

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill p/ Pé Vermeio | Atribuir todas as linhas órfãs à org Pé Vermeio. Preserva histórico. | ✓ (refinado depois) |
| Deletar órfãos | Apagar linhas com organization_id NULL. | |
| Backfill + NOT NULL + guard | Backfill, NOT NULL, guard nas EFs. | |

### Rodada 2 — refinamento (após pesquisa)

| Option | Description | Selected |
|--------|-------------|----------|
| Híbrido: delete cache, backfill config | Caches regeneráveis órfãos → delete (sync recria); config não-regenerável → backfill. Planner define matriz. | ✓ |
| Backfill tudo p/ Pé Vermeio | Atribuir toda linha órfã à Pé Vermeio, sem deletar. | |

**User's choice:** Híbrido (delete cache regenerável, backfill config) + NOT NULL/guard
**Notes:** Backfill via `ml_tokens` (não `organization_members`) para evitar duplicação em users multi-org — pitfall trazido pela pesquisa.

---

## Quota (TENANT-03)

### Rodada 1 — comportamento ao exceder

| Option | Description | Selected |
|--------|-------------|----------|
| Bloqueia no dispatch + log | check_quota antes do sync; não dispara se excedeu; loga. Enterprise (-1) nunca bloqueia. | ✓ |
| Degrada silencioso | Pula sync sem erro visível. | |
| Avisa mas permite | Loga warning e deixa rodar. | |

### Rodada 2 — escopo do enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Só sync (intervalo + contagem/dia) | Phase 43 enforça sync_interval_minutes + sync_quota_daily; history_days/nº lojas → Phase 44. | ✓ |
| Sync + history_days agora | Também limita janela de histórico já na Phase 43. | |

**User's choice:** Bloqueia no dispatch + log; escopo só sync na Phase 43
**Notes:** Reusar `checkAndIncrementQuota()` de sync-ml-inventory; tabelas já existem.

---

## Wizard (TENANT-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Não-bloqueante: banner + CTA | Card de progresso no dashboard + CTA em empty states. Owner navega livre. Progresso persistido. | ✓ |
| Bloqueante: route-guard | Trava o app até conectar ML. | |
| Híbrido | Bloqueia só Conectar ML; resto é banner. | |

**User's choice:** Não-bloqueante (banner + CTA)
**Notes:** Nova tabela `onboarding_progress`; hand-roll rhf+shadcn sem novas deps (OnboardJS descartado por isso). Passos: ML → Tiny(opcional) → Custos → Fiscal → Pronto.

---

## RLS org-first (TENANT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| org_id scope + manter user_id | Policies via is_org_member; user_id vira auditoria; service role upsert livre. Backfill org_id. | ✓ |
| Trocar user_id→org_id totalmente | Remover user_id, escopo 100% organization_id. | |
| Você decide (planner) | Planner escolhe pela pesquisa. | |

**User's choice:** org_id scope + manter user_id como auditoria
**Notes:** Pesquisa achou 2 migrations conflitantes de RLS em ml_product_costs → consolidar. Ajustar useMLProductCosts.fetchAll (lê por user_id) para ler por org.

---

## Claude's Discretion

- Matriz exata delete-vs-backfill por tabela (planner decide pelas contagens reais via MCP).
- Forma do RPC check_quota (SQL puro vs inline na EF de dispatch).
- Layout visual do banner/wizard.

## Deferred Ideas

- Enforcement de history_days por tier + nº de lojas ML → Phase 44 (PAY-04).
- Stripe Checkout / webhooks / /planos → Phase 44.
- Self-service signup público → v8.0.
- Consultor v1 → Phase 45.
