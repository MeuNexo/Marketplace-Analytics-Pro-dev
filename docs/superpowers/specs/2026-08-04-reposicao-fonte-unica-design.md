# Reposição como fonte única de compras — Design

**Data:** 2026-08-04
**Autor:** Nexo, a partir de investigação medida contra o banco `ckcdevcxgvueywivefgx` e a API do ML
**Status:** aprovado pelo Wesley, pronto para virar plano de implementação

> Este documento é auto-suficiente. Foi escrito para que uma sessão sem nenhum
> histórico de conversa consiga planejar e executar o trabalho.

---

## 1. O problema, medido

Wesley usa o relatório de "Necessidades de Compra" do **Tiny** para fazer ordens de
compra, e não confia na tela de Reposição do **dashboard** (garment), porque o
dashboard "não mostra todos os SKUs que precisam de reposição".

A queixa está correta. Medido em 04/08/2026 na organização Pé Vermeio
(`7f615df7-7bac-45e5-8a93-827fb9ddeec7`, seller `1639558873`):

| | SKUs |
|---|---|
| Com anúncio ML **ativo** — o que a tela de Reposição enxerga hoje | **86** |
| Com custo cadastrado vindo do Tiny — proxy do catálogo real | **681** |
| **Invisíveis para o dashboard** | **596** |

O dashboard enxerga **~13% do catálogo**.

### 1.1 Causa raiz (provada no código da RPC)

A RPC `public.get_replenishment_by_sku` monta sua lista-base assim:

```sql
inventory_by_sku AS MATERIALIZED (
  SELECT ... FROM ml_inventory_cache i ... WHERE i.organization_id = p_org_id
    AND i.status = 'active' AND i.has_variations = TRUE ...
  UNION ALL
  SELECT ... FROM ml_inventory_cache i WHERE ... AND i.status = 'active' ...
)
```

Dois defeitos derivam daí:

1. **`status = 'active'`** — item sem anúncio ML ativo nunca entra. Inclui o caso
   perverso: o anúncio **pausa sozinho quando o estoque zera**, então justamente o
   item que rompeu desaparece da tela que existe para evitar ruptura.
2. **`sku_stock` = `available_quantity` do ML = apenas estoque Full.** O dashboard
   não conhece o estoque do CD. O Tiny conhece, e por isso os dois divergem.

### 1.2 O que NÃO é o problema

O cálculo do dashboard é substancialmente melhor que o do Tiny e **não deve ser
alterado**. Ele já faz, dentro da mesma RPC:

- **Correção de demanda reprimida** — `status_esgotado = 'repor_esgotado'` →
  `venda_dia_origem = 'historico_esgotado'`, usando `best_rate` (melhor janela
  móvel de 30d em 180d de histórico). O Tiny usa média crua e por isso **subcompra
  justamente quem mais vende**, porque vendeu pouco por falta de estoque.
- EWMA com decaimento 0,7 por semana; índice sazonal por marca (12 meses);
  lead time real por fornecedor (mediana das OCs); MOQ e múltiplo de pacote;
  parâmetros por escopo `sku` → `fornecedor` → `marca` → `global`.

Comparação medida nos 40 SKUs presentes nas duas fontes: **Tiny somaria 224 un,
dashboard 374 un.** O Tiny subcompra ~40% no agregado.

**Conclusão: o problema não é o cérebro, é a comida.** Este projeto alimenta o
cérebro existente com dados completos; não reescreve o cálculo.

---

## 2. Objetivo

Fazer a tela de Reposição do dashboard ser **a única fonte** para decisão de
compra, aposentando o relatório do Tiny — cobrindo o catálogo completo e usando
o estoque real (Full + CD + trânsito).

---

## 3. Decisões travadas pelo Wesley

Estas não são para revisitar durante a implementação.

| # | Decisão | Consequência |
|---|---|---|
| D-1 | Item **sem anúncio ML ativo** → **apenas sinalizar**, sem compra sugerida | Vira uma seção "esgotados / sem anúncio — decidir reativar". Não entra em ordem de compra automática. |
| D-2 | Quando Tiny e ML divergem no Full, **o ML ao vivo é a verdade** | `estoque_full` vem sempre de `ml_inventory_cache.available_quantity`. |
| D-3 | A compra desconta **Full (ML) + CD (Tiny) + trânsito (OCs)** | Exige ingerir o estoque do CD do Tiny, que hoje não existe no garment. |
| D-4 | Escopo da lista: **quem teve giro nos últimos 12 meses OU tem estoque > 0** | Catálogo morto fica fora. Estimativa: 100–250 linhas. |
| D-5 | Dos depósitos do Tiny, conta **apenas o "CD Expedição"** | Outros depósitos (avaria, mostruário, terceiros) são ignorados. O Full do Tiny é ignorado por vir do ML (D-2), evitando dupla contagem. |

---

## 4. Terreno existente (não reconstruir)

Levantado em 04/08. O garment **já fala com o Tiny** — falta apenas o estoque.

| Peça | Onde | Situação |
|---|---|---|
| OAuth Tiny | `supabase/functions/tiny-oauth/index.ts`; tokens em `ml_tokens` (`tiny_access_token`, `tiny_refresh_token`, `tiny_expires_at`) | **Pronto** |
| Helper de token | `supabase/functions/sync-tiny-costs/index.ts` → `getTinyToken(mlUserId)` | **Reaproveitar este** (não o do nexo-mcp) |
| Custos do Tiny | `sync-tiny-costs` → `ml_product_costs` | Pronto |
| Contas a pagar | `sync-tiny-payables` → `cash_outflows` | Pronto |
| Ordens de compra | `sync-tiny-purchase-orders` → `purchase_orders` (tem `sku`, `quantidade`, `data_entrega`, `fornecedor`) | **Pronto — é o trânsito de D-3** |
| Estoque do Tiny | — | **NÃO EXISTE. É o que este projeto constrói.** |
| Inventário ML | `sync-ml-inventory` → `ml_inventory_cache` | Pronto |

### 4.1 API do Tiny — o que se sabe

Base `https://api.tiny.com.br/public-api/v3`. Paginação por `offset` + `limit`
(o parâmetro `pagina` é silenciosamente ignorado).

- `GET /produtos?situacao=A&limit&offset` → catálogo (id, sku, nome).
- `GET /estoque/{produto_id}` → `estoque.depositos[]` com `nome`, `saldo`,
  `desconsiderar`; fallback para `estoque.saldo` quando não há depósitos.
  **Uma requisição por produto** — é o gargalo do projeto.

### 4.2 Precedente que NÃO deve ser copiado tal e qual

`/root/nexo-mcp/supabase/functions/sync-tiny-stock/index.ts` resolve o mesmo
problema, mas **está quebrado por desenho**: reseta o cursor quando
`snapshot_date !== today` e roda 25 produtos × 4 invocações/dia = 100 de ~673.
**Nunca fecha uma volta completa** — cobertura teto de ~15%.

Copiar: a forma de paginar, o tratamento de `desconsiderar`, o fallback de saldo.
**Não copiar: o critério de reset.** Ver §5.2.

---

## 5. Arquitetura

```
Tiny API ──> [EF sync-tiny-stock] ──> tiny_products (sku, nome, tiny_id)
             (nova, cursor retomável) └─> tiny_stock (sku, deposito, saldo)
                                                        │
ML API ───> sync-ml-inventory ──> ml_inventory_cache ───┤  (já existe)
                                                        │
Tiny API ─> sync-tiny-purchase-orders ─> purchase_orders┤  (já existe)
                                                        ▼
                                    [RPC get_replenishment_by_sku v2]
                                                        │
                                                        ▼
                                              Tela de Reposição
```

Uma Edge Function nova, duas tabelas novas, uma alteração cirúrgica na RPC.
Nada além disso é tocado.

### 5.1 Tabelas novas

```
tiny_products
  organization_id uuid, tiny_id text, sku text, nome text,
  situacao text, synced_at timestamptz
  UNIQUE (organization_id, sku)

tiny_stock
  organization_id uuid, sku text, deposito text,
  saldo numeric, synced_at timestamptz
  UNIQUE (organization_id, sku, deposito)
```

Regras:
- **Upsert, nunca delete-all-insert-all.** Delete-all abre janela em que a tela lê
  vazio e sugere comprar o mundo.
- RLS ligada nas duas. Escrita só por `service_role`; leitura pela própria
  organização. Seguir o padrão de RLS já usado em `ml_inventory_cache`.
- Sem `organization_id` vindo do cliente em nenhuma RPC de leitura — o padrão
  oposto já produziu IDOR neste projeto.

### 5.2 A Edge Function `sync-tiny-stock` (garment)

Autenticação: reaproveitar `getTinyToken(mlUserId)` de `sync-tiny-costs`.

Duas fases por volta:

1. **Catálogo** — pagina `GET /produtos?situacao=A`, grava `tiny_products`,
   e monta a fila de produtos da volta.
2. **Estoque** — para cada produto da fila, `GET /estoque/{tiny_id}`, extrai os
   depósitos (descartando `desconsiderar = true`), grava `tiny_stock`.

**Cursor retomável.** Estado persistido com: fase, fila de produtos, índice
corrente, início da volta, contadores de erro, timestamp da última volta
**completa**.

> **A regra que corrige o bug do nexo-mcp:** o cursor **só reinicia quando a volta
> anterior fechou por inteiro**. Nunca por virada de data. Uma volta em andamento
> continua de onde parou, mesmo atravessando a meia-noite.

Lote e cadência dimensionados para que a volta **feche em menos de um dia com folga
larga** — o requisito é a volta completa, não um número mágico de itens por
invocação. Ordem de grandeza: ~681 produtos a ~1 req/s ≈ 12 min de tempo de rede,
fatiado em invocações que respeitem o teto de execução da EF.

Erros:
- Falha em **um produto** → registra e segue. Não derruba o lote.
- **429 / erro de token** → registra no cursor com backoff e **retoma**; nunca
  morre em silêncio. (Lição da fase 211: EF que responde 202 e falha no background
  faz o cron marcar sucesso.)

### 5.3 Alteração na RPC `get_replenishment_by_sku`

| Aspecto | Hoje | Depois |
|---|---|---|
| Lista-base | `ml_inventory_cache WHERE status='active'` | Catálogo unificado: ML ativo **∪** `tiny_products` |
| Estoque | `available_quantity` (só Full) | `estoque_full` (ML, D-2) **+** `estoque_cd` (Tiny, depósito de D-5) |
| Join de vendas | `orders` por `item_id` + `variation_id` | Mesmo caminho quando há anúncio; **por `orders.sku`** quando o SKU só existe no Tiny |
| Sem anúncio ativo | não aparece | aparece com `tem_anuncio_ativo = false` → **sinaliza, sem compra sugerida** (D-1) |
| Escopo | todo anúncio ativo | giro em 365d **ou** estoque total > 0 (D-4) |
| Trânsito | `purchase_orders` por SKU | inalterado |

**O núcleo de cálculo permanece literalmente intocado**: `ewma_sales`,
`seasonal_index`, `best_rate_by_sku`, `sales_history_by_sku`,
`lead_time_by_fornecedor`, `params`, e a expressão de `compra`. A mudança é de
alimentação (quais linhas entram, e qual é o estoque), não de fórmula.

Campos novos no retorno, para a tela: `estoque_full`, `estoque_cd`,
`tem_anuncio_ativo`, `origem_catalogo` (`ml` | `tiny` | `ambos`),
`divergencia_full` (Tiny × ML, ver §6).

### 5.4 Frescor

A tela precisa saber quando o estoque envelheceu. Expor o timestamp da **última
volta completa**; acima de 48h, a tela avisa que o estoque está desatualizado.

Isto é requisito, não enfeite: o histórico deste projeto mostra que smoke tests e
gates de paridade passam com dado velho, porque perguntam "tem dado?" em vez de
"é recente?".

---

## 6. Divergência Tiny × ML

Por D-2, o ML vence no Full. Mas a divergência **é exibida**, não escondida — foi
exatamente ela que revelou o defeito da linha Champion (`12012422-PTO3360G`):
o Tiny lia Full = 0 e mandava comprar 28 unidades de um item com ~58 no Full do ML.

Regra explícita: quando o SKU existe nas duas fontes e o saldo do depósito Full do
Tiny difere do `available_quantity` do ML, a linha recebe `divergencia_full` com os
dois valores. A tela avisa quando a diferença absoluta for **≥ 1 unidade** — não há
divergência "pequena" aceitável em saldo de estoque, e o caso Champion era 0 × 58.
O número usado no cálculo continua sendo o do ML (D-2); o aviso é informativo e não
altera a compra sugerida.

---

## 7. Verificação

### 7.1 Gate de não-regressão (bloqueante)

Antes da mudança, capturar o retorno da RPC para os **86 SKUs com anúncio ativo**.
Depois da mudança, capturar de novo com os mesmos parâmetros.

> **Os 86 SKUs devem sair com `compra_sugerida` idêntica.** Qualquer diferença é
> regressão e interrompe a entrega até ser explicada.

Exceção legítima e única: SKUs cuja compra muda **porque agora existe estoque de
CD sendo descontado** (D-3). Essas diferenças devem ser enumeradas uma a uma, com
o saldo de CD que as causou — não aceitas em bloco.

### 7.2 Prova positiva

Os três SKUs que hoje somem do dashboard e o Tiny pega — todos com giro e sem
anúncio ativo — devem aparecer marcados como **sinalizar**, sem compra sugerida:

| SKU | Produto | Vendas em 60d |
|---|---|---|
| `101110PTO3360M` | Chapéu Pralana Carapuça Maçônica M | 4 |
| `13011457PTO3360GG` | Boina Pralana Bandeirantes GG Preto | 5 |
| `K9PMCMS7000SOR3943` | Kit 9 Pares Meia Sandrini 39/43 | ~3 |

### 7.3 Prova de completude

Contagem de SKUs no escopo D-4 deve subir de **86** para a ordem de 100–250, e
todo SKU da planilha do Tiny com giro deve ter linha correspondente.

### 7.4 Testes

- Unitários da extração de depósitos: `desconsiderar = true` descartado, fallback
  de saldo sem depósitos, produto sem SKU.
- Idempotência: rodar a mesma volta duas vezes produz o mesmo `tiny_stock`.
- Retomada: interromper no meio de uma volta e reinvocar continua do índice, sem
  reprocessar o que já entrou e sem pular.
- Reset: a volta só reinicia após fechar — teste explícito de virada de data com
  volta aberta.

---

## 8. Risco declarado

**Nível de SKU vs. variação no Tiny.** O sync do nexo-mcp filtra `tipoVariacao === "P"`
(produtos pai). Os SKUs da operação são por tamanho/cor (`BS8991PTO41` = 41,
`12012422-PTO3360G` = G preto), que podem estar no Tiny como **variação**, não como
pai. Se estiverem, esse filtro descartaria exatamente o nível que interessa.

**Mitigação — primeira tarefa da implementação, antes de escrever a varredura:**
medir contra o Tiny real como os SKUs da operação aparecem (`tipoVariacao`, e se o
`sku` vive no pai ou na variação), e ajustar a coleta ao que for medido. Errar aqui
invalida todo o resto.

---

## 9. Fora de escopo

- Escrever de volta no Tiny (criar ordem de compra a partir da tela). Só leitura.
- Alterar qualquer fórmula de cálculo de reposição.
- Unificar custo/CMV entre as fontes.
- Corrigir o `sync-tiny-stock` do nexo-mcp. Projeto diferente, banco diferente.
- Reativação automática de anúncio pausado. D-1 é sinalizar; a ação é do Wesley.

---

## 10. Definição de pronto

1. `tiny_products` e `tiny_stock` populadas por volta completa, com RLS.
2. Cursor retomável que fecha a volta e só então reinicia — provado por teste.
3. RPC v2 com catálogo unificado, estoque Full+CD, e itens sem anúncio sinalizados.
4. Gate de não-regressão dos 86 SKUs verde, com exceções de CD enumeradas.
5. Os três SKUs de §7.2 aparecendo como sinalizar.
6. Frescor exposto e aviso acima de 48h.
7. Conferência visual do Wesley na tela de Reposição.
