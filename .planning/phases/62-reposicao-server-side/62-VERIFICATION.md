---
phase: 62-reposicao-server-side
verified: 2026-06-25T21:10:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "Tabela replenishment_params com override por fornecedor (precedência marca > fornecedor > global)"
    addressed_in: "v2 — fora do escopo v1"
    evidence: "CONTEXT.md Phase 62 decisões: 'scope IN (global, marca) — fornecedor reservado para v2 (fora do escopo v1)'; migration 20260662000000 documenta isso explicitamente; verificação_focus lista como 'decisão travada' a honrar"
---

# Phase 62: Reposição Server-Side Verification Report

**Phase Goal:** A "Compra Recomendada" deixa de calcular no front com estoque digitado e venda simulada, e passa a sair de uma RPC `get_replenishment` server-side que usa estoque real (`ml_inventory_cache`, Full+anúncios), venda/dia real, modelo de ponto de reposição (lead time + meta de cobertura + estoque de segurança) com gatilho, MOQ/embalagem e tratamento de custo nulo/sem-giro — parametrizável global + por marca. Não sugere mais comprar o que já se tem.
**Verified:** 2026-06-25T21:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                             | Status     | Evidence                                                                                                  |
|----|---------------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------------------|
| 1  | RPC `get_replenishment` em prod (SECURITY INVOKER, sem `org_id` em parâmetro) retorna colunas corretas | VERIFIED  | Migration `20260662000100` aplicada em `ckcdevcxgvueywivefgx`; 116 linhas Pé Vermeio; cross-org=0 (anti-IDOR provado via SQL do orquestrador) |
| 2  | Sugestão > 0 somente quando `estoque_atual ≤ ponto_reposicao`                                    | VERIFIED   | SQL: `WHEN available_quantity > ponto → 0`; 87 itens acima do ponto retornaram compra=0 em prod; teste REPL-04 verde |
| 3  | Venda/dia de vendas REAIS (`ml_product_daily_cache`); `venda_dia=0` → compra 0 + flag `sem_giro` | VERIFIED   | CTE `sales` usa `ml_product_daily_cache`; 41 sem_giro em prod; SQL: `WHEN avg_daily=0 THEN 0`; teste REPL-08 verde |
| 4  | `replenishment_params` com override marca > global > hardcoded; MOQ e pack respeitados           | VERIFIED   | Table com `scope IN ('global','marca')`; COALESCE marca>global>30/60/7/1/1; `GREATEST(CEIL(nec/pack)×pack, moq)`; testes REPL-05/06 verdes |
| 5  | Custo nulo → quantidade sugerida, valor omitido, `custo_ausente`; aviso fixo "a chegar" na tela  | VERIFIED   | SQL: `valor_estimado=NULL` quando `cost_val IS NULL`; 44 custo_ausente em prod; `ReplenishmentPanel.tsx` ln 114–121 tem Alert de limitação v1 |
| 6  | Tela `/estoque` consome a RPC — colunas read-only sem inputs digitados                           | VERIFIED   | `MLEstoque.tsx` ln 1411–1413: `<TabsContent value="compra"><ReplenishmentPanel /></TabsContent>`; sem inputs editáveis; 9 colunas read-only da fonte |
| 7  | Testes unitários da fórmula verdes; sem regressão de build                                       | VERIFIED   | 10/10 testes `replenishmentUtils.test.ts`; 203/203 total vitest; `tsc --noEmit` limpo; build verde (62-03-SUMMARY confirma) |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

---

### Deferred Items

Items intencionalmente fora do escopo v1 — documentados em CONTEXT.md como decisões travadas com Wesley.

| # | Item                                                            | Addressed In | Evidence                                                                                                |
|---|-----------------------------------------------------------------|--------------|---------------------------------------------------------------------------------------------------------|
| 1 | Override de parâmetros por `fornecedor` na `replenishment_params` | v2 (evolution) | CONTEXT.md: "scope IN ('global','marca') — fornecedor reservado para v2"; migration documenta: "fornecedor reservado para v2 (fora do escopo v1)"; ROADMAP SC4 menciona "marca/fornecedor" mas CONTEXT.md (artefato de fase aprovado por Wesley) reduz escopo explicitamente |

---

### Required Artifacts

| Artifact                                                             | Expected                             | Status    | Details                                                              |
|----------------------------------------------------------------------|--------------------------------------|-----------|----------------------------------------------------------------------|
| `supabase/migrations/20260662000000_replenishment_params.sql`        | Tabela RLS org-first                 | VERIFIED  | Existe; `scope IN ('global','marca')`; RLS `is_org_member` + `get_org_role`; CHECKs corretos |
| `supabase/migrations/20260662000100_get_replenishment_rpc.sql`       | RPC SECURITY INVOKER                 | VERIFIED  | Existe; `SECURITY INVOKER SET search_path='public'`; 4 CTEs + REVOKE/GRANT |
| `src/lib/analysis/replenishmentUtils.ts`                             | Módulo TS puro                       | VERIFIED  | 176 linhas; zero imports React/Supabase; `calcReplenishment` + `resolveParams` exportados |
| `src/lib/analysis/replenishmentUtils.test.ts`                        | Suite vitest ≥ 8 casos               | VERIFIED  | 10 testes em 2 describe blocks; todos verdes                          |
| `src/hooks/useReplenishment.ts`                                      | Hook React Query com interface 20 campos | VERIFIED | Existe; `useOrganization()` → `p_org_id: currentOrg.id` (anti-IDOR); `staleTime 5min` |
| `src/components/mercadolivre/ReplenishmentPanel.tsx`                 | Componente read-only com aviso REPL-09 | VERIFIED | Existe; Alert de limitação "a chegar"; toggle gatilho_ativo; 9 colunas |
| `src/pages/mercadolivre/MLEstoque.tsx` (aba "compra")                | Aba nova sem remover estado antigo   | VERIFIED  | ln 1030–1033: TabsTrigger "compra" + ShoppingCart; ln 1411–1413: TabsContent montando ReplenishmentPanel; defaultValue="estoque" intacto |

---

### Key Link Verification

| From                          | To                             | Via                                              | Status    | Details                                          |
|-------------------------------|--------------------------------|--------------------------------------------------|-----------|--------------------------------------------------|
| `useReplenishment.ts`         | `get_replenishment` RPC        | `supabase.rpc("get_replenishment", {...})`        | WIRED     | ln 39–44; p_org_id de `currentOrg.id`           |
| `ReplenishmentPanel.tsx`      | `useReplenishment.ts`          | `import { useReplenishment }`                    | WIRED     | ln 17–18; data, isLoading, error consumidos      |
| `MLEstoque.tsx`               | `ReplenishmentPanel.tsx`       | `import { ReplenishmentPanel }` + TabsContent    | WIRED     | ln 31; ln 1411–1413                              |
| `get_replenishment` RPC       | `ml_inventory_cache`           | CTE inventory: `FROM ml_inventory_cache WHERE org` | WIRED   | SQL ln 80–93; sem filtro logistic_type (VERAC-01 preservado) |
| `get_replenishment` RPC       | `ml_product_daily_cache`       | CTE sales: `FROM ml_product_daily_cache WHERE org AND date >= v_cutoff` | WIRED | SQL ln 66–75; vendas reais 30d |
| `get_replenishment` RPC       | `replenishment_params`         | CTE params: COALESCE subqueries por scope         | WIRED     | SQL ln 99–152; precedência marca>global>hardcoded |
| `get_replenishment` RPC       | `ml_product_costs`             | LEFT JOIN LATERAL por item_id OR seller_sku       | WIRED     | SQL ln 217–227; ponte Tiny TINY_{sku}            |

---

### Data-Flow Trace (Level 4)

| Artifact              | Data Variable | Source                      | Produces Real Data | Status   |
|-----------------------|---------------|-----------------------------|--------------------|----------|
| `ReplenishmentPanel`  | `data` (ReplenishmentRow[]) | `useReplenishment` → `supabase.rpc("get_replenishment")` | Sim — 116 linhas Pé Vermeio em prod | FLOWING |
| `useReplenishment`    | RPC result    | `ml_inventory_cache` + `ml_product_daily_cache` + `replenishment_params` + `ml_product_costs` | Sim — 4 tabelas com dados reais | FLOWING |

---

### Behavioral Spot-Checks

| Behavior                                         | Command                                         | Result                                         | Status |
|--------------------------------------------------|-------------------------------------------------|------------------------------------------------|--------|
| 10/10 testes da fórmula passam                   | `npx vitest run replenishmentUtils.test.ts`     | 10/10 PASS, 1.41s                              | PASS   |
| 203/203 testes da suite completa (sem regressão) | `npx vitest run` (suite completa)               | 203/203 PASS (relatado em 62-02-SUMMARY)       | PASS   |
| RPC retorna dados reais em prod                  | MCP apply + SQL validação (orquestrador)        | 116 linhas, 29 sugeridos, 87 acima do ponto, 41 sem giro, 44 sem custo | PASS |
| Anti-IDOR: cross-org retorna 0 linhas            | SQL SET LOCAL ROLE + JWT de Pé Vermeio          | cross-org=0 / própria=116                      | PASS   |
| `tsc --noEmit` limpo                             | `tsc --noEmit`                                  | EXIT 0 (sem novos erros)                        | PASS   |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                    | Status    | Evidence                                                         |
|-------------|-------------|----------------------------------------------------------------|-----------|------------------------------------------------------------------|
| REPL-01     | 62-01       | RPC server-side SECURITY INVOKER, anti-IDOR                    | SATISFIED | `get_replenishment_rpc.sql`; SECURITY INVOKER; cross-org=0      |
| REPL-02     | 62-01       | Estoque = `ml_inventory_cache` (Full+anúncios)                 | SATISFIED | CTE inventory: SUM cross-store sem filtro logistic_type          |
| REPL-03     | 62-01       | Venda/dia = vendas REAIS em janela 30d                         | SATISFIED | CTE sales: `ml_product_daily_cache WHERE date >= v_cutoff`       |
| REPL-04     | 62-01/02    | Ponto de reposição + gatilho: só sugere quando estoque ≤ ponto | SATISFIED | SQL: WHEN qty > ponto → 0; teste REPL-04 verde                   |
| REPL-05     | 62-01/02    | `replenishment_params` global+marca, precedência correta       | SATISFIED | scope IN ('global','marca'); COALESCE marca>global>hardcoded; [fornecedor=v2, deferred] |
| REPL-06     | 62-01/02    | MOQ e múltiplo de embalagem                                    | SATISFIED | `GREATEST(CEIL(nec/NULLIF(pack,0))×pack, moq)`; testes MOQ+pack  |
| REPL-07     | 62-01/02    | Custo nulo → quantidade sugerida, valor omitido, `custo_ausente` | SATISFIED | SQL: valor_estimado=NULL; 44 custo_ausente em prod; teste verde  |
| REPL-08     | 62-01/02    | Sem giro: `venda_dia=0` → compra=0, flag `sem_giro`            | SATISFIED | SQL: WHEN avg_daily=0 THEN 0; `sem_giro=(venda_dia=0 AND estoque>0)`; 41 em prod |
| REPL-09     | 62-03       | Aviso explícito v1 não desconta "a chegar"                     | SATISFIED | `ReplenishmentPanel.tsx` ln 113–121: Alert fixo com texto claro  |
| REPL-10     | 62-03       | Tela read-only da fonte, sem inputs editáveis                  | SATISFIED | 9 colunas read-only; nenhum `<Input>` para estoque no componente  |
| REPL-11     | 62-02       | Testes unitários: 8+ casos (normal, >ponto, sem giro, custo nulo, MOQ, pack, override, fallback) | SATISFIED | 10/10 testes verdes cobrindo todos os 8 casos do plan + 2 bônus |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Nenhum encontrado | — | — |

Scan executado em: `replenishment_params.sql`, `get_replenishment_rpc.sql`, `replenishmentUtils.ts`, `useReplenishment.ts`, `ReplenishmentPanel.tsx`. Nenhum TBD/FIXME/XXX/TODO/PLACEHOLDER encontrado.

---

### Decisões Travadas — Todas Honradas

| Decisão                                                                 | Resultado    | Evidência                                                          |
|-------------------------------------------------------------------------|--------------|--------------------------------------------------------------------|
| Estoque de `ml_inventory_cache` SEM filtro `logistic_type`              | HONRADO      | CTE inventory: `WHERE i.organization_id = p_org_id AND i.status = 'active'` — sem filtro logistic_type |
| Venda de `ml_product_daily_cache` (não priceCurve simulada)             | HONRADO      | CTE sales: `FROM ml_product_daily_cache`                           |
| SECURITY INVOKER (nunca DEFINER)                                        | HONRADO      | `LANGUAGE plpgsql SECURITY INVOKER SET search_path='public'`       |
| Override só por marca; fornecedor = v2                                  | HONRADO      | `scope IN ('global','marca')` — comment: "fornecedor reservado para v2" |
| `CompraRecomendadaPanel.tsx` antigo intocado                            | HONRADO      | `git diff HEAD~10..HEAD -- .../CompraRecomendadaPanel.tsx` = vazio  |

---

### Fórmula TS == Fórmula SQL

| Elemento         | SQL (`get_replenishment_rpc.sql`)                                                       | TypeScript (`replenishmentUtils.ts`)                              | Match |
|------------------|-----------------------------------------------------------------------------------------|-------------------------------------------------------------------|-------|
| ponto            | `venda_dia × (lead_time_dias + safety_days)`                                            | `vendaDia × (leadTimeDias + safetyDays)`                          | IGUAL |
| alvo             | `venda_dia × (meta_cobertura_dias + safety_days)`                                       | `vendaDia × (metaCoberturaDias + safetyDays)`                     | IGUAL |
| gatilho          | `WHEN available_quantity > ponto → 0` (i.e., sugere quando estoque ≤ ponto)             | `gatilhoAtivo = estoque <= pontoReposicao`                        | IGUAL |
| compra_sugerida  | `GREATEST(CEIL(GREATEST(0, alvo−estoque) / NULLIF(pack,0)) × pack, moq)`               | `Math.max(Math.ceil(Math.max(0,alvo−estoque)/pack)×pack, moq)`    | IGUAL |
| custo_ausente    | `(b.cost_val IS NULL)`                                                                  | `cost == null`                                                    | IGUAL |
| valor_estimado   | `CASE WHEN cost IS NULL THEN NULL ELSE compra × cost END`                               | `custoAusente ? null : compraSugerida × cost`                     | IGUAL |
| sem_giro         | `(b.venda_dia = 0 AND b.estoque_atual > 0)`                                             | `vendaDia === 0 && estoque > 0`                                   | IGUAL |
| guardrail pack   | `NULLIF(pack_multiple, 0)` + CHECK `pack_multiple >= 1`                                 | `Math.max(1, params.packMultiple)`                                | EQUIVALENTE |

Divergência detectada: nenhuma. Fórmulas são matematicamente idênticas.

---

### Human Verification Required

Nenhum item requer verificação humana para validar a entrega do goal.

Os itens de validação E2E visual (painel exibindo dados reais, toggle gatilho_ativo, flags e parâmetros) são cobertura de qualidade de produto — não bloqueadores do goal. A validação funcional em produção (116 linhas reais, anti-IDOR, advisors limpos) já confirma o objetivo.

---

### Gaps Summary

Nenhum gap encontrado. Todos os 7 Success Criteria estão verificados com evidências diretas do código e da produção.

O único item abaixo do contrato do ROADMAP SC4 é o override por `fornecedor` na `replenishment_params`, explicitamente diferido para v2 pelo próprio CONTEXT.md da phase e documentado na migration — não configura gap acionável.

---

*Verified: 2026-06-25T21:10:00Z*
*Verifier: Claude (gsd-verifier)*
