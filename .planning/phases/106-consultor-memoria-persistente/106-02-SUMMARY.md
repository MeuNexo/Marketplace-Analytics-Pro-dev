---
phase: 106
plan: "106-02"
status: complete
date: 2026-07-29
commit: 2ff1e0a2
---

# 106-02 — SUMMARY (EF nexo-chat v10 em prod)

## Entregue

- **`memory.ts` (novo):** `loadHistory` (valida dono **e** org antes de ler),
  `createConversation`, `appendMessage`, `loadMemories`, `renderMemoryBlock`.
  Teto: `MAX_MEMORIES=30`, `MAX_HISTORY_MESSAGES=40`.
- **`index.ts`:** aceita **dois contratos** — novo `{ conversation_id?, message }` e o
  legado `{ messages }`. Persiste só no novo (o legado não tem `conversation_id` e criaria
  uma conversa por turno). Grava o turno do usuário antes e o do modelo depois, com
  `used_tools`. Resposta ganhou `conversation_id` e `memories_used`.
- **`prompt.ts`:** `buildSystemPrompt(memoryBlock?)` — memória entra entre a persona e os
  playbooks; bloco vazio é omitido inteiro.
- **`tools.ts`:** `propose_memory` — **única tool de escrita**, só em `nexo_memories`,
  sempre `status='pending'`. `ctx` ganhou `userId`/`conversationId`.
- **`loop.ts`:** repassa o `ctx` estendido ao dispatcher.

## Provas

- **142 testes na EF** (era 123): `memory.test.ts` novo (10) + 6 de `propose_memory` +
  2 da injeção no prompt. `tsc --noEmit` 0.
- Deploy: **nexo-chat v10 ACTIVE** (2026-07-29 18:08, script 154,3 kB). Smoke: POST sem
  JWT → **401**.
- E2E em prod (service_role, simulando um turno): 2 mensagens persistidas; proposta nasceu
  **`pending`**; com `pending` a contagem de fatos injetáveis (`status='active'`) foi
  **0** — prova de que proposta não aprovada **não** entra no prompt; após o UPDATE de
  aprovação virou **1**. Seed removido (base zerada).

## Decisões de implementação

- Contrato legado mantido de propósito: evita janela de quebra entre o deploy da EF e o
  do frontend.
- `nexo_messages` sem policy de UPDATE — mensagem é registro, não se reescreve.
- `propose_memory` com `scope='user'` mas sem `userId` do servidor cai para `'org'`,
  respeitando o CHECK do schema em vez de estourar erro no insert.
- `type` inválido vindo do modelo vira `'context'` (nunca viola o CHECK).
