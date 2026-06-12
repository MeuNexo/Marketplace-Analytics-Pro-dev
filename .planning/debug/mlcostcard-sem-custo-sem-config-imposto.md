---
status: awaiting_human_verify
trigger: "Card Custos em /vendas mostra s/ custo e s/ config para Impostos ao visualizar Hoje"
created: 2026-06-02T00:00:00Z
updated: 2026-06-02T00:00:00Z
---

## Current Focus

hypothesis: useMLCostWaterfall retorna null quando paid_revenue=0 (sem orders hoje). useAutoRecalc só dispara quando costWaterfall === null — correto. Mas o autoRecalc dispara bulk-dispatch-sync-jobs para sincronizar orders, espera 8s, e faz recalc. O problema real é que mesmo após isso, se não existirem orders em 'orders' para hoje, get_cost_waterfall retorna 0 rows → paid_revenue=0 → hook retorna null novamente. Loop inútil. A solução correta é usar estimativa baseada em % histórico de CMV e impostos aplicado à receita de hoje do ml_daily_cache.

test: Verificar o que costWaterfall recebe quando período é "Hoje" e não há orders no banco
expecting: costWaterfall === null, impostosTotal === null → MLCostCard recebe cmv=null e impostos=null → mostra "s/ custo" e "s/ config"
next_action: Implementar fallback de estimativa: quando costWaterfall === null mas há receita em effectiveMetrics, calcular CMV e impostos usando % médio dos últimos 30 dias via waterfall mensal

## Symptoms

expected: Card Custos em /vendas deve mostrar CMV e Impostos com valores reais calculados dos orders do dia
actual: Card mostra "s/ custo" e "s/ config" ao selecionar período "Hoje"
errors: Nenhum erro visível — o card renderiza mas sem os valores de CMV e Impostos
reproduction: Abrir /vendas, selecionar período "Hoje", observar card Custos
started: Nunca funcionou para "Hoje". Para períodos passados (ex: Maio) funciona.

## Eliminated

- hypothesis: useAutoRecalc não estava sendo chamado
  evidence: MercadoLivre.tsx linha 184 chama useAutoRecalc(costWaterfall, autoRecalcOrgId, resolvedMLUserIds, currentFrom, currentTo)
  timestamp: 2026-06-02T00:01:00Z

- hypothesis: período "Hoje" gera currentFrom/currentTo incorretos
  evidence: useMLFilters.ts getComparisonRanges(period=0) retorna { currentFrom: today, currentTo: today } — correto
  timestamp: 2026-06-02T00:01:00Z

- hypothesis: MLCostCard renderiza "s/ custo" por bug no componente
  evidence: MLCostCard.tsx linha 146 mostra nullLabel quando value === null — comportamento correto, o problema é que cmv e impostos chegam null
  timestamp: 2026-06-02T00:01:00Z

## Evidence

- timestamp: 2026-06-02T00:01:00Z
  checked: useMLCostWaterfall.ts linha 57
  found: Se paid_revenue === 0 → retorna null (sem pedidos no período)
  implication: Para "Hoje" sem orders na tabela, sempre retorna null

- timestamp: 2026-06-02T00:01:00Z
  checked: MercadoLivre.tsx linha 180
  found: impostosTotal = costWaterfall?.has_tax_data ? costWaterfall.total_tax : null
  implication: Se costWaterfall === null → impostosTotal = null

- timestamp: 2026-06-02T00:01:00Z
  checked: MercadoLivre.tsx linha 572-573
  found: cmv={costWaterfall?.has_cmv ? costWaterfall.cmv : null} e impostos={impostosTotal}
  implication: Ambos chegam null ao MLCostCard quando costWaterfall=null

- timestamp: 2026-06-02T00:01:00Z
  checked: useAutoRecalc.ts — fluxo do Caso 1
  found: bulk-dispatch-sync-jobs + 8s wait + recalc-order-costs → invalida query. Mas se orders de hoje = 0 no banco, recalc não cria dados, get_cost_waterfall ainda retorna paid_revenue=0 → null novamente
  implication: O loop de auto-recalc não resolve o problema raiz: "Hoje" pode não ter orders ainda no banco ou pode ter via ml_daily_cache mas não na tabela orders

- timestamp: 2026-06-02T00:01:00Z
  checked: MercadoLivre.tsx linhas 154-162 (monthlyFrom/monthlyTo e monthlyCostWaterfall)
  found: monthlyCostWaterfall usa período do mês corrente (início do mês até hoje). Se há orders no mês em dias passados, monthlyCostWaterfall terá has_cmv=true e has_tax_data=true com valores reais.
  implication: Pode derivar % de CMV e % de impostos do waterfall mensal e aplicar à receita de hoje

- timestamp: 2026-06-02T00:01:00Z
  checked: effectiveMetrics em MercadoLivre.tsx linhas 320-341
  found: Para "Hoje" é calculado de ml_daily_cache (allDaily). Se o sync do dia rodou, há receita total_revenue disponível mesmo sem orders na tabela orders.
  implication: A receita do dia EXISTE em allDaily/effectiveMetrics mesmo quando costWaterfall=null

## Resolution

root_cause: Para período "Hoje", a tabela orders pode não ter registros do dia atual (orders sincronizados com atraso ou ainda não sincronizados). get_cost_waterfall retorna paid_revenue=0 → hook retorna null → cmv e impostos chegam null ao MLCostCard. O autoRecalc tenta sincronizar mas não ajuda se não há orders no banco. A receita do dia está disponível via ml_daily_cache mas os custos derivados de orders (custo_unit, tax_amount) não existem ainda.
fix: Implementar fallback de estimativa para "Hoje": quando costWaterfall=null mas há receita disponível (effectiveMetrics) e há dados mensais (monthlyCostWaterfall com has_cmv e has_tax_data), calcular CMV_estimado = receita_hoje × (cmv_mensal / paid_revenue_mensal) e impostos_estimados = receita_hoje × (total_tax_mensal / paid_revenue_mensal). Passar esses valores como fallback ao MLCostCard com indicação visual de "estimativa".
verification: TypeScript passa sem erros. Lógica verificada manualmente: quando costWaterfall=null e monthlyCostWaterfall tem dados reais, os percentuais são derivados corretamente e aplicados à receita do dia.
files_changed: [src/pages/MercadoLivre.tsx]
