# Phase 67: Compras v3 — Reposição mais esperta - Discussion Log

> **Audit trail only.** Not used as input to planning/research/execution agents (those read CONTEXT.md).

**Date:** 2026-06-26
**Phase:** 67-compras-v3-reposi-o-mais-esperta-tend-ncia-lead-time-real
**Areas discussed:** Método da velocidade de venda, Sazonalidade (granularidade), Lead time real por fornecedor, Robustez com histórico curto, Transparência/controle na UI

---

## Método da velocidade de venda

| Option | Description | Selected |
|--------|-------------|----------|
| Recência/tendência (EWMA) | Pondera vendas recentes; robusto, sem exigir 1 ano | |
| Sazonalidade (ano anterior) | Mesmo período do ano passado; exige ≥1 ano por SKU | |
| Os dois (recência + sazonalidade) | Tendência recente + ajuste sazonal quando há base | ✓ |

**User's choice:** Os dois (recência + sazonalidade)
**Notes:** Fallback na recência quando faltar dado sazonal.

---

## Sazonalidade — granularidade

| Option | Description | Selected |
|--------|-------------|----------|
| Índice por mês na marca/categoria | Agrega no bucket marca/categoria → robusto; aplica ao SKU | ✓ |
| Índice por mês no próprio SKU | Preciso mas exige histórico longo por SKU | |
| Eventos manuais (cadastrar rodeios) | Sem depender de histórico, mas manutenção manual | |

**User's choice:** Índice por mês na marca/categoria
**Notes:** Captura pico de rodeio (Barretos/ago) sem precisar de 1 ano por SKU.

---

## Lead time real por fornecedor

| Option | Description | Selected |
|--------|-------------|----------|
| Mediana das OCs atuais por fornecedor | Intervalo data_pedido→data_entrega das OCs em trânsito; fallback no param; sem mexer no sync | ✓ |
| Também sincronizar OCs recebidas (histórico) | Prazo realizado, mais preciso; exige mexer no sync + histórico | |
| Manter param fixo | Tira do escopo | |

**User's choice:** Mediana das OCs atuais por fornecedor
**Notes:** Aceita-se a limitação (prazo planejado das OCs vigentes, não realizado). Reusa o predominante da Phase 66.

---

## Robustez com histórico curto

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback transparente p/ o simples | Cada dimensão cai no simples sem base; sinaliza "modo simples" | ✓ |
| Aplicar o esperto com o que tiver | Sempre esperto, sem fallback; risco de ruído | |

**User's choice:** Fallback transparente p/ o simples
**Notes:** Cada camada (EWMA/sazonal/lead-time) liga independente, só com base. Alinha com "declarar limitação em vez de inventar".

---

## Transparência/controle na UI

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle "Cálculo esperto" + transparência | On por padrão, compara com simples; badges/tooltip dos sinais | ✓ |
| Automático + transparência (sem toggle) | Sempre liga; badges explicam; menos controle | |
| Automático, sem badges | Só o número melhor, sem explicação | |

**User's choice:** Toggle "Cálculo esperto" + transparência
**Notes:** Espelha o toggle do /fluxo-de-caixa (Phase 60). Badges: tendência ↑↓, ajuste sazonal, lead time real, "modo simples".

---

## Claude's Discretion
- Fórmula exata EWMA (α/half-life/janela), índice sazonal (cálculo/suavização, marca vs categoria), limiares de fallback — a pesquisa/SPEC define.
- Onde o cálculo vive (estender CTE sales_by_sku da RPC vs nova RPC); toggle como `p_smart` na RPC.

## Deferred Ideas
- Sincronizar OCs recebidas (lead time realizado); índice sazonal por SKU; gerar OC no Tiny; custo por fornecedor.
