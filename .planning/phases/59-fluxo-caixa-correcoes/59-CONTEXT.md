# Phase 59 — Fluxo de Caixa: Correções (Projeção 7d + Sync Contas a Pagar)

> CONTEXT / discussão da fase. Origem: Wesley usando o dashboard de Fluxo de Caixa
> (Phase 49) encontrou 2 inconsistências reais. Diagnóstico feito ao vivo contra a
> **produção `ckcdevcxgvueywivefgx`** (org `7f615df7-7bac-45e5-8a93-827fb9ddeec7`) em 2026-06-25.
> Projeto Supabase correto = `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md).

## Problema (relato do Wesley)

1. **Projeção média de 15d infla os primeiros dias.** A linha de projeção (`accumulated_balance_sma`)
   aplica a média diária de recebimento dos últimos 15 dias **desde hoje**. Como venda de hoje só
   vira caixa ~14 dias depois (lag de liberação do MP), somar a média "imediata" nos primeiros dias
   conta dinheiro que **já está nos recebimentos confirmados** → infla o curto prazo.
2. **Contas a pagar congeladas.** Os valores de `cash_outflows` estão **idênticos desde a primeira
   sincronização** (18/06). Deveria sincronizar com o Tiny pelo menos 1x/dia.

## Decisão de produto travada (Wesley, 2026-06-25)

**Projeção — regra final (2 partes):**
1. Nos **primeiros 7 dias a partir de hoje, a linha de projeção NÃO considera nenhuma entrada de
   previsão** — segue apenas os recebimentos confirmados (liberações MP reais).
2. **A partir do 8º dia, a média de 15d é aplicada SOMENTE nos dias que não tiverem nenhum
   recebimento confirmado.** Dias (do 8º em diante) que já têm recebimento confirmado mantêm o
   **valor real**, não a média. A média só "preenche" os dias futuros vazios.

Citações literais do Wesley:
> "pode ser assim, mas somente depois dos primeiros 7 dias... Antes não precisa considerar nenhuma
> entrada de previsão."
> "ela será aplicada somente nos dias que não tiver recebimento nenhum a partir do oitavo dia."

Efeito combinado: zero dupla-contagem. A projeção = confirmado (dias 1-7) → confirmado onde existe
(dia 8+) → média só nos buracos futuros sem recebimento.

## Diagnóstico técnico (feito em prod, 2026-06-25)

### Issue 1 — Projeção (código)
A RPC `get_cashflow` monta a série diária e calcula duas linhas acumuladas:
- `accumulated_balance`   (confirmado) = `v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d_date)`
- `accumulated_balance_sma` (projeção) = `v_initial + SUM(v_sma - d.exp) OVER (ORDER BY d_date)`

Onde `v_sma` = média diária dos últimos 15d = `SUM(receita_bruta - comissao - frete)/15` (janela
`CURRENT_DATE-15 .. CURRENT_DATE-1`). O `v_sma` é aplicado **em todo dia** da série a partir de hoje
(`v_start := GREATEST(p_start_date, CURRENT_DATE)`) → daí a inflação.

- Referência base: `supabase/migrations/20260619000000_cashflow_sma_bruta_menos_taxas.sql`
  (linhas ~34 `v_start`, ~36-56 `v_sma`, ~83-88 SELECT final com a coluna SMA).
- ⚠️ **Existem migrations posteriores que reescrevem `get_cashflow`** — o executor DEVE pegar a
  definição **mais recente** antes de editar:
  - `20260619010000_*` expôs `daily_projection` no RPC (linha "+ Previsão" do tooltip).
  - `20260619020000_*` trocou `CURRENT_DATE` por `(now() AT TIME ZONE 'America/Sao_Paulo')::date`
    (fix timezone BRT). **A correção da janela de 7 dias tem que usar a MESMA data BRT**, não `CURRENT_DATE` cru.

**Fix proposto (a confirmar no plano):** na coluna SMA, trocar `v_sma` por um CASE que (1) usa só o
recebimento confirmado nos primeiros 7 dias e (2) do 8º dia em diante aplica a média **apenas onde
não há recebimento confirmado**:
```sql
-- pseudo: v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date
(v_initial + SUM(
   (CASE
      WHEN d.d_date <= v_today + 7 THEN d.inc   -- 1-7 dias: confirmado, sem previsão
      WHEN d.inc > 0               THEN d.inc   -- 8º+ COM recebimento: usa o valor real
      ELSE v_sma                                -- 8º+ SEM recebimento: preenche com a média
    END)
   - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC AS accumulated_balance_sma
```
Efeito: projeção idêntica à confirmada nos primeiros 7 dias; do 8º dia em diante segue o confirmado
onde ele existe (até ~30d à frente, horizonte do MP) e só preenche os **buracos futuros sem
recebimento** com a média. Zero dupla-contagem, sem inflação no curto prazo.
- ⚠️ Confirmar no plano o threshold `d.inc > 0` (ex.: arredondamento/centavos) e se o "dia 8" é
  inclusivo (`<= v_today + 7` deixa o 8º dia caindo no ELSE — correto).
- Frontend (`src/components/financial/CashFlowChart.tsx`, `src/hooks/useCashFlowData.ts`): a coluna
  não muda de nome → provavelmente **zero alteração de frontend**; só atualizar JSDoc/legenda/tooltip
  se descreverem "média desde hoje". Validar.

### Issue 2 — Sync de contas a pagar (CONGELADO há 7 dias)
Achados na produção:
- `cash_outflows`: **1.960 linhas, `synced_at` = `2026-06-18 19:29:49` em TODAS** (1 único timestamp,
  `dias_distintos_de_sync = 1`). 1.558 paid / 402 pending. Nada gravado desde 18/06.
- Cron **existe e está ativo**: `sync-tiny-payables-6h` (`0 */6 * * *`, jobid 22). `service_role_key`
  presente no vault. `cron.job_run_details` → todas as execuções `succeeded` ("1 row" = só enfileirou o POST).
- **Causa-raiz na infra (confirmada):** `net._http_response` registra **`Timeout of 5000 ms reached`**
  nas chamadas (ex: 12:00 e 12:05 de 25/06). O `net.http_post` do cron usa o **timeout default de
  5000ms** do pg_net; a EF `sync-tiny-payables` leva **~15,7s** (`edge-function` log: `execution_time_ms: 15784`,
  `status_code 200`). O pg_net abandona a chamada aos 5s.
- **Agravante a investigar (debug obrigatório):** mesmo a EF tendo retornado **200 em 15,7s hoje às
  12:00**, `cash_outflows.synced_at` continua 18/06 → a EF roda mas **não persiste**. Hipóteses a
  testar na execução:
  1. token Tiny expirado/refresh falhando → `fetchPayables` volta vazio → upsert de 0 linhas → 200 "ok".
  2. query de lojas Tiny-conectadas (`ml_tokens WHERE tiny_access_token IS NOT NULL`) retornando vazio.
  3. erro de upsert sendo engolido por try/catch e a EF respondendo 200 mesmo assim.
  4. a conexão fechada pelo pg_net aos 5s mata a EF antes do commit (mas o log de 15,7s/200 sugere
     que ela completa — então 1/2/3 são mais prováveis).
- Arquivos: `supabase/functions/sync-tiny-payables/index.ts` (EF), `20260618115000_cash_outflows_tiny_cron.sql` (cron).

**Fixes propostos (a detalhar no plano):**
- **a) Timeout do disparo:** passar `timeout_milliseconds` no `net.http_post` (ex.: 60000) OU mudar a
  EF para responder rápido (202) e processar em background (`EdgeRuntime.waitUntil`) — desacoplar do
  pg_net. (nova migration de cron; não dropar/recriar via SQL Editor — seguir padrão das migrations.)
- **b) Persistência:** primeiro **provar a causa-raiz** (invocar a EF com observabilidade: logar nº de
  lojas, nº de contas do Tiny, nº de linhas upsertadas; conferir validade do token Tiny). Corrigir o
  que estiver impedindo o write. Garantir que o upsert atualiza `synced_at` (default `now()` no insert;
  no conflito, confirmar que `synced_at` está no set de update).
- **c) Frequência:** Wesley pediu "pelo menos 1x/dia". O cron já é 4x/dia (6h) — **manter** desde que
  funcione; não reduzir. Foco é fazer **persistir**, não mudar cadência.
- **d) Observabilidade (opcional, decidir no plano):** indicador de "última atualização do contas a
  pagar" na UI de fluxo de caixa, lendo `max(synced_at)` — pra esse congelamento ficar visível no futuro.

## Fonte da verdade / validação
- Caixa é reconciliado **ao centavo** com a planilha DFC do Wesley (Phase 49). A correção da projeção
  **não pode mexer** na linha confirmada nem nos valores reais — só na curva da projeção a partir do 8º dia.
- Validar Issue 2 com: após o fix, `SELECT count(DISTINCT synced_at::date) FROM cash_outflows` deve
  passar a crescer dia a dia; e o total/abertos refletir o Tiny ao vivo.

## Fora de escopo
- Mudar a base/fórmula do `v_sma` (já decidido na Phase 49 = `receita_bruta - comissao - frete`).
- Mexer no Simulador (Phase 50) — ele consome o baseline; herda a correção da projeção sem alteração própria.
- Rotação de segredos (item separado, já pendente no STATE).

## Riscos / atenção
- Pegar a **versão mais recente** de `get_cashflow` (3 migrations mexem nela) e usar a **data BRT**.
- Cron de payables: **não** recriar via SQL Editor — migration versionada (lição `feedback_no_drift_via_sql_editor`).
- A EF pode estar respondendo 200 com 0 writes — não confiar no status 200 como prova de sync.
