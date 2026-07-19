# Phase 96 — RESEARCH

**Pesquisado:** 2026-07-15
**Domínio:** DRE (frontend React + RPCs Postgres/Supabase) — correções C1/C2/C4/C5/C6/C7/C8/C9/C11
**Confiança geral:** MÉDIA-ALTA no código (tudo lido em disco, `arquivo:linha` reais). **BAIXA no estado vivo do banco** — o MCP Supabase **não foi usado nesta sessão** (interrompida por erro de API antes das queries). Tudo que depende de dado vivo está marcado **NÃO CONFIRMADO**.

---

<user_constraints>
## User Constraints (do 96-CONTEXT.md)

### Decisões travadas (não reabrir)
- **[C1]** Receita exibida vira **BRUTA** + nova linha **"Cancelamentos de vendas"** (−). O cancelamento entra na **FÓRMULA** da margem (`MercadoLivre.tsx:364-367`), não só na tela. Bottom line de maio permanece **247.216,12**. Maio: bruto 261.280,02 = paid 247.216,12 + cancelled 14.063,90.
- **[C2/C5]** O **ÚNICO** charge_type removido de `totalTarifas` é o parcelamento: **`CFONPN` + `BFONPN`**. Todo o resto ENTRA (CVVML, CVVPRC, CVVFNU, CFFE, CXDE, CFFI, CXDED, CDSDB, PADS, CFCBE/CFWA/CFBA/CFPB, CDIFAL, CESM, CVAF, e todos os demais B*). Maio: parcelamento líquido por competência = **10.825,82** (CFONPN 12.187,14 + BFONPN −1.361,32).
- **[C4]** `useMLBillingDaily`: filtro `charge_date` → `competence_date`. Maio: 75.127,33 → 74.704,19; com C2/C5 em cima → **63.878,37**.
- **[C6]** Gate no botão "marcar mês como apurado": bloquear se QUALQUER pedido pago do mês tiver `custo_unit_cheio IS NULL` **e listar os SKUs faltantes**. `get_cost_waterfall` de previsão **intacto**. Maio: 39 SKUs / 226 linhas / R$23.828,31 (9,64% da receita).
- **[C7]** Gate de imposto = **`status='paid'` nas 3 guias da competência M+1**. `0,01` **NÃO** bloqueia (= apurado, deu zero por crédito). Maio PASSA.
- **[C8]** `nao_classificado > 0` → **só INFORMAR** e listar. Nunca auto-corrigir.
- **[C9]** Expor/manter o alerta de `double_count_risk`. Wesley corrige na fonte (Tiny).
- **[C11]** INSS fica no bloco `pessoal`. Nenhum valor migra pra linha de impostos.
- **Backfill** do `custo_unit_cheio` REAL da nota do Tiny — **NUNCA médio×fator**.

### Discrição do Claude
- Como expor os alertas de C8/C9 na UI (formato do alerta/lista).
- Quebra em waves e escolha de onde mora o gate (hook puro vs RPC).
- Tratamento de `partially_refunded` (1 pedido, R$386,39) — **ABERTO no CONTEXT**, decidir com Wesley.

### Deferido / fora de escopo
- **[C10] REJEITADO** — separar juros de principal do empréstimo. Financeiro segue com a parcela cheia. **Não reabrir.**
- Wesley faz manual no Tiny (julho/2026): 6 faturas históricas do cartão, 7 notas Outros→Fornecedores, 4 SKUs sem custo nenhum.
</user_constraints>

---

## Summary

A Phase 96 é **quase toda frontend**, com **uma exceção grande e mal resolvida: o backfill do `custo_unit_cheio` (C6)**.

O achado central: **o repo `garment-glow-test` não tem NENHUMA migration que cria `orders.custo_unit_cheio` nem `ml_product_costs.cost_full`** — `grep -rn "custo_unit_cheio" supabase/` retorna **zero hits em migrations**; só aparece em `src/hooks/useMLCostWaterfall.ts:23-26` (comentário + campo lido da RPC). O schema veio de **drift**: foi aplicado em prod a partir de um worktree irmão **não mergeado** (`/root/garment-glow-dre`, branch `gsd/phase-86-dre-competencia`), cujas migrations `20260690000100_cmv_cheio_schema.sql` e `20260690000200_backfill_custo_unit_cheio.sql` **existem em disco e eu li ambas**. Isso é exatamente o padrão de drift já documentado no header de `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql:1-31`.

E aqui está a **notícia ruim, que precisa ir pro Wesley antes de planejar**: a fonte que o backfill do worktree irmão usa **NÃO é o custo cheio da nota de compra**. É `precos.precoCusto` do cadastro do produto no Tiny (`/produtos`) — um campo de **cadastro manual do produto**, não um item de NF. Não achei no repo nenhuma tabela ou sync de nota de compra com custo por item (`purchase_orders` existe, mas é ordem de compra da Phase 65 — **NÃO CONFIRMADO** se traz custo por item). Detalhe: `precoCusto` é o mesmo campo que o `sync-tiny-costs` atual já usa como **fallback** do `precoCustoMedio` (`sync-tiny-costs/index.ts:161`). Ou seja: **o "cheio" que o sistema tem hoje é o preço de custo cadastrado, não o custo da nota.** Se o Wesley entende "custo cheio = custo da nota", a fonte pode não existir e a Phase precisa decidir isso antes de escrever código.

O resto (C1/C2/C4/C5/C7/C8/C9/C11) encosta em 6 arquivos, todos identificados com linha. Nenhum exige migration **exceto** o que o time decidir pro backfill de C6 e (talvez) a coluna `ml_billing_daily.competence_date` — cuja existência é afirmada pelo CONTEXT ("existe e está 100% populada") mas **não está em nenhuma migration deste repo** (`20260613020000_ml_billing_daily.sql:6-20` cria a tabela **só com `charge_date`**). Outro drift provável.

**Recomendação primária:** Wave 0 = 4 queries no banco vivo (listadas em §"Verificações obrigatórias") + 1 pergunta ao Wesley sobre a fonte do custo cheio. Sem isso, C4 e C6 são especulação.

---

## Architectural Responsibility Map

| Capability | Tier primário | Tier secundário | Racional |
|---|---|---|---|
| C1 receita bruta + cancelamentos | **API/RPC** (`get_cost_waterfall` já tem `cancelled_revenue`? ver §C1) | Frontend (fórmula + linha) | O valor cancelado precisa vir do banco; a fórmula é do card |
| C2/C5 blacklist parcelamento | **Frontend** (`groupBillingCharges`) | — | É agregação pura sobre `charges[]` já carregado |
| C4 competência do billing | **Frontend** (troca de coluna no `.select`/filtro) | Database (coluna precisa existir) | 1 linha de hook, se a coluna existir |
| C6 gate CMV cheio | **Database** (a lista de SKUs faltantes é uma agregação) | Frontend (bloqueia botão + lista) | Não dá pra derivar client-side sem puxar todos os pedidos |
| C6 backfill | **Database/Ingestão** (`sync-tiny-costs` + migration) | — | O valor é capturado na ingestão ou não existe |
| C7 gate de imposto | **Frontend** (`status` já vem da RPC) | — | `get_imposto_guia_by_competence` já retorna `status` |
| C8/C9 alertas | **Frontend** (`dreCascade` + `MLCostCard`) | — | RPC 87 já retorna `bloco` e `double_count_risk` |
| C11 INSS | **Nenhum** — é uma não-mudança | — | Já correto em `20260692000000:55-56` |

---

# A. BACKFILL do `custo_unit_cheio` — a maior incógnita

## A.1 O que popula `orders.custo_unit_cheio` HOJE?

**No repo `garment-glow-test`: NADA.**

Evidência (verificada por grep nesta sessão):

```
grep -rn "custo_unit_cheio" supabase/ src/
→ src/hooks/useMLCostWaterfall.ts:23   (comentário)
→ src/hooks/useMLCostWaterfall.ts:25   (comentário)
   (nenhum outro hit — ZERO em supabase/migrations/, ZERO em supabase/functions/)
```

- `supabase/functions/recalc-order-costs/index.ts:97` faz `.select("item_id, seller_sku, cost")` — **sem `cost_full`**.
- `supabase/functions/recalc-order-costs/index.ts:111` faz `.select(... custo_unit, tax_rate, ...)` — **sem `custo_unit_cheio`**.
- `supabase/functions/recalc-order-costs/index.ts:143-147` monta o `patch` com `custo_unit`/`tax_rate`/`tax_amount`/`uf_origem` — **nunca escreve `custo_unit_cheio`**.
- `supabase/functions/sync-tiny-costs/index.ts:161-163` colapsa os dois preços num só: `const cost = Number(precos.precoCustoMedio ?? 0) || Number(precos.precoCusto ?? 0);` e grava só `cost` — **`cost_full` nunca é escrito**.

**Conclusão [VERIFICADO: grep no repo]:** na versão do código que está em `main`/nesta branch, **nada popula `custo_unit_cheio`**. Se a coluna tem 90,4% de cobertura em prod (como o CONTEXT afirma), isso veio de:
1. as EFs **deployadas em prod** estarem numa versão mais nova que o repo (drift de EF), **e/ou**
2. a migration de backfill do worktree irmão ter rodado uma vez.

⚠️ **Isso significa que o `custo_unit_cheio` de prod é um valor CONGELADO** — pedidos novos entram com `custo_unit_cheio` NULL se a EF em prod for a mesma do repo. Isso é consistente com "39 SKUs / 226 linhas faltando em maio". **NÃO CONFIRMADO** — precisa checar a versão viva da EF `recalc-order-costs` em prod.

## A.2 A fonte do "cheio" no worktree irmão (referência já provada em prod)

`/root/garment-glow-dre` (branch `gsd/phase-86-dre-competencia`, não mergeada) tem a implementação completa. Li os 3 arquivos:

### `20260690000100_cmv_cheio_schema.sql` (referência)
- **Bloco A** (`:16-22`): `ALTER TABLE ml_product_costs ADD COLUMN IF NOT EXISTS cost_full numeric(12,2)`. Comentário do próprio autor: *"Preço de custo cheio (Tiny **`precoCusto`, cadastro manual**)"*.
- **Bloco B** (`:27-34`): `ALTER TABLE orders ADD COLUMN IF NOT EXISTS custo_unit_cheio numeric`. Comentário: *"Escrito por recalc-order-costs a partir de ml_product_costs.cost_full, casado por SKU."*
- **Bloco C** (`:42-86`): `DROP FUNCTION` + `CREATE FUNCTION get_cost_waterfall` com a 7ª coluna `cmv_cheio`. **É AQUI que nasce o C6:**
  ```sql
  COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0) AS cmv_cheio
  ```
  E o comentário `:72-76` **documenta o COALESCE como decisão deliberada**: *"Sem o COALESCE interno, linhas sem cost_full somariam 0 → subestimariam o CMV → superestimariam o lucro (direção errada p/ número conciliado)."* — ou seja, o autor sabia do trade-off e escolheu mascarar. O C6 do Wesley **reverte essa decisão** (prefere bloquear a mascarar). Isso precisa estar explícito no plano.

### `20260690000200_backfill_custo_unit_cheio.sql` (referência)
```sql
UPDATE public.orders o
SET custo_unit_cheio = pc.cost_full
FROM public.ml_product_costs pc
WHERE o.sku = pc.seller_sku
  AND pc.cost_full IS NOT NULL
  AND o.custo_unit_cheio IS NULL
  AND (pc.organization_id IS NULL OR pc.organization_id = o.organization_id);
```
Idempotente (`custo_unit_cheio IS NULL`), sem filtro de período. **Aviso do próprio arquivo (`:15-17`):** *"aplicar SOMENTE APÓS o re-sync de sync-tiny-costs ter populado cost_full — antes disso, cost_full é NULL para todas as linhas e esta migration vira no-op."*

### Diffs das EFs (referência, ambos lidos por `diff`)
- **`sync-tiny-costs`**: separa `costMedio = precos.precoCustoMedio` de `costCheio = precos.precoCusto`, mantém `cost = costMedio || costCheio` e adiciona `cost_full: costCheio > 0 ? costCheio : null`. Aplicado em **2 lugares**: Fase 1 (listagem, ~`:161-173`) e Fase 2 (detalhe, ~`:208-221`).
- **`recalc-order-costs`**: `.select` ganha `cost_full` e `custo_unit_cheio`; novo `costFullBySku` (Map por `seller_sku`); `patch.custo_unit_cheio = costFull` quando não-null.

## A.3 ⚠️ RESTRIÇÃO DURA DO WESLEY vs. o que existe — CONFLITO

> CONTEXT §"Backfill do custo cheio": *"**Fonte = custo cheio REAL da nota do Tiny. NUNCA médio×fator** (isso reintroduz o C6 disfarçado)."*

**A fonte disponível hoje NÃO é a nota.** É `precos.precoCusto` — o campo "preço de custo" do **cadastro do produto** no endpoint `/produtos` do Tiny. Provas:
- `sync-tiny-costs/index.ts:147` — a única chamada de listagem é `tinyGet(tinyToken, "/produtos", { situacao: "A", ... })`.
- `sync-tiny-costs/index.ts:195` — a única chamada de detalhe é `tinyGet(tinyToken, "/produtos/${prod.id}")`.
- `sync-tiny-costs/index.ts:161` e `:198` — os únicos campos lidos são `precos.precoCustoMedio` e `precos.precoCusto`.

**A boa notícia:** `precoCusto` **não é** `médio × fator`. É um campo independente, cadastrado. Então o backfill de referência **não viola literalmente** a restrição do Wesley (não é derivação aritmética do médio). O gap de ~22% que o CONTEXT observa entre cheio e médio é real e vem de dois campos distintos do Tiny.

**A má notícia:** também **não é o custo da nota de compra**. É o que o Wesley (ou quem cadastra) digitou no produto. Se ele espera "o custo que veio na NF do fornecedor, ponto no tempo da compra", isso **não existe em lugar nenhum deste sistema**.

### Existe fonte de custo de nota de compra?
- **`purchase_invoices` / itens de NF:** ❌ **não existe** — `grep` em migrations não encontra nada além de `purchase_orders`.
- **`purchase_orders`** (Phase 65, migration `20260665000000`, EF `sync-tiny-purchase-orders` v1, endpoint Tiny `/ordem-compra`): existe, mas é **ordem de compra**, e **NÃO CONFIRMADO** se persiste custo unitário por item ou só quantidade/data de chegada. O uso documentado (STATE.md:23) é só `qtd_a_caminho`/`data_proxima_chegada`. **Não abri o arquivo desta migration — lacuna.**
- **Histórico point-in-time:** existe conceito, mas **no projeto errado**. `project_cmv_history_validation.md` descreve `product_costs_history` + `get_product_costs_at_date()` — isso é do **Nexo MCP** (`/root/nexo-mcp/`, banco `muesqdxnjlbaoiqylpjn`, código Python `supabase_client.py`/`daily_report.py`), **não** do `garment-glow-test` (banco `ckcdevcxgvueywivefgx`). Não é reusável direto; no máximo é padrão de design. Aliás, a validação dele **nunca foi feita** (memória de 37 dias, 6 checks pendentes).

### Recomendação [ASSUMED — precisa do Wesley]
Três caminhos, em ordem de esforço:
1. **Aceitar `precoCusto` como "cheio"** (portar a referência do worktree irmão). Rápido, prod-provado. **Exige o Wesley confirmar explicitamente** que "custo cheio = preço de custo cadastrado no Tiny", não "custo da NF". Se ele confirmar, C6 vira: portar 2 migrations + 2 EFs + re-sync + backfill.
2. **Buscar custo de item de NF de compra no Tiny** (novo sync). Alto esforço, API não investigada (**NÃO CONFIRMADO** se o Tiny v3 expõe itens de nota de entrada com custo).
3. **Point-in-time** (`cost_full_history` + `valid_from`). Resolve "custo da época da venda" mas **não** resolve "custo da nota" — são problemas ortogonais. Não recomendo antes de 1 ou 2.

⚠️ Cuidado: caminhos 2 e 3 **estouram o escopo da Phase 96**. Se a resposta do Wesley for "quero o custo da nota mesmo", o backfill deve **sair da 96** e virar phase própria, deixando a 96 com o **gate do C6 sem o backfill** — o que ainda entrega valor (o sistema para de mentir; o Wesley preenche no Tiny).

## A.4 Confiabilidade dos 90,4% que têm valor

**NÃO CONFIRMADO (não consultei o banco).** O que dá pra dizer do código:
- Se vieram do backfill de referência: são `ml_product_costs.cost_full` casado por `orders.sku = seller_sku` — **custo ATUAL cadastrado, não o da época da venda**. Uma venda de janeiro recebe o custo cadastrado hoje. Isso é um viés conhecido e é exatamente o que `project_cmv_history_validation` tentava resolver no Nexo. **O CMV "cheio" de maio pode estar usando custo de julho.**
- O join por SKU é o mesmo já validado em produção (`project_garment_custo_unit_diagnostico.md` confirma: *"o join `orders.sku = ml_product_costs.seller_sku` e o mapeamento estão CORRETOS"*).

## A.5 Quantificação: quantos pedidos/SKUs em 2026 sem `custo_unit_cheio`?

**NÃO CONFIRMADO — não rodei a query.** O CONTEXT só quantifica maio (39 SKUs / 226 linhas / R$23.828,31 / 9,64% da receita). Query a rodar no Wave 0 (single-statement, cast obrigatório em `data_pedido` que é TEXT):

```sql
SELECT date_trunc('month', o.data_pedido::timestamptz)::date AS mes,
       count(*) FILTER (WHERE o.custo_unit_cheio IS NULL)              AS linhas_sem_cheio,
       count(DISTINCT o.sku) FILTER (WHERE o.custo_unit_cheio IS NULL) AS skus_sem_cheio,
       sum(o.receita_bruta) FILTER (WHERE o.custo_unit_cheio IS NULL)  AS receita_sem_cheio,
       sum(o.receita_bruta)                                            AS receita_total
FROM orders o
WHERE o.organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
  AND o.status IN ('paid','shipped','delivered')
  AND o.data_pedido::timestamptz >= '2026-01-01'
GROUP BY 1 ORDER BY 1;
```

**Expectativa [ASSUMED]:** a cobertura deve **despencar nos meses recentes** se a EF em prod não escreve `custo_unit_cheio` (§A.1) — o backfill foi um snapshot. Vale conferir junho/julho especificamente: se junho tiver ~0% de cobertura, o gate do C6 bloqueia junho pra sempre até o backfill rodar de novo. **Isso muda o sequenciamento** (backfill vira pré-requisito do gate, não paralelo).

⚠️ Contexto relevante de `project_garment_custo_unit_diagnostico.md`: **marcas de revenda (Sandrini, Fila, adidas…) não têm custo NENHUM no Tiny** — nem médio nem cheio. Na org Pé Vermeio (`7f615df7`) o impacto é menor (marcas próprias), mas os "4 SKUs sem custo nenhum" do CONTEXT são exatamente esse fenômeno.

---

# B. Onde cada correção encosta no código

## [C4/C2/C5] — `src/hooks/useMLBilling.ts` (369 linhas)

### C4 — `charge_date` → `competence_date`
Tudo em `useMLBillingDaily` (`useMLBilling.ts:277-323`):
- `:286-287` — `const from = \`${periodMonth}-01\`; const to = lastDayOfMonth(periodMonth);`
- `:290` — `type Row = { charge_type: string; charge_label: string; amount: number; charge_date: string };`
- `:296` — `.select("charge_type, charge_label, amount, charge_date")`
- `:299-300` — `.gte("charge_date", from).lte("charge_date", to)` ← **o filtro a trocar**
- `:315` — `if (!coverageTo || r.charge_date > coverageTo) coverageTo = r.charge_date;` ← **também usa `charge_date`**. Decidir: `coverageTo` continua sendo o último **charge_date** (cobertura de sync) ou vira competência? Sugestão: **manter `charge_date` pro coverage** (é indicador de "até quando sincronizamos") e trocar **só o filtro**. Isso exige `.select` dos **dois** campos.
- ⚠️ O comentário de `:273-275` já diz "competência = data de lançamento" — **o comentário mente hoje**, é exatamente o bug do C4.
- ⚠️ `queryKey` (`:283`) não precisa mudar (mesmo período), mas **trocar a semântica sem trocar a key deixa cache velho** em quem já tem a página aberta. Considerar bump da key (ex.: `"billing-daily-v2"`).

**⚠️ BLOQUEIO POTENCIAL — `ml_billing_daily.competence_date` NÃO ESTÁ NO REPO:**
`supabase/migrations/20260613020000_ml_billing_daily.sql:6-20` cria a tabela com:
```
charge_date DATE NOT NULL,   -- creation_date_time do movimento (competência)
UNIQUE (organization_id, ml_user_id, charge_date, charge_type, source_invoice_key)
INDEX ON (organization_id, ml_user_id, charge_date)
```
**Não existe `competence_date`** em nenhuma migration deste repo (`grep` confirmou). A EF `sync-ml-billing/index.ts:142,148,159,275` só monta/grava `charge_date`.
O CONTEXT afirma que `competence_date` *"existe e está 100% populada"* → **outro drift**, aplicado direto em prod fora do repo. **NÃO CONFIRMADO.**
**Consequências se confirmado:** (a) a Phase 96 deve escrever uma **migration de reconciliação** que reafirma a coluna (padrão do `20260692000000`); (b) **provavelmente não há índice** em `(organization_id, ml_user_id, competence_date)` → o filtro novo faz seq scan; (c) quem popula `competence_date` em pedidos novos? Se a EF em prod não escreve, a coluna congela igual ao `custo_unit_cheio`. **Verificar no Wave 0.**

### C2/C5 — blacklist do parcelamento
Tudo em `groupBillingCharges` (`useMLBilling.ts:88-143`) — função **pura e exportada**, testável sem DB:
- `:35-71` — `BILLING_GROUP_MAP`. Grupo `parcelamento` está em `:46-50`: `{ key: "parcelamento", label: "Taxas de parcelamento", types: new Set(["CFONPN"]) }`.
- `:99-102` — **todo type que começa com `B` cai em `cancelamentos`**, antes de qualquer mapa:
  ```ts
  if (charge.type.startsWith("B")) { accumulators[CANCELAMENTOS_KEY] += charge.amount; continue; }
  ```
  → **`BFONPN` está HOJE dentro de "Cancelamentos de tarifas"**, misturado com BVVML/BFFE/BXDED. Pra tirar o `BFONPN` é preciso um **check explícito ANTES** do `startsWith("B")`. Essa é a armadilha real do C2/C5: não basta mexer no `BILLING_GROUP_MAP`.
- `:140` — `const totalTarifas = groups.reduce((sum, g) => sum + g.amount, 0);` ← soma **todos** os grupos, incluindo `parcelamento` e `cancelamentos`.
- `:120-131` — o grupo `afiliados` é fundido com `outras` → vira key `afiliados_outras`. **"Minha Página" (CESM) cai em `outras`** (não está no mapa) e entra naturalmente, como o CONTEXT diz. ✔
- `:57-59` — `tarifas_full` = `CFCBE, CFBA, CFPB, CFWA` ✔ bate com o CONTEXT.
- `:42-45` — `envios_ml` = `CFFE, CXDE, CFFI, CXDED`. ⚠️ **`CDSDB` (devolução) NÃO está no mapa** → hoje cai em `outras`. O CONTEXT diz que devolução "entra como frete". Como ambos entram no total, **o total não muda** — é só rótulo. Decidir se move `CDSDB` (e `CXDED`?) pra `envios_ml` ou deixa em `outras`. **Baixo risco, decisão de apresentação.**
- `:39` — `tarifas_venda` = `CVVML, CVVPRC, CVVFNU` ✔ (MP "Custo por cobrar" e "Taxa de recebimento" já dentro).

**Duas formas de implementar (recomendo a 2ª):**
1. Dropar as linhas na entrada do loop → o grupo "Taxas de parcelamento" **some da tela**. Perde informação.
2. **Manter os grupos, excluir do `totalTarifas`.** Ex.: `BillingGroup` ganha `excluded?: boolean`; `:140` vira `.filter(g => !g.excluded).reduce(...)`; `MLCostCard` renderiza a linha com estilo "informativo" (sem `(−)`, cinza, com tooltip "quem paga é o cliente"). **Preserva a transparência que o Wesley quer** e mantém `groups` completo pra auditoria. ⚠️ Isso muda o contrato de `GroupedBillingResult` (`:26-29`) — consumidores: só `MercadoLivre.tsx:252-255` e `MLCostCard.tsx:262-280`.

⚠️ **`BFONPN` precisa do MESMO tratamento** — senão o cancelamento do parcelamento (−1.361,32) continua no total e o número não fecha em 63.878,37.

⚠️ **Fallback estimado ignora a blacklist:** `MercadoLivre.tsx:337-352` monta `gruposTarifasEfetivos` à mão quando não há billing, com `{ key: "parcelamento", ..., amount: 0 }` (`:346`). Como é 0, é inócuo — mas se o grupo virar `excluded`, o objeto do fallback precisa do mesmo shape senão o `.filter` quebra tipagem.

⚠️ **Confirmar os `charge_type` reais no banco — NÃO CONFIRMADO.** Query do Wave 0:
```sql
SELECT charge_type, charge_label, count(*), sum(amount)
FROM ml_billing_daily
WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
  AND competence_date >= '2026-05-01' AND competence_date < '2026-06-01'
GROUP BY 1,2 ORDER BY 4 DESC;
```
Alvo: CFONPN = 12.187,14 e BFONPN = −1.361,32 (líquido 10.825,82).

## [C1] — `MLCostCard.tsx` + `MercadoLivre.tsx`

### Onde a receita nasce
- `src/pages/MercadoLivre.tsx:266` — `const receitaMes = dreWaterfall?.paid_revenue ?? 0;`
- `dreWaterfall` vem de `:246` — `billingMonthIsCurrentMonth ? monthlyCostWaterfall : filterMonthWaterfall`, ambos de `useMLCostWaterfall`.
- `src/hooks/useMLCostWaterfall.ts:52` — `const paid_revenue = Number(r.paid_revenue);` (da RPC `get_cost_waterfall`).

### ⚠️ `cancelled_revenue` é MENTIRA HOJE
`useMLCostWaterfall.ts:66`:
```ts
cancelled_revenue: 0,          // RPC agrega paid; cancelados não são incluídos
```
O campo **existe na interface** (`:9-10`) mas é **hardcoded 0**. A RPC `get_cost_waterfall` (body em `20260612120000:21-56`, e a versão drift em `/root/garment-glow-dre/.../20260690000100:44-84`) filtra `o.status IN ('paid','shipped','delivered')` — **não retorna cancelados de jeito nenhum**.

→ **C1 EXIGE mudança de backend.** Duas opções:
1. **Adicionar `cancelled_revenue` (+`gross_revenue`?) ao `get_cost_waterfall`** — mexer nessa RPC é **ALTO RISCO** (ver §C). `RETURNS TABLE` muda de forma → **`DROP FUNCTION` + `CREATE`** obrigatório (`CREATE OR REPLACE` dá `42P13`; lição documentada em `20260692000000:22-25` e `20260690000100:39-41`). E **grants não sobrevivem ao DROP** → re-`GRANT ... TO authenticated`.
2. **RPC NOVA e isolada** (ex.: `get_cancelled_revenue(p_org_id, p_user_ids, p_from, p_to)`) + hook novo. **RECOMENDO ESTA** — é o padrão que a própria Phase 94 escolheu (`get_imposto_guia_by_competence` foi criada isolada justamente pra não tocar a RPC grande — ver `20260690000000:3-5`). Zero risco pros outros consumidores.

⚠️ `useMLCostWaterfall.ts:62` — `if (paid_revenue === 0) return null;` — o guard mata o waterfall inteiro quando não há venda paga. Um hook de cancelados **não pode** herdar esse guard (mês só com cancelamento existiria).

### A fórmula (o ponto que o CONTEXT chama de ARMADILHA)
O CONTEXT diz "`MercadoLivre.tsx:305`" — **a linha correta hoje é `MercadoLivre.tsx:364-367`** (o arquivo mudou depois da 94):
```ts
const margemContribuicao = useMemo(
  () => receitaMes - totalTarifasEfetivo - (cmvMes ?? 0) - (impostosMes ?? 0),
  [receitaMes, totalTarifasEfetivo, cmvMes, impostosMes],
);
```
**E existe uma SEGUNDA fórmula, duplicada, dentro do card** — `MLCostCard.tsx:113-117`:
```ts
const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0);
```
🚨 **As duas precisam mudar juntas.** Se só uma mudar, a "Margem de contribuição" exibida (`MLCostCard.tsx:365`, usa `lucro`) diverge do `resultadoOperacional`/`resultadoLiquido` (`MercadoLivre.tsx:368-371` → `buildDreCascade(rows, margemContribuicao)`) — **o card mostraria dois números incoerentes**. Este é o furo exato que o CONTEXT alerta ("a margem infla R$14.063,90"), e ele é **duplo**.

**Recomendação:** aproveitar pra **eliminar a duplicação** — passar `margemContribuicao` como prop e deletar `MLCostCard.tsx:113-117`. Reduz a superfície de erro futuro. Cuidado: `lucro` também alimenta `lucroPositivo` (`:118`), `margemPct` (`:119`) e o fallback `resultadoOperacionalVal ?? lucro` (`:125`).

### Onde renderizar (espelhar "Cancelamentos de tarifas")
- A linha "Cancelamentos de tarifas" **não tem markup próprio** — é um `BillingGroup` a mais, criado em `useMLBilling.ts:134-138`, renderizado pelo `.map` genérico em `MLCostCard.tsx:262-280` (`(−)` + label + `pct()` + `fmt()`).
- **"Cancelamentos de vendas" NÃO pode entrar por aí** — o `.map` de `:262` renderiza `gruposTarifas` e soma em "Total de tarifas ML" (`:283-296`). Cancelamento de **venda** não é tarifa.
- **Lugar certo:** logo abaixo do bloco "Receita do mês" (`MLCostCard.tsx:249-258`), antes dos grupos de tarifas. Prop nova, ex.: `cancelamentosVendas?: number`.
- ⚠️ **O rótulo `MLCostCard.tsx:252`** diz *"Receita do mês (vendas pagas)"* — com C1 vira **bruta**, o rótulo tem que mudar (ex.: "Receita bruta do mês").
- ⚠️ **`pct(x, receitaMes)`** (`:16-17`) é usado em **todas** as linhas. Se `receitaMes` virar bruto (261.280,02), **todos os percentuais do card mudam** — tarifas, CMV, impostos, blocos operacionais, resultado líquido (`:130`). Decisão de produto: base do % = bruta ou líquida? **NÃO DECIDIDO no CONTEXT — perguntar ao Wesley.** Sugiro base = **receita líquida** (247.216,12), que é o que a margem consome; senão o "MCO %" da DRE deixa de bater com o resto do app.

### `partially_refunded` (ABERTO no CONTEXT)
1 pedido, R$386,39. Hoje fica fora dos dois lados: `get_cost_waterfall` filtra `IN ('paid','shipped','delivered')` → não é receita; e não é `cancelled` → não seria cancelamento. **Precisa de decisão do Wesley.** Se ele quiser dentro, tanto a RPC de receita quanto a de cancelados precisam de regra explícita (parte mantida vs. estornada) — e `orders` **não confirmei** ter coluna de valor estornado. **NÃO CONFIRMADO.**

## [C6] — gate no "marcar mês como apurado"

### Onde fica o botão
- `MLCostCard.tsx:225-235` — o `<button>` `{mesClosed ? "Reabrir mês" : "Marcar mês como apurado"}`, `onClick={mesClosed ? onReopen : onClose}`, `disabled={closeBusy || (mesClosed ? !onReopen : !onClose)}`.
- Envolvido por `{(canClose || (nudgeClose && !mesClosed)) && (...)}` em `:208`.
- Props em `:63-79`: `regime`, `mesClosed`, `guiaCompetenceLabel`, `canClose`, `nudgeClose`, `onClose`, `onReopen`, `closeBusy`.
- Handlers: `MercadoLivre.tsx:305-313` (`handleCloseDreMonth`) e `:315-323` (`handleReopenDreMonth`), ambos com `toast.error`.
- `canClose` = `MercadoLivre.tsx:299` — `orgRole === "owner"` (gate **só UX**; RLS é a autoridade — `20260694000000:54-62`).

### Como o gate encaixa sem quebrar a previsão (SC5/SC6)
**Chave arquitetural:** `resolveDreRegime` (`src/lib/dreRegime.ts:99-133`) já é **estruturalmente à prova de mistura** — o branch `!isClosed` (`:111-117`) **nunca lê** `cmvCheio`/`guiaReal`. E `isClosed` vem **só** da presença em `dre_month_close` (`useDreMonthClose.ts:58-61`).

→ **O gate deve viver no CAMINHO DE FECHAR, nunca em `resolveDreRegime`.** Se o gate influenciasse o resolver, a previsão mudaria e SC5 (byte-a-byte) quebra. Concretamente:
- `disabled` do botão (`MLCostCard.tsx:229`) ganha `|| closeBlocked`.
- `MercadoLivre.tsx` calcula `closeBlocked` de um hook novo (ex.: `useCmvCheioGate(dreSaleMonth)`).
- `handleCloseDreMonth` (`:305-313`) faz early-return se bloqueado (defesa em profundidade).
- **`resolveDreRegime` e `dreRegime.test.ts` (18 testes) ficam INTOCADOS.** É a garantia mais barata do SC5.

⚠️ **RLS não conhece o gate.** As policies de `dre_month_close` (`20260694000000:54-57`) só checam `get_org_role = 'owner'`. Um owner com curl fecha o mês faltando custo. Aceitável (é UX, não segurança) — mas **registrar como decisão consciente**, não esquecimento. Alternativa: trigger `BEFORE INSERT` que valida — **não recomendo** (acopla a RPC de custo à tabela de close e complica o reopen).

### A lista de SKUs faltantes → RPC nova
Não dá pra derivar client-side (teria que puxar todos os pedidos do mês → PostgREST trunca em 1000). RPC nova, **SECURITY INVOKER** (RLS de `orders` isola a org — padrão `20260682000000:14-18`), ex.:
```sql
CREATE FUNCTION public.get_cmv_cheio_gaps(p_org_id uuid, p_user_ids text[], p_from date, p_to date)
RETURNS TABLE (sku text, marca text, linhas bigint, unidades bigint, receita numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT o.sku, MAX(o.marca), count(*)::bigint, SUM(o.quantidade)::bigint, SUM(o.receita_bruta)
  FROM orders o
  WHERE o.organization_id = p_org_id
    AND o.ml_user_id = ANY(p_user_ids)
    AND o.status IN ('paid','shipped','delivered')
    AND o.data_pedido::date BETWEEN p_from AND p_to
    AND o.custo_unit_cheio IS NULL
  GROUP BY o.sku ORDER BY SUM(o.receita_bruta) DESC;
$$;
```
Notas: agregação simples, **sem subquery correlacionada** (evita o timeout de 8s do role `authenticated`). `REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated;`. Alvo de prova em maio: **39 SKUs / 226 linhas / R$23.828,31**. `o.marca` existe (`20260683000000:78,138`). `o.receita_bruta` existe e **é bruto de verdade** (CONTEXT §5).

⚠️ Um "4 SKUs sem custo NENHUM" (nem médio) aparece nessa lista **e** já aparece hoje em `has_cmv`. Vale distinguir na UI ("sem custo cheio" vs "sem custo nenhum — cadastrar no Tiny").

### O COALESCE (o furo vivo)
`get_cost_waterfall.cmv_cheio` = `COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)` — corpo de referência em `/root/garment-glow-dre/.../20260690000100:77`, **NÃO CONFIRMADO** que é literalmente esse em prod (o repo `garment-glow-test` não tem o body).

**Opções:**
- **(a) Não tocar** na RPC; o gate impede o fechamento, então o `cmv_cheio` mascarado nunca é exibido em apuração. **Menor risco. RECOMENDO.**
- **(b) Remover o COALESCE interno** → `cmv_cheio` vira "cheio puro" (126.574,59 em maio, bate com o CONTEXT). ⚠️ **Mudar `get_cost_waterfall` tem blast radius** (ver §C). Mas o `cmv_cheio` **só é lido por `useMLCostWaterfall.ts:57,73-74` → `resolveDreRegime` no branch apuração** — nenhum outro consumidor. Então o risco é **limitado ao MLCostCard**, desde que se use DROP+CREATE preservando as 6 colunas anteriores.
- **(c) Adicionar coluna nova** `cmv_cheio_puro` sem mexer na existente. Aditivo, mas ainda exige DROP+CREATE (RETURNS TABLE muda) e deixa duas colunas confusas.

Sugestão: **(a) na Wave inicial**; (b) só se o Wesley quiser ver o cheio puro **antes** de fechar (o que é razoável — dá o "quanto falta"). Se for (b), a prova de aceite é: maio `cmv_cheio` 136.462,51 → **126.574,59**.

## [C7] — gate de imposto por `status`

- `src/hooks/useImpostoGuiaReal.ts:47-72` — `useImpostoGuiaReal(saleMonth)` chama `get_imposto_guia_by_competence(p_org_id, p_competence = monthPlusOne(saleMonth))` e mapeia `{ category, total, status }` (`:65-69`). **`status` JÁ VEM.** 🎉
- A RPC (referência `/root/garment-glow-dre/.../20260690000000:40-51`) agrupa por `category, status` → **1 linha por categoria×status**. Se ICMS tiver uma linha `paid` e uma `pending`, vêm **duas linhas de ICMS**. ⚠️ Isso importa: `resolveDreRegime` (`dreRegime.ts:122-125`) hoje faz `guiaReal.reduce((s,g)=>s+g.total,0)` — **soma tudo, paid e pending juntos**.
- `src/lib/dreRegime.ts:30-34` — `IMPOSTO_VENDA_CATEGORIES` = `["Imposto Venda - ICMS", "Imposto Venda - PIS", "Imposto Venda - COFINS"]` (também duplicado em `useImpostoGuiaReal.ts:35-39` — duas cópias, cuidado se mudar).
- `monthPlusOne` (`dreRegime.ts:44-51`) — aritmética numérica, sem string-concat. ✔ Régua M+1 já implementada e correta.
- `shouldNudgeClose` (`dreRegime.ts:170-203`) — **display-only**, 3 sinais OR (vencimento≠21 / paid / valor≠anterior). ⚠️ **O sinal 1 (vencimento≠21, `:185-189`) dispara ANTES do pagamento** — ou seja, o empurrãozinho vai sugerir fechar um mês que o gate C7 vai barrar. **Nudge e gate ficam contraditórios.** Decidir: (i) alinhar o nudge ao gate (só `paid`) — mas isso quebra a decisão LOCKED da 94 ("dropar esse sinal faz o nudge disparar tarde demais"); ou (ii) manter e deixar o gate explicar o "porquê não" no tooltip. **Sugiro (ii)** — respeita a decisão da 94 e o gate vira a autoridade.

**Onde encaixar:** função pura nova (não mexer em `resolveDreRegime`), ex.:
```ts
export function canApurarImposto(guia: GuiaRealCategoryTotal[] | null): { ok: boolean; missing: string[]; pending: string[] }
```
Regra: as 3 categorias presentes **E** todas com `status === 'paid'`. **`0,01` não bloqueia — nunca olhar `total`.** Prova de aceite maio: ICMS 4.793,21 `paid` + PIS 0,01 `paid` + COFINS 0,01 `paid` → **PASSA**. Prova negativa: qualquer `pending` (jul/2026 em diante: PIS 716,19 + COFINS 3.298,87 repetidos) → **REJEITA**.

⚠️ **Se a RPC devolve categoria×status**, `canApurarImposto` precisa agrupar por categoria e checar "existe alguma linha desta categoria com status≠paid" → bloquear. Testar com fixture de categoria duplicada.

⚠️ Nota: `resolveDreRegime` somando `paid + pending` (`:122-125`) é um bug latente — com o gate C7, um mês fechado só tem `paid`, então some na prática. Mas se alguém fechar via curl... Considerar filtrar `paid` no reduce. **Isso mexe em `dreRegime.ts` e nos 18 testes** — avaliar contra o SC5 (só afeta o branch apuração, previsão intacta; risco baixo).

## [C8/C9] — alertas de `nao_classificado` e `double_count_risk`

### O que já existe
- `src/lib/dreCascade.ts:21-29` — `DreBloco` (8 blocos, `nao_classificado` incluído); `:32-38` — `DreOperationalRow` **já tem `double_count_risk: boolean`**.
- `:44-50` — `OPERACIONAL_BLOCOS` inclui `nao_classificado`; `:60` — label "Não classificado".
- `:110-112` — **guardrail SC-3**: filtra `impostos_venda` e `excluido` ANTES de somar. ✔
- `:120` — `doubleCountRisk = blocoRows.some(r => r.double_count_risk)` → **já propagado** por bloco; `:135` idem pro financeiro.
- `MLCostCard.tsx:381-394` — **o alerta de double-count JÁ É RENDERIZADO**: um `<HelpCircle>` com tooltip *"Pode conter fatura ML já contabilizada na margem"*. `:433-446` idem pro financeiro.
- RPC 87 (`20260692000000:76`) — `(co.category = 'Cartão de crédito') AS double_count_risk`.

→ **C9 é quase um no-op de código.** O CONTEXT confirma: *"a flag só sinaliza"* e *"a cascata soma o valor mesmo assim"* — e isso é **intencional** (Wesley corrige na fonte). Escopo real: **elevar a visibilidade** do ícone discreto pra algo que o Wesley não perca (badge/banner com valor). Sugestão: quando `doubleCountRisk`, mostrar o valor no tooltip ("R$22.752,76 podem conter fatura ML"). **Nada de auto-netting.**

### C8 — o que falta
`nao_classificado` **já aparece como linha** na cascata (`dreCascade.ts:44-50` + `MLCostCard.tsx:373-405`) com o valor (R$10.809,20 em maio). O que **não existe**: **a lista dos lançamentos**.
- A RPC 87 (`20260692000000:51-84`) retorna `bloco, category, total, n, double_count_risk` — **granularidade = categoria**, sem `description`/`supplier`/`id`. Pra listar "Textile Xtra 4.627,04 + Pralana 3.329,39 + Pralana 2.852,77" (que são **fornecedores/lançamentos**, não categorias) precisa de **fonte nova**.
- `cash_outflows` tem os campos (`20260618100000:143-158`: `description`, `supplier`, `category`, `amount`, `outflow_date`, `document_number`) e **RLS org-scoped** (`:192-199`).
- **Opções:** (i) RPC nova `get_dre_nao_classificado_items(p_org, p_month)` retornando os lançamentos crus; (ii) leitura RLS direta de `cash_outflows` filtrada — **há precedente aprovado**: `useImpostoGuiaNudge` (`useImpostoGuiaReal.ts:82-117`) faz exatamente isso, com justificativa explícita (`:16-24`) de que a proibição de agregação ampla não se aplica a leituras estreitas. **Sugiro (i)** — o filtro de "não classificado" é o `ELSE` do CASE da RPC 87 (`20260692000000:71`), e **replicar esse CASE no cliente violaria** a regra do `dreCascade.ts:6-8` (*"O campo `bloco` é consumido DIRETAMENTE — NUNCA re-derivado de `category`"*). A RPC nova mantém a fonte única no backend.

⚠️ **Achado importante do CONTEXT:** todas as linhas de maio em `nao_classificado` têm `competence_date` **NULL** → entram via o `COALESCE(competence_date, date_trunc('month', outflow_date))` da RPC 87 (`20260692000000:79-82`). A RPC nova **precisa do mesmo COALESCE nas duas bordas**, senão a lista não bate com a linha da cascata.

## [C11] — INSS: nenhuma mudança

`20260692000000:55-56`:
```sql
WHEN co.category IN ('Salários','Pró-labore','Pessoal - INSS') THEN 'pessoal'
```
✔ Já correto. `'Pessoal - INSS'` **não** está em `IMPOSTO_VENDA_CATEGORIES` (`dreRegime.ts:30-34`, `useImpostoGuiaReal.ts:35-39`) nem no `impostos_venda` da RPC 87 (`:53-54`). Maio: pessoal = 27.852,19 (Salários 24.000 + INSS 3.852,19) ✔.

→ **C11 é um teste de regressão, não código.** Sugestão: teste em `dreCascade.test.ts` fixando que uma row `{category:'Pessoal - INSS', bloco:'pessoal'}` cai em `pessoal` e **não** em `impostos_venda`. Guarda contra alguém "consertar" o mapa depois.

---

# C. Riscos e armadilhas

## 🚨 C.1 — Blast radius de `get_cost_waterfall` (o risco mais crítico da phase)

Consumidores mapeados (`grep -rln "useMLCostWaterfall\|get_cost_waterfall" src/ supabase/`):

| Consumidor | Onde | Lê o quê | Impacto se `cmv_cheio` mudar | Impacto se `paid_revenue` mudar |
|---|---|---|---|---|
| `MercadoLivre.tsx` (DRE) | `:233-236`, `:246`, `:266`, `:279-290` | tudo, inclusive `cmv_cheio` | 🔴 **É o alvo** | 🔴 alvo |
| `MLFinanceiro.tsx` (`/financeiro`) | `:168-173` | `paid_revenue`, `cmv`, `total_comissao`, `total_frete`, `total_tax` | 🟢 **nenhum** — não lê `cmv_cheio` | 🔴 **KPIs + waterfall da página inteira** (`:280`, `:589`) |
| `useAutoRecalc.ts` | `:99` | `has_cmv`, `has_tax_data` | 🟢 nenhum | 🟡 `costWaterfall === null` (`:45`) dispara sync |
| `nexo-chat/tools.ts` | `:362-367` (`get_day_kpis`) | passa o row cru pro LLM | 🟡 o Nexo passa a ver a coluna nova | 🔴 o Nexo passaria a reportar bruto |
| `MercadoLivre.tsx` (MCO) | `:390-410` (`mcoInput`) | `paid_revenue`, `cmv`, `has_cmv`, `total_tax` (fallbacks por %) | 🟢 nenhum | 🔴 **fallback de CMV/tax por % usa `monthlyPaidRevenue` como divisor** (`:396-399`, `:405-407`) |
| `MercadoLivre.tsx` (`currentGrossProfit`) | `:373-385` | `paid_revenue`, `cmv`, `has_cmv`, `total_comissao`, `total_frete`, `total_tax` | 🟢 nenhum | 🔴 alimenta `GoalsCard` (`:849-850`) |

**Veredito:**
- **`cmv_cheio` é SEGURO de mexer** — o único leitor é `useMLCostWaterfall.ts:57,73-74` → `MercadoLivre.tsx:283-284` → `resolveDreRegime` branch apuração. `MLFinanceiro`, MCO, precificação e `/analise-precos` **NÃO leem `cmv_cheio`**. [VERIFICADO: grep — `grep -rn "cmv_cheio" src/` só bate em `useMLCostWaterfall.ts` e `MercadoLivre.tsx`]
- 🚨 **`paid_revenue` é PERIGOSO** — se o C1 for implementado **mudando o significado de `paid_revenue`** na RPC (bruto em vez de líquido), **vaza pra `/financeiro`, MCO, GoalsCard e Nexo**. → **NÃO MUDAR `paid_revenue`.** Adicionar campo separado (`cancelled_revenue` / RPC isolada) e compor **no card**.
- **`/analise-precos` e `/produtos-vendidos`:** usam `orders_price_timeseries` (`20260679000000`, `20260682000000`) e `get_margin_with_ads_by_product` (`20260615120000`, `20260683000000`) — RPCs **separadas** que leem `orders.custo_unit` direto (`20260682000000:68`), **não** `custo_unit_cheio`, **não** `get_cost_waterfall`. 🟢 **Imunes ao C6.**
  ⚠️ **MAS:** se o **backfill** popular `custo_unit_cheio` em massa, elas continuam usando `custo_unit` (médio) → 🟢 sem vazamento. Já se alguém "aproveitar" o backfill pra mexer em `custo_unit`, **aí sim** vaza pra MCO/precificação/`/analise-precos`. → **REGRA DURA: o backfill só toca `custo_unit_cheio`. NUNCA `custo_unit`.** A migration de referência (`20260690000200:19-25`) respeita isso ✔.

## C.2 — `orders.data_pedido` é TEXT
`::timestamptz::date` (ou `::date`) cega o índice. Padrão em uso: `20260682000000:59,80-81` (`o.data_pedido::date`) e `20260690000100:83`. A RPC nova do C6 (`get_cmv_cheio_gaps`) roda 1x por clique — perf não é crítica, mas se der timeout, pré-filtrar por `data_pedido >= 'YYYY-MM-01' AND data_pedido < 'YYYY-MM-01'` como **comparação de string** (funciona com ISO e usa índice) antes do cast. Pendência conhecida no STATE: migrar `data_pedido` → timestamptz.

## C.3 — RPC de tenant = SECURITY INVOKER
DEFINER + param de org = IDOR. Padrão do repo: `20260692000000:48` (`SECURITY INVOKER`), `20260682000000:50`, `20260690000000:37`. ⚠️ Note que `get_cost_waterfall` (`20260612120000:21+` e `20260690000100:44-84`) **não declara SECURITY INVOKER explicitamente** — em Postgres o default **é** INVOKER, então está correto, mas se a phase reescrever essa função, **declarar explícito**.
Subquery correlacionada em RPC INVOKER estoura `statement_timeout` de 8s do role `authenticated` → pré-carregar em CTE MATERIALIZED + JOIN. A RPC do C6 é um `GROUP BY` simples → sem risco.
**Prova anti-IDOR obrigatória** pra qualquer RPC nova: impersonar JWT da Pé Vermeio contra a org Thales (`e4150d57`) → **0 linhas**.

## C.4 — `execute_sql` do MCP só retorna o 1º result set
Single-statement. Pra impersonar em query única: `LATERAL` (padrão da Phase 79). Migrations **só via `apply_migration`** no projeto `ckcdevcxgvueywivefgx` — **nunca `supabase db push`** (o CLI local está linkado no projeto errado, `gionpsuunfkkzzjdubfy`; e nesta sessão `supabase projects list` falhou por falta de `SUPABASE_ACCESS_TOKEN`).

## C.5 — Numeração de migrations e drift
`ls supabase/migrations | tail` → a maior no repo é **`20260694000000_dre_month_close.sql`**. **MAS** a branch `gsd/phase-95-fluxo-caixa-confiavel` tem **`20260713140000`** — e o commit `32d80048` dela diz literalmente: *"renumera migrations 95 p/ 20260713xxxxxx (drift: live max 20260711125934)"*.
→ 🚨 **O `max(version)` VIVO está em ~`20260713xxxxxx`, MUITO acima do que este repo mostra.** As migrations da Phase 96 devem usar timestamp **acima de `20260713140000`** (ex.: `20260715xxxxxx`). **Checar `SELECT max(version) FROM supabase_migrations.schema_migrations` ANTES de escrever o arquivo** — lição já registrada na memória da Phase 95.

## C.6 — DROP+CREATE quando `RETURNS TABLE` muda
`CREATE OR REPLACE` → `42P13 "cannot change return type"`. Padrão: `DROP FUNCTION IF EXISTS ...(assinatura); CREATE FUNCTION ...` + **re-GRANT** (grants não sobrevivem ao DROP). Documentado em `20260692000000:22-25,33,87-88`, `20260690000100:39-42,86`, `20260682000000:9-12,23`.

## C.7 — Sobreposição com a Phase 95 (`gsd/phase-95-fluxo-caixa-confiavel`)
`git diff --stat main...gsd/phase-95-fluxo-caixa-confiavel` (24 arquivos):

| Arquivo | Phase 95 | Phase 96 | Conflito? |
|---|---|---|---|
| `src/pages/mercadolivre/MLFluxoCaixa.tsx` | ✏️ | — | 🟢 não |
| `src/components/financial/CashFlowChart.tsx`, `CashflowHealthBanner.tsx` | ✏️/➕ | — | 🟢 não |
| `src/hooks/useCashflowDataHealth.ts` + test | ➕ | — | 🟢 não |
| `src/lib/cashflowSimulation.ts` + test | ✏️ | — | 🟢 não |
| `supabase/migrations/20260713*.sql` (5) | ➕ | — | 🟡 **só numeração** (ver C.5) |
| `.planning/ROADMAP.md`, `.planning/STATE.md` | ✏️ | ✏️ | 🟡 conflito textual trivial |
| `src/pages/MercadoLivre.tsx` | ❌ **não toca** | ✏️ pesado | 🟢 **não** |
| `src/components/mercadolivre/MLCostCard.tsx` | ❌ | ✏️ | 🟢 não |
| `src/hooks/useMLBilling.ts` | ❌ | ✏️ | 🟢 não |

**Veredito: ZERO sobreposição de arquivo de código.** A 95 mexe em `cash_outflows`/`financial_settings` via **RPCs de cashflow** (`get_cashflow`, `get_rolled_opening_balance`, `set_financial_balance`, `get_cashflow_data_health`); a 96 mexe em `cash_outflows` **só via leitura** (`get_dre_operational_by_competence`, `get_imposto_guia_by_competence`). Riscos residuais: (1) numeração; (2) o merge da 95 pode reordenar o histórico de migrations.

⚠️ **CONFIRMADO o alerta do CONTEXT §6:** `git log main..gsd/phase-95-...` mostra **16 commits** e a branch **não tem** os commits da Phase 94 (`fab5b9d6` "wire DRE regime resolver", `a8242d14` "regime pill"). Ler `MercadoLivre.tsx` nela mostra código **pré-94**. **A branch atual `gsd/phase-96-dre-correcoes-linha-a-linha` já saiu do `main` correto** (`git log`: `3bfda339` → `b0a1dd00` → `41b95c6b` → `a8242d14` → `fab5b9d6`). ✔ **Armadilha evitada.**

## C.8 — Duas fórmulas de margem
Repetindo por importância: `MercadoLivre.tsx:364-367` **e** `MLCostCard.tsx:113-117`. Qualquer mudança de C1/C2 tem que bater nas duas ou o card fica auto-contraditório.

## C.9 — `types.ts` não conhece nada disto
`grep "get_cost_waterfall\|dre_month_close\|cmv_cheio" src/integrations/supabase/types.ts` → **zero hits**. O repo já opera com `supabase.rpc("...")`/`.from("...")` sem tipos gerados (precedente aceito: Phase 90-04 — *"supabase.from('table_name') tipa OK mesmo sem a tabela em types.ts"*). Note `useImpostoGuiaReal.ts:65` usando `(r: any)`. → **Não regenerar `types.ts`**; seguir o padrão.

## C.10 — Testes existentes que servem de rede
- `src/lib/dreRegime.test.ts` — **18 testes**, inclui testes estruturais de "never-mix" e a reconciliação de junho (cmvCheio `133264.87`). **Se a 96 não tocar `dreRegime.ts`, todos passam de graça = prova barata do SC5.**
- `src/lib/dreCascade.test.ts` — cobre o guardrail SC-3.
- ❌ **Não existe teste de `groupBillingCharges`** nem de `useMLBilling` (`find` não achou). C2/C5 mexe numa função **pura e exportada** → **TDD RED/GREEN aqui é barato e obrigatório** (fixture com CFONPN 12.187,14 + BFONPN −1.361,32 → `totalTarifas` exclui 10.825,82).
- ❌ Não existe teste de `MLCostCard`/`MercadoLivre`.
- Suíte atual: ~537-542 testes (STATE/memória). Baseline a preservar.

---

# D. Sequenciamento proposto

## Wave 0 — VERIFICAÇÃO (bloqueante, orquestrador via MCP + 1 pergunta ao Wesley)

Sem isto, C4 e C6 são chute. **Single-statement cada** (C.4).

1. **`ml_billing_daily.competence_date` existe? Está populada? Tem índice?**
   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='ml_billing_daily';
   ```
   (+ `SELECT count(*) FILTER (WHERE competence_date IS NULL), count(*) FROM ml_billing_daily;` e `SELECT indexdef FROM pg_indexes WHERE tablename='ml_billing_daily';`)
2. **Body vivo de `get_cost_waterfall`** — confirmar o COALESCE e as 7 colunas:
   ```sql
   SELECT pg_get_functiondef('public.get_cost_waterfall(uuid,text[],date,date)'::regprocedure);
   ```
3. **`max(version)` de migrations** (C.5):
   ```sql
   SELECT max(version) FROM supabase_migrations.schema_migrations;
   ```
4. **Cobertura de `custo_unit_cheio` em 2026 inteiro** (query de §A.5) + `charge_type` de maio (query de §B/C2).
5. **Versão viva das EFs** `recalc-order-costs` e `sync-tiny-costs` — elas escrevem `cost_full`/`custo_unit_cheio`? (comparar com o repo; `list_edge_functions` / logs).
6. 🗣️ **PERGUNTA AO WESLEY (bloqueante do C6-backfill):** *"'Custo cheio' = o **preço de custo cadastrado no produto do Tiny** (`precoCusto`), ou = o **custo que veio na nota fiscal de compra**? O sistema hoje só tem o primeiro. O segundo não existe em lugar nenhum e seria uma phase própria."*

## Waves de implementação

```
Wave 0 ── verificação + pergunta (BLOQUEANTE)
   │
   ├─ Wave 1A ─ [C2/C5] blacklist CFONPN/BFONPN em groupBillingCharges (TDD)   ─┐
   ├─ Wave 1B ─ [C4]    charge_date → competence_date em useMLBillingDaily      ─┤ PARALELO
   ├─ Wave 1C ─ [C11]   teste de regressão do INSS (dreCascade.test.ts)         ─┤ (arquivos distintos,
   ├─ Wave 1D ─ [C7]    canApurarImposto() puro + testes (dreRegime NÃO tocado) ─┤  zero interseção)
   └─ Wave 1E ─ [C9]    alerta double_count_risk mais visível no MLCostCard     ─┘
   │
   ├─ Wave 2A ─ [C6-gate] RPC get_cmv_cheio_gaps + hook useCmvCheioGate  ── DDL (apply_migration)
   ├─ Wave 2B ─ [C8]     RPC get_dre_nao_classificado_items + hook       ── DDL (apply_migration)
   └─ Wave 2C ─ [C1-backend] RPC isolada de cancelled_revenue + hook     ── DDL (apply_migration)
   │            (2A/2B/2C: PARALELOS entre si — 3 RPCs novas, independentes)
   │
   Wave 3 ─ [C1+C6+C7+C8 frontend] MLCostCard + MercadoLivre.tsx   ── SERIAL, wave própria
   │        (receita bruta + linha cancelamentos + FÓRMULA nas DUAS
   │         cópias + disabled do botão + listas de C6/C8)
   │        🚨 Tudo isto toca os MESMOS 2 arquivos → NUNCA paralelizar.
   │
   Wave 4 ─ [C6-backfill] port do worktree irmão:                    ── DDL + EF deploy
   │        migration schema (se necessário) + sync-tiny-costs (cost_full)
   │        + recalc-order-costs (custo_unit_cheio) + re-sync + backfill
   │        ⚠️ DEPENDE da resposta 6 do Wave 0. Pode SAIR DA PHASE.
   │
   Wave 5 ─ Provas de aceite (SC1..SC6) + checkpoint visual Wesley
```

### O que é serial e por quê
- **Wave 3 é o gargalo.** C1, C6 (botão), C7 (botão), C8 (lista) **todos** editam `MLCostCard.tsx` e `MercadoLivre.tsx`. Paralelizar = conflito garantido. **Um plano só.**
- **Wave 2 antes da 3** — a 3 consome os hooks da 2.
- **Wave 1 é 100% paralelizável** — 5 arquivos disjuntos (`useMLBilling.ts`, `dreCascade.test.ts`, `dreRegime`-adjacente, `MLCostCard.tsx` ⚠️).
  ⚠️ **Exceção: 1E toca `MLCostCard.tsx`, igual à Wave 3.** → **mover 1E pra dentro da Wave 3** e deixar a Wave 1 com 1A/1B/1C/1D.
- **Wave 4 é independente** de tudo (backend/ingestão puros) — pode rodar em paralelo com 1/2/3, **exceto** que o gate do C6 sem backfill bloqueia maio pra sempre. Do ponto de vista de **produto** isso é aceitável (é o comportamento desejado: o sistema para de mentir). Do ponto de vista de **aceite do SC1** (maio fechando em +9.072,94 / ~−2.986), **o backfill é pré-requisito**.

### DDL vs frontend

| Wave | Tipo | `apply_migration`? | EF deploy? |
|---|---|---|---|
| 1A/1B/1C/1D | Frontend puro | ❌ | ❌ |
| 2A `get_cmv_cheio_gaps` | RPC nova | ✅ | ❌ |
| 2B `get_dre_nao_classificado_items` | RPC nova | ✅ | ❌ |
| 2C RPC de cancelados | RPC nova | ✅ | ❌ |
| 2D (opcional) `cmv_cheio` sem COALESCE | DROP+CREATE `get_cost_waterfall` | ✅ | ❌ |
| 3 | Frontend puro | ❌ | ❌ |
| 4 backfill | `ALTER` (se drift) + `UPDATE` | ✅ | ✅ **2 EFs** |
| 4 (se `competence_date` não existir) | `ALTER` + backfill + índice | ✅ | ✅ `sync-ml-billing` |

⚠️ **`gsd-executor` NÃO deploya EF nem aplica migration** — é checkpoint do orquestrador via MCP (`apply_migration` / `deploy_edge_function`). Lição registrada: *"gsd-executor não deploya EF (orquestrador faz via MCP/CLI c/ token)"*. Planejar Waves 2 e 4 **com checkpoint explícito**.

---

## Don't Hand-Roll

| Problema | Não construa | Use | Por quê |
|---|---|---|---|
| Schema/backfill do CMV cheio | Design do zero | Port de `/root/garment-glow-dre/supabase/migrations/20260690000100` + `20260690000200` + diffs das 2 EFs | Já prod-provado neste mesmo banco; já achou e corrigiu o bug do fallback |
| RPC de guia por competência | RPC nova | `get_imposto_guia_by_competence` — **já viva, já retorna `status`** (`useImpostoGuiaReal.ts:59-69`) | C7 é frontend puro |
| Régua M+1 | Aritmética de data nova | `monthPlusOne` (`dreRegime.ts:44-51`) | Testada, evita o footgun de string-concat |
| Flag de double-count | Detecção nova | `double_count_risk` da RPC 87 (`20260692000000:76`) + `dreCascade.ts:120,135` + tooltip `MLCostCard.tsx:381-394` | Já ponta-a-ponta |
| Mapa categoria→bloco | Re-derivar no cliente | `bloco` da RPC 87, consumido direto | Regra explícita em `dreCascade.ts:6-8` |
| Guard de mistura de bases | Novo if/else | `resolveDreRegime` (`dreRegime.ts:99-133`) — **não tocar** | 18 testes provam o never-mix; tocar = arriscar SC5 |
| Leitura estreita de `cash_outflows` | RPC pesada | Precedente justificado em `useImpostoGuiaReal.ts:16-24,82-117` | Já reconciliado com a convenção do repo |

---

## Common Pitfalls

**1. Mudar a fórmula só num lugar.** `MercadoLivre.tsx:364-367` e `MLCostCard.tsx:113-117` são cópias. Sintoma: "Margem de contribuição" ≠ `resultadoOperacional − blocos`.

**2. Achar que `BFONPN` sai junto com `CFONPN`.** `useMLBilling.ts:99-102` captura **todo** `B*` antes do mapa. Sintoma: total dá 65.239,69 em vez de 63.878,37 (sobra o −1.361,32).

**3. Trocar `paid_revenue` pra bruto na RPC.** Vaza pra `/financeiro:169`, MCO (`MercadoLivre.tsx:396`), GoalsCard (`:850`) e Nexo (`tools.ts:363`). Sintoma: KPIs de `/financeiro` sobem 5,7% sem ninguém pedir.

**4. `CREATE OR REPLACE` numa RPC com `RETURNS TABLE` novo.** → `42P13`. E depois do DROP, **re-GRANT**.

**5. Timestamp de migration pelo `ls` do repo.** O vivo está ~19 dias à frente (`20260713140000` na branch 95). Sintoma: migration aplicada "no passado", ordem quebrada.

**6. Rodar o backfill antes do re-sync do `sync-tiny-costs`.** `20260690000200:15-17` avisa: vira **no-op silencioso**. Sintoma: 0 rows updated, sem erro.

**7. Colocar o gate do C6 dentro de `resolveDreRegime`.** Quebra o SC5 (previsão byte-a-byte). O gate vive no botão.

**8. Bloquear o C7 pelo valor `0,01`.** É o furo que o CONTEXT documenta: `0,01` = apurado com crédito. **Olhar `status`, nunca `total`.**

**9. Esquecer o `COALESCE(competence_date, date_trunc('month', outflow_date))` na RPC do C8.** As linhas de maio têm `competence_date` NULL. Sintoma: lista vazia com a cascata mostrando 10.809,20.

**10. Deixar o nudge e o gate C7 se contradizendo.** `shouldNudgeClose` dispara com vencimento≠21 (`dreRegime.ts:185-189`) **antes** do pagamento; o gate exige `paid`. O botão vai ficar verde e desabilitado. Precisa de tooltip explicando.

**11. Mexer em `orders.custo_unit` durante o backfill.** Vaza pra MCO, precificação e `/analise-precos`. **Só `custo_unit_cheio`.**

---

## Assumptions Log

| # | Claim | Seção | Risco se errado |
|---|---|---|---|
| A1 | `ml_billing_daily.competence_date` existe e está 100% populada em prod (afirmação do CONTEXT; **não está em nenhuma migration deste repo**) | B/[C4] | C4 vira DDL + backfill + índice + fix da EF `sync-ml-billing`. Muda o tamanho da phase. |
| A2 | O body vivo de `get_cost_waterfall` é o de `/root/garment-glow-dre/.../20260690000100:44-84` (7 colunas, COALESCE interno) | A.2, C6 | Se divergir, o número de maio (136.462,51) não reproduz e o C6 muda de forma. |
| A3 | Os 90,4% de `custo_unit_cheio` vieram do backfill de referência (`cost_full` casado por SKU) | A.4 | Se veio de outra fonte, a semântica de "cheio" é outra. |
| A4 | As EFs em prod **não** escrevem `custo_unit_cheio` (o repo não escreve) → cobertura congela e piora mês a mês | A.1, A.5 | Se as EFs de prod já escrevem, o backfill é só histórico e a phase encolhe. |
| A5 | `precoCusto` do Tiny ≠ custo da nota de compra | A.3 | **Se o Wesley aceitar `precoCusto` como "cheio", o C6-backfill vira um port de 1 wave.** Maior alavanca da phase. |
| A6 | `purchase_orders` (Phase 65) não tem custo unitário por item | A.3 | Se tiver, abre um caminho pro custo real da nota. **Não abri a migration `20260665000000`.** |
| A7 | Os números de maio do CONTEXT (247.216,12 / 63.878,37 / 126.574,59 / 10.825,82 / 23.828,31) estão corretos | tudo | São a prova de aceite. Vêm de 2 sessões de reconciliação com o dono — confiança alta, mas **não reconferi nenhum**. |
| A8 | `get_imposto_guia_by_competence` vivo = `/root/garment-glow-dre/.../20260690000000` (agrupa por categoria×status) | C7 | Se agrupar só por categoria, `canApurarImposto` fica mais simples. |
| A9 | A suíte tem ~537-542 testes verdes hoje | C.10 | Baseline de regressão. Não rodei `npm test`. |

---

## Lacunas (não investigadas)

Fui interrompido antes de usar o MCP Supabase. **Nenhuma query foi rodada contra `ckcdevcxgvueywivefgx` nesta sessão.** Tudo abaixo é lacuna real:

1. 🔴 **Nada foi validado contra o banco vivo.** Todo "existe/não existe em prod" aqui é inferência de código + drift documentado. As 6 verificações do Wave 0 são **obrigatórias**.
2. 🔴 **`ml_billing_daily.competence_date`** — existência, cobertura, índice, e **quem popula**. (A1)
3. 🔴 **Body vivo de `get_cost_waterfall`** — não rodei `pg_get_functiondef`. (A2)
4. 🔴 **Versão viva das EFs** `recalc-order-costs`, `sync-tiny-costs`, `sync-ml-billing` vs. o repo. (A4)
5. 🔴 **Cobertura de `custo_unit_cheio` em 2026 inteiro** — só tenho maio, via CONTEXT. (A.5)
6. 🔴 **`charge_type` reais de maio** — não confirmei CFONPN 12.187,14 / BFONPN −1.361,32, nem se `CESM`/`CDSDB`/`CVAF` aparecem.
7. 🟡 **`purchase_orders` (migration `20260665000000`)** — **não abri o arquivo**. É a única chance de custo de nota no sistema. **Vale 5 minutos.** (A6)
8. 🟡 **API Tiny v3 — endpoint de nota de compra/entrada com custo por item.** Não pesquisei. Se o Wesley disser "quero o custo da nota", isso vira a pergunta central.
9. 🟡 **`orders` tem coluna de valor estornado?** Necessário pra decidir `partially_refunded`. Não checei o schema de `orders`.
10. 🟡 **`max(version)` vivo de migrations.** Sei que é ~`20260713xxxxxx` (pela branch 95), não o valor exato.
11. 🟡 **Estado do PR da Phase 95** e se vai mergear antes da 96 (afeta ordem de migration).
12. 🟢 **Não rodei `npm test` / `tsc --noEmit`.** Baseline não confirmado.
13. 🟢 **Não investiguei** o efeito do C1 nos percentuais (`pct()`) das outras linhas — levantei a questão, não resolvi. Decisão de produto pendente.

---

## Sources

### Primárias (HIGH — lidas nesta sessão, em disco)
- `src/hooks/useMLBilling.ts` (369 l.) · `src/pages/MercadoLivre.tsx` (982 l., lidos :190-410 e :840-880) · `src/components/mercadolivre/MLCostCard.tsx` (488 l.) · `src/hooks/useMLCostWaterfall.ts` (81 l.) · `src/lib/dreRegime.ts` (204 l.) · `src/lib/dreCascade.ts` (149 l.) · `src/hooks/useDreMonthClose.ts` (110 l.) · `src/hooks/useImpostoGuiaReal.ts` (117 l.) · `src/hooks/useAutoRecalc.ts` (119 l.)
- `supabase/functions/sync-tiny-costs/index.ts` (261 l.) · `supabase/functions/recalc-order-costs/index.ts` (174 l.)
- `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` · `20260694000000_dre_month_close.sql` · `20260613020000_ml_billing_daily.sql` · `20260618100000_cash_flow_tables.sql` (:130-199) · `20260682000000_orders_price_timeseries_sku.sql`
- **Worktree irmão** `/root/garment-glow-dre/supabase/migrations/`: `20260690000000_get_imposto_guia_by_competence.sql` · `20260690000100_cmv_cheio_schema.sql` · `20260690000200_backfill_custo_unit_cheio.sql` + `diff` das EFs `sync-tiny-costs` e `recalc-order-costs`
- `.planning/phases/96-.../96-CONTEXT.md` (fonte de verdade) · `.planning/ROADMAP.md:890-928` · `.planning/STATE.md` · `.planning/config.json` · `CLAUDE.md`
- `git`: branch atual, `log`, `diff --stat main...gsd/phase-95-...`, `ls-tree` das migrations da 95

### Secundárias (MEDIUM)
- `.planning/phases/94-.../94-RESEARCH.md`, `94-02-PLAN.md`, `94-02-SUMMARY.md`, `94-VERIFICATION.md` · `.planning/phases/87-.../87-RESEARCH.md:266-272` (o drift documentado)
- Memória: `project_garment_custo_unit_diagnostico.md` (25 d.) · `project_cmv_history_validation.md` (37 d. — **projeto diferente**)

### Não usadas
- Nenhuma. **Zero queries ao Supabase. Zero WebSearch. Zero Context7.**

---

## Metadata

**Confiança:**
- Mapa do código (arquivo:linha): **HIGH** — tudo lido em disco nesta sessão.
- Estado vivo do banco: **LOW** — nada verificado. Wave 0 é obrigatório.
- Fonte do custo cheio: **MEDIUM** — a implementação de referência é clara e prod-provada; o que é **incerto** é se ela satisfaz a definição do Wesley.
- Sequenciamento: **MEDIUM-HIGH** — as dependências de arquivo estão mapeadas; a de dado (backfill→gate) depende do Wave 0.

**Data:** 2026-07-15 · **Válido até:** ~2026-07-22 (7 d. — repo ativo, 2 branches em voo)

---

## RESEARCH COMPLETE

**Não bloqueado**, mas com **2 condições duras antes de planejar**:

1. 🗣️ **Pergunta ao Wesley (bloqueante do C6-backfill):** *"custo cheio" = `precoCusto` do cadastro do Tiny, ou o custo da nota fiscal de compra?* O sistema hoje só tem o primeiro. Se for o segundo, **o backfill sai da Phase 96** e vira phase própria — e a 96 entrega o gate sem o backfill (o que ainda vale: o sistema para de mentir).
2. 🔍 **Wave 0 (6 verificações via MCP)** — sem elas, C4 (a coluna `competence_date` existe?) e C6 (o body vivo da RPC, a cobertura real) são especulação.

**O resto (C1/C2/C5/C7/C8/C9/C11) está mapeado linha a linha e é planejável já.**

**Três achados que mudam o plano:**
- 🚨 A **fórmula da margem está DUPLICADA** (`MercadoLivre.tsx:364-367` **e** `MLCostCard.tsx:113-117`) — o CONTEXT só cita uma. Mudar só uma quebra o card em silêncio.
- 🚨 **`BFONPN` está dentro de "Cancelamentos"** via `startsWith("B")` (`useMLBilling.ts:99-102`), não no grupo `parcelamento`. Mexer só no `BILLING_GROUP_MAP` não resolve o C2/C5.
- 🟢 **`cmv_cheio` é seguro de mexer** — provado por grep: só `MercadoLivre.tsx`/`useMLCostWaterfall.ts` leem. `/financeiro`, MCO, precificação e `/analise-precos` não tocam nele. 🚨 **`paid_revenue` NÃO é seguro** — 6 consumidores. C1 tem que compor no card, nunca mudar a RPC.

---

# ADENDO — Verificação no banco VIVO (orquestrador, 2026-07-15)

O researcher não conseguiu usar o MCP (caiu antes). Estas queries **foram rodadas em prod
`ckcdevcxgvueywivefgx`** e fecham as principais lacunas do Wave 0.

## ✅ Lacunas FECHADAS

| Item | Veredito | Prova |
|---|---|---|
| `ml_billing_daily.competence_date` existe? | **SIM, existe e está populada** | `information_schema` confirma; todos os números de maio deste RESEARCH foram calculados com ela. **É drift** (não está em migration do repo), mas o dado está lá. C4 **não** precisa de DDL. |
| `get_cost_waterfall` corpo vivo | **Confirmado o COALESCE do C6** | `cmv_cheio = COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)` — idêntico a `20260690000100:77` |
| `orders.custo_unit_cheio` existe em prod? | **SIM** — drift do worktree irmão FOI aplicado | maio: 90,4% da receita coberta |
| charge_types de maio | **Confirmados** | CFONPN 12.187,14 / BFONPN −1.361,32 (líquido 10.825,82); total competência 74.704,19 → sem parcelamento **63.878,37** |
| Existe fonte de custo de NOTA? | **NÃO existe tabela de item de NF.** `purchase_orders` tem `preco_unitario`, mas só desde **2026-03-25**, 135 SKUs — não cobre histórico | `information_schema`: só `ml_product_costs` e `purchase_orders` |

## 🔑 A fonte do "cheio" — RESOLVIDO (o código está limpo)

`sync-tiny-costs/index.ts:161-162` (worktree irmão) lê **dois campos DIFERENTES do Tiny**:
- `cost      = precos.precoCustoMedio`  → custo médio
- `cost_full = precos.precoCusto`       → preço de custo cadastrado

E `20260690000200_backfill_custo_unit_cheio.sql` só **copia** `ml_product_costs.cost_full` → `orders.custo_unit_cheio` (casando por SKU).

**Não há `médio × fator` em lugar nenhum do nosso código.** A restrição do CONTEXT não é violada pela implementação.

### ⚠️ MAS: a razão cheio/médio é suspeita e SÓ O WESLEY resolve

`ml_product_costs` (org Pé Vermeio): 635 linhas, **634 com `cost_full`**, 495 onde `cost_full <> cost`.
Razão `cost_full / cost`: média 1,2285 · mediana 1,2522 · **apenas 16 razões distintas em 495 produtos**.

| razão | produtos | leitura |
|---|---:|---|
| **1,2522** | **261** | `= 1 / (1 − 0,2014)` → bate com o "Lucro Real ~20,14% efetivo" |
| 1,0000 | 139 | `precoCustoMedio` ausente → Tiny devolve o mesmo valor nos dois campos |
| 1,2698 | 24 | `= 1 / (1 − 0,2125)` → ICMS 12% + PIS/COFINS 9,25% |
| 1,1794 / 1,1855 / 1,2078 / 1,2563 / 1,2951 … | ~110 | outras estruturas tributárias |
| **0,6867 / 0,8444** | **7** | **`cost_full` MENOR que `cost`** |

**261 produtos com razão idêntica até a 4ª casa, num intervalo de custo de R$27 a R$210**, não é coincidência —
um campo é mecanicamente derivado do outro **dentro do Tiny**. Duas leituras possíveis, indistinguíveis pelo dado:

- **(a) LEGÍTIMA:** o Tiny calcula `precoCustoMedio` = `precoCusto` líquido dos créditos (~20,14%). Então
  `precoCusto` **É** o custo da nota e a tese do Wesley se sustenta. *Evidência a favor:* os 7 produtos com
  razão < 1 — um markup mecânico nunca produziria isso, mas um médio ponderado por compras recentes mais caras, sim.
- **(b) FALSA:** alguém preencheu `precoCusto = médio × 1,2522`. Aí o "cheio" é ficção e o C6 é circular.

**Pergunta única e bloqueante pro Wesley:** *"O `preço de custo` do cadastro do Tiny é o custo da nota,
ou foi preenchido a partir do custo médio?"* — (a) libera o backfill; (b) mata a fonte.

## 🎯 O backfill fecharia 34 dos 39 SKUs de maio HOJE

Dos **39 SKUs** de maio sem `custo_unit_cheio`:
- **35** existem em `ml_product_costs`
- **34 já têm `cost_full` disponível** → **re-rodar o backfill (idempotente, só toca `IS NULL`) fecha 34 na hora**
- **4 não estão cadastrados** → são **exatamente** os 4 SKUs da tarefa manual do Wesley no Things
  (`K2CTXCB191380PTOBRANM`, `K2CTXCB191380PTOBRANGG`, `K2CTXCB191380PTOBRANP`, `180128333315NATP`)

Convergência: **o resíduo do backfill é precisamente o trabalho manual já entregue ao Wesley.**
Sequência: re-rodar backfill (34) → Wesley cadastra os 4 no Tiny → re-sync → gate do C6 libera maio.

## Lacunas que SOBRAM

- Cobertura de `custo_unit_cheio` no **2026 inteiro** (só maio foi medido).
- `max(version)` de `supabase_migrations` vivo — a numeração da 96 tem que ficar acima.
- **Decisão do Wesley sobre (a) vs (b)** — bloqueia só o C6/backfill; C1/C2/C4/C5/C7/C8/C9/C11 seguem.
