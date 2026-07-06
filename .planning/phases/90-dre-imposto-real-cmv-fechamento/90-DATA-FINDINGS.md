# Phase 90 — Achados de banco (impostos_venda por competência)

**Coletado:** 2026-07-06 via Supabase MCP (projeto `ckcdevcxgvueywivefgx`, org Pé Vermeio `7f615df7`).
**Para:** gsd-planner (ler junto do 90-RESEARCH.md e 90-CONTEXT.md).

## ✅ DECISÕES DO WESLEY (07-06) — LOCKED, corrigem o CONTEXT
- **Q2 — RÉGUA (competência = mês do PAGAMENTO, NÃO da venda):** Wesley confirmou, contra a resposta inicial. A `dataCompetencia` do Tiny marca o mês em que a guia é **paga**. Guia de competência **C** cobre as **vendas de C−1**. Portanto: **a DRE do mês de venda `S` usa a guia de competência `S+1`** (deslocamento). Equivale a: atribuir guia(competência=C) → mês de venda `C−1`. **A decisão anterior "usar direto sem deslocar" está REVOGADA.**
- **Q1 — LIMBO:** manter o mês em **PROVISÃO (estimativa)** enquanto a guia real não entrar de verdade. Junho (e maio) ficam em provisão até a apuração real. Placeholder (PIS/COFINS = R$0,01) **NÃO** conta como guia real.
- **Gatilho "mês fechado" (resolvido):** mês de venda `S` é FECHADO (usa imposto real) somente quando a guia de competência `S+1` é **real apurada** = `status='paid'` **E sem placeholder** (todas as categorias presentes com valor acima de ~R$1; 0,01 reprova). Caso contrário → ABERTO → provisão (estimativa atual).
- **Mês de reconciliação da fase = ABRIL/2026** (vendas de abril → guia competência **Maio** = R$16.015,06, `paid`, 3 categorias, real). Evitar maio/junho (guia S+1 ainda placeholder/pendente) e meses futuros (previsão).

## Tabela `cash_outflows`, categorias `Imposto Venda - ICMS/PIS/COFINS`, competência 2026

| Competência | Total | status | Natureza |
|---|---|---|---|
| Jan | 17.740,79 (2 cat, sem COFINS) | ? | real (antigo) |
| Fev | 20.682,81 (2 cat) | ? | real |
| Mar | 2.278,80 (2 cat) | ? | real (baixo) |
| Abr | 11.847,25 (2 cat) | ? | real |
| **Mai** | **16.015,06** (ICMS 12.000 · PIS 716,19 · COFINS 3.298,87) | **paid** | **guia real apurada ✅** |
| **Jun** | **4.793,23** (ICMS 4.793,21 · PIS **0,01** · COFINS **0,01**) | **paid** | **PLACEHOLDER — PIS/COFINS = 1 centavo ⚠️** |
| Jul–Nov | **16.015,06 idêntico** | **pending** | **PREVISÃO/recorrência copiada de maio 🔮** |
| Dez | 20.555,85 | pending | previsão |

Detalhe (query 2): supplier="Receita Federal", document_number=null, source="tiny", descr="Guia ICMS/PIS/COFINS".

## GATILHO "mês fechado" — NÃO é "existe guia"
A RPC `get_dre_operational_by_competence` (migrations 20260687000000/…0100) **soma TODAS as linhas por competência sem filtrar `status`** → para meses futuros ela devolve a **previsão** (R$16.015 pending) como se fosse real. Um gatilho ingênuo (`impostos_venda.total > 0` ou `n > 0`) trataria Ago–Dez como fechados. **ERRADO.**

**Gatilho correto candidato:** `status = 'paid'` para a competência. Sob essa regra:
- Ago–Dez (pending) → OPEN → provisão (estimativa). ✅
- Jan–Mai (paid) → CLOSED → imposto real. ✅
- **Jun (paid, mas placeholder 0,01) → cairia como CLOSED com R$4.793 → decisão do Wesley (ver Q1).**

→ **Implicação p/ o planner:** a fonte do imposto real precisa considerar `status='paid'` (estender a RPC com filtro/flag de status, OU consultar `cash_outflows` com status na composição). NÃO usar a RPC atual crua para o gatilho.

## ⚠️ AMBIGUIDADE DA RÉGUA (Q2) — competência = mês da venda OU do pagamento?
Wesley respondeu "mês de referência, de onde ocorreu". Mas os **vencimentos** contradizem:
- Guia competência=**Maio** tem vencimento **2026-05-21/25** (paga EM maio).
- Guia competência=**Junho** tem vencimento **2026-06-21** (paga EM junho).

Pela regra fiscal (ICMS/PIS/COFINS apurados e pagos ~dia 20-25 do mês SEGUINTE à venda), uma guia paga em 21-25/mai seria sobre vendas de **abril**, não de maio. Ou seja, o `dataCompetencia` do Tiny parece marcar o **mês de pagamento/apuração**, não o mês da venda. Se for isso, atribuir a guia à competência **sem deslocar** desalinha o imposto do mês de venda correto e a reconciliação com a DRE do Wesley pode não fechar. **PRECISA CONFIRMAR COM WESLEY antes de travar a régua.** (Ver Q2.)

## Duas decisões pendentes do Wesley
- **Q1 (limbo de junho):** junho está `paid` mas placeholder (PIS/COFINS = R$0,01). Tratar junho como FECHADO com R$4.793, ou mantê-lo em PROVISÃO (estimativa) até ele lançar a guia real ~20-25/jul? → sugere gatilho não ser só `status='paid'`, mas talvez "paid E valores plausíveis" ou uma marcação explícita.
- **Q2 (régua):** a competência da guia no Tiny é o mês da VENDA ou do PAGAMENTO? Os vencimentos sugerem pagamento (= venda −1). Decide se usa direto ou desloca −1.

## Caso de reconciliação da fase
Usar **Maio/2026** (guia real paid, R$16.015,06, 3 categorias) como mês fechado de referência para provar que o DRE com (imposto real + custo cheio) bate com a planilha do Wesley. Evitar junho (placeholder) e meses futuros (previsão).
