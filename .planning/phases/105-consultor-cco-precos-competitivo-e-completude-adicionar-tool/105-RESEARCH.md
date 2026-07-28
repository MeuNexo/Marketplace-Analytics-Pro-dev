# Phase 105: Consultor CCO — Preços, competitivo e completude - Research

**Researched:** 2026-07-28
**Domain:** Supabase Edge Function (`nexo-chat`) function-calling tools — read-only wrappers over 1 RPC-pair, 1 RPC+table join, 1 external-EF-with-real-JWT, 1 plain RPC — plus playbook/persona text.
**Confidence:** HIGH (all claims verified by direct read of live repo source, not training data — this phase has no new external library/framework surface)

## Summary

Phase 105 closes the "Consultor CCO Completo" milestone by adding 4 read-only tools to
`supabase/functions/nexo-chat/tools.ts`, following the exact "org-only" / "org+mlUserIds" /
"EF-via-ctx.userJwt" molds already validated and shipped in Phases 103 and 104 (27→31 tools).
Three of the four tools are straightforward RPC wrappers with **confirmed live signatures**
(`get_cmv_cheio_gaps`, `get_cancelled_revenue` both `(p_org_id uuid, p_user_ids text[], p_from date, p_to date)`,
`SECURITY INVOKER`, mandatory date range — no defaults in SQL, so the tool must supply the
existing 30-day `from`/`to` fallback already computed at the top of `dispatchTool`).

The fourth tool, `get_price_practiced`, is a **join** between `orders_sold_products_agg` (RPC,
item-level aggregate — **no per-SKU/variation breakdown, no direct price column**; "preço
praticado" must be derived as `receita_bruta / quantidade`) and `ml_mco_targets` (plain table,
org-scoped, keyed by `item_id + sku` with `sku=''` sentinel meaning "whole listing"). Because the
RPC only aggregates by `item_id` (not `sku`), the join can only reliably match the `sku=''`
("anúncio inteiro") targets — per-variation targets (`sku != ''`) have no matching row in the
RPC output and must be surfaced as unmatched/orphaned, not silently dropped or mis-joined.

The fifth research finding is the most consequential: `get_competitive_price` wraps the edge
function `ml-precos-custos`, and the CONTEXT's assumption ("modo `references`") is **half right,
half wrong** — the query parameter is literally named `type` (not `mode`), i.e.
`?type=references`, confirmed by reading `index.ts` line 337. More importantly, this EF is
**not** a simple service-role-callable RPC wrapper: `getUserAndToken()` in `ml-precos-custos/index.ts`
calls `supabase.auth.getUser(bearerToken)`, which requires a **real user JWT** — the service-role
key used everywhere else in `dispatchTool` is an `sb_secret_...` opaque secret (per this project's
memory: "SUPABASE_SERVICE_ROLE_KEY = `sb_secret_` (vault Pattern B, não JWT legacy)"), not a JWT,
so it would fail `auth.getUser()` outright. `get_competitive_price` **must** follow the
`get_reputation` mold exactly: accept `ctx.userJwt`, return `{error:"sem_jwt", label}` when absent
(never invented data), and invoke the EF with `Authorization: Bearer ${ctx.userJwt}` per store in
`mlUserIds` (server-derived, never from the model).

**Primary recommendation:** Implement all 4 tools by literal copy of the Phase 103/104 org-only
pattern for `get_cost_gaps`/`get_cancelled_revenue`; a bespoke RPC+table join (no `p_org_id` param
on the RPC itself — anti-IDOR relies 100% on server-derived `mlUserIds`, mirroring the `get_goals`
"only-mlUserIds" pattern) for `get_price_practiced`; and a literal copy of the `get_reputation`
fetch-with-JWT mold for `get_competitive_price`, using `type=references` (not `mode`) and looping
over `ctx.userJwt` + each store in `mlUserIds`.

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

**Padrão (herdado de 103/104 — validado)**
- Anti-IDOR "org-only" (molde get_coverage/get_treasury_panel); p_org_id do servidor; args de org/seller ignorados.
- Cap MAX_ROWS; summary+sample quando o retorno for grande. Read-only estrito.
- Contagem de tools 31→35 em tools.test.ts. NÃO quebrar greps de prompt.test.ts nem remover conteúdo de playbooks.

**get_price_practiced → orders_sold_products_agg + ml_mco_targets**
- Cruza preço praticado (histórico de preço vendido, agregado) com a meta de MCO (ml_mco_targets). Confirmar assinatura
  de orders_sold_products_agg (params: janela? variação? por SKU?) e o schema de ml_mco_targets (select direto → .eq('organization_id', orgId)).
- Rótulo: preço praticado é histórico; meta MCO é alvo cadastrado (pode não existir p/ todo SKU → declarar limitação).

**get_competitive_price → edge fn ml-precos-custos (modo references)**
- ÚNICA fonte de dado competitivo real (sugestão de preço competitiva + calculadora de comissão). Precisa de item(s) ML.
- ATENÇÃO: é EDGE FUNCTION, não RPC. Ver como get_reputation invoca EF via ctx.userJwt (a ml-precos-custos pode exigir
  JWT do usuário). Confirmar no research: params da EF (modo references exige item_id?), se exige JWT real, como escopar anti-IDOR.
- Rótulo: sugestão competitiva do ML, NÃO garantia; é subconjunto/indicativo. Este é o pilar Rafael — sem inventar concorrente.

**get_cost_gaps → get_cmv_cheio_gaps**
- Retorna QUAIS SKUs estão sem custo (não só a contagem). Útil para "posso confiar na margem?" e completude.
- Contexto garment: revenda (org Thales) tem custo ausente por natureza (custo não está no Tiny) — rótulo deve dizer que
  custo ausente pode ser legítimo (revenda), não necessariamente erro.

**get_cancelled_revenue → get_cancelled_revenue**
- Receita de pedidos cancelados. Rótulo: cancelado ≠ faturamento; complementa get_sales_kpis.

**Playbook Rafael (ampliar bloco "4. RAFAEL — Inteligência Competitiva" em playbooks.ts)**
- Agora com dado real: preço total (preço + frete) vs concorrente; quando reagir a concorrente vs manter margem;
  usar a sugestão competitiva do ML como sinal, não ordem. Estilo DADO→Diagnóstico→Ação→Métrica; citar fontes; não remover.

**Persona prompt.ts (FINALIZAÇÃO da milestone)**
- "USO DAS FERRAMENTAS": garantir que TODAS as tools novas (103: replenishment/suppliers; 104: DRE/caixa/impostos;
  105: preço praticado/competitivo/cost_gaps/cancelada) estejam citadas com quando usar.
- VERACIDADE: preço competitivo = sugestão, não garantia; custo ausente pode ser legítimo (revenda); cancelado ≠ faturamento.
- NÃO quebrar greps de prompt.test.ts.

**Testes**
- Espelhar 103/104: anti-IDOR org-only, cap, rótulos; a de get_competitive_price precisa testar o caminho de EF (mock do fetch/EF como get_reputation).

### Claude's Discretion
- Se get_competitive_price precisar de item_id do modelo (input não-sensível) — definir; nunca aceitar org/seller do modelo.
- Formato dos retornos respeitando cap.

### Deferred Ideas (OUT OF SCOPE)
- RAG / embeddings da base de conhecimento → Fase 2 (quando a base crescer).
</user_constraints>

## Project Constraints (from CLAUDE.md)

The `./CLAUDE.md` in this repo describes an unrelated legacy module ("Módulo Fiscal — Tributação
por Regime", Supabase project `gionpsuunfkkzzjdubfy`) that does **not** apply to the
`garment-glow-test` / Consultor CCO work (which targets `ckcdevcxgvueywivefgx`, per
`docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` §2 and the 103/104 plans).
The GSD workflow-enforcement block *does* apply generally (use `/gsd-execute-phase` for planned
phase work; no direct edits outside a GSD workflow). No CLAUDE.md directive conflicts with this
phase's plan.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| (none listed explicitly in 105-CONTEXT.md `requirements` — inherit ids from spec Grupos 3+4) | `get_price_practiced`, `get_competitive_price`, `get_cost_gaps`, `get_cancelled_revenue`, playbook Rafael ampliado, persona FINAL | All 4 RPCs/EF confirmed live in this doc (§ Architecture Patterns / Code Examples); playbook insertion point and persona insertion points confirmed by direct read of `playbooks.ts`/`prompt.ts`/`prompt.test.ts`. |

Note for planner: unlike 103-01-PLAN.md / 104-01-PLAN.md (which had explicit `CCO-*` requirement
IDs in their plan frontmatter), 105-CONTEXT.md does not enumerate requirement IDs. The planner
should mint them following the same convention (e.g. `CCO-PRICE`, `CCO-COMPETITIVE`, `CCO-GAPS`,
`CCO-CANCELLED`, `CCO-PLAYBOOK-R`, `CCO-PERSONA-FINAL`, `CCO-TESTS-105`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool declaration + dispatch (`get_price_practiced`, `get_competitive_price`, `get_cost_gaps`, `get_cancelled_revenue`) | API / Backend (Supabase Edge Function `nexo-chat`, Deno) | — | Same tier as all 31 existing tools; no new tier introduced. |
| Preço praticado × meta MCO join | Database / Storage (RPC `orders_sold_products_agg` + table `ml_mco_targets`, both already exist) | API / Backend (join logic lives in `dispatchTool`, not a new RPC) | RPC does the heavy aggregation (295k+ `orders` rows); the join with `ml_mco_targets` is cheap (few hundred rows) and belongs in the EF, not a new SQL function — consistent with `get_goals` doing its meta×realizado join in `dispatchTool` today. |
| Sugestão de preço competitiva | API / Backend (edge function `ml-precos-custos`, already deployed, calls ML's own `/suggestions` API) | External Service (Mercado Livre API) | `nexo-chat` is a *consumer* of an existing EF, exactly like it already consumes `ml-reputation`. No new external integration is created. |
| SKUs sem custo (completude) | Database / Storage (RPC `get_cmv_cheio_gaps`) | — | Pure aggregation RPC, `SECURITY INVOKER`, already exists. |
| Receita cancelada | Database / Storage (RPC `get_cancelled_revenue`) | — | Pure aggregation RPC, `SECURITY INVOKER`, already exists. |
| Playbook Rafael ampliado / Persona final | API / Backend (static TS string constants `playbooks.ts`/`prompt.ts`, bundled into the EF at deploy) | — | Not a runtime capability — pure prompt content, same tier as the 103/104 playbook edits. |

No tier misassignment risk here: this phase touches only the already-established
`nexo-chat` backend tier plus pre-existing DB objects. No browser/SSR/CDN work.

## Standard Stack

No new libraries. This phase adds TypeScript code to an existing Deno Edge Function
(`supabase/functions/nexo-chat/tools.ts`) using only the `@supabase/supabase-js@2` client and
the global `fetch` — both already imported and used by every existing tool (see `tools.ts` line 45
and the `get_reputation` case). `deno.json`/import map is untouched.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `@supabase/supabase-js@2` (`https://esm.sh/@supabase/supabase-js@2`) | 2 (esm.sh pinned major, matches all existing imports in `tools.ts`) | `SupabaseClient` type + `sb.rpc()`/`sb.from()` calls | Already the only DB client used throughout `tools.ts`; no alternative considered. |

### Supporting
None — no new supporting library needed.

### Alternatives Considered
None — this phase is additive code inside an existing, tightly-scoped file; introducing any new
dependency would be scope creep and was not requested.

**Installation:** N/A — no new packages. `deno.json`/`import_map.json` for `nexo-chat` remain
unchanged; do not add new imports beyond the existing `SupabaseClient` type import.

## Package Legitimacy Audit

**No new packages are installed by this phase.** All code additions live inside
`supabase/functions/nexo-chat/tools.ts` (and its test/prompt/playbook siblings), reusing the
already-imported `@supabase/supabase-js@2` and the Deno-global `fetch`. The Package Legitimacy
Gate protocol (npm/PyPI/crates registry checks) is **not applicable** — mirrors the `T-103-SC`/
`T-104-SC` "accept, N/A" disposition from the two prior phases' threat models.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|--------------|---------|--------------|
| (none) | — | — | — | — | — | N/A — no new package |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌────────────────────────────────────────────────────┐
                     │  Gemini function-calling loop (loop.ts)             │
                     │  model decides to call one of 35 tools              │
                     └───────────────────────┬────────────────────────────┘
                                              │ name + args (UNTRUSTED)
                                              ▼
                     ┌────────────────────────────────────────────────────┐
                     │  dispatchTool(sb, orgId, mlUserIds, name, args, ctx) │
                     │  orgId/mlUserIds = SERVER (from JWT via index.ts);   │
                     │  args.org_id/seller_id/ml_user_id = ALWAYS IGNORED   │
                     └───┬─────────────┬─────────────┬─────────────┬───────┘
                         │             │             │             │
     ┌───────────────────┘  ┌──────────┘   ┌─────────┘   ┌─────────┘
     ▼                      ▼               ▼             ▼
get_price_practiced   get_competitive_price  get_cost_gaps  get_cancelled_revenue
     │                      │               │             │
     ▼                      ▼               ▼             ▼
 RPC orders_sold_       fetch(EF ml-      RPC             RPC
 products_agg           precos-custos,    get_cmv_        get_cancelled_
 (_ml_user_ids only —   Authorization:    cheio_gaps      revenue
 NO p_org_id param)     Bearer ctx.       (p_org_id,      (p_org_id,
     +                  userJwt)          p_user_ids,     p_user_ids,
 select ml_mco_targets     │              p_from, p_to)   p_from, p_to)
 .eq(organization_id)      ▼
     │              ML API /suggestions/{item|user}/...
     ▼              (item_id from model = non-sensitive input;
 join by item_id      ml_user_id ALWAYS from server mlUserIds loop)
 (sku='' sentinel
 only — per-SKU
 targets unmatched)
     │                      │               │             │
     └──────────────────────┴───────┬───────┴─────────────┘
                                     ▼
                     { label, summary/rows, cap(MAX_ROWS) }
                                     │
                                     ▼
                     tool-result → Gemini → user-facing answer
                     (playbook Rafael cites result as SIGNAL,
                      never as an order to change price)
```

### Recommended Project Structure

No new files/folders. All changes are edits inside the existing 5-file set (same as 103/104):

```
supabase/functions/nexo-chat/
├── tools.ts          # +4 FnDecl entries, +4 dispatchTool cases, +1 join helper
├── tools.test.ts      # +anti-IDOR tests ×4, +join test, +EF-mock test (get_competitive_price)
├── playbooks.ts        # bloco "## 4. RAFAEL" ampliado (4.1/4.2 existentes preservados)
├── prompt.ts            # PERSONA ampliada (4 pontos de inserção, mesmo padrão de 103/104)
└── prompt.test.ts        # +greps novos, sem remover nenhum existente
```

### Pattern 1: "org-only" RPC wrapper (for `get_cost_gaps`, `get_cancelled_revenue`)

**What:** `sb.rpc(name, { p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to })`,
mapped straight through `cap()`.
**When to use:** Both new RPCs require all 4 params (no SQL defaults) — reuse the `from`/`to`
already computed at the top of `dispatchTool` (`clampDate(args.to) ?? today()`,
`clampDate(args.from) ?? daysAgo(30)`), same as `get_margin_by_product`.
**Example (confirmed live signature, from migration
`20260715223024_cmv_cheio_puro_and_gaps.sql` and `20260715221559_dre_cancelled_revenue_and_nao_classificado.sql`):**
```typescript
// Source: supabase/functions/nexo-chat/tools.ts existing case `get_margin_by_product` mold,
// signatures confirmed by direct read of the CREATE FUNCTION migrations.
case "get_cost_gaps": {
  const { data } = await sb.rpc("get_cmv_cheio_gaps", {
    p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
  });
  const rows = (data ?? []) as Array<{
    sku: string; marca: string | null; linhas: number; unidades: number;
    receita: number; tem_custo_medio: boolean;
  }>;
  return {
    label:
      "SKUs sem custo CHEIO cadastrado no período. custo ausente pode ser legítimo em conta " +
      "de revenda (custo não está no Tiny) — não é necessariamente erro. tem_custo_medio=true " +
      "distingue 'tem custo médio, falta o cheio' de 'sem custo nenhum'.",
    rows: cap(rows),
  };
}
case "get_cancelled_revenue": {
  const { data } = await sb.rpc("get_cancelled_revenue", {
    p_org_id: orgId, p_user_ids: mlUserIds, p_from: from, p_to: to,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    { cancelled_revenue: number; cancelled_orders: number } | null;
  return {
    label: "Receita de pedidos cancelled+partially_refunded — NÃO é faturamento; complementa " +
      "get_sales_kpis (que só soma pedidos pagos).",
    cancelled_revenue: Number(row?.cancelled_revenue ?? 0),
    cancelled_orders: Number(row?.cancelled_orders ?? 0),
  };
}
```

### Pattern 2: "only-mlUserIds, no p_org_id" RPC + table join (for `get_price_practiced`)

**What:** `orders_sold_products_agg(_ml_user_ids, _from, _to)` has **no `p_org_id` parameter at
all** (confirmed live in `supabase/migrations/20260680000001_orders_sold_products_agg_perf.sql`).
Anti-IDOR relies 100% on `_ml_user_ids` being server-derived — the exact same trust model as
`get_goals` (`ml_targets` scoped only by `seller_id ∈ mlUserIds`, no `organization_id` column).
**When to use:** This is the mold to copy for `get_price_practiced` — do NOT invent a `p_org_id`
argument for this RPC (it doesn't exist and would error).
**Example:**
```typescript
// Source: supabase/migrations/20260680000001_orders_sold_products_agg_perf.sql (RPC signature)
//         + supabase/migrations/20260719000000_ml_mco_targets.sql (table schema)
case "get_price_practiced": {
  const { data: soldData } = await sb.rpc("orders_sold_products_agg", {
    _ml_user_ids: mlUserIds, _from: from, _to: to,
  });
  const soldRows = (soldData ?? []) as Array<{
    item_id: string; titulo: string | null; marca: string | null;
    quantidade: number | string; receita_bruta: number | string; pedidos: number | string;
  }>;

  // Anti-IDOR: select direto via service_role bypassa RLS — .eq(organization_id) obrigatório.
  // Só o sentinel sku='' ("anúncio inteiro") casa com o agregado por item_id da RPC acima —
  // metas por variação (sku != '') NÃO têm equivalente no agregado (a RPC não quebra por SKU).
  const { data: targetData } = await sb
    .from("ml_mco_targets")
    .select("item_id, target_mco_pct")
    .eq("organization_id", orgId)
    .eq("sku", "");
  const targetMap = new Map(
    ((targetData ?? []) as Array<{ item_id: string; target_mco_pct: number }>)
      .map((t) => [t.item_id, Number(t.target_mco_pct)]),
  );

  const enriched = soldRows.map((r) => {
    const quantidade = Number(r.quantidade) || 0;
    const receita_bruta = Number(r.receita_bruta) || 0;
    return {
      item_id: r.item_id,
      titulo: r.titulo,
      marca: r.marca,
      quantidade,
      receita_bruta,
      preco_medio_praticado: quantidade > 0 ? Math.round((receita_bruta / quantidade) * 100) / 100 : null,
      meta_mco_pct: targetMap.get(r.item_id) ?? null,
    };
  });

  return {
    label:
      "preco_medio_praticado é HISTÓRICO (receita_bruta/quantidade do período, pedidos pagos) — " +
      "não é o preço atual do anúncio (para isso não há tool nesta fase; ver painel /anuncios). " +
      "meta_mco_pct vem de ml_mco_targets (alvo cadastrado para o anúncio INTEIRO — sku=''); " +
      "meta_mco_pct=null significa SEM meta cadastrada para esse item (não é 0%; declare a " +
      "limitação, não invente). Metas específicas por VARIAÇÃO (SKU) não aparecem aqui — este " +
      "agregado é por item_id, não por variação.",
    rows: cap(enriched),
  };
}
```

### Pattern 3: EF-via-`ctx.userJwt` (for `get_competitive_price`) — mirrors `get_reputation`

**What:** `ml-precos-custos` requires a **real user JWT**, not the service-role key — confirmed by
reading `getUserAndToken()` in `supabase/functions/ml-precos-custos/index.ts` (calls
`supabase.auth.getUser(bearerToken)`, which fails for the service-role's `sb_secret_...` opaque
key). The query parameter for competitive suggestions is `type=references` (NOT `mode=references`
as CONTEXT assumed — the EF's own dispatch is `if (type === "references") ...`, `index.ts` line
337). It also **requires** `ml_user_id` (400 if absent, `index.ts` line 326) — one store at a time.
**When to use:** Copy the `get_reputation` case (lines 1037-1080 of `tools.ts`) almost verbatim:
same "no JWT → declare limitation" guard, same per-store loop over `mlUserIds` (server-derived,
never the model's), same `Authorization: Bearer ${ctx.userJwt}` header, same try/catch per store.
**Example:**
```typescript
// Source: supabase/functions/nexo-chat/tools.ts existing case `get_reputation` (lines 1037-1080),
// adapted for supabase/functions/ml-precos-custos/index.ts type=references contract
// (confirmed by direct read of index.ts lines 225-309, 321-340).
case "get_competitive_price": {
  if (!ctx.userJwt) {
    return { error: "sem_jwt", label: "não foi possível consultar preço competitivo agora" };
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const itemId = typeof args.item_id === "string" && args.item_id.trim()
    ? args.item_id.trim().slice(0, 30) // ML item ids are short alnum; non-sensitive input
    : undefined;

  type RefResult = {
    ml_user_id: string;
    references?: unknown[];
    reference?: unknown;
    no_suggestion?: boolean;
    error?: string;
  };
  const results: RefResult[] = [];
  for (const mlUserId of mlUserIds) {
    try {
      const qs = new URLSearchParams({ ml_user_id: mlUserId, type: "references" });
      if (itemId) qs.set("item_id", itemId);
      const res = await fetch(
        `${supabaseUrl}/functions/v1/ml-precos-custos?${qs}`,
        { headers: { Authorization: `Bearer ${ctx.userJwt}` } },
      );
      if (!res.ok) {
        results.push({ ml_user_id: mlUserId, error: `ef_status_${res.status}` });
        continue;
      }
      const data = await res.json() as Record<string, unknown>;
      results.push({
        ml_user_id: mlUserId,
        reference: data.reference ?? null,
        references: Array.isArray(data.references) ? data.references : undefined,
        no_suggestion: data.no_suggestion === true,
      });
    } catch {
      results.push({ ml_user_id: mlUserId, error: "ef_fetch_error" });
    }
  }
  return {
    label:
      "Sugestão de preço competitiva do próprio Mercado Livre (endpoint de referência de " +
      "preços) — é SUGESTÃO/indicativo, NÃO garantia de venda nem preço mínimo obrigatório. " +
      "current_price/suggested_price/lowest_price vêm direto do ML; selling_fees/shipping_fees " +
      "são custos ML já embutidos na sugestão. Sem item_id, retorna até 20 itens com sugestão " +
      "disponível por loja (bulk); com item_id, detalhe de 1 item.",
    data: cap(results),
  };
}
```

### Anti-Patterns to Avoid
- **Reading `type` as `mode` in the EF call:** the EF's actual query param is `type` — passing
  `mode=references` silently falls through to the EF's `prices` default handler (`type ?? "prices"`,
  `index.ts` line 323) and returns the WRONG payload shape with no error. This is exactly the kind
  of "quiet wrong data" bug this research exists to prevent.
- **Calling `ml-precos-custos` with the service-role client/key:** will 401 (`getUserAndToken`
  returns `null` when `supabase.auth.getUser(token)` fails on a non-JWT secret) — must use
  `ctx.userJwt`.
- **Assuming `orders_sold_products_agg` returns a price column:** it does not (`item_id, titulo,
  marca, quantidade, receita_bruta, pedidos` only) — "preço praticado" must be derived
  (`receita_bruta / quantidade`), and must guard `quantidade === 0` → `null`, never divide-by-zero
  or `NaN`.
- **Joining `ml_mco_targets` by `sku` from the sold-products aggregate:** the aggregate has no
  `sku` column (item-level only) — joining anything other than the `sku=''` sentinel silently
  produces wrong/empty matches for the majority of targets that ARE per-variation.
- **Passing `p_org_id` to `orders_sold_products_agg`:** the function signature has no such
  parameter; passing it causes a Postgres "function does not exist" error at runtime (same failure
  class as Pitfall 4 in 103-RESEARCH for `get_replenishment_by_sku` + `p_user_ids`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|------|
| Competitive price suggestion | A custom scraper/estimator of competitor prices | `ml-precos-custos` EF (`type=references`), which already calls ML's own `/suggestions/items/{id}/details` and `/suggestions/user/{id}/items` | ML's suggestion algorithm already accounts for category, Buy Box eligibility and seller reputation — anything hand-built would be a worse, unmaintained guess and would violate the "no invented data" persona rule. |
| CMV/cost-gap detection | Client-side pagination over `orders` to find SKUs with null cost | `get_cmv_cheio_gaps` RPC | PostgREST truncates at 1000 rows; the RPC aggregates in Postgres with the identical WHERE predicate as `get_cost_waterfall` (so gate and CMV never disagree) — documented explicitly in migration `20260715223024_cmv_cheio_puro_and_gaps.sql` header. |
| Cancelled-revenue sum | Ad-hoc filter+sum in the EF over `orders` | `get_cancelled_revenue` RPC | Same predicate-drift risk as above; the RPC is the single source of truth already consumed by `/vendas` (`useCancelledRevenue.ts`). |

**Key insight:** every one of the 4 new tools wraps an RPC or EF that a dashboard page already
consumes in production — this phase's job is strictly "expose the existing source correctly and
label it," never "compute a new number."

## Common Pitfalls

### Pitfall 1: `type` vs `mode` param name mismatch for `ml-precos-custos`
**What goes wrong:** Passing `mode=references` (as CONTEXT.md's wording literally suggests)
instead of `type=references` returns the `prices` (default) payload shape silently — no error, no
`400`, just the wrong data (a list of active-listing prices instead of competitive suggestions).
**Why it happens:** `index.ts` reads `url.searchParams.get("type") ?? "prices"` (line 323); there
is no `mode` param anywhere in this EF.
**How to avoid:** Use `type` literally, confirmed by direct read of `index.ts` lines 321-340 and
the consuming hook `useMLPrecosCustos.ts` line 129 (`new URLSearchParams({ ml_user_id, type, ...})`).
**Warning signs:** A test that asserts `qs.get("mode")` instead of `qs.get("type")` would pass
against a hand-rolled fake and still ship broken code — assert the literal string `"type=references"`
appears in the constructed URL/params.

### Pitfall 2: `ml-precos-custos` requires the real user JWT, not service-role
**What goes wrong:** Calling the EF with the `nexo-chat` service-role client (as every other tool
does) returns `401 Unauthorized or no ML token` because `getUserAndToken()` calls
`supabase.auth.getUser(bearerToken)`, which needs a signed user JWT — the service-role secret
(`sb_secret_...` format per this project) is not a JWT and will not validate.
**Why it happens:** `ml-precos-custos/index.ts` line 28 (`supabase.auth.getUser(token)`) plus line
39 (`is_org_member` check against `tokenRow.organization_id`) — this EF was built to be called
from the authenticated browser client (`useMLPrecosCustos.ts` always sends the user's
`session.access_token`), not from a service-role backend job.
**How to avoid:** Mirror `get_reputation`: guard on `ctx.userJwt`, return `{error:"sem_jwt"}` if
absent, pass `Authorization: Bearer ${ctx.userJwt}`.
**Warning signs:** A test that stubs `dispatchTool`'s `sb` (service-role fake) but never exercises
the real `fetch`/JWT path would pass while the deployed tool 401s on every real call — the
Phase 105 test suite MUST include the fetch-mock test (see Code Examples § Test Pattern below),
not just the RPC-only tests.

### Pitfall 3: `orders_sold_products_agg` has no price column — division by zero risk
**What goes wrong:** Deriving `preco_medio_praticado = receita_bruta / quantidade` without a
`quantidade === 0` guard produces `Infinity`/`NaN`, which then gets serialized into the tool-result
JSON and can silently confuse the model into inventing a bogus price.
**Why it happens:** the RPC's `GROUP BY o.item_id` (migration `20260680000001`) can in theory
return a row with `SUM(quantidade)=0` only if all matched orders had `quantidade=0` (a data
anomaly, not expected in practice but not impossible — `orders.quantidade` is not `NOT NULL
CHECK > 0` at the DB level, unconfirmed either way in this research).
**How to avoid:** `quantidade > 0 ? receita_bruta / quantidade : null`, exactly like `sumGuiaReal`'s
"never null becomes NaN, always a real number or an honest null" pattern from Phase 104.
**Warning signs:** A test with a `quantidade: 0` fixture row that doesn't assert
`preco_medio_praticado === null` (not `NaN`, not `Infinity`).

### Pitfall 4: `ml_mco_targets` join only matches the whole-listing sentinel
**What goes wrong:** Because `orders_sold_products_agg` aggregates by `item_id` only,
per-SKU/variation MCO targets (`sku != ''` rows in `ml_mco_targets`) will never find a matching
row to join against — if the join logic naively does `.eq('item_id', r.item_id)` without also
filtering `sku=''` on the target side, an item with BOTH a whole-listing target and 3 per-variation
targets would non-deterministically pick whichever `ml_mco_targets` row the `Map` construction
happened to keep last (a silent correctness bug, not a crash).
**Why it happens:** `ml_mco_targets` unique constraint is `(organization_id, item_id, sku)` — one
item can have several rows differing only by `sku`.
**How to avoid:** Filter `.eq("sku", "")` on the `ml_mco_targets` select (see Pattern 2 above) so
the `Map<item_id, target>` is unambiguous; label explicitly that per-variation targets aren't
represented in this tool's output.
**Warning signs:** A test fixture with 2 `ml_mco_targets` rows sharing an `item_id` (one `sku=''`,
one `sku='SKU-A'`) that doesn't assert the joined result equals the `sku=''` row's value.

### Pitfall 5: `ml_mco_targets` has no `sku_code`/per-variation display join back to `orders_sold_products_agg`
**What goes wrong:** Not really a bug risk, but a scope trap — a plausible-sounding "let's also
show per-SKU price" enhancement is out of scope: `orders_sold_products_agg` fundamentally cannot
produce it without a new RPC (which is explicitly out of scope per the spec §5, "Novas
RPCs/migrations de dados" is fora de escopo). Flag this as a documented limitation in the tool's
`label`, not something to work around in this phase.

## Code Examples

### Test Pattern — anti-IDOR "only-mlUserIds, no p_org_id" (mirrors `get_goals` test style)
```typescript
// Source: mirrors the existing get_goals anti-IDOR test style in tools.test.ts
// (search "OPS-2/D13" / "ml_targets NÃO tem organization_id" in the file for the sibling test).
it("get_price_practiced: orders_sold_products_agg NUNCA recebe p_org_id, só _ml_user_ids do servidor", async () => {
  const { sb, rpcCalls } = makeStub([
    { item_id: "MLB1", titulo: "T", marca: "M", quantidade: 10, receita_bruta: 1000, pedidos: 5 },
  ]);
  await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_price_practiced", EVIL_ARGS);
  const call = rpcCalls.find((c) => c.fn === "orders_sold_products_agg");
  expect(call).toBeDefined();
  expect(call!.params).not.toHaveProperty("p_org_id"); // this RPC has NO such param
  expect(call!.params._ml_user_ids).toEqual(ML_IDS_SERVER);
  expect(JSON.stringify(call!.params)).not.toContain("888"); // EVIL_ARGS.ml_user_id ignored
});
```

### Test Pattern — EF-via-JWT for `get_competitive_price` (literal mirror of the existing
`get_reputation` test, `tools.test.ts` lines 958-1019)
```typescript
// Source: supabase/functions/nexo-chat/tools.test.ts lines 958-1019 (get_reputation test),
// adapted URL path (/functions/v1/ml-precos-custos) and query param (type=references).
it("get_competitive_price: com userJwt — invoca ml-precos-custos com type=references e Bearer do usuário", async () => {
  const { sb } = makeStub([]);
  const FAKE_SUPABASE_URL = "https://ckcdevcxgvueywivefgx.supabase.co";
  // @ts-ignore
  globalThis.Deno = { env: { get: (k: string) => k === "SUPABASE_URL" ? FAKE_SUPABASE_URL : undefined } };
  const fetchCalls: Array<{ url: string; authHeader: string }> = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const urlStr = String(url instanceof Request ? url.url : url);
      fetchCalls.push({ url: urlStr, authHeader: (init?.headers as any)?.Authorization ?? "" });
      return new Response(JSON.stringify({ references: [] }), { status: 200 });
    }) as typeof fetch;

    await dispatchTool(sb, ORG_SERVER, ML_IDS_SERVER, "get_competitive_price", EVIL_ARGS, { userJwt: "JWT-REAL" });

    expect(fetchCalls.length).toBe(ML_IDS_SERVER.length);
    for (const c of fetchCalls) {
      expect(c.url).toContain("/functions/v1/ml-precos-custos");
      expect(c.url).toContain("type=references"); // NOT mode=references
      const params = new URL(c.url).searchParams;
      expect(ML_IDS_SERVER).toContain(params.get("ml_user_id"));
      expect(params.get("ml_user_id")).not.toBe("888"); // EVIL_ARGS ignored
      expect(c.authHeader).toBe("Bearer JWT-REAL");
    }
  } finally {
    globalThis.fetch = originalFetch;
    // @ts-ignore
    delete globalThis.Deno;
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Rafael's "Inteligência Competitiva" playbook block existed with zero real data behind it (persona promised concorrentes/preço total/Buy Box, no tool backed it) | `get_competitive_price` wraps ML's own suggestion API via the already-deployed `ml-precos-custos` EF | Phase 105 (this phase) | First real competitive-price signal the Consultor has ever had — closes the "pilar fantasma" gap identified in the milestone spec §3. |
| `get_no_cost_count` only returned a COUNT of SKUs without cost | `get_cost_gaps` returns the actual list (sku, marca, receita, tem_custo_medio) | Phase 105 | Actionable — Wesley can now ask "which SKUs" not just "how many". |

**Deprecated/outdated:** none of the 4 underlying RPCs/EF are deprecated; all are actively
consumed by production dashboard pages (`/analise-precos`, `/anuncios`, DRE close gate, `/`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|-----------------|
| A1 | `ml-precos-custos` is not listed in `supabase/config.toml` `[functions.*]` blocks, so it inherits the Supabase CLI's platform-level default `verify_jwt` behavior at the API-gateway layer (separate from the EF's own internal `auth.getUser()` check, which is confirmed code, not assumed). Not confirmed live via Supabase MCP `list_edge_functions` / project settings in this research session. | Architecture Patterns § Pattern 3, Common Pitfalls § Pitfall 2 | Low — even if the gateway-level `verify_jwt` were `false`, the EF's own internal `auth.getUser(token)` call still requires a real user JWT to succeed (confirmed by direct code read), so the practical requirement (`ctx.userJwt` mandatory) holds regardless of the gateway setting. Recommend the orchestrator confirm live via Supabase MCP before deploy, same posture as the 104-01-PLAN.md drift note (A1) for `get_imposto_guia_by_competence`. |
| A2 | Recommended design: for `get_competitive_price` with a model-supplied `item_id`, loop over ALL of `mlUserIds` (server list) trying each store's token in turn until one succeeds, since an ML item belongs to exactly one store and there is no cheap server-side way to know which one without an extra lookup. | Architecture Patterns § Pattern 3 (Code Example only tries all `mlUserIds` in the no-item_id/bulk branch — the single-item branch design is a recommendation, not yet coded) | Medium — if `mlUserIds` has many stores this could mean several failed EF round-trips per query; acceptable given typical org size (1-3 stores per the memory notes on this project: Pé Vermeio + Thales = 2 orgs, each with 1 primary seller). Planner should decide exact retry/short-circuit strategy at implementation time. |
| A3 | `orders.quantidade` may theoretically be `0` for some row combination, making `receita_bruta/quantidade` division-by-zero a real (if rare) risk — not confirmed by a live data query in this session, inferred from absence of a `CHECK (quantidade > 0)` constraint visible in the migrations read. | Common Pitfalls § Pitfall 3 | Low — the guard (`quantidade > 0 ? ... : null`) costs nothing to include defensively regardless of whether the edge case is currently reachable in live data. |

## Open Questions

1. **Should `get_price_practiced` expose `from`/`to` params to the model (like `get_margin_by_product`), or run over a fixed window?**
   - What we know: `orders_sold_products_agg` accepts `_from`/`_to` (both nullable — `NULL` means "no lower/upper bound", i.e. ALL history, per the `WHERE (%L::date IS NULL OR ...)` pattern in the SQL body).
   - What's unclear: whether "preço praticado" as a concept should default to a recent window (e.g. 30d, matching every other tool's `DATE_PROPS` convention) or intentionally allow "all-time" by omitting dates.
   - Recommendation: expose the standard `DATE_PROPS` (`from`/`to`, default last-30-days via the existing `daysAgo(30)`/`today()` helpers) for consistency with every other tool in `tools.ts` — do NOT pass `null`/unbounded by default, since an unbounded aggregate over the full `orders` table (295k+ rows per the perf-migration comment) is exactly the kind of query that migration `20260680000001` had to add `SET LOCAL work_mem` to make performant, and an unbounded default would negate that tuning's assumption of a typical 30-365 day range.

2. **Does the `label` for `get_competitive_price` need to mention `no_suggestion: true` explicitly per-item?**
   - What we know: `handlePriceReferences` in `ml-precos-custos/index.ts` returns
     `{ reference: null, no_suggestion: true }` for items ML has no benchmark for (single-item
     branch) — the bulk branch simply omits items with no `detail` from the `references` array
     (filtered by `.filter(Boolean)`, line 306), so "no suggestion" is invisible in bulk mode.
   - What's unclear: whether the tool should surface "N items had no suggestion available" as a
     count in bulk mode, or rely on the persona's general VERACIDADE rules.
   - Recommendation: the persona's existing "PARCIAL É ROTULADO" rule already covers this
     generically; the planner should still add the label text "nem todo item tem sugestão
     disponível (no_benchmark_ok / sem histórico suficiente)" to the tool's own `label` string, per
     the pattern every other new tool in 103/104 followed (每 tool documents its own specific gaps,
     not just a generic pointer to the persona).

## Environment Availability

Skipped — this phase has no new external tool/service/runtime dependency. It calls two RPCs and
one Edge Function (`ml-precos-custos`) that already exist and are already deployed in production
against project `ckcdevcxgvueywivefgx` (confirmed live by the presence of their migrations and
their existing frontend consumers `useMcoTargets.ts`, `useMLSoldProducts.ts`,
`useCmvCheioGate.ts`, `useCancelledRevenue.ts`, `useMLPrecosCustos.ts`, all read in this research
session).

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false` explicitly set.

## Security Domain

`security_enforcement` is absent from `.planning/config.json` → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|---------------------|
| V2 Authentication | yes (for `get_competitive_price` only) | `ctx.userJwt` real user JWT forwarded to `ml-precos-custos`, which internally calls `supabase.auth.getUser()` + `is_org_member` RPC (already-implemented control in the EF, not new code this phase writes) |
| V3 Session Management | no | JWT lifecycle is handled entirely upstream in `index.ts` (`ctx.userJwt` extraction) — out of scope for this phase, unchanged. |
| V4 Access Control | yes | `p_org_id`/`p_user_ids`/`mlUserIds` always server-derived, never accepted from `args` (the model); the `ml_mco_targets` select requires `.eq("organization_id", orgId)` since it's a direct table read via the service-role client (bypasses RLS). |
| V5 Input Validation | yes | `month`/date params reuse the existing `clampDate`/`clampMonth` validators; the new `item_id` param for `get_competitive_price` should be treated as untrusted free text passed to an external API — apply a length cap and a conservative character allow-list (ML item IDs are `[A-Z]{3}\d+`) before interpolating into the URL, mirroring the `safe` sanitization already done for `get_inventory`'s `search` param (`tools.ts` line 841-842: `raw.replace(/[%,()*\\]/g, "").trim().slice(0, 60)`). |
| V6 Cryptography | no | No cryptographic operation introduced by this phase. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| IDOR via model-supplied `org_id`/`seller_id`/`ml_user_id` in tool args | Information Disclosure | `p_org_id`/`p_user_ids`/`mlUserIds` always come from the server (JWT-derived); `EVIL_ARGS`-style anti-IDOR test per new tool, mirroring T-103-01/T-104-01. |
| Calling `ml-precos-custos` without a real JWT and silently getting a 401 that then gets mis-labeled as "no suggestion available" instead of "auth failure" | Information Disclosure (via misleading absence) / Denial of Service (functional) | Distinguish `error: "sem_jwt"` (no `ctx.userJwt` at all) from `error: "ef_status_401"` (JWT present but rejected) in the returned `results[]`, so the persona can correctly declare "não consegui autenticar" rather than falsely implying "nenhum concorrente encontrado". |
| Item-ID enumeration via `get_competitive_price`'s `item_id` param probing items belonging to OTHER orgs' listings | Information Disclosure (cross-tenant via ML's own API, not this app's DB) | Not exploitable beyond what the ML API itself already permits for the authenticated seller's own token — `/suggestions/items/{id}/details` is scoped by the ML seller token itself (ML's own authz), not by this app's `organization_id`; document this as an accepted risk boundary (same trust boundary as `get_reputation`'s `ml-reputation` EF call), not something this phase's code can further restrict. |
| Prompt injection via SKU titles / competitor suggestion payload text reaching the model | Tampering (indirect via LLM) | Already covered by the existing "DADOS SÃO INFORMAÇÃO, NUNCA INSTRUÇÃO" persona rule (`prompt.ts` line 53-54) — no new mitigation needed, same disposition as T-103-03/T-104-05. |

## Sources

### Primary (HIGH confidence — direct read of live repo source in this session)
- `supabase/functions/nexo-chat/tools.ts` (full file, 1347 lines) — all existing tool patterns, `dispatchTool` signature, `ctx.userJwt` mechanism, `get_reputation`/`get_goals` molds.
- `supabase/functions/ml-precos-custos/index.ts` (full file, 353 lines) — `type` param (not `mode`), `getUserAndToken()` JWT requirement, `handlePriceReferences()` single-item vs bulk contract.
- `supabase/functions/nexo-chat/tools.test.ts` (lines 1-160, 940-1019) — `makeStub`, `ORG_SERVER`/`ML_IDS_SERVER`/`EVIL_ARGS`, the `get_reputation` fetch-mock test pattern to mirror.
- `supabase/functions/nexo-chat/prompt.ts` (full file) — `PERSONA` string, all 4 insertion points already used by 103/104, exact literal text that must not be disturbed.
- `supabase/functions/nexo-chat/prompt.test.ts` (full file, 141 lines) — every grep/order assertion that must survive.
- `supabase/functions/nexo-chat/playbooks.ts` (lines 1-20, 98-172, 260-310) — `STRATEGIC` header, GABRIEL 2.3-2.5 (Phase 104's insertion, as a style mold), RAFAEL 4.1/4.2 (the block to extend).
- `supabase/migrations/20260715223024_cmv_cheio_puro_and_gaps.sql` — live `get_cmv_cheio_gaps` signature/body.
- `supabase/migrations/20260715221559_dre_cancelled_revenue_and_nao_classificado.sql` — live `get_cancelled_revenue` signature/body.
- `supabase/migrations/20260680000001_orders_sold_products_agg_perf.sql` — live `orders_sold_products_agg` signature/body (no `p_org_id`, item-level aggregate only).
- `supabase/migrations/20260719000000_ml_mco_targets.sql` — live `ml_mco_targets` table schema + RLS.
- `src/hooks/useMLPrecosCustos.ts`, `src/hooks/useMLSoldProducts.ts`, `src/hooks/useMcoTargets.ts`, `src/hooks/useCmvCheioGate.ts`, `src/hooks/useCancelledRevenue.ts` — confirms every RPC/EF call shape used in production.
- `supabase/config.toml` — confirms `ml-precos-custos` has no explicit `[functions.ml-precos-custos]` block (A1).
- `.planning/phases/103-.../103-01-PLAN.md`, `.planning/phases/104-.../104-01-PLAN.md` — validated task/test/threat-model structure to mirror.
- `docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` — milestone spec, Grupos 3+4 scope.
- `.planning/phases/105-.../105-CONTEXT.md` — locked decisions, discretion areas.

### Secondary (MEDIUM confidence)
None used — no web/doc lookups were needed for this phase (100% internal codebase archaeology, no new external library/framework).

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new library, everything already in production use.
- Architecture (RPC signatures, EF contract, join logic): HIGH — every RPC/EF signature confirmed by direct read of the live migration/source file, not inferred or assumed.
- `get_competitive_price` verify_jwt gateway setting specifically: MEDIUM (see Assumption A1) — the *practical* requirement (real user JWT) is HIGH confidence (proven by code), only the *gateway-level* config detail is unconfirmed live.
- Pitfalls: HIGH — each pitfall is grounded in a specific line/file read this session, not speculation.

**Research date:** 2026-07-28
**Valid until:** 30 days (stable internal codebase; RPCs/EF are all already-shipped Phase 96/101 artifacts, low churn risk) — but re-verify signatures live via Supabase MCP before deploy if this phase's execution is delayed past a week, per this project's established pattern of drift between local migrations and the live DB (see 104-01-PLAN.md's own drift note for precedent).

## RESEARCH COMPLETE
