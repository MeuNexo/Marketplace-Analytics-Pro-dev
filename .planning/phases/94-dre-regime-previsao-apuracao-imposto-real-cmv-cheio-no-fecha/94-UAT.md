---
status: testing
phase: 94-dre-regime-previsao-apuracao-imposto-real-cmv-cheio-no-fecha
source: [94-VERIFICATION.md]
started: 2026-07-11T13:30:00Z
updated: 2026-07-11T13:30:00Z
---

## Current Test

number: 1
name: Reconciliação de junho/2026 no card DRE de /vendas — previsão↔apuração
expected: |
  Junho/2026 reconcilia ao centavo em apuração; previsão fica idêntica ao
  validado 2026-07-10; botão só aparece para owner; empurrãozinho é só dica.
awaiting: user response

## Tests

### 1. Reconciliação de junho/2026 no card DRE de /vendas — previsão↔apuração
expected: |
  Owner abre `/vendas` como owner da Pé Vermeio, navega o card "DRE do Mês" para
  Junho/2026 e confirma:
  - Previsão (selo âmbar) idêntica ao validado em 2026-07-10.
  - Clica "Marcar mês como apurado" → selo vira emerald "Apurado — guias de 07/2026".
  - CMV vira cheio (~R$ 133.264,87) e o imposto vira a guia real M+1 (ICMS de
    julho R$ 5.151,56 + PIS/COFINS), NÃO a guia de junho (R$ 4.793,21).
  - Clica "Reabrir mês" → volta para Previsão.
  - Uma sessão non-owner vê o selo mas NÃO vê o botão marcar/reabrir.
  - Se as 3 guias já saíram do placeholder, o empurrãozinho 🟢 aparece e NÃO
    fecha o mês sozinho (é só dica).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
