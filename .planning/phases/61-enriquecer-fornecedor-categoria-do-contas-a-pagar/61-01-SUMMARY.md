---
phase: 61-enriquecer-fornecedor-categoria-do-contas-a-pagar
plan: "01"
subsystem: treasury
tags: [supabase, edge-function, migration, treasury, cash_outflows, enrichment]
status: complete

dependency_graph:
  requires:
    - 20260650000300_cr01_backfill_pipeline_multitenant.sql (define enrich_enqueue_new + enrich_payable_step)
    - 20260650000100_treasury_category_backfill.sql (define enrich_harvest)
  provides:
    - sync-tiny-payables sem escritas de category/supplier (fonte única preservada no ON CONFLICT)
    - migration 20260661000000 que habilita enriquecimento de supplier via detalhe Tiny
  affects:
    - cash_outflows.category + cash_outflows.supplier (não mais zerados pelo sync)
    - cat_backfill_queue (enqueue re-enfileira done/error como todo após sync)

tech_stack:
  added: []
  patterns:
    - "Arquitetura fonte única: EF sync-lista preserva campos; enriquecimento-detalhe é gravador exclusivo"
    - "ON CONFLICT DO UPDATE com condição na tabela referenciada (cat_backfill_queue.status IN ...)"
    - "pg_net harvest: NULLIF/TRIM/COALESCE para extrair fornecedor do payload Tiny"

key_files:
  modified:
    - supabase/functions/sync-tiny-payables/index.ts
  created:
    - supabase/migrations/20260661000000_enrich_supplier_category.sql

decisions:
  - "Opção A (LOCKED): remover category/supplier do objeto rows.push() — ausência de chave no objeto de upsert do PostgREST não grava NULL no ON CONFLICT UPDATE"
  - "CREATE OR REPLACE nas três funções: enrich_enqueue_new, enrich_payable_step, enrich_harvest — crons existentes em prod (DRIFT) passam a usar a nova implementação automaticamente sem recriar"
  - "enrich_enqueue_new: ON CONFLICT DO UPDATE re-marca done/error apenas (não reseta todo/sent para não perder requisições em voo)"
  - "v_supplier derivado de NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '') — NULL quando campo ausente ou vazio, sem quebrar harvest"

metrics:
  duration: "~8 min"
  completed: "2026-06-25"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 61 Plan 01: Enriquecer Fornecedor + Categoria do Contas a Pagar — Summary

**Uma linha:** Fonte única implementada — sync-tiny-payables deixa de escrever category/supplier (remoção de 2 chaves + 1 variável do upsert) e migration 20260661000000 faz enrich_payable_step/enrich_harvest gravar supplier=contato.nome via detalhe Tiny, com enqueue re-enfileirando linhas zeradas via DO UPDATE.

## O que foi feito

### Task 1 — Remover supplier/category do upsert de sync-tiny-payables

Arquivo: `supabase/functions/sync-tiny-payables/index.ts`

Removidas do objeto `rows.push({...})` em `processLoja()`:
- `supplier: String(contato.nome ?? item.nomeFornecedor ?? "").trim() || null`
- `category: String(item.tipo ?? item.tipoOrdem ?? "").trim() || null`

Também removida a variável `const contato = item.contato ?? {};` (era usada somente para mapear supplier, tornou-se dead code).

Adicionado no lugar: `// supplier e category removidos: enriquecimento-detalhe é a fonte única (opção A, CASHFIX-07)`

Preservados intocados: todas as demais chaves do objeto (outflow_date, amount, description, status, document_number, source, tiny_payable_id, synced_at, updated_at), a chamada `.upsert(rows, { onConflict: "organization_id,tiny_payable_id", ignoreDuplicates: false })`, a interface `TinyPayable`, e o restante da função `processLoja()`.

**Verificação:** `deno check` passa; `item.nomeFornecedor` count=0; `item.tipoOrdem` count=0; comentário "fonte única" presente; `onConflict` intacto.

### Task 2 — Migration 20260661000000_enrich_supplier_category.sql

Arquivo novo: `supabase/migrations/20260661000000_enrich_supplier_category.sql`

Três `CREATE OR REPLACE FUNCTION`:

**1. `public.enrich_enqueue_new()`**
- WHERE: `(co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL)` — agora inclui supplier
- ON CONFLICT: `DO UPDATE SET status='todo', updated_at=now() WHERE cat_backfill_queue.status IN ('done','error')` — re-enfileira linhas zeradas pelo sync; não reseta todo/sent

**2. `public.enrich_payable_step(p_batch integer DEFAULT 12)`**
- DECLARE: adicionado `v_supplier text;`
- Harvest status 200: `v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');`
- UPDATE cash_outflows: `SET category = v_cat, supplier = v_supplier`
- Restante da função (disparo pg_net, tratamento 429/error, retorno jsonb) preservado intacto

**3. `public.enrich_harvest()`**
- DECLARE: adicionado `v_supplier text;`
- Harvest status 200: `v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');`
- UPDATE cash_outflows: `SET category = v_cat, supplier = v_supplier`

Todas as três com `SECURITY DEFINER SET search_path TO 'public'` + `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`.

Sem `cron.schedule` — crons `treasury_cat_tick` e `treasury_cat_enqueue` existem em prod (DRIFT) e usam a nova implementação automaticamente.

## Commits

| Task | Commit | Arquivo |
|------|--------|---------|
| Task 1 | `aa45d8bd` | `supabase/functions/sync-tiny-payables/index.ts` |
| Task 2 | `3fd1501a` | `supabase/migrations/20260661000000_enrich_supplier_category.sql` |

## Verificações executadas

```
deno check index.ts → PASS (exit 0)
grep -c 'item.nomeFornecedor' index.ts → 0 (PASS)
grep -c 'item.tipoOrdem' index.ts → 0 (PASS)
grep 'fonte única' index.ts → PASS
grep 'onConflict' index.ts → PASS
test -f 20260661000000... → PASS
grep enrich_payable_step → PASS
grep enrich_enqueue_new → PASS
grep enrich_harvest → PASS
grep 'DO UPDATE' → PASS
grep 'supplier' → PASS
grep -c 'DO NOTHING' → 0 (PASS)
grep REVOKE → PASS
grep cron.schedule → 0 (PASS — sem cron)
```

## Desvios do Plano

Nenhum — plano executado exatamente como escrito.

Nota: a variável `const contato = item.contato ?? {};` foi removida junto com as chaves `supplier`/`category` porque se tornou dead code (era usada exclusivamente no mapeamento de `supplier`). O plano dizia "remover as DUAS propriedades" do objeto — a remoção da variável associada é consequência direta e não constitui desvio.

## Itens Conhecidos (Stubs)

Nenhum stub — os dois artefatos produzem comportamento definitivo:
- O sync para de escrever os campos (testável imediatamente após deploy)
- A migration habilita o enriquecimento de supplier (backfill roda via cron após apply)

## Ação Pendente (Plano 61-02 — Wave 2, feita pelo Orquestrador)

1. **Deploy da Edge Function** `sync-tiny-payables` via `mcp__supabase__deploy_edge_function` no projeto `ckcdevcxgvueywivefgx`
2. **Apply da migration** `20260661000000_enrich_supplier_category.sql` via `mcp__supabase__apply_migration`
3. **Seed da fila** via `SELECT public.enrich_enqueue_new()` (re-marca ~1991 linhas done→todo)
4. **Monitorar backfill** via `SELECT status, count(*) FROM cat_backfill_queue GROUP BY status` enquanto o cron drena (~167 min a 12/min)

## Threat Surface

Nenhum novo endpoint de rede ou path de auth introduzido. As três funções já existiam com SECURITY DEFINER + REVOKE — a migration reaplica o mesmo modelo de segurança. T-61-01 e T-61-02 mitigados conforme o threat model do plano.

## Self-Check

```
PASS — supabase/functions/sync-tiny-payables/index.ts modificado e deno check passa
PASS — supabase/migrations/20260661000000_enrich_supplier_category.sql criado
PASS — commit aa45d8bd (Task 1) verificado em git log
PASS — commit 3fd1501a (Task 2) verificado em git log
```
