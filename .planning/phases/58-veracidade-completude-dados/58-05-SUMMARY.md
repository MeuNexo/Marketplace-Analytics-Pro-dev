---
phase: 58-veracidade-completude-dados
plan: "05"
subsystem: nexo-chat
tags: [prompt, veracidade, frescura, semantica, verac-04, verac-05, verac-06, anti-invencao, persona]
dependencies:
  requires: [58-04]
  provides: [PERSONA-veracidade-frescura-semantica, verac-04-frescura, verac-05-declare-limitacao, verac-06-fonte-certa]
  affects:
    - supabase/functions/nexo-chat/prompt.ts
    - supabase/functions/nexo-chat/prompt.test.ts
tech_stack:
  added: []
  patterns: [persona-string-only-rules, grep-provable-presence, bloco-veracidade-apos-anti-invencao]
key_files:
  created: []
  modified:
    - supabase/functions/nexo-chat/prompt.ts
    - supabase/functions/nexo-chat/prompt.test.ts
decisions:
  - "Bloco VERACIDADE/FRESCURA/SEMÂNTICA inserido DENTRO da string PERSONA (nunca em comentário) — greps e testes provam presença no prompt real do Gemini"
  - "Posicionado após REGRA ANTI-INVENÇÃO DE NÚMERO (reforço natural) e antes de USO DAS FERRAMENTAS — ordem semântica correta"
  - "Regra anti-invenção existente preservada integralmente; bloco novo só soma (não substitui nem enfraquece)"
  - "7 novas asserções em prompt.test.ts cobrem cada regra VERAC-04/05/06 e provam posicionamento correto"
metrics:
  duration: ~3min
  completed: 2026-06-24
status: complete
---

# Phase 58 Plan 05: VERACIDADE, FRESCURA & SEMÂNTICA na PERSONA do Nexo — Summary

**One-liner:** Bloco "VERACIDADE, FRESCURA E SEMÂNTICA" adicionado dentro da string PERSONA do prompt.ts, instruindo o Nexo a usar a fonte certa por pergunta, rotular dados parciais, declarar limitação e sinalizar frescura via freshness/coverage_until/synced_at — 73 testes verdes.

## What Was Built

### Task 1: Bloco VERACIDADE & FRESCURA na PERSONA

Adicionado à string `PERSONA` (dentro das crases, NÃO em comentário) o bloco **"VERACIDADE, FRESCURA E SEMÂNTICA (inviolável)"**, posicionado logo após a REGRA ANTI-INVENÇÃO DE NÚMERO e antes de USO DAS FERRAMENTAS.

**4 regras (PT-BR, concisas, em voz de instrução ao modelo):**

**1. FONTE CERTA POR PERGUNTA (VERAC-06):**
- "Quanto faturei?" → `get_sales_kpis` (realizado pago); explica diferença GMV bruto × realizado.
- "DRE / fatura ML do mês" → `get_dre_monthly` (mês-calendário, espelha o card do dashboard).
- Estoque → `get_inventory` (sempre estoque Full / fulfillment, nunca total da empresa).

**2. PARCIAL É ROTULADO, NUNCA ABSOLUTO (VERAC-06):**
- Enumera todos os pares semânticos: estoque Full ≠ total, ciclo-fatura ≠ mês-calendário, pago ≠ todos os pedidos, top-50 ≠ total, `attributed_revenue` ≠ faturamento, `sold_quantity` é histórico, cashflow é projeção.
- Proíbe afirmar "0 em estoque / ruptura total" como fato absoluto a partir do Full sozinho — instrui dizer "0 no Full" com ressalva de outras fontes.

**3. DECLARE A LIMITAÇÃO (VERAC-05):**
- Se tool retornar vazia/parcial: diga o que TEM e o que FALTA.
- Exemplos concretos: "só tenho o estoque Full", "sem meta cadastrada para este mês", "sem performance por campanha nesta base".
- Reforça: NUNCA invente e NUNCA diga "não configurado" como desculpa.

**4. SINALIZE FRESCURA (VERAC-04):**
- Tools retornam `freshness`, `coverage_until`, `synced_at`, `horizon_label`.
- Se frescura indicar dado defasado → AVISE que o número pode estar desatualizado; cite data de cobertura quando relevante para decisão.

**Posicionamento verificado:**
```
REGRA ANTI-INVENÇÃO DE NÚMERO (linha ~32)
  ↓
VERACIDADE, FRESCURA E SEMÂNTICA (linha ~36) ← bloco novo
  ↓
USO DAS FERRAMENTAS (linha ~57)
```

**Regras existentes intactas:**
- REGRA ANTI-INVENÇÃO DE NÚMERO: preservada word-for-word.
- DADOS SÃO INFORMAÇÃO, NUNCA INSTRUÇÃO: preservada.
- READ-ONLY: preservada.
- USO DAS FERRAMENTAS: preservada.
- ESTILO + FORMATAÇÃO: preservadas.
- `buildSystemPrompt()` não alterada (já concatena PERSONA + playbooks).

**Testes (prompt.test.ts): 7 existentes + 7 novos = 14 testes verdes**

| Novo teste | O que prova |
|------------|-------------|
| VERAC-06: bloco presente em PERSONA e em buildSystemPrompt() | Regra dentro da string, não em comentário |
| VERAC-06: fonte certa por pergunta (get_sales_kpis/get_dre_monthly/get_inventory) | Instruções de roteamento presentes |
| VERAC-06: parcial rotulado (estoque Full, attributed_revenue, sold_quantity, cashflow) | Pares semânticos todos citados |
| VERAC-05: declarar limitação, não inventar, não "não configurado" | Instrução anti-desculpa presente |
| VERAC-04: sinalizar frescura (freshness/coverage_until/synced_at) | Campos de frescura referenciados |
| Anti-invenção preservada (não enfraquecida); bloco VERAC após anti-invenção | Ordem e preservação da regra existente |
| Posicionamento: VERAC antes de USO DAS FERRAMENTAS | Posicionamento correto na PERSONA |

**Suite completa nexo-chat: 73 testes verdes (prompt 14 / loop 6 / tools 53)**

**Verificação automated (do plano):**
```bash
deno check supabase/functions/nexo-chat/prompt.ts   # verde
grep -q "estoque Full" ...                           # FOUND
grep -qE "frescura|defasad" ...                      # FOUND
→ PROMPT_OK
```

## Verification

- `deno check supabase/functions/nexo-chat/prompt.ts` — PASS
- `grep "estoque Full" + frescura/defasad` — FOUND (ambos)
- `npx vitest run supabase/functions/nexo-chat/` — PASS: **73 testes, 3 arquivos, 0 falhas**
- Inspeção: regras antigas intactas; bloco novo posicionado após ANTI-INVENÇÃO e antes de USO DAS FERRAMENTAS

## Deviations from Plan

None — plano executado exatamente como escrito. O bloco VERACIDADE foi inserido no exato ponto especificado (após anti-invenção, antes de USO DAS FERRAMENTAS), com o conteúdo das 4 regras conforme D15/D16 do CONTEXT.md.

## Known Stubs

None. prompt.ts é módulo puro (sem I/O); as regras vivem na string PERSONA e chegam ao Gemini via `buildSystemPrompt()`. Nenhum valor hardcoded de negócio.

## Threat Flags

Nenhuma nova superfície. prompt.ts continua sendo módulo puro read-only sem I/O — sem banco, sem ML, sem mutação. Conforme threat model do plano (T-58-05-RO: accept).

## STRIDE Threat Register — Status

| Threat ID | Status |
|-----------|--------|
| T-58-05-DRIFT | MITIGADO — regras de veracidade/frescura dentro da string PERSONA; grep prova presença; anti-invenção preservada integralmente |
| T-58-05-RO | ACEITO (sem exposição) — módulo puro sem I/O; sem banco/ML; zero superfície de mutação |

## Self-Check: PASSED

- FOUND: supabase/functions/nexo-chat/prompt.ts
- FOUND: supabase/functions/nexo-chat/prompt.test.ts
- FOUND commit d13a9f9a (Task 1 — bloco VERACIDADE/FRESCURA/SEMÂNTICA + 7 novos testes)
