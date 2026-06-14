# Phase 48: MCO com Ads - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A margem por produto e o MCO da operação passam a considerar o **gasto real de publicidade por anúncio**, separando dois problemas distintos:
- **"Unit economics ruim"** → margem **operacional** (sem ads) negativa/baixa (já existe, Phase 41/45).
- **"Ads comendo a margem"** → margem **operacional positiva**, mas **pós-ads** comprometida.

Modelo de **2 números lado a lado** (operacional + pós-ads), atribuição **direta por `item_id`** via `ml_ads_products_cache` (sem rateio). Entrega: RPC margem+ads por produto, exibição nas 3 superfícies (/anuncios, Consultor, card Custos/DRE), novo alerta por produto e ads_no_sale por produto.

**Fora de escopo:** atribuir campanhas de marca/display a itens específicos; UI para o lojista editar limiares na tela (fica via SQL, como Phase 45); refatorar o waterfall existente.

**Supabase de produção: `ckcdevcxgvueywivefgx`** (o `gionpsuunfkkzzjdubfy`/`muesqdxnjlbaoiqylpjn` citados em docs antigos NÃO são este — sempre `--project-ref ckcdevcxgvueywivefgx`).

</domain>

<decisions>
## Implementation Decisions

### Modelo dos 2 números (travado por Wesley 2026-06-14)
- **D-01:** Margem **operacional** (sem ads) E margem **pós-ads** lado a lado por produto. "Prejuízo" permanece na operacional (não é mascarado pelo pós-ads). Não é 1 número combinado.
- **D-02:** Atribuição **direta por item** via `ml_ads_products_cache` (tem `date` + `spend` + `attributed_revenue` + `attributed_orders` por `item_id` por dia). **Sem rateio.** `margem pós-ads = lucro operacional − ads_spend(item, janela)`.

### Onde exibir (TODAS as 3 superfícies — escolha do Wesley)
- **D-03 (/anuncios):** MLAnuncios já tem visão de coluna **"financeiro"** (`columnView`). Adicionar margem **operacional** E **pós-ads** por produto nessa visão (MCO-02, SC2). Granular por anúncio.
- **D-04 (Consultor):** Produtos com "ads comendo a margem" aparecem como **insight acionável** no painel do Consultor / card "O que fazer agora" (MCO-04, SC2+SC4). Linka para `/anuncios` ou `/publicidade` filtrado (padrão D-19 Phase 45 — não executa ação).
- **D-05 (card Custos/DRE em /vendas):** **MCO agregado da operação = Σ margem de contribuição − ads total**, visível no DRE mensal (MCO-03, SC3).

### Gatilho do novo alerta "ads comendo a margem" = erosão de margem
- **D-06:** Gatilho mede **erosão direta em R$/%**, não TACoS/ACoS isolado. Defaults (vivem em `consultor_config` por org, ajustáveis via SQL — sem UI nesta fase, consistente com D-02 Phase 45):
  - **Crítico:** operacional > 0 **mas pós-ads ≤ 0%** (ads zeram o lucro do produto).
  - **Alerta:** pós-ads **abaixo de 10%** (mesmo alvo da regra de margem D-03 Phase 45 — consistência).
- **D-07:** Este alerta é **separado** do alerta de prejuízo operacional (MCO-04 exige independência). Um produto pode disparar só erosão-de-ads sem estar no prejuízo operacional.

### Consultor v1 — estende o engine (escolha do Wesley)
- **D-08:** **Nova regra `ads_eating_margin`** por produto na EF `consultor-insights`, gatilho D-06. Segue o padrão de regra existente (config + template de texto + impacto R$).
- **D-09:** **Upgrade do `ads_no_sale`** de **org-level → por produto.** A regra atual (RULE 3) usa `ml_ads_daily_cache` (org-level) por causa do Pitfall 5 (cache de **campanhas** sem coluna date). O cache de **produtos** TEM `date` + `attributed_orders` por item → quebra por produto é viável (MCO-05, SC5).
- **D-10:** O planner decide se a nova regra por produto **substitui** ou **complementa** o `ads_no_sale` org-level existente (evitar insight duplicado).

### ads_no_sale por produto — no escopo (escolha do Wesley)
- **D-11:** Produto com `spend > 0` E `attributed_orders = 0` na janela vira insight (MCO-05, SC5). Surge produtos que **gastam sem vender** — esses NÃO aparecem na RPC de margem (que é orders-based: `get_margin_by_product` só lê `orders`). A RPC/visão precisa surgir esses itens (LEFT/FULL join ou union com products_cache).

### Fonte do "ads total" no MCO agregado
- **D-12:** MCO agregado (D-05) usa o gasto **TOTAL de ads da conta** via `ml_ads_daily_cache` (autoritativo) — não a soma do products_cache. Motivo: Product Ads atribuído por item pode não cobrir 100% do gasto (campanhas de marca/display sem item). Atribuição por item fica só na visão **por produto** (D-03/D-04).

### Janela temporal por superfície
- **D-13:** **MCO agregado** (card Custos/DRE) segue o **DRE mês-calendário 01–31** (quick 260613-2p6, `ml_billing_daily`). **Margem+ads por produto** (/anuncios, Consultor) seguem a **janela já usada nessas telas** (seletor de período). Alinhar a janela de ads ao mesmo critério de data da margem (`orders.data_pedido` vs `ml_ads_products_cache.date`).

### Claude's Discretion (planner decide)
- Forma exata da nova RPC (ex: `get_margin_with_ads_by_product(org, user_ids, from, to)`): junta a lógica de `get_margin_by_product` (orders) com agregação de `ml_ads_products_cache` por `item_id` na **mesma janela**; **LEFT/FULL join** para surgir produtos ads-only (D-11); **paginação/agregação server-side** para evitar truncamento PostgREST (MCO-01, SC1, regra `feedback_postgrest_pagination`).
- Colunas novas em `consultor_config` (ex: `ads_eating_critical_pct=0`, `ads_eating_alert_pct=10`) e templates de texto dos insights `ads_eating_margin` e `ads_no_sale` por produto.
- Se `ads_eating_margin` afeta o **pilar Ads** do score de saúde (peso 25, D-09 Phase 45) — manter coerência com a fórmula do score.
- Componentização: colunas operacional/pós-ads em MLAnuncios; linha "Publicidade / MCO" no MLCostCard/DRE.
- Como reusar `useMLProductMargins` / `useMLMarginAnalysis` / `useMLAdsDerivedMetrics` vs criar hook novo de margem+ads.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / requisitos desta fase
- `.planning/ROADMAP.md` §"Phase 48: MCO com Ads" — goal + success criteria + decisão travada
- `.planning/REQUIREMENTS.md` §"Bloco MCO com Ads (Phase 48)" — MCO-01..05
- `.planning/STATE.md` — Supabase `ckcdevcxgvueywivefgx`; DRE mês-calendário (`ml_billing_daily`, quick 260613-2p6); multi-conta (2 contas ML)

### Fases das quais depende
- `.planning/phases/45-consultor-v1/45-CONTEXT.md` — engine `consultor-insights`, `consultor_config`, regras de ads (tacos/acos/ads_no_sale), score de saúde (pilar Ads peso 25), padrão de insight (auto-resolver/dispensar, link sem executar)
- `.planning/phases/41-veracidade-total/41-CONTEXT.md` — waterfall financeiro, MLCostCard, fonte única de custos

### Backend — fontes de dados (reusar, não recriar)
- `supabase/migrations/20260527110000_margin_aggregate_rpcs.sql` — `get_margin_by_product` (item_id, receita, cmv, comissao, frete, impostos, lucro, lucro_pct; orders-based, status paid/shipped/delivered) — **base da nova RPC**
- `supabase/migrations/20260406143415_a0ec5aee-*.sql` — criação de `ml_ads_products_cache` (item_id, spend, attributed_revenue, attributed_orders, roas)
- `supabase/migrations/20260423153544_937751fe-*.sql` — `organization_id` em ml_ads_products_cache
- `supabase/migrations/20260604140000_drop_obsolete_ads_products_unique.sql` — onConflict atual `(organization_id, ml_user_id, item_id, date)` (série por dia)
- `supabase/functions/sync-ads/index.ts` — como `ml_ads_products_cache` é populado (per-product per-day, coluna `date`); `ml_ads_daily_cache` (total autoritativo)
- `supabase/functions/consultor-insights/index.ts` — engine; RULE 3 `ads_no_sale` (org-level, a ser upgraded); config `tacos_alert_pct=15`/`acos_alert_pct=30`/`ads_no_sale_days=7`

### Frontend — superfícies de exibição
- `src/pages/mercadolivre/MLAnuncios.tsx` — visão "financeiro" (`columnView`), coluna nova operacional/pós-ads (D-03)
- `src/pages/mercadolivre/MLConsultor.tsx` + card "O que fazer agora" em `MercadoLivre.tsx` — insight `ads_eating_margin` (D-04)
- `src/pages/mercadolivre/MercadoLivre.tsx` + MLCostCard/DRE — MCO agregado (D-05)
- `src/hooks/useMLProductMargins.ts`, `src/hooks/useMLMarginAnalysis.ts` — consumidores de margem por produto
- `src/hooks/useMLAds.ts`, `src/hooks/useMLAdsDerivedMetrics.ts` — TACoS/ACoS/spend derivados

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`get_margin_by_product`** (RPC) — margem operacional por `item_id` já calculada (CMV/comissão/frete/imposto). Estender com ads, não recriar. ⚠ É orders-based: produtos sem venda não aparecem (relevante para D-11).
- **`ml_ads_products_cache`** — atribuição direta por item com coluna `date` → "mesma janela" (SC1) e ads_no_sale por produto (SC5) viáveis. Somar por `item_id` no range.
- **`ml_ads_daily_cache`** — total de ads da conta, autoritativo (reconcilia com products) → fonte do MCO agregado (D-12).
- **EF `consultor-insights`** — padrão de regra (config + template + impacto R$) + `consultor_config` por org. Nova regra segue o molde.
- **MLAnuncios `columnView` "financeiro"** — slot pronto para colunas operacional/pós-ads.
- **MLCostCard / DRE (`ml_billing_daily`, mês 01–31)** — slot para linha de publicidade/MCO agregado.

### Established Patterns
- Escopo de dados sempre `organization_id` + `ml_user_id`; RLS **org-first** (`is_org_member`). Nada novo a criar se reusar tabelas existentes.
- pg_cron Pattern B (vault `SERVICE_ROLE_KEY` = `sb_secret_`) — se a nova regra exigir cadência, segue o cron do engine Phase 45 (já roda diário + on-demand).
- **PostgREST trunca em 1000 linhas** (`feedback_postgrest_pagination`) — RPC/select da nova fonte DEVE paginar/agregar server-side (MCO-01 exige "sem truncamento").

### Integration Points
- Nova RPC margem+ads ← consumida por MLAnuncios (coluna), MLConsultor (insight) e potencialmente o card DRE.
- Nova regra `ads_eating_margin` ← grava em `insights` (Phase 45), aparece no card "O que fazer agora" e no painel.
- MCO agregado ← cruza `get_cost_waterfall`/margem de contribuição com `ml_ads_daily_cache`.

</code_context>

<specifics>
## Specific Ideas

- Defaults do alerta (D-06): **Crítico pós-ads ≤ 0%**, **Alerta pós-ads ≤ 10%** — alinhado ao alvo de margem da Phase 45.
- Texto do insight deve ser leigo e em R$ (padrão D-14/D-22 Phase 45): ex. *"O produto X tem lucro operacional positivo, mas a publicidade está comendo R$ Y/mês — a margem cai de Z% para W%."*
- Validação: reconciliação ads por produto (Σ products_cache) vs `ml_ads_daily_cache` deve bater ~100% (premissa da decisão travada).
- Multi-conta: 2 contas ML em produção (1639558873 Pé Vermeio + 427063369) — escopo `organization_id` + `ml_user_id` em tudo.

</specifics>

<deferred>
## Deferred Ideas

- **UI para o lojista editar os limiares de erosão na tela** → fica via SQL no v1 (como Phase 45 D-02); UI de config é fase futura (Phase 46 UX).
- **Atribuir campanhas de marca/display a itens específicos** → fora do escopo; MCO agregado usa total da conta (D-12).
- **Score/insights separados por loja ML** → ideia futura (já deferido na Phase 45); v1 consolida por org.

None — discussão ficou dentro do escopo da fase.

</deferred>

---

*Phase: 48-mco-com-ads*
*Context gathered: 2026-06-14*
