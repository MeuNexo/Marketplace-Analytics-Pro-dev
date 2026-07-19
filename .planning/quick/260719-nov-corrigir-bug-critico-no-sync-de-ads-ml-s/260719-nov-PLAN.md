---
phase: quick-260719-nov
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/functions/sync-ads/index.ts
  - supabase/functions/process-sync-job/index.ts
autonomous: true
requirements: [ADS-SYNC-FIX-01, ADS-SYNC-FIX-02, ADS-SYNC-DEPLOY]
must_haves:
  truths:
    - "Quando a busca de items de ads na API do ML falha, o cache existente (ml_ads_products_cache / ml_ads_daily_cache) é preservado — os DELETEs nunca rodam"
    - "Um erro na busca de items propaga como throw para o catch por-usuário do handler, que registra {ml_user_id, error} em results"
    - "Um sync de ads com sucesso continua deletando o período e reescrevendo (upsert) idêntico ao comportamento atual"
    - "process-sync-job marca o sync_job de ads como 'failed' (não 'completed') quando algum usuário retorna error no corpo da resposta de sync-ads"
    - "As duas edge functions corrigidas ficam deployadas em produção (projeto ckcdevcxgvueywivefgx)"
  artifacts:
    - path: "supabase/functions/sync-ads/index.ts"
      provides: "syncUser com deletes movidos para depois do loop de fetch + throw em fetchError"
      contains: "fetchError"
    - path: "supabase/functions/process-sync-job/index.ts"
      provides: "branch ads que inspeciona adsBody.results por erros antes de completar"
      contains: "adsBody"
  key_links:
    - from: "supabase/functions/sync-ads/index.ts"
      to: "handler catch por-usuário (results.push error)"
      via: "throw new Error após loop quando fetchError setado"
      pattern: "throw new Error"
    - from: "supabase/functions/process-sync-job/index.ts"
      to: "catch externo que marca sync_job failed"
      via: "throw quando adsBody.results contém item com error"
      pattern: "adsBody\\?\\.results"
---

<objective>
Corrigir bug crítico no sync de Ads do Mercado Livre que zera o cache de ads de forma silenciosa e reporta os cron jobs como bem-sucedidos.

Diagnóstico confirmado via SQL direto no Supabase (projeto `ckcdevcxgvueywivefgx`): desde 2026-07-15 o cache de ads está zerado para a conta Pé Vermeio (seller 1639558873), mesmo com os cron jobs 4x/dia marcados como "succeeded".

Causa 1 (`sync-ads/index.ts`): os dois `DELETE` de cache rodam ANTES do loop de busca na API do ML. Quando a busca falha, o `catch { break; }` engole o erro; a função segue com listas vazias, não faz upsert, e o resultado é cache apagado sem reposição, sem erro lançado.

Causa 2 (`process-sync-job/index.ts`, branch `ads`): só checa `resp.ok` (HTTP 200) antes de marcar o job como `completed` — nunca inspeciona o corpo para ver se algum usuário teve erro. O branch `orders` já tem o padrão correto (checa `orderBody?.success === false` e lança antes de completar).

Purpose: Restaurar a confiabilidade do pipeline de ads — falha de sync deve preservar o cache existente e refletir como job `failed`, não `completed`.
Output: Duas edge functions corrigidas e deployadas em produção.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@supabase/functions/sync-ads/index.ts
@supabase/functions/process-sync-job/index.ts

Nota de infra: não há suíte de testes automatizados para edge functions Deno neste projeto (confirmado). A verificação é por inspeção estática (tsc/lint quando aplicável) + prova de comportamento pós-deploy. O projeto Supabase de produção é `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md — esse está desatualizado para este trabalho de ops).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Reordenar deletes e propagar erro de fetch em sync-ads</name>
  <files>supabase/functions/sync-ads/index.ts</files>
  <action>
Na função `syncUser`:

1. REMOVER as duas linhas de DELETE que hoje rodam ANTES do loop (as chamadas `sb.from("ml_ads_products_cache").delete()...` e `sb.from("ml_ads_daily_cache").delete()...` que estão logo após a resolução de `syncedAt`, junto ao comentário "Limpa dados existentes do período").

2. No loop `while (true)` de busca de items, declarar antes do loop uma variável `let fetchError: string | null = null;`. Trocar o bloco `catch (e) { console.warn(...); break; }` por: capturar a mensagem em `fetchError` (ex: `fetchError = String(e).slice(0, 200);`), manter o `console.warn` para observabilidade, e então `break;`.

3. Imediatamente APÓS o fim do loop `while (true)` (antes da montagem de `dailyRows`), adicionar: se `fetchError` estiver setado, `throw new Error("sync-ads fetch items failed para ml_user_id=" + mlUserId + ": " + fetchError);`. Isso deve propagar para o `catch (e: any)` por-usuário já existente no handler principal (que faz `results.push({ ml_user_id, error: e.message })`), preservando o cache existente porque os deletes nunca serão alcançados.

4. INSERIR as duas linhas de DELETE (products + daily) removidas no passo 1 logo após o `throw` de fetchError e antes de montar `dailyRows` — ou seja: fetch bem-sucedido → delete do período → upsert. Manter os mesmos filtros exatos (`.eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo)`) e a mesma ordem (products antes de daily) do código original.

Não alterar o bloco de campanhas nem a lógica de upsert (dailyRows/productRows) — comportamento de sucesso deve ficar idêntico ao atual, apenas com deletes reposicionados.
  </action>
  <verify>
    <automated>grep -n "fetchError" supabase/functions/sync-ads/index.ts && grep -n "throw new Error(\"sync-ads fetch items failed" supabase/functions/sync-ads/index.ts && awk '/let fetchError/{f=NR} /ml_ads_products_cache\").delete\(\)/{d=NR} END{ if (d>f) print "OK delete-after-fetchError:"d; else print "FAIL"}' supabase/functions/sync-ads/index.ts</automated>
  </verify>
  <done>Os dois DELETE de cache aparecem no código DEPOIS da declaração de `fetchError` e do `throw`; a variável `fetchError` é setada no catch do loop; falha de fetch lança erro (não faz break silencioso seguido de deletes).</done>
</task>

<task type="auto">
  <name>Task 2: Checar erros no corpo da resposta no branch ads de process-sync-job</name>
  <files>supabase/functions/process-sync-job/index.ts</files>
  <action>
No branch `else if (job.job_type === "ads")`, seguir exatamente o padrão já usado no branch `orders` (que checa `orderBody?.success === false`):

Após o bloco `if (!resp.ok) { ... throw ... }` existente e ANTES do `.update({ status: "completed" ... })`, inserir:

1. `const adsBody = await resp.json().catch(() => ({} as any));`
2. Verificar se algum item do array `adsBody?.results` tem campo `error` preenchido. Ex: `const failed = Array.isArray(adsBody?.results) ? adsBody.results.filter((r: any) => r?.error) : [];`
3. Se `failed.length > 0`, montar uma lista concatenada dos erros (ex: `failed.map((r: any) => r.ml_user_id + ": " + r.error).join("; ")`) e `throw new Error("sync-ads reportou erro em " + failed.length + " usuário(s): " + <lista>);`

Isso faz o catch externo já existente no arquivo marcar o `sync_job` como `"failed"` com `error_msg`, em vez de `"completed"` falsamente. Não tocar em nenhum outro job_type (orders/inventory/daily_cache/default permanecem intactos).
  </action>
  <verify>
    <automated>grep -n "adsBody" supabase/functions/process-sync-job/index.ts && grep -n 'throw new Error("sync-ads reportou erro' supabase/functions/process-sync-job/index.ts</automated>
  </verify>
  <done>O branch `ads` faz parse do corpo de sync-ads, filtra `results` por `error`, e lança erro (marcando o job como `failed`) quando há qualquer usuário com erro; outros job_types intactos.</done>
</task>

<task type="auto">
  <name>Task 3: Deployar as duas edge functions corrigidas em produção</name>
  <files>supabase/functions/sync-ads/index.ts, supabase/functions/process-sync-job/index.ts</files>
  <action>
Deployar as duas edge functions atualizadas no projeto Supabase de produção `ckcdevcxgvueywivefgx`:

1. `sync-ads`
2. `process-sync-job`

Ordem de preferência das ferramentas:
- Se houver MCP Supabase disponível ao executor, usar `deploy_edge_function` (project `ckcdevcxgvueywivefgx`) para cada função, mantendo o mesmo `verify_jwt` atual (ambas usam auth in-code via service-role; `process-sync-job` tem `verify_jwt = false` em config.toml — NÃO alterar isso).
- Se não houver MCP, tentar via Supabase CLI: `supabase functions deploy sync-ads --project-ref ckcdevcxgvueywivefgx` e `supabase functions deploy process-sync-job --project-ref ckcdevcxgvueywivefgx` (requer token/login do Wesley).

Se NENHUMA ferramenta de deploy estiver acessível ao executor, NÃO falhar o plano silenciosamente: documentar explicitamente no SUMMARY.md que o código está corrigido e commitado mas o DEPLOY MANUAL ainda está pendente, listando os dois comandos exatos acima para o orquestrador/Wesley executarem depois.

Registrar no SUMMARY.md: qual método foi usado, se o deploy foi confirmado, e (se possível) uma prova pós-deploy — ex: disparar um `sync_job` de ads e conferir que `results` traz counts > 0 para Pé Vermeio OU que uma falha injetada marca o job como `failed` (não `completed`).
  </action>
  <verify>
    <automated>MISSING — passo de infra/deploy; verificação é manual/documentada no SUMMARY.md (não há suíte automatizada de deploy neste projeto)</automated>
  </verify>
  <done>Ambas as edge functions deployadas em `ckcdevcxgvueywivefgx` via MCP ou CLI, com o método e a prova (ou a pendência de deploy manual) documentados no SUMMARY.md.</done>
</task>

</tasks>

<verification>
- `grep -n "fetchError" supabase/functions/sync-ads/index.ts` retorna a declaração e o uso no catch do loop.
- Os dois DELETE de cache aparecem no arquivo em posição posterior ao `throw` de fetchError (delete só após fetch bem-sucedido).
- `grep -n "adsBody" supabase/functions/process-sync-job/index.ts` mostra o parse do corpo e o filtro por `error` no branch ads.
- Comportamento de sucesso do sync-ads inalterado (mesma montagem de dailyRows/productRows/upsert).
- Deploy das duas functions documentado no SUMMARY.md (feito, ou pendência manual explícita).
</verification>

<success_criteria>
- Falha na busca de items do ML preserva o cache existente (deletes nunca alcançados) e propaga erro para `results` do handler.
- Sync de ads com sucesso segue idêntico: delete do período + upsert.
- `sync_job` de ads é marcado `failed` (com `error_msg`) quando algum usuário retorna erro, em vez de `completed` falso.
- Escopo restrito aos dois arquivos; nenhum outro job_type alterado.
- Edge functions deployadas em `ckcdevcxgvueywivefgx` ou pendência de deploy manual claramente registrada.
</success_criteria>

<output>
Create `.planning/quick/260719-nov-corrigir-bug-critico-no-sync-de-ads-ml-s/260719-nov-SUMMARY.md` when done
</output>