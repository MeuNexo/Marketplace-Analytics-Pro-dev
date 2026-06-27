# Phase 69 — Reposição de esgotados (demanda censurada)

**Data:** 2026-06-27
**Projeto:** garment-glow-test (plataforma ML Pé Vermeio) — Supabase `ckcdevcxgvueywivefgx`
**Org de referência:** Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`
**Milestone:** v8.0 (trilha /compras, segue Phases 62–68)

## Problema

A RPC `get_replenishment_by_sku` estima a venda/dia pela média dos últimos
`p_sales_window_days` (30). Um SKU **esgotado** (estoque 0) que não vendeu nos
últimos 30 dias **justamente porque estava esgotado** fica com `venda_dia = 0` →
`compra_sugerida = 0`. Resultado: produtos com demanda real **somem da lista de
compra**. É o caso clássico de *demanda censurada / lost sales*.

### Evidência (prod, 2026-06-27)

Modo esperto ON, Pé Vermeio: 293 SKUs, 170 com gatilho aceso, mas só 87 com
compra. Os **83** com gatilho aceso e compra zero são **todos** `sku_stock = 0` E
`venda_dia = 0`. Desses 83:

| Recorte | Qtd |
|---|---|
| Venderam nos últimos 90d | 15 |
| Venderam nos últimos 180d | 54 |
| Venderam no último ano | 70 |
| Sem nenhuma venda em 1 ano | 13 |
| Média de dias desde a última venda | ~159 |

Não temos histórico de estoque diário (`ml_inventory_cache` é só o snapshot
atual), então a estimativa precisa sair das **vendas históricas**.

## Decisões travadas (com Wesley, 2026-06-27)

1. **Tratamento híbrido por recência** (não tratar todos os esgotados igual).
2. **Estimativa = melhor ritmo do histórico**: a maior soma de vendas numa janela
   móvel de 30 dias dentro dos últimos 180 dias, ÷ 30. Corrige o viés de
   subestimação de dividir pela janela cheia (produto esteve esgotado parte dela).
3. **Cortes de recência (conservador): 90d / 365d.**

## Regra

Classificação por SKU usando a **última venda registrada** (`status_esgotado`),
aplicada **apenas** quando `sku_stock + qtd_a_caminho` indica esgotamento e a
venda dos 30d é zero:

| Balde | Critério | Ação | SKUs hoje |
|---|---|---|---|
| 🔴 `repor_esgotado` | vendeu nos últimos **90d** | estima venda/dia pelo histórico e **sugere compra** (reusa ponto/alvo/MOQ/pack/a-caminho) | ~15 |
| ⚠️ `revisar_esgotado` | vendeu entre **90–365d** | **sinaliza**, NÃO sugere quantidade | ~55 |
| ⚫ `descontinuar` | **sem venda há +1 ano** | marca como cauda morta, fora da compra | 13 |

SKUs com giro normal (venda 30d > 0) seguem o caminho atual, intocados.

### Estimativa de venda/dia (balde 🔴)

- Melhor janela de 30d (maior soma) nos últimos 180d ÷ 30.
- **Proteção anti-pico:** exige ≥ 2 dias distintos com venda no histórico pra usar
  a taxa; senão cai numa estimativa conservadora (média 90d) — evita que 1 venda
  em atacado infle a compra.
- A partir da venda/dia estimada, **reusa exatamente** a matemática atual
  (`ponto`/`alvo`/MOQ/pack/desconto de a-caminho). Nada muda no cálculo, só a
  fonte da venda/dia.

### Parametrização

Cortes (90d/365d) e a janela de estimativa (180d) entram como parâmetros (tabela
`replenishment_params` existente, ou constantes da RPC com default) — calibráveis
sem deploy de código quando possível.

## Transparência na tela `/compras`

- Coluna **"O que fazer"** ganha os 3 estados novos (hoje só trata SKUs com giro).
- Badge na linha: **"estoque zerado · demanda estimada pelo histórico"** + a
  venda/dia usada — nunca confundir com venda real dos 30d.
- Filtro "Situação" existente ganha as 3 opções novas.

## Escopo de implementação

- **RPC `get_replenishment_by_sku`** (migration nova, SECURITY INVOKER mantido):
  - CTE de classificação por recência (última venda por SKU canônico).
  - CTE de estimativa "melhor ritmo 30d/180d" + proteção anti-pico.
  - Nova coluna `status_esgotado` (`com_giro`/`repor_esgotado`/`revisar_esgotado`/`descontinuar`).
  - `venda_dia_origem` ganha o valor `historico_esgotado`.
  - Aplicada em prod via MCP `apply_migration` (não `db push`).
- **Frontend `/compras`**: estados/badges/filtro; espelho TS `replenishmentUtils`
  + testes vitest. Sem regressão das Phases 62–68 (tsc/build/suite verdes). PR.

## Não-objetivos (YAGNI)

- Reconstruir histórico de estoque diário.
- Mexer na RPC `get_replenishment` (Phase 62) ou no `compraUtils` legado.
- Automatizar a decisão de descontinuar (só marca; ação é do Wesley).
- Previsão/ML de demanda além do "melhor ritmo".

## Critérios de sucesso

1. SKUs esgotados que venderam ≤90d voltam a aparecer com `compra_sugerida > 0`,
   com venda/dia estimada pelo melhor ritmo histórico.
2. SKUs 90–365d aparecem como `revisar_esgotado` sem quantidade sugerida.
3. SKUs sem venda há +1 ano marcados `descontinuar`, fora do total de compra.
4. A tela distingue visualmente demanda estimada de demanda real (badge).
5. RPC segue SECURITY INVOKER (anti-IDOR provado = 0 linhas cross-org).
6. Espelho TS cobre a classificação + estimativa; tsc/build/vitest sem regressão.
