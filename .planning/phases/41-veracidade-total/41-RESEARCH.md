# Phase 41: Veracidade Total - Research

**Researched:** 2026-06-12
**Domain:** ML Billing API, comissão real por anúncio, consistência de fonte única entre páginas
**Confidence:** HIGH (codebase verificado diretamente; billing API verificada via implementação em produção do nexo-mcp)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **DATA-01 JÁ EXECUTADO:** migration `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve` aplicada e validada em produção (commit fc090c46). Plano de DATA-01 = SOMENTE validação visual no card "Custos" + eventual fix residual de frontend. NÃO recriar a migration.
- A migration local `20260601000000` foi REMOVIDA do repo de propósito. Nunca restaurá-la.
- **DATA-02** → adaptar/executar plano pronto `31-01-PLAN.md`
- **DATA-03** → adaptar/executar plano pronto `21-01-PLAN.md`
- **DATA-04 — Billing:** tabela `ml_billing_monthly` com colunas `id`, `organization_id`, `ml_user_id`, `period_month` (YYYY-MM), `charges` (JSONB array tipo+valor), `resumo` (JSONB totais), `synced_at`. RLS por `organization_id` (padrão `is_org_member`). EF `sync-ml-billing` busca `/billing/integration/monthly/periods` (endpoint exato confirmado). Dashboard /vendas: linha "Frete ML" usa CFFE real quando billing disponível, NOVA linha "Parcelamento (CFONPN)" no breakdown de custos. Indicador de fonte "billing" vs "estimado".
- **DATA-05:** Substituir `LISTING_TYPE_RATES` hardcoded por tarifa real da API ML por anúncio.
- **DATA-06:** /vendas, /financeiro e /anuncios MESMA fonte — `useMLCostWaterfall` como autoritativo.
- **Supabase projeto:** `ckcdevcxgvueywivefgx` (CLAUDE.md cita gionpsuunfkkzzjdubfy — DESATUALIZADO). NUNCA `supabase db push` sem `--project-ref ckcdevcxgvueywivefgx`.
- **Migrations:** arquivo em `supabase/migrations/` E aplicar via MCP `apply_migration` no ckcdevcxgvueywivefgx.
- **Edge functions:** deploy via MCP `deploy_edge_function` ou `npx supabase functions deploy <fn> --project-ref ckcdevcxgvueywivefgx`.
- **Multi-conta:** 2 contas ML em produção (1639558873 Pé Vermeio + 427063369). Escopar tudo por `organization_id` + `ml_user_id`.
- Escopo billing: CFFE + CFONPN apenas. DIFAL/CSHIA = deferred.
- Backfill billing: mês corrente + mês anterior basta.

### Claude's Discretion

- Formato exato do parse da Billing API (charges → JSONB)
- Estratégia de cache da comissão real (tabela vs in-memory) — coerente com padrões existentes
- Componentização da linha CFONPN e do indicador de fonte no MLCostCard

### Deferred Ideas (OUT OF SCOPE)

- DIFAL, CSHIA e cobranças menores do billing (v8+)
- Billing para histórico longo (backfill de meses antigos)
- UI-SPEC formal — polish visual completo na Phase 46
- Phase 23 dashboard granular
- Phases 28/29 performance
- Landing page pública
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Card "Custos" em /vendas exibe CMV e Impostos não-nulos — backend já corrigido | Migration validada via SQL; apenas confirmação visual pendente. Ver seção "DATA-01 Status Real". |
| DATA-02 | Filtro "Hoje" carrega via auto-recalc silencioso com skeleton — nunca "—" estático | `useAutoRecalc` já implementado e wired em MercadoLivre.tsx; plano 31-01 descreve ajustes remanescentes. Ver seção "DATA-02: Estado Atual". |
| DATA-03 | Lucro Bruto mensal de fonte única (useMLCostWaterfall) sem cancelados | `monthlyCostWaterfall` já wired; `GoalsCard` já recebe `grossProfitRevenue`; plano 21-01 válido para ajustes remanescentes. Ver seção "DATA-03: Estado Atual". |
| DATA-04 | CFFE real ("Frete ML") + linha "Parcelamento (CFONPN)" no breakdown — tabela + EF | Endpoint confirmado via nexo-mcp produção. Ver seção "DATA-04: ML Billing API". |
| DATA-05 | Comissão em /anuncios via API ML real — fim do LISTING_TYPE_RATES hardcoded | `ml-precos-custos` EF já existe e funciona; `commCache` em MLAnuncios.tsx já parcialmente real. Ver seção "DATA-05: Comissão Real". |
| DATA-06 | KPIs de /vendas, /financeiro e /anuncios batem entre si | /financeiro já usa `useMLCostWaterfall`; /anuncios usa `commCache` via listing_prices; inconsistência residual mapeada. Ver seção "DATA-06". |
</phase_requirements>

---

## Summary

Esta fase entrega veracidade total dos números financeiros em três páginas (/vendas, /financeiro, /anuncios). A maior parte da fundação já está construída — as Phases 21, 31, 32, 38, 39 entregaram `useMLCostWaterfall`, `useAutoRecalc`, `MLCostCard`, `useMLProductCosts`, `commCache` via listing_prices e as RPCs de backend. O que falta é (a) validação visual do DATA-01, (b) ajustes mínimos nos planos prontos 31-01 e 21-01 para refletir o código atual, (c) criação da tabela `ml_billing_monthly` e EF `sync-ml-billing` para CFFE/CFONPN real (DATA-04), (d) ampliar o `commCache` de /anuncios para buscar sale_fee por anúncio ao invés de usar LISTING_TYPE_RATES (DATA-05), e (e) validação cruzada entre páginas contra os números de referência Nexo Abril/2026.

O endpoint de billing está confirmado via implementação em produção do `nexo-mcp/supabase/functions/sync-billing/index.ts`: `/billing/integration/monthly/periods?group=ML&document_type=BILL` seguido de `/billing/integration/periods/key/{period_key}/summary/details?document_type=BILL`. O campo `bill_includes.charges` contém array com `type` e `amount`; CFFE = charge com `type` contendo "CFFE", CFONPN = charge com `type` contendo "CFONPN".

**Recomendação primária:** Reusar o padrão exato do `nexo-mcp/supabase/functions/sync-billing/index.ts` para a EF `sync-ml-billing` deste projeto, adaptando para o modelo de auth e tabela do garment-glow (token via `ml_tokens`, upsert em `ml_billing_monthly` por organization_id + ml_user_id + period_month).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Billing sync (CFFE/CFONPN) | Edge Function (Supabase) | — | Requer token ML server-side; não pode rodar no browser |
| Persistência de billing | Database (ml_billing_monthly) | — | Dados mensais agregados; não recalcular a cada request |
| Display de CFFE/CFONPN | Frontend (MLCostCard) | — | Componente já existente; nova linha no waterfall |
| Indicador de fonte billing vs estimado | Frontend (MLCostCard) | — | Label visual simples junto ao valor |
| Comissão real por anúncio | Frontend + Edge Function | DB (cache opcional) | `ml-precos-custos` já existe; commCache in-memory funciona; DB seria over-engineering |
| Lucro Bruto mensal (DATA-03) | Frontend (MercadoLivre.tsx + GoalsCard) | DB (orders RPC) | useMLCostWaterfall já agrega server-side |
| Auto-recalc CMV/impostos (DATA-02) | Frontend (useAutoRecalc) | Edge Function (recalc-order-costs) | Hook já implementado |
| Consistência entre páginas | Frontend (hooks compartilhados) | — | useMLCostWaterfall como autoridade única |

---

## Standard Stack

### Core (já instalado, não instalar novamente)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@tanstack/react-query` | 5.83.0 | Server state + caching | Em uso |
| `@supabase/supabase-js` | 2.98.0 | Client SDK | Em uso |
| `zod` | 3.25.76 (front) / 3.22.4 (Deno) | Schema validation | Em uso |
| `date-fns` | 3.6.0 | Date formatting | Em uso |
| Deno std 0.168.0 | — | Edge function runtime | Em uso |

**Nenhum pacote novo a instalar nesta fase.**

---

## Package Legitimacy Audit

Nenhum pacote externo novo será instalado nesta fase. Todos os packages já estão no projeto e foram validados em fases anteriores.

| Package | Verdict | Disposition |
|---------|---------|-------------|
| (nenhum novo) | — | — |

---

## Architecture Patterns

### DATA-01: Status real após migration 20260612120000

**O que a migration fez (confirmado via leitura do arquivo):**

1. `get_cost_waterfall`: fallback `COALESCE(o.receita_bruta, o.preco_unit * o.quantidade, 0)` — orders com `receita_bruta` NULL não zeram o `paid_revenue` do hook.
2. `batch_upsert_orders`: preserva `receita_bruta`/`receita_liquida` existentes em re-sync (COALESCE no DO UPDATE).
3. Backfill idempotente: `UPDATE orders SET receita_bruta = preco_unit * quantidade WHERE receita_bruta IS NULL`.

**Estado em produção (confirmado via STATE.md):** paid_revenue R$115.195, CMV R$46.165, tax R$23.667 (402 orders jun/01-12).

**O que DATA-01 no plano precisa fazer:** somente abrir o dashboard /vendas e confirmar visualmente que o card "Custos" mostra CMV e Impostos com valores. Se não aparecer, investigar qual caminho de código está bloqueando (ex.: `paid_revenue === 0` guard no hook retornando null, ou estimação por `estimationBase` returnando `cmvParaCard = null` por falta de `has_cmv`). Sem nova migration.

### DATA-02: Estado atual do auto-recalc

**O que JÁ ESTÁ implementado (verificado em MercadoLivre.tsx e useAutoRecalc.ts):**

- `useAutoRecalc` existe em `src/hooks/useAutoRecalc.ts` com lógica completa (Caso 1: null + inclui hoje → sync + recalc; Caso 2: waterfall sem CMV/impostos → recalc).
- Está wired em `MercadoLivre.tsx` (linhas 188-189) para período selecionado e mensal.
- Retorna `{ isRecalcing }` exposto para `MLKPIGrid` via `kpiSummaryLoading || isRecalcing`.

**O que o plano 31-01 descreve que ainda pode ser necessário:**

- Task 31-01-C: auto-sync em `/pedidos` ao abrir com 0 orders — verificar se `MLPedidos.tsx` já tem essa lógica. Se não, implementar.
- Task 31-01-D: garantir `recalc-order-costs` deployada (já está, mas verificar).

**Ajuste necessário no plano 31-01:** Task 31-01-A (criar `useAutoRecalc`) e 31-01-B (wiring em MercadoLivre.tsx) já estão prontos. O plano da Phase 41 para DATA-02 pode pular A e B e ir direto para C (MLPedidos) e D (verificar deploy).

### DATA-03: Estado atual do Lucro Bruto mensal

**O que JÁ ESTÁ implementado (verificado em MercadoLivre.tsx):**

- `monthlyCostWaterfall` usando `useMLCostWaterfall(monthlyFrom, monthlyTo)` já presente (linha 163).
- `currentGrossProfit` calculado sem cancelados (linha 170-182): `paid_revenue - cmv - comissao - frete - adsTotal - tax`.
- `GoalsCard` recebe `grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0}` (linha 585).
- `useMLCostWaterfall` já inclui `total_tax` e `has_tax_data` em seu retorno (confirmado via código do hook).

**O que o plano 21-01 descreve que pode ainda ser necessário:**

- Task 1 (remover `monthlyKpiSummary`): verificar se `useMLKPISummary` ainda é importado em MercadoLivre.tsx para o mês — sim, ainda está na linha 147 para `kpiSummary` do período selecionado (não mensal). Mas `monthlyKpiSummary` não é mais usado para Lucro Bruto. Confirmar que não há dependência residual.
- Task 2 (remover `rangeSyncedRef`): verificar se esse bloco de useEffect ainda existe no código atual — não está visível na leitura; provavelmente já foi removido.
- Task 3 (staleTime): verificar valor atual em `useMLDailyQuery`.

**Conclusão para DATA-03:** a lógica central já foi implementada nas Phases anteriores. O plano da Phase 41 para DATA-03 é principalmente de verificação + cleanup de dead code residual, se houver.

### DATA-04: ML Billing API — Endpoint Confirmado

**Fonte:** `nexo-mcp/supabase/functions/sync-billing/index.ts` (implementação em produção, validada com seller 1639558873).

**Fluxo de 2 chamadas:**

```
Step 1: GET /billing/integration/monthly/periods
  Params: seller_id={ml_numeric_id}&group=ML&document_type=BILL
  Response: { results: [ { key: "YYYY-MM..." } ] }
  
Step 2: GET /billing/integration/periods/key/{period_key}/summary/details
  Params: seller_id={ml_numeric_id}&document_type=BILL
  Response: { bill_includes: { charges: [...], bonuses: [...] } }
```

**Estrutura de cada charge:**
```json
{
  "type": "CFFE",
  "label": "Cargo por venda Full",
  "amount": 40065.00,
  "group_id": "...",
  "group_description": "..."
}
```

**Tipos relevantes (do `nexo-mcp/ml_client.py` e `sync-billing`):**
- `CFFE` — cargo por venda Full/frete (frete absorvido pelo ML Full)
- `CFONPN` — cargo financiamento sem juros (parcelamento)
- `BVVML` — bonificação (bonus; valor negativo = crédito)
- `PADS` — publicidade

**Parse para `charges` JSONB:** array de `{ type: string, label: string, amount: number }` — apenas charges relevantes (CFFE + CFONPN). Bonuses separados ou incluídos como amount negativo.

**`resumo` JSONB:**
```json
{
  "cffe": 40065.00,
  "cfonpn": 15902.00,
  "total_charges": 95000.00,
  "synced_at": "2026-06-12T..."
}
```

**Auth na EF `sync-ml-billing`:** mesma tabela `ml_tokens` que `sync-ml-orders`. Token refresh via `ml-token-refresh` EF ou inline (padrão do sync-ml-orders: lookup em `ml_tokens` com `.maybeSingle()`; se expirado, invocar `ml-token-refresh`). Usar `SUPABASE_SERVICE_ROLE_KEY` como serviceRole para upsert.

**Paginação:** a API de billing não tem paginação — retorna todos os charges do período de uma vez.

**Rate limits:** [ASSUMED] não documentados publicamente; o nexo-mcp usa timeout de 15s e retries=2 sem problemas em produção.

**Schema da tabela `ml_billing_monthly`:**
```sql
CREATE TABLE public.ml_billing_monthly (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  ml_user_id      TEXT NOT NULL,
  period_month    TEXT NOT NULL,  -- YYYY-MM
  charges         JSONB,          -- array [{type,label,amount}]
  resumo          JSONB,          -- {cffe, cfonpn, ...}
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, period_month)
);
```

**RLS:** `CREATE POLICY "org_member_billing" ON ml_billing_monthly FOR ALL USING (is_org_member(auth.uid(), organization_id));`

### DATA-05: Comissão Real por Anúncio

**O que já existe (verificado em MLAnuncios.tsx e ml-precos-custos/index.ts):**

- `commCache` em MLAnuncios.tsx (Map em memória) já busca comissão via `ml-precos-custos` EF com `type=costs`.
- Endpoint: `/sites/MLB/listing_prices?price=X&category_id=Y&logistic_type=Z`.
- Resposta: `{ costs: [{ listing_type_id, sale_fee_amount, percentage_fee }] }`.
- O `commCache` é populado via `useEffect` quando `columnView === "financeiro"` e há itens filtrados (linhas 820-843 do MLAnuncios.tsx).
- `getCommissionRate()` (linha 58) ainda usa `LISTING_TYPE_RATES` como fallback quando `commCache` não tem o item.

**O que ainda falta (DATA-05):**

1. `getCommissionRate()` deve consultar `commCache` primeiro, antes de cair no `LISTING_TYPE_RATES`. Atualmente o `commCache` é usado diretamente na coluna financeiro (linha 837) mas `getCommissionRate()` é uma função separada que NÃO consulta `commCache`.
2. O `commCache` é lazy (só busca quando `columnView === "financeiro"`) — para DATA-06, o valor de comissão exibido em /anuncios deve ser o mesmo que em /vendas (que usa `useMLCostWaterfall → orders.comissao`).
3. **Abordagem recomendada para DATA-05:** o `commCache` in-memory via listing_prices é a abordagem correta para o **por anúncio** em /anuncios. Para o **total** de comissão (KPI), /anuncios deve ler de `orders.comissao` (via `useMLCostWaterfall` se disponível) ou exibir total de `commCache * sold_quantity`. Escolher a abordagem mais simples: usar `commCache` para exibir comissão por item na tabela, e `useMLCostWaterfall.total_comissao` para o KPI de comissão total.

**`LISTING_TYPE_RATES` não deve ser deletado** — ainda é usado em `getFinancialDailyStats()` e `getListingTypeBreakdown()` para estimativas em /financeiro (funções mock para gráficos diários). Esses gráficos são escopo da Phase 46 (UX). Na Phase 41, apenas remover o uso de `LISTING_TYPE_RATES` em `getCommissionRate()` quando o `commCache` já tem o item.

### DATA-06: Consistência entre páginas

**Mapeamento atual de fonte por página:**

| Métrica | /vendas | /financeiro | /anuncios |
|---------|---------|-------------|-----------|
| Receita bruta | `costWaterfall.paid_revenue` | `waterfall.paid_revenue` | `sold_quantity * price` (estático) |
| Comissão total | `costWaterfall.total_comissao` | `waterfall.total_comissao` | `commCache` (soma estimada) |
| Frete | `costWaterfall.total_frete` | `waterfall.total_frete` | não exibido |
| CMV | `costWaterfall.cmv` | `waterfall.cmv` | `useMLProductCosts.costsBySku` |
| Impostos | `costWaterfall.total_tax` | `waterfall.total_tax` | não exibido |
| Lucro bruto | calculado no MercadoLivre.tsx | calculado em MLFinanceiro.tsx | não exibido |

**Conclusão:** /vendas e /financeiro já são consistentes (ambos usam `useMLCostWaterfall`). /anuncios usa abordagem diferente para comissão (listing_prices por item em vez de orders agregados) — isso é aceitável porque /anuncios mostra comissão por anúncio individual, não totais do período.

**Validação contra referência Nexo Abril/2026:**
- Comissão real R$39.170 (11,15%) → deve bater com `SUM(orders.comissao)` para Abril/2026
- CFFE billing R$40.065 → `ml_billing_monthly.resumo.cffe` para Abril/2026
- CFONPN R$15.902 → `ml_billing_monthly.resumo.cfonpn`
- Verificar: /vendas e /financeiro mostram o mesmo `total_comissao` para o mesmo período

### Padrão de Edge Function — Template Reutilizável

**Auth pattern atual em `sync-ml-orders`:**
```typescript
// 1. Aceita Authorization: Bearer <serviceKey> OU Bearer <userJWT>
// 2. Se serviceRole → userId = null, skip org check
// 3. Se userJWT → valida com supabaseAdmin.auth.getUser(token)
// 4. Org membership check: is_org_member RPC
// 5. Token ML: ml_tokens.select("access_token").eq("ml_user_id", ...).maybeSingle()
```

**Para `sync-ml-billing`:** mesma estrutura, com body: `{ ml_user_id, period_month }`. O `ml_numeric_id` (necessário como `seller_id` param na API de billing) já está em `/users/me` (o sync-billing do nexo usa `get_seller_token` RPC; em garment-glow o token está em `ml_tokens` e o numeric ID pode ser obtido via `/users/me` ou armazenado em `ml_user_cache`).

**CRÍTICO — Lição Phase 38:** nunca engolir erros em edge functions. O padrão correto é `throw` + `catch` no handler principal retornando 500:
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("sync-ml-billing error:", message);
  return new Response(JSON.stringify({ success: false, error: message }), { status: 500 });
}
```

**Deno runtime (garment-glow usa `std@0.168.0`):**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
```

---

## Don't Hand-Roll

| Problema | Não construir | Usar em vez | Por quê |
|----------|--------------|-------------|---------|
| Billing API endpoint | Especulação sobre endpoint | `/billing/integration/monthly/periods` + `/billing/integration/periods/key/{key}/summary/details` | Confirmado via nexo-mcp produção |
| Token ML refresh | Lógica própria | `ml-token-refresh` EF (já existe) ou lookup em `ml_tokens` com refresh inline (padrão de sync-ml-orders) | Padrão validado |
| Comissão por anúncio | `LISTING_TYPE_RATES` | `ml-precos-custos` EF com `type=costs` | API real, já implementada |
| Lucro Bruto mensal | Query custom com cancelados | `useMLCostWaterfall` | Filtra por PAID_STATUSES no SQL |
| Auto-recalc | Loop polling | `useAutoRecalc` hook (já implementado) | Usa `firedRef` para não re-disparar |

---

## Common Pitfalls

### Pitfall 1: period_key da Billing API não é YYYY-MM

**O que vai errado:** assumir que o `key` retornado por `/billing/integration/monthly/periods` é exatamente `"2026-04"`. Na prática pode ser `"2026-04"`, `"202604"`, ou `"2026-04-01"` dependendo do seller e do tipo de billing.

**Como evitar:** usar `k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(monthCompact)` (padrão do nexo-mcp sync-billing, linha 65-68).

### Pitfall 2: 404 na Billing API para contas sem Full

**O que vai errado:** a EF falha com erro não tratado para sellers que não usam Mercado Envios Full.

**Como evitar:** tratar `if (!periodsResp.ok && periodsResp.status === 404) return null` — armazenar `null` na tabela e exibir "estimado" (fallback para frete de orders).

### Pitfall 3: `paid_revenue === 0` no hook retorna null e destrói estimação

**O que vai errado:** `useMLCostWaterfall` retorna `null` quando `paid_revenue === 0`. Para o período "Hoje" às 8h da manhã (sem pedidos ainda), o card "Custos" fica vazio.

**Como evitar:** o `useAutoRecalc` já detecta esse caso (Caso 1: `costWaterfall === null && periodIncludesToday`) e dispara sync. O card deve mostrar skeleton/loading enquanto `isRecalcing === true`.

### Pitfall 4: `LISTING_TYPE_RATES` deletado antes de verificar todos os consumidores

**O que vai errado:** `getFinancialDailyStats()` e `getListingTypeBreakdown()` em `financialMockData.ts` ainda usam `LISTING_TYPE_RATES` para estimativas gráficas no /financeiro.

**Como evitar:** na Phase 41, substituir `LISTING_TYPE_RATES` APENAS em `getCommissionRate()` de MLAnuncios.tsx. Não deletar o objeto de `financialMockData.ts` — esse cleanup fica para Phase 46.

### Pitfall 5: Deno runtime vs Node imports

**O que vai errado:** usar `import fetch from "node-fetch"` ou `import { AbortController }` em edge functions Deno.

**Como evitar:** usar `AbortSignal.timeout(ms)` nativo do Deno; fetch é global; imports via `https://esm.sh/` ou `https://deno.land/x/`.

### Pitfall 6: `organization_id` NULL em ml_billing_monthly

**O que vai errado:** inserção com `organization_id = null` passa na EF service-role mas RLS bloqueia leitura pelo usuário.

**Como evitar:** o `ml_user_id` resolve o `organization_id` via `ml_tokens.organization_id`. Se `organization_id` for null, logar e pular o upsert (não lançar erro fatal — conta pode não ter org vinculada).

### Pitfall 7: ml_numeric_id vs ml_user_id

**O que vai errado:** a Billing API usa o `seller_id` numérico (ex: `1639558873`) como query param, mas `ml_tokens` armazena `ml_user_id` que pode ser igual ou diferente.

**Como evitar:** buscar `/users/me` para obter o `id` numérico do seller (mesmo padrão de `sync-ml-orders` linha 474). Alternativa: `ml_user_cache` armazena o numeric ID — verificar se está disponível.

---

## Code Examples

### Fetch de billing period (padrão validado nexo-mcp)

```typescript
// Source: /root/nexo-mcp/supabase/functions/sync-billing/index.ts (produção)
async function fetchBillingPeriod(
  token: string,
  sellerId: string,  // numeric ML ID (ex: "1639558873")
  periodMonth: string,  // YYYY-MM
): Promise<{ cffe: number; cfonpn: number; charges: any[] } | null> {
  const ML_API = "https://api.mercadolibre.com";
  
  // Step 1: list periods
  const periodsResp = await fetch(
    `${ML_API}/billing/integration/monthly/periods?seller_id=${sellerId}&group=ML&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!periodsResp.ok) return null;  // 404 = sem Full

  const periodsData = await periodsResp.json();
  const periodList: any[] = periodsData.results ?? [];
  
  const month = periodMonth;  // YYYY-MM
  const monthCompact = month.replace("-", "");
  const period = periodList.find((p: any) => {
    const k = String(p.key ?? "");
    return k.startsWith(month) || k.substring(0, 7) === month || k.startsWith(monthCompact);
  });
  if (!period?.key) return null;

  // Step 2: fetch summary/details
  const detailResp = await fetch(
    `${ML_API}/billing/integration/periods/key/${period.key}/summary/details?seller_id=${sellerId}&document_type=BILL`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!detailResp.ok) return null;

  const data = await detailResp.json();
  const bill = data.bill_includes ?? {};
  const charges: any[] = bill.charges ?? [];

  // Extract CFFE and CFONPN
  const cffe   = charges.filter(c => String(c.type ?? "").includes("CFFE")).reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const cfonpn = charges.filter(c => String(c.type ?? "").includes("CFONPN")).reduce((s, c) => s + Number(c.amount ?? 0), 0);

  return {
    cffe,
    cfonpn,
    charges: charges.map(c => ({ type: c.type, label: c.label, amount: Number(c.amount ?? 0) })),
  };
}
```

### Uso de sale_fee real no MLCostCard (para CFFE como nova linha)

```typescript
// Adicionar nova linha no array `lines` dentro de MLCostCard.tsx
// Após a linha "Frete" (usa CFFE billing quando disponível, senão frete de orders)
{
  icon: <CreditCard className="w-3.5 h-3.5 text-violet-400" />,
  label: "Parcelamento (CFONPN)",
  value: cfonpn,          // prop nova: number | null
  nullLabel: undefined,   // não mostrar quando null (sem billing)
  base: gross_revenue,
  color: "text-foreground",
},
```

### Indicador de fonte billing vs estimado

```typescript
// Em MLCostCard — label junto ao frete quando billing disponível
<span className="text-[9px] text-muted-foreground/60 ml-1">
  {billingSource ? "billing" : "estimado"}
</span>
```

### Auth token lookup (padrão garment-glow)

```typescript
// Source: supabase/functions/sync-ml-orders/index.ts (produção)
const { data: tokenRow } = await supabaseAdmin
  .from("ml_tokens")
  .select("access_token, organization_id, seller_id")
  .eq("ml_user_id", ml_user_id)
  .not("access_token", "is", null)
  .limit(1)
  .maybeSingle();
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Frete hardcoded (5%) | `total_frete` de orders reais | Phase 15 / 38 | Erro de R$22k/mês eliminado |
| CFONPN = R$0 | `ml_billing_monthly.cfonpn` | Phase 41 (DATA-04) | R$15.9k/mês visível |
| Comissão hardcoded (11.5%/16.5%) | `sale_fee` real por anúncio via listing_prices | Phase 41 (DATA-05) | Comissão por item precisa |
| Lucro Bruto inclui cancelados | `useMLCostWaterfall` filtra por PAID_STATUSES | Phase 21/25 | Denominador correto |

**Deprecated:**
- `LISTING_TYPE_RATES` como fonte de comissão em `getCommissionRate()`: substituir por `commCache` lookup. O objeto em si permanece (usado em funções mock).
- `rangeSyncedRef` auto-sync block: removido (verificar se ainda existe em MercadoLivre.tsx).

---

## Assumptions Log

| # | Claim | Section | Risk se Errado |
|---|-------|---------|----------------|
| A1 | Rate limits da Billing API são permissivos o suficiente para 2 sellers × 2 meses = 4 chamadas/sync | DATA-04: ML Billing API | EF pode rate-limit; mitigação: log e retornar null |
| A2 | O `type` do charge CFFE contém literalmente a string "CFFE" (e CFONPN contém "CFONPN") | DATA-04: Parse | Parse incorreto → ambos zerados; mitigação: logar os types encontrados |
| A3 | O `rangeSyncedRef` auto-sync block foi removido de MercadoLivre.tsx nas Phases 34-40 | DATA-02: Estado Atual | Se ainda existe, pode causar sync excessivo; mitigação: verificar no código atual |
| A4 | `ml_user_cache` armazena o numeric ID do seller de forma acessível na EF | DATA-04: Código | Se não, buscar `/users/me` (como sync-ml-orders já faz) — sem impacto funcional, apenas 1 request extra |

---

## Open Questions (RESOLVED — tratadas defensivamente nos planos 41-01/41-03)

1. **`/pedidos` auto-sync já implementado?**
   - O que sabemos: `useAutoRecalc` wired em MercadoLivre.tsx para /vendas; plano 31-01-C descreve auto-sync em MLPedidos.tsx.
   - O que não está claro: se MLPedidos.tsx já recebeu esse fix nas Phases 34-40.
   - Recomendação: verificar MLPedidos.tsx antes de criar a task — pode já estar feito.

2. **`monthlyKpiSummary` ainda em uso?**
   - O que sabemos: `useMLKPISummary` ainda importado em MercadoLivre.tsx (linha 19) e chamado para o período selecionado (linha 147). Mas Lucro Bruto mensal já usa `monthlyCostWaterfall`.
   - O que não está claro: se há dead code residual do Plano 21 (chamada mensal do kpiSummary).
   - Recomendação: verificar se há `useMLKPISummary` com `monthlyFrom/monthlyTo` — se não houver, tarefa 21-Task1 já foi executada.

3. **CFFE = frete Full ou comissão Full?**
   - O que sabemos: referência Nexo: frete orders R$37.555 vs CFFE billing R$40.065 — billing inclui extras. CFFE é "cargo por venda Full" (inclui frete + extras de logística Full).
   - Implicação para DATA-04: quando billing disponível, linha "Frete ML" no MLCostCard deve usar CFFE (não `total_frete` de orders), pois é mais preciso. Mas o plano deve deixar claro qual campo usar — recommend: `cffe` do billing como "Frete ML (Full)" quando disponível, com fallback para `total_frete`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP | Deploy migrations/EFs | Confirmado (system-reminder) | — | `npx supabase functions deploy --project-ref ckcdevcxgvueywivefgx` |
| ML Billing API | DATA-04 | Confirmado via nexo-mcp produção | — | Fallback: frete de orders, CFONPN = null |
| `ml-token-refresh` EF | Auth em sync-ml-billing | Confirmado (existe em supabase/functions/) | — | Refresh inline como sync-ml-orders |
| `recalc-order-costs` EF | DATA-02 | Confirmado deployada (STATE.md) | — | — |
| `ml-precos-custos` EF | DATA-05 | Confirmado (existe e funciona) | — | LISTING_TYPE_RATES como fallback |
| Vercel | Frontend deploy | Confirmado (auto-deploy por push) | — | — |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | vite.config.ts (vitest section) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |
| TypeScript check | `npx tsc --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | CMV e Impostos aparecem no card Custos | smoke visual | — | manual |
| DATA-02 | auto-recalc dispara quando has_cmv=false | unit (useAutoRecalc) | `npx vitest run` | verificar |
| DATA-03 | Lucro Bruto % igual em GoalsCard e MLCostCard | smoke visual | — | manual |
| DATA-04 | sync-ml-billing upserta ml_billing_monthly | integration (EF) | invocar EF manualmente | ❌ Wave 0 |
| DATA-05 | commCache usa listing_prices (não LISTING_TYPE_RATES) | smoke visual | — | manual |
| DATA-06 | comissão total /vendas == /financeiro mesmo período | smoke visual | — | manual |

### Sampling Rate
- **Por task commit:** `npx tsc --noEmit` (0 erros TypeScript obrigatório)
- **Por wave merge:** `npx vitest run`
- **Phase gate:** `npx tsc --noEmit` + smoke visual em /vendas, /financeiro, /anuncios

### Wave 0 Gaps
- [ ] Testes de smoke para `useAutoRecalc` (verificar se já existem)
- [ ] Smoke manual para sync-ml-billing após deploy

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | JWT Supabase em EFs; service_role para upserts |
| V4 Access Control | sim | RLS `is_org_member` em ml_billing_monthly |
| V5 Input Validation | sim | zod no body da EF sync-ml-billing |
| V6 Cryptography | não aplicável | token ML em ml_tokens (armazenamento Supabase RLS) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-org billing data leak | Information Disclosure | RLS por organization_id; verify_jwt=true na EF |
| Token ML exposto | Information Disclosure | EF usa service_role; token nunca vai ao frontend |
| Injeção de period_month malformado | Tampering | zod validation: `z.string().regex(/^\d{4}-\d{2}$/)` |

**CRÍTICO — verify_jwt:** EF `sync-ml-billing` pode ser chamada tanto pelo cliente (usuário autenticado) quanto por cron (service_role). Usar o padrão `isServiceRole = (token === serviceKey)` de `sync-ml-orders` — não setar `verify_jwt=false` no Supabase dashboard.

---

## Sources

### Primary (HIGH confidence — verificado diretamente no codebase)
- `/root/nexo-mcp/supabase/functions/sync-billing/index.ts` — endpoint exato, fluxo de 2 calls, parse de charges, period key matching
- `/root/nexo-mcp/ml_client.py` (linhas 1374-1516) — fetch_billing_full, tipos de charges (CFFE, CFONPN, BVVML, PADS)
- `/root/garment-glow-test/src/hooks/useAutoRecalc.ts` — implementação atual completa
- `/root/garment-glow-test/src/pages/MercadoLivre.tsx` — wiring atual de waterfalls, autorecalc, GoalsCard
- `/root/garment-glow-test/src/hooks/useMLCostWaterfall.ts` — interface atual com total_tax/has_tax_data
- `/root/garment-glow-test/src/components/mercadolivre/MLCostCard.tsx` — props atuais, estrutura de lines
- `/root/garment-glow-test/src/pages/mercadolivre/MLFinanceiro.tsx` — uso de useMLCostWaterfall
- `/root/garment-glow-test/src/pages/mercadolivre/MLAnuncios.tsx` — commCache via listing_prices
- `/root/garment-glow-test/supabase/functions/ml-precos-custos/index.ts` — endpoint listing_prices real
- `/root/garment-glow-test/supabase/functions/sync-ml-orders/index.ts` — auth pattern, token lookup
- `/root/garment-glow-test/supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` — estado atual da RPC get_cost_waterfall

### Secondary (MEDIUM confidence)
- `.planning/phases/31-auto-sync-cmv-impostos-pedidos-realtime/31-01-PLAN.md` — plano reutilizável DATA-02
- `.planning/phases/21-lucro-cache/21-01-PLAN.md` — plano reutilizável DATA-03
- `.planning/STATE.md` — validação em produção de DATA-01 (SQL results)

### Tertiary (LOW confidence — [ASSUMED])
- Rate limits da ML Billing API
- Formato exato do `type` field para CFFE e CFONPN (verificado indiretamente via labels no nexo-mcp, mas não via API response direta)

---

## Metadata

**Confidence breakdown:**
- ML Billing API endpoint/fluxo: HIGH — confirmado via implementação produção nexo-mcp
- Estado atual do codebase (DATA-02/03): HIGH — lido diretamente nos arquivos
- DATA-04 parse (type field CFFE/CFONPN): MEDIUM — inferido do código, não de doc oficial
- Rate limits billing API: LOW — assumido permissivo

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (API ML estável; revisar se ML mudar estrutura de billing)
