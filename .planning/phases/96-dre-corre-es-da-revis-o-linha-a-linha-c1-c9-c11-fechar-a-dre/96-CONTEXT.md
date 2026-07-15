# Phase 96 — CONTEXT

Saída de 2 sessões de revisão linha a linha da DRE do card `/vendas` com Wesley (dono).
Mês de referência: **maio/2026**. Org: **Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`**.
Supabase: **`ckcdevcxgvueywivefgx`** (NÃO o do CLAUDE.md).
Revisão **ENCERRADA** — todas as linhas validadas, todas as correções decididas pelo dono.

---

## 1. O problema, em um número

Maio/2026 fecharia hoje em **−R$43.423,27**. O resultado real é **~zero a zero (≈ −R$2.986)**.
O erro de ~R$52k vem de 4 furos, todos provados com dado.

---

## 2. A cascata de maio (reconciliada — use como prova de aceite)

| Linha | Se fechar hoje | Corrigida |
|---|---:|---:|
| Receita | 247.216,12 | 247.216,12 |
| (−) Tarifas ML | −75.127,33 | −63.878,37 |
| (−) CMV | −136.462,51 *(COALESCE)* | −126.574,59 *(cheio puro)* |
| (−) Impostos (guia real) | −4.793,23 | −4.793,23 |
| **= Margem de contribuição** | **30.833,05 (12,47%)** | **51.969,93 (21,02%)** |
| (−) Pessoal | −27.852,19 | −27.852,19 |
| (−) Estrutura | −3.726,65 | −3.726,65 |
| (−) Serviços | −2.178,22 | −2.178,22 |
| (−) Operacional | −22.827,76 | −2.277,63 |
| (−) Não classificado | −10.809,20 | 0 |
| **= Resultado operacional** | **−36.560,97** | **15.935,24** |
| (−) Financeiro (parcela cheia) | −6.862,30 | −6.862,30 |
| **= Resultado líquido** | **−43.423,27** | **+9.072,94** |

**Swing = R$52.496,21**, reconcilia EXATO, sem sobra:
`tarifas 11.248,96 + CMV 9.887,92 + cartão 20.550,13 + nao_classificado 10.809,20 = 52.496,21`

⚠️ Os **+9.072,94 são otimistas**: o cheio puro (126.574,59) cobre só 90,4% da receita — os 226 pedidos
sem custo cheio entram com **custo zero**. Nas linhas onde os dois existem, o cheio roda **~22% acima
do médio**; aplicando isso aos 226, o CMV real ≈ **138.633,69** e o resultado real ≈ **−R$2.986**.
**É por isso que o gate do C6 existe:** sem o backfill, qualquer número que o sistema produza é ficção.

---

## 3. Correções a implementar

### [C1] Receita — simetria no bruto
- Hoje `receitaMes = get_cost_waterfall.paid_revenue` = só `paid/shipped/delivered` por `data_pedido`; canceladas somem inteiras.
- Problema: assimetria com a linha "Cancelamentos de tarifas" (a fatura ML é líquida). Réguas diferentes pro mesmo evento.
- Fix: exibir receita **BRUTA** + nova linha **"Cancelamentos de vendas"** (−).
- **ARMADILHA:** o cancelamento tem que entrar na **FÓRMULA** da margem (`MercadoLivre.tsx:305`), não só na tela — senão a margem infla R$14.063,90. Bottom line tem que continuar **247.216,12**.
- Maio: bruto 261.280,02 = paid 247.216,12 + cancelled 14.063,90.
- **✅ `partially_refunded` RESOLVIDO (Wesley, 2026-07-15):** *"reembolso fica de fora da receita e e considerado como cancelamento"* → entra na receita **BRUTA** e sai na linha **"Cancelamentos de vendas"**. Líquida inalterada.
- **Números finais de maio p/ o C1:**
  - Receita bruta = **261.666,41** = paid 247.216,12 + cancelled 14.063,90 + partially_refunded 386,39
  - (−) Cancelamentos de vendas = **−14.450,29** = cancelled 14.063,90 + partially_refunded 386,39
  - = Receita líquida = **247.216,12** — idêntica à de hoje (zero regressão no bottom line)

### [C2/C5] Tarifas — blacklist do parcelamento
- Wesley: taxa de parcelamento **não é custo nosso** — quem paga é o cliente (acréscimo no preço do comprador), e não está na `receita_bruta`.
- **O ÚNICO charge_type removido é o parcelamento.** Todo o resto ENTRA: comissão (CVVML), frete/envios (CFFE/CXDE/CFFI), devolução (CXDED/CDSDB — entra como frete), ads (PADS), Full (CFCBE/CFWA/CFBA/CFPB), DIFAL (CDIFAL), Minha Página (CESM), afiliados (CVAF), MP "Custo por cobrar" (CVVPRC), Taxa de recebimento (CVVFNU), e todos os cancelamentos B*.
- Implementação: hoje `totalTarifas` soma TODOS os grupos → vira **blacklist de `CFONPN` + `BFONPN`** (o cancelamento do parcelamento sai junto). "Minha Página" hoje cai em "Outras" e entra naturalmente.
- Maio: parcelamento líquido por competência = **10.825,82** (CFONPN 12.187,14 + BFONPN −1.361,32).

### [C4] Billing por competência
- `useMLBillingDaily` filtra por `charge_date`, apesar do comentário dizer "competência". `competence_date` existe e está **100% populada**.
- Fix: `charge_date` → `competence_date`. Custo cai no mês da VENDA que o gerou, não no mês da cobrança. Ajuda o C1 (estorno volta pro mês da venda).
- Maio: 75.127,33 (charge) → 74.704,19 (competência). Δ ~R$423 = estornos atrasados.
- Com C2/C5 aplicado em cima: **74.704,19 → 63.878,37**.

### [C6] CMV — apuração NUNCA fecha com custo cheio faltando  ⚠️ FURO VIVO EM PROD
- `get_cost_waterfall` retorna `cmv_cheio = COALESCE(SUM(COALESCE(o.custo_unit_cheio, o.custo_unit) * o.quantidade), 0)`.
- Esse `COALESCE(cheio, médio)` **mascara custo faltante sem avisar**. Maio: retorna 136.462,51; o cheio puro é 126.574,59.
- **Gate no botão "marcar mês como apurado"** (`dre_month_close`, Phase 94): bloquear se QUALQUER pedido pago do mês tiver `custo_unit_cheio IS NULL`, e **LISTAR os SKUs faltantes** pro Wesley corrigir no Tiny.
- Maio: **39 SKUs / 226 linhas / R$23.828,31 (9,64% da receita)**. Maiores: `K9PMSS4454SOR39/43` (Sandrini, 117un, 2.503,62), `037567CA40` (Zebu, 1.789,15), `K2CTXCB191380PTOBRANG` (TXC, 1.528,41).
- **4 SKUs sem custo NENHUM** (nem médio, R$3.164,67): `K2CTXCB191380PTOBRANM`, `K2CTXCB191380PTOBRANGG`, `K2CTXCB191380PTOBRANP`, `180128333315NATP`. Esses o Wesley cadastra no Tiny.
- Preferir **gate + manter o RPC de previsão intacto** (previsão usa médio, 98,7% coberto, e está correta).
- Framing confirmado por Wesley: **médio = líquido-de-crédito; cheio = custo-da-nota**. Gap ~22% = crédito ICMS/PIS/COFINS.
- CMV por competência = `data_pedido` (correto, vem de `orders`).

### [C7] Gate de imposto — o sinal é `status`, NÃO o valor
- **Wesley confirmou: PIS/COFINS de maio geraram CRÉDITO — não houve guia a pagar.** Logo `0,01` = *"apurado, deu zero"*, **não** é placeholder. O gate original (bloquear em 0,01) travaria maio à toa.
- Padrão de crédito no histórico: `0,01` em nov/2024, jun/2025, **jun/2026** (= vendas de maio), mai/2027.
- **O placeholder real é outro:** de jul/2026 em diante o Tiny tem lançamentos `status='pending'` repetindo **PIS 716,19 + COFINS 3.298,87 idênticos todo mês** até abr/2027, e ICMS reciclando valores passados (12.000 / 16.540,79 / 15.803,12 / 1.078,80 / 10.647,25). São previsões, não guias.
- **Gate correto: só apura se as 3 guias da competência M+1 tiverem `status='paid'`.** Maio PASSA (ICMS 4.793,21 + PIS 0,01 + COFINS 0,01, todas paid).
- **Regra M+1 CONFIRMADA:** venda do mês M → guia com `competence_date = M+1`. Já implementada no main via `monthPlusOne(dreSaleMonth)` + `useImpostoGuiaReal`.
- Imposto estimado (`orders.tax_amount` = 20,32% = R$50.238,20 em maio) é **10,5x a guia real** (4.793,21 = 1,94%). Serve só p/ MCO/precificação — **nunca** para o resultado.

### [C8] Não classificado — só INFORMAR
- Decisão de Wesley: **não auto-corrigir. Só informar quando precisa recategorizar.**
- Quando `nao_classificado > 0` → alertar e listar os lançamentos. Wesley recategoriza no Tiny.
- Fato: `Outros` em 2026 = 20 lançamentos / R$65.244,61, **20/20 são nota de fornecedor** ("Ref. a NF nº …, parcela x/y"). `Fornecedores` está em `excluido` porque o CMV vem de `orders.custo_unit` → essas contam **CMV 2x**. Maio: R$10.809,20 (Textile Xtra 4.627,04 + Pralana 3.329,39 + Pralana 2.852,77).
- Todas com `competence_date` NULL → resíduo dos 8,7% que o backfill da Phase 86 não pegou.

### [C9] Cartão de crédito — Wesley corrige na fonte
- **Wesley abriu a fatura de maio: dos R$22.752,76, só R$2.202,63 é custo real (não-ML); os outros R$20.550,13 são billing ML (ads, Full) JÁ contados em tarifas.** Double-count confirmado pelo dono.
- Prova documental adicional: lançamento 2025-01 (R$22.441,66) descrito como *"Antecipação de pagamento de ADS e Tarifas de envios full do cartão de crédito"*.
- **Wesley passa a lançar no Tiny só a parte não-ML, a partir de agora.** Ele também corrige as 6 faturas históricas manualmente durante julho.
- **Escopo de CÓDIGO:** expor/manter o alerta de `double_count_risk`. Hoje a RPC 87 marca `double_count_risk = (category = 'Cartão de crédito')` mas a cascata **soma o valor mesmo assim** — a flag só sinaliza.
- **Ressalva:** 20.550,13 não bate com ads+Full de nenhum mês isolado (mar 17.122,18 / abr 14.413,60 / mai 8.005,24) — a fatura atravessa competências. Não muda o fix.

### [C11] INSS fica onde está
- Wesley citou "INSS 3.852,19 e ICMS 4.793,21" juntos, mas **INSS é encargo de folha, não imposto sobre venda**, e **já está na DRE** no bloco `pessoal` (Salários 24.000 + INSS 3.852,19 = 27.852,19), depois da margem.
- Nenhuma correção pode movê-lo pra linha de impostos — seria double-count.

### Backfill do custo cheio — ✅ DESBLOQUEADO (Wesley, 2026-07-15)

**Wesley confirmou a semântica dos campos do Tiny:**
> *"Pode confiar nos valores que estão na Tiny, no que está preço custo e o cheio, e o preço custo médio e o descontado automaticamente ou manualmente o ICMS, pis e cofins do produto"*

Ou seja:
- `precos.precoCusto` → **custo CHEIO, confiável** (é a fonte de `ml_product_costs.cost_full` → `orders.custo_unit_cheio`).
- `precos.precoCustoMedio` → o **mesmo custo com ICMS/PIS/COFINS descontados** (automática ou manualmente).

Isso **valida o Cenário A** investigado no `96-RESEARCH.md` (adendo): a razão cheio/médio de 1,2522 (261 produtos)
= `1/(1−0,2014)` é consequência da estrutura tributária, não de um `médio × fator`. O código já lê os dois campos
separados (`sync-tiny-costs:161-162`) e o backfill (`20260690000200`) só **copia** — **a restrição "nunca médio×fator"
não é violada.** Backfill é LEGÍTIMO.

### 🚨 O PIPELINE DO CUSTO CHEIO ESTÁ QUEBRADO — port da EF é OBRIGATÓRIO (medido 2026-07-15)

Cobertura de `custo_unit_cheio` em `orders` (org Pé Vermeio, status paid, 2026):

| mês | % com cheio | % com médio | receita sem cheio |
|---|---:|---:|---:|
| jan | 86,4% | 95,0% | 20.251,12 |
| fev | 79,4% | 89,5% | 22.230,72 |
| mar | 77,2% | 91,1% | 42.207,27 |
| abr | 80,5% | 94,6% | 49.725,66 |
| mai | 79,8% | 98,5% | 23.828,31 |
| jun | 85,6% | 99,4% | 21.778,87 |
| **jul** | **32,9%** | **94,9%** | **99.780,24** |

**Diagnóstico:** o médio segue em ~95% (sync do Tiny vivo), mas o cheio **despenca em julho**. Os ~80% dos meses
antigos vieram do **backfill que rodou UMA vez** (o drift); tudo que entrou depois ficou sem. Julho está em 32,9%
só porque ~1/3 dos pedidos do mês é anterior a esse backfill. **Nada em produção grava `custo_unit_cheio` em pedido novo.**

**Consequência dura:** ligar o gate do C6 sem portar a EF = **todo mês novo nasce com custo faltando e o gate barra
para sempre**. O sistema viraria uma porta trancada — Wesley nunca mais fecharia um mês. Isso confirma, com dado,
o risco #5 que o planner levantou como hipótese.

**→ O port da EF (gravar `custo_unit_cheio` no fluxo vivo) É ESCOPO OBRIGATÓRIO da Phase 96, não opcional.**
**Autorizado por Wesley (2026-07-15):** *"Pode fazer tudo"* — incluindo mexer no banco de produção.

**Plano do backfill:** re-rodar (idempotente, só toca `custo_unit_cheio IS NULL`) → fecha **34 dos 39 SKUs de maio**.
Os **4 restantes** (`K2CTXCB191380PTOBRANM`, `K2CTXCB191380PTOBRANGG`, `K2CTXCB191380PTOBRANP`, `180128333315NATP`)
Wesley cadastra no Tiny (tarefa manual já entregue) → re-sync → gate do C6 libera maio.

**⚠️ Achado de qualidade de dado (não bloqueia):** pela definição do Wesley, o médio é o cheio MENOS impostos —
logo médio > cheio é **impossível**. Mas **7 SKUs** têm médio > cheio, todos da mesma família `1156120*`
(ex.: `1156120NATP` médio 157,00 × cheio 107,81). Impacto desprezível: só 2 venderam em 2026 (R$396 no total).
Ficha do Tiny provavelmente com os dois campos invertidos. Candidato natural ao alerta de dado ruim (mesma
família do C8: informar, nunca auto-corrigir).

---

## 4. Rejeitado

**[C10] separar juros de principal do empréstimo — REJEITADO por Wesley:**
> "O empréstimo é tudo, juros mais o valor. Vamos manter assim."

Financeiro segue com a **parcela cheia** (maio R$6.862,30 = "capital de giro R$165.000 — Parcela 13/34").
Consequência aceita pelo dono: o "Resultado líquido" é resultado de caixa, não lucro contábil.
**Não reabrir sem ele pedir.**

---

## 5. Fatos já verificados (não re-investigar)

- **`receita_bruta` é BRUTO** — provado: `receita_bruta == preco_unit * quantidade`, delta R$0,00 em todas as amostras. Comissão/frete são colunas SEPARADAS → subtrair tarifas 1x é o waterfall correto, **não** é double-count.
- **✅ ADS NÃO tem double-count.** `ADS Mercado Livre` → bloco `excluido` na RPC 87, **e** só tem 8 lançamentos, **todos de 2024** (R$58.917,86), ZERO em 2026. Em 2026 ads entra só por `ml_billing_daily`. Idem ADS Shopee/Magalu.
- **DIFAL = cobrança SEPARADA do ML** (Wesley) → não está na guia da contabilidade → fica em tarifas, contado 1x, sem double-count.
- **Guardrail M+1 × RPC 87 sem furo:** a cascata exclui `impostos_venda` da competência maio (16.015,06 = guias das vendas de ABRIL) e o card subtrai a guia de competência junho (4.793,23 = vendas de maio). Réguas coerentes, sem gap nem double-count.
- **Excluídos corretamente:** `Fornecedores` (105.838,80) + `Previsões de compra` (641,36) — compra de estoque vira despesa via CMV na venda, não no pagamento.
- **Margem de contribuição** (`MercadoLivre.tsx:305`) = `receitaMes − totalTarifasEfetivo − cmvMes − impostosMes`. Fórmula correta.
- **`dreCascade.ts`** filtra `impostos_venda` + `excluido` ANTES de somar (guardrail SC-3) e consome `bloco` do backend sem re-derivar. Correto.

---

## 6. Armadilhas conhecidas

- ⚠️ **A branch `gsd/phase-95-fluxo-caixa-confiavel` está 16 commits ATRÁS do main.** Ler `MercadoLivre.tsx` nela mostra o código **pré-Phase 94** (sem `resolveDreRegime`). **Ramificar a Phase 96 a partir do `main`.**
- `orders.data_pedido` é **TEXT** → `::timestamptz::date`. Cast cega índice ([[feedback_garment_orders_date_perf]]).
- `execute_sql` do MCP só retorna o **1º result set** — usar single-statement.
- PostgREST trunca em 1000 → sempre `.range()`.
- RPC INVOKER com subquery correlacionada estoura o `statement_timeout` de 8s do role `authenticated` — testar como role real, pré-carregar lookups em CTE MATERIALIZED + JOIN.
- RPC de tenant = **SECURITY INVOKER** (DEFINER + param de org = IDOR).

---

## 7. Referências

- Memória: `/root/.claude/projects/-root/memory/project_garment_dre_line_review.md`
- Ponto de verdade (decisões travadas): `project_garment_dre_ponto_verdade.md`
- Regra imposto/CMV: `feedback_garment_dre_imposto_apuracao.md`
- Phase 87 (RPC `get_dre_operational_by_competence`), Phase 88 (cascata frontend), Phase 94 (regime + `dre_month_close`)
- Tarefa manual do Wesley (Tiny, julho/2026): faturas do cartão jan–jul, 7 notas Outros→Fornecedores, 4 SKUs sem custo
