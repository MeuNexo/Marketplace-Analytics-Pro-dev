---
quick_id: 260729-o7w
slug: fix-guardrails-nexo-chat-loop
date: 2026-07-29
status: complete
commit: f341a17d
---

# Quick 260729-o7w — SUMMARY

## Causa-raiz confirmada por leitura de código

O "Sem resposta." reportado por Wesley é string literal de `loop.ts` — o fallback usado
quando o candidato do Gemini volta **sem `text` e sem `functionCall`**. No Gemini 2.5 os
thinking tokens contam dentro de `maxOutputTokens`; com teto 1200 + `thinkingBudget: -1`
(dinâmico), uma pergunta multi-domínio consome o orçamento inteiro raciocinando e retorna
`parts: []` com `finishReason: MAX_TOKENS`.

Config de prod estava correta (`llm_enabled=true`, `llm_model=gemini-2.5-pro`) e as RPCs
das Phases 103-105 foram validadas contra o banco real em 07-28 — o defeito era só o
dimensionamento dos guardrails do turno.

## Mudanças (commit f341a17d)

`supabase/functions/nexo-chat/loop.ts`:
- `MAX_TOOL_ITERS` 5 → 8
- `TURN_DEADLINE_MS` 25_000 → 75_000
- `maxOutputTokens` 1200 → 8192 (nova const exportada `MAX_OUTPUT_TOKENS`)
- `thinkingBudget` -1 → 2048 fixo (nova const exportada `THINKING_BUDGET`)
- log por iteração de `finishReason` + `usageMetadata` (prompt/candidates/thoughts/total) —
  só metadados
- log de erro explícito quando o candidato volta sem `parts`

`supabase/functions/nexo-chat/loop.test.ts`:
- cap 5 → `MAX_TOOL_ITERS` (8); asserção `thinkingBudget === THINKING_BUDGET` mantendo
  a invariante `!== 0`
- asserção de que sobra >4000 tokens para a resposta depois do thinking
- **teste de regressão novo:** candidato sem parts + `finishReason: MAX_TOKENS` → prova o
  fallback exato do bug de 2026-07-29
- asserção do deadline de 75s

## Provas

- `npx vitest run supabase/functions/nexo-chat` → **122 testes verdes** (era 120)
- `npx vitest run` (suíte completa) → **716 testes verdes**, 49 arquivos
- `npx tsc --noEmit` → **0 erros**

## Pendência

**Deploy NÃO executado.** `npx supabase functions deploy nexo-chat --project-ref
ckcdevcxgvueywivefgx` falhou com "Access token not provided" — o CLI não tem credencial
neste VPS (`~/.supabase` só tem telemetry.json, `SUPABASE_ACCESS_TOKEN` vazia) e o token
que o Wesley usou em 07-28 estava marcado para rotação.

Deploy via MCP `deploy_edge_function` foi descartado: exigiria reenviar os 5 fontes da EF
(160 KB — `tools.ts` 73 KB + `playbooks.ts` 63 KB), com risco de corrupção por
transcrição. O caminho correto é autenticar o CLI (`npx supabase login`, uma vez) e rodar
o deploy do disco.

**O código em prod segue com os guardrails antigos até o deploy.**
