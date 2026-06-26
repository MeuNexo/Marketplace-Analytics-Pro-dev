# Phase 66: Compras v2 — Override por Fornecedor - Research

**Researched:** 2026-06-26
**Domain:** Supabase RPC / PostgreSQL CTE / TypeScript / React (Plataforma ML Pé Vermeio)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01/D-02:** Fornecedor predominante = maior `SUM(quantidade)` por `fornecedor` em `purchase_orders` para o SKU. Desempate: OC mais recente (`MAX(data_entrega)`, fallback `data_pedido`).
- **D-03:** SKU sem nenhuma OC pula o nível fornecedor (cai direto em marca > global). Sem erro.
- **D-04:** Scope `fornecedor` cobre SÓ parâmetros de reposição (lead_time, meta_cobertura, safety, MOQ, pack). Custo NÃO é parametrizável por fornecedor.
- **D-05:** Custo continua por SKU de `ml_product_costs` (Tiny). Problema de custo ausente permanece no roadmap de custo v2.
- **D-06:** Precedência da RPC: `SKU > fornecedor > marca > global` — cada campo resolvido por COALESCE.
- **D-07:** RPC permanece `SECURITY INVOKER` (anti-IDOR). Sem regressão dos casos Phase 63.
- **D-08:** `resolveParamsBySku` em `replenishmentUtils.ts` deve refletir a mesma precedência de 4 níveis, com testes cobrindo todos os fallbacks.
- **D-09:** UI reutiliza o CRUD de params existente em `/compras`, adiciona `'fornecedor'` ao seletor de escopo.
- **D-10:** Fornecedor é escolhido por **dropdown** com os fornecedores distintos das OCs (`SELECT DISTINCT fornecedor`). Não texto livre.
- **D-11:** Só é possível parametrizar fornecedor que tenha OC.
- **D-12/D-13:** Sequência obrigatória: deploy EF + re-sync → checkpoint de validação dos nomes de fornecedor → só então RPC + frontend.
- **D-14:** Migration `20260666000000_fornecedor_scope.sql` já está em prod mas o arquivo está **untracked no git**; EF já tem o código `fornecedor = contato.nome` localmente mas **não está deployada**.

### Claude's Discretion

- Forma de expor lista de fornecedores ao frontend (RPC dedicada `get_purchase_order_suppliers` vs query distinct direta com RLS).
- Derivação do fornecedor predominante como CTE dentro da própria RPC ou view/RPC auxiliar (preferência: CTE na RPC, padrão `incoming_by_sku` da Phase 65).
- Regra exata de desempate: data primária = `data_entrega`, fallback = `data_pedido` (travado em D-02).

### Deferred Ideas (OUT OF SCOPE)

- Custo por fornecedor.
- Cálculo mais esperto (sazonalidade, tendência, lead time real por histórico).
- Gerar OC no Tiny (botão criar OC) e editor manual de custo.
- Janela temporal no cálculo do predominante.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORN-01 | EF grava `fornecedor=contato.nome` nas OCs; coluna em `purchase_orders` | EF já tem o código (linha 118 de `index.ts`); coluna já em prod via migration `20260666`; precisa só de commit + deploy |
| FORN-02 | `replenishment_params` aceita `scope='fornecedor'` | Constraint já alterada em prod pela migration `20260666`; CHECK inclui `'fornecedor'` |
| FORN-03 | RPC resolve precedência SKU>fornecedor>marca>global; mapeamento por fornecedor predominante (qty, empate→data) | Nova CTE `fornecedor_by_sku` + extensão da CTE `params` com COALESCE de 4 níveis; detalhado na seção Architecture Patterns |
| FORN-04 | Frontend CRUD params por fornecedor (owner/admin, dropdown dos fornecedores distintos das OCs) | Extensão de `ReplenishmentParamsDialog.tsx`; dropdown alimentado por RPC `get_purchase_order_suppliers` ou query com dedup client-side |
| FORN-05 | Testes + anti-IDOR SECURITY INVOKER + sem regressão | Novos casos em `replenishmentUtils.test.ts`; RPC mantém SECURITY INVOKER; testes Phase 63 continuam passando |
</phase_requirements>

---

## Summary

A Phase 66 é evolução direta das Phases 62/63/65 e tem **fundação parcialmente em prod**: a coluna `purchase_orders.fornecedor` e a constraint `scope='fornecedor'` em `replenishment_params` já foram aplicadas via migration `20260666000000` (aplicada em prod `ckcdevcxgvueywivefgx` mas arquivo **untracked no git**). A EF `sync-tiny-purchase-orders` já tem o código que grava `fornecedor = contato.nome` localmente (linha 118 de `index.ts`) mas **não está deployada** — prova: 0 OCs com fornecedor em prod.

A implementação completa requer três etapas sequenciais (D-12): (1) commit da migration untracked + commit da EF + deploy da EF + re-sync para popular `purchase_orders.fornecedor`; (2) **checkpoint de validação** dos nomes de fornecedor (limpos/consistentes); (3) nova migration da RPC com CTE `fornecedor_by_sku` e precedência de 4 níveis + extensão do frontend.

O núcleo técnico é a nova CTE `fornecedor_by_sku` na RPC `get_replenishment_by_sku` que, por SKU, deriva o fornecedor predominante usando `DISTINCT ON ... ORDER BY total_qty DESC, ultima_data DESC`. Essa CTE é então usada pela CTE `params` existente (que já resolve COALESCE de 3 níveis) para inserir um 4º nível `fornecedor` entre `sku` e `marca`. O padrão espelha exatamente como a CTE `incoming_by_sku` foi adicionada na Phase 65.

**Primary recommendation:** Seguir o padrão Phase 65 para a CTE (`DISTINCT ON` + subquery de agregação), usar RPC dedicada `get_purchase_order_suppliers` para alimentar o dropdown (SECURITY INVOKER, 0 risco de enumeração cross-org), e estender `resolveParamsBySku` com assinatura de 4 argumentos — os testes existentes continuam passando sem alteração (args adicionais com default null).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mapear SKU → fornecedor predominante | Database (RPC PostgreSQL) | — | Agrega `purchase_orders` com window function; computar no frontend seria inviável com 800+ SKUs |
| Resolver parâmetros por escopo (4 níveis) | Database (RPC PostgreSQL) | Frontend TS (espelho) | RPC é a fonte de verdade; `resolveParamsBySku` é espelho testável para UTs |
| Listar fornecedores distintos das OCs | Database (RPC) | — | RLS org-first enforça; deduplique server-side via DISTINCT SQL |
| CRUD params por fornecedor | Frontend (React) | Database (RLS) | Cliente faz INSERT/UPDATE via PostgREST; RLS `rp_write` enforça owner/admin |
| Sync OCs com fornecedor do Tiny | Edge Function (Deno) | Database (purchase_orders) | Acesso ao token Tiny + escrita com service_role; EF já existente |

---

## Standard Stack

### Core (todos já em prod — sem novas dependências)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase PostgreSQL | 15.x | RPC, CTEs, RLS | Projeto live `ckcdevcxgvueywivefgx` |
| `@supabase/supabase-js` | 2.98.0 | Client SDK PostgREST + RPC | Já usado em todos os hooks |
| React + TypeScript | 18.3.1 / 5.8.3 | Frontend SPA | Stack do projeto |
| `react-hook-form` + `zod` | 7.61.1 / 3.25.76 | Formulário CRUD params | Já usado em `ReplenishmentParamsDialog` |
| `@tanstack/react-query` | 5.83.0 | Cache de dados do hook | Já usado em `useReplenishmentBySku` |
| `vitest` | 3.2.4 | Testes unitários | Já configurado; 208 testes passando |

**Nenhuma dependência nova** — Phase 66 é 100% extensão de código existente.

---

## Package Legitimacy Audit

Não aplicável — phase não instala pacotes externos. Todas as dependências já estão em prod.

---

## Architecture Patterns

### System Architecture Diagram

```
Tiny ERP (API v3)
  └── /ordem-compra → EF sync-tiny-purchase-orders (Deno, waitUntil)
        ├── grava fornecedor = contato.nome (já no código local)
        └── upsert purchase_orders (org, sku, quantidade, fornecedor, data_entrega, data_pedido)

purchase_orders (PostgreSQL, org-scoped)
  ├── → CTE fornecedor_by_sku: DISTINCT ON (sku) ORDER BY SUM(qty) DESC, MAX(data) DESC
  │       ← resolve fornecedor predominante por SKU
  └── → RPC get_purchase_order_suppliers: DISTINCT fornecedor (para dropdown)

get_replenishment_by_sku (RPC SECURITY INVOKER)
  CTEs em ordem:
  [1] inventory_by_sku  ← ml_inventory_cache (variações + sem variação)
  [2] sales_by_sku      ← orders (venda/dia por SKU)
  [3] incoming_by_sku   ← purchase_orders (qtd a caminho — Phase 65)
  [4] fornecedor_by_sku ← purchase_orders (fornecedor predominante — Phase 66 NOVA)
  [5] params            ← replenishment_params COALESCE(sku > fornecedor > marca > global)
                           JOIN fornecedor_by_sku ON sku_code
  [6] base              ← fórmula ponto/alvo/gatilho/MOQ/pack (inalterada)
  SELECT → useReplenishmentBySku hook

replenishment_params (PostgreSQL, scope='fornecedor')
  ← escrito por ReplenishmentParamsDialog (owner/admin, RLS rp_write)
  ← lido pela CTE params via supabase.from().select()

Frontend /compras (MLCompras.tsx)
  ← useReplenishmentBySku: tabela principal (inalterada)
  ← ReplenishmentParamsDialog: CRUD, agora com opção 'fornecedor' + dropdown
       ← usePurchaseOrderSuppliers: lista fornecedores distintos das OCs
```

### Recommended Project Structure (arquivos a criar/modificar)

```
supabase/
├── migrations/
│   ├── 20260666000000_fornecedor_scope.sql   ← commitar (untracked, já em prod)
│   ├── 20260666000100_get_replenishment_by_sku_fornecedor.sql  ← NOVA RPC
│   └── 20260666000200_get_purchase_order_suppliers_rpc.sql     ← NOVA RPC auxiliar
└── functions/
    └── sync-tiny-purchase-orders/index.ts    ← commitar (alteração local, não deployada)

src/
├── lib/analysis/
│   ├── replenishmentUtils.ts        ← estender resolveParamsBySku (4° nível)
│   └── replenishmentUtils.test.ts   ← novos casos de teste fornecedor
├── hooks/
│   ├── useReplenishmentBySku.ts     ← estender param_origem type
│   └── usePurchaseOrderSuppliers.ts ← NOVO hook para dropdown
└── components/mercadolivre/
    └── ReplenishmentParamsDialog.tsx ← estender Scope type + UI fornecedor + dropdown
```

### Pattern 1: CTE fornecedor_by_sku (DISTINCT ON com agregação)

**What:** Derivar fornecedor predominante por SKU dentro da RPC, usando `DISTINCT ON` com subquery de `SUM(quantidade)` + data mais recente.

**When to use:** Quando há SKU comprado de múltiplos fornecedores — resolve deterministicamente para 1 linha por SKU.

```sql
-- Source: codebase analysis — padrão DISTINCT ON PostgreSQL (espelha incoming_by_sku Phase 65)
fornecedor_by_sku AS (
  SELECT DISTINCT ON (sub.sku_code) sub.sku_code, sub.fornecedor
  FROM (
    SELECT
      po.sku                                         AS sku_code,
      po.fornecedor,
      SUM(po.quantidade)                             AS total_qty,
      MAX(COALESCE(po.data_entrega, po.data_pedido)) AS ultima_data
    FROM public.purchase_orders po
    WHERE po.organization_id = p_org_id
      AND po.fornecedor IS NOT NULL
    GROUP BY po.sku, po.fornecedor
  ) sub
  ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST
)
```

**Posicionamento na RPC:** Definir DEPOIS de `incoming_by_sku` (que já existe) e ANTES de `params`. A CTE `params` recebe um `LEFT JOIN fornecedor_by_sku forn ON forn.sku_code = inv.sku_code`.

### Pattern 2: Extensão da CTE `params` com 4° nível (COALESCE)

**What:** Inserir o nível fornecedor entre SKU e marca em cada campo do COALESCE. Para o `param_origem`, atualizar o CASE EXISTS.

```sql
-- Source: codebase analysis — extensão direta do padrão existente em 20260665000100
params AS (
  SELECT
    inv.item_id, inv.variation_id,
    COALESCE(
      (SELECT rp.lead_time_dias FROM replenishment_params rp
       WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
         AND rp.scope_value = COALESCE(inv.sku_code, '') LIMIT 1),
      -- 4° nível (NOVO):
      (SELECT rp.lead_time_dias FROM replenishment_params rp
       WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
         AND rp.scope_value = COALESCE(forn.fornecedor, '') LIMIT 1),
      (SELECT rp.lead_time_dias FROM replenishment_params rp
       WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
         AND rp.scope_value = COALESCE(inv.brand, '') LIMIT 1),
      (SELECT rp.lead_time_dias FROM replenishment_params rp
       WHERE rp.organization_id = p_org_id AND rp.scope = 'global' LIMIT 1),
      30
    ) AS lead_time_dias,
    -- repetir para meta_cobertura_dias, safety_days, moq, pack_multiple...

    CASE
      WHEN EXISTS (
        SELECT 1 FROM replenishment_params rp
        WHERE rp.organization_id = p_org_id AND rp.scope = 'sku'
          AND rp.scope_value = COALESCE(inv.sku_code, '')
      ) THEN 'sku'
      WHEN (forn.fornecedor IS NOT NULL AND EXISTS (
        SELECT 1 FROM replenishment_params rp
        WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
          AND rp.scope_value = forn.fornecedor
      )) THEN 'fornecedor'
      WHEN EXISTS (
        SELECT 1 FROM replenishment_params rp
        WHERE rp.organization_id = p_org_id AND rp.scope = 'marca'
          AND rp.scope_value = COALESCE(inv.brand, '')
      ) THEN 'marca'
      ELSE 'global'
    END AS param_origem
  FROM inventory_by_sku inv
  LEFT JOIN fornecedor_by_sku forn ON forn.sku_code = inv.sku_code  -- NOVO JOIN
)
```

**Restrição:** O `COALESCE(forn.fornecedor, '')` no lookup do scope `'fornecedor'` deve ser `forn.fornecedor` (sem COALESCE de string vazia), pois quando `forn.fornecedor IS NULL` (SKU sem OC) o subselect retorna NULL de qualquer forma — não é necessário guardar. Usar a variante mais simples:

```sql
-- Quando forn.fornecedor é NULL (SKU sem OC), o subselect retorna NULL → COALESCE cai no próximo
(SELECT rp.lead_time_dias FROM replenishment_params rp
 WHERE rp.organization_id = p_org_id AND rp.scope = 'fornecedor'
   AND rp.scope_value = forn.fornecedor LIMIT 1),
```

Isso funciona porque `forn.fornecedor = NULL` nunca casa (`= NULL` é sempre NULL/false no SQL), então a linha é silenciosamente pulada.

### Pattern 3: RPC auxiliar `get_purchase_order_suppliers`

**What:** Retorna lista de fornecedores distintos das OCs da org — alimenta o dropdown da UI.

```sql
-- Source: codebase analysis — padrão SECURITY INVOKER de get_replenishment_by_sku
CREATE OR REPLACE FUNCTION public.get_purchase_order_suppliers(
  p_org_id UUID
)
RETURNS TABLE (fornecedor TEXT)
LANGUAGE sql
SECURITY INVOKER
SET search_path = 'public'
AS $$
  SELECT DISTINCT po.fornecedor
  FROM public.purchase_orders po
  WHERE po.organization_id = p_org_id
    AND po.fornecedor IS NOT NULL
  ORDER BY po.fornecedor;
$$;

REVOKE EXECUTE ON FUNCTION public.get_purchase_order_suppliers(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_order_suppliers(UUID) TO authenticated;
```

**Justificativa de RPC vs query direta:** `supabase.from('purchase_orders').select('fornecedor')` não suporta `SELECT DISTINCT` pelo client PostgREST sem filtros extras; retorna todas as linhas e requer dedup client-side (ineficiente com muitas OCs). A RPC é mais limpa, testável e idempotente. Também mantém o padrão anti-IDOR: a RLS `purchase_orders_select` enforça `is_org_member` via SECURITY INVOKER.

### Pattern 4: Extensão de `resolveParamsBySku` (TS puro)

**What:** Adicionar `fornecedorRow` como 2° argumento (entre `skuRow` e `marcaRow`).

```typescript
// Source: codebase analysis — extensão de src/lib/analysis/replenishmentUtils.ts
export function resolveParamsBySku(
  skuRow:       Partial<ReplenishmentParams> | null,
  fornecedorRow: Partial<ReplenishmentParams> | null,  // NOVO — 4° nível
  marcaRow:     Partial<ReplenishmentParams> | null,
  globalRow:    Partial<ReplenishmentParams> | null,
  defaults:     ReplenishmentParams = REPLENISHMENT_DEFAULTS,
): { params: ReplenishmentParams; origem: "sku" | "fornecedor" | "marca" | "global" } {
  let origem: "sku" | "fornecedor" | "marca" | "global";
  let source: Partial<ReplenishmentParams>;

  if (skuRow != null) {
    origem = "sku";
    source = skuRow;
  } else if (fornecedorRow != null) {
    origem = "fornecedor";
    source = fornecedorRow;
  } else if (marcaRow != null) {
    origem = "marca";
    source = marcaRow;
  } else {
    origem = "global";
    source = globalRow ?? {};
  }
  // ...resto inalterado
}
```

**Compatibilidade de testes:** A assinatura muda (adiciona `fornecedorRow` como 2° arg). Os testes existentes precisam ser atualizados para passar `null` na posição 2 (ex: `resolveParamsBySku(skuRow, null, marcaRow, globalRow)`). Alternativamente, os 4 testes existentes de `resolveParamsBySku` continuarão passando se o novo argumento for inserido entre `skuRow` e `marcaRow`.

### Pattern 5: Extensão de `ReplenishmentParamsDialog.tsx` (UI CRUD)

**What:** Adicionar `'fornecedor'` ao tipo `Scope`, ao schema Zod, aos labels, e substituir o campo de texto livre por um Select (dropdown) quando `scope === 'fornecedor'`.

```typescript
// Source: codebase analysis — src/components/mercadolivre/ReplenishmentParamsDialog.tsx

// 1. Tipo e schema
type Scope = "global" | "marca" | "sku" | "fornecedor";  // adicionar fornecedor

const paramsSchema = z.object({
  scope: z.enum(["global", "marca", "sku", "fornecedor"]),  // adicionar fornecedor
  // ...resto inalterado
});

// 2. Labels
const SCOPE_LABELS: Record<Scope, string> = {
  global:     "Global",
  marca:      "Por Marca",
  sku:        "Por SKU",
  fornecedor: "Por Fornecedor",  // NOVO
};

// 3. O campo scope_value para 'fornecedor' usa Select (dropdown), não Input livre
// Alimentado por hook usePurchaseOrderSuppliers
```

**Dropdown de fornecedor:** O campo `scope_value` deve renderizar um `<Select>` ao invés de `<Input>` quando `scope === 'fornecedor'`, com as opções vindo do hook `usePurchaseOrderSuppliers`. Se a lista estiver carregando, mostrar `<Skeleton>`. Se vazia (re-sync ainda não feito), mostrar mensagem orientando o usuário a sincronizar as OCs primeiro.

### Pattern 6: Hook `usePurchaseOrderSuppliers`

**What:** Busca a lista de fornecedores distintos via RPC — alimenta o dropdown.

```typescript
// Source: codebase analysis — padrão useReplenishmentBySku + useOrganization
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export function usePurchaseOrderSuppliers() {
  const { currentOrg } = useOrganization();
  return useQuery({
    queryKey: ["get_purchase_order_suppliers", currentOrg?.id] as const,
    queryFn: async (): Promise<string[]> => {
      if (!currentOrg?.id) return [];
      const { data, error } = await supabase.rpc("get_purchase_order_suppliers", {
        p_org_id: currentOrg.id,
      });
      if (error) throw error;
      return (data ?? []).map((r: { fornecedor: string }) => r.fornecedor);
    },
    enabled: !!currentOrg?.id,
    staleTime: 5 * 60 * 1000,
  });
}
```

### Anti-Patterns to Avoid

- **Texto livre no campo fornecedor:** Qualquer divergência de digitação (espaço extra, casing diferente) faz o override não casar com `purchase_orders.fornecedor`. SEMPRE usar dropdown com valores derivados das OCs.
- **DEFINER em vez de INVOKER nas RPCs novas:** Histórico do projeto (Phase 63 pitfall central): DEFINER com `p_org_id` alheio ignora RLS e entrega dados de outra org. SEMPRE SECURITY INVOKER.
- **Aplicar migration RPC antes do checkpoint de fornecedores:** D-12/D-13 — se os nomes estiverem sujos/inconsistentes, o override vai casar errado silenciosamente. O checkpoint após o re-sync é obrigatório.
- **Editar a EF na branch `gsd/phase-65`:** D-14 — committar na branch própria da Phase 66 (`gsd/phase-66-override-fornecedor`).
- **`COALESCE(forn.fornecedor, '')` no COALESCE de params:** Introduz a string vazia como scope_value de busca, que poderia casar com um registro de global (scope_value=''). Usar `forn.fornecedor` diretamente (NULL não casa, silenciosamente pula).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fornecedor predominante | Lógica JS no frontend ou cron separado | CTE `fornecedor_by_sku` na RPC existente | Atomicidade; acesso direto a `purchase_orders` no mesmo query plan |
| Dropdown de fornecedores | Buscar todas as linhas e deduplicar client-side | RPC `get_purchase_order_suppliers` com DISTINCT SQL | Eficiente; orgId-scoped server-side |
| Match de string fornecedor | Normalização/fuzzy match | Match exato `=` (strings da mesma coluna EF → dropdown → params) | EF já faz `.trim().slice(0,200)`; dropdown alimentado pelas OCs; params inseridos com o valor exato do dropdown |
| Cálculo de parâmetros por nível | Re-calcular no hook | COALESCE SQL na RPC (já feito); `resolveParamsBySku` é só espelho para testes | Fórmula centralizada; sem drift entre RPC e TS |

---

## Runtime State Inventory

> Esta phase é evolução de fase existente com fundação parcialmente em prod.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `purchase_orders`: 22 OCs / 135 SKUs / 1.885 un em prod (Phase 65), **TODAS com `fornecedor = NULL`** (EF não deployada) | Re-sync obrigatório após deploy da EF; snapshot delete-org + insert |
| Stored data | `replenishment_params`: constraint `scope='fornecedor'` já válida em prod | Nenhuma — constraints aplicadas |
| Live service config | Migration `20260666000000` aplicada em prod mas **arquivo untracked no git** | Commitar o arquivo (a migration NÃO deve ser re-aplicada — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` é idempotente) |
| OS-registered state | Cron `sync-tiny-purchase-orders-daily` (jobid 34, 03:15 UTC) já ativo em prod | Re-sync manual após deploy; cron cobre sincronizações futuras |
| Secrets/env vars | `SUPABASE_SERVICE_ROLE_KEY` (vault Pattern B `sb_secret_...`) e `TINY_ACCESS_TOKEN` (via `ml_tokens`) — sem mudança | Nenhuma — EF usa os mesmos secrets já configurados |
| Build artifacts | Nenhum novo artefato de build | None |

**Re-sync manual após deploy EF:** Via `net.http_post` ao endpoint da EF com body `{"ml_user_id":"1639558873"}` usando `service_role_key` do vault. EF retorna 202 (waitUntil background). Aguardar ~2-5 min e verificar `SELECT DISTINCT fornecedor, COUNT(*) FROM purchase_orders WHERE organization_id='7f615df7-...' AND fornecedor IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;`.

---

## Common Pitfalls

### Pitfall 1: Nome de fornecedor com espaços ou casing diferente quebra o match

**What goes wrong:** O override em `replenishment_params.scope_value = 'Fornecedor X'` não casa com `purchase_orders.fornecedor = 'Fornecedor X '` (espaço trailing).

**Why it happens:** A EF faz `.trim()` (linha 118: `String(det?.contato?.nome ?? ...).trim().slice(0, 200)`). Mas se o usuário digitou o scope_value manualmente (texto livre), pode ter divergência.

**How to avoid:** Usar SEMPRE o dropdown derivado das OCs (D-10). O dropdown retorna o valor exato da coluna `purchase_orders.fornecedor` (já trimado pela EF). Ao inserir/atualizar `replenishment_params`, `scope_value` é o valor selecionado do dropdown — match garantido.

**Warning signs:** `param_origem = 'marca'` ou `'global'` quando esperado `'fornecedor'` para um SKU que tem OC de um fornecedor parametrizado.

### Pitfall 2: Aplicar a RPC antes do re-sync da EF

**What goes wrong:** A precedência `fornecedor` entra em prod mas `purchase_orders.fornecedor` é NULL para todas as linhas → nenhum SKU beneficia do nível fornecedor; parece funcionar mas o override fica silenciosamente inativo.

**Why it happens:** Sequência errada de execução (D-12/D-13).

**How to avoid:** Plano em 3 steps: (1) deploy EF + re-sync + checkpoint visual de fornecedores; (2) só então migration RPC + frontend.

**Warning signs:** `SELECT COUNT(*) FROM purchase_orders WHERE fornecedor IS NOT NULL;` retorna 0 após deploy da EF.

### Pitfall 3: Re-aplicar a migration `20260666000000` (já em prod)

**What goes wrong:** `ALTER TABLE purchase_orders ADD COLUMN fornecedor TEXT` lança erro se coluna já existe (sem `IF NOT EXISTS`... mas a migration já tem `IF NOT EXISTS`). O risco real é o `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` para `replenishment_params` — é idempotente pelo DROP + ADD mas pode travar se houver linhas com scope='fornecedor' durante a re-aplicação.

**Why it happens:** A migration está untracked — executor pode tentar aplicá-la novamente.

**How to avoid:** Na sequência de execução, o plano deve **commitar o arquivo sem re-aplicar via MCP** (migration já está em prod, `supabase_migrations` já tem o registro). Validar com `SELECT * FROM schema_migrations WHERE version = '20260666000000'` antes de qualquer `apply_migration`.

**Warning signs:** Erro MCP "duplicate version" ao tentar aplicar.

### Pitfall 4: DISTINCT ON com ORDER BY incorreto

**What goes wrong:** `DISTINCT ON (sku_code)` requer que `sku_code` seja o primeiro elemento do `ORDER BY` — caso contrário PostgreSQL lança erro.

**Why it happens:** Tentativa de usar `ORDER BY total_qty DESC` sem o `sku_code` como primeiro campo.

**How to avoid:** `ORDER BY sub.sku_code, sub.total_qty DESC, sub.ultima_data DESC NULLS LAST` (sku_code primeiro, depois os critérios de seleção).

### Pitfall 5: `param_origem` type mismatch no TypeScript

**What goes wrong:** `useReplenishmentBySku.ts` tem `param_origem: "sku" | "marca" | "global"` — quando a RPC passa a retornar `'fornecedor'`, o cast `as "sku" | "marca" | "global"` silencia o erro mas descarta o valor correto.

**Why it happens:** O type union não inclui `'fornecedor'`.

**How to avoid:** Atualizar a interface `ReplenishmentSkuRow.param_origem` e o cast em `mapRow()` antes de deployar a RPC nova.

---

## Code Examples

### Verificar se a migration `20260666` já está registrada em prod

```sql
-- Executar via MCP execute_sql no projeto ckcdevcxgvueywivefgx
SELECT version FROM supabase_migrations WHERE version = '20260666000000';
-- Se retornar 1 linha: migration já aplicada — NÃO reaplicar
-- Se retornar 0 linhas: migration não registrada — aplicar via MCP
```

### Re-sync manual da EF após deploy

```sql
-- Via MCP execute_sql (net.http_post com service_role_key do vault)
SELECT net.http_post(
  url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-purchase-orders',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (SELECT get_app_secret('SUPABASE_SERVICE_ROLE_KEY')),
    'Content-Type',  'application/json'
  ),
  body    := '{"ml_user_id":"1639558873"}'::jsonb
);
```

### Checkpoint: validar fornecedores populados

```sql
-- Executar via MCP execute_sql após re-sync (aguardar ~3min)
SELECT
  fornecedor,
  COUNT(DISTINCT sku)    AS skus_distintos,
  SUM(quantidade)        AS qtd_total
FROM purchase_orders
WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
  AND fornecedor IS NOT NULL
GROUP BY fornecedor
ORDER BY qtd_total DESC;
```

### Verificar fornecedor predominante por SKU (preview da lógica da CTE)

```sql
-- Preview da CTE fornecedor_by_sku antes de aplicar a migration da RPC
SELECT DISTINCT ON (sku_code)
  sku_code, fornecedor, total_qty, ultima_data
FROM (
  SELECT
    sku                                         AS sku_code,
    fornecedor,
    SUM(quantidade)                             AS total_qty,
    MAX(COALESCE(data_entrega, data_pedido))    AS ultima_data
  FROM purchase_orders
  WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
    AND fornecedor IS NOT NULL
  GROUP BY sku, fornecedor
) t
ORDER BY sku_code, total_qty DESC, ultima_data DESC NULLS LAST
LIMIT 10;
```

### Novos casos de teste vitest para `resolveParamsBySku`

```typescript
// Source: codebase analysis — extensão de src/lib/analysis/replenishmentUtils.test.ts

// Caso: fornecedorRow presente, skuRow ausente → usa fornecedor (origem='fornecedor')
it("FORN-05 precedência fornecedor: fornecedorRow presente, skuRow=null → usa fornecedor, origem='fornecedor'", () => {
  const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
  const marcaRow: Partial<ReplenishmentParams>      = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
  const globalRow: Partial<ReplenishmentParams>     = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
  const { params, origem } = resolveParamsBySku(null, fornecedorRow, marcaRow, globalRow);
  expect(origem).toBe("fornecedor");
  expect(params.leadTimeDias).toBe(20);
});

// Caso: skuRow presente vence fornecedor (sku > fornecedor)
it("FORN-05 sku > fornecedor: skuRow presente vence fornecedorRow → origem='sku'", () => {
  const skuRow: Partial<ReplenishmentParams>        = { leadTimeDias: 5, metaCoberturaDias: 14, safetyDays: 2, moq: 12, packMultiple: 6 };
  const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
  const { params, origem } = resolveParamsBySku(skuRow, fornecedorRow, null, null);
  expect(origem).toBe("sku");
  expect(params.leadTimeDias).toBe(5);
});

// Caso: fornecedorRow=null (SKU sem OC), marcaRow presente → marca vence (pula fornecedor)
it("FORN-05 fornecedor=null pula para marca: fornecedorRow=null, marcaRow presente → origem='marca'", () => {
  const marcaRow: Partial<ReplenishmentParams>  = { leadTimeDias: 45, metaCoberturaDias: 90, safetyDays: 10, moq: 5, packMultiple: 2 };
  const globalRow: Partial<ReplenishmentParams> = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
  const { params, origem } = resolveParamsBySku(null, null, marcaRow, globalRow);
  expect(origem).toBe("marca");
  expect(params.leadTimeDias).toBe(45);
});

// Caso: fornecedorRow presente mas marcaRow ausente → fornecedor vence global
it("FORN-05 fornecedor > global: fornecedorRow presente, marcaRow=null → usa fornecedor, origem='fornecedor'", () => {
  const fornecedorRow: Partial<ReplenishmentParams> = { leadTimeDias: 20, metaCoberturaDias: 45, safetyDays: 5, moq: 6, packMultiple: 3 };
  const globalRow: Partial<ReplenishmentParams>     = { leadTimeDias: 30, metaCoberturaDias: 60, safetyDays: 7, moq: 1, packMultiple: 1 };
  const { params, origem } = resolveParamsBySku(null, fornecedorRow, null, globalRow);
  expect(origem).toBe("fornecedor");
  expect(params.leadTimeDias).toBe(20);
});

// Caso: todos null → defaults hardcoded (sem regressão)
it("FORN-05 todos null → defaults 30/60/7/1/1, origem='global'", () => {
  const { params, origem } = resolveParamsBySku(null, null, null, null);
  expect(origem).toBe("global");
  expect(params.leadTimeDias).toBe(30);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `scope IN ('global','marca')` | `scope IN ('global','marca','sku')` | Phase 63 | Permite override por SKU |
| `scope IN ('global','marca','sku')` | `scope IN ('global','marca','sku','fornecedor')` | Phase 66 (migration `20260666`) | Permite override por fornecedor (já em prod) |
| EF sem coluna fornecedor | EF grava `fornecedor = contato.nome` (local não deployado) | Phase 66 (local) | `purchase_orders.fornecedor` será populada após deploy + re-sync |
| `param_origem: "sku" | "marca" | "global"` | `param_origem: "sku" | "fornecedor" | "marca" | "global"` | Phase 66 | TS tipo e RPC retornam nível fornecedor |

**Deprecated/outdated:**
- O campo `scope_value` como `<Input>` livre para `scope='fornecedor'` não deve existir — dropdown obrigatório (D-10).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A migration `20260666000000` está registrada em `supabase_migrations` em prod e NÃO precisa ser re-aplicada | Runtime State Inventory | Se não estiver registrada, o plano deve incluir `apply_migration`; verificar com `SELECT version FROM supabase_migrations WHERE version = '20260666000000'` no checkpoint |
| A2 | A coluna `data_entrega` é a data primária para desempate (com fallback `data_pedido`) | Pattern 1 (CTE fornecedor_by_sku) | Se ambas forem NULL para muitas OCs, o desempate pode ser não-determinístico; validar no checkpoint após re-sync |
| A3 | O `net.http_post` do vault usa `get_app_secret('SUPABASE_SERVICE_ROLE_KEY')` (Pattern B `sb_secret_...`) | Code Examples (re-sync) | Se o secret não existir ou tiver nome diferente no vault do projeto `ckcdevcxgvueywivefgx`, o disparo manual falha; verificar no checkpoint |

**Se A1 for wrong:** O plano deve incluir step de apply_migration explícito (migration é idempotente via `IF NOT EXISTS`).

---

## Open Questions

1. **A migration `20260666` está registrada em `supabase_migrations`?**
   - O que sabemos: arquivo existe no repo (untracked), efeitos em prod (coluna existe, constraint atualizada)
   - O que é incerto: se o Supabase registrou a migration no tracking table
   - Recomendação: validar via `execute_sql` no primeiro task do plano antes de qualquer outra ação

2. **Quantos fornecedores distintos aparecerão após o re-sync?**
   - O que sabemos: 22 OCs em prod (Phase 65). Provavelmente 3-10 fornecedores distintos (Pé Vermeio é um seller pequeno)
   - O que é incerto: se os nomes estão limpos (sem duplicatas com casing diferente)
   - Recomendação: checkpoint após re-sync com query de validação (ver Code Examples)

3. **`data_entrega` vs `data_pedido` na agregação de desempate**
   - O que sabemos: ambas as colunas existem em `purchase_orders` (migration `20260665`)
   - O que é incerto: qual tem maior preenchimento real após o re-sync (EF usa `data` do Tiny para `data_entrega` e `dataPrevista` para `data_pedido`)
   - Recomendação: validar preenchimento na query do checkpoint; se `data_entrega` for rara, usar `COALESCE(data_entrega, data_pedido)` como tiebreaker (Pattern 1 já faz isso)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (`apply_migration`, `deploy_edge_function`, `execute_sql`) | Deploy migrations + EF | Disponível (padrão do projeto) | — | CLI com `SUPABASE_ACCESS_TOKEN` do Wesley |
| Supabase project `ckcdevcxgvueywivefgx` | All backend changes | Disponível (prod) | — | — |
| `vitest` | Testes TS | Disponível | 3.2.4 | — |
| Tiny ERP OAuth token (org Pé Vermeio) | Re-sync EF | Disponível (verificado Phase 65, sync 22 OCs funcionou) | — | N/A |

**Deploy de EF:** Requer `SUPABASE_ACCESS_TOKEN` do Wesley (padrão: orquestrador faz via MCP `deploy_edge_function`, executor não deploya EF diretamente — lição Phase 65/59).

---

## Project Constraints (from CLAUDE.md)

- **Stack:** React 18.3.1 + TypeScript 5.8.3 + Vite + shadcn/ui + Supabase — sem novas dependências externas.
- **Supabase project:** `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md — desatualizado).
- **Edge Functions runtime:** Deno (`https://deno.land/std@0.168.0/http/server.ts`; imports via `esm.sh`).
- **Testes:** `vitest run` — sem `nyquist_validation` (config `false`).
- **Migrations:** Aplicar via MCP `apply_migration` no projeto correto — NUNCA `supabase db push` (CLI linkado ao projeto errado).
- **SECURITY INVOKER:** Padrão de todas as RPCs de reposição desde Phase 63 — NUNCA DEFINER para RPCs com `p_org_id`.
- **EF deploy:** Via MCP `deploy_edge_function` pelo orquestrador; `gsd-executor` não tem acesso a este MCP.
- **GSD workflow:** Trabalho via GSD commands; edições diretas só se Wesley pedir bypass.

---

## Sources

### Primary (HIGH confidence)

- Codebase direto — `supabase/migrations/20260665000100_get_replenishment_by_sku_incoming.sql` — RPC atual lida linha a linha; CTE pattern verificado
- Codebase direto — `supabase/migrations/20260666000000_fornecedor_scope.sql` — fundação da fase; estado exato da coluna e constraint
- Codebase direto — `supabase/functions/sync-tiny-purchase-orders/index.ts` — código do `fornecedor = contato.nome` na linha 118; padrão waitUntil confirmado
- Codebase direto — `src/lib/analysis/replenishmentUtils.ts` + `replenishmentUtils.test.ts` — assinatura atual de `resolveParamsBySku`; todos os casos de teste existentes
- Codebase direto — `src/components/mercadolivre/ReplenishmentParamsDialog.tsx` — CRUD existente; type `Scope`, schema Zod, pattern do form
- Codebase direto — `src/hooks/useReplenishmentBySku.ts` — interface `ReplenishmentSkuRow`, `param_origem` type, `mapRow`
- Codebase direto — `.planning/phases/66-compras-v2-override-por-fornecedor/66-CONTEXT.md` — decisões travadas D-01..D-14

### Secondary (MEDIUM confidence)

- `STATE.md` — histórico das Phases 63/65 para contexto de padrões estabelecidos

### Tertiary (LOW confidence)

- Nenhum — toda pesquisa foi via leitura direta do código-fonte em prod.

---

## Metadata

**Confidence breakdown:**
- Estado atual do código: HIGH — leitura direta de migrations, EF, hooks, componentes
- Padrão da CTE `fornecedor_by_sku`: HIGH — `DISTINCT ON` com subquery de agregação é o padrão canônico PostgreSQL para "pick 1 per group with tiebreak"; espelha exatamente `incoming_by_sku`
- Status da migration `20260666` em prod: HIGH (aplicada) / MEDIUM (se registrada em `supabase_migrations`) — validar no checkpoint
- Quantidade de fornecedores e qualidade dos nomes: LOW — só verificável após re-sync

**Research date:** 2026-06-26
**Valid until:** Até mudança de schema ou upgrade de Supabase PostgreSQL (estável por 90+ dias)
