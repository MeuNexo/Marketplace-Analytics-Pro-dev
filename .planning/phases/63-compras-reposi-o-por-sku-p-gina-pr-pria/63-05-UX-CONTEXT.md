# 63-05 — UX "Clareza para Leigos" na tela /compras

**Origem:** Wesley revisou a entrega da Phase 63 (PR #12, ainda não mergeado) e apontou que a tabela e a configuração de parâmetros estão confusas para pessoas leigas — "não fica claro o que é para fazer na análise". Decisão de direção (brainstorming, 2026-06-26): **"Clarear no lugar"** — manter a tabela única, mas com linguagem leiga, uma coluna "O que fazer", tooltips explicativos e o diálogo de regras com exemplos. Menor risco, rápido. Entra no MESMO branch/PR #12.

**Escopo:** refinamento de UI/UX puro. NÃO muda a RPC `get_replenishment_by_sku`, o hook, nem a lógica de cálculo (já em prod). Só camada de apresentação (`MLCompras.tsx`, `ReplenishmentSkuTable.tsx`, `ReplenishmentSkuFilters.tsx`, `ReplenishmentParamsDialog.tsx`). compraUtils/CompraRecomendadaPanel/ReplenishmentPanel intocados.

## Decisões de design (a detalhar no plano)

### 1. Tabela — renomear colunas para PT leigo + nova coluna de ação
| Hoje (jargão) | Proposto (leigo) | Tooltip "?" (1 frase) |
|---|---|---|
| Anúncio / Variação | **Produto** | Anúncio no ML; clique para ver os tamanhos/cores |
| Estoque | **Estoque** | Unidades disponíveis hoje no ML (não desconta compras a chegar) |
| Venda/dia | **Vende por dia** | Média de unidades vendidas por dia na janela analisada |
| Cobertura | **Dura quanto** | Quantos dias o estoque atual dura no ritmo de venda |
| Ponto Rep. | *(sair da visão principal → tooltip/detalhe)* | Nível de estoque que dispara a recompra |
| Sugestão | **Comprar** | Quantidade sugerida de compra agora |
| Valor Est. | **Custo estimado** | Quanto essa compra deve custar (qtd × custo unitário) |
| Flags + Parâmetros | *(absorvidos pela coluna "O que fazer" e por tooltip)* | — |

- **Nova coluna "O que fazer"** (status de ação, com ícone/cor):
  - 🔴 **Comprar N** — `gatilho_ativo && compra_sugerida > 0`
  - 🟢 **Estoque ok** — tem giro e não atingiu o ponto
  - ⚪ **Sem vendas** — `sem_giro` (não sugere compra)
  - ⚠️ **Falta custo** — `custo_ausente` (não dá para estimar o valor; sugestão ainda vale)
- **Parâmetros** deixam de ser coluna; viram um tooltip/ícone discreto por linha ("regras usadas: origem sku/marca/global + valores"), para não poluir.
- Manter o drill anúncio→variações (Collapsible) e os filtros.

### 2. Mini-resumo no topo
Linha-resumo acima da tabela: `🔴 N para comprar · 🟢 N ok · ⚪ N sem giro` (contagem dos status). Ajuda o leigo a saber por onde começar. Reusa os mesmos dados já carregados.

### 3. Diálogo de regras (params) — rótulos leigos + explicação + exemplo
| Hoje | Proposto | Ajuda inline |
|---|---|---|
| Lead time (dias) | **Tempo de entrega do fornecedor** | Dias entre fazer o pedido e a mercadoria chegar |
| Meta cobertura (dias) | **Estoque desejado (dias)** | Para quantos dias de venda você quer ter estoque |
| Safety (dias) | **Folga de segurança (dias)** | Dias extras de estoque para imprevistos |
| MOQ (mínimo) | **Pedido mínimo do fornecedor** | Quantidade mínima por compra (1 = sem mínimo) |
| Pack (múltiplo) | **Múltiplo de caixa** | Vem em caixa fechada de X unidades (1 = avulso) |
| Escopo | **Aplicar a** | Global (todos), Por Marca, ou Por SKU — o mais específico vence |

- Manter a precedência SKU > Marca > Global, mas explicada em linguagem simples ("o mais específico manda").
- Manter write só owner/admin (RLS já enforça).

## Critérios de aceite
- Nenhum termo de supply-chain sem tradução/tooltip na visão padrão.
- Coluna "O que fazer" deixa óbvio o próximo passo de cada linha.
- Diálogo de regras: cada campo com rótulo leigo + 1 linha de ajuda + exemplo.
- Sem regressão: vitest verde, tsc 0, build ok; lógica/RPC intocadas; export xlsx mantém colunas (pode renomear cabeçalhos).
- Mantém responsividade mobile (Wesley usa muito no celular).

## Fora de escopo (YAGNI)
- Não criar "modo simples/avançado" nem cards de ação (abordagens B/C descartadas).
- Não mexer em cálculo, RPC, sync, ou nas outras telas.
