# Phase 61: Enriquecer Fornecedor + Categoria do Contas a Pagar — Research

**Pesquisado:** 2026-06-25
**Domínio:** Supabase Edge Functions (Deno) + pg_cron + pg_net + PostgreSQL stored procedures
**Confiança:** HIGH — investigação ao vivo no código-fonte real do repo

---

<user_constraints>
## Restrições do Usuário (de 61-CONTEXT.md)

### Decisões Travadas (LOCKED)

- **Fonte única:** `enrich_payable_step` / `enrich_harvest` vira a única fonte de `category` e `supplier`. O `sync-tiny-payables` **para de escrever esses 2 campos** no upsert.
- **`enrich_harvest`/`enrich_payable_step`** passa a gravar `supplier = contato.nome` além de `category = categoria.descricao`.
- **Reenfileiramento:** o enqueue re-marca `todo` toda linha com `category IS NULL OR supplier IS NULL`, não mais `ON CONFLICT DO NOTHING`.
- **Backfill imediato:** rodar o backfill das ~2011 linhas via fila/cron já existentes (throttle ~1–2 req/s, drain ~20–30 min, server-side e resumível).

### Discrição do Claude

- Como exatamente remover os 2 campos do upsert (objeto de upsert vs. `onConflict`/`ignoreDuplicates`).
- Forma da migration para `enrich_enqueue_new` / `enrich_payable_step` (nova vs. `CREATE OR REPLACE`).
- Mecânica de disparo do backfill (seed da fila + cron drena, vs. `CALL enrich_drain()` manual).

### Ideias Adiadas (FORA DE ESCOPO)

- Enriquecer campos do detalhe Tiny além de `category`/`supplier` (ex.: centro de custo).
- Re-arquitetar o sync para puxar detalhe inline (descartado: manter sync-lista barato + enriquecimento assíncrono).

</user_constraints>

---

## Resumo

A Phase 61 é uma correção de arquitetura de dados, não de UI. Os dois gráficos (`CostCompositionChart` e `SupplierExposureChart`) já consomem os campos corretos de `cash_outflows` — o problema é que `sync-tiny-payables` sobrescreve `category` e `supplier` com NULL em cada sync porque o endpoint LIST do Tiny não retorna esses campos.

A solução tem três frentes: (1) remover 2 chaves do objeto de upsert da EF `sync-tiny-payables`; (2) atualizar `enrich_payable_step` e `enrich_enqueue_new` via nova migration SQL; (3) rodar o backfill das 1991 linhas nulas acionando a fila existente. Nenhuma mudança de frontend é necessária.

**Recomendação principal:** 1 wave com 3 tasks independentes — EF patch (TypeScript), migration SQL (2 funções), execução do backfill (MCP `execute_sql`).

---

## Mapa de Responsabilidade Arquitetural

| Capacidade | Tier Primário | Tier Secundário | Racional |
|------------|---------------|-----------------|----------|
| Sync de lista de contas a pagar | Edge Function (`sync-tiny-payables`) | pg_cron (disparo) | Busca paginada da API Tiny, sem estado |
| Enriquecimento de detalhe por ID | pg_net + pg_cron (server-side) | — | Throttled assíncrono, resumível sem sessão |
| Persistência de category/supplier | `enrich_payable_step` (PostgreSQL) | — | Fonte única de verdade após a correção |
| Leitura para gráficos | RPCs `get_cost_by_month` + `get_supplier_exposure` | Frontend hooks | SECURITY INVOKER, org-scoped |
| Deploy da EF modificada | Orquestrador via MCP `deploy_edge_function` | — | Não o gsd-executor |

---

## 1. `sync-tiny-payables` — Upsert Exato e Mudança Mínima

### Localização
`supabase/functions/sync-tiny-payables/index.ts`

### O objeto de upsert atual (linhas 260–287)

```typescript
// Arquivo: supabase/functions/sync-tiny-payables/index.ts, função processLoja()
const contato = item.contato ?? {};

rows.push({
  organization_id: organizationId,
  outflow_date:    outflowDate,
  amount:          Number(item.valor ?? 0),
  description:     String(item.historico ?? item.descricao ?? "").trim() || `Conta #${tinyPayableId}`,
  supplier:        String(contato.nome ?? item.nomeFornecedor ?? "").trim() || null,  // ← SEMPRE NULL (lista não retorna contato)
  category:        String(item.tipo ?? item.tipoOrdem ?? "").trim() || null,          // ← SEMPRE NULL (lista não retorna tipo real)
  status:          statusNorm,
  document_number: String(item.numeroDocumento ?? item.numero ?? "").trim() || null,
  source:          "tiny",
  tiny_payable_id: tinyPayableId,
  synced_at:       syncAt,
  updated_at:      syncAt,
});
```

### O upsert (linhas 299–304)

```typescript
const { error: upsertErr } = await sb
  .from("cash_outflows")
  .upsert(rows, {
    onConflict: "organization_id,tiny_payable_id",
    ignoreDuplicates: false,   // ← UPDATE on conflict → sobrescreve TODOS os campos do objeto
  });
```

### Por que sobrescreve

`ignoreDuplicates: false` gera `ON CONFLICT DO UPDATE SET <todos os campos do objeto>`. Como `supplier` e `category` estão no objeto com valores NULL, o UPDATE os zera em cada sync. [VERIFIED: código-fonte `index.ts` linha 278–279 + 301–303]

### Mudança mínima — remover 2 chaves do objeto

Remover as chaves `supplier` e `category` do objeto dentro de `rows.push({...})`. Quando uma chave está ausente do objeto de upsert, o PostgREST não a inclui no `UPDATE SET`, preservando o valor existente na linha. Para INSERTs novos, os campos ficam NULL (default da coluna) até o enriquecimento preencher. [ASSUMED — comportamento padrão do PostgREST/Supabase upsert; confirmar que a ausência da chave preserva valor no ON CONFLICT UPDATE]

**Colunas que o sync DEVE continuar gravando** (legítimas da lista):
- `outflow_date`, `amount`, `description`, `status`, `document_number`, `source`, `synced_at`, `updated_at`

**Interface `TinyPayable`** (linhas 152–166): já contém `contato?: { nome?: unknown }` e `nomeFornecedor?: unknown` — o dado exists, só não vem preenchido na lista.

### Checagem de NOT NULL

Schema de `cash_outflows` (migration `20260618100000_cash_flow_tables.sql`, linha 149–150):
```sql
supplier  text,    -- NULLABLE (sem NOT NULL)
category  text,    -- NULLABLE (sem NOT NULL)
```
Remover os campos do objeto de upsert não viola nenhuma constraint. [VERIFIED: código-fonte migration linha 149–150]

### Sobre as 20 linhas "Previsões de compra"

Essas 20 linhas têm `category` preenchido atualmente porque `item.tipo` no endpoint LIST retorna `'Previsões de compra'` para ordens de compra (OCs). Após remover `category` do upsert:
- **Linhas existentes:** preservadas (ON CONFLICT não as zera mais)
- **Novas OCs:** category = NULL até o enriquecimento preencher (o detalhe retornará `categoria.descricao = 'Previsões de compra'` ou equivalente)
- **Não é regressão** — o enriquecimento corrige de qualquer forma

---

## 2. Pipeline de Enriquecimento Phase 51 — Estado Real

### Crons ativos em prod (documentados em `20260650000300`, linhas 7–8)

| Cron | Schedule | Função chamada |
|------|----------|----------------|
| `treasury_cat_enqueue` | `*/30 * * * *` | `SELECT public.enrich_enqueue_new()` |
| `treasury_cat_tick` | `* * * * *` (ou 15s) | `SELECT public.enrich_payable_step(12)` |
| `treasury_cat_drain` | `* * * * *` (legado) | `CALL public.enrich_drain(50, 1.0)` |
| `treasury_cat_harvest` | `* * * * *` (legado) | `SELECT public.enrich_harvest()` |

Os crons `treasury_cat_enqueue` e `treasury_cat_tick` foram criados em prod fora do repo (DRIFT documentado). A nova migration usa `CREATE OR REPLACE FUNCTION` — os crons existentes passam a usar a implementação atualizada automaticamente.

### `enrich_enqueue_new()` — bug atual e correção

**Arquivo:** `supabase/migrations/20260650000300_cr01_backfill_pipeline_multitenant.sql`, linhas 19–47

**Código atual (problemático):**
```sql
INSERT INTO public.cat_backfill_queue (tiny_payable_id, organization_id, ml_user_id, status)
SELECT DISTINCT co.tiny_payable_id, co.organization_id, t.ml_user_id, 'todo'
FROM public.cash_outflows co
JOIN LATERAL (
  SELECT ml.ml_user_id FROM public.ml_tokens ml
  WHERE ml.organization_id = co.organization_id
    AND ml.tiny_access_token IS NOT NULL
  LIMIT 1
) t ON true
WHERE (co.category IS NULL OR TRIM(co.category) = '')  -- ← só filtra category
  AND co.tiny_payable_id IS NOT NULL
ON CONFLICT (tiny_payable_id) DO NOTHING;              -- ← nunca re-marca rows 'done'
```

**Dois problemas:**
1. `WHERE` só checa `category IS NULL` — não enfileira rows onde só `supplier` está nulo
2. `ON CONFLICT DO NOTHING` — rows `done` nunca são re-enfileiradas mesmo que o sync as tenha zerado

**Correção:**
```sql
-- Mudança 1: WHERE inclui supplier IS NULL
WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL)
  AND co.tiny_payable_id IS NOT NULL
-- Mudança 2: ON CONFLICT re-marca 'done'/'error' como 'todo'
ON CONFLICT (tiny_payable_id) DO UPDATE
  SET status = 'todo', updated_at = now()
  WHERE cat_backfill_queue.status IN ('done', 'error');
-- (não resetar 'todo'/'sent' para não perder requisições em voo)
```

### `enrich_payable_step()` — harvest e disparo

**Arquivo:** `supabase/migrations/20260650000300_cr01_backfill_pipeline_multitenant.sql`, linhas 50–116

**Seção harvest atual (linhas 68–91):**
```sql
ELSIF v_status = 200 THEN
  v_cat := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
  UPDATE public.cash_outflows SET category = v_cat
    WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
  UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
    WHERE tiny_payable_id = r.tiny_payable_id;
  v_done := v_done + 1;
```

**Correção — adicionar `supplier`:**
```sql
ELSIF v_status = 200 THEN
  v_cat      := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
  v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');
  UPDATE public.cash_outflows
    SET category = v_cat, supplier = v_supplier
    WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
  UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
    WHERE tiny_payable_id = r.tiny_payable_id;
  v_done := v_done + 1;
```

Adicionar declaração de variável no `DECLARE`: `v_supplier text;`

**Mesmo padrão vale para `enrich_harvest()`** (em `20260650000100`, linha 79) — mas como o pipeline ativo usa `enrich_payable_step`, a prioridade é essa. `enrich_harvest` pode ser atualizado por consistência.

### Estrutura do JSON de detalhe do Tiny

Confirmado pelo uso em prod (`v_content->'categoria'->>'descricao'` e `v_content->'contato'->>'nome'`):
```json
{
  "id": "...",
  "categoria": { "descricao": "Fornecedores" },
  "contato": { "nome": "Pralana" },
  ...
}
```

O campo `contato.nome` já existe no mesmo payload que `categoria.descricao` — sem chamada adicional à API. [VERIFIED: código-fonte `20260650000300` linha 75 + interface `TinyPayable` linha 159]

---

## 3. Chamada ao Detalhe do Tiny — Confirmação

O `enrich_payable_step` usa `net.http_get` (pg_net) para chamar o detalhe:
```sql
req_id = net.http_get(
  url     := 'https://api.tiny.com.br/public-api/v3/contas-pagar/' || r.tiny_payable_id,
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_token,
    'Accept', 'application/json'
  )
)
```

A resposta fica em `net._http_response WHERE id = r.req_id`. O harvest lê `resp.status_code` e `resp.content::jsonb`.

**Throttle:** `enrich_drain` usa `pg_sleep(p_sleep)` (1s por request). `enrich_payable_step` dispara 12 por tick; com tick a cada minuto = 12/min (bem abaixo do limite de ~100 req/min do Tiny). Rate limit 429 → row volta para `status='todo'` (retry automático). [VERIFIED: código-fonte `20260650000100` linha 54 + `20260650000300` linhas 80–88]

---

## 4. Convenções de Migration e Deploy

### Naming de migration

Padrão observado em prod:
- `YYYYMM` + número da phase (2 dígitos) + `000000` (sequência começando em 0)
- Phase 59: `20260659000000`, `20260659000200`, `20260659000300`
- Phase 60: `20260660000000`, `20260660000200`
- **Phase 61:** primeiro arquivo = `20260661000000_enrich_supplier_category.sql`

### Padrão SQL das migrations (SECURITY INVOKER)

```sql
-- Funções de leitura (RPCs expostas ao frontend):
CREATE OR REPLACE FUNCTION public.nome_funcao(p_org_id UUID, ...)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public'
AS $$...$$;

REVOKE EXECUTE ON FUNCTION public.nome_funcao(...) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nome_funcao(...) TO authenticated;
```

```sql
-- Procedures do pipeline server-side (chamadas por pg_cron):
CREATE OR REPLACE PROCEDURE public.enrich_drain(...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$...$$;

REVOKE EXECUTE ON PROCEDURE public.enrich_drain(...) FROM PUBLIC, anon, authenticated;
```

**Regra CLAUDE.md:** NUNCA usar `supabase db push` (CLI linkado ao projeto errado `gionpsuunfkkzzjdubfy`). Aplicar migrations via `mcp__supabase__apply_migration` no projeto `ckcdevcxgvueywivefgx`.

### Deploy de Edge Function

```
mcp__supabase__deploy_edge_function (supabase MCP tool)
  → project_id: "ckcdevcxgvueywivefgx"
  → name: "sync-tiny-payables"
```

O `gsd-executor` **não deploya** EFs. O orquestrador (Claude direto) usa o MCP. [ASSUMED (baseado em memória do projeto): confirmar via CLAUDE.md + memory `gsd-executor não deploya EF`]

---

## 5. Os Dois Gráficos — Confirmação de Fonte

### Composição de Custos por Mês

| Item | Valor |
|------|-------|
| Componente | `src/components/financial/CostCompositionChart.tsx` |
| Hook | `src/hooks/useCostByMonth.ts` |
| RPC | `public.get_cost_by_month(p_org_id uuid, p_months int)` |
| Definida em | `supabase/migrations/20260650000100_treasury_category_backfill.sql`, linha 104 |
| Campo lido | `cash_outflows.category` (com `COALESCE(NULLIF(TRIM(co.category),''),'Outros')`) |
| Frontend change? | **Nenhuma** — já funciona com dados reais, só faltam os dados |

**Comportamento atual:** com 1991/2011 linhas tendo `category IS NULL`, a RPC retorna `COALESCE(..., 'Outros')` para todas → barra única "Outros".

### Exposição por Fornecedor

| Item | Valor |
|------|-------|
| Componente | `src/components/financial/SupplierExposureChart.tsx` |
| Hook | `src/hooks/useSupplierExposure.ts` |
| RPC | `public.get_supplier_exposure(p_org_id uuid, p_top_n int DEFAULT 10)` |
| Definida em | `supabase/migrations/20260650000000_treasury_panel.sql`, linhas 274–306 |
| Campo lido | `cash_outflows.supplier` (WHERE `supplier IS NOT NULL AND status='pending'`) |
| Frontend change? | **Nenhuma** — já filtra `supplier IS NOT NULL`; mais dados = mais barras |

**Comportamento atual:** com 1991/2011 linhas com `supplier IS NULL`, só as 20 OCs com `supplier='Pralana'` aparecem.

**Phase 60 preservada:** `get_supplier_exposure` e `get_cost_by_month` **não recebem** o parâmetro `p_include_purchase_forecasts` (explicitamente excluídos em `20260660000200`, linha 19). Isso é correto e não muda nesta phase.

---

## 6. Fontes Únicas — Auditoria de Outros Escritores

### Quem escreve em `cash_outflows.category` / `cash_outflows.supplier` hoje

| Fonte | Campo escrito | Após fix |
|-------|---------------|----------|
| `sync-tiny-payables` EF | `supplier`, `category` (NULL) | **Remove** os 2 campos do upsert |
| `enrich_payable_step()` | `category` | Adiciona `supplier` |
| `enrich_harvest()` | `category` | Adicionar `supplier` por consistência |
| Qualquer outra EF | — | Nenhuma outra EF escreve em `cash_outflows` [VERIFIED: grep em `supabase/functions/`] |
| Migrations (direto) | — | Nenhuma migration faz INSERT/UPDATE direto com category/supplier [VERIFIED: grep] |

Após a correção, `enrich_payable_step` é a **única** fonte de `category` e `supplier`.

---

## 7. Mecânica do Backfill

### Estado atual da fila (estimado)

- `cash_outflows`: 2011 linhas totais; 1991 com `category IS NULL E supplier IS NULL`
- `cat_backfill_queue`: rows `done` que foram zeradas pelo sync (não re-enfileiradas por `ON CONFLICT DO NOTHING`)

### Estratégia recomendada: seed + cron drena

**Passo 1 — Aplicar a migration** (nova `enrich_enqueue_new` + `enrich_payable_step` com `supplier`).

**Passo 2 — Seed imediato da fila:**
```sql
SELECT public.enrich_enqueue_new();
-- Retorna: { "enqueued_now": 1991, "queue_open": 1991, "done_total": 0 }
```

O `ON CONFLICT DO UPDATE SET status='todo'` re-marca as rows `done` existentes como `todo`.

**Passo 3 — Deixar o cron drenar:**
- `treasury_cat_tick` (a cada minuto): `enrich_payable_step(12)` — harvest + dispara 12
- A cada minuto: ~12 enrichments confirmados (status 200)
- 1991 linhas ÷ 12/min ≈ **167 minutos** (~2h45min total, server-side, resumível)

### Monitoramento de progresso (via MCP `execute_sql`)

```sql
-- Estado da fila
SELECT status, count(*) FROM public.cat_backfill_queue GROUP BY status ORDER BY 1;

-- Progresso de enriquecimento
SELECT
  count(*)                                          AS total,
  count(*) FILTER (WHERE category IS NOT NULL)      AS com_category,
  count(*) FILTER (WHERE supplier IS NOT NULL)      AS com_supplier,
  count(*) FILTER (WHERE category IS NOT NULL AND supplier IS NOT NULL) AS ambos,
  round(
    100.0 * count(*) FILTER (WHERE category IS NOT NULL AND supplier IS NOT NULL)
    / NULLIF(count(*), 0), 1
  )                                                  AS pct_completo
FROM public.cash_outflows
WHERE source = 'tiny';

-- Diversidade (critério de sucesso)
SELECT count(DISTINCT category), count(DISTINCT supplier)
FROM public.cash_outflows
WHERE category IS NOT NULL AND supplier IS NOT NULL;
```

### Alternativa manual mais rápida

Se o Wesley quiser acelerar: chamar `CALL public.enrich_drain(200, 0.6)` via MCP `execute_sql` — drena 200 linhas com 600ms entre requests (~2 min para 200, seguro dentro do rate limit Tiny). Mas requer sessão longa. O cron é mais seguro.

### Resumabilidade

Se a sessão cair ou o Deno der timeout, o cron retoma automaticamente. Rows `sent` com req_id pendente são colhidas no próximo tick. Rows `error` (>4 tentativas) ficam nesse status — podem ser re-enfileiradas manualmente se necessário.

---

## 8. Padrões "Não Re-Inventar"

| Problema | Não construir | Usar em vez disso |
|----------|---------------|-------------------|
| Throttle de API externa | Rate limiter customizado | `pg_sleep(p_sleep)` no loop da procedure (padrão já validado em prod) |
| Retry de 429 | Lógica própria | O próprio `enrich_payable_step` já reloca para `status='todo'` no 429 |
| Deploy de EF | Script shell | MCP `deploy_edge_function` (padrão do projeto) |
| Apply de migration | CLI `supabase db push` | MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` |

---

## 9. Pitfalls Comuns

### Pitfall 1: Upsert com objeto parcial no Supabase JS

**O que pode dar errado:** ao remover `supplier` e `category` do row object, garantir que o `rows.push({})` não tenha `undefined` vs ausência da chave. `undefined` em JSON é serializado como ausência de chave — OK. Mas se alguém adicionar `supplier: undefined` explicitamente, o PostgREST pode interpretar como `NULL` em algumas versões.

**Como evitar:** simplesmente não incluir as chaves no objeto literal. Não atribuir `undefined`.

### Pitfall 2: ON CONFLICT DO UPDATE com condição na tabela referenciada

**O que pode dar errado:** `ON CONFLICT DO UPDATE SET ... WHERE cat_backfill_queue.status IN (...)` — o `WHERE` na cláusula `ON CONFLICT DO UPDATE` usa o nome completo da tabela, não um alias.

**Como evitar:** usar `excluded` para os valores novos e o nome da tabela para os atuais:
```sql
ON CONFLICT (tiny_payable_id) DO UPDATE
  SET status = 'todo', updated_at = now()
  WHERE cat_backfill_queue.status IN ('done', 'error');
```

### Pitfall 3: Cron `treasury_cat_tick` fora do repo

**O que pode dar errado:** assumir que a migration recria o cron. O cron existe em prod via DRIFT (não está no repo). A migration só atualiza as funções. O cron continua apontando para as mesmas funções e passa a usar o novo código automaticamente.

**Como evitar:** a migration NÃO precisa recriar os crons. Só `CREATE OR REPLACE FUNCTION` nas duas funções.

### Pitfall 4: `enrich_payable_step` não declara `v_supplier`

Se `v_supplier text;` não for adicionado ao bloco `DECLARE`, o PostgreSQL retorna erro de sintaxe. A modificação da função DEVE incluir a declaração de variável.

### Pitfall 5: Regressão Phase 60 no `get_cashflow`

O `get_cashflow` (4 args) filtra `COALESCE(co.category,'') <> 'Previsões de compra'`. Após o backfill, as ~20 OCs terão `category` preenchido pela enrichment (provavelmente `'Previsões de compra'` ou o nome real no Tiny). O toggle OFF continuará excluindo essas linhas corretamente. **Sem risco de regressão** — a lógica usa o valor do campo, não verifica NULL.

### Pitfall 6: `get_supplier_exposure` retorna menos dados do que o esperado

A RPC filtra `supplier IS NOT NULL AND status='pending'`. Após o backfill, apenas contas `pending` com `supplier` preenchido aparecem. Contas `paid` não aparecem — correto por design (gráfico de exposição futura).

---

## 10. Exemplos de Código Verificados

### Remoção de `supplier` e `category` do `rows.push` (sync-tiny-payables)

Antes (linhas 273–287 de `index.ts`):
```typescript
rows.push({
  organization_id: organizationId,
  outflow_date:    outflowDate,
  amount:          Number(item.valor ?? 0),
  description:     String(item.historico ?? item.descricao ?? "").trim() || `Conta #${tinyPayableId}`,
  supplier:        String(contato.nome ?? item.nomeFornecedor ?? "").trim() || null,  // ← REMOVER
  category:        String(item.tipo ?? item.tipoOrdem ?? "").trim() || null,          // ← REMOVER
  status:          statusNorm,
  document_number: String(item.numeroDocumento ?? item.numero ?? "").trim() || null,
  source:          "tiny",
  tiny_payable_id: tinyPayableId,
  synced_at:       syncAt,
  updated_at:      syncAt,
});
```

Depois (remover só as 2 linhas marcadas — tudo o mais permanece):
```typescript
rows.push({
  organization_id: organizationId,
  outflow_date:    outflowDate,
  amount:          Number(item.valor ?? 0),
  description:     String(item.historico ?? item.descricao ?? "").trim() || `Conta #${tinyPayableId}`,
  // supplier e category removidos: enriquecimento é a fonte única
  status:          statusNorm,
  document_number: String(item.numeroDocumento ?? item.numero ?? "").trim() || null,
  source:          "tiny",
  tiny_payable_id: tinyPayableId,
  synced_at:       syncAt,
  updated_at:      syncAt,
});
```

O `upsert` com `ignoreDuplicates: false` e `onConflict: "organization_id,tiny_payable_id"` permanece inalterado.

### Migration SQL — `enrich_enqueue_new` atualizada

```sql
-- supabase/migrations/20260661000000_enrich_supplier_category.sql
CREATE OR REPLACE FUNCTION public.enrich_enqueue_new()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_added int := 0;
BEGIN
  INSERT INTO public.cat_backfill_queue (tiny_payable_id, organization_id, ml_user_id, status)
  SELECT DISTINCT co.tiny_payable_id, co.organization_id, t.ml_user_id, 'todo'
  FROM public.cash_outflows co
  JOIN LATERAL (
    SELECT ml.ml_user_id FROM public.ml_tokens ml
    WHERE ml.organization_id = co.organization_id
      AND ml.tiny_access_token IS NOT NULL
    LIMIT 1
  ) t ON true
  WHERE (co.category IS NULL OR TRIM(co.category) = '' OR co.supplier IS NULL)  -- ← MUDANÇA 1
    AND co.tiny_payable_id IS NOT NULL
  ON CONFLICT (tiny_payable_id) DO UPDATE                                        -- ← MUDANÇA 2
    SET status = 'todo', updated_at = now()
    WHERE cat_backfill_queue.status IN ('done', 'error');
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object(
    'enqueued_now', v_added,
    'queue_open',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total',  (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_enqueue_new() FROM PUBLIC, anon, authenticated;
```

### Migration SQL — `enrich_payable_step` com `supplier`

```sql
CREATE OR REPLACE FUNCTION public.enrich_payable_step(p_batch integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token   text;
  r         record;
  v_cat     text;
  v_supplier text;   -- ← NOVO
  v_status  int;
  v_content jsonb;
  v_done    int := 0;
  v_retry   int := 0;
  v_err     int := 0;
  v_fired   int := 0;
BEGIN
  -- harvest das respostas pendentes
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='sent' AND req_id IS NOT NULL LOOP
    SELECT resp.status_code, resp.content::jsonb INTO v_status, v_content
    FROM net._http_response resp WHERE resp.id = r.req_id;

    IF v_status IS NULL THEN
      CONTINUE;
    ELSIF v_status = 200 THEN
      v_cat      := COALESCE(NULLIF(TRIM(v_content->'categoria'->>'descricao'), ''), 'Outros');
      v_supplier := NULLIF(TRIM(COALESCE(v_content->'contato'->>'nome', '')), '');  -- ← NOVO
      UPDATE public.cash_outflows
        SET category = v_cat, supplier = v_supplier          -- ← MUDANÇA: adiciona supplier
        WHERE tiny_payable_id = r.tiny_payable_id AND organization_id = r.organization_id;
      UPDATE public.cat_backfill_queue SET status='done', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_done := v_done + 1;
    ELSIF v_status = 429 THEN
      UPDATE public.cat_backfill_queue SET status='todo', req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_retry := v_retry + 1;
    ELSE
      UPDATE public.cat_backfill_queue
        SET status=CASE WHEN attempts >= 4 THEN 'error' ELSE 'todo' END,
            req_id=NULL, attempts=attempts+1, updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      v_err := v_err + 1;
    END IF;
  END LOOP;

  -- dispara novas requisicoes (inalterado)
  FOR r IN SELECT * FROM public.cat_backfill_queue WHERE status='todo' ORDER BY updated_at LIMIT p_batch LOOP
    SELECT tiny_access_token INTO v_token FROM public.ml_tokens WHERE ml_user_id = r.ml_user_id LIMIT 1;
    IF v_token IS NULL THEN
      UPDATE public.cat_backfill_queue SET status='error', updated_at=now()
        WHERE tiny_payable_id = r.tiny_payable_id;
      CONTINUE;
    END IF;
    UPDATE public.cat_backfill_queue
      SET status='sent', updated_at=now(),
          req_id = net.http_get(
            url := 'https://api.tiny.com.br/public-api/v3/contas-pagar/' || r.tiny_payable_id,
            headers := jsonb_build_object('Authorization','Bearer '||v_token,'Accept','application/json'))
      WHERE tiny_payable_id = r.tiny_payable_id;
    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'harvested_done', v_done, 'retry_429', v_retry, 'errors', v_err, 'fired', v_fired,
    'remaining', (SELECT count(*) FROM public.cat_backfill_queue WHERE status IN ('todo','sent')),
    'done_total', (SELECT count(*) FROM public.cat_backfill_queue WHERE status='done')
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.enrich_payable_step(integer) FROM PUBLIC, anon, authenticated;
```

---

## Disponibilidade de Ambiente

> Relevante para a execução do backfill e deploy da EF.

| Dependência | Requerido por | Disponível | Versão | Fallback |
|-------------|---------------|-----------|--------|----------|
| Supabase MCP (`apply_migration`) | Aplicar SQL | ✓ | — | — |
| Supabase MCP (`deploy_edge_function`) | Deploy EF | ✓ | — | — |
| Supabase MCP (`execute_sql`) | Monitorar backfill | ✓ | — | — |
| pg_cron `treasury_cat_tick` | Drenar fila | ✓ (drift em prod) | — | `CALL enrich_drain()` manual |
| Tiny API rate limit | Enriquecimento | ✓ | ~100 req/min | Retry automático no 429 |

---

## Inventário de Estado de Runtime

> Phase 61 modifica dados em prod — relevante.

| Categoria | Itens encontrados | Ação necessária |
|-----------|-------------------|-----------------|
| Dados armazenados | `cat_backfill_queue`: rows `done` com `tiny_payable_id` das 1991 linhas zeradas pelo sync | `enrich_enqueue_new()` re-marca `done→todo` após a migration |
| Dados armazenados | `cash_outflows`: 1991 linhas com `category=NULL, supplier=NULL` | Backfill via cron drena em ~2h45min |
| Config de serviço live | Crons `treasury_cat_tick` e `treasury_cat_enqueue` em prod (DRIFT) | Não recriar — só atualizar as funções via `CREATE OR REPLACE` |
| Secrets/env vars | Nenhum novo secret necessário | Nenhuma ação |
| Artefatos de build | Nenhum afetado | Nenhuma ação |

---

## Arquitetura de Validação

### Comandos de validação SQL (executar via MCP `execute_sql`)

```sql
-- 1. Verificar que o sync parou de escrever category/supplier
--    (rodarem sync manualmente e verificar que contagens não caem)
SELECT count(*) FILTER (WHERE category IS NOT NULL) AS com_cat,
       count(*) FILTER (WHERE supplier IS NOT NULL) AS com_sup
FROM cash_outflows WHERE source='tiny';

-- 2. Estado da fila pós-seed
SELECT status, count(*) FROM cat_backfill_queue GROUP BY status;

-- 3. Critério de sucesso quantitativo
SELECT
  count(*) FILTER (WHERE category IS NOT NULL AND supplier IS NOT NULL) AS enriched,
  count(*)                                                               AS total,
  count(DISTINCT category) FILTER (WHERE category IS NOT NULL)          AS distinct_cats,
  count(DISTINCT supplier) FILTER (WHERE supplier IS NOT NULL)          AS distinct_suppliers
FROM cash_outflows WHERE source='tiny';
-- Esperado: enriched >= 1809 (90%), distinct_cats > 1, distinct_suppliers > 1
```

### Critérios de sucesso da phase

| # | Critério | Verificação |
|---|----------|-------------|
| 1 | Sync não sobrescreve category/supplier | Rodar sync → contar; contagem não cai |
| 2 | `enrich_payable_step` escreve `supplier` | Verificar coluna após harvest de 1 row |
| 3 | Fila re-enfileira rows `done` | `SELECT status FROM cat_backfill_queue WHERE status='done'` → 0 após seed |
| 4 | 90%+ das linhas enriquecidas | SQL acima: `enriched / total >= 0.9` |
| 5 | Gráficos mostram dados reais | Visual: ≥3 categorias + ≥2 fornecedores |
| 6 | Phase 60 sem regressão | Toggle OFF = R$87.105,79 (reconciliação invariante) |

---

## Log de Suposições

| # | Afirmação | Seção | Risco se errada |
|---|-----------|-------|-----------------|
| A1 | Ausência de chave no objeto de upsert do Supabase JS preserva o valor existente no `ON CONFLICT DO UPDATE` (não grava NULL) | §1 Mudança mínima | Se errada, remover a chave ainda zeraria o campo → precisaria usar `supabase-js` com query SQL manual ou adicionar um trigger de proteção |
| A2 | `contato.nome` está disponível no payload do detalhe `/contas-pagar/{id}` (mesma resposta que `categoria.descricao`) | §3 Chamada ao detalhe | Se o detalhe não retornar `contato.nome`, o `supplier` ficaria NULL mesmo após enrichment → precisaria inspecionar o payload real |
| A3 | Os crons `treasury_cat_tick` e `treasury_cat_enqueue` ainda estão ativos em prod | §2 Crons ativos | Se tiverem sido desativados, o backfill não drena → precisaria recriar os crons na migration |
| A4 | Deploy da EF via `deploy_edge_function` (não gsd-executor) | §4 Deploy | Se o MCP de deploy não funcionar, precisaria de alternativa CLI (mas é padrão confirmado do projeto) |

---

## Fontes

### Primárias (HIGH confidence — código-fonte verificado)
- `supabase/functions/sync-tiny-payables/index.ts` — upsert object linhas 260–287, chamada upsert linhas 299–304
- `supabase/migrations/20260650000300_cr01_backfill_pipeline_multitenant.sql` — `enrich_enqueue_new` + `enrich_payable_step`
- `supabase/migrations/20260650000100_treasury_category_backfill.sql` — `enrich_harvest` + `enrich_drain`
- `supabase/migrations/20260650000000_treasury_panel.sql` — `get_supplier_exposure` linhas 274–306
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — schema de `cash_outflows` linhas 143–158
- `supabase/migrations/20260660000200_cashflow_saldo_indicators_forecasts.sql` — confirmação de que `get_supplier_exposure`/`get_cost_by_month` NÃO mudam com o toggle
- `src/hooks/useCostByMonth.ts` — frontend hook `get_cost_by_month`
- `src/hooks/useSupplierExposure.ts` — frontend hook `get_supplier_exposure`

### Metadados

**Breakdown de confiança:**
- Upsert sync: HIGH — verificado no código-fonte exato
- Pipeline de enriquecimento: HIGH — verificado nas migrations
- Frontend (gráficos): HIGH — código-fonte dos hooks e componentes verificados
- Comportamento do upsert JS sem a chave: ASSUMED (A1) — verificar em execução

**Data de pesquisa:** 2026-06-25
**Válido até:** 2026-07-25 (funções estáveis; dependência do Tiny API pode mudar)
