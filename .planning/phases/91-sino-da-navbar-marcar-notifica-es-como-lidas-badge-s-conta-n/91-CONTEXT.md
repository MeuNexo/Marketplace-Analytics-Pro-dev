# Phase 91: Sino da navbar — marcar notificações como lidas - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Source:** Decisão direta com Wesley (AskUserQuestion 2026-07-07)

<domain>
## Phase Boundary

O sino de atendimento da navbar (`src/components/layout/AtendimentoBell.tsx`, alimentado por `src/hooks/useAtendimentoPendencias.ts`) hoje mostra um badge vermelho com o TOTAL de pendências vivas (perguntas `UNANSWERED` + reclamações `seller_action_required=true`). Um item só some quando é resolvido na origem.

Esta phase adiciona o conceito de "lido": o badge passa a contar só as **novidades ainda não vistas**. Abrir o sino marca tudo como visto e zera o badge; ele volta a subir apenas quando chega algo novo (via o refetch de 45s que reflete o webhook). A lista dentro do popover continua mostrando TODAS as pendências vivas — o "lido" afeta só o alerta, nunca a fila de trabalho.

**Fora de escopo:** dispensar item individual; sincronização cross-device; qualquer mudança em backend/EF/RPC/migration; mudança visual do sino além do número do badge.
</domain>

<decisions>
## Implementation Decisions

### Semântica (LOCKED — decisão Wesley)
- Modelo "badge de novidades" (padrão clássico de sino), NÃO "dispensar item individual".
- Não há botão de "marcar como lido" por item. **Abrir o popover** já marca todas as pendências atuais como vistas.
- A lista e o header do popover ("X item(s)") continuam refletindo o TOTAL de pendências vivas. Só o número do badge vermelho passa a ser "não-vistos".

### Persistência (LOCKED)
- Estado "visto" 100% client-side em `localStorage`, chaveado por org: `bell-seen:{orgId}`.
- Valor = conjunto (array serializado) das `key`s de pendência já vistas. As keys estáveis já existem em `useAtendimentoPendencias` (`q-{question_id}` / `c-{claim_id}`).
- Escopo por dispositivo/navegador — NÃO sincroniza entre aparelhos. Aprovado por ser UX simples.

### Comportamento de contagem (LOCKED)
- `unreadCount` = nº de itens atuais cuja `key` NÃO está no conjunto visto.
- Comparar por `key`, nunca por timestamp (o `data_abertura` de claim é só data — granularidade de dia daria falso-positivo).
- Ao abrir o popover (`onOpenChange(true)`): merge das keys atuais no conjunto visto **e** prune das keys que não estão mais entre as pendências vivas (item resolvido some → key sai do set). Isso evita crescimento infinito e evita que um item resolvido-e-reaberto ressuscite como "já visto".
- Estado inicial (primeira visita, sem localStorage): tratar todas as pendências atuais como já vistas OU como novas? **Decisão:** primeira carga NÃO deve explodir o badge com pendências antigas — na ausência de registro, semear o conjunto visto com as keys atuais na primeira montagem (badge começa em 0; só sobe quando chega algo genuinamente novo depois). 

### Arquitetura (LOCKED)
- Extrair lógica pura testável: `computeUnread(items, seenKeys)` e `mergeAndPruneSeen(seenKeys, items)` (ou equivalente) num módulo `src/lib/` — sem React, testável em vitest.
- `AtendimentoBell` consome `unreadCount` para o badge; hook (`useAtendimentoPendencias` ou um novo `useBellSeen`) expõe o estado visto + a ação de marcar-visto no open.

### Claude's Discretion
- Nome exato do módulo/hook e assinatura das funções puras.
- Se estende `useAtendimentoPendencias` ou cria hook separado `useBellSeen` (preferência: hook separado para não inchar o de dados).
- Estratégia de leitura/escrita segura do localStorage (guard SSR/try-catch).
- aria-label do botão do sino refletindo unread vs total.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sino atual + fonte de dados
- `src/components/layout/AtendimentoBell.tsx` — componente do sino (Popover + badge). Ponto de mudança do badge e do `onOpenChange`.
- `src/hooks/useAtendimentoPendencias.ts` — fonte das pendências; produz `items` com `key` estável (`q-`/`c-`), `count`, `isLoading`. Refetch 45s.

### Contexto de org (chave do localStorage)
- `src/contexts/OrganizationContext.tsx` — `useOrganization()` → `currentOrg.id` para chavear `bell-seen:{orgId}`.

### Padrões do projeto
- `./CLAUDE.md` — convenções (named exports, file-per-component, hooks `use*`, libs puras em `src/lib/`, testes vitest colocados).
</canonical_refs>

<specifics>
## Specific Ideas

- Testes vitest para as funções puras: sem seen → semeia (unread 0); item novo → unread 1; abrir → zera; item resolvido some do set (prune); reaparecer não conta como novo se já estava no set.
- Verificação alvo: `tsc` 0 erros, vitest verde (incl. novos testes), build ok. Sem EF/RPC/migration → anti-IDOR N/A.
</specifics>

<deferred>
## Deferred Ideas

- Sincronização cross-device do estado "lido" (exigiria tabela + RLS) — phase futura se houver necessidade real.
- Botão "marcar como lido" por item / dispensar individual — descartado nesta phase por decisão de semântica.
</deferred>

---

*Phase: 91-sino-da-navbar-marcar-notifica-es-como-lidas-badge-s-conta-n*
*Context gathered: 2026-07-07 via decisão direta*
