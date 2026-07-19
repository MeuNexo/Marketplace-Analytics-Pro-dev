---
phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu
plan: 01
subsystem: dre-fiscal
tags: [supabase, rpc, migration, inss, dre, m+1]
dependency-graph:
  requires: []
  provides:
    - "supabase/migrations/20260716230000_get_inss_guia_by_competence.sql (arquivo local, NÃO aplicado em prod)"
  affects:
    - "Plano 98-02 (hook useInssGuiaReal — depende da RPC estar viva em prod)"
tech-stack:
  added: []
  patterns:
    - "RPC dedicada por régua de competência deslocada (M+1), clone estrutural exato de get_imposto_guia_by_competence"
key-files:
  created:
    - supabase/migrations/20260716230000_get_inss_guia_by_competence.sql
  modified: []
decisions:
  - "Migration clona literalmente get_imposto_guia_by_competence (Phase 90), trocando só a lista de 3 categorias por 1 categoria única 'Pessoal - INSS'"
metrics:
  duration: "~15min (Task 1) + ~10min (Task 2, orquestrador)"
  completed: "2026-07-16"
status: complete
---

# Phase 98 Plan 01: RPC get_inss_guia_by_competence Summary

RPC `get_inss_guia_by_competence` — clone estrutural exato de `get_imposto_guia_by_competence`, para categoria única `'Pessoal - INSS'` — **APLICADA EM PRODUÇÃO** (`ckcdevcxgvueywivefgx`) pelo orquestrador, que tinha acesso real ao MCP do Supabase (o executor deste plano não tinha — ver "Task 2 — executada pelo orquestrador" abaixo).

## Task 2 — executada pelo orquestrador (2026-07-16)

O agente executor deste plano não tinha acesso às tools `mcp__claude_ai_Supabase__*` (ver seção "O que NÃO foi feito" original, preservada abaixo para histórico). O orquestrador (sessão que disparou este executor, com MCP real) assumiu a Task 2 diretamente:

1. **`list_migrations` reconfirmado**: `max(version)` real = `20260716172353` (mesmo valor do addendum do RESEARCH.md — não mudou). `20260716230000` não colide, sem renumeração necessária.
2. **`apply_migration` executado com sucesso** — `{"success":true}`.
3. **Dados reais confirmados exatamente como esperado:**
   - `get_inss_guia_by_competence('7f615df7-7bac-45e5-8a93-827fb9ddeec7', '2026-03-01')` → 1 linha: `{category:'Pessoal - INSS', total:1550.00, status:'paid', n:1}`.
   - `get_inss_guia_by_competence('7f615df7-7bac-45e5-8a93-827fb9ddeec7', '2026-04-01')` → 2 linhas: `{total:1550.00, status:'cancelled', n:1}` e `{total:2652.31, status:'paid', n:1}`.
4. **Anti-IDOR provado com JWT real impersonado** (não só ausência de dado): `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims` com `sub` de um usuário real da org Thales (`4aed4678-3c3a-42bc-94ff-b6e9b2d08b2e`, role owner), chamando a RPC com `p_org_id` = Pé Vermeio (`7f615df7-7bac-45e5-8a93-827fb9ddeec7`, que TEM 2 linhas reais para 2026-04). Resultado: **0 linhas** — RLS bloqueou corretamente, não foi ausência de dado (a org alheia genuinamente tem dado da org vítima, prova válida, não a prova falsa documentada como lição anterior no memory do projeto).
5. **`get_advisors` (security) limpo** — nenhum advisory novo relacionado a `get_inss_guia_by_competence`; todos os itens retornados são pré-existentes e não relacionados (RLS sem policy em `cat_backfill_queue`, search_path mutável em funções antigas, etc.).
6. **RPCs irmãs intocadas** — `get_imposto_guia_by_competence` e `get_dre_operational_by_competence` confirmadas existentes sem nenhuma alteração (nenhum `CREATE OR REPLACE` foi rodado nelas nesta execução).

**RPC viva em produção, pronta para o Plano 98-02 consumir via `useInssGuiaReal`.**

---

## Histórico original (executor) — preservado

A Task 2 (checkpoint de deploy via MCP Supabase) não pôde ser executada por este agente executor: as ferramentas MCP `mcp__claude_ai_Supabase__*` (`list_migrations`, `apply_migration`, `execute_sql`, `get_advisors`) não estavam disponíveis no conjunto de ferramentas real deste agente, apesar de o prompt de disparo ter instruído explicitamente que o executor teria esse acesso neste ambiente. Isso motivou o orquestrador a assumir a Task 2 diretamente (ver seção acima).

## O que foi feito (Task 1 — COMPLETA)

- Migration `supabase/migrations/20260716230000_get_inss_guia_by_competence.sql` criada, clonando literalmente `get_imposto_guia_by_competence` (`/root/garment-glow-dre/supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql`):
  - Mesma assinatura `(p_org_id uuid, p_competence date)`, mesmo retorno `TABLE (category text, total numeric, status text, n integer)`.
  - `LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'` idêntico ao molde.
  - Única diferença estrutural: `WHERE co.category = 'Pessoal - INSS'` (igualdade simples) no lugar da lista `IN ('Imposto Venda - ICMS','Imposto Venda - PIS','Imposto Venda - COFINS')`. Grafia da categoria conferida contra o `CASE` de `get_dre_operational_by_competence` em `supabase/migrations/20260716210000_cancelled_payables_dre.sql:51` (espaço-hífen-espaço, letras exatas).
  - Mesmo filtro de mês por `date_trunc('month', p_competence)` (início inclusive, início do mês seguinte exclusive) — nunca comparação de string "YYYY-MM".
  - Mesmo `GROUP BY co.category, co.status` / `ORDER BY co.category, co.status`.
  - `REVOKE EXECUTE ... FROM PUBLIC, anon;` / `GRANT EXECUTE ... TO authenticated;` com assinatura `(uuid, date)`, idêntico ao molde.
  - Comentário de cabeçalho documentando: RPC irmã (nunca modificar `get_imposto_guia_by_competence`), dado cru sem deslocamento (régua M+1 fica no frontend, Plano 98-02), decisão travada do Wesley (2026-07-16), e a exigência de reconfirmar `max(version)` via `list_migrations` antes de aplicar.
- Verificação automatizada do Task 1 (grep-based) rodou e passou (`OK`).
- Self-check: arquivo existe no disco (confirmado) e commit `b2215777` existe no histórico local (confirmado via `git log --oneline --all | grep`).

## O que NÃO foi feito (Task 2 — BLOQUEADA)

O plano instruía este agente a executar diretamente (sem pausar para humano) os 6 passos de deploy via MCP Supabase:

1. `mcp__claude_ai_Supabase__list_migrations` (projeto `ckcdevcxgvueywivefgx`) — reconfirmar `max(version)` real.
2. `mcp__claude_ai_Supabase__apply_migration` — aplicar a migration.
3. `mcp__claude_ai_Supabase__execute_sql` — confirmar os 2 casos reais (março/abril, Pé Vermeio).
4. Anti-IDOR contra a org Thales.
5. `mcp__claude_ai_Supabase__get_advisors` (security).
6. Confirmar `get_imposto_guia_by_competence`/`get_dre_operational_by_competence` intocadas.

**Tentei invocar `mcp__claude_ai_Supabase__list_migrations`, `mcp__claude_ai_Supabase__list_projects` e `mcp__supabase__list_migrations` — todas retornaram `Error: No such tool available`.** O conjunto real de ferramentas exposto a este agente executor (via harness) não inclui nenhuma tool MCP do Supabase, apesar do prompt de disparo afirmar o contrário. Isto é consistente com o bug upstream já documentado no próprio prompt do sistema (`anthropics/claude-code#13898` — MCP tools stripped from agents with a `tools:` frontmatter restriction) — provavelmente este agente executor roda com uma lista `tools:` restrita que não propaga os servidores MCP disponíveis à sessão que o disparou.

Verifiquei também a via CLI como fallback: `supabase` CLI está presente no PATH, mas **nenhum `SUPABASE_ACCESS_TOKEN`/`SB_*` está no ambiente** (confirmado via `env | grep -i SUPABASE`), e o próprio `<deploy_note>` do plano proíbe explicitamente `supabase db push`/SQL Editor como via de aplicação. Não tentei nenhuma via não-autorizada.

**Conclusão:** este é um bloqueio crítico e imprevisto (não coberto pelo plano, que assumia acesso MCP real neste agente). Não improvisei uma via alternativa de deploy nem inventei uma decisão de negócio — parei e documento aqui, conforme instruído.

## Próximo passo necessário (para quem retomar)

A Task 2 precisa ser executada por um agente/sessão que efetivamente tenha as tools `mcp__claude_ai_Supabase__*` disponíveis (aparentemente a sessão do orquestrador que disparou este executor, a julgar pelas instruções de `MCP Server Instructions` presentes no próprio prompt de disparo). Passos exatos a rodar (já descritos na Task 2 do `98-01-PLAN.md`):

1. `list_migrations` em `ckcdevcxgvueywivefgx` — reconfirmar `max(version)`; renomear o arquivo (e o nome usado no `apply_migration`) se `20260716230000` colidir ou ficar abaixo do máximo real.
2. `apply_migration` com o conteúdo de `supabase/migrations/20260716230000_get_inss_guia_by_competence.sql` (git commit `b2215777`).
3. `execute_sql`:
   - `select * from get_inss_guia_by_competence('7f615df7-7bac-45e5-8a93-827fb9ddeec7', '2026-03-01')` → esperado 1 linha, `total=1550.00`, `status='paid'`.
   - `select * from get_inss_guia_by_competence('7f615df7-7bac-45e5-8a93-827fb9ddeec7', '2026-04-01')` → esperado 2 linhas: `{total:1550.00, status:'cancelled'}` e `{total:2652.31, status:'paid'}`.
4. Anti-IDOR contra org Thales (`e4150d57-1349-48c9-9a89-82b1774857b0`) conforme metodologia descrita no prompt de disparo (impersonação de JWT real se possível; senão, confirmar via `SELECT` direto em `cash_outflows` como `postgres` que a org Thales TEM dado de `Pessoal - INSS` no período, para não confundir "ausência de dado" com "RLS filtrando").
5. `get_advisors` (tipo security) — confirmar nenhum erro novo.
6. Confirmar que `get_imposto_guia_by_competence` e `get_dre_operational_by_competence` permanecem com o corpo intocado.

Se o nome do arquivo/versão da migration for alterado durante a Task 2, o commit `b2215777` deste plano fica desatualizado — recomendo um commit de ajuste (`fix(98-01): renumerar migration para <novo-nome>`) na mesma branch antes de fechar o plano.

## Deviations from Plan

### Auto-fixed Issues

Nenhum desvio de Regras 1-3 durante a Task 1 — migration escrita exatamente conforme especificado no plano, verificação automatizada passou de primeira.

### Rule 4 — Blocker documentado (não é uma decisão arquitetural minha, é ausência de ferramenta)

Este não é tecnicamente um "Rule 4" (mudança arquitetural) nem um dos Rules 1-3 (bug/funcionalidade faltante/bloqueio corrigível) — é ausência de ferramenta MCP no ambiente deste agente, contradizendo a premissa do prompt de disparo. Documentado como bloqueio, não como decisão de negócio.

## Threat Flags

Nenhum — a migration segue o mesmo padrão de threat model já registrado no `98-01-PLAN.md` (T-98-01/T-98-02), sem superfície nova além do já mapeado. A Task 2 (aplicação + prova anti-IDOR + advisors) ainda precisa ser executada para fechar essas mitigações em prod.

## Known Stubs

Nenhum — nenhuma UI ou hook consome esta RPC ainda (isso é escopo do Plano 98-02).

## Self-Check: PASSED (Task 1 apenas)

- FOUND: supabase/migrations/20260716230000_get_inss_guia_by_competence.sql
- FOUND: commit b2215777 (`git log --oneline --all | grep b2215777`)

Task 2 não tem self-check aplicável — nada foi aplicado em prod por este agente.
