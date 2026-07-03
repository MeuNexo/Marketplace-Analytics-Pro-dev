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
