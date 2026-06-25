---
phase: 60-alinhamento-da-dfc-fluxo-de-caixa
plan: 03
status: complete
completed: 2026-06-25
---

# 60-03 SUMMARY — Toggle move os indicadores de SALDO/PROJEÇÃO (feedback do Wesley)

## Contexto
Após validar o toggle na linha do gráfico, Wesley pediu que ligar/desligar movesse também
os indicadores de fluxo de caixa, não só a linha.

## Descoberta (dados live)
O campo `supplier` em `cash_outflows` só está preenchido nas "Previsões de compra" (20 OCs);
as 407 contas a pagar reais (NFs) têm `supplier` nulo. Logo a **"Exposição por fornecedor"
é 100% previsões** — aplicar o toggle a ela a zeraria. Levado ao Wesley.

## Decisão Wesley: escopo "Saldo/projeção"
Toggle move os indicadores de saldo/projeção; **não** a Exposição por fornecedor nem a
Composição de custos (ficam intactas).

## O que foi feito
- **Tentativa inicial revertida:** uma 1ª migration aplicou o filtro a TODOS os 4 RPCs, o que
  zerou a exposição de fornecedor em prod. Revertida imediatamente (migration
  `cashflow_indicators_revert_to_original`); arquivo descartado (não commitado).
- **Migration final `20260660000200_cashflow_saldo_indicators_forecasts.sql`** (aplicada via MCP):
  - `get_projected_balance_summary` ganhou `p_include_purchase_forecasts BOOLEAN DEFAULT false`
    (filtra previsões em v_current, total_expenses e no loop de projeção).
  - `get_treasury_panel` ganhou o mesmo param, mas o filtro entra SÓ em v_current e no loop de
    projeção (alert_date, min_balance). `fornec_30/60/90`, `total_exposicao`, burn e saída real
    ficam INALTERADOS.
  - `get_supplier_exposure` e `get_cost_by_month` permanecem 2-arg (revertidos ao original).
- **Frontend:** `useTreasuryPanel(includePurchaseForecasts)` e `useProjectedBalance(days, includePurchaseForecasts)`
  propagam o arg + entram na queryKey; `TreasuryPanel` recebe a prop `includePurchaseForecasts`;
  `MLFluxoCaixa` passa o estado do toggle ao `<TreasuryPanel>`. Build verde.

## Provas em prod
- projected realista: OFF=−R$715.330,97 / ON=−R$815.313,65; total a pagar 90d: OFF=R$797.423,39 / ON=R$897.406,07.
- treasury saldo mínimo: OFF=−190.527,76 / ON=−223.855,34.
- treasury total_exposicao: **IGUAL** (R$133.310,23) nos dois — não responde ao toggle, como decidido.
- supplier_exposure / cost_by_month (2-arg) seguem funcionando.

## Nota / dívida futura
A Exposição por fornecedor só reflete OCs porque o sync do Tiny não popula `supplier` nas NFs.
Fix de dado (popular supplier nas contas a pagar) fica como melhoria futura — fora do escopo da 60.

## Pendência
- Validação visual do Wesley (commit `9d614b1d` pushado): com OFF os KPIs de saldo/projeção
  batem com a DFC; ligar o toggle move saldo/projeção + linha juntos; exposição de fornecedor não muda.
