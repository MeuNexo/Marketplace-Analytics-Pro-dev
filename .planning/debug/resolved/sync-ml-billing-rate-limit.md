---
status: resolved
trigger: "Sync do billing ML (sync-ml-billing modo daily) trava e não re-sincroniza o mês; DRE de junho mostra tarifas incompletas (~R$34,9k, só dias 01-12), inflando lucro em ~R$40k"
created: 2026-07-03
updated: 2026-07-03
---

# Debug: sync-ml-billing rate-limit / sync travado

## Symptoms

- **Expected:** DRE do Mês (/vendas) mostra TODAS as tarifas ML do mês-calendário (comissão, frete, parcelamento, ads PADS, Full) apuradas por competência (creation_date_time), dia 01→último dia.
- **Actual:** junho mostra só ~R$34,9k de tarifas (dias 01-12), congelado desde 13/jun (synced_at=2026-06-13 02:22 UTC). Lucro de junho inflado ~R$40k (mostra ~R$63k, real ~R$22k). Fatura real do ML já disponível: saldo líquido R$73.471, PADS R$7.548,33.
- **Error:** re-sync via EF retorna HTTP 500 `{"success":false,"error":"details ML offset 800: rate-limited after retries"}`. Reproduzido 2x (net._http_response id 32282 e 32283, mesmo offset 800).
- **Timeline:** billing daily de junho parou em 13/jun; nunca re-sincronizou depois que junho deixou de ser mês corrente.
- **Reproduction:** `select net.http_post(url:='https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-billing', headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')), body:=jsonb_build_object('ml_user_id','1639558873','period_month','2026-06','mode','daily'))` → 500 no offset 800.

## Root cause (3 camadas, pré-investigadas)

1. **BLOQUEADOR — paginação frágil.** `supabase/functions/sync-ml-billing/index.ts` `fetchGroupMoves` (linhas 82-135) pagina `/billing/integration/periods/key/{key}/group/{group}/details` por offset (PAGE=200), backoff curto (800ms×4), + passada de reconciliação que DOBRA as chamadas. Faturas grandes (06/jun→05/jul tem 800+ movimentos) estouram o rate-limit do ML. Nota 13/jun já registrava "paginação por offset instável, idealmente cursor last_id".
2. **Guard frontend.** `src/hooks/useMLBilling.ts:337-338` — `useMLBillingDailyWithSync` só dispara sync quando o mês tem ZERO dados (`if (isLoading || data || ...) return`). Mês com dados parciais nunca re-sincroniza.
3. **Sem cron de re-sync.** Nada re-sincroniza o mês anterior por ~7 dias após o fechamento da fatura (dia 5). Ciclo ML = 06→05.

## Objetivo do fix
- (a) [PRIORIDADE] Paginação resiliente ao rate-limit: avaliar cursor `last_id`; senão throttle/backoff maior + eliminar reconciliação dupla + rodar em background (`EdgeRuntime.waitUntil`). Meta: re-sincronizar junho AGORA e obter o número real.
- (b) Guard do frontend: permitir re-sync de mês com dados desatualizados/parciais (ex: staleness por synced_at, ou não bloquear quando dados incompletos).
- (c) Cron pg_cron (Pattern B) que re-sincroniza o mês anterior por ~7 dias após o dia 5.

## Constraints do ambiente
- Deploy de EF: SÓ via MCP Supabase `deploy_edge_function` (sem token para CLI).
- Disparo/teste do sync: `net.http_post` lendo `vault.decrypted_secrets` name='service_role_key' (Pattern B). Verificar resultado em `net._http_response`.
- Projeto Supabase: `ckcdevcxgvueywivefgx`. Org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, ml_user_id `1639558873`.
- Validação do sucesso: `ml_billing_daily` de junho deve passar de 12 dias / R$34,9k para o mês completo (~R$75-79k de tarifas), com PADS ≈ R$7,5k. Confrontar com fatura real (get_billing_full 2026-07: líquido R$73.471).

## Current Focus
- hypothesis: paginação por offset + reconciliação dupla excede o rate-limit do ML billing em faturas grandes; corrigir estratégia de fetch destrava o re-sync. CONFIRMADA via doc oficial ML + testes unitários da nova lógica de paginação.
- status real: as 3 camadas foram CORRIGIDAS NO CÓDIGO (arquivos abaixo) e validadas localmente (deno check, tsc, vitest 407/407, eslint, teste unitário isolado da paginação). **NÃO foi possível deployar a EF, aplicar a migration nem re-disparar/verificar contra o banco real nesta sessão** — este agente (gsd-debugger subagent) não tem acesso às tools MCP Supabase (`deploy_edge_function`, `apply_migration`, `execute_sql`) nem a um token de CLI/service-role neste ambiente sandboxed (confirmado: `supabase login` sem token, `.env` bloqueado por permissão, sem env vars SUPABASE_* no shell). Isso é um HUMAN-ACTION checkpoint, não uma falha da investigação.
- next_action: **uma sessão/agente com acesso às MCP tools do Supabase precisa**: (1) `deploy_edge_function` com o conteúdo atualizado de `supabase/functions/sync-ml-billing/index.ts`; (2) `apply_migration` com `supabase/migrations/20260684000000_sync_ml_billing_cron.sql`; (3) disparar o re-sync de junho e confirmar em `ml_billing_daily` — comandos exatos na seção "Como deployar e verificar (pendente)" abaixo.

## Fix aplicado no código (3 camadas)

### Layer 1 — `supabase/functions/sync-ml-billing/index.ts` (BLOQUEADOR, prioridade)
- `fetchGroupMoves`: trocado offset (PAGE=200 + reconciliação que dobrava as chamadas) por paginação em CURSOR (`from_id`/`last_id`, `limit=1000`, `sort_by=ID&order_by=ASC`) — confirmado como o método recomendado pela doc oficial ML ("Best Practices for Consuming Billing Reports APIs"). Backoff aumentado (1500ms×attempt, 5 tentativas, era 800ms×4). Guard de 50 páginas contra loop infinito se a API devolver `last_id` repetido/travado.
- Impacto medido (teste unitário, não API real): fatura de 850 movimentos que antes precisava de 5 páginas (offset) + reconciliação (mais ~9 chamadas) = ~9+ chamadas sequenciais, agora precisa de 2 chamadas (1 página cheia + 1 terminadora vazia). Fatura de 2500 movimentos = 4 chamadas. Isso ataca diretamente o motivo do rate-limit (excesso de chamadas sequenciais em pouco tempo).
- `runDailySync` extraída da lógica inline do handler para reuso.
- Modo `daily` agora roda em BACKGROUND via `EdgeRuntime.waitUntil` (mesmo padrão de `sync-mp-releases`/`sync-tiny-payables`/`sync-tiny-costs` já usado no projeto) — responde 202 "enqueued" imediatamente, evita o caller (pg_net do cron) segurar a conexão pela duração do sync. Adicionado `?debug=1` (query param) que roda INLINE (síncrono) e devolve o resultado completo (`invoices_synced`, `rows`) — usado para verificação manual sem precisar fazer polling em `net._http_response`.
- Fan-out multi-conta (`runAllAccountsDailySync`) adicionado para suportar o cron da Layer 3: `mode=daily` sem `ml_user_id` no body (só service-role) varre todos os `ml_tokens` ativos e sincroniza cada conta. `period_month` vira opcional só nesse caminho (default = mês-calendário anterior, calculado em `previousCalendarMonth()`).

### Layer 2 — `src/hooks/useMLBillingDailyWithSync` em `src/hooks/useMLBilling.ts`
- Guard antigo só reagia a `!data` (zero linhas). Agora também reage a mês FECHADO (`isClosedMonth`, não o mês corrente) com `coverageTo` diferente do último dia do mês (`lastDayOfMonth`) — cobre exatamente o caso do bug (junho parou no dia 12, deixou de ser corrente em julho, nunca mais re-sincronizou).
- Como a EF agora responde 202 antes do sync terminar (background), adicionado polling pós-trigger: refetch a cada ~4s por até 8 tentativas, parando cedo assim que `coverageTo` bate com o esperado (ou imediatamente para mês corrente, onde não há uma coverage "completa" bem definida).

### Layer 3 — `supabase/migrations/20260684000000_sync_ml_billing_cron.sql` (NÃO APLICADA)
- Cron `sync-ml-billing-prev-month`, Pattern B (vault `service_role_key`), roda diariamente às 08:00 UTC nos dias 6–12 do mês (`0 8 6-12 * *` — janela de ~7 dias após o fechamento do ciclo ML 06→05). Body `{"mode":"daily"}` sem `ml_user_id` aciona o fan-out multi-conta da EF.

## Validação local feita (sem acesso à API/DB real)
- `deno check supabase/functions/sync-ml-billing/index.ts` → OK, zero erros de tipo.
- `npx tsc --noEmit -p .` (projeto inteiro) → OK, zero erros.
- `npx vitest run` → 407/407 testes passando (nenhuma regressão; não havia testes prévios para `useMLBilling.ts`).
- `npx eslint src/hooks/useMLBilling.ts` → zero erros (arquivo da EF já tinha 9 erros pré-existentes de `no-explicit-any`, consistente com o resto do projeto de edge functions tipo `ml-ads`; virou 10 com meu `supabaseAdmin: any` — mesmo padrão do resto do arquivo, não é regressão de convenção).
- Teste unitário isolado da nova lógica de paginação (`fetchGroupMoves` reimplementada contra `fetch` mockado, em `/tmp/.../test-fetchGroupMoves.ts`, não commitado — script de verificação, não faz parte do código do produto): 10/10 casos passando — cobre fatura de 850 movimentos (cenário exato do bug, cabe em 1 página), 2500 movimentos (múltiplas páginas via cursor), recuperação de 429 via retry, esgotamento de retries lança erro (não falha silenciosa), e proteção contra loop infinito com `last_id` travado/repetido.

## Como deployar e verificar (PENDENTE — requer MCP Supabase)
1. `deploy_edge_function` (function_slug=`sync-ml-billing`, project_id=`ckcdevcxgvueywivefgx`) com o conteúdo atual de `supabase/functions/sync-ml-billing/index.ts`.
2. `apply_migration` com `supabase/migrations/20260684000000_sync_ml_billing_cron.sql` (project_id=`ckcdevcxgvueywivefgx`).
3. Re-disparar o sync de junho em modo SÍNCRONO para ver o resultado na hora (usa `?debug=1`, não precisa fazer polling em `net._http_response`):
   ```sql
   select net.http_post(
     url:='https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-billing?debug=1',
     headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
     body:=jsonb_build_object('ml_user_id','1639558873','period_month','2026-06','mode','daily')
   );
   -- poll net._http_response pelo request_id (o ?debug=1 ainda é síncrono na EF,
   -- então deve responder em segundos agora — mas espere ~10-30s por segurança)
   ```
4. Verificar `ml_billing_daily`:
   ```sql
   select count(distinct charge_date) as dias, sum(amount) as total_tarifas,
          sum(amount) filter (where charge_type='PADS') as pads
   from ml_billing_daily
   where organization_id='7f615df7-7bac-45e5-8a93-827fb9ddeec7'
     and ml_user_id='1639558873'
     and charge_date >= '2026-06-01' and charge_date <= '2026-06-30';
   ```
   Sucesso: `dias`≈30, `total_tarifas`≈R$75-79k (era R$34,9k/12 dias), `pads`≈R$7,5k.
5. Depois de confirmado, testar o path de background (sem `?debug=1`) e o fan-out do cron (`body:={"mode":"daily"}` sem `ml_user_id`, precisa ser chamado com o service-role token igual ao Pattern B).
6. Reportar os números REAIS de junho (tarifas totais, PADS, lucro recalculado) — não estimativas.

## Resolution (RESOLVIDO — deployado e verificado contra o banco real, 2026-07-03 ~15:06 UTC)

### Verificação real (orchestrator, MCP Supabase)
- EF `sync-ml-billing` deployada via `deploy_edge_function` → **versão 10, ACTIVE, verify_jwt=false** (auth própria preservada).
- Migration `20260684000000_sync_ml_billing_cron.sql` aplicada → cron `sync-ml-billing-prev-month` `0 8 6-12 * *` **ativo**.
- Re-sync de junho (`?debug=1`, request 32297): **SUCESSO**. `ml_billing_daily` junho passou de **12 dias / R$34.852,90** para **30 dias / R$79.723,87** (PADS R$3.534,57 → **R$8.054,90**; CVVML R$26.162,90; CFFE R$28.543,00). Sem rate-limit — cursor `from_id` resolveu.
- Smoke test do caminho **background** (sem debug=1, request 32299, usado pelo cron): **202 `{"success":true,"mode":"daily","status":"enqueued"}`** ✓.
- **Lucro real de junho:** Receita R$261.987,61 − Tarifas ML R$79.723,87 − CMV R$110.613,42 − Impostos R$53.327,05 = **R$18.323,27** (DRE antes ~R$63.194 → superestimava ~R$44.871 / ≈3,4×).
- Reconciliação: fatura real ML (get_billing_full 2026-07, ciclo 06/jun→05/jul) líquido R$73.471 / PADS R$7.548 — consistente com R$79,7k de junho-calendário (inclui 01–05/jun da fatura 2026-06).

### PENDENTE (handoff próxima sessão)
- **Layer 2 (frontend `useMLBilling.ts`) NÃO deployado** — mudança React precisa push→build Vercel. Commitado na branch `fix/sync-ml-billing-rate-limit`, aguardando Wesley aprovar push/deploy. Layer 1+3 já estão live e corrigiram junho; Layer 2 é só a melhoria do trigger on-demand.
- Validação visual de Wesley na DRE /vendas de junho (deve mostrar tarifas ~R$79,7k, lucro ~R$18,3k) — já reflete se a DRE lê `ml_billing_daily` direto (corrigido no banco).

### Caveat operacional
- `?debug=1` roda inline mas o `net.http_post` do pg_net às vezes NÃO captura a resposta HTTP (fica vazio em `net._http_response`) quando o inline excede a janela de captura — a ESCRITA no banco completa mesmo assim. Verificação manual: confie no estado de `ml_billing_daily` (synced_at/dias), não na resposta HTTP do pg_net.

## Resolution original (parcial — subagente, pré-deploy)
root_cause: Paginação por offset (PAGE=200) em `fetchGroupMoves`, agravada por uma passada de reconciliação que dobrava as chamadas, gerava chamadas sequenciais demais à API de billing do ML em faturas grandes (800+ movimentos) — estourava o rate-limit do ML no offset 800. A doc oficial do ML confirma que offset é desaconselhado para esse endpoint (recomenda cursor `from_id`/`last_id`). Combinado com dois bugs secundários — o guard do frontend só re-sincronizava mês com ZERO dados (não dados parciais) e não existia cron de re-sync — o sync ficou congelado permanentemente assim que junho deixou de ser o mês corrente.
fix: (1) `fetchGroupMoves` reescrita para paginação por cursor `from_id`/`last_id` com `limit=1000` (era offset/PAGE=200), reconciliação dupla removida, backoff aumentado, modo `daily` movido para background (`EdgeRuntime.waitUntil`) com escape-hatch `?debug=1` síncrono; fan-out multi-conta adicionado para o cron. (2) `useMLBillingDailyWithSync` passou a detectar mês fechado com coverage incompleta (não só zero dados) e fazer polling pós-trigger dado que o sync agora é assíncrono. (3) Nova migration com cron `sync-ml-billing-prev-month` (dias 6-12 do mês, Pattern B).
verification: Validação LOCAL apenas (deno check, tsc, vitest 407/407, eslint, teste unitário isolado da paginação — 10/10). Verificação CONTRA O BANCO REAL NÃO FEITA — bloqueada por falta de acesso às MCP tools do Supabase nesta sessão (subagent sem `deploy_edge_function`/`apply_migration`/`execute_sql`, sem token de CLI, sem credenciais no ambiente). Requer handoff.
files_changed:
  - supabase/functions/sync-ml-billing/index.ts (Layer 1 — não deployado)
  - src/hooks/useMLBilling.ts (Layer 2 — não deployado, é frontend então precisa de build/deploy do app também, não só da EF)
  - supabase/migrations/20260684000000_sync_ml_billing_cron.sql (Layer 3 — não aplicada)

### Evidência adicional (pesquisa API ML)
- Docs oficiais ML ("Best Practices for Consuming Billing Reports APIs", developers.mercadolibre.com.ar) confirmam: o endpoint `/billing/integration/periods/key/{key}/group/{group}/details` suporta paginação por CURSOR via `from_id` (não `offset`) + `limit` até 1000 + `sort_by=ID&order_by=ASC`. Resposta inclui `last_id` para a próxima página. ML recomenda EXPLICITAMENTE isso em vez de offset para evitar registros repetidos/perdidos entre chamadas — confirma a nota de 13/jun ("paginação por offset instável, idealmente cursor last_id").
- Consequência prática: com limit=1000 (vs PAGE=200 do código antigo), uma fatura de 800+ movimentos cabe em 1 página só → elimina o cenário que estourava o rate-limit no offset 800, e elimina a necessidade da passada de reconciliação (hack para a instabilidade do offset).

### Reasoning Checkpoint (antes do fix)
```yaml
reasoning_checkpoint:
  hypothesis: "fetchGroupMoves usa paginação por offset (PAGE=200) + uma segunda passada de reconciliação que duplica chamadas; faturas grandes (800+ movimentos) fazem >8 chamadas sequenciais à API de billing do ML, estourando o rate-limit (429) mesmo com backoff curto (800ms×4) -> after 4 retries devolve 500 'rate-limited after retries' no offset 800."
  confirming_evidence:
    - "Reprodução direta 2x: net.http_post no modo daily retorna 500 'details ML offset 800: rate-limited after retries' (request_id 32282 e 32283)."
    - "Código-fonte lido integralmente: fetchGroupMoves (linhas 82-135) confirma offset PAGE=200 + reconciliação condicional que refaz TODAS as páginas com offset deslocado +100 quando byId.size < total*0.999 -> dobra as chamadas em faturas onde a paginação por offset perde itens (comportamento que a doc do ML atribui exatamente ao uso de offset em vez de from_id)."
    - "Doc oficial ML confirma que offset é desaconselhado para este endpoint e recomenda from_id/last_id — corrobora a causa raiz sem depender de inferência."
  falsification_test: "Se o rate-limit ocorresse mesmo com from_id/limit=1000 (poucas chamadas), a causa seria throttle geral da API (não a estratégia de paginação) — precisaria backoff mais agressivo independente da paginação."
  fix_rationale: "Trocar offset->from_id (cursor) + limit=1000 reduz drasticamente o nº de chamadas por fatura (de ~9 para tipicamente 1-2) e elimina a reconciliação duplicada (que só existia para compensar a instabilidade do offset). Isso ataca a causa raiz (excesso de chamadas sequenciais), não o sintoma (aumentar apenas o backoff manteria o mesmo nº de chamadas)."
  blind_spots: "Não foi possível testar contra a API real do ML nesta sessão (sem MCP Supabase / token de deploy disponível para este agente) — a mudança de from_id/last_id foi validada contra a documentação oficial mas não empiricamente contra o endpoint real. Também não confirmado se o campo de resposta é `last_id` no topo do JSON ou aninhado em `paging.last_id` — código implementa fallback para ambos + fallback adicional via detail_id do último item."
```

