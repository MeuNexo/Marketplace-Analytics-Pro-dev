# Phase 101: Detalhamento de MCO e recomendação de margem na página /analise-precos - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A página `/analise-precos` (`MLAnalisePrecos.tsx` → `PrecoPraticadoReport.tsx`, entregue nas Phases 77/79/81/82) já mostra um gráfico preço × break-even com colchão verde/vermelho e um tooltip (hover) com a decomposição por unidade (custo, comissão, frete, ads, imposto) — ver `79-CONTEXT.md`. Essa phase entrega duas coisas novas:

1. **Detalhamento de MCO sempre visível** — um card fixo abaixo do gráfico com o waterfall completo por unidade (receita → CMV → comissão → frete → impostos → MC → ads → MCO), para o anúncio/variação selecionado no seletor existente. Não depende de hover.
2. **Recomendação de margem** — usando a mesma faixa de saúde já travada em `mcoHealth.ts` (Phase 83: 🔴≤5% 🟡6-8% 🟢≥9%) como padrão, mais um campo editável de **meta de MCO% customizada por item_id** direto na página, persistida por SKU. A partir da meta (padrão ou customizada), a página sempre mostra **duas alavancas de recomendação**: preço mínimo de venda para atingir a meta, e ACOS-alvo da campanha de ads para atingir a meta mantendo o preço atual.

**Fora de escopo:** mudar a fórmula de MCO (`src/lib/mco.ts` continua fonte da verdade), criar faixas de saúde diferentes por categoria de produto (a faixa global do `mcoHealth.ts` continua o padrão — só a META é customizável, não a faixa de cores em si), tela de comparação lado a lado entre múltiplos itens (a página continua single-item via seletor existente).

</domain>

<decisions>
## Implementation Decisions

### Onde mostrar o detalhamento
- **D-01:** Card fixo (sempre visível, não é tooltip/hover) posicionado abaixo do gráfico existente, para o anúncio + variação atualmente selecionados no seletor.
- **D-02:** Granularidade do waterfall = **por unidade, média do período selecionado** (mesmo período dos KPIs/filtro de data já existentes na página) — receita/un, CMV/un, comissão/un, frete/un, impostos/un, MC/un, ads/un, MCO/un. Não é o total do período (isso já está nos KPIs do topo).
- **D-03:** O tooltip existente do gráfico (Phase 79) permanece como está — o card novo é adicional, não substitui o tooltip.

### Faixa de margem recomendada
- **D-04:** Faixa PADRÃO = reusar `MCO_SAUDAVEL_PCT` de `src/lib/mcoHealth.ts` (🔴≤5% 🟡6-8% 🟢≥9%), a mesma da Phase 83 — zero divergência entre páginas.
- **D-05:** Além do padrão, permitir **meta de MCO% customizada por item_id**, configurável **direto na `/analise-precos`** (não em `/precos-custos` nem outra página) — um campo editável no card de detalhamento (ex: input "Meta MCO%: [12]"), persistido por SKU/item_id no backend. Quando não há meta customizada definida, usa o padrão (D-04) como referência.
- **D-06 (planner/researcher decide o mecanismo exato de persistência):** precisa de alguma forma de guardar a meta por `item_id` (nova coluna/tabela pequena, escopo da org). Não há tabela existente para isso — pesquisar o padrão mais simples e consistente com o resto do schema (ex: tabela de config por item, análoga a outras configs por SKU já existentes no projeto).

### Tipo de recomendação
- **D-07:** Quando a página calcula a recomendação, ela mostra **as duas alavancas simultaneamente**: (a) preço mínimo de venda necessário para atingir a meta (mesmo cálculo de "preço de equilíbrio" que fizemos manualmente na conversa: `preço = (cmv_unit + frete_unit + ads_unit) / (1 - taxa_comissão - taxa_imposto)`, generalizado para a meta MCO% em vez de MCO=0), e (b) o ACOS-alvo que a campanha precisaria ter para atingir a meta mantendo o preço atual.
- **D-08:** A recomendação (ambas alavancas) fica **sempre visível** no card — não é condicional a estar abaixo da meta. Mesmo com MCO saudável, o usuário vê a referência de preço mínimo / ACOS-alvo.

### Claude's Discretion
- Layout exato do card (grid de linhas do waterfall, onde entram os dois números de recomendação dentro do card).
- Texto/copy exato dos rótulos e tooltips auxiliares do card novo.
- Detalhes visuais (cores, tokens) — seguir a paleta CVD-safe já validada (skill `dataviz`) e os tokens do projeto (`--success`, `--warning`, `--destructive`, `--kpi-*`).
- Comportamento quando `custo_unit` está ausente para o item (seguir o padrão já estabelecido nas Phases 79-83: nunca inventar número, mostrar aviso "custo ausente").

### Decisões pós-pesquisa (RESEARCH.md levantou 2 perguntas em aberto, travadas por Wesley)
- **D-09 (grão da meta):** meta de MCO% customizada é **por anúncio inteiro (`item_id`)**, não por SKU/variação. Confirma o design mais simples já sugerido pelo pesquisador — tabela nova `ml_mco_targets` chaveada por `(organization_id, item_id)`.
- **D-10 (piso mínimo de amostra):** a recomendação (preço mínimo + ACOS-alvo) **sempre calcula e aparece**, mesmo com poucas vendas no período (sem piso mínimo de unidades). Os avisos já existentes de custo/imposto ausente continuam cobrindo os casos de dado ruim — não criar um novo gate de "amostra pequena".

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Página e componente a estender
- `src/pages/mercadolivre/MLAnalisePrecos.tsx` — página wrapper, fonte da lista de produtos/seletor.
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente principal (gráfico + KPIs + seletor de anúncio/variação); o card novo entra aqui, abaixo do gráfico.
- `src/lib/precoMcoSeries.ts` — util puro que já calcula a série de MCO por bucket (fonte de dados do gráfico); o card de detalhamento deve derivar do mesmo cálculo/série, não duplicar lógica.

### MCO — fórmula e faixas (reutilizar, não recriar)
- `src/lib/mco.ts` — `computeMco`, fórmula canônica (receita − cmv − comissão − frete − ads − imposto). Fonte da verdade.
- `src/lib/mcoHealth.ts` — `MCO_SAUDAVEL_PCT` (5%/9%), `classifyMcoHealth`, `mcoHealthRole` — reusar para o semáforo padrão desta phase.
- `src/lib/kpi-glossary.ts` — glossário de termos MCO (manter consistência de texto).

### Backend / RPC
- `supabase/migrations/20260677000000_orders_price_timeseries.sql` (e extensões das Phases 79/81/82) — RPC que já traz cmv, comissão, frete, impostos por bucket; fonte para o waterfall por unidade do card.
- Deploy de qualquer migration/EF **só via MCP** (`mcp__claude_ai_Supabase__apply_migration` / `deploy_edge_function`), projeto `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md). Nunca SQL Editor (drift).
- SECURITY INVOKER sem parâmetro de org (anti-IDOR, Phases 63/69/79). Sem subquery correlacionada em RPC INVOKER (timeout 8s).

### Padrões da linhagem Análise de Preços / Produtos Vendidos (phases 79-83)
- Nunca inventar número quando `custo_unit` ausente — avisar, não zerar/estimar.
- Paleta CVD-safe validada pela skill `dataviz` (`references/palette.md`), validar em light + dark.
- `data_pedido` é TEXT com formatos mistos → cast `::date` em qualquer query nova.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KPICard` (`src/components/dashboard/KPICard.tsx`) — usado para os 6 KPIs atuais da página; pode servir de referência visual para o card novo, mas o card de detalhamento é um componente próprio (lista/waterfall, não um grid de KPIs soltos).
- `computeMco` / `mcoHealth.ts` — cálculo e classificação de saúde já prontos, zero necessidade de nova lógica de fórmula.
- `ChartTooltip` (dentro de `PrecoPraticadoReport.tsx`) — já mostra decomposição por unidade; o card novo pode reaproveitar a mesma lógica de formatação de valores (evitar duplicar `Row`/formatters).

### Established Patterns
- Página é single-item (seletor de anúncio + variação/SKU) — o card de detalhamento segue esse mesmo escopo (1 item por vez), sem comparação lado a lado.
- Toggle "incluir ads" (Phase 79, default ON) já existe — o card de detalhamento deve respeitar esse toggle (waterfall com/sem ads conforme o estado do toggle).

### Integration Points
- O card entra dentro do mesmo componente `PrecoPraticadoReport.tsx`, abaixo do gráfico, reagindo ao mesmo estado (`selectedId`, `selectedSku`, `currentFrom`/`currentTo`) já gerenciado pelo componente.
- Persistência da meta customizada por item_id é o único ponto que precisa de superfície de backend nova (schema a definir pelo researcher/planner).

</code_context>

<specifics>
## Specific Ideas

- Formato de linha do waterfall: igual ao que fizemos manualmente na conversa — ex. "(−) CMV: R$ 59,00 (42,1%)" — valor em R$ e % da receita lado a lado, por linha.
- Cálculo de "preço mínimo recomendado" = generalização do preço de equilíbrio calculado na conversa (ex: Carabina Rossi → R$678,30 para MCO=0%; aqui generalizar para MCO=meta%, não só zero).
- ACOS-alvo = a lógica inversa: dado o preço atual e a meta de MCO%, qual ACOS a campanha de ads precisaria ter (equivalente ao "break-even ACOS" que já usamos nos playbooks de ads, mas ajustado para a meta em vez do break-even puro).

</specifics>

<deferred>
## Deferred Ideas

- Comparação lado a lado entre múltiplos itens (ex: Pistola vs Carabina na mesma tela) — usuário optou por manter escopo single-item nesta phase; pode virar phase futura se a necessidade aparecer de novo.
- Faixas de saúde diferentes por categoria de produto (em vez de uma faixa global) — usuário decidiu manter a faixa global do `mcoHealth.ts`, só a meta numérica é customizável por item.
- Configuração da meta customizada em `/precos-custos` em vez de `/analise-precos` — descartado, mas anotado caso a UX evolua para centralizar configs de produto lá no futuro.

### Reviewed Todos (not folded)
None — discussão não cruzou com todos pendentes.

</deferred>

---

*Phase: 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis*
*Context gathered: 2026-07-19*
