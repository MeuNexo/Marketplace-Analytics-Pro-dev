# Phase 42: Zero Mock - Context

**Gathered:** 2026-06-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminar todo dado simulado das páginas do produto. Quatro páginas passam a ler de fontes reais do Mercado Livre:

- **/perguntas** — perguntas reais de compradores (tabela `ml_questions` + EF `sync-ml-questions`) e resposta direto pela UI (POST answer na API ML)
- **/devolucoes** — reclamações e devoluções reais (tabela `ml_claims` + EF `sync-ml-claims`), listagem read-only
- **/reputacao** — feedback real da API ML; remoção de todos os `getMock*` de reputação
- **/tv** — sellers lidos da tabela `sellers` por `organization_id`, sem UUIDs hardcoded

Critério de fechamento: zero badge "dados simulados" e zero função `getMock*` no codebase do produto.

**Fora de escopo:** redesign visual das páginas (elas já existem); badges de contagem de pendências na sidebar; notificações push; responder/mediar reclamação (apenas listar em /devolucoes).

</domain>

<decisions>
## Implementation Decisions

### Sync de questions e claims
- **D-01:** Sync via **pg_cron periódico** (não on-demand). Schedules separados por urgência: **perguntas a cada ~15min** (compradores esperam resposta rápida — atraso penaliza reputação ML), **claims a cada ~30min**.
- **D-02:** Atenção crítica ao histórico do Nexo MCP: pg_cron com schedule errado já causou sync a cada 1min e auth falha (`sb_secret_` vs SERVICE_ROLE_KEY). O setup do cron deve usar o padrão de auth correto e ser validado pós-deploy (smoke).
- **D-03:** Backfill inicial (Claude's discretion, ajustável): perguntas = não-respondidas + respondidas recentes; claims = últimos 90 dias. Mantém tabela enxuta e custo de API ML controlado.

### UX de resposta a pergunta (MOCK-02)
- **D-04:** Resposta **inline** — a linha da pergunta expande com textarea + botão "Responder".
- **D-05:** **Passo de confirmação obrigatório** antes de enviar — resposta ao ML é irreversível.
- **D-06:** Optimistic update + toast (sonner) após sucesso; contador de caracteres `0/2000` (limite da API ML).

### Reputação (MOCK-04)
- **D-07:** O gráfico "feedback diário 30d" passa a ser **derivado das datas dos feedbacks reais** (agrupa por dia os feedbacks que a API ML retornar). Aceita-se série curta/esparsa — só dias com feedback real. Sem fabricação.
- **D-08:** Resumo de reputação continua vindo da EF `ml-reputation` (já real). Lista de feedbacks = entries reais por venda. Remover `getMockReputationSummary`, `getMockFeedbackDaily`, `getMockFeedbackEntries` e o fallback em `useMLReputation.ts`.

### /devolucoes (MOCK-03)
- **D-09:** **Lista unificada** (uma tabela `ml_claims`) com coluna **"tipo"** (reclamação / devolução) e **filtro por status** (aberto / disputa / fechado). Read-only — sem ação de responder claim nesta fase.

### Escopo multi-loja
- **D-10:** /perguntas, /devolucoes e /reputacao **respeitam o filtro de loja do header** (`selectedStore` / HeaderScope) e sincronizam **por `ml_user_id`**, como as demais páginas. Com "todas" selecionado, faz **merge das lojas** (padrão CR-01 da Phase 41). Sempre escopo `organization_id` + `ml_user_id`.

### TV (MOCK-05)
- **D-11:** Substituir o array `SELLERS` hardcoded (`TVModeVendas.tsx:16`) por leitura da tabela `sellers` filtrada por `organization_id`, **apenas sellers com ML conectado**.
- **D-12:** Logo e iniciais vêm da tabela `sellers`; fallback para a ficha ML quando ausentes. Ciclagem **alfabética** por nome.

### Claude's Discretion
- Empty state quando a tabela está vazia antes do 1º cron rodar (seller recém-conectado): mostrar estado "sincronizando — volte em alguns minutos" em vez de tabela vazia crua. (Não disparar sync on-demand — modelo é cron.)
- Estrutura exata das tabelas `ml_questions` / `ml_claims` (colunas, índices, constraint única, RLS) — seguir o padrão de tabelas ML existentes do projeto e as definições do Nexo MCP.
- Janela exata de backfill (D-03) — ajustável conforme custo de API observado.
- Paginação / ordenação default das listas — seguir padrão das páginas existentes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e requisitos da fase
- `.planning/ROADMAP.md` (Phase 42: Zero Mock) — goal, success criteria, requirements MOCK-01..05
- `.planning/REQUIREMENTS.md` §MOCK-01..MOCK-05 — definição de cada requisito

### Padrões a portar (Nexo MCP — repositório externo)
- `/root/nexo-mcp/server.py` — tools `get_questions`, `get_claims`, `reply_to_question`, `reply_to_claim`: formato da ML Questions/Claims API, parsing de status, rate limits já validados em produção
- `/root/nexo-mcp/.planning/phases/phase-13-new-tools/13-SUMMARY.md` — contexto das tools de pós-venda

### Decisões herdadas (Phase 41)
- `.planning/phases/41-veracidade-total/41-CONTEXT.md` — padrão de scope multi-loja
- `.planning/STATE.md` (Sessão 2026-06-13) — CR-01 (merge multi-loja em hooks), aprendizado de auth de EF invocada por cron (`sb_secret_` ≠ SERVICE_ROLE_KEY → 401), padrão `useMLBillingWithSync` (auth de EF via user JWT)

### Código existente relevante
- `src/hooks/useMLReputation.ts` — fetch real da EF `ml-reputation` (já funciona; remover fallback mock)
- `supabase/functions/ml-reputation/` — EF de reputação existente (referência de padrão de EF ML)
- `src/pages/TVModeVendas.tsx:16` — array `SELLERS` hardcoded a ser substituído
- `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/ARCHITECTURE.md` — padrões de EF, auth ML (`ml_tokens`), data fetching

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useMLReputation.ts`: já faz fetch autenticado da EF `ml-reputation` com user JWT — modelo direto para os hooks de questions/claims; só precisa remover o fallback `getMockReputationSummary`.
- HeaderScope / `selectedStore` (`useMLStore`): mecanismo de filtro de loja já usado em todas as páginas — reusar para escopo multi-loja (D-10).
- Padrão `useMLBillingWithSync` (Phase 41): estrutura de hook que dispara sync de EF com user JWT e trata retry — referência mesmo usando cron (a invocação manual/refresh segue o mesmo auth).
- Componentes `Card` (variantes shadow/rounded), tabelas listradas, toast `sonner`, contador de chars — já no design system.

### Established Patterns
- TanStack React Query v5 para server state (cache, refetch) — usar nos hooks de questions/claims.
- EF Deno + tabela cache + leitura via hook — padrão dominante do projeto (ver INTEGRATIONS.md).
- Escopo sempre `organization_id` + `ml_user_id` (nunca só `seller_id`).
- RLS obrigatório nas tabelas novas; auth de EF por cron deve usar SERVICE_ROLE_KEY correto (não `sb_secret_`).
- Supabase project correto: **ckcdevcxgvueywivefgx** (CLAUDE.md cita gionpsuunfkkzzjdubfy — desatualizado).

### Integration Points
- Tabela `sellers` (filtrada por `organization_id`) → TVModeVendas (D-11/D-12).
- `ml_tokens` → EFs `sync-ml-questions` / `sync-ml-claims` para autenticar na API ML.
- Novas tabelas `ml_questions` / `ml_claims` → hooks → páginas /perguntas e /devolucoes.
- pg_cron schedules novos → invocam as EFs de sync (auth correta + smoke pós-deploy).

</code_context>

<specifics>
## Specific Ideas

- MLB / API ML: resposta a pergunta tem limite de 2000 caracteres e é irreversível — UI deve refletir ambos (D-05, D-06).
- /devolucoes: ML trata "reclamação/mediação" e "devolução" como resources distintos mas relacionados — unificar numa tabela `ml_claims` com coluna de tipo (D-09).
- Reputação: API ML não fornece série histórica diária confiável — daí derivar o gráfico de datas reais (D-07).

</specifics>

<deferred>
## Deferred Ideas

- Responder/mediar reclamação direto em /devolucoes (porta `reply_to_claim` do Nexo MCP) — fora do escopo "listar" do MOCK-03; candidato a fase futura.
- Badge de contagem de pendências (perguntas não-respondidas / claims abertos) na sidebar — nova capacidade, fase própria.
- Notificação push/Telegram de nova pergunta ou claim — fora de escopo.

None folded from todos (nenhum todo correspondente à fase).

</deferred>

---

*Phase: 42-zero-mock*
*Context gathered: 2026-06-13*
