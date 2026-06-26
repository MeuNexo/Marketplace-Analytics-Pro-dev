# Phase 66: Compras v2 — Override por Fornecedor - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Evolução das Phases 62/63/65. A reposição da `/compras` ganha um **terceiro nível de parametrização: por fornecedor**, inserido entre SKU e marca na precedência hoje existente — de `SKU > marca > global` para **`SKU > fornecedor > marca > global`**.

Esta fase entrega:
1. As OCs do Tiny gravam o **fornecedor** (`contato.nome`) em `purchase_orders.fornecedor` (fundação de dados já iniciada).
2. `replenishment_params` aceita `scope='fornecedor'` (fundação já em prod).
3. A RPC `get_replenishment_by_sku` resolve os params do SKU também pelo **fornecedor de origem** do SKU, com precedência `SKU > fornecedor > marca > global`.
4. O frontend `/compras` ganha **CRUD de params por fornecedor** (owner/admin), com seletor de fornecedor por dropdown.

**NÃO faz parte desta fase:**
- Custo por fornecedor (decidido: nível fornecedor cobre só params de reposição; custo continua por SKU de `ml_product_costs`).
- Cálculo mais esperto (sazonalidade/tendência/lead time real por histórico) — prioridade v2 separada.
- Botão "gerar OC no Tiny" e editor manual de custo — não priorizados.
- O `compraUtils` legado em `/precos-custos/analise` permanece **intocado**.

**Origem:** override por fornecedor foi explicitamente diferido da Phase 62 (supplier não existia por item) e da Phase 63. Só passou a existir (nas OCs) na Phase 65.
</domain>

<decisions>
## Implementation Decisions

### Mapeamento SKU→fornecedor (decisão central)
- **D-01:** O fornecedor de um SKU é o **fornecedor predominante** nas OCs daquele SKU — NÃO a OC mais recente nem cadastro manual.
- **D-02:** "Predominante" = **maior quantidade total comprada** do SKU somada por fornecedor (`SUM(quantidade)` por `fornecedor` em `purchase_orders` para aquele SKU). **Desempate:** OC mais recente (maior `data`/`data_pedido`). _(regra de desempate = discrição técnica confirmada no resumo)_
- **D-03:** SKU **sem nenhuma OC** (logo sem fornecedor derivável) cai direto para `marca > global`, sem erro. O nível fornecedor é simplesmente pulado para esse SKU.

### Escopo do nível fornecedor
- **D-04:** O scope `fornecedor` sobrescreve **apenas os parâmetros de reposição**: lead time, meta de cobertura, estoque de segurança, MOQ e múltiplo de embalagem (pack). As mesmas colunas de `replenishment_params` já usadas por global/marca/sku.
- **D-05:** **Custo NÃO é parametrizável por fornecedor.** Custo continua vindo por SKU de `ml_product_costs` (Tiny). O problema de "custo ausente" segue no roadmap de custo v2, fora desta fase.

### RPC — precedência
- **D-06:** A RPC `get_replenishment_by_sku` passa de `SKU > marca > global` para **`SKU > fornecedor > marca > global`**. Para cada coluna de param resolvida por COALESCE, inserir o lookup do nível fornecedor **entre** o de SKU e o de marca, usando o fornecedor predominante derivado (D-01/D-02).
- **D-07:** A RPC permanece **`SECURITY INVOKER`** (anti-IDOR: org alheia = 0 linhas). Sem regressão dos casos da Phase 63 (precedência SKU/marca/global continua valendo quando não há param de fornecedor).
- **D-08:** O módulo puro espelho da RPC (`replenishmentUtils`/`resolveParamsBySku`) deve refletir a mesma precedência de 4 níveis, com testes cobrindo: SKU, fornecedor, marca, global e os fallbacks (SKU sem OC → marca/global; param de fornecedor existe mas SKU sem fornecedor → não casa).

### UI de edição (/compras)
- **D-09:** Reaproveita o **CRUD de params já existente** na `/compras` (owner/admin, RLS org-first mantida). Adiciona `'fornecedor'` ao seletor de escopo.
- **D-10:** O fornecedor é escolhido por **dropdown** com os fornecedores **distintos das OCs** (`SELECT DISTINCT fornecedor FROM purchase_orders WHERE fornecedor IS NOT NULL`), garantindo match exato com o `contato.nome` usado no mapeamento. **Não** usar campo de texto livre (evita divergência de digitação que faria o override não casar).
- **D-11:** Só é possível parametrizar fornecedor que tenha OC (consequência aceitável de D-10). A precedência deve ficar visível/legível na UI (como já é para SKU>marca>global).

### Ordem de execução em prod (faseado com checkpoint)
- **D-12:** Sequência obrigatória: **(1)** deploy da EF `sync-tiny-purchase-orders` (já grava `fornecedor` localmente) + disparo do re-sync para popular `purchase_orders.fornecedor`; **(2) checkpoint de validação** — conferir a lista de fornecedores distintos (nomes limpos/consistentes; o "predominante" faz sentido por amostragem); **(3) só então** aplicar a migration da RPC com a precedência + frontend.
- **D-13:** Justificativa: ligar o override sobre dados de fornecedor sujos/inconsistentes casaria errado e passaria despercebido. O checkpoint trava esse risco antes de a precedência entrar.

### Fundação já parcialmente aplicada (atenção da execução)
- **D-14:** A migration `20260666000000_fornecedor_scope.sql` (coluna `purchase_orders.fornecedor` + `scope='fornecedor'` na constraint de `replenishment_params`) **já está aplicada em prod** (`ckcdevcxgvueywivefgx`) mas o arquivo está **untracked no git**; a alteração da EF (`fornecedor = contato.nome`) está **local, não commitada e não deployada** (prova: `0` OCs com fornecedor em prod). A execução deve **commitar/deployar isso numa branch própria da Phase 66** (não na `gsd/phase-65`).

### Claude's Discretion
- Regra exata de desempate do "predominante" (locada como OC mais recente em D-02) e se há limite temporal (ex.: considerar só OCs dos últimos N meses) — refinar no plano se necessário.
- Forma de expor a lista de fornecedores ao frontend (RPC dedicada `get_purchase_order_suppliers` vs query distinct direta com RLS) — decisão de plano.
- Se a derivação do fornecedor predominante vira uma CTE dentro da própria RPC ou uma view/RPC auxiliar — decisão de plano (preferência: CTE na RPC para manter atômico, como o `incoming_by_sku` da Phase 65).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Base direta a evoluir (Phases 63 e 65)
- `.planning/phases/63-compras-reposi-o-por-sku-p-gina-pr-pria/63-CONTEXT.md` — decisões da reposição por SKU, precedência SKU>marca>global, página `/compras`
- `supabase/migrations/20260665000000_purchase_orders.sql` — RPC `get_replenishment_by_sku` ATUAL (CTEs sales/inventory/params/incoming; precedência SKU>marca>global via COALESCE) + tabela `purchase_orders`
- `supabase/migrations/20260666000000_fornecedor_scope.sql` — **fundação desta fase (untracked, já em prod):** coluna `purchase_orders.fornecedor` + `scope='fornecedor'` na constraint
- `supabase/functions/sync-tiny-purchase-orders/index.ts` — EF de sync das OCs (alteração local: grava `fornecedor = contato.nome`; falta deploy + re-sync)
- `src/lib/analysis/` — módulo puro espelho da RPC (`replenishmentUtils`/`resolveParamsBySku`) + testes vitest
- `src/hooks/useReplenishmentBySku.ts` — hook de consumo da RPC
- página `/compras` (componente + CRUD de params) — a estender com o escopo fornecedor

### Fundação Phase 62 (params)
- `supabase/migrations/20260662000000_replenishment_params.sql` — tabela `replenishment_params` (colunas lead_time/meta_cobertura/safety/MOQ/pack; RLS org-first; escopos global/marca, depois sku na 63, agora fornecedor)

### Fontes de dados (prod `ckcdevcxgvueywivefgx`)
- `purchase_orders` — `sku`, `quantidade`, `fornecedor` (novo), `data`/`data_pedido`, `situacao`; fonte do mapeamento predominante e do dropdown de fornecedores
- `replenishment_params` — params por escopo; scope ∈ {global, marca, sku, fornecedor}
- `ml_product_costs` — custo por `seller_sku` (custo permanece por SKU; NÃO mexer nesta fase)

### Sistema legado (NÃO tocar)
- `src/lib/analysis/compraUtils.ts` + `/precos-custos/analise` — cálculo antigo, intocado

### Identificadores
- Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7` | Org Thales = `e4150d57-1349-48c9-9a89-82b1774857b0`
- Projeto Supabase live = `ckcdevcxgvueywivefgx` (**NÃO** o `gionpsuunfkkzzjdubfy` citado no CLAUDE.md)
- ml_user_id Pé Vermeio = `1639558873`
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **RPC `get_replenishment_by_sku`** (migration `20260665...`): já resolve params por COALESCE em 3 níveis (SKU>marca>global) para cada coluna; o nível fornecedor entra como mais um termo de COALESCE entre SKU e marca.
- **CTE `incoming_by_sku`** (Phase 65): modelo de como adicionar uma CTE auxiliar atômica à RPC — o "fornecedor predominante por SKU" pode seguir o mesmo padrão.
- **CRUD de params na `/compras`** (Phase 63): já trata global/marca/sku com write owner/admin; estender com 'fornecedor' + dropdown.
- **`replenishmentUtils`/`resolveParamsBySku` + testes vitest**: fórmula pura espelho da RPC — atualizar para 4 níveis com os mesmos casos de teste.

### Established Patterns
- **RLS org-first + `SECURITY INVOKER`** em todas as RPCs de reposição (anti-IDOR) — manter.
- **Deploy via MCP** (`apply_migration` / `deploy_edge_function`) com token; gsd-executor não deploya EF (orquestrador faz). Migrations aplicadas via MCP, depois validadas por SQL.
- **EF lenta + cron → `EdgeRuntime.waitUntil`** (Phase 65/59): a EF de OCs já usa esse padrão.
- **Disparo manual de re-sync** via `net.http_post` com `service_role_key` do vault, body `{"ml_user_id":"1639558873"}`.

### Integration Points
- RPC `get_replenishment_by_sku` (backend) ↔ `useReplenishmentBySku` (hook) ↔ página `/compras` (tabela + CRUD de params).
- EF `sync-tiny-purchase-orders` → `purchase_orders.fornecedor` → (a) CTE de fornecedor predominante na RPC, (b) dropdown de fornecedores na UI.
</code_context>

<specifics>
## Specific Ideas

- Precedência final, explícita e visível: **`SKU > fornecedor > marca > global`**.
- "Fornecedor predominante" por **quantidade total comprada** do SKU, empate → OC mais recente.
- Dropdown de fornecedor na UI alimentado pelos **distinct das OCs** (match exato com `contato.nome`).
- Aplicação **faseada com checkpoint** de validação dos nomes de fornecedor antes de ligar a precedência.
</specifics>

<deferred>
## Deferred Ideas

- **Custo por fornecedor** (fallback de custo para SKUs sem custo no Tiny) — fora desta fase; pertence ao roadmap de custo v2.
- **Cálculo mais esperto** (sazonalidade/tendência, lead time real por histórico) — prioridade v2 separada (opção 4 do Wesley).
- **Gerar OC no Tiny** (botão criar OC) e **editor manual de custo** — não priorizados pelo Wesley.
- Possível **janela temporal** no cálculo do predominante (considerar só OCs recentes) — avaliar no plano se os dados pedirem.

### Reviewed Todos (not folded)
None — sem todos pendentes casando com a Phase 66.
</deferred>

---

*Phase: 66-compras-v2-override-por-fornecedor*
*Context gathered: 2026-06-26*
