---
phase: 57-nexo-conversacional-chat-consultor
plan: 03
subsystem: frontend / nexo-chat-ui
tags: [nexo-chat, fab, sheet, ephemeral-state, anti-xss, kill-switch, vitest, tdd]
requires:
  - EF nexo-chat (57-01/57-02) — invoke alvo { org_id, messages } → { reply, used_tools, fallback } | { disabled }
  - MLStoreContext.hasMLConnection (gate de ML conectado)
  - consultor_config.llm_enabled (kill-switch, NEXO-06)
  - useOrganization().currentOrg.id (escopo da org)
provides:
  - "useNexoChat: estado efêmero de mensagens (in-memory) + mutation que invoca nexo-chat com o histórico inteiro a cada turno"
  - "NexoChatPanel: Sheet lateral com lista de mensagens (ScrollArea), input (textarea/Enter), estados loading/erro; render anti-XSS por parágrafos"
  - "NexoChatFab: FAB fixed bottom-right com gate hasMLConnection + kill-switch; abre o painel"
  - "FAB montado no LayoutShell (fora do <main>) → presente em todas as telas autenticadas"
affects:
  - src/components/layout/LayoutShell.tsx (monta <NexoChatFab/>)
tech-stack:
  added: []
  patterns:
    - "Histórico de chat em useState (efêmero, client-held) reenviado inteiro a cada turno — sem tabela, sem localStorage (NEXO-04)"
    - "Render de texto LLM como <p> via split(\\n) — sem markdown renderer, sem injeção de HTML cru (anti-XSS, T-57-13)"
    - "Gate de visibilidade do FAB lido proativamente (useMLStore + query consultor_config.llm_enabled); linha ausente = habilitado"
key-files:
  created:
    - src/hooks/useNexoChat.ts
    - src/hooks/useNexoChat.test.tsx
    - src/components/nexo/NexoChatPanel.tsx
    - src/components/nexo/NexoChatFab.tsx
    - src/components/nexo/NexoChatFab.test.tsx
  modified:
    - src/components/layout/LayoutShell.tsx
decisions:
  - "Auto-scroll via sentinel ref + scrollIntoView (ScrollArea do projeto não expõe viewportRef — o viewport é interno ao primitivo Radix)"
  - "Kill-switch lido client-side (query consultor_config.llm_enabled) para esconder o FAB proativamente, em vez de abrir o painel e mostrar 'indisponível' — recomendação do RESEARCH (opção a)"
  - "Comentários reescritos para não conter o literal 'dangerouslySetInnerHTML' — o grep de verify do plano é literal (! grep -q) e não distingue comentário de código"
metrics:
  duration_min: 6
  completed: 2026-06-24
  tasks: 3
  files: 6
  commits: 5
status: complete
---

# Phase 57 Plan 03: Painel de chat flutuante "Nexo" (FAB + Sheet + hook efêmero) Summary

O Nexo ganhou rosto no app: um FAB flutuante (montado no LayoutShell, presente em todas as telas autenticadas) que só aparece com ML conectado + kill-switch ligado, abrindo um Sheet de conversa multi-turno cujo histórico vive 100% no estado React e é reenviado inteiro à EF `nexo-chat` a cada turno — render anti-XSS por parágrafos, read-only.

## What Was Built

- **src/hooks/useNexoChat.ts** — hook de estado efêmero. `useState<ChatMsg[]>` (in-memory, sem persistência); `send(text)` faz push da msg do user no formato Gemini `{ role:'user', parts:[{text}] }`, `setMessages(nextMessages)`, invoca `supabase.functions.invoke("nexo-chat", { body:{ org_id: currentOrg.id, messages: nextMessages } })` com o **histórico acumulado inteiro** (prova de NEXO-04); ao sucesso, se `data.disabled` (kill-switch) não faz append, senão anexa a reply como `{ role:'model', parts:[{text}] }`. Expõe `messages`, `send`, `reset`, `loading` (isPending), `error`. Sem localStorage de mensagens, sem tabela.
- **src/components/nexo/NexoChatPanel.tsx** — `NexoChatPanel({ open, onOpenChange })`: `Sheet side="right"` (largura responsiva sm:max-w-md / md:max-w-lg). Header com `Sparkles` + "Nexo". Corpo: `ScrollArea` com bolhas distintas user (self-end, bg-primary) vs model (self-start, bg-muted); cada texto renderizado como `<p>` via `split("\n")` (igual ConsultorLLMSummary; **sem** markdown renderer, **sem** injeção de HTML cru). Indicador "Nexo está pensando…" + spinner em `loading`. Footer: `Textarea` (Enter envia, Shift+Enter quebra linha) + botão `Send`; em erro do `mutateAsync` dispara `toast.error` (sonner). Estado vazio com boas-vindas curtas. Auto-scroll por sentinel ref. Nenhum botão dispara mutação ML (read-only).
- **src/components/nexo/NexoChatFab.tsx** — `NexoChatFab`: lê `useMLStore().hasMLConnection` e o kill-switch via `useQuery` em `consultor_config.llm_enabled` por `currentOrg.id` (`.maybeSingle()`, linha ausente = habilitado). `if (!hasMLConnection) return null; if (llmEnabled === false) return null;` (NEXO-01 + NEXO-06). Caso contrário, `Button` `fixed bottom-6 right-6 z-50` redondo (`shadow-glow`, ícone `Sparkles`, `aria-label="Abrir Nexo"`) que `setOpen(true)`, + `<NexoChatPanel open onOpenChange/>`.
- **src/components/layout/LayoutShell.tsx** — import + `<NexoChatFab/>` montado **fora do `<main>`** (irmão do bloco de conteúdo), dentro do container do shell → presente em todas as telas autenticadas do app principal.
- **Testes (TDD):**
  - `src/hooks/useNexoChat.test.tsx` (4 testes) — invoke alvo `nexo-chat` com `org_id`+msg do user; histórico user+model após reply; **2º send reenvia 3 mensagens acumuladas**; kill-switch (`disabled:true`) não anexa reply; nenhuma escrita de conversa em localStorage.
  - `src/components/nexo/NexoChatFab.test.tsx` (3 testes) — gate (a) `hasMLConnection=false` → sem botão; (b) `llm_enabled=false` → sem botão; (c) ML+habilitado → botão renderizado.

## Task → Commit

| Task | Nome | Tipo | Commit |
|------|------|------|--------|
| 1 (RED) | Teste useNexoChat (histórico efêmero) | test | `f33dad2b` |
| 1 (GREEN) | useNexoChat.ts | feat | `48a0ef7c` |
| 2 | NexoChatPanel.tsx (Sheet + anti-XSS) | feat | `b7744ef5` |
| 3 (RED) | Teste NexoChatFab (gate de visibilidade) | test | `ff9def3d` |
| 3 (GREEN) | NexoChatFab.tsx + mount no LayoutShell | feat | `c95d9196` |

## Verification Results

- `npm run test -- --run useNexoChat.test` → **4 passed** (efêmero acumulado, reenvio a cada turno, kill-switch sem append, sem persistência).
- `npm run test -- --run NexoChatFab.test` → **3 passed** (os 3 casos de gate).
- Grep Task 2: `useNexoChat` ✓ + `split` ✓ + ausência de `dangerouslySetInnerHTML` ✓ → **PASS**.
- Grep Task 3: `NexoChatFab` em LayoutShell ✓ + `hasMLConnection` em NexoChatFab ✓ → **PASS**.
- `npm run build` (tsc + vite) → **verde** (built em ~19s).
- `npx vitest run` (suite completa) → **145 passed (16 files)**, incluindo as novas useNexoChat (4) + NexoChatFab (3).
- `npm run lint` → 0 erros/warnings nos arquivos novos (`src/hooks/useNexoChat.*`, `src/components/nexo/NexoChat*`). Os 304 problemas reportados são pré-existentes em arquivos não tocados por este plano (fora de escopo).

## Threat Model Compliance

- **T-57-13 (XSS no render da reply):** texto split por `\n` em `<p>` (React escapa); sem markdown renderer; sem injeção de HTML cru. Provado pelo grep (ausência de `dangerouslySetInnerHTML`). ✓
- **T-57-14 (FAB visível sem ML/contexto):** gate `hasMLConnection` + kill-switch `llm_enabled` → `null`. NexoChatFab.test prova os 3 casos. ✓
- **T-57-15 (mutação ML pelo chat):** painel é só conversa; nenhum botão de ação ML. Ação concreta encaminha à fila da Phase 54. ✓
- **T-57-16 (persistência indevida do histórico):** efêmero, em memória; sem localStorage de mensagens (teste prova), sem tabela. ✓
- **T-57-SC (installs):** zero pacotes novos. ✓

## Deviations from Plan

**1. [Rule 3 — bloqueio] Comentários reescritos para não conter o literal `dangerouslySetInnerHTML`**
- **Encontrado durante:** Task 2 (verify grep `! grep -q "dangerouslySetInnerHTML"`).
- **Issue:** Os comentários documentando a postura anti-XSS continham a palavra `dangerouslySetInnerHTML` ("SEM dangerouslySetInnerHTML…"), fazendo o grep literal do plano falhar mesmo sem nenhum uso real do atributo.
- **Fix:** Reescritos os 2 comentários para "sem injeção de HTML cru" — mantém o sentido sem o token literal. Nenhum uso de `dangerouslySetInnerHTML` em código existiu em momento algum.
- **Arquivos:** src/components/nexo/NexoChatPanel.tsx.
- **Commit:** `b7744ef5`.

**2. [Rule 3 — bloqueio] Auto-scroll via sentinel ref em vez de `viewportRef` na ScrollArea**
- **Encontrado durante:** Task 2 (escrita do painel).
- **Issue:** A `ScrollArea` do projeto (`src/components/ui/scroll-area.tsx`) não expõe um `viewportRef` — o `Viewport` do Radix é interno ao componente. Um `viewportRef` passado ao `Root` não alcançaria o elemento rolável.
- **Fix:** `<div ref={bottomRef}/>` no fim da lista + `bottomRef.current?.scrollIntoView()` no efeito de `[messages, loading]`. Funciona independente do interno do primitivo.
- **Arquivos:** src/components/nexo/NexoChatPanel.tsx.
- **Commit:** `b7744ef5`.

Nenhum bug (Rule 1), funcionalidade crítica faltante (Rule 2) ou mudança arquitetural (Rule 4).

## Known Stubs

Nenhum. `useNexoChat` está totalmente ligado à EF `nexo-chat`; o painel e o FAB consomem dados reais (mensagens da conversa, `hasMLConnection`, `consultor_config.llm_enabled`). Sem valores hardcoded vazios fluindo para a UI.

## Not in Scope (por design)

- **Deploy da EF nexo-chat:** fora deste plano (frontend only). Deploy é checkpoint do orquestrador / Plan 57-04.
- **Roteamento de ação concreta → aprovação:** Phase 54 (`proposed_actions`). O chat é read-only e apenas sugere/encaminha.
- **Streaming de tokens:** a EF é non-streaming (57-01); o painel mostra a reply completa de uma vez.
- **Persistência opcional / multi-loja por aba:** não pedido (NEXO-04 é explicitamente efêmero).

## Self-Check: PASSED

- FOUND: src/hooks/useNexoChat.ts
- FOUND: src/hooks/useNexoChat.test.tsx
- FOUND: src/components/nexo/NexoChatPanel.tsx
- FOUND: src/components/nexo/NexoChatFab.tsx
- FOUND: src/components/nexo/NexoChatFab.test.tsx
- FOUND: src/components/layout/LayoutShell.tsx (monta <NexoChatFab/>)
- FOUND commit f33dad2b, 48a0ef7c, b7744ef5, ff9def3d, c95d9196
