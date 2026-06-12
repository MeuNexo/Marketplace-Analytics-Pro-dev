---
status: awaiting_human_verify
trigger: "Card Custos na página /vendas não inclui CMV e Impostos no cálculo de Lucro Bruto"
created: 2026-06-01T00:00:00Z
updated: 2026-06-01T00:00:00Z
---

## Current Focus

hypothesis: get_cost_waterfall RPC retorna paid_revenue=0 porque receita_bruta é NULL nas orders existentes, ativando guard `if (paid_revenue === 0) return null` em useMLCostWaterfall, tornando cmv e impostos nulos para o card
test: Verificar estado dos campos receita_bruta, custo_unit, tax_amount na tabela orders via Supabase MCP
expecting: Confirmar que receita_bruta é nulo em orders antigas, ou que a RPC retorna 0 para o período
next_action: Consultar live database para ver estado dos campos

## Symptoms

expected: Card "Custos" (MLCostCard) em /vendas deve calcular Lucro Bruto como: Receita - Comissão - Frete - Publicidade - CMV - Impostos
actual: CMV e Impostos não estão sendo contabilizados no Lucro Bruto. Os outros componentes aparecem mas CMV e Impostos ficam zerados ou ausentes.
errors: Nenhum erro explícito — o card renderiza mas com valor incorreto
reproduction: Acessar /vendas e observar o card "Custos" — Lucro Bruto está inflado por não descontar CMV e Impostos
started: Provavelmente desde Phase 25 (dashboard margem com dados reais)
related: Página /pedidos também não carrega orders corretamente

## Evidence

- timestamp: 2026-06-01T00:00:00Z
  checked: MLCostCard.tsx props e cálculo
  found: Componente calcula `lucro = effectivePaid - comissao - frete - publicidade - (cmv ?? 0) - (impostos ?? 0)`. cmv e impostos são tratados como null quando não disponíveis.
  implication: O bug não é no componente. cmv e impostos chegam como null do caller.

- timestamp: 2026-06-01T00:00:00Z
  checked: MercadoLivre.tsx linha 572 e 573
  found: `cmv={costWaterfall?.has_cmv ? costWaterfall.cmv : null}` e `impostos={impostosTotal}` onde `impostosTotal = costWaterfall?.has_tax_data ? costWaterfall.total_tax : null`
  implication: Se costWaterfall é null ou has_cmv/has_tax_data são false, ambos chegam como null no componente.

- timestamp: 2026-06-01T00:00:00Z
  checked: useMLCostWaterfall.ts linha 57
  found: `if (paid_revenue === 0) return null;` — quando RPC retorna paid_revenue=0, o hook retorna null inteiro
  implication: Se a RPC retorna 0 para paid_revenue, O HOOK INTEIRO retorna null, eliminando cmv e impostos do card.

- timestamp: 2026-06-01T00:00:00Z
  checked: get_cost_waterfall RPC (migration 20260528000000)
  found: `COALESCE(SUM(o.receita_bruta), 0) AS paid_revenue` — usa receita_bruta da tabela orders
  implication: Se receita_bruta é NULL em todos os orders do período, SUM retorna 0 via COALESCE, ativando o guard.

- timestamp: 2026-06-01T00:00:00Z
  checked: batch_upsert_orders ON CONFLICT — migration 20260528000000
  found: `receita_bruta = EXCLUDED.receita_bruta` (sem COALESCE) — sobrescreve receita_bruta MESMO SE VIER NULL
  implication: Se sync-ml-orders envia receita_bruta=null para algum order, o valor existente é apagado.

- timestamp: 2026-06-01T00:00:00Z
  checked: sync-ml-orders expandOrder (linha 369)
  found: `receita_bruta: precoUnit != null ? precoUnit * quantidade : null` — se preco_unit é null, receita_bruta é null
  implication: Orders com preco_unit nulo terão receita_bruta nula. Se maioria dos orders caem neste caso, paid_revenue=0.

## Eliminated

## Resolution

root_cause: get_cost_waterfall RPC usa COALESCE(SUM(receita_bruta), 0) para calcular paid_revenue. Orders sincronizados antes da Phase 19 (migration 20260521300000) têm receita_bruta=NULL porque o campo foi adicionado depois. SUM(NULL) = NULL, COALESCE(NULL, 0) = 0, ativando o guard `if (paid_revenue === 0) return null` em useMLCostWaterfall.ts. Quando o hook retorna null, comissao e frete têm fallbacks em MercadoLivre.tsx (ordersSummary ou % hardcoded), mas CMV e impostos não têm fallback — ficam null, não descontados do Lucro Bruto.

Causa secundária: batch_upsert_orders sobrescreve receita_bruta com o valor vindo do sync (sem COALESCE), então um re-sync de orders antigos preservaria receita_bruta como NULL se preco_unit fosse null naquele re-sync.

fix: Migration 20260601000000_fix_cost_waterfall_receita_bruta_fallback.sql:
  1. get_cost_waterfall: usa COALESCE(receita_bruta, preco_unit*quantidade, 0) — fallback para preco_unit quando receita_bruta é null
  2. batch_upsert_orders: adiciona COALESCE em receita_bruta e receita_liquida no ON CONFLICT — preserva valores existentes como já feito para custo_unit
  3. backfill: UPDATE orders SET receita_bruta = preco_unit * quantidade WHERE receita_bruta IS NULL — popula historico

verification:
files_changed:
  - supabase/migrations/20260601000000_fix_cost_waterfall_receita_bruta_fallback.sql
