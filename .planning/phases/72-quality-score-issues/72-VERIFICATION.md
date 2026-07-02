---
phase: 72-quality-score-issues
verified: 2026-06-29T14:13:10Z
status: human_needed
score: 6/6
behavior_unverified: 2
overrides_applied: 0
human_verification:
  - test: "Smoke positivo — abrir o modal de um anúncio da Pé Vermeio logado com conta Wesley, aba Indicadores deve mostrar lista de problemas (ou 'Nenhum problema encontrado') vindo da EF ml-listing-health"
    expected: "Seção 'Problemas do anúncio' aparece após o quality score; lista de issues em PT-BR agrupados por categoria, ou mensagem verde 'Nenhum problema encontrado'; skeleton de loading visível brevemente antes dos dados"
    why_human: "Requer JWT de usuário logado na plataforma — indisponível em ambiente de CI/orquestrador; EF acessível somente com token autenticado (verify_jwt=true)"
  - test: "Verificação anti-IDOR ao vivo — tentar invocar a EF ml-listing-health com JWT de usuário de org A passando item_id de um anúncio da org B (ml_user_id de seller que não pertence ao chamador)"
    expected: "EF retorna HTTP 403 Forbidden; a aba Indicadores exibe estado 'erro' (não retorna dados de outra org)"
    why_human: "Requer dois JWTs de orgs diferentes em ambiente de produção; a lógica is_org_member está presente no código mas a execução real não pode ser testada sem usuários logados em orgs distintas"
behavior_unverified_items:
  - truth: "Smoke positivo com dados reais do ML (SC1/SC6 — EF retorna score + issues de anúncio real)"
    test: "Invocar EF ml-listing-health com JWT real + item_id MLB3621411217, ml_user_id=427063369"
    expected: "HTTP 200 com HealthResult contendo score number|null + issues[] + source 'performance_api' ou 'health_api'"
    why_human: "Requer JWT de usuário autenticado; auth smoke (401/anon→401/CORS) foi feito pelo orquestrador e confirmado no SUMMARY 72-01"
  - truth: "Fuga cross-org bloqueada ao vivo (SC4 — 403 real com org diferente)"
    test: "Invocar EF com JWT org A + ml_user_id pertencente à org B"
    expected: "HTTP 403 Forbidden; nenhum dado de anúncio retornado"
    why_human: "is_org_member presente e wired no código; execução real do 403 exige dois usuários em orgs distintas em produção"
---

# Phase 72: Aba Quality Score + Issues — Relatório de Verificação

**Goal da Phase:** Ao abrir o modal de um anúncio, a aba Indicadores busca AO VIVO (lazy) a saúde detalhada via nova edge function que chama a API do ML, e mostra — além do score já existente — a lista de problemas acionáveis (issues) do anúncio, em PT-BR.
**Verificado:** 2026-06-29T14:13:10Z
**Status:** human_needed
**Re-verificação:** Não — verificação inicial

---

## Verdades Observáveis

| # | Verdade (SC) | Status | Evidência |
|---|---|---|---|
| 1 | EF recebe `item_id`+`ml_user_id`, resolve token org-scoped, retorna score+issues, trata erro/timeout sem quebrar o modal | VERIFIED | `supabase/functions/ml-listing-health/index.ts` 354 linhas — Zod body schema, token lookup `ml_tokens ORDER BY updated_at DESC`, `parsePerformanceResponse`/`parseHealthResponse`, 401/404/unavailable tratados; deploy ACTIVE v1 + auth smoke documentado em 72-01-SUMMARY |
| 2 | Hook invoca a EF lazy ao abrir o modal; guard `_ml_user_id` undefined → idle; estados loading/erro/vazio; quality score não quebra se EF falhar | VERIFIED | `useMLListingHealth.ts` 83 linhas — `useEffect` com `deps=[item?.id, item?._ml_user_id]`, guard `!item?.id \|\| !item?._ml_user_id` → status='idle', flag `cancelled` para cleanup; `ListingQualityScore` recebe `item.health` diretamente (linha 134 de `ListingIndicatorsTab.tsx`), independente do resultado da EF |
| 3 | Issues exibidos em PT-BR como lista acionável no `ListingIndicatorsTab` via `ListingIssues` | VERIFIED | `ListingIssues.tsx` 103 linhas — 6 estados, `IssueList` agrupa por `category` (Map com ordem de inserção); GOAL_MAP na EF mapeia 10 goal IDs para PT-BR (categorias "Condições de venda" e "Dados do produto"); wiring em `ListingIndicatorsTab.tsx` linha 137: `<ListingIssues status={healthStatus} issues={healthData?.issues ?? []} />` |
| 4 | Anti-IDOR: EF usa `is_org_member` e só retorna dados da org do chamador | VERIFIED | `index.ts` linhas 282–290 — `userId` vem de `supabaseAdmin.auth.getUser(token)`, `organization_id` vem de `ml_tokens`, `is_org_member(_user_id, _org_id)` → 403 se não-membro; live 403 cross-org deferido ao E2E do Wesley (ver Human Verification) |
| 5 | Nenhuma tabela nova, nenhum cron novo; `ListingQualityScore` intocado (sem regressão Phase 71) | VERIFIED | `git log -- 'supabase/migrations/'` = zero commits Phase 72; `git log -- 'ListingQualityScore.tsx'` = único commit `e4d61089` (Phase 71); Phase 72 commits (`fa2d101a`, `0cf612f9`, `dcd7ef8f`, `45bb8e55`) tocaram apenas: EF, hook, componente, teste, tab (sem SQL) |
| 6 | `tsc` 0 erros, `build` ok; EF deployada via MCP e testada (smoke) | VERIFIED (parcial — smoke positivo real deferido) | `npx tsc --noEmit` → 0 saída (sem erros); `npm run build` → "✓ built in 23.13s"; `npx vitest run ListingIssues.test.tsx` → 6/6 passing; deploy ACTIVE v1 + auth smoke (401/anon→401/CORS 200) confirmado no SUMMARY 72-01 |

**Score:** 6/6 verdades verificadas no código (2 itens de smoke em prod deferidos ao E2E do Wesley)

---

## Artefatos Obrigatórios

| Artefato | Esperado | Status | Detalhes |
|---|---|---|---|
| `supabase/functions/ml-listing-health/index.ts` | EF Deno — token, anti-IDOR, fallback, normalização, PT-BR | VERIFIED | 354 linhas; commit `fa2d101a`; substantivo (GOAL_MAP 10 goals, LEVEL_WORDING 6 níveis, `parsePerformanceResponse`, `parseHealthResponse`, serve handler completo) |
| `src/components/mercadolivre/anuncios/useMLListingHealth.ts` | Hook lazy com guard e cleanup | VERIFIED | 83 linhas; commit `0cf612f9`; exporta `Issue`, `HealthResult`, `HealthStatus`; guard + cleanup `cancelled` |
| `src/components/mercadolivre/anuncios/ListingIssues.tsx` | Componente 6 estados PT-BR | VERIFIED | 103 linhas; commit `45bb8e55`; `IssueList` subcomponente interno; textos em PT-BR |
| `src/components/mercadolivre/anuncios/ListingIssues.test.tsx` | Testes TDD 6 casos | VERIFIED | 88 linhas; commit `dcd7ef8f` (RED) + `45bb8e55` (GREEN); 6/6 passing confirmados via execução |
| `src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx` | Wiring: hook + componente após quality score | VERIFIED | Linhas 9-10 importam hook e componente; linha 50 chama hook; linha 134 `<ListingQualityScore health={item.health} />`; linha 137 `<ListingIssues ...>` — ordem correta |

---

## Verificação de Links-Chave (Wiring)

| De | Para | Via | Status | Detalhe |
|---|---|---|---|---|
| `ListingIndicatorsTab.tsx` | `useMLListingHealth.ts` | `import { useMLListingHealth } from "./useMLListingHealth"` | WIRED | Linha 9; chamado na linha 50 |
| `ListingIndicatorsTab.tsx` | `ListingIssues.tsx` | `import { ListingIssues } from "./ListingIssues"` | WIRED | Linha 10; renderizado na linha 137 |
| `useMLListingHealth.ts` | EF `ml-listing-health` | `supabase.functions.invoke("ml-listing-health", { body: { item_id, ml_user_id } })` | WIRED | Linha 54-57; passa `item.id` e `item._ml_user_id` |
| `ListingQualityScore.tsx` | `item.health` (Phase 71) | `<ListingQualityScore health={item.health} />` | WIRED | Linha 134 — intocado pela Phase 72 |
| EF `ml-listing-health` | `is_org_member` (anti-IDOR) | `supabaseAdmin.rpc("is_org_member", { _user_id, _org_id })` | WIRED | Linhas 282-290; 403 se não-membro |

---

## Rastreamento de Fluxo de Dados (Nível 4)

| Artefato | Variável de dado | Fonte | Produz dado real | Status |
|---|---|---|---|---|
| `ListingIssues.tsx` | `issues: Issue[]` | `useMLListingHealth` → `supabase.functions.invoke` → EF → API ML | Sim (API ML ao vivo; `source` indica origem) | FLOWING |
| `ListingQualityScore.tsx` | `health: number \| null` | `item.health` (do contexto `MLInventoryContext`, cache existente Phase 71) | Sim (dados pré-carregados) | FLOWING — não alterado pela Phase 72 |

---

## Verificação de Comportamento (Spot-Checks)

| Comportamento | Comando | Resultado | Status |
|---|---|---|---|
| 6 estados de `ListingIssues` cobertos por testes | `npx vitest run src/components/mercadolivre/anuncios/ListingIssues.test.tsx` | 6/6 passed em 76ms | PASS |
| TypeScript 0 erros | `npx tsc --noEmit` | Sem saída (0 erros) | PASS |
| Build de produção ok | `npm run build` | `✓ built in 23.13s` | PASS |
| Smoke positivo EF com anúncio real | Requer JWT logado | Deferido — ver Human Verification | SKIP |
| 403 cross-org ao vivo | Requer dois JWTs em orgs distintas | Deferido — ver Human Verification | SKIP |

---

## Anti-Padrões Encontrados

| Arquivo | Linha | Padrão | Severidade | Impacto |
|---|---|---|---|---|
| `ListingIssues.tsx` | 24 | `return null` | Info | Comportamento intencional e testado — estado idle não renderiza (correto por design) |

Nenhum blocker detectado. Nenhum TBD/FIXME/XXX. Nenhum stub ou placeholder.

---

## Verificação Humana Necessária

### 1. Smoke Positivo com Anúncio Real

**Teste:** Logar na plataforma como Wesley, abrir o catálogo em `/anuncios`, clicar em um anúncio ativo (ex: MLB3621411217), ir para a aba Indicadores.
**Esperado:** Skeleton de loading visível por ~1-3 segundos; em seguida, seção "Problemas do anúncio" aparece com lista de issues em PT-BR agrupados por categoria (ex: "Condições de venda", "Dados do produto") ou mensagem verde "Nenhum problema encontrado". O quality score acima permanece exibindo o valor de `item.health` independentemente.
**Por que humano:** Requer JWT de usuário autenticado na plataforma em produção. Auth smoke (401/anon→401/CORS) já confirmado pelo orquestrador no SUMMARY 72-01.

### 2. Anti-IDOR 403 Cross-Org ao Vivo

**Teste:** Com uma conta de usuário que NÃO pertence à org da Pé Vermeio, invocar a EF `ml-listing-health` passando `ml_user_id=427063369` (loja da Pé Vermeio). Alternativamente, usar um usuário da Pé Vermeio com `ml_user_id` de outra org.
**Esperado:** HTTP 403 `{ "error": "Forbidden" }`. A aba Indicadores mostra estado de erro — nenhum dado de outra org vaza.
**Por que humano:** Exige dois usuários em orgs distintas em ambiente de produção; a lógica `is_org_member` está corretamente implementada no código (linhas 282-290 da EF) mas a execução real não pode ser testada sem setup multi-org ao vivo.

---

## Cobertura de Requirements

| Requirement | Status | Evidência |
|---|---|---|
| ADM-72 (Aba Quality Score + Issues, busca ao vivo, PT-BR, anti-IDOR) | VERIFIED (código) / PENDING (smoke vivo) | EF + hook + componente completos; wiring confirmado; tsc/build/tests passam; live smoke deferido |

---

## Resumo dos Gaps

Nenhum gap de implementação. Todos os 6 Success Criteria têm evidência completa no código.

Dois itens de smoke operacional ficaram deferidos ao E2E do Wesley por exigirem JWT de usuário logado em produção:
1. **Smoke positivo** — caminho feliz da EF com dados reais do ML (confirma que a API `/item/{id}/performance` retorna dados coerentes para anúncios da Pé Vermeio)
2. **403 cross-org ao vivo** — confirma que `is_org_member` efetivamente bloqueia acesso a dados de outra org em produção

Esses dois itens são **pendências de validação operacional**, não falhas de implementação. O código implementa corretamente ambos os cenários.

---

_Verificado: 2026-06-29T14:13:10Z_
_Verificador: Claude (gsd-verifier)_
