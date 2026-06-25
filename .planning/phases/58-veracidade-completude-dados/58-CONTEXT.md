# Phase 58: Veracidade & Completude dos Dados do Nexo — Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Source:** Auditoria de 4 domínios (58-AUDIT.md / 58-RESEARCH.md) + decisões travadas com Wesley nesta sessão

<domain>
## Phase Boundary

Corrigir os achados da auditoria (58-AUDIT.md) para que o chat **Nexo** (EF `nexo-chat`, 22 tools read-only) nunca afirme um fato errado por fonte incompleta, semântica ambígua ou cobertura faltante. Princípio mestre: **cada tool reflete a fonte-da-verdade do dashboard** (mesma fonte/escopo/semântica), e o que for parcial (Full, ciclo de fatura, top-50) é **rotulado**, nunca afirmado como absoluto/total.

Escopo = ajustar `supabase/functions/nexo-chat/tools.ts` (dispatcher + declarations) e `prompt.ts`; adicionar 2 tools novas (reputação, metas); ajustes pontuais de RPC/cron quando o dado em si está errado; re-rodar a bateria de testes por domínio. Frontend do chat NÃO muda (UI já aprovada). Continua read-only e anti-IDOR.

NÃO faz parte: refazer o pipeline de sync de ads campaigns do zero (neutralizar é suficiente); trazer estoque CD/Tiny (não existe nesta base); mudanças no dashboard além do mínimo que afeta a veracidade do Nexo.
</domain>

<decisions>
## Implementation Decisions (travadas)

### Princípio
- **D0 — Nexo bate com o dashboard.** Para todo indicador compartilhado, a tool usa a MESMA fonte/escopo/semântica que a página correspondente mostra. Se Wesley vê R$296k no painel, o Nexo diz R$296k para "quanto vendi". Divergência de fonte = bug.
- **D0b — Parcial é rotulado, nunca absoluto.** Full≠total, fatura-ciclo≠mês-calendário, pago≠todos, top-50≠total, vendido≠estoque, attributed≠faturamento, passado≠projeção. A tool/descrição deixa explícito; o Nexo declara a limitação em vez de inventar ou dizer "não configurado".

### Estoque (EST-1..6)
- **D1** `get_inventory`: default `status='active'` (não soterrar com pausados); retornar um **resumo agregado** (nº itens, total de unidades Full, ativos/pausados, nº com algum tamanho esgotado) + a amostra. Rotular tudo como "estoque Full (fulfillment)".
- **D2** Expor **variações** quando `has_variations=true`: resumir tamanhos/cores com qty=0 ("X de N tamanhos esgotados") a partir do jsonb `variations`. Aceitar `search` (já existe) p/ produto específico.
- **D3** `get_coverage`/descrições: rotular "ruptura no Full"; corrigir denominador da janela OU documentar 30d fixo; `sold_quantity` = "total histórico do anúncio".

### Vendas/Margem/Ads (VMA-1..7)
- **D4** **Faturamento** do Nexo alinhado ao painel `/vendas` (fonte `ml_daily_cache` / mesma que o card "Receita Total"). Manter `get_margin_summary` (líquido/pago) com rótulo claro de que é receita de pedidos pagos.
- **D5** **get_ads_campaigns NÃO retorna métrica zerada como verdade.** Como `ml_ads_campaigns_cache` está zerada/sem `date`: neutralizar a tool (retornar só nome/status + aviso "sem dados de performance") OU removê-la; e **adicionar `get_ads_account_summary`** (gasto/ROAS/receita atribuída totais do período a partir de `ml_ads_daily_cache`) para a visão agregada confiável.
- **D6** Descrições: `get_ads_by_product` = "top 50 por gasto, não o total"; `attributed_revenue` = "receita atribuída a ads, subconjunto do faturamento"; `get_day_kpis` = "waterfall de pedidos, NÃO inclui tarifas fixas ML — para DRE use get_dre_monthly".
- **D7** Status dos pedidos: tratar `partially_refunded` (não ignorar) e remover estados mortos `shipped`/`delivered` da lógica. **Cuidado:** se a correção for na RPC compartilhada, validar que o número do dashboard também fica correto (alinhamento, não regressão). Preferir não divergir do que o painel exibe hoje.

### Financeiro (FIN-1..5)
- **D8** `get_dre_monthly` alinha ao card DRE do dashboard = agregar **`ml_billing_daily` por mês-calendário** (mesma lógica do `useMLBillingDaily`), não o ciclo de fatura. Rotular. Manter um modo "fatura por ciclo" só se útil, explicitamente nomeado.
- **D9** Corrigir defasagem de `ml_billing_daily` (FIN-2): cron diário de re-sync do mês corrente (ou re-disparo quando cobertura < ontem). Sem isso o número fica parcial.
- **D10** `get_cashflow`: default de horizonte coerente com o painel de Tesouraria (30d) OU citar o horizonte e não projetar saldo além da cobertura real de inflows; expor **saldo de hoje** como campo nomeado.
- **D11** `get_costs_by_month`: corrigir descrição — é "saídas de caixa por categoria/mês (pagas + a pagar)", NÃO CMV nem fatura ML. `get_dre_monthly` redescrever "fatura/tarifas ML" (não DRE completo).

### Operacional & Saúde (OPS-1..5)
- **D12** **Nova tool `get_reputation`**: chama a EF `ml-reputation` por `ml_user_id` (mesma fonte do `/reputacao`: nível/termômetro, claims_rate, cancellation_rate, power_seller). Read-only.
- **D13** **Nova tool `get_goals(period_month?)`**: lê `ml_targets` escopado por `seller_id ∈ mlUserIds` (atenção: `ml_targets` NÃO tem `organization_id` → anti-IDOR via seller_id derivado server-side da org). Cruza meta × realizado (get_kpi_summary) → meta, realizado, % atingido.
- **D14** `get_claims`: remover campos mortos `data_limite`/`solucao` (100% null) ou popular no sync; expor `status`+`tipo` e contagem aberto×total. `get_health_score`: ordenar por `snapshot_month DESC` (casar com dashboard) + opcional delta. `get_open_questions`: alinhar a `status='UNANSWERED'` ou documentar.

### Prompt & frescura (VERAC-04/05/06)
- **D15** `prompt.ts`: reforçar — use a fonte certa por pergunta; Full≠total e passado≠futuro; se a tool vier vazia/parcial, declare o que tem/falta (sem inventar, sem "não configurado"); sinalize defasagem quando a frescura indicar.
- **D16** Tools relevantes expõem `synced_at`/recência para o modelo poder sinalizar dado defasado.

### Testes (VERAC-07)
- **D17** Re-rodar a bateria de auditoria por domínio APÓS os fixes (mesmo método: comparar tool vs fonte-da-verdade com SQL real da Pé Vermeio) e registrar que cada domínio bate. Testes unitários do `tools.ts` atualizados (anti-IDOR mantido).
</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/58-veracidade-completude-dados/58-AUDIT.md` — achados com evidência SQL (a pesquisa desta fase).
- `supabase/functions/nexo-chat/tools.ts` + `prompt.ts` + `tools.test.ts` — alvos principais.
- Fontes-da-verdade do dashboard (ler antes de alinhar cada métrica):
  - Vendas/KPIs: `src/hooks/useMLDailyQuery`/`mlCacheService` (ml_daily_cache); `get_kpi_summary`.
  - Margem: `get_margin_with_ads_by_product`, `useMLOrdersByBrand`; página `MLProdutos.tsx`.
  - Ads: EF `ml-ads`, `ml_ads_daily_cache`/`ml_ads_products_cache`; `MLAnuncios.tsx`.
  - DRE/billing: `useMLBillingDaily`/`useMLBilling*`, `ml_billing_daily`; card "DRE do Mês" em `MercadoLivre.tsx`/`MLCostCard`.
  - Caixa/Tesouraria: `useTreasuryPanel`/`useCashflow*`, RPC `get_cashflow`/`get_treasury_panel`.
  - Estoque: `MLInventoryContext`/`useMLInventory*`, `MLEstoque.tsx`; `ml_inventory_cache` (+ jsonb variations); `get_consultor_coverage`.
  - Reputação: EF `ml-reputation`, `useMLReputation`, `MLReputacao.tsx`.
  - Metas: `ml_targets`, `useSettings().getTarget()`, `GoalsCard`, `MLMetas.tsx`.
- Anti-IDOR/segurança: padrão do próprio `tools.ts` (org/seller só do servidor) + `feedback_supabase_security_invoker`.
- Deploy de EF (`nexo-chat`) = checkpoint do orquestrador (CLI com SUPABASE_ACCESS_TOKEN); executor não deploya.
</canonical_refs>

<specifics>
## Specific Ideas
- Os 🔴 (get_inventory só pausados; get_ads_campaigns zerado) entram primeiro.
- Mudanças em RPC compartilhada com o dashboard exigem verificar que o número do painel também fica correto (alinhar, não regredir) — preferir ajuste na camada da tool quando a RPC serve o dashboard como está.
- Reputação e metas são tools novas (não mexem nas existentes).
- Re-teste por domínio é critério de aceite (VERAC-07), não opcional.
</specifics>

<deferred>
## Deferred Ideas
- Trazer estoque CD/Tiny (não existe nesta base; viria de outra integração).
- Refazer do zero o sync de métricas de campanhas de ads (neutralizar basta por ora).
- Curva ABC / valor de estoque parado / aging de contas a pagar como tools dedicadas (avaliar após o core).
</deferred>

---

*Phase: 58-veracidade-completude-dados*
*Context: 2026-06-24 (decisões + auditoria)*
