---
phase: 104-consultor-cco-dre-real-e-caixa-adicionar-tools-read-only-get
plan: 01
subsystem: api
tags: [supabase-edge-function, deno, gemini-function-calling, dre, cashflow, nexo-chat]

# Dependency graph
requires:
  - phase: 103-consultor-cco-ferramentas-de-compra-vs-venda-adicionar-tools
    provides: molde org-only de tool + testes anti-IDOR (get_replenishment/get_purchase_suppliers)
provides:
  - "4 tools read-only novas em nexo-chat/tools.ts: get_dre_result, get_dre_cash, get_projected_balance, get_taxes_paid"
  - "helper puro exportado sumGuiaReal + helper interno monthPlusOne (régua M+1 no servidor)"
  - "playbook Gabriel ampliado (2.3/2.4/2.5: competência vs caixa vs pagos, break-even de caixa, imposto guia real vs cheio)"
  - "PERSONA ampliada com as 4 tools e rótulos de veracidade DRE"
  - "suíte de testes verde: tools.test.ts (74), prompt.test.ts (23), loop.test.ts (6) = 103 testes"
affects: [105-consultor-cco-precos-competitivo-completude]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tool org-only (p_org_id do servidor, sem p_user_ids, sem param de org/seller exposto ao modelo)"
    - "régua temporal M+1 calculada no servidor (monthPlusOne), nunca aceita como input do modelo"
    - "forecast condicional ao mês corrente (gate isCurrentMonth) espelhando o hook enabled do frontend"
    - "rótulo de veracidade obrigatório embutido no retorno da tool (não só na description)"

key-files:
  created: []
  modified:
    - supabase/functions/nexo-chat/tools.ts
    - supabase/functions/nexo-chat/tools.test.ts
    - supabase/functions/nexo-chat/playbooks.ts
    - supabase/functions/nexo-chat/prompt.ts
    - supabase/functions/nexo-chat/prompt.test.ts

key-decisions:
  - "get_dre_result NÃO reimplementa a cascata completa do DRE — expõe só as deduções operacionais (get_dre_operational_by_competence) rotuladas, o modelo cruza com get_margin_summary/get_day_kpis já existentes"
  - "get_dre_cash_forecast só é chamado quando o mês pedido é o mês corrente (mesmo gate do hook useDreCashForecast), evitando forecast degenerado para mês passado"
  - "get_projected_balance usa default 120 dias (não 30, que é o default de get_treasury_panel) e SÓ 2 cenários (pessimista/realista) — corrigido o CONTEXT.md, que especulava 3 cenários (otimista inexistente)"
  - "label de get_projected_balance evita a palavra literal 'otimista' (mesmo negando-a) para não colidir com o teste de ausência de campo otimista — reformulado para 'não há um terceiro cenário'"
  - "get_taxes_paid desloca SEMPRE p_competence = monthPlusOne(mês de venda pedido) — nunca aceita a competência de guia diretamente do modelo"

requirements-completed: [CCO-DRE-RESULT, CCO-DRE-CASH, CCO-PROJ-BAL, CCO-TAXES, CCO-PLAYBOOK-G, CCO-PERSONA-DRE, CCO-TESTS-DRE]

# Metrics
duration: ~25min
completed: 2026-07-28
status: complete
---

# Phase 104 Plan 01: Consultor CCO — DRE real & caixa Summary

**4 tools read-only no Consultor (get_dre_result, get_dre_cash, get_projected_balance, get_taxes_paid) sobre 5 RPCs já em produção, com régua M+1 calculada no servidor e forecast condicional ao mês corrente — 103 testes verdes.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3/3 completos
- **Files modified:** 5

## Accomplishments
- 4 tools org-only novas em `tools.ts` (27→31 tools declaradas), todas escopadas por `p_org_id` do servidor, nenhuma passa `p_user_ids`, nenhum parâmetro sensível exposto ao modelo.
- `sumGuiaReal` exportado como helper puro (soma real de guia excluindo `status='cancelled'`, testado diretamente) e `monthPlusOne` como helper interno (régua M+1, aritmética numérica, testada incluindo virada de dezembro).
- `get_dre_result` consulta `dre_month_close` (select direto anti-IDOR) para expor `regime` (apuracao/previsao) e rotula explicitamente que NÃO é o DRE completo.
- `get_dre_cash` chama o forecast completo (Phase 100) só quando o mês pedido é o corrente, com nota sobre o falso-positivo conhecido de `alerta_recorrencia`.
- Playbook Gabriel ganhou 3 subseções (2.3/2.4/2.5) e a PERSONA ganhou os 4 rótulos de veracidade DRE, sem remover nenhuma regra/grep existente.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implementar as 4 tools de DRE real & caixa em tools.ts** - `44d6b6b6` (feat)
2. **Task 2: Testes das 4 tools em tools.test.ts** - `55ec0328` (test)
3. **Task 3: Ampliar playbook Gabriel + persona DRE + greps prompt.test.ts** - `408a7f2f` (feat)

_Note: nenhuma task teve conflito com o commit anterior; sequência linear na branch `gsd/phase-99-dre-caixa-mp`._

## Files Created/Modified
- `supabase/functions/nexo-chat/tools.ts` - 4 declarações novas em TOOL_DECLARATIONS, 4 cases novos em dispatchTool, helpers `sumGuiaReal` (exportado) e `monthPlusOne` (interno), comentário de mapeamento atualizado
- `supabase/functions/nexo-chat/tools.test.ts` - contagem 27→31, `maybeSingle()` adicionado ao stub, 12 testes novos (anti-IDOR ×4, forecast condicional ×2, default 120, sem campo otimista, M+1 ×2, sumGuiaReal ×3)
- `supabase/functions/nexo-chat/playbooks.ts` - bloco `## 2. GABRIEL` ganhou 2.3/2.4/2.5 (competência vs caixa vs pagos, break-even de caixa, imposto guia real vs cheio)
- `supabase/functions/nexo-chat/prompt.ts` - PERSONA ampliada em 4 pontos (COMO VOCÊ RACIOCINA, FONTE CERTA POR PERGUNTA, PARCIAL É ROTULADO, USO DAS FERRAMENTAS)
- `supabase/functions/nexo-chat/prompt.test.ts` - 6 testes novos provando as 4 tools + rótulos DRE na PERSONA

## Decisions Made
- Reformulei o label de `get_projected_balance` para não conter a palavra literal "otimista" (mesmo ao negá-la), pois colidia com o teste (do próprio molde do research) que assere ausência de `/optimistic|otimista/i` no resultado serializado. A veracidade (2 cenários, não 3) é preservada dizendo "não há um terceiro cenário" em vez de nomear o cenário inexistente.
- `maybeSingle()` foi adicionado ao stub de teste (`makeStub`) retornando `{ data: null, error: null }` por default — necessário porque `get_dre_result` faz um select em `dre_month_close`; nenhum teste depende do valor de `regime`, então o default (`previsao`) é suficiente e não quebra nenhuma asserção existente.
- Demais decisões seguiram o research/plano à risca (assinaturas exatas das 5 RPCs, régua M+1, forecast condicional, default 120, 2 cenários).

## Deviations from Plan

None - plan executado exatamente como escrito, com o único ajuste de redação (label sem a palavra "otimista") documentado acima em Decisions Made — não é um desvio de escopo, é a reconciliação de dois requisitos do próprio research que colidiam textualmente (rotular a ausência do 3º cenário vs. não conter a palavra "otimista"/"optimistic" em lugar nenhum do resultado).

## Issues Encountered
- Nenhum bloqueio. O único ajuste foi a reformulação do label de `get_projected_balance` descrita acima, feita durante a Task 1/2 (verificação `npx vitest run tools.test.ts`) e confirmada verde antes de prosseguir.

## Verification (resultado REAL)

```
npx vitest run supabase/functions/nexo-chat
```

```
 RUN  v3.2.4 /root/garment-glow-test

 ✓ supabase/functions/nexo-chat/prompt.test.ts (23 tests) 9ms
 ✓ supabase/functions/nexo-chat/loop.test.ts (6 tests) 12ms
 ✓ supabase/functions/nexo-chat/tools.test.ts (74 tests) 51ms

 Test Files  3 passed (3)
      Tests  103 passed (103)
```

Checagem de contrato (sanidade de assinatura das RPCs, sem drift desde o research):

```
grep -rl "get_dre_operational_by_competence(\|get_dre_cash(\|get_dre_cash_forecast(\|get_projected_balance_summary(\|get_inss_guia_by_competence(" supabase/migrations/ | sort
```

Retornou as mesmas 15 migrations citadas no 104-RESEARCH.md (20260618120000 a 20260717070000), confirmando ausência de redefinição posterior incompatível. Para `get_imposto_guia_by_competence` (drift A1, sem `CREATE FUNCTION` versionada) nenhuma migration nova foi necessária — a tool mapeia só `category`/`total`/`status`, já usados em produção pelo hook `useImpostoGuiaReal.ts`.

## User Setup Required

None - nenhuma configuração externa necessária.

## PENDENTE para o orquestrador (fora do escopo do gsd-executor)

1. **Deploy da EF `nexo-chat`** no projeto `ckcdevcxgvueywivefgx` via MCP `deploy_edge_function` (preservando `verify_jwt=true`) ou `supabase functions deploy nexo-chat --project-ref ckcdevcxgvueywivefgx`. Nenhuma migration nova é necessária.
2. **Confirmar ao vivo a assinatura de `get_imposto_guia_by_competence`** via Supabase MCP (`pg_get_functiondef('public.get_imposto_guia_by_competence'::regprocedure)`) — drift A1 documentado no research (assinatura inferida com alta confiança do clone-irmão `get_inss_guia_by_competence` + contrato do hook, mas sem `CREATE FUNCTION` versionada no repo). Se divergir dos 3 campos mapeados (`category`/`total`/`status`), reportar — não corrigir silenciosamente.

## Next Phase Readiness
- Consultor agora responde lucro real por competência, regime de caixa, saldo projetado (2 cenários) e imposto/INSS reais por guia — fecha o Grupo 2 do spec da milestone CCO.
- Fase 105 (preços/competitivo/completude) não depende desta fase, mas pode reutilizar o mesmo molde org-only.
- Bloqueado até o deploy do orquestrador: as 4 tools só existem no código, ainda não estão ativas na EF em produção.

---
*Phase: 104-consultor-cco-dre-real-e-caixa-adicionar-tools-read-only-get*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Commits `44d6b6b6`, `55ec0328`, `408a7f2f` confirmados em `git log --oneline --all`.
- Todos os 5 arquivos modificados confirmados presentes no filesystem.
- `npx vitest run supabase/functions/nexo-chat` = 103/103 testes passando (verificado novamente antes de fechar o plano).

## EXECUTION COMPLETE
