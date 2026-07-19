# Phase 96 — Reconciliação Final (SC1–SC6)

Prova numérica dos 6 Success Criteria da Phase 96 (`.planning/ROADMAP.md` — "Phase 96: DRE — correções da revisão linha a linha") contra o `96-CONTEXT.md §2` (gabarito) e o banco vivo `ckcdevcxgvueywivefgx`, org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, loja `1639558873`, mês de referência maio/2026.

Todas as queries de prod deste documento foram rodadas pelo orquestrador (MCP Supabase) fora deste agente — o executor não tem MCP. Números marcados com fonte "prod (orquestrador)" são fato, não suposição.

---

## Sumário executivo

| SC | Descrição | Veredito |
|---|---|---|
| SC1 | Swing de R$52.496,21 reconcilia exato | **PASS** — as 4 parcelas somam 52.496,21 sem sobra (2 delas dependem do Wesley no Tiny; ver seção SC1) |
| SC2 | Tarifas de maio por competência sem parcelamento = R$63.878,37 | **PASS** — teste puro + prova de prod |
| SC3 | Gate impede fechamento com custo cheio faltando, lista os SKUs | **PASS** — evolução 39→5 SKUs (4 sem custo nenhum + 1 residual), botão desabilitado |
| SC4 | Gate de imposto aceita status `paid`, rejeita `pending`, `0,01` não bloqueia | **PASS** — teste puro |
| SC5 | Previsão (mês aberto) permanece byte-a-byte igual — zero regressão Phase 88/94 | **PASS** — diff de 1 palavra em `dreRegime.ts`, `dreCascade.ts` sem diff, 18/18 testes |
| SC6 | INSS continua no bloco Pessoal, nenhum valor migra para impostos | **PASS** — 4/4 testes de regressão |

**Nenhum SC falhou.** Duas parcelas do SC1 (cartão + não classificado) são **identificadas e expostas pelo sistema**, com a correção na fonte pendente do Wesley no Tiny — isso é o escopo acordado (C8/C9: só informar), não uma falha da phase.

---

## SC1 — o swing de maio reconcilia contra o gabarito, sem sobra

**Critério literal (ROADMAP):** *"Maio/2026 fechado reconcilia a cascata com swing de R$52.496,21 = tarifas 11.248,96 + CMV 9.887,92 + cartão 20.550,13 + não classificado 10.809,20 (bate exato, sem sobra)."*

### As 4 parcelas do swing

| Parcela | Fórmula | Fonte | Resultado |
|---|---|---|---|
| 1. Tarifas | `75.127,33 (charge, com parcelamento) − 63.878,37 (competência, sem parcelamento)` | `ml_billing_daily` por `competence_date`, prod (orquestrador) | **11.248,96** ✅ |
| 2. CMV (delta do COALESCE) | `136.462,51 (COALESCE cheio→médio) − 126.574,59 (cheio puro, pré-backfill)` | `get_cost_waterfall.cmv_cheio`, medido no 96-03 ANTES do backfill do 96-07, prod (orquestrador) | **9.887,92** ✅ |
| 3. Cartão de crédito | `22.752,76 (total lançado) − 2.202,63 (custo real não-ML)` = billing ML já contado em tarifas | `get_dre_operational_by_competence`, linha `double_count_risk=true`, achado documental do Wesley sobre a fatura de maio (`96-CONTEXT.md §3 [C9]`) | **20.550,13** ✅ (identificada; correção é do Wesley no Tiny — ver nota abaixo) |
| 4. Não classificado | Lançamentos crus do bloco `nao_classificado`, competência maio | `get_dre_nao_classificado_items`, prod (orquestrador) | **10.809,20** / 3 lançamentos ✅ (Textile Xtra 4.627,04 + Pralana 3.329,39 + Pralana 2.852,77) |

**Soma: `11.248,96 + 9.887,92 + 20.550,13 + 10.809,20 = 52.496,21`** — bate exato contra o gabarito do ROADMAP, sem arredondamento e sem sobra (T-96-27 satisfeito: nenhuma peça foi forçada).

```
11248.96 + 9887.92 + 20550.13 + 10809.20 = 52496.21   ✅ verificado (python3, ver histórico de execução)
```

### ⚠️ Duas das 4 parcelas NÃO são entregues por código — e isso é esperado

- **Parcela 3 (cartão, R$20.550,13):** escopo de código = expor o alerta `double_count_risk` com o valor (C9, entregue no 96-06). A correção **na fonte** (lançar no Tiny só a parte não-ML a partir de agora + corrigir 6 faturas históricas em julho) é tarefa manual do Wesley, já entregue a ele.
- **Parcela 4 (não classificado, R$10.809,20):** escopo de código = listar e alertar (C8, entregue no 96-06). A recategorização das 7 notas Outros→Fornecedores no Tiny é do Wesley.

Registrar essas duas como "identificadas e expostas pelo sistema, correção pendente do dono" — **não como FAIL da phase**. O critério de aceite do ROADMAP é que a soma reconcilie contra dado real, não que o código auto-corrija os 4 furos (decisão de produto travada em C8/C9).

### Identidade da receita (não contribui para o swing)

`get_cost_waterfall.paid_revenue` = **247.216,12**; `get_cancelled_revenue` = **14.450,29** (cancelled 14.063,90 + partially_refunded 386,39); bruto = **261.666,41** = 247.216,12 + 14.450,29; líquida = 261.666,41 − 14.450,29 = **247.216,12**, idêntica à de hoje.

```
261666.41 - 14450.29 = 247216.12   ✅
247216.12 + 14063.90 + 386.39 = 261666.41   ✅
```

A receita é **simetria de apresentação** (C1), não correção de valor — confirmado: o bottom line não se moveu.

### ⚠️ O CMV real pós-backfill NÃO é o `9.887,92` do CONTEXT — e o resultado final também não é `+9.072,94`

O CONTEXT §2 projetava um resultado corrigido de **+9.072,94** usando o CMV cheio puro pré-backfill (126.574,59). O próprio CONTEXT avisava que esse número era **otimista**: o cheio puro cobria só 90,4% da receita, e os 226 pedidos sem custo cheio entravam com **custo zero** na soma — subestimando o CMV real.

Depois do backfill do 96-07 (que fechou 34 dos 39 SKUs), o `cmv_cheio` de maio subiu para **137.921,99** — MAIOR que o cheio puro pré-backfill (126.574,59), porque agora as 200 linhas que antes tinham custo zero (silenciosamente) passaram a ter custo real lançado.

**Isso significa que o componente "CMV" do swing, medido no resultado FINAL, vira `126.574,59 − 137.921,99 = −11.347,48`** (um efeito NEGATIVO sobre o resultado corrigido) em vez do `+9.887,92` que aparecia contra o número mascarado original.

**Não confundir os dois números:**
- **9.887,92** = o efeito de **tirar o COALESCE** (136.462,51 → 126.574,59), medido no 96-03, ANTES do backfill. É essa a 2ª parcela do swing de 52.496,21 — a prova de que o C6 corrigiu o mascaramento.
- **O backfill é um efeito POSTERIOR e SEPARADO**, não parte do swing de 52.496,21. Ele muda o resultado final de maio, mas não a soma que prova o SC1.

Misturar os dois faria a soma do SC1 não fechar em 52.496,21 — por isso o plano exigiu medir o delta do COALESCE **antes** do backfill (96-03, Task 2) e tratá-lo como um evento separado do backfill (96-07).

### O resultado real de maio (o fecho da phase)

| Linha | Valor |
|---|---:|
| Receita líquida | 247.216,12 |
| (−) Tarifas ML (competência, sem parcelamento) | −63.878,37 |
| (−) CMV cheio real (pós-backfill) | −137.921,99 |
| (−) Impostos (guia real M+1) | −4.793,23 |
| **= Margem de contribuição** | **40.622,53 (16,43%)** |
| (−) Pessoal + Estrutura + Serviços + Operacional | −36.034,69 |
| **= Resultado operacional** | **4.587,84** |
| (−) Financeiro (parcela cheia do empréstimo) | −6.862,30 |
| **= Resultado líquido** | **−2.274,46 (−0,92%)** |

**Maio deu −R$2.274,46, não os −43.423,27 que o sistema mostrava, nem os +9.072,94 do cheio puro pré-backfill (que era otimista).**

**O ganho da phase é sair de −R$43.423,27 (falso, com custo mascarado) para ≈zero (verdadeiro, com custo real): um swing de fato de R$41.148,81 no resultado final — não os R$52.496,21, porque o backfill trocou o sinal do componente CMV.** O SC1 se prova pelas 4 parcelas do swing original (52.496,21, exato), não pelo resultado final — que é uma consequência posterior do backfill + dos SKUs que ainda faltam custo.

---

## SC2 — Tarifas de maio por competência sem parcelamento = R$63.878,37

**Critério literal:** *"Tarifas de maio por competência sem parcelamento = R$63.878,37 (hoje 75.127,33)."*

**Prova por teste puro (96-01):**
```
npx vitest run src/hooks/useMLBilling.test.ts
✓ src/hooks/useMLBilling.test.ts (6 tests) 5ms
```
6/6 testes verdes, incluindo a fixture reconciliada de maio: `74.704,19` bruto por competência → `totalTarifas === 63.878,37` após excluir o parcelamento líquido (10.825,82 = CFONPN 12.187,14 + BFONPN −1.361,32).

**Prova de prod:** `ml_billing_daily` de maio por `competence_date` soma **74.704,19**; menos CFONPN (12.187,14) e BFONPN (−1.361,32) = **63.878,37**. Delta vs. os 75.127,33 de hoje (por `charge_date`, com parcelamento): **11.248,96** — a 1ª parcela do swing (SC1).

**Veredito: PASS.**

---

## SC3 — O gate impede o fechamento de maio com custo cheio faltando

**Critério literal:** *"O gate IMPEDE o fechamento de maio enquanto os 39 SKUs / 226 linhas / R$23.828,31 não tiverem custo cheio, e lista quais são."*

**Estado ANTES do backfill (96-03/96-07, medido em prod):** `get_cmv_cheio_gaps` maio = **39 SKUs / 226 linhas / R$23.828,31 / 4 sem custo nenhum**.

**Estado DEPOIS do backfill (96-07, medido em prod):** gaps de maio **39 → 5 SKUs**; receita travada **23.828,31 → 4.693,08**. O backfill fechou 34 dos 39 — o resíduo (5, dos quais 4 são "sem custo nenhum") é a tarefa manual do Wesley no Tiny (cadastrar os SKUs sem custo).

**Na tela:** com maio ainda tendo SKUs sem custo cheio, o botão "Marcar mês como apurado" continua **desabilitado**, com `Tooltip` listando o motivo, e a lista (`CmvGapsTrigger`, Popover) mostra os SKUs restantes marcados como "sem custo nenhum — cadastrar no Tiny" (`temCustoMedio=false`) ou "falta o custo cheio" (`temCustoMedio=true`).

**Veredito: PASS.** A evolução 39 → 5 é o comportamento correto — o gate nunca mascara, e o backfill fez a parte automatizável do trabalho; o resíduo tem dono (Wesley).

---

## SC4 — O gate de imposto aceita status, nunca o valor

**Critério literal:** *"O gate de imposto aceita maio (3 guias paid) e rejeita mês com guia pending; 0,01 não bloqueia."*

**Prova por teste puro (96-02):**
```
npx vitest run src/lib/dreCloseGate.test.ts
✓ src/lib/dreCloseGate.test.ts (10 tests) 7ms
```
10/10 testes verdes. Os dois casos que importam:
- **Maio com duas guias de R$0,01 (PIS/COFINS, crédito de Lucro Real) → PASSA.** `canApurarImposto` nunca lê o campo `total` — só `status`.
- **Competência com `pending` de R$3.298,87 (COFINS, previsão futura recorrente) → REJEITA**, mesmo com valor alto. Qualquer guia `pending` bloqueia, independente do que ela vale.

**Veredito: PASS.**

---

## SC5 — Previsão (mês aberto) permanece byte-a-byte igual

**Critério literal:** *"Previsão (mês aberto) permanece byte-a-byte igual à atual — zero regressão da Phase 88/94."*

**Prova por teste puro:**
```
npx vitest run src/lib/dreRegime.test.ts
✓ src/lib/dreRegime.test.ts (18 tests) 151ms   →  18/18
```

**Prova por diff:**
```
git diff main -- src/lib/dreRegime.ts | grep -vE '^(\+\+\+|---) '
diff --git a/src/lib/dreRegime.ts b/src/lib/dreRegime.ts
index cb7ebed0..23114d6a 100644
@@ -27,7 +27,7 @@
 export type DreRegime = "previsao" | "apuracao";

 /** The 3 real-tax categories that must all be present for a coherent apuração. */
-const IMPOSTO_VENDA_CATEGORIES = [
+export const IMPOSTO_VENDA_CATEGORIES = [
```
O diff de conteúdo inteiro do arquivo é **1 palavra-chave** (`export`), para permitir que `dreCloseGate.ts` reutilize a lista sem duplicá-la. `resolveDreRegime` (a função que escolhe a base de CMV/imposto) não foi tocada.

```
git diff main --stat -- src/lib/dreCascade.ts
(vazio)
```
`dreCascade.ts` está **byte-a-byte idêntico ao main** — zero diff.

### 🚨 SC2 × SC5 — a distinção que evita a leitura errada mais provável desta phase

> **SC5 não significa "o mês aberto não muda em nada".** C2/C4/C5 mudam as tarifas **também no mês aberto** — e isso é **intencional**: taxa de parcelamento não é custo da loja em mês nenhum, aberto ou fechado, e competência é a régua certa em ambos. O mesmo vale para o C1 (receita bruta + cancelamentos aparecem nos dois regimes).
>
> **SC5 é sobre `resolveDreRegime`** — o resolver escolhe a base de **CMV e imposto** conforme o regime, e **nunca lê tarifas nem receita**. O que a Phase 94 travou e esta phase preserva é: mês aberto → CMV **médio** + imposto **estimado**; mês fechado → CMV **cheio** + **guia real**. Nenhuma das 8 correções toca essa escolha. Os 18 testes verdes + o diff de 1 palavra em `dreRegime.ts` são a prova.
>
> Em uma frase: **SC5 protege a escolha da base, não os números da tela.**

**Veredito: PASS.**

---

## SC6 — INSS continua no bloco Pessoal

**Critério literal:** *"INSS continua no bloco Pessoal; nenhum valor migra para a linha de impostos."*

**Prova por teste puro (96-02, describe `buildDreCascade — C11: INSS fica no bloco Pessoal (NÃO-mudança)`):**
```
npx vitest run src/lib/dreCascade.test.ts
✓ src/lib/dreCascade.test.ts (10 tests) 9ms
```
Os 4 testes do C11:
1. **Test 1:** Salários 24.000 + INSS 3.852,19 somam **27.852,19** no bloco `pessoal`, com label "Pessoal".
2. **Test 2:** a mesma fixture não produz nenhuma linha de imposto na cascata.
3. **Test 3:** uma linha `impostos_venda` misturada na fixture é filtrada e não altera `resultadoOperacional`.
4. **Test 4:** o INSS entra no `resultadoOperacional` DEPOIS da margem de contribuição (dedução operacional, não fiscal).

Todos os 4 passaram **verdes já na primeira execução** (RED não aplicável — C11 é uma não-mudança por design; se algum tivesse falhado, seria sinal de regressão introduzida por outro plano).

**Veredito: PASS.**

---

## Suíte completa + build

```
npx vitest run
 Test Files  43 passed (43)
      Tests  582 passed (582)

npx tsc --noEmit
(0 erros)

npm run build
✓ built in 19.25s
```

Baseline de 582/582 mantido (era ~542 no início da phase; os testes novos de 96-01/02/05 elevaram o total). Nenhuma falha, nenhum erro de tipo, build limpo.

---

## Cascata de maio — 3 colunas (CONTEXT × prod)

| Linha | CONTEXT — se fechar hoje | CONTEXT — corrigida (cheio puro, otimista) | **Medido em prod (pós-backfill, real)** |
|---|---:|---:|---:|
| Receita líquida | 247.216,12 | 247.216,12 | **247.216,12** |
| (−) Tarifas ML | −75.127,33 | −63.878,37 | **−63.878,37** |
| (−) CMV | −136.462,51 *(COALESCE)* | −126.574,59 *(cheio puro, 90,4% cobertura)* | **−137.921,99** *(cheio real, pós-backfill)* |
| (−) Impostos (guia real) | −4.793,23 | −4.793,23 | **−4.793,23** |
| **= Margem de contribuição** | **30.833,05 (12,47%)** | **51.969,93 (21,02%)** | **40.622,53 (16,43%)** |
| (−) Pessoal + Estrutura + Serviços | −33.756,06 | −33.756,06 | **−33.756,06** |
| (−) Operacional | −22.827,76 | −2.277,63 | *(incluído no total abaixo)* |
| Subtotal deduções pós-margem | | | **−36.034,69** |
| (−) Não classificado | −10.809,20 | 0 | *(exposto, não zerado — pendente Wesley)* |
| **= Resultado operacional** | **−36.560,97** | **15.935,24** | **4.587,84** |
| (−) Financeiro (parcela cheia) | −6.862,30 | −6.862,30 | **−6.862,30** |
| **= Resultado líquido** | **−43.423,27** | **+9.072,94** *(otimista)* | **−2.274,46 (−0,92%)** |

**Nenhuma linha ficou com `<preencher no checkpoint>`** — todos os números vivos foram fornecidos pelo orquestrador (MCP Supabase) e reconciliados neste documento.

---

## Follow-ups registrados (não bloqueiam o fechamento da phase)

1. **Índice em `ml_billing_daily (organization_id, ml_user_id, competence_date)`** — o filtro novo do C4 pode não ter índice dedicado (drift a confirmar).
2. **`orders.data_pedido` TEXT → timestamptz** — pendência antiga do STATE, fora do escopo desta phase.
3. **7 SKUs da família `1156120*` com médio > cheio** (campos invertidos no Tiny, ex. `1156120NATP` médio 157,00 × cheio 107,81) — candidato ao alerta de dado ruim (mesma regra do C8: informar, nunca auto-corrigir). Impacto desprezível: só 2 venderam em 2026, R$396 no total.
4. **`custo_unit_cheio` é o custo CADASTRADO HOJE, não o da época da venda** — uma venda de janeiro recebe o custo atual do Tiny. Point-in-time (`cost_full_history`) resolveria; é problema ortogonal, phase própria (T-96-24, aceito).
5. **Trava B (gatilho do `useAutoRecalc`) pulada** — o gatilho só olha médio/imposto, não o eixo do gate de CMV cheio; `has_cmv_cheio = cmv_cheio>0` é sinal inútil (SKU pode ter cheio parcial). Gap conhecido: produto cadastrado no Tiny DEPOIS de já ter vendido fica sem cheio nos pedidos antigos até recálculo manual (`/pedidos`, `only_missing:false`).
6. **`deno check` de `sync-ml-orders`** — erro pré-existente de tipo (`userId: string|null` → `string`), não introduzido por esta phase (ver `deferred-items.md`).
7. **Fila de cadastro por mês** (gaps restantes de custo cheio, medidos em 15/07): mai 5 · jun 4 · jul 6 · jan 14 · fev 23 · mar 17 · abr 12.

---

## O achado que redefiniu o escopo do 96-07 (registro histórico)

A premissa original do plano 96-07 — *"nada em produção grava `custo_unit_cheio`"* — estava **ERRADA**. A EF viva (`recalc-order-costs`) já gravava o campo; ninguém tinha comparado contra **produção**, só contra o repo (que estava atrasado ~19 dias por um worktree irmão não mergeado). O congelamento da cobertura vinha de **3 travas de CAMINHO**, não de código faltando:

- **Trava A** (corrigida): o filtro `only_missing` de `recalc-order-costs` usava `.or("custo_unit.is.null,tax_amount.is.null")` — um pedido com médio preenchido (quase todos) nunca entrava no SELECT, então a função sabia gravar o cheio mas nunca via as linhas que precisavam dele.
- **Trava B** (pulada, gap conhecido): o gatilho do `useAutoRecalc` só olha médio/imposto — não dispara para SKUs que só faltam o cheio. Documentado, não corrigido nesta phase.
- **Trava C** (corrigida nos 2 lados): a ingestão. `sync-ml-orders` nunca mandava o campo cheio no record, e `batch_upsert_orders` tinha whitelist explícita de colunas sem `custo_unit_cheio` — o campo seria descartado **em silêncio** mesmo se enviado.

**Prova da correção da Trava C:** sync real de pedidos de 14–15/jul → **14/jul 31/31 (100%)**, **15/jul 27/29 (93,1%)**, com `com_cheio == com_medio`. Antes da correção, julho estava em 32,9% de cobertura do cheio contra 94,9% do médio. **O congelamento da cobertura está encerrado** — pedidos novos nascem com custo cheio, não só médio.

Isso não muda nenhum SC (o gate sempre bloqueou corretamente, com ou sem as travas), mas é o que garante que o gate não vira uma **porta trancada para sempre**: sem a correção da Trava C, todo mês novo nasceria sem custo cheio e o gate bloquearia para sempre, mesmo depois do Wesley cadastrar os SKUs faltantes.

---

*Phase: 96-dre-correcoes-linha-a-linha*
*Plan: 08*
*Gerado: 2026-07-15*
