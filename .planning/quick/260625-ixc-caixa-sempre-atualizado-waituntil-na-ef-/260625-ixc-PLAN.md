---
phase: 260625-ixc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/functions/sync-mp-releases/index.ts
  - supabase/migrations/20260659000200_cashflow_crons_3h.sql
autonomous: false
requirements: [CASHFIX-03]
must_haves:
  truths:
    - "sync-mp-releases responde 202 imediato (<200ms) sem aguardar o sync — pg_net do cron nunca mais atinge timeout de ~5s"
    - "Toda a lógica de sync (loop de orgs, janelas histórica/futura, processWindow, syncOrg) roda em background via EdgeRuntime.waitUntil(runSync())"
    - "requireServiceRole permanece ANTES do waitUntil — chamada sem Bearer service_role correto ainda retorna 401"
    - "Exceção no background é capturada por try/catch com console.error completo (não morre silenciosamente)"
    - "Os DOIS crons (sync-mp-releases-daily e sync-tiny-payables-6h) rodam a cada 3h ('0 */3 * * *') mantendo os mesmos nomes de job"
    - "Liberações MP e contas a pagar persistem em cash_inflows / cash_outflows após a invocação do cron"
  artifacts:
    - path: "supabase/functions/sync-mp-releases/index.ts"
      provides: "EF sync-mp-releases reescrita com EdgeRuntime.waitUntil (202 imediato + background runSync)"
      contains: "EdgeRuntime.waitUntil"
    - path: "supabase/migrations/20260659000200_cashflow_crons_3h.sql"
      provides: "Migration que reagenda os dois crons de fluxo de caixa para 0 */3 * * *"
      contains: "0 */3 * * *"
  key_links:
    - from: "supabase/functions/sync-mp-releases/index.ts (serve handler)"
      to: "runSync()"
      via: "EdgeRuntime.waitUntil(runSync()) — sem await, retorna 202"
      pattern: "EdgeRuntime\\.waitUntil\\(runSync\\(\\)\\)"
    - from: "supabase/migrations/20260659000200_cashflow_crons_3h.sql"
      to: "EF sync-mp-releases + sync-tiny-payables"
      via: "cron.schedule net.http_post Bearer service_role_key do vault, a cada 3h"
      pattern: "0 \\*/3 \\* \\* \\*"
---

<objective>
Tornar o Caixa sempre atualizado eliminando o silent-no-write da EF `sync-mp-releases` (mesmo bug já corrigido em `sync-tiny-payables`) e aumentando a frequência dos dois crons de fluxo de caixa para a cada 3h.

Causa-raiz: `sync-mp-releases` leva ~118s, mas o `pg_net` do cron abandona a conexão aos ~5s, descartando o worker antes do commit — as liberações nunca persistem em `cash_inflows`. A solução, já provada na Phase 59 em `sync-tiny-payables`, é responder **202 imediato** via `EdgeRuntime.waitUntil(runSync())` e mover toda a lógica de sync para um background `runSync()`.

Purpose: garantir que entradas (MP) e saídas (Tiny) do caixa entrem no banco de forma confiável e atualizada de 3 em 3 horas.
Output: EF `sync-mp-releases` reescrita (estrutura waitUntil) + migration versionada reagendando os dois crons.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# IMPORTANTE: o Supabase real deste projeto é ckcdevcxgvueywivefgx (NÃO o gionpsuunfkkzzjdubfy citado no CLAUDE.md/STACK).

# EF alvo do fix (reescrever a estrutura de resposta/execução, NÃO a lógica de negócio):
@supabase/functions/sync-mp-releases/index.ts

# PADRÃO de referência JÁ aplicado e provado na Phase 59 — copiar a estrutura waitUntil/runSync/serve daqui:
@supabase/functions/sync-tiny-payables/index.ts

# Crons atuais (corpo net.http_post + Pattern B a reusar):
@supabase/migrations/20260618110000_cash_flow_cron.sql
@supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reescrever sync-mp-releases com EdgeRuntime.waitUntil (202 imediato + background runSync)</name>
  <files>supabase/functions/sync-mp-releases/index.ts</files>
  <action>
Reescrever APENAS a estrutura de resposta/execução da EF `sync-mp-releases/index.ts` seguindo EXATAMENTE o padrão já aplicado em `sync-tiny-payables/index.ts` (CASHFIX-02, Phase 59). NÃO alterar a lógica de negócio do sync — manter intactas as funções `processWindow`, `syncOrg`, `getAccessToken`, `mpGet`, `toBrtIso`, `todayStr`, `addDays`, a constante `VALID_STATUSES`, as janelas histórica/futura, dedup e o upsert em `cash_inflows` com `onConflict: "organization_id,payment_id"`.

Mudanças exatas:

1. Adicionar, logo após os imports (`serve` e `createClient`), a declaração de tipo global para satisfazer o deno check:
   `declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };`
   com comentário explicando que `EdgeRuntime` é global no runtime Supabase Edge (sem import).

2. Extrair toda a lógica que hoje vive DENTRO do callback `serve(async (req) => { ... })` — exceto o tratamento de `OPTIONS` e o `requireServiceRole` — para uma nova função de topo `async function runSync(daysBack: number, daysAhead: number): Promise<unknown>`. Essa função: cria o `sb` client, busca `tokenRows` de `ml_tokens` (`.not("refresh_token","is",null)`), itera as orgs chamando `syncOrg`, acumula `results`, e RETORNA um objeto diagnóstico (`{ ok, days_back, days_ahead, results }`). Toda essa lógica deve estar embrulhada num try/catch externo com `console.error("sync-mp-releases runSync error:", message)` no catch (Pitfall 4: exceção no background via waitUntil morre silenciosamente sem log). O catch deve retornar um diag com o erro (ex.: `{ ok: false, error: message }`) em vez de re-lançar.

3. Reescrever o handler `serve`:
   - `if (req.method === "OPTIONS") return new Response("ok"/null, { headers: CORS });` (manter o atual).
   - `const guard = requireServiceRole(req); if (guard) return guard;` — o auth permanece ANTES do waitUntil (não pode mover; mesmo princípio T-59-04 do payables).
   - Parsear o body uma única vez para extrair `days_back` (default 30) e `days_ahead` (default 45), com try/catch silencioso para body ausente — IGUAL ao atual.
   - Modo debug síncrono opcional, espelhando `sync-tiny-payables`: se `new URL(req.url).searchParams.get("debug") === "1"`, rodar `const diag = await runSync(daysBack, daysAhead); return json({ ok: true, mode: "debug-sync", diag }, 200);` — permite ao orquestrador provar a persistência inline sem depender de logs.
   - Caminho normal: `EdgeRuntime.waitUntil(runSync(daysBack, daysAhead)); return json({ ok: true, msg: "sync enqueued" }, 202);` — SEM await, 202 imediato.

Manter o cabeçalho de comentário do arquivo, adicionando uma nota CASHFIX-03 (2026-06-25) explicando: reescrito com EdgeRuntime.waitUntil (202 imediato) para eliminar o timeout do pg_net (~5s) que abortava antes dos ~118s de execução — mesmo bug do CASH-02/payables. Manter a nota de que o Supabase project é ckcdevcxgvueywivefgx.

NÃO mover `requireServiceRole`, `json`, `CORS`, nem as constantes de ambiente. NÃO mudar `verify_jwt` (já é false no config.toml). NÃO tocar em outros arquivos.
  </action>
  <verify>
    <automated>cd /root/garment-glow-test && grep -q 'EdgeRuntime.waitUntil(runSync(' supabase/functions/sync-mp-releases/index.ts && grep -q 'declare const EdgeRuntime' supabase/functions/sync-mp-releases/index.ts && grep -q '}, 202)' supabase/functions/sync-mp-releases/index.ts && grep -q 'async function runSync' supabase/functions/sync-mp-releases/index.ts && grep -q 'requireServiceRole' supabase/functions/sync-mp-releases/index.ts && grep -q 'onConflict: "organization_id,payment_id"' supabase/functions/sync-mp-releases/index.ts && echo OK</automated>
  </verify>
  <done>
A EF `sync-mp-releases/index.ts` declara `EdgeRuntime`, define `async function runSync(...)` com try/catch + console.error no background, e o handler `serve` mantém `requireServiceRole` ANTES de `EdgeRuntime.waitUntil(runSync(...))` retornando 202. A lógica de negócio (janelas, processWindow/syncOrg, upsert em cash_inflows onConflict organization_id,payment_id) permanece inalterada. Modo `?debug=1` roda runSync inline e devolve o diag.
  </done>
</task>

<task type="auto">
  <name>Task 2: Migration reagendando os dois crons de fluxo de caixa para a cada 3h</name>
  <files>supabase/migrations/20260659000200_cashflow_crons_3h.sql</files>
  <action>
Criar NOVA migration versionada `supabase/migrations/20260659000200_cashflow_crons_3h.sql` que reagenda os DOIS crons de fluxo de caixa de `0 7 * * *` / `0 */6 * * *` para `0 */3 * * *` (a cada 3h), reusando o MESMO corpo `net.http_post` (Pattern B, Bearer service_role_key via `vault.decrypted_secrets`) das migrations atuais. NUNCA via SQL Editor — só esta migration versionada (regra `feedback_no_drift_via_sql_editor`). Manter os MESMOS nomes de job: `sync-mp-releases-daily` e `sync-tiny-payables-6h`.

Estrutura (espelhar exatamente as duas migrations de cron atuais):

Cabeçalho de comentário explicando: CASHFIX-03 (2026-06-25) — Caixa sempre atualizado: ambos os crons passam a rodar a cada 3h ('0 */3 * * *'). Manter os mesmos nomes de job (não recriar com nomes novos — só re-schedule). Pré-requisito Pattern B (vault.secrets name='service_role_key' com sb_secret_*) já satisfeito pelas migrations 20260618110000 e 20260618115000. Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).

Bloco 1 — sync-mp-releases-daily:
  - `DO $$ BEGIN PERFORM cron.unschedule('sync-mp-releases-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`
  - `SELECT cron.schedule('sync-mp-releases-daily', '0 */3 * * *', $cmd$ ... $cmd$);` com o corpo `net.http_post` IDÊNTICO ao da migration 20260618110000 (url .../functions/v1/sync-mp-releases, headers com Content-Type + Authorization 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1), body '{}'::jsonb).

Bloco 2 — sync-tiny-payables-6h:
  - `DO $$ BEGIN PERFORM cron.unschedule('sync-tiny-payables-6h'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`
  - `SELECT cron.schedule('sync-tiny-payables-6h', '0 */3 * * *', $cmd$ ... $cmd$);` com o corpo `net.http_post` IDÊNTICO ao da migration 20260618115000 (url .../functions/v1/sync-tiny-payables, mesmos headers/body).

Manter os nomes de job `sync-tiny-payables-6h` mesmo agora rodando a cada 3h (renomear quebraria a continuidade do unschedule idempotente em re-runs e foi travado pelo Wesley). Usar dollar-quoting `$cmd$ ... $cmd$` para os corpos (não aspas simples), idêntico às migrations de referência.
  </action>
  <verify>
    <automated>cd /root/garment-glow-test && test -f supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -c "0 \*/3 \* \* \*" supabase/migrations/20260659000200_cashflow_crons_3h.sql | grep -qx 2 && grep -q "cron.schedule('sync-mp-releases-daily'" supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -q "cron.schedule('sync-tiny-payables-6h'" supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -q "cron.unschedule('sync-mp-releases-daily')" supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -q "cron.unschedule('sync-tiny-payables-6h')" supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -q "functions/v1/sync-mp-releases" supabase/migrations/20260659000200_cashflow_crons_3h.sql && grep -q "functions/v1/sync-tiny-payables" supabase/migrations/20260659000200_cashflow_crons_3h.sql && echo OK</automated>
  </verify>
  <done>
A migration `20260659000200_cashflow_crons_3h.sql` existe e contém exatamente 2 ocorrências de `0 */3 * * *`, faz unschedule + schedule dos jobs `sync-mp-releases-daily` e `sync-tiny-payables-6h` (mesmos nomes), reusando o corpo `net.http_post` com Bearer service_role_key do vault apontando para as duas EFs.
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 3: Checkpoint do orquestrador — deploy da EF + apply da migration</name>
  <action>O ORQUESTRADOR (não o gsd-executor) deploya a EF sync-mp-releases via MCP deploy_edge_function (verify_jwt=false) e aplica a migration 20260659000200_cashflow_crons_3h.sql via MCP apply_migration no projeto ckcdevcxgvueywivefgx. O executor PARA aqui — não tem token/MCP.</action>
  <what-built>
Tarefa 1 reescreveu a EF `sync-mp-releases` (202 + waitUntil) e Tarefa 2 criou a migration `20260659000200_cashflow_crons_3h.sql` (dois crons a cada 3h). Nenhuma das duas ainda foi deployada/aplicada — o gsd-executor NÃO tem token/MCP de deploy.
  </what-built>
  <how-to-verify>
O ORQUESTRADOR (não o executor) executa, no projeto ckcdevcxgvueywivefgx:

1. Deploy da EF via MCP Supabase `deploy_edge_function` com `verify_jwt=false`, name `sync-mp-releases`, enviando o conteúdo de `supabase/functions/sync-mp-releases/index.ts`.
2. Apply da migration via MCP Supabase `apply_migration` com o conteúdo de `supabase/migrations/20260659000200_cashflow_crons_3h.sql` (NUNCA via SQL Editor — regra feedback_no_drift_via_sql_editor).

Confirmar que ambas as operações retornaram sucesso antes de prosseguir para a prova (Task 4).
  </how-to-verify>
  <resume-signal>Digite "deployed" quando a EF estiver deployada e a migration aplicada, ou descreva o erro retornado pelo MCP.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Checkpoint de prova — 202 + persistência em cash_inflows + crons a 3h + auth 401</name>
  <action>O ORQUESTRADOR prova a correção: invoca a EF em modo ?debug=1 (espera upserted>0), invoca normal (espera 202 + linhas novas em cash_inflows), confirma cron.job em '0 */3 * * *' para os dois jobs, e confirma 401 sem Bearer service_role.</action>
  <what-built>
EF `sync-mp-releases` deployada (202 + waitUntil) e crons reagendados para 3h. Esta é a prova de que o silent-no-write foi resolvido e o agendamento está ativo.
  </what-built>
  <how-to-verify>
O ORQUESTRADOR executa as provas no projeto ckcdevcxgvueywivefgx:

1. PROVA 202 + persistência (síncrona): invocar a EF em modo debug — `POST https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-mp-releases?debug=1` com header `Authorization: Bearer <service_role_key>`. Esperado: HTTP 200 com `{ ok: true, mode: "debug-sync", diag: { results: [...] } }` onde os results trazem `upserted > 0` para pelo menos uma org com liberações no período.
2. PROVA 202 (assíncrona): invocar `POST .../functions/v1/sync-mp-releases` (sem ?debug) com o mesmo Bearer. Esperado: HTTP 202 com `{ ok: true, msg: "sync enqueued" }` em <1s (sem timeout). Aguardar ~2min e confirmar novas linhas em `cash_inflows` (consulta MCP `execute_sql`: `SELECT count(*), max(synced_at) FROM cash_inflows;` — synced_at recente).
3. PROVA cron agendado: via MCP `execute_sql` rodar `SELECT jobname, schedule FROM cron.job WHERE jobname IN ('sync-mp-releases-daily','sync-tiny-payables-6h');` — ambos devem retornar schedule `0 */3 * * *`.
4. PROVA auth: invocar a EF SEM Bearer service_role (ex.: sem header Authorization) — esperado HTTP 401 (guard requireServiceRole intacto).
  </how-to-verify>
  <resume-signal>Digite "approved" quando: debug-sync mostrou upserted>0, a chamada normal retornou 202, cash_inflows recebeu linhas novas, ambos os crons estão em '0 */3 * * *' e a chamada sem auth retornou 401. Caso contrário, descreva o diag/erro.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pg_cron → EF (HTTP) | Cron chama a EF via net.http_post com Bearer service_role_key do vault |
| Caller → EF sync-mp-releases | Entrada não confiável; guard requireServiceRole exige Bearer service_role exato |
| EF → Mercado Pago API | Token OAuth ML/MP de ml_tokens; resposta externa não confiável |
| EF (background) → Postgres | waitUntil(runSync) escreve em cash_inflows via service role |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ixc-01 | Spoofing | serve handler sync-mp-releases | mitigate | requireServiceRole permanece ANTES do EdgeRuntime.waitUntil — chamada sem Bearer service_role retorna 401 (provado no checkpoint Task 4, passo 4) |
| T-ixc-02 | Information Disclosure | modo ?debug=1 | accept | debug-sync exige o mesmo Bearer service_role (guard roda antes); diag não expõe segredos, só contagens/datas. Sem PII de terceiros |
| T-ixc-03 | Denial of Service | background runSync (~118s) | mitigate | 202 imediato libera o pg_net (<200ms); try/catch externo evita crash silencioso; rate-limit gentil (150ms entre páginas) já presente na lógica de negócio (inalterada) |
| T-ixc-04 | Tampering | migration de cron | mitigate | aplicada SOMENTE via MCP apply_migration (migration versionada), nunca SQL Editor (feedback_no_drift_via_sql_editor); Pattern B lê o segredo do vault, não hardcoded |
| T-ixc-SC | Tampering | npm/deno installs | accept | Nenhuma dependência nova adicionada — reusa imports já presentes (deno std http/server, esm.sh supabase-js). Sem install novo |
</threat_model>

<verification>
- `grep` confirma que a EF tem `declare const EdgeRuntime`, `async function runSync`, `EdgeRuntime.waitUntil(runSync(` e `}, 202)` (Task 1).
- `grep` confirma `requireServiceRole` ainda presente no handler e `onConflict: "organization_id,payment_id"` preservado (lógica de negócio intacta).
- A migration contém exatamente 2 ocorrências de `0 */3 * * *`, com unschedule+schedule dos dois jobs pelos mesmos nomes e net.http_post para as duas EFs (Task 2).
- Checkpoint do orquestrador: deploy_edge_function (verify_jwt=false) + apply_migration retornaram sucesso (Task 3).
- Checkpoint de prova: debug-sync com upserted>0, chamada normal 202, cash_inflows com linhas novas, `cron.job` mostra '0 */3 * * *' para ambos, e 401 sem auth (Task 4).
</verification>

<success_criteria>
- A EF `sync-mp-releases` responde 202 imediato e persiste liberações em `cash_inflows` em background, sem o timeout de ~5s do pg_net.
- A lógica de negócio do sync (janelas, dedup, upsert) permanece byte-equivalente em comportamento — só a estrutura de resposta/execução mudou.
- Os dois crons (`sync-mp-releases-daily`, `sync-tiny-payables-6h`) rodam a cada 3h via migration versionada, sem drift (SQL Editor não usado).
- Entradas (MP) e saídas (Tiny) do Caixa ficam atualizadas de 3 em 3 horas.
</success_criteria>

<output>
Create `.planning/quick/260625-ixc-caixa-sempre-atualizado-waituntil-na-ef-/260625-ixc-SUMMARY.md` when done
</output>
