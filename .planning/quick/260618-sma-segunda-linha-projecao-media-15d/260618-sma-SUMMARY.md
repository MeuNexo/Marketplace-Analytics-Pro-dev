---
phase: quick-260618-sma
subsystem: cashflow
status: incomplete
reason: implementado e deployado, mas AGUARDA VALIDAÇÃO de dados do Wesley
tags: [cash-flow, sma, projecao, rpc, recharts]
completed_date: "2026-06-18"
---

# Quick 260618-sma — 2ª linha de projeção (média 15d) no Fluxo de Caixa

**One-liner:** Adicionada uma segunda linha ao gráfico "Como meu dinheiro vai evoluir?" = saldo projetado se mantida a média de recebimento dos últimos 15 dias.

## O que foi feito (deployado em prod ckcdevcxgvueywivefgx + branch preview/phase-49-fluxo-caixa)

- **RPC `get_cashflow`** ganhou coluna `accumulated_balance_sma`. Migrations:
  - `20260618220000_cashflow_sma_line.sql` — 1ª versão (SMA de cash_inflows) ❌ fonte errada
  - `20260618230000_cashflow_sma_from_orders.sql` — **versão final**: SMA de `orders.receita_liquida` últimos 15d / 15.
  - Série reescrita com `generate_series` (1 ponto por dia-calendário) p/ a média acumular todo dia.
- **Frontend** (commit `fe19611d`): `useCashFlowData` mapeia o campo; `CashFlowChart` ganhou 2ª `<Line>` tracejada (kpi-positive) "Projeção média 15d" + legenda + tooltip.

## Decisões tomadas (revisar com Wesley)
- **Fonte do SMA = orders, não cash_inflows.** Motivo: `cash_inflows` (liberações MP) não tem histórico — dado mais antigo = ontem (2026-06-17); a sync só popula liberações futuras. SMA sobre ele dava R$536/dia (lixo). `orders` últimos 15d = ~R$4.884/dia líquido (439 pedidos).
- **receita_liquida (não bruta)** p/ ficar consistente com a linha confirmada (net MP). Bruta seria ~R$8.419/dia. Trocar se Wesley preferir cenário bruto.
- **status orders:** paid/shipped/delivered. **data_pedido é TEXT** → `LEFT(data_pedido,10)::date`.

## ⚠️ PENDENTE — validação de Wesley (ver 49-VALIDACAO-PENDENTE.md)
Ele quer confirmar se (1) o fluxo de caixa em si está correto e (2) a projeção de 15 dias está correta. Não foi validado contra a operação real ainda.
