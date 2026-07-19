# Phase 101: Detalhamento de MCO e recomendação de margem na página /analise-precos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis
**Areas discussed:** Onde mostrar o detalhamento, Faixa de margem recomendada, Tipo de recomendação

---

## Onde mostrar o detalhamento

| Option | Description | Selected |
|--------|-------------|----------|
| Card fixo abaixo do gráfico | Sempre visível pro item selecionado, sem precisar hover | ✓ |
| Painel expansível (accordion) | Fechado por padrão, abre com um clique | |
| Manter só tooltip, só enriquecer | Não criar novo elemento visível | |

**User's choice:** Card fixo abaixo do gráfico

| Option | Description | Selected |
|--------|-------------|----------|
| Por unidade (média do período) | Igual ao que fizemos na conversa: waterfall/un | ✓ |
| Total do período selecionado | Somas em R$ do período | |
| As duas, lado a lado | Cada linha mostra R$ total E R$/unidade | |

**User's choice:** Por unidade (média do período)
**Notes:** Tooltip existente do gráfico (Phase 79) permanece intacto — o card é adicional.

---

## Faixa de margem recomendada

| Option | Description | Selected |
|--------|-------------|----------|
| Reusar mcoHealth.ts (5% / 9%) | Mesma constante MCO_SAUDAVEL_PCT da Phase 83 | ✓ |
| Faixa configurável por categoria/produto | Mais flexível, escopo maior | |

**User's choice:** Reusar mcoHealth.ts (5% / 9%)
**Notes (freeform):** "Na verdade eu acho que podemos usar a faixa existente, mas também ter a possibilidade de configurar mco por produto para acompanhar" — refinamento: faixa padrão global + meta customizável por item.

| Option | Description | Selected |
|--------|-------------|----------|
| Na página /precos-custos (MLPrecosCustos) | Junto do cadastro de custo/preço do SKU | |
| Direto na /analise-precos | Campo editável no card de detalhamento, salvo por item_id | ✓ |
| Fora de escopo desta phase | Meta customizável vira phase separada | |

**User's choice:** Direto na /analise-precos

---

## Tipo de recomendação

| Option | Description | Selected |
|--------|-------------|----------|
| Calcular preço mínimo recomendado | "Preço mínimo pra bater a meta: R$X" | |
| Só sinalizar com texto/badge | "Abaixo da margem recomendada" + diferença em p.p. | |
| Preço mínimo E alternativa de ACOS | Mostra as duas alavancas | ✓ |

**User's choice:** Preço mínimo E alternativa de ACOS

| Option | Description | Selected |
|--------|-------------|----------|
| Só quando abaixo da meta | Evita poluir a tela quando já está saudável | |
| Sempre visível | Mesmo com MCO saudável, mostra como referência constante | ✓ |

**User's choice:** Sempre visível

---

## Claude's Discretion

- Layout exato do card (grid de linhas do waterfall, posição dos dois números de recomendação).
- Texto/copy exato dos rótulos e tooltips auxiliares.
- Detalhes visuais (cores, tokens) — paleta CVD-safe + tokens do projeto.
- Mecanismo exato de persistência da meta customizada por item_id (schema a definir pelo researcher/planner).
- Comportamento quando custo_unit ausente (seguir padrão já estabelecido: avisar, nunca inventar).

## Deferred Ideas

- Comparação lado a lado entre múltiplos itens (ex: Pistola vs Carabina) — mantido fora de escopo, página continua single-item.
- Faixas de saúde diferentes por categoria de produto — descartado; só a meta numérica é customizável, a faixa de cores continua global.
- Configuração da meta em /precos-custos em vez de /analise-precos — descartado nesta phase.
