# Phase 66: Compras v2 — Override por Fornecedor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 66-compras-v2-override-por-fornecedor
**Areas discussed:** Mapeamento SKU→fornecedor, Custo por fornecedor (escopo), UI de edição na /compras, Re-sync + popular fornecedor

> Sessão retomada após interrupção: a fundação de dados (migration `20260666` + EF) havia sido começada e a sessão caiu antes de formalizar a phase no GSD. Phase adicionada ao ROADMAP e contexto coletado nesta retomada.

---

## Mapeamento SKU→fornecedor

| Option | Description | Selected |
|--------|-------------|----------|
| OC mais recente do SKU | Fornecedor da OC mais recente que contém o SKU. Simples, auto-atualiza; risco de compra avulsa "roubar" a classificação | |
| Fornecedor predominante | Fornecedor de quem o SKU foi mais comprado (nº OCs ou volume). Mais robusto contra avulsas | ✓ |
| Cadastro manual marca→fornecedor | Wesley mapeia manualmente; mais controle, ignora dados reais das OCs | |

**User's choice:** Fornecedor predominante
**Notes:** Regra de "predominante" locada como discrição técnica = maior quantidade total comprada do SKU por fornecedor; desempate pela OC mais recente. SKU sem OC pula o nível fornecedor (cai em marca/global).

---

## Custo por fornecedor (escopo)

| Option | Description | Selected |
|--------|-------------|----------|
| Só params de reposição | Fornecedor sobrescreve lead time/cobertura/segurança/MOQ/pack; custo segue por SKU | ✓ |
| Também custo por fornecedor | Adiciona custo-fallback por fornecedor p/ SKUs sem custo; amplia escopo | |

**User's choice:** Só params de reposição
**Notes:** Custo continua vindo por SKU de `ml_product_costs`. Custo ausente fica no roadmap de custo v2.

---

## UI de edição na /compras

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown dos fornecedores das OCs | Lista distinct de `purchase_orders.fornecedor`; match exato, sem typo; só fornecedor com OC | ✓ |
| Campo de texto livre | Flexível (cria antes de ter OC), mas divergência de digitação faz o override não casar | |

**User's choice:** Dropdown dos fornecedores das OCs
**Notes:** Garante que o `scope_value` do param bate exatamente com o fornecedor derivado dos SKUs.

---

## Re-sync + popular fornecedor (ordem em prod)

| Option | Description | Selected |
|--------|-------------|----------|
| Faseado com checkpoint | (1) deploy EF + re-sync popula fornecedor; (2) valida lista de fornecedores; (3) só então RPC precedência + frontend | ✓ |
| Tudo de uma vez | Migration RPC + EF + re-sync juntos, valida no fim; mais rápido, risco de casar errado sobre dados sujos | |

**User's choice:** Faseado com checkpoint
**Notes:** Evita ligar o override sobre nomes de fornecedor inconsistentes. Checkpoint de validação trava o risco antes da precedência entrar.

---

## Claude's Discretion

- Regra de desempate do "predominante" (locada: OC mais recente) e eventual janela temporal das OCs.
- Como expor a lista de fornecedores ao frontend (RPC dedicada vs query distinct com RLS).
- Derivação do predominante como CTE na RPC (preferência, espelhando `incoming_by_sku`) vs view/RPC auxiliar.

## Deferred Ideas

- Custo por fornecedor (fallback) — roadmap de custo v2.
- Cálculo mais esperto (sazonalidade/tendência, lead time real) — prioridade v2 separada.
- Gerar OC no Tiny + editor manual de custo — não priorizados.
