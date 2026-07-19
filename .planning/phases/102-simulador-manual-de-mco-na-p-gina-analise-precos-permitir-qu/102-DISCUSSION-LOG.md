# Phase 102: Simulador manual de MCO na página /analise-precos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu
**Areas discussed:** Campos editáveis, Onde exibir, Reset, Recomendação (cascata de recálculo), Validação

---

## Campos editáveis

| Option | Description | Selected |
|--------|-------------|----------|
| Todos os campos do waterfall | Preço, CMV, comissão%, frete, impostos%, ads | ✓ |
| Só preço e ads | Os 2 que o usuário controla no dia a dia | |
| Só preço | Reaproveita quase 100% do reversePrice existente | |

**User's choice:** Todos os campos do waterfall

---

## Onde exibir

| Option | Description | Selected |
|--------|-------------|----------|
| Dentro do mesmo card, com toggle "Simular" | Switch liga edição nos valores existentes | ✓ |
| Seção nova abaixo do card, sempre visível | Bloco "Simule você mesmo" separado, comparação lado a lado | |

**User's choice:** Dentro do mesmo card, com toggle "Simular"

---

## Reset

| Option | Description | Selected |
|--------|-------------|----------|
| Botão "Resetar" explícito + troca de item/variação | Usuário controla quando limpar; trocar de anúncio também reseta | ✓ |
| Só ao trocar de item/variação | Sem botão dedicado | |

**User's choice:** Botão "Resetar" explícito + troca de item/variação

---

## Recomendação (cascata de recálculo)

| Option | Description | Selected |
|--------|-------------|----------|
| Semáforo/MC/MCO recalculam com valores simulados | Impacto completo visível; recomendação continua sobre Meta MCO% + custos reais | ✓ |
| Tudo trava nos valores reais, só waterfall muda | Mais simples, mas semáforo não reflete a simulação | |

**User's choice:** Semáforo/MC/MCO recalculam com valores simulados
**Notes:** Recomendação (preço mínimo + ACOS-alvo) permanece âncora fixa sobre valores reais — recalculá-la sobre valores já simulados seria circular.

---

## Validação

| Option | Description | Selected |
|--------|-------------|----------|
| Mesmo padrão de validação do campo Meta MCO% | Toast de erro, rejeita valores absurdos | ✓ |
| Sem validação — livre | Simulação efêmera, sem risco real | |

**User's choice:** Mesmo padrão de validação do campo Meta MCO%

---

## Claude's Discretion

- Layout exato dos inputs (inline vs. campo ao lado).
- Texto/copy do toggle, botão Resetar e labels.
- Formato de input (R$/% formatado vs. número puro com máscara).
- Comportamento de foco/teclado.
- Indicação visual de "isto é simulação" (badge, cor de fundo, ícone).

## Deferred Ideas

- Salvar/nomear cenários de simulação para comparar depois — fora de escopo, sempre efêmera.
- Comparação lado a lado entre múltiplos itens simulados — mantido fora de escopo.
- Recalcular a recomendação (preço mínimo/ACOS-alvo) sobre os valores simulados — decidido como fora de escopo (referência circular).
