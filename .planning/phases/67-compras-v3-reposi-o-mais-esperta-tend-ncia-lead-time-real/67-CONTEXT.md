# Phase 67: Compras v3 — Reposição mais esperta (tendência + lead time real) - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Melhoria do **motor de cálculo** da "Compra Recomendada" da `/compras` (garment-glow-test, plataforma ML Pé Vermeio). Toda a fundação das Phases 62/63/65/66 se mantém intocada (RPC `get_replenishment_by_sku`, `replenishment_params` por escopo SKU>fornecedor>marca>global, "a chegar" via `purchase_orders`, override por fornecedor). Esta fase troca SÓ os dois sinais hoje "burros":

1. **Velocidade de venda**: hoje é **média plana** (`SUM(vendas na janela)/dias`). Passa a combinar **tendência (EWMA, peso maior nas vendas recentes)** + **sazonalidade** (índice por mês no nível marca/categoria).
2. **Lead time**: hoje é **param fixo**. Passa a usar o **lead time real por fornecedor** (mediana do intervalo `data_pedido`→`data_entrega` das OCs em trânsito), com fallback no param.

Cada camada esperta entra só quando tem dado confiável; senão **cai no cálculo simples** e a tela sinaliza "modo simples". Há um **toggle "Cálculo esperto"** (on por padrão) para comparar com o simples.

**NÃO faz parte desta fase:**
- Mexer no sync de OCs (não vamos sincronizar OCs históricas/recebidas — usamos só as em trânsito que já existem).
- Mudar a fundação de params/escopos, "a chegar" ou override fornecedor (Phases 62-66).
- Nenhuma mudança no modelo de ponto de reposição/alvo em si (lead time + cobertura + safety) — só os INSUMOS (venda_dia e lead_time) ficam mais espertos.
- Botão gerar OC no Tiny / editor manual de custo (não priorizados).

**Origem:** última peça do roadmap v2 da `/compras` definido com Wesley em 2026-06-26 (opção 4 — "cálculo mais esperto"). As demais (estoque a chegar, override fornecedor) já entregues e em prod.
</domain>

<decisions>
## Implementation Decisions

### Velocidade de venda (sinal central)
- **D-01:** A velocidade deixa de ser média plana e passa a combinar **tendência + sazonalidade** (Wesley escolheu "os dois", não só um).
- **D-02:** **Tendência = EWMA** (média móvel exponencial / ponderada por recência): vendas recentes pesam mais que antigas. Funciona com histórico curto e captura aceleração/desaceleração automaticamente. (Parâmetros exatos — janela, fator de decaimento — a pesquisa define.)
- **D-03:** **Sazonalidade = índice por mês no nível MARCA/CATEGORIA** (não por SKU). Agrega vendas no bucket marca/categoria (mais dados → robusto), calcula o fator sazonal do mês corrente/alvo, e aplica ao SKU. Captura o pico de rodeio (ex.: Barretos/ago) sem exigir 1 ano por SKU individual.
- **D-04:** Combinação: a base EWMA é ajustada pelo fator sazonal **quando há índice sazonal confiável**; sem ele, usa só a EWMA (D-09).

### Lead time real por fornecedor
- **D-05:** O lead time deixa de ser só o param fixo: usa a **mediana do intervalo `data_pedido`→`data_entrega` das OCs em trânsito, agrupadas por fornecedor**. É o prazo real que cada fornecedor está praticando agora.
- **D-06:** **Fonte = OCs em trânsito atuais** (`purchase_orders`, situação 3) — NÃO sincronizar OCs recebidas/históricas (decisão de escopo: não mexer no sync; usar o dado que já existe). Limitação aceita: é o prazo **planejado** das OCs vigentes, não o realizado histórico.
- **D-07:** Mapeamento SKU→fornecedor reusa o **predominante da Phase 66** (CTE `fornecedor_by_sku`). Fallback: SKU sem fornecedor (sem OC) → lead time do param (precedência de params da Phase 66 mantida).

### Robustez / fallback (princípio inviolável)
- **D-08:** **Fallback transparente por dimensão** — cada camada esperta (EWMA, sazonalidade, lead time real) liga **independentemente** e só quando tem base de dado suficiente. Sem base → aquela dimensão cai no cálculo simples atual (média plana / param fixo). Nunca inventa tendência/sazonalidade com amostra ínfima. (Alinha com o princípio "declarar limitação em vez de inventar" — [[feedback_decisions_detail]] / Phase 58.)
- **D-09:** Limiares de suficiência (ex.: sazonalidade exige ≥1 ano de histórico no bucket marca/categoria; lead time real exige ≥K OCs por fornecedor; EWMA degrada graciosamente mas com piso mínimo de vendas) — **valores exatos a definir na pesquisa/SPEC**, mas a regra é: na dúvida, cai no simples.

### UI / controle
- **D-10:** **Toggle "Cálculo esperto"** na `/compras` (ON por padrão). OFF = volta ao cálculo simples atual (média plana + param) — permite comparar lado a lado e construir confiança. Espelha o padrão do toggle "Incluir previsões de compra" do `/fluxo-de-caixa` (Phase 60) que o Wesley aprovou.
- **D-11:** **Transparência por SKU** via badges/tooltip: indicar tendência (↑/↓/estável), se houve ajuste sazonal, o lead time real usado (vs param), e "modo simples" quando alguma dimensão caiu no fallback. Reusa o padrão do `ParamsTooltip`/badges já existente na `ReplenishmentSkuTable`.

### Claude's Discretion (a pesquisa/plano detalha)
- Fórmula exata da EWMA (nº de períodos, α/half-life), bucketização temporal das vendas (semanal/diária), e definição operacional de "tendência" para o badge.
- Cálculo exato do índice sazonal (média do mês no bucket ÷ média geral; suavização) e a granularidade "marca vs categoria" (qual campo usar).
- Onde o cálculo vive: estender a CTE `sales_by_sku` da RPC `get_replenishment_by_sku` (preferência — manter atômico/SECURITY INVOKER) vs nova RPC/colunas. O toggle provavelmente vira um parâmetro da RPC (ex.: `p_smart BOOLEAN`) + propagação no hook, espelhando o 4º arg do `get_cashflow` (Phase 60).
- Limiares de fallback (D-09) concretos.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Motor a evoluir (Phase 62→66)
- `supabase/migrations/20260666000100_get_replenishment_by_sku_fornecedor.sql` — RPC ATUAL (já com 4 níveis de param + `fornecedor_by_sku` + `incoming_by_sku`). A CTE `sales_by_sku` (avg_daily = SUM/window) é o ponto exato a tornar esperto; `fornecedor_by_sku` é reusada p/ o lead time por fornecedor.
- `src/lib/analysis/replenishmentUtils.ts` (+ `.test.ts`) — módulo puro espelho da RPC; o cálculo esperto precisa de espelho testável (padrão das Phases 62/63/66).
- `src/hooks/useReplenishmentBySku.ts` — hook de consumo (propagaria o toggle p_smart).
- `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — tabela + `ParamsTooltip`/badges (onde entram os sinais de transparência D-11) e onde o toggle vive.
- `.planning/phases/66-compras-v2-override-por-fornecedor/66-CONTEXT.md` — decisões do override fornecedor / mapeamento predominante (D-07 reusa).

### Fontes de dados (prod `ckcdevcxgvueywivefgx`)
- `orders` — vendas por item/variação (`data_pedido`, `quantidade`, `status='paid'`, `item_id`/`variation_id`) → base da velocidade (EWMA + sazonalidade). Brand vem de `ml_inventory_cache.brand`.
- `purchase_orders` — `data_pedido` (colocação), `data_entrega` (chegada), `fornecedor`, `sku`, `situacao` → fonte do lead time real (intervalo por fornecedor). **Snapshot só de OCs em trânsito (situação 3); apagado/reinserido a cada sync — não acumula histórico.**
- `ml_inventory_cache` — `brand` (para a granularidade marca/categoria da sazonalidade).
- `replenishment_params` — params por escopo (fallback do lead time e dos demais).

### Padrão do toggle (referência de UX aprovada)
- `get_cashflow` 4-arg + toggle "Incluir previsões de compra" (Phase 60) — modelo do `p_smart` + toggle ON/OFF para comparar.

### Sistema legado (NÃO tocar)
- `src/lib/analysis/compraUtils.ts` + `/precos-custos/analise` — cálculo antigo, intocado.

### Identificadores
- Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7` | projeto Supabase `ckcdevcxgvueywivefgx` (NÃO o do CLAUDE.md) | ml_user_id `1639558873`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **CTE `sales_by_sku`** na RPC (avg_daily = SUM(orders.quantidade)/window) — ponto cirúrgico onde a velocidade esperta substitui a média plana.
- **CTE `fornecedor_by_sku`** (Phase 66) — já mapeia SKU→fornecedor predominante; reusada para o lead time real por fornecedor.
- **Padrão de param-toggle na RPC** (`get_cashflow` `p_include_purchase_forecasts`) — modelo para `p_smart`.
- **`replenishmentUtils` + testes vitest** — espelho puro testável (adicionar EWMA/sazonal/lead-time + casos de fallback).
- **`ParamsTooltip`/badges** na `ReplenishmentSkuTable` — onde os sinais de transparência D-11 entram.

### Established Patterns
- RPC `SECURITY INVOKER` + RLS org-first (anti-IDOR) — manter em qualquer mudança de RPC.
- Deploy de migration/EF via MCP pelo orquestrador (executor não deploya) — aplicar + validar por SQL.
- Toggle que compara (ON/OFF) com default seguro — Phase 60.

### Integration Points
- `orders` + `ml_inventory_cache.brand` → CTE de velocidade esperta (EWMA + índice sazonal marca/categoria) → `venda_dia` da RPC.
- `purchase_orders` (intervalo por fornecedor) + `fornecedor_by_sku` → lead time real → `ponto_reposicao`/`alvo`.
- RPC `p_smart` ↔ `useReplenishmentBySku` ↔ toggle + badges na `/compras`.
</code_context>

<specifics>
## Specific Ideas

- "Os dois sinais": **EWMA (recência) + índice sazonal por mês no nível marca/categoria**.
- Lead time = **mediana** `data_pedido→data_entrega` por fornecedor (OCs em trânsito), fallback no param.
- **Fallback transparente por dimensão** + badge "modo simples"; nunca inventar com amostra pequena.
- **Toggle "Cálculo esperto"** (on por padrão) p/ comparar com o simples — igual ao toggle do caixa.
- Negócio sazonal real do Pé Vermeio: rodeios (ex.: Barretos em agosto) — a sazonalidade marca/categoria deve capturar esse pico.
</specifics>

<deferred>
## Deferred Ideas

- **Sincronizar OCs recebidas/históricas** para lead time **realizado** (não só planejado) — exigiria mexer no sync + histórico; fora desta fase (D-06).
- **Índice sazonal por SKU** individual — exige histórico longo por SKU; preterido em favor do nível marca/categoria (D-03).
- **Gerar OC no Tiny** / editor manual de custo — não priorizados.
- Custo por fornecedor (fallback de custo) — roadmap de custo v2, fora daqui.

### Reviewed Todos (not folded)
None — sem todos pendentes casando com a Phase 67.
</deferred>

---

*Phase: 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real*
*Context gathered: 2026-06-26*
