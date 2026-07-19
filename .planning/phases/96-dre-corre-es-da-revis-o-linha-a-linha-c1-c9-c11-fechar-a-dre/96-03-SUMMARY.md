---
phase: 96-dre-correcoes-linha-a-linha
plan: 03
subsystem: database
tags: [postgres, supabase, rpc, security-invoker, react-query, dre, cmv, tanstack-query]

# Dependency graph
requires:
  - phase: 41-dre-cost-waterfall
    provides: "get_cost_waterfall — o predicado (status/org/loja/data) e o fallback de receita espelhados pela RPC de gaps; a função reescrita nesta phase"
  - phase: 86-dre-competencia
    provides: "orders.custo_unit_cheio + a 7ª coluna cmv_cheio de get_cost_waterfall (drift, aplicado em prod fora do repo) — reconciliados no repo por esta migration"
  - phase: 94-dre-regime-previsao-apuracao
    provides: "resolveDreRegime + dre_month_close — o branch de apuração é o único leitor de cmv_cheio; o branch de previsão nunca lê, o que protege o SC5"
  - phase: 96-02
    provides: "src/lib/dreCloseGate.ts — o tipo CmvCheioGap e resolveCloseGate, que consomem a lista deste plano"
provides:
  - "get_cost_waterfall(uuid, text[], date, date) REESCRITA — cmv_cheio puro (sem COALESCE(cheio, médio)); maio/2026 = 126.574,59 (era 136.462,51)"
  - "get_cmv_cheio_gaps(uuid, text[], date, date) — SKUs sem custo cheio no período, com receita/unidades e flag tem_custo_medio; maio/2026 = 39 SKUs / 226 linhas / R$23.828,31 / 4 sem custo nenhum"
  - "useCmvCheioGate — hook org+lojas+range, sempre devolve array (nunca null)"
affects: [96-06-c6-frontend-gate-fechamento, 96-07-backfill-custo-cheio]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Espelhamento de predicado entre RPC de gate e RPC de agregação: o gate e o CMV precisam enxergar o MESMO conjunto de pedidos, senão o número não fecha"
    - "Reversão deliberada de decisão documentada do autor original (o COALESCE de mascaramento), registrada no header da migration com o racional do dono"

key-files:
  created:
    - supabase/migrations/20260715130000_cmv_cheio_puro_and_gaps.sql
    - src/hooks/useCmvCheioGate.ts
  modified: []

key-decisions:
  - "O COALESCE interno de cmv_cheio (cheio → médio quando NULL) foi REMOVIDO por decisão do dono: Wesley prefere bloquear o fechamento do mês a mascarar custo faltante. O autor original havia documentado o COALESCE como deliberado ('sem ele, linhas sem cost_full somariam 0 → subestimariam o CMV') — esta phase reverte essa decisão de propósito, não por engano."
  - "Só a coluna cmv_cheio muda. paid_revenue (6 consumidores) e cmv médio (a previsão, SC5) ficam byte-a-byte idênticas — provado em prod comparando as 7 colunas antes/depois."
  - "O gate mora numa RPC nova (get_cmv_cheio_gaps), não no waterfall: a previsão não pode saber da existência do gate (Pitfall 7), e a lista precisa de agregação server-side (PostgREST trunca em 1000; maio tem 1.118 pedidos)."
  - "tem_custo_medio distingue 'tem médio, falta o cheio' (35 SKUs, resolvidos pelo backfill do 96-07) de 'não tem custo nenhum' (4 SKUs que o Wesley cadastra no Tiny) — dois problemas com donos diferentes."
  - "O hook nunca devolve null: lista vazia = 'nenhum gap' (mês liberado) é estado válido e informativo, distinto de 'sem dado'. O fail-closed de carregamento é do resolveCloseGate (96-02)."

patterns-established:
  - "Migration que faz DROP FUNCTION numa função viva deve capturar a ACL ANTES e recriá-la explicitamente — o DROP apaga a ACL inteira, e os GRANTs do plano cobriam só `authenticated`"

requirements-completed: ["C6"]

# Metrics
duration: 40min
completed: 2026-07-15
status: complete
---

# Phase 96 Plan 03: C6 Backend — CMV Cheio Puro e RPC de Gaps Summary

**O `COALESCE(cheio, médio)` que mascarava custo faltante morreu na apuração — `cmv_cheio` de maio caiu de 136.462,51 para 126.574,59 (delta 9.887,92, a 2ª parcela do swing) com as outras 6 colunas do waterfall provadas idênticas em prod, e a RPC nova `get_cmv_cheio_gaps` lista os 39 SKUs exatos que bloqueiam o fechamento, distinguindo "falta o cheio" de "não tem custo nenhum".**

## Performance

- **Duração:** ~40 min
- **Tasks:** 3 (1 auto + 1 checkpoint + 1 auto)
- **Arquivos criados:** 2
- **Arquivos modificados:** 0

## Accomplishments

- **C6 provado em prod, com o número exato do CONTEXT:** `cmv_cheio` de maio/2026 = **126.574,59** (era 136.462,51). O delta de **9.887,92** reconcilia com a parcela do swing de 52.496,21 prevista pela revisão linha a linha.
- **SC5 protegido com prova, não com promessa:** as outras 6 colunas do waterfall foram medidas antes e depois da migration e são idênticas — `paid_revenue` 247.216,12, `cmv` (previsão) 113.669,33, `total_comissao` 27.340,69, `total_frete` 29.282,39, `total_tax` 50.238,196668…, `orders_count` 1.118. `/financeiro`, MCO, GoalsCard, Nexo e `useAutoRecalc` seguem intactos.
- **SC3 bate exato:** `get_cmv_cheio_gaps` devolve **39 SKUs / 226 linhas / R$23.828,31 / 4 sem custo nenhum** — igual ao alvo medido independentemente antes da phase.
- **Coerência gate × waterfall provada:** mesmo predicado, 126.574,59 e 23.828,31 conferidos contra medição externa. O gate e o CMV enxergam o mesmo conjunto de pedidos.
- **Anti-IDOR provado como role real, com controle positivo:** Thales tem 1.164 SKUs / R$5.415.362,03 nessa RPC quando lida como `postgres`; com role `authenticated` + JWT da Pé Vermeio, cross-org = **0** e controle da própria org = **39**. O zero significa alguma coisa.
- **Prova de bônus:** o waterfall reescrito roda como `authenticated` sob RLS dentro do `statement_timeout` de 8s.

## Task Commits

1. **Task 1: Migration — cmv_cheio puro + get_cmv_cheio_gaps** — `5202ee2c` (feat)
2. **Task 2: Checkpoint — numerar/aplicar/provar via MCP** — `468980b8` (chore, feito pelo orquestrador: renomeia para `20260715130000` e aplica em prod)
3. **Task 3: Hook useCmvCheioGate** — `08ca34e6` (feat)

## Files Created/Modified

- `supabase/migrations/20260715130000_cmv_cheio_puro_and_gaps.sql` — Bloco A: `get_cost_waterfall` DROP+CREATE com `cmv_cheio` puro (`COALESCE(SUM(o.custo_unit_cheio * o.quantidade), 0)`), 7 colunas preservadas, `SECURITY INVOKER` explícito. Bloco B: `get_cmv_cheio_gaps` nova, agregação por SKU com `GROUP BY` simples (sem subquery correlacionada), mesmo predicado do waterfall + `custo_unit_cheio IS NULL`. REVOKE de PUBLIC/anon + GRANT para `authenticated` nas duas.
- `src/hooks/useCmvCheioGate.ts` — hook org+lojas+range (padrão `useMLCostWaterfall`), queryKey `["ml","cmv-cheio-gaps",...]`, `substring(0,10)` nas datas, mapeamento `tem_custo_medio` → `temCustoMedio`. Re-exporta `CmvCheioGap` de `dreCloseGate.ts`. Devolve sempre array.

## Provas (não presumidas)

| Prova | Alvo | Resultado |
|---|---|---|
| PASSO 1 — reconstrução do Bloco A × `pg_get_functiondef` vivo | fidelidade campo a campo | ✅ assinatura, 7 colunas (nome/tipo/ordem), WHERE e modificadores idênticos; 2 diferenças de forma sem efeito semântico |
| PASSO 2×4 — `cmv_cheio` maio | 136.462,51 → 126.574,59 (delta 9.887,92) | ✅ exato |
| PASSO 2×4 — não-regressão das outras 6 colunas | idênticas antes/depois | ✅ 6/6 (paid_revenue 247.216,12; cmv 113.669,33; comissao 27.340,69; frete 29.282,39; tax 50.238,196668…; orders_count 1118) |
| PASSO 5 — `get_cmv_cheio_gaps` (SC3) | 39 SKUs / 226 linhas / 23.828,31 / 4 sem custo nenhum | ✅ exato |
| PASSO 6 — coerência gate × waterfall | 126.574,59 e 23.828,31 | ✅ bate com medição independente pré-phase |
| PASSO 7 — anti-IDOR (role `authenticated` + JWT real) | 0 linhas cross-org | ✅ 0 (controle positivo: Thales tem 1.164 SKUs/R$5,4M como `postgres`; controle própria org: 39) |
| PASSO 7 — timeout sob RLS | < 8s como `authenticated` | ✅ waterfall devolveu 126.574,59 |
| PASSO 8 — advisors de segurança | nenhum issue novo | ✅ WARNs restantes todos pré-existentes |
| Task 1 — critérios de grep | DROP FUNCTION 1, CREATE OR REPLACE 0, INVOKER 2, GRANT EXECUTE 2, REVOKE 2, get_cmv_cheio_gaps ≥3, orders_count ≥1 | ✅ todos |
| Task 3 — `npx tsc --noEmit` | 0 erros | ✅ |
| Task 3 — `npx vitest run` | baseline verde | ✅ 582/582 (43 arquivos) |
| Task 3 — critérios de grep | get_cmv_cheio_gaps 1, CmvCheioGap ≥2, `return null` 0, fiação prematura 0 | ✅ todos |

## Decisions Made

Nenhuma decisão nova — as do dono já vinham travadas no plano. As duas que governaram o SQL:

- **Bloquear em vez de mascarar** (Wesley): o COALESCE interno era uma decisão deliberada e documentada do autor original; foi revertida de propósito, com o racional registrado no header da migration para que ninguém o "conserte" de volta.
- **Previsão intocada:** o `cmv` médio e o `paid_revenue` não podiam se mover. Por isso a mudança foi cirúrgica (uma expressão de coluna) e o gate virou RPC separada.

## Deviations from Plan

### Achados durante a execução

**1. [Rule 2 — Funcionalidade crítica ausente do plano] `DROP FUNCTION` apaga a ACL inteira; a migration só recriava `authenticated`**
- **Encontrado durante:** Task 2 (checkpoint), pelo orquestrador, ao aplicar em prod.
- **Issue:** a ACL viva de `get_cost_waterfall` era `{PUBLIC, postgres, anon, authenticated, service_role}`. O plano mandava re-GRANT só para `authenticated` (+ REVOKE de PUBLIC/anon) — e eu segui. O `DROP FUNCTION` apaga a ACL completa, então **`service_role` (edge functions) teria sido perdido**. O plano e o RESEARCH cobriam "grants não sobrevivem ao DROP" apenas para o grant do plano, não para a ACL preexistente.
- **Resultado real:** a ACL pós-apply ficou `{postgres, authenticated, service_role}` — o `service_role` voltou sozinho pelas *default privileges* do Supabase. **Deu certo por característica da plataforma, não por desenho da migration.** O `anon` saiu, que é o endurecimento pretendido.
- **Fix aplicado:** nenhum em código (o resultado em prod está correto e verificado). Registrado como padrão para as próximas: **`DROP FUNCTION` em função existente exige capturar a ACL antes (`\dp` / `pg_proc.proacl`) e recriá-la explicitamente**, em vez de confiar nas default privileges.
- **Impacto residual:** ⚠️ Os planos **96-07/96-08** (e qualquer futuro) que façam DROP+CREATE de função viva devem aplicar esse padrão. Vale checar se alguma edge function chama `get_cost_waterfall` via `service_role` — hoje funciona, mas a dependência é implícita.

**2. [Forma] Espaço duplo em `GRANT  EXECUTE` colidia com o grep de aceite**
- **Encontrado durante:** Task 1, ao rodar os `acceptance_criteria`.
- **Issue:** copiei o alinhamento `GRANT  EXECUTE` de `20260692000000`, mas o critério usa `grep -q 'GRANT EXECUTE'` (espaço único). O SQL estava correto; o grep media a formatação. Mesma classe de achado do plano irmão 96-04.
- **Fix:** espaço único nas duas linhas de GRANT. Sem efeito semântico.
- **Committed in:** `5202ee2c`.

### Divergências de forma detectadas no PASSO 1 (aceitas, sem efeito)

A reconstrução do Bloco A foi fiel ao corpo vivo. Duas diferenças cosméticas, ambas confirmadas inócuas pelo orquestrador:
- viva `COUNT(*)` × minha `COUNT(*)::bigint` — `COUNT(*)` já retorna `bigint`.
- viva sem `SECURITY INVOKER` explícito × minha explícita — INVOKER é o default do Postgres; explicitar era instrução do plano.

---

**Total de desvios:** 1 de funcionalidade crítica (ACL do DROP, sem dano em prod, com padrão registrado); 1 ajuste de forma.
**Impacto no plano:** nenhum arquivo fora de `files_modified` foi tocado.

## Issues Encountered

- **Escrevi o Bloco A por reconstrução, não por cópia do corpo vivo.** O plano mandava escrever a migration a partir do `pg_get_functiondef` que só o orquestrador consegue capturar (não tenho MCP Supabase). Reconstruí a partir de `20260612120000` + o que CONTEXT/RESEARCH documentam sobre a 7ª coluna, e sinalizei explicitamente no header do arquivo e no checkpoint que a comparação era obrigatória antes de aplicar. O PASSO 1 confirmou fidelidade — mas o acerto foi verificado, não presumido, e é assim que deveria continuar sendo: **a fonte de verdade de uma função em drift é o banco, nunca o repo**.
- **Prova anti-IDOR exigiu controle positivo** (lição já registrada no 96-04 e repetida aqui com sucesso na primeira tentativa): o orquestrador demonstrou que Thales TEM dado nessa RPC (1.164 SKUs / R$5,4M como `postgres`) antes de o 0 cross-org significar alguma coisa.

## User Setup Required

Nenhum — sem configuração de serviço externo.

## Next Phase Readiness

**Pronto para consumo:**
- **96-06 (C6 frontend):** `useCmvCheioGate(from, to)` está pronto e devolve `CmvCheioGap[]`. Passar o **mesmo eixo de mês do waterfall** (`billingMonthFrom/To` vs `monthlyFrom/To`, resolvido pelo caller como em `useMLCostWaterfall`). O `resolveCloseGate` do 96-02 já consome `gaps` e trata `gaps === null` como fail-closed — ao ligar, lembrar que `useQuery` devolve `data: undefined` enquanto carrega, então o caller precisa mapear `data ?? null` para preservar o fail-closed.
- **96-07 (backfill):** os 39 SKUs estão listados por `get_cmv_cheio_gaps`. `tem_custo_medio = true` (35 SKUs) é o alvo do backfill; `false` (4 SKUs) depende do cadastro manual do Wesley no Tiny. 🚨 Reforço do CONTEXT: **medir o SC3 antes do backfill** — depois dele o número muda por desenho.

**Pendências/avisos fora deste plano:**
- ⚠️ **Padrão da ACL:** qualquer plano futuro com `DROP FUNCTION` em função viva deve capturar e recriar a ACL explicitamente (ver Desvio 1). Hoje `get_cost_waterfall` está com `{postgres, authenticated, service_role}` — correto, mas o `service_role` voltou por default privilege, não por instrução da migration.
- **Numeração:** `max(version)` agora é `20260715130000`. Migrations seguintes desta phase precisam numerar **acima** disso.

## Self-Check: PASSED

Artefatos verificados em disco:
- ✅ `supabase/migrations/20260715130000_cmv_cheio_puro_and_gaps.sql`
- ✅ `src/hooks/useCmvCheioGate.ts`
- ✅ arquivo provisório `2026XXXXXXXXXX_cmv_cheio_puro_and_gaps.sql` não existe mais (renomeado no checkpoint)

Commits verificados em `git log`:
- ✅ `5202ee2c` (Task 1) · ✅ `468980b8` (Task 2, orquestrador) · ✅ `08ca34e6` (Task 3)

---
*Phase: 96-dre-correcoes-linha-a-linha*
*Plan: 03*
*Completed: 2026-07-15*
