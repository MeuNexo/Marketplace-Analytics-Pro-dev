---
status: complete
phase: 43-multi-tenant-hardening
source: 43-01-SUMMARY.md, 43-02-SUMMARY.md, 43-03-SUMMARY.md, 43-04-SUMMARY.md
started: 2026-06-14T12:42:24Z
updated: 2026-06-14T12:44:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Onboarding guiado (banner + wizard não-bloqueante)
expected: Banner no topo de "/" com progresso (X de 5) + CTA; wizard com 5 passos na ordem correta; CTAs levam às rotas; não-bloqueante; passos já feitos auto-detectados.
result: pass
confirmed: "Wesley: sim, banner aparece com os 5 passos"

### 2. Isolamento de dados entre lojas (RLS multi-tenant)
expected: Dados de uma loja/org não aparecem em outra. Verificado objetivamente no teste de isolamento 43-04 (contexto authenticated por org via JWT simulado): 0 vazamentos cross-org em 15 tabelas scope-org, bidirecional (Pé Vermeio ↔ Thales). Thales tem volume real (15.962 ads_products) e a Pé Vermeio não vê nada disso.
result: pass

### 3. Quota de sync (TENANT-03)
expected: Org em tier limitado é bloqueada ao exceder a quota diária; enterprise nunca bloqueia. Verificado: check_quota em tier limite=3 → [true,true,true,false,false]; enterprise (Pé Vermeio) → true sempre. Gate fail-closed em erro (CR-03).
result: pass

### 4. Endpoint de sync protegido (CR-01)
expected: process-sync-job (drain da fila) rejeita chamadas não autenticadas. Verificado em produção (v16): sem auth → 401, Bearer inválido → 401, service_role_key correto → 200 (cron preservado).
result: pass

### 5. Escrita de custos isolada por org (CR-02 / ME-06)
expected: Salvar custo grava na org correta (nunca org nula) e fica visível só para a org; viewer/owner não escreve billing. Verificado: ME-06 INSERT em billing → 42501 RLS; useMLProductCosts agora exige currentOrg.id (tsc/build limpos).
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
