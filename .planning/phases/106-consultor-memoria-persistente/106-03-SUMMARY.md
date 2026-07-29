---
phase: 106
plan: "106-03"
status: complete
date: 2026-07-29
commit: 5357d4bc
---

# 106-03 — SUMMARY (frontend)

## Entregue

- **`useNexoChat` reescrito:** `send()` manda `{ org_id, conversation_id, message }` —
  nunca mais a conversa inteira. Ganhou `conversationId`, `conversations` (useQuery),
  `openConversation`, `newConversation`, `archiveConversation`. Rollback do otimista
  quando o invoke falha. `reset` mantido como alias de `newConversation` (compat).
- **`useNexoMemory` (novo):** `pending`/`active`/`archived` + `approve`, `discard`,
  `edit`, `create`. Escrita direta sob RLS (padrão de config simples do projeto, sem RPC).
  Criação manual nasce `active` — o usuário é a autoridade.
- **`NexoChatPanel`:** ícone de histórico (dropdown das conversas salvas), botão de nova
  conversa e o card **"O Nexo quer lembrar disso"** com Aprovar/Descartar, incluindo o
  aviso de fato que contém número.
- **`/nexo-memoria` (novo):** fila de aprovação, abas "Em uso"/"Removidas", editar,
  adicionar fato manual, marca visual de perecível. Linguagem de leigo (padrão da 63-05):
  "O que o Nexo lembra", "Contém número", sem jargão de LLM.
- **Rota** em `App.tsx` (lazy + ErrorBoundary) e `roleAccess` `OPERATIONAL` — viewer é
  default-deny, espelhando a RLS.

## Provas

- **737 testes verdes** (50 arquivos; era 716), `tsc --noEmit` 0, `vite build` OK.
- `useNexoChat.test.tsx` reescrito para o contrato novo: prova que o 2º turno manda só a
  mensagem nova + o `conversation_id`, e que `messages` não é mais enviado.

## Desvio do plano (registrado)

O plano previa ligar a interação **nos dois ramos** de layout (mobile/desktop), por causa
do padrão `MLAnuncios`. **Não se aplica:** `NexoChatPanel` é um popup flutuante único,
responsivo por CSS (`w-[min(380px,calc(100vw-2rem))]`) — não há ramo duplicado. Nenhuma
interação ficou pela metade.

## Pendente

- **Ok visual do Wesley** (chat + `/nexo-memoria`) — inclusive validar se o Nexo propõe
  memória de forma sensata na conversa real, e não em excesso.
