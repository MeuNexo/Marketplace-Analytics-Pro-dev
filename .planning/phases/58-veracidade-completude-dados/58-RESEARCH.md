# Phase 58 — Auditoria de Veracidade & Completude dos Dados do Nexo

**Data:** 2026-06-24 · Org de teste: Pé Vermeio `7f615df7-…` (loja ML 1639558873) · Projeto `ckcdevcxgvueywivefgx`
**Método:** 4 auditores paralelos cruzaram cada tool do nexo-chat contra a fonte-da-verdade do dashboard, com SQL real. Tudo abaixo tem evidência numérica.

> **Conclusão geral:** não é falha da IA — são **fontes incompletas, semântica ambígua e gaps de cobertura**. Achados em TODOS os domínios. Severidade: 🔴 crítico · 🟠 alto · 🟡 médio · ⚪ baixo/cosmético.

---

## 1. ESTOQUE & COBERTURA

- 🔴 **EST-1 `get_inventory` sem busca retorna só PAUSADOS.** Ordena `available_quantity ASC` + cap 50, sem filtrar status → as 50 primeiras são 100% `paused`. "Quanto tenho em estoque?" devolve anúncios fora do ar; campeões ativos (qty 71, 66) nunca aparecem. **Fix:** default `status='active'` (ou separar ativos/pausados) + ordenar por relevância.
- 🟠 **EST-2 Mascara ruptura por variação.** Expõe só `available_quantity` item-level; ignora o jsonb `variations`. Real: Coturno `MLB4265421967` item-level=33, mas tamanho **38 BR = 0**; **26 de 29 itens ativos com variação têm ≥1 tamanho esgotado**. Nexo diz "33, tudo certo". Dashboard expõe variações. **Fix:** expor/resumir variações com qty=0 ("X tamanhos esgotados de N").
- 🟠 **EST-3 É só estoque FULL — não há CD/Tiny nesta base.** 100% `logistic_type=fulfillment`; varredura de schema: nenhuma tabela de saldo CD/total/Tiny. **Fix:** rotular SEMPRE "estoque Full (fulfillment)"; nunca afirmar "ruptura" como fato absoluto a partir do Full. (Saldo Tiny vive no MCP Meu_Nexo, fora deste banco.)
- 🟡 **EST-4 `get_coverage` usa denominador fixo /30** independente do `from` (subestima venda diária em janelas curtas → cobertura inflada). Ruptura só do Full. **Fix:** usar intervalo real ou documentar janela fixa 30d.
- 🟡 **EST-5 `sold_quantity` é histórico acumulado** (ex: 1748), não venda do período nem estoque. Description não qualifica. **Fix:** rotular "total histórico do anúncio".
- 🟡 **EST-6 Sem agregado de total** (total Full ativo real = 1.585 un). "Quantas unidades no total?" sem resposta. **Fix:** retornar resumo (itens, soma, ativos/pausados, nº ruptura).
- **GAPs:** estoque por tamanho/cor; saldo CD/Tiny; valor de estoque parado / ABC / cobertura por marca; total de unidades.

## 2. VENDAS · MARGEM · ADS

- 🔴 **VMA-1 `get_ads_campaigns` retorna métricas ZERADAS.** As 9 campanhas têm spend/impressions/clicks/roas = 0 (só nome/status preenchidos); no mesmo período products tem R$8.111 real. Tabela `ml_ads_campaigns_cache` sem coluna `date` (snapshot lifetime quebrado). Nexo dirá "todas campanhas ROAS 0" — falso. **Fix:** corrigir o sync da tabela OU remover a tool até consertar.
- 🟠 **VMA-2 Faturamento Nexo ≠ dashboard.** Dashboard `/vendas` (`ml_daily_cache.total_revenue`) = **R$296.345 / 1.029 pedidos**; Nexo (`get_kpi_summary`/`get_cost_waterfall` sobre `orders` pagos) = **R$286.643 / 991**. Gap R$9.702. **Fix:** alinhar semântica — ler `ml_daily_cache` para "faturamento" OU descrição explícita "receita líquida de pedidos pagos".
- 🟠 **VMA-3 Filtro de status quebrado.** `orders` só tem `paid`/`cancelled`/`partially_refunded`. RPCs filtram `IN('paid','shipped','delivered')` → `shipped`/`delivered` nunca casam e **`partially_refunded` (21 pedidos) é totalmente excluído** de receita/margem. **Fix:** revisar set de status nas RPCs.
- 🟡 **VMA-4 `get_ads_by_product` é top-50 por gasto** (paginação .range OK, agregado bate), mas o modelo pode somar 50 e achar que é o total da conta. **Fix:** descrição "top 50 por gasto, não o total".
- 🟡 **VMA-5 RPC homônima armadilha:** existe `get_margin_by_product` (SEM ads) e `get_margin_with_ads_by_product`. A tool usa a com-ads (OK hoje), mas o nome convida regressão. **Fix:** depreciar/comentar.
- 🟡 **VMA-6 `attributed_revenue` (R$118.583) ≠ faturamento** — receita atribuída a ads (~41% do total). **Fix:** descrição alerta "subconjunto do faturamento, não total vendido".
- 🟡 **VMA-7 `get_day_kpis` (waterfall) não inclui tarifas fixas ML** (CFFE/CFONPN/PADS) que o DRE do dashboard soma via billing. **Fix:** descrição "não inclui tarifas ML — para DRE use get_dre_monthly".
- **GAPs:** performance real por campanha (VMA-1); agregado total de ads da conta; DRE de período arbitrário com billing; cancelados/taxa de cancelamento/reembolso parcial.

## 3. FINANCEIRO (DRE · CAIXA · CUSTOS · FORNECEDORES)

- 🟠 **FIN-1 `get_dre_monthly` usa fonte diferente do card DRE.** Nexo lê `ml_billing_monthly` (ciclo fatura 06→05) = junho **R$43.869**; dashboard usa `ml_billing_daily` (mês-calendário 01–31) = **R$34.853**. ~R$9k e conceitos distintos. **Fix:** Nexo agregar `ml_billing_daily` por mês-calendário (igual ao dashboard) OU deixar explícito "fatura por ciclo 06→05".
- 🟠 **FIN-2 `ml_billing_daily` (fonte do dashboard) está DEFASADA.** Parou em 06-12 (sem cron de sync; só on-demand). Monthly está fresco (06-24). Os dois divergem da realidade e entre si. **Fix:** cron diário de re-sync do mês corrente. *(Bug do dashboard, mas afeta a reconciliação Nexo×painel.)*
- 🟡 **FIN-3 `get_cashflow` +90d projeta -R$734k vs Tesouraria 30d -R$182k.** As RPCs são consistentes no mesmo horizonte; a diferença é o horizonte. Mas inflows só existem até ~+27d e outflows até 2030 → o tombo de 90d é em parte artefato. **Fix:** alinhar horizonte default ao painel (30d) ou citar o horizonte e não projetar saldo além da cobertura real de inflows.
- 🟡 **FIN-4 `get_costs_by_month` NÃO é DRE/fatura — é fluxo de caixa por categoria** (Fornecedores R$140k, Salários, Empréstimo…). Descrição diz "Custos/DRE… fatura ML" (errado). Risco de o Nexo chamar desembolso de CMV. **Fix:** corrigir descrição "saídas de caixa por categoria/mês — não é CMV nem fatura ML".
- 🟡 **FIN-5 `get_dre_monthly` chamado "DRE" mas só traz fatura ML** (cffe/cfonpn/total). Sem CMV/impostos/lucro. **Fix:** redescrever "fatura/tarifas ML"; DRE completo = get_margin_summary + CMV.
- ✅ **FIN-OK `get_supplier_exposure`** totalmente categorizado (0 sem fornecedor); saldo de hoje bate (R$18.458,84); cashflow×treasury idênticos no mesmo horizonte.
- **GAPs:** saldo de caixa de HOJE como campo nomeado; DRE completo mês-calendário (card do dashboard); impostos do regime; contas a pagar por vencimento (aging).

## 4. OPERACIONAL & SAÚDE (PERGUNTAS · DEVOLUÇÕES · REPUTAÇÃO · METAS · SCORE)

- 🟠 **OPS-1 GAP Reputação — nenhuma tool, nenhuma fonte persistida.** Dashboard `/reputacao` busca ao vivo da EF `ml-reputation` (nível/termômetro, claims_rate, cancellation_rate, power_seller). Nexo só tem o pilar `score_reputacao` (57/100). "Qual meu termômetro/estou Verde?" sem resposta. **Fix:** tool `get_reputation` chamando a EF `ml-reputation` por ml_user_id (precedente: MCP Meu_Nexo já tem).
- 🟠 **OPS-2 GAP Metas — dado existe, sem tool.** `ml_targets` tem meta jun/2026 (receita **R$583.000**, lucro 9%). Sem tool direta ("como está minha meta do mês"). ⚠️ scoping: `ml_targets` é por `user_id`+`seller_id`, **sem `organization_id`** → anti-IDOR via `seller_id ∈ mlUserIds`. **Fix:** tool `get_goals(period_month?)` cruzando meta × realizado (get_kpi_summary).
- 🟡 **OPS-3 `get_claims` expõe campos mortos e não distingue status.** `data_limite` e `solucao` são 100% NULL (sync nunca popula), mas a description promete "prazos". Não retorna status/tipo agregado (todos 59 `opened`; tipos: mediations 43, returns 13, change 2, cancel_purchase 1). **Fix:** remover campos mortos (ou popular no sync) + expor aberto×total + tipos.
- 🟡 **OPS-4 `get_health_score` ordena por `created_at`** (dashboard usa `snapshot_month`). Latente: snapshot antigo regravado viria "mais novo". Sem `scoreDelta`. **Fix:** ordenar por `snapshot_month DESC` + opcional delta.
- ⚪ **OPS-5 `get_open_questions`** OK (resposta IS NULL coincide com status UNANSWERED nesta base). Cosmético: alinhar a `status='UNANSWERED'`.
- ✅ **OPS-OK `get_active_insights`** em paridade com `/consultor`.

---

## Resumo executivo de severidade

| # | Sev | Domínio | Problema |
|---|-----|---------|----------|
| EST-1 | 🔴 | Estoque | get_inventory mostra só pausados |
| VMA-1 | 🔴 | Ads | get_ads_campaigns 100% zerado (cache quebrado) |
| EST-2 | 🟠 | Estoque | ruptura por tamanho mascarada (item-level) |
| EST-3 | 🟠 | Estoque | só Full, não rotulado |
| VMA-2 | 🟠 | Vendas | faturamento 286k (Nexo) vs 296k (painel) |
| VMA-3 | 🟠 | Vendas | status quebrado (ignora partially_refunded) |
| FIN-1 | 🟠 | DRE | monthly (ciclo) vs daily (calendário) ~R$9k |
| FIN-2 | 🟠 | DRE | ml_billing_daily defasado (sem cron) |
| OPS-1 | 🟠 | Reputação | GAP total (sem tool) |
| OPS-2 | 🟠 | Metas | GAP (dado existe: R$583k) |
| EST-4/5/6, VMA-4/5/6/7, FIN-3/4/5, OPS-3/4/5 | 🟡/⚪ | vários | semântica/descrição/rótulo |

## Padrões transversais (causas-raiz)
1. **Full ≠ total** (estoque) e **fatura-ciclo ≠ mês-calendário** (DRE) e **pago ≠ todos** (faturamento): mesma classe — fonte/escopo diferente do dashboard.
2. **Item-level ≠ variação**; **vendido/atribuído ≠ estoque/faturamento**: confusão de campo.
3. **Caches sem cron** (billing_daily) ou **quebradas** (ads_campaigns): dado defasado/zerado.
4. **Cobertura incompleta:** reputação e metas sem tool; agregados/totais ausentes.
5. **Sem rótulo de frescura/limitação:** o Nexo afirma como atual/absoluto o que é parcial.

## Recomendação
Planejar e executar a **Phase 58** para corrigir tudo acima (VERAC-01..07), priorizando os 🔴/🟠. Os 🟡 de descrição/rótulo são baratos e entram juntos. Itens que são bug do dashboard (FIN-2 cron billing, VMA-1 sync campaigns) podem virar tarefas próprias mas afetam o Nexo.
