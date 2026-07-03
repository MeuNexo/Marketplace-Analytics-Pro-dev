# 84-05 SUMMARY — Deploy EF + backfill 2026 + smoke (PARCIAL / PAUSADO)

**Status:** PARTIAL — deploy ✅, backfill ⚠️ incompleto (pausado por decisão de Wesley), smoke ⏸ pendente.
**Executado por:** orquestrador (Nexo) via Supabase MCP — checkpoint aprovado por Wesley (2026-07-03).
**Projeto:** `ckcdevcxgvueywivefgx` (prod).

## Feito e verificado
1. **EF `sync-ml-billing` deployada — version 11 ACTIVE, `verify_jwt=false`** (código do 84-02: `aggregateMoves` por competência + `aggregate.ts`; remove `within`; grava `competence_date`). Smoke de auth OK: **OPTIONS → 200, POST sem auth → 401**. `ml_billing_monthly`/`fetchBillingPeriod` intactos.
2. **Backfill 2026 — PARCIAL.** Re-sync via `net.http_post` (Pattern B, service_role do vault). Estado atual (Pé Vermeio 1639558873):
   - Fatura `2026-02`: **790 linhas, competência REAL** (re-derivada — prova que o regime funciona: 500 linhas com `competence_date ≠ charge_date`).
   - Faturas `2026-03` … `2026-07`: ainda no estado da migration (`competence_date = charge_date`) — **NÃO re-sincronizadas**.
   - Total 2.699 linhas, **íntegro** (soma por fatura fecha; nenhuma fatura zerada; sem perda/corrupção).

## Bloqueador (divergência T-84-11)
O re-sync das demais faturas falhou por **lentidão transitória da API do ML** batendo no **limite de execução da Edge Function**:
- `POST 546` (worker limit) em **150s** e `POST 500 "Signal timed out"` em **82s** ao processar as 2 faturas de um mês inline (`?debug=1`).
- Caminho background (`EdgeRuntime.waitUntil`, 202) é cortado quando o pg_net fecha a conexão → não grava.
- Causa raiz: `runDailySync` processa 2 faturas ML+MP paginadas por chamada; com o ML lento, excede o teto de wall-clock da EF.

## Decisão (Wesley, 2026-07-03): PAUSAR
Manter EF+migration live (já estão) e deixar o **cron `sync-ml-billing-prev-month` (dias 6–12)** + syncs **on-demand** do frontend re-derivarem a competência de 2026 naturalmente nos próximos dias. **Não** martelar o ML lento agora.

## Segurança do estado atual
- **DRE live NÃO quebrou**: o frontend novo (filtro por `competence_date`, plano 84-03) **não foi deployado** (Vercel), está só na branch. O frontend live ainda lê por `charge_date`.
- Efeito colateral menor: a fatura `2026-02` re-sincronizada agora inclui estornos antes excluídos (`within` removido) → totais por `charge_date` de jan/fev podem variar levemente no frontend live. Junho intacto.
- Novos syncs (cron/on-demand) já gravam competência correta (EF v11).

## Pendências para retomar (quando junho reconciliar)
1. Confirmar que cron/on-demand re-derivaram TODAS as faturas de 2026 (`competence_date ≠ charge_date` presente onde há venda; PADS/mensalidade seguem no fallback).
2. Rodar o smoke completo: invariante (nenhum movimento perdido/duplicado, dedup por `detail_id`), **reconciliação junho/Pé Vermeio ao centavo**, anti-IDOR (0 linhas cross-org), prova cross-month.
3. Só então: **84-06** (validação visual Wesley light+dark + merge do frontend). Merge do frontend fica TRAVADO até junho reconciliar.

**Job background morto (req 32371) não gravou — sem cleanup necessário (idempotente).**

---

## UPDATE (mesma sessão, 2026-07-03) — JUNHO RECONCILIADO ✅

Wesley pediu para finalizar junho. Como o `debug=1` de 2 faturas estourava o limite da EF com o ML lento, foi feito um **ajuste mínimo na EF (v12 ACTIVE):** modo backfill de **1 fatura por chamada** via body `invoice_key` (`syncSingleInvoice`) — comportamento existente intacto quando `invoice_key` ausente. Commit `feat(84-05): EF ganha modo backfill 1-fatura`.

**Faturas de junho re-derivadas:** `2026-07` (926 linhas, via period 2026-06) + `2026-06` (841 linhas / 513 realocadas, via `invoice_key=2026-06-01` após cooldown de ~2,5min do rate-limit do ML). Junho está completo (todas as faturas que o ML já cobrou até hoje).

**DRE junho por competência (Pé Vermeio 1639558873):**
Receita R$261.987,61 − CMV R$110.613,42 − Impostos R$53.327,05 − **Tarifas competência R$77.159,19 = Lucro R$20.887,95**.
- vs lançamento (charge_date) atual pós-resync: tarifas R$74.800,83 / lucro R$23.246.
- vs lançamento antigo (início da sessão): tarifas R$80.426,45 / lucro R$17.620,69.
- Delta competência: ~R$3.267 de tarifa cobrada em junho mas de venda de outro mês saiu de junho (efeito pedido).

**Comparação Tiny vs dashboard:** Tiny "Custos e-commerce" é visão PARCIAL (só CMV+comissão+frete; NÃO inclui impostos/parcelamento/ads/Full/DIFAL) e puxa ~91% dos pedidos. Proporções item-a-item batem ~90-92% → coerente. Dashboard é o autoritativo para lucro real.

**Ainda pendente:** faturas `2026-03/04/05` (+jan) não re-derivadas (cron/on-demand ou backfill manual via `invoice_key`+cooldown); smoke completo (invariante/anti-IDOR/cross-month); **84-06** (validação visual Wesley + merge frontend). Ao merge, o dashboard de junho passa de R$23.246 (charge_date) para R$20.888 (competência).
