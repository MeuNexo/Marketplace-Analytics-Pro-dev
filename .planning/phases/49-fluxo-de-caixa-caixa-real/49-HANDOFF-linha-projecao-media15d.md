# HANDOFF — Linha de projeção "Média 15d" no gráfico de Fluxo de Caixa

**Criado:** 2026-06-18 (sessão encerrada às 18h por Wesley)
**Status:** PENDENTE — pronto para executar via `/gsd-quick` na próxima sessão
**Branch:** `preview/phase-49-fluxo-caixa`
**Supabase:** `ckcdevcxgvueywivefgx` | org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`

## Pedido do Wesley (verbatim)
> "ainda queria uma outra linha que seria o projetado mas um pouco diferente do que temos no
> saldo real. Eu imagino que poderiamos usar a mesma logica, mas se baseando no recebimento
> medio dos ultimos 15 dias como recebimento. A logica e entender: se continuarmos com a mesma
> media de entrada que estamos tendo nos ultimos 15 dias, como iria ficar o saldo ao longo do tempo."

## Interpretação / regra de negócio
Hoje o gráfico (`get_cashflow`) tem UMA linha = **saldo projetado pessimista**: parte do
`initial_balance` e acumula `entradas confirmadas (MP releases agendados) − saídas (Tiny, qualquer status)`.

Adicionar uma SEGUNDA linha = **saldo projetado realista (média 15d)**:
- Em vez de usar só as entradas *confirmadas* (que se esgotam no futuro próximo, pois MP só
  tem liberações agendadas para ~poucos dias à frente), usar como entrada diária projetada a
  **média diária de `cash_inflows.net_amount` dos últimos 15 dias** (`SMA15`).
- Saídas continuam as reais do Tiny (`cash_outflows`, qualquer status, por `outflow_date`).
- Acumulado realista por dia D = `initial_balance + Σ_{d<=D} (SMA15 − saída_real_do_dia_d)`.
- É a resposta a "se eu mantiver a média de entrada atual, como fica o caixa?".

⚠️ Decisão de design a confirmar com Wesley antes (ou na execução):
1. A média 15d substitui a entrada confirmada em TODOS os dias futuros, ou só a partir do dia
   em que acabam as liberações confirmadas do MP? (Recomendado: usar `GREATEST(confirmada_do_dia, SMA15)`
   NÃO — melhor usar SMA15 puro como "cenário média", deixando a linha pessimista como o "confirmado".
   Assim as 2 linhas são conceitualmente limpas: pessimista=confirmado, realista=média.)
2. Janela SMA = últimos 15 dias corridos a partir de hoje (`release_date BETWEEN CURRENT_DATE-15 AND CURRENT_DATE-1`),
   dividido por 15 (não por nº de dias com venda) — manter consistência com a SMA antiga do
   pré-futuro-only (ver migration `20260618120000` / nota no 49-02-SUMMARY).

## Implementação sugerida (1 quick task, 2 tasks)

### Backend — migration nova em `supabase/migrations/` (timestamp > 20260618210000)
Adicionar coluna `accumulated_balance_sma NUMERIC` ao retorno de `get_cashflow` (RETURNS TABLE),
calculada assim dentro da função:
```sql
-- após v_initial:
v_sma := COALESCE((
  SELECT SUM(ci.net_amount) / 15.0
  FROM cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date BETWEEN CURRENT_DATE - 15 AND CURRENT_DATE - 1
), 0);
```
No SELECT final, além do `accumulated_balance` atual (confirmado), retornar uma segunda coluna:
`(v_initial + SUM(v_sma - d.exp) OVER (ORDER BY d.d_date))::NUMERIC AS accumulated_balance_sma`
> Atenção: a CTE `daily` agrupa por dias que TÊM movimento. Para a linha SMA fazer sentido, a
> entrada projetada é `v_sma` por DIA-CALENDÁRIO, não por dia-com-evento. Avaliar gerar a série
> de dias com `generate_series(v_start, p_end_date, '1 day')` LEFT JOIN nas saídas, somando
> `v_sma` em todo dia. (Refator da CTE — é o ponto técnico mais delicado.)
- Preservar SECURITY INVOKER, search_path, REVOKE/GRANT. (assinatura muda → DROP+CREATE ou
  manter nome; como muda RETURNS TABLE, precisa `DROP FUNCTION get_cashflow(uuid,date,date)` antes
  do CREATE, e re-aplicar GRANTs.)
- Aplicar via Supabase MCP `apply_migration` (orquestrador — gsd-executor não tem MCP).

### Frontend
- `src/hooks/useCashFlowData.ts`: mapear novo campo `accumulated_balance_sma` em `CashFlowDataPoint`.
- `src/components/financial/CashFlowChart.tsx`: adicionar segunda `<Line dataKey="accumulated_balance_sma">`
  com cor `hsl(var(--kpi-positive))` ou `hsl(var(--primary))`, `strokeDasharray` para diferenciar,
  e entrada na Legend ("Projeção média 15d"). **Lembrar:** sempre `hsl(var(--...))`, nunca var crua
  (foi o bug desta sessão).
- Tooltip: mostrar as duas linhas.

## Validação esperada
- SMA15 atual ≈ R$ (somar net_amount de 03/06–17/06 ÷ 15). A linha realista deve ficar ACIMA da
  pessimista (já que a média projeta mais entrada do que as confirmadas residuais).

## Contexto da sessão (já concluído — NÃO refazer)
- Bug do gráfico em branco: `var(--kpi-*)` cru → `hsl(var(--kpi-*))`. Commit `744d58db` (pushado).
- Horizonte gráfico 90→120d alinhado ao card. Mesmo commit.
- RPCs agora consideram contas a pagar de qualquer status (paid+pending), futuro-only.
  Migration `20260618210000_cash_flow_rpcs_all_statuses.sql`, **aplicada em prod** + commit `5652ebfa`.
