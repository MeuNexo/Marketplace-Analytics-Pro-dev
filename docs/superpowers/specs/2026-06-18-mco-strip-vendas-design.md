# Design — Faixa "MCO do dia" no /vendas

**Data:** 2026-06-18
**Autor:** Wesley + Claude (brainstorming)
**Status:** Aprovado — pronto para implementação via GSD (`/gsd-quick --validate`)
**Projeto:** Garment Glow (dashboard ML Pé Vermeio), `/root/garment-glow-test`

## Objetivo

Adicionar ao topo da página `/vendas` (`src/pages/MercadoLivre.tsx`) uma **faixa minimalista** mostrando o **MCO (Margem de Contribuição Operacional)** do período em **R$ e %**, dando ao lojista o "número-resultado" da operação logo no início, junto dos cards iniciais.

Mudança **100% aditiva**: nenhum KPI existente é removido ou alterado.

## Escopo

**Dentro:**
- Novo componente de apresentação `MLMcoStrip.tsx` (faixa slim, largura total).
- Cálculo do MCO do período reusando valores já derivados na página (sem novo fetch).
- Entrada `mco` no glossário central (`src/lib/kpi-glossary.ts`) para o tooltip `(i)`.
- Teste unitário do helper de cálculo.

**Fora (decisões explícitas de Wesley):**
- Dark mode / toggle de tema — tarefa separada futura.
- Qualquer corte ou mesclagem de KPIs do `MLKPIGrid` — mantidos todos os 10 como estão.

## Comportamento e visual

- **Posição:** entre o `ConsultorCard` e o `MLKPIGrid` em `MercadoLivre.tsx`.
- **Conteúdo:** `● MCO do dia · R$ 1.847,30 · 12,4% · (i)`
- **Cor:** o marcador `●` e o `%` usam os tokens `kpi.positive` (verde, MCO ≥ 0) ou `kpi.negative` (vermelho, MCO < 0) — herdados da Fase 46. Demais elementos em texto neutro.
- **Rótulo dinâmico:** "MCO do dia" quando o seletor de período está em hoje; "MCO do período" caso contrário. Segue o **seletor de período** da página (mesmo `currentFrom`/`currentTo` dos outros cards).
- **`(i)`:** reaproveita o padrão de popover de glossário da Fase 46 (gatilho hover + tap), exibindo o breakdown:
  `Receita − CMV − Custo Operacional − Impostos = MCO`.
- **Estado sem dado:** se receita = 0 no período, exibe `—` (sem divisão por zero). Se CMV/impostos do período estiverem ausentes, usa o **mesmo fallback** que o `MLCostCard` já aplica (estimativa por % do waterfall mensal) e mantém consistência com o DRE do mês.
- **Responsividade:** a faixa colapsa graciosamente em mobile (rótulo + R$ + % em uma linha; `(i)` ao toque). Sem tabela, então sem o tratamento de cards da Fase 46.

## Cálculo

```
MCO = gross_revenue − CMV_período − custo_plataforma − ads − total_tax
pct = gross_revenue > 0 ? (MCO / gross_revenue) * 100 : null
```

Onde (todos já disponíveis em `MercadoLivre.tsx` / `kpiSummary`):
- `gross_revenue` — receita bruta do período.
- `custo_plataforma` — frete + comissão ML (tarifas, **exclui** ads).
- `ads` — `adsTotalForPeriod` (gasto de publicidade do período).
- `total_tax` — impostos do período.
- `CMV_período` — custo do produto do período (mesma fonte usada pelo `MLCostCard` / `marginMap`; com fallback por % mensal quando ausente).

**Anti-duplicação de ads:** `custo_plataforma` é apenas frete+comissão; `ads` é somado uma única vez. Isso reconcilia com o "Lucro do mês" do `MLCostCard` (que já trata PADS dentro das tarifas) — o helper subtrai cada componente exatamente uma vez.

## Componentes e responsabilidades

| Unidade | Papel | Depende de |
|---------|-------|-----------|
| `computeMco(input)` (helper puro, ex: `src/lib/mco.ts`) | Recebe `{ grossRevenue, cmv, platformCost, ads, tax }` e retorna `{ mco, pct }`. Pura, testável, sem React. | nada |
| `MLMcoStrip.tsx` | Apresentação da faixa: recebe `mco`, `pct`, `label`, estado de loading/empty via props. Sem lógica de fetch. | `computeMco` (valores via props), tokens kpi, popover glossário |
| Wiring em `MercadoLivre.tsx` | Monta o input do `computeMco` a partir dos valores já derivados e renderiza `<MLMcoStrip>` na posição definida. | valores existentes na página |
| `kpi-glossary.ts` | Nova entrada `mco` (definição leiga + breakdown). | — |

**Fronteiras claras:** `computeMco` é testável isoladamente (entrada numérica → saída numérica). `MLMcoStrip` é puramente visual (props → UI). O wiring na página é a única peça que conhece as duas pontas.

## Testes / verificação

- **Unitário `computeMco`:**
  - cálculo correto de R$ e % com componentes típicos;
  - sinal negativo quando custos > receita;
  - `receita = 0` → `pct = null`, sem `NaN`/divisão por zero;
  - ads contabilizado exatamente uma vez (não duplicado).
- `npx tsc --noEmit` e `npm run build` limpos.
- Checkpoint visual de Wesley no preview Vercel (faixa renderiza, cor por sinal, `(i)` abre o breakdown, segue o seletor de período).

## Rota de implementação

`/gsd-quick --validate` (plan-checker + verifier), commit próprio, separado da Fase 46 e do quick do gráfico de markup. Branch atual `main` (workflow do projeto).
