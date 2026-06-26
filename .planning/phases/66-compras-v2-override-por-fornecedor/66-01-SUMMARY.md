---
phase: 66-compras-v2-override-por-fornecedor
plan: "01"
subsystem: database
tags: [supabase, edge-functions, purchase-orders, fornecedor, migration, deno]

# Dependency graph
requires:
  - phase: 65-estoque-a-chegar
    provides: "tabela purchase_orders + EF sync-tiny-purchase-orders base (campos sku, quantidade, data_entrega, data_pedido)"
provides:
  - "Coluna purchase_orders.fornecedor TEXT em prod, populada via re-sync (200/200 OCs)"
  - "scope='fornecedor' aceito na constraint replenishment_params_scope_check"
  - "EF sync-tiny-purchase-orders v2 gravando contato.nome como fornecedor"
  - "Gate de qualidade D-12/D-13 aprovado: 6 fornecedores com nomes limpos, mapeamento SKU→fornecedor 1:1"
affects:
  - 66-02-override-por-fornecedor
  - 66-03-ux-override

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coluna derivada de API externa: valor coerced com String().trim().slice(0,200) || null antes do upsert"
    - "Migration idempotente (IF NOT EXISTS / DROP IF EXISTS) registrada via apply_migration quando já aplicada mas não registrada (Pitfall 3)"
    - "Re-sync disparado via net.http_post com service_role_key lido do vault (nunca hardcoded)"

key-files:
  created:
    - supabase/migrations/20260666000000_fornecedor_scope.sql
  modified:
    - supabase/functions/sync-tiny-purchase-orders/index.ts

key-decisions:
  - "Migration aplicada-mas-não-registrada → registrada via apply_migration (idempotente: IF NOT EXISTS / DROP IF EXISTS garante no-op de schema + insere registro em supabase_migrations)"
  - "Gate D-12/D-13 obrigatório ANTES de 66-02: mapeamento SKU→fornecedor é 1:1 nos dados atuais (0 SKUs com >1 fornecedor) — a lógica 'predominante' é correta por robustez mas não altera nenhum mapeamento real hoje"
  - "Fornecedor 'Rossi' (nome informal vs. razões sociais dos demais) aceito como válido — valor único no Tiny, não quebra match"

patterns-established:
  - "Dado externo de API (contato.nome) → sempre coerce String().trim().slice(0,N) || null antes de gravar em coluna NOT NULL free-text"
  - "Re-sync de EF com waitUntil via MCP net.http_post: retorna 202, processamento async — aguardar ~3 min antes de validar população"

requirements-completed: [FORN-01, FORN-02]

# Metrics
duration: 30min
completed: 2026-06-26
status: complete
---

# Phase 66 Plan 01: Fundação Fornecedor Summary

**Coluna `purchase_orders.fornecedor` versionada + EF v2 deployada + 200/200 OCs populadas via re-sync, com gate de qualidade D-12/D-13 aprovado (6 fornecedores, nomes limpos, SKU→fornecedor 1:1)**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-26T00:00:00Z
- **Completed:** 2026-06-26
- **Tasks:** 3 (1 auto + 2 checkpoint:human-verify)
- **Files modified:** 2

## Accomplishments

- Migration `20260666000000_fornecedor_scope.sql` versionada no git na branch `gsd/phase-66-override-fornecedor` e registrada em `supabase_migrations` (FORN-01/FORN-02)
- EF `sync-tiny-purchase-orders` atualizada para gravar `fornecedor = contato.nome` (com coerce e fallback) e deployada como **version 2** em prod
- Re-sync disparado via `net.http_post` (service_role_key do vault) → 200/200 OCs da org Pé Vermeio com `fornecedor IS NOT NULL` (6 fornecedores distintos, 135 SKUs distintos)
- Gate D-12/D-13 aprovado pelo Wesley: nomes limpos/sem duplicata por casing/espaço; mapeamento SKU→fornecedor é 1:1 em 100% dos casos atuais; datas 100% preenchidas (data_entrega e data_pedido = 200/200)

## Task Commits

1. **Task 1: Commitar fundação (migration untracked + EF local)** - `7f8a839b` (feat)
2. **Task 2: Deploy da EF + validar migration + re-sync** - executado pelo orquestrador via MCP (sem commit de código — operação de deploy/infra)
3. **Task 3: Gate D-12/D-13 — validar nomes de fornecedor** - aprovado pelo Wesley (gate de dados, sem commit)

## Files Created/Modified

- `supabase/migrations/20260666000000_fornecedor_scope.sql` — Adiciona `purchase_orders.fornecedor TEXT`, troca constraint `replenishment_params_scope_check` para incluir `'fornecedor'` (ambos com IF NOT EXISTS / idempotentes)
- `supabase/functions/sync-tiny-purchase-orders/index.ts` — Deriva `fornecedor` de `det.contato.nome` (fallback `h.contato.nome`), coerce `String().trim().slice(0,200) || null`, inclui campo no upsert de `purchase_orders`

## Decisions Made

1. **Migration registrada via apply_migration (não reaplicada):** A migration `20260666000000` estava aplicada em prod mas ausente de `supabase_migrations.schema_migrations` (Pitfall 3 do CONTEXT.md). Registrada via `apply_migration` com nome `phase66_fornecedor_scope` — como a migration usa `IF NOT EXISTS` / `DROP IF EXISTS`, o efeito de schema foi no-op; apenas o registro foi inserido.

2. **Gate de nomes obrigatório pré-66-02:** Antes de ligar a lógica de precedência (plano 66-02), era necessário confirmar que os nomes não têm duplicatas por casing/espaço. Resultado: 6 fornecedores, todos com razão social formal exceto "Rossi" (nome informal do Tiny) — aceito pois é único e não gera ambiguidade.

3. **Lógica "predominante" correta mesmo com dados 1:1:** A query de predominante (ORDER BY total_qty DESC, ultima_data DESC) é necessária para robustez futura (um SKU pode ser comprado de dois fornecedores), mas hoje 0 SKUs têm >1 fornecedor. A lógica não altera nenhum mapeamento real no dado atual.

## Deviations from Plan

### Auto-fixed Issues

**1. [Pitfall 3 — Migration aplicada mas não registrada] Registrada via apply_migration (idempotente)**
- **Found during:** Task 2 (gate de validação do orquestrador)
- **Issue:** A migration `20260666000000` estava em prod (schema já existia) mas ausente de `supabase_migrations.schema_migrations`, o que impederia o Supabase de rastreá-la corretamente em deploys futuros
- **Fix:** Orquestrador executou `apply_migration` com nome `phase66_fornecedor_scope` e o conteúdo da migration; os `IF NOT EXISTS` / `DROP IF EXISTS` tornaram o efeito de schema um no-op; apenas o registro foi inserido na tabela de migrações
- **Files modified:** Nenhum arquivo de código — operação de metadado no Supabase
- **Verification:** `SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260666000000'` retornou 1 linha
- **Committed in:** N/A (operação de infra via MCP, não commit de código)

---

**Total deviations:** 1 (Pitfall 3 benigno — conforme documentado no CONTEXT.md como cenário esperado)
**Impact on plan:** Nenhum impacto funcional. A migration estava correta; apenas o registro estava ausente. O apply_migration foi exatamente o procedimento documentado no CONTEXT.md para este cenário.

## Issues Encountered

- **Migration não registrada (Pitfall 3):** A migration havia sido aplicada diretamente em prod antes de ser versionada no git (conforme D-14 do CONTEXT.md). Resolvido via apply_migration idempotente durante Task 2.

## User Setup Required

None - operações realizadas pelo orquestrador via MCP Supabase. Nenhuma configuração manual adicional requerida.

## Dados Populados (Referência para 66-02)

| Fornecedor | SKUs distintos | Qtd total (OCs) |
|------------|---------------|-----------------|
| PRALANA INDUSTRIA E COMERCIO LTDA | 80 | 860 |
| ZEBU INDUSTRIA DE BOTINAS LTDA | 20 | 228 |
| TEXTILE XTRA CO. LTDA | 16 | 76 |
| R&S INDUSTRIA E COMERCIO DE CALCADOS LTDA | 13 | 400 |
| Rossi | 4 | 121 |
| MGS INDUSTRIA E COMERCIO DE ARTIGOS DO VEST. LTDA | 2 | 200 |

- **Total OCs com fornecedor:** 200/200 (100%)
- **SKUs com >1 fornecedor:** 0 (mapeamento 1:1 — lógica "predominante" é no-op no dado atual)
- **data_entrega preenchida:** 200/200 | **data_pedido preenchida:** 200/200

## Next Phase Readiness

- Pré-requisito de 66-02 (precedência por fornecedor) totalmente satisfeito: coluna em prod, populada, gate de qualidade aprovado
- `replenishment_params` pode receber registros com `scope='fornecedor'` (constraint atualizada)
- 66-02 pode confiar no mapeamento SKU→fornecedor sem limpeza adicional
- "Rossi" como nome informal é o único ponto de atenção menor — não bloqueia, mas se a razão social formal aparecer futuramente no Tiny, um re-sync atualizaria automaticamente

---

*Phase: 66-compras-v2-override-por-fornecedor*
*Completed: 2026-06-26*
