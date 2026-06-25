# Phase 61: Enriquecer Fornecedor + Categoria do Contas a Pagar - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Source:** Investigação ao vivo + decisões do Wesley (sessão 2026-06-25). CONTEXT sintetizado direto (diagnóstico já fechado e validado contra o banco; opção A aprovada).

<domain>
## Phase Boundary

**Entrega:** Os dois gráficos da página `/fluxo-de-caixa` que dependem de `cash_outflows.category` e `cash_outflows.supplier` — **Composição de Custos por Mês** e **Exposição por Fornecedor** — voltam a mostrar dados reais (categorias do plano de contas do Tiny + múltiplos fornecedores) e **se mantêm estáveis** após cada execução do `sync-tiny-payables` (hoje funcionam só 1x e regridem para "Outros"/só-Pralana).

**Não entra nesta fase:** mudanças visuais nos gráficos em si (UI dos charts já existe e funciona), DFC/projeção da Phase 60, novos campos além de `category`/`supplier`.

### Estado atual (validado em 2026-06-25, Supabase ckcdevcxgvueywivefgx)
- `cash_outflows`: 2011 linhas totais; **1991 com `category` vazia E `supplier` nulo**; só 20 OK (as "Previsões de compra"). `COUNT(DISTINCT supplier)=1` (Pralana, das OCs), `COUNT(DISTINCT category)=1`.

### Causa-raiz (completa)
- O endpoint Tiny **`/contas-pagar` (LISTA) NÃO traz categoria nem fornecedor.** Eles só vêm no **DETALHE `/contas-pagar/{id}`** (`categoria.descricao` + `contato.nome`).
- `sync-tiny-payables` lê só a LISTA → grava `category`/`supplier` NULL.
- A Phase 51 criou um **backfill por detalhe** (fila `cat_backfill_queue` + `enrich_drain`/`enrich_harvest` via pg_net/cron `treasury_cat_tick`/`treasury_cat_enqueue`) que preencheu a **categoria** — funcionou 1x.
- **Por que quebrou de novo:** (a) o backfill nunca preencheu `supplier`; (b) **todo `sync-tiny-payables` sobrescreve `category`/`supplier` de volta pra NULL** (mapeia de campos vazios da lista); (c) o enqueue usa `ON CONFLICT DO NOTHING`, então linhas já `done` **nunca** são re-enriquecidas depois do sync zerá-las. O sync de 25/06 (1991 linhas) apagou tudo e a fila não recupera. É conflito de arquitetura: sync-lista (barato/frequente) atropela o enriquecimento-detalhe (caro/throttled), e o sync sempre vence.

</domain>

<decisions>
## Implementation Decisions

### Arquitetura — fonte única (LOCKED, opção A aprovada pelo Wesley)
- O **enriquecimento-detalhe vira a fonte única** de `category` e `supplier`. O `sync-tiny-payables` **deixa de escrever esses 2 campos** no upsert de `cash_outflows` (remover os campos do upsert; o `ON CONFLICT` passa a preservar o que o enriquecimento gravou). Demais campos do sync seguem normais.

### Enriquecimento (LOCKED)
- `enrich_harvest` passa a gravar **também `supplier = contato.nome`** (hoje só grava `category = categoria.descricao`), lendo do mesmo detalhe `/contas-pagar/{id}` que já busca.

### Fila / re-enfileiramento (LOCKED)
- O enqueue (`treasury_cat_enqueue` / função de enfileiramento) passa a **re-marcar `todo` toda linha com `category IS NULL OR supplier IS NULL`**, em vez de `ON CONFLICT DO NOTHING` que pula as `done`. Assim, se algum dia uma linha for zerada, a fila recupera.

### Backfill (LOCKED)
- Rodar o backfill **agora** para repovoar as ~2011 linhas (categoria + fornecedor) via a fila/cron **já existentes**. Throttle do Tiny ~1–2 req/s → ~20–30 min de drain, **server-side e resumível** (não bloqueia a sessão).

### Claude's Discretion
- Como exatamente remover os 2 campos do upsert (objeto de upsert vs. `onConflict`/`ignoreDuplicates`), desde que o resultado seja: sync não toca `category`/`supplier` em linha existente nem em insert.
- Forma da migration para o enqueue/`enrich_harvest` (nova função vs. `CREATE OR REPLACE`), respeitando o padrão das migrations da Phase 51.
- Mecânica de disparo do backfill (acionar o cron, chamar `enrich_drain` em loop, ou seed da fila + deixar o cron drenar) — escolher a mais segura/observável.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sync do contas a pagar
- `supabase/functions/sync-tiny-payables/` — edge function que lê a LISTA do Tiny e faz upsert em `cash_outflows`. É onde os 2 campos saem do upsert.

### Enriquecimento por detalhe (Phase 51)
- Migrations/funções `enrich_drain`, `enrich_harvest`, tabela `cat_backfill_queue`, crons `treasury_cat_tick` e `treasury_cat_enqueue` (procurar em `supabase/migrations/` por esses nomes). É onde `supplier` passa a ser gravado e o enqueue muda de `DO NOTHING` para re-marcar `todo`.

### Phase 60 (não regredir)
- `.planning/phases/60-alinhamento-da-dfc-fluxo-de-caixa/` — RPC `get_cashflow` (4-arg), toggle de previsões, e a regra de que a Exposição por Fornecedor NÃO é movida pelo toggle. A Phase 61 não pode quebrar nada disso.

</canonical_refs>

<specifics>
## Specific Ideas
- Mapeamento de campos no detalhe Tiny: `categoria.descricao` → `category`, `contato.nome` → `supplier`.
- Validação de sucesso é mensurável por SQL em `cash_outflows` (% não-nulo, distinct counts) + verificação visual dos 2 gráficos em prod.
- Deploy de edge function: via MCP Supabase `deploy_edge_function` (orquestrador faz; gsd-executor não deploya EF — padrão do projeto).

</specifics>

<deferred>
## Deferred Ideas
- Enriquecer outros campos do detalhe Tiny além de category/supplier (ex.: centro de custo) — fora de escopo.
- Re-arquitetar o sync para já puxar detalhe inline (descartado: detalhe é caro/throttled; manter sync-lista barato + enriquecimento assíncrono é a decisão).

</deferred>

---

*Phase: 61-enriquecer-fornecedor-categoria-do-contas-a-pagar*
*Context gathered: 2026-06-25 — investigação ao vivo + decisões do Wesley*
