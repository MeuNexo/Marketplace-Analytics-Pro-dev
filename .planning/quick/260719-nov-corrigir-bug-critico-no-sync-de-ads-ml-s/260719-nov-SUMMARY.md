---
phase: quick-260719-nov
plan: 01
subsystem: infra
tags: [deno, edge-functions, supabase, ads, sync, cache, error-handling]

# Dependency graph
requires: []
provides:
  - "sync-ads/index.ts: deletes de cache movidos para depois do fetch bem-sucedido + throw em fetchError"
  - "process-sync-job/index.ts: branch ads valida adsBody.results por erro antes de marcar completed"
affects: [sync-ads, process-sync-job, sync_jobs pipeline, ml_ads_products_cache, ml_ads_daily_cache]

# Tech tracking
tech-stack:
  added: []
  patterns: ["fetch-then-delete-then-upsert (nunca delete-then-fetch)", "inspecionar corpo da resposta antes de marcar sync_job completed (mesmo padrão do branch orders)"]

key-files:
  created: []
  modified:
    - supabase/functions/sync-ads/index.ts
    - supabase/functions/process-sync-job/index.ts

key-decisions:
  - "Deploy das duas edge functions NÃO foi possível pelo executor (sem MCP Supabase, CLI instalado mas sem SUPABASE_ACCESS_TOKEN) — fica pendente para o orquestrador/Wesley"

patterns-established:
  - "Toda edge function que faz DELETE+upsert de cache por período deve rodar o DELETE só depois do fetch externo confirmado com sucesso"
  - "process-sync-job deve inspecionar o corpo de QUALQUER sub-função chamada (não só resp.ok) antes de marcar completed — padrão já usado em orders, agora replicado em ads"

requirements-completed: [ADS-SYNC-FIX-01, ADS-SYNC-FIX-02]

# Metrics
duration: ~15min
completed: 2026-07-19
status: complete
---

# Quick Task 260719-nov: Corrigir bug crítico no sync de Ads do Mercado Livre Summary

**Deletes de cache de ads reordenados para depois do fetch bem-sucedido + branch ads de process-sync-job agora inspeciona o corpo da resposta antes de marcar completed — falha de sync não mais zera o cache silenciosamente nem reporta o cron job como sucesso**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 de 3 completos (deploy pendente — ver abaixo)
- **Files modified:** 2

## Accomplishments

- **Causa 1 corrigida (`sync-ads/index.ts`):** os dois `DELETE` de `ml_ads_products_cache`/`ml_ads_daily_cache` que rodavam ANTES do loop de busca na API do ML foram removidos daquele ponto. Agora uma variável `fetchError` é setada no `catch` do loop (em vez do `break` silencioso engolir o erro), e logo após o fim do loop, se `fetchError` estiver setado, a função lança `throw new Error(...)` — isso propaga para o `catch` por-usuário já existente no handler principal (`results.push({ ml_user_id, error: e.message })`), preservando o cache existente porque os `DELETE`s (agora reposicionados para depois do `throw`, antes da montagem de `dailyRows`) nunca são alcançados em caso de falha.
- **Causa 2 corrigida (`process-sync-job/index.ts`, branch `ads`):** antes só checava `resp.ok` (HTTP 200) antes de marcar `completed`. Agora, seguindo exatamente o padrão já usado no branch `orders` (`orderBody?.success === false`), faz `adsBody = await resp.json()`, filtra `adsBody.results` por itens com campo `error`, e se houver algum, lança `throw new Error("sync-ads reportou erro em N usuário(s): ...")` — isso é capturado pelo `catch` externo do arquivo, que marca o `sync_job` como `failed` com `error_msg`, em vez de `completed` falsamente.
- Comportamento de sucesso do sync-ads permanece idêntico: fetch bem-sucedido → delete do período (mesmos filtros `.eq("ml_user_id", mlUserId).gte("date", dateFrom).lte("date", dateTo)`, mesma ordem products→daily) → upsert (dailyRows/productRows) sem alteração.
- Escopo restrito aos dois arquivos indicados no plano; nenhum outro `job_type` (`orders`/`inventory`/`daily_cache`/default) foi tocado.
- `deno check` limpo em ambos os arquivos (sem suíte de testes automatizada neste projeto para edge functions Deno, conforme já confirmado no plano).

## Task Commits

Each task was committed atomically:

1. **Task 1: Reordenar deletes e propagar erro de fetch em sync-ads** - `bf18766c` (fix)
2. **Task 2: Checar erros no corpo da resposta no branch ads de process-sync-job** - `fb1aa1d2` (fix)
3. **Task 3: Deployar as duas edge functions corrigidas em produção** - NÃO EXECUTADO pelo executor (ver "Deploy Pendente" abaixo)

## Files Created/Modified

- `supabase/functions/sync-ads/index.ts` - `syncUser`: deletes de cache movidos para depois do loop de fetch + `fetchError`/`throw` propagando falha de fetch antes de qualquer delete
- `supabase/functions/process-sync-job/index.ts` - branch `ads`: parse de `adsBody.results`, filtro por `error`, `throw` quando há usuário(s) com erro, replicando o padrão do branch `orders`

## Decisions Made

- Nenhuma decisão de arquitetura nova — implementação seguiu exatamente o padrão já estabelecido no branch `orders` de `process-sync-job` (já citado no plano como referência).

## Deviations from Plan

None - plan executado exatamente como escrito para as Tasks 1 e 2. A Task 3 (deploy) não pôde ser concluída pelo executor por falta de ferramenta de deploy disponível — ver seção seguinte, conforme instrução explícita do plano para este caso.

## Deploy Pendente (Task 3)

**Nenhuma ferramenta de deploy estava acessível a este executor:**
- MCP Supabase (`deploy_edge_function`) não está disponível nas tools deste agente executor.
- Supabase CLI está instalado (`supabase 2.101.0` em `/usr/bin/supabase`), mas **não autenticado** — `supabase projects list` retornou: `Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.` A variável `SUPABASE_ACCESS_TOKEN` não está setada no ambiente do executor.

**O código está corrigido e commitado** (`bf18766c` + `fb1aa1d2`), validado com `deno check` (0 erros), mas o **DEPLOY MANUAL ainda está pendente**. O orquestrador (que tem acesso ao MCP `mcp__claude_ai_Supabase__deploy_edge_function` para o projeto `ckcdevcxgvueywivefgx`) deve:

1. Deployar `sync-ads` (manter `verify_jwt` atual — auth in-code via service-role, config.toml não precisa mudar)
2. Deployar `process-sync-job` (manter `verify_jwt = false` em config.toml — NÃO alterar, pg_cron não tem JWT de usuário real)

Comandos CLI equivalentes, caso o orquestrador/Wesley prefira essa via (requer `supabase login` ou `SUPABASE_ACCESS_TOKEN` válido antes):
```
supabase functions deploy sync-ads --project-ref ckcdevcxgvueywivefgx
supabase functions deploy process-sync-job --project-ref ckcdevcxgvueywivefgx
```

**Prova pós-deploy recomendada** (a ser feita por quem deployar): disparar um `sync_job` de ads e conferir (a) que `results` traz counts > 0 para Pé Vermeio (seller 1639558873), OU (b) injetar uma falha (ex: revogar temporariamente o token ML de um `ml_user_id` de teste) e conferir que o `sync_job` correspondente é marcado `failed` com `error_msg` preenchido, não `completed`.

## Issues Encountered

Nenhum problema durante a implementação em si. O único item não resolvido é o deploy (esperado — o executor não tem credenciais/MCP de Supabase, conforme já antecipado no próprio plano).

## User Setup Required

None - não há configuração de serviço externo. Apenas o deploy manual descrito acima (ação do orquestrador, não do usuário).

## Next Phase Readiness

- Código pronto para deploy imediato assim que o orquestrador rodar `deploy_edge_function` para `sync-ads` e `process-sync-job` no projeto `ckcdevcxgvueywivefgx`.
- Depois do deploy, recomenda-se monitorar o próximo ciclo de cron de ads (4x/dia) e conferir se `ml_ads_products_cache`/`ml_ads_daily_cache` voltam a ter dados frescos para a conta Pé Vermeio (zerada desde 2026-07-15 segundo o diagnóstico do plano).

---
*Phase: quick-260719-nov*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: supabase/functions/sync-ads/index.ts
- FOUND: supabase/functions/process-sync-job/index.ts
- FOUND: .planning/quick/260719-nov-corrigir-bug-critico-no-sync-de-ads-ml-s/260719-nov-SUMMARY.md
- FOUND: commit bf18766c (Task 1)
- FOUND: commit fb1aa1d2 (Task 2)
