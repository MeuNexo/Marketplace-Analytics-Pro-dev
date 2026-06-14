# Phase 44: Monetização Stripe - Research

**Researched:** 2026-06-14
**Domain:** SaaS billing — Stripe Checkout + Webhooks + Customer Portal, Supabase (Deno Edge Functions + Postgres/RLS), React SPA
**Confidence:** HIGH (mecanismo Stripe + integração Supabase Deno verificados em fontes oficiais; gaps de produto marcados como ASSUMED)

## Summary

Phase 44 transforma a infra multi-tenant já endurecida (Phase 43) em um SaaS cobrável. A base necessária **já existe**: a tabela `organization_plans` (org_id PK, `plan_tier` enum `free|starter|pro|enterprise`, `sync_interval_minutes`, `history_days`) e a RPC `check_quota(_org_id)` que aplica `sync_interval_minutes`. O que falta é o **mecanismo de pagamento**: (1) uma Edge Function que cria uma Stripe Checkout Session amarrada à `organization_id`; (2) uma Edge Function de webhook (verify_jwt=false + verificação de assinatura própria) que recebe os 4 eventos Stripe e atualiza atomicamente `subscriptions` + `organization_plans`; (3) a página `/planos` com Customer Portal para upgrade/downgrade; e (4) o enforcement real de `history_days` — hoje o range de data é decidido só no frontend (`mlCacheService.ts` aplica `.gte("date", dateFrom)` com a data que o filtro mandar), sem teto server-side.

O padrão canônico Stripe+Supabase-Deno está consolidado e é o caminho de menor risco: `Stripe` importado de `esm.sh/stripe@<ver>?target=denonext`, raw body via `req.text()`, e `stripe.webhooks.constructEventAsync(body, sig, secret, undefined, cryptoProvider)` com `Stripe.createSubtleCryptoProvider()` (o Deno não tem o módulo `crypto` síncrono do Node, então `constructEvent` síncrono **não funciona** — só a versão async). Isso casa com precedentes do próprio repo (`ml-oauth`, `mercado-libre-integration` usam `verify_jwt=false` e autenticam no código).

**Primary recommendation:** Criar 2 Edge Functions novas (`stripe-checkout` com verify_jwt=true para owner autenticado; `stripe-webhook` com verify_jwt=false + signature verification) + 1 EF de Customer Portal (pode ser merge no `stripe-checkout` por `action`). Modelar `subscriptions` + `billing_events`. O webhook é a **única fonte de verdade** do tier: ele escreve `subscriptions` e propaga `plan_tier`+`sync_interval_minutes`+`history_days` para `organization_plans` via uma RPC atômica `apply_subscription_tier(...)`, de modo que `check_quota` (já existente) continua funcionando sem alteração. Enforcement de `history_days` deve ser **server-side** (clamp do `dateFrom` numa RPC/EF ou via RLS por data), nunca só no React.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Criar Checkout Session (sk_test) | Edge Function (server) | — | Chave secreta nunca pode ir ao browser; precisa amarrar `organization_id` server-side |
| Receber/validar webhook Stripe | Edge Function (verify_jwt=false) | Postgres (RPC atômica) | Raw body + assinatura HMAC; só o backend pode mutar tier |
| Verdade do tier (subscription→plan) | Postgres (`subscriptions` + RPC) | Edge Function | Mutação atômica de `organization_plans` para `check_quota` continuar válido |
| Customer Portal Session | Edge Function (server) | — | Requer `stripe_customer_id` + sk_test server-side |
| Enforcement `sync_interval_minutes` | Postgres RPC `check_quota` | Edge Function `process-sync-job` | JÁ ENTREGUE na Phase 43 — não refazer |
| Enforcement `history_days` | Postgres (RPC clamp / RLS por data) | Frontend (UX: limita o date-picker) | Cliente não é confiável; teto tem de ser server-side |
| Página `/planos` (estado, botões) | Browser (React SPA) | Edge Function (invoke) | UI lê `subscriptions`/`organization_plans` via RLS e dispara EFs |

## Project Constraints (from CLAUDE.md)

- **Supabase project real = `ckcdevcxgvueywivefgx`** (NÃO `gionpsuunfkkzzjdubfy` que está no CLAUDE.md/STACK.md). Todo deploy de EF/migration vai para `ckcdevcxgvueywivefgx`. [VERIFIED: STATE.md + ROADMAP.md linha 7]
- **Edge Functions runtime Deno**: imports de `https://deno.land/std@0.168.0/http/server.ts` (ou `Deno.serve` nativo) + `@supabase/supabase-js@2` via `esm.sh`. [VERIFIED: CLAUDE.md + ml-oauth/index.ts]
- **`types.ts` editado à mão** — adicionar `subscriptions`/`billing_events` manualmente, não regenerar. [CITED: additional_context]
- **Role**: configuração de billing restrita a `owner` — usar `RoleRoute`/`get_org_role(...) = 'owner'`. [VERIFIED: CLAUDE.md auth model + organization_plans RLS]
- **Sem dependências de cálculo externas** no frontend; Stripe SDK roda só no Deno EF (server-side), não no bundle React.
- **DDL sempre via migration commitada** em `supabase/migrations/` (feedback Wesley: drift via SQL Editor proibido).
- **Deploy de EF exige `SUPABASE_ACCESS_TOKEN`** — `gsd-executor` não tem; orquestrador aplica migrations via MCP `apply_migration` e faz deploy de EFs via CLI. [VERIFIED: STATE.md sessão 2026-06-14]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAY-01 | Owner assina plano via Stripe Checkout (tiers de `organization_plans`, trial configurável) | EF `stripe-checkout` cria Checkout Session `mode:'subscription'` com `client_reference_id=organization_id` + `subscription_data.trial_period_days`. Tiers existem; falta mapping `price_id → plan_tier`. (Standard Stack, Pattern 1) |
| PAY-02 | Webhooks Stripe atualizam assinatura/tier em `subscriptions`/`billing_events` | EF `stripe-webhook` (verify_jwt=false) com `constructEventAsync` trata os 4 eventos; RPC `apply_subscription_tier` muta `subscriptions`+`organization_plans` atomicamente. (Pattern 2, Pattern 3) |
| PAY-03 | Página /planos: plano atual, estado de pagamento, upgrade/downgrade via Customer Portal | EF cria `billingPortal.sessions.create`; React `/planos` lê `organization_plans`+`subscriptions` via RLS. (Pattern 4) |
| PAY-04 | Limites do tier aplicados de verdade (`history_days`, `sync_interval_minutes`) | `sync_interval_minutes` JÁ em `check_quota` (Phase 43). `history_days` precisa de enforcement server-side novo (clamp de data). (Pattern 5, Pitfall 7) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` (Node SDK em Deno) | **22.2.1** (latest) — usar via `esm.sh/stripe@<major>?target=denonext` | Criar Checkout/Portal sessions, verificar webhooks | SDK oficial Stripe; suporta `constructEventAsync` + `createSubtleCryptoProvider` para Deno [VERIFIED: npm registry — `npm view stripe version` = 22.2.1, publicado 2026-06-12; repo github.com/stripe/stripe-node; sem postinstall] |
| `@supabase/supabase-js` | `2` (já em uso, ex. `2.49.1`) | Cliente Postgres dentro da EF (service role) | Já é o padrão do projeto [VERIFIED: codebase] |

**Decisão de versão Stripe:** o exemplo oficial Supabase pina `stripe@14` + `apiVersion '2024-11-20'`. O SDK atual é `22.x`. Recomendação: **pinar um major explícito e fixo** (ex. `stripe@18` ou `stripe@22`) via `esm.sh/stripe@22?target=denonext` e definir `apiVersion` para a versão acoplada ao major escolhido. Não usar `esm.sh/stripe` sem pin (quebra reprodutibilidade). O `apiVersion` exato deve ser confirmado no momento do plano via `mcp__context7` ou changelog Stripe — marcado ASSUMED abaixo.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `Stripe.createSubtleCryptoProvider()` | (parte do SDK) | Web Crypto provider p/ verificação async no Deno | Obrigatório no webhook — Deno não suporta `constructEvent` síncrono [VERIFIED: exemplo oficial Supabase] |
| `Stripe.createFetchHttpClient()` | (parte do SDK) | HTTP client baseado em fetch p/ Deno | Recomendado ao instanciar Stripe em EF (`httpClient`) para evitar dependência do http do Node [CITED: docs Supabase] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stripe-hosted Checkout (redirect) | Stripe Elements/Embedded Checkout no React | Embedded exige montar Stripe.js no frontend + mais código; hosted Checkout é o caminho mais simples e o goal só pede "cartão de teste" → **usar hosted Checkout** |
| Customer Portal (hosted) | Tela de upgrade custom + API | Portal hosted cobre upgrade/downgrade/cancel/invoices grátis; goal pede explicitamente Portal → **usar Portal** |
| RPC atômica para tier change | Update direto na EF | RPC SECURITY DEFINER garante atomicidade `subscriptions`+`organization_plans` num só round-trip e centraliza o mapping → **usar RPC** |

**Installation:** Nenhum `npm install` — Stripe roda **só** dentro das Edge Functions Deno (import via `esm.sh`). O bundle React **não** importa `stripe`. Secrets:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_... --project-ref ckcdevcxgvueywivefgx
supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_... --project-ref ckcdevcxgvueywivefgx
```

**Version verification (executado nesta sessão):**
```
npm view stripe version        → 22.2.1 (2026-06-12)  [VERIFIED]
npm view stripe scripts.postinstall → (vazio — sem postinstall) [VERIFIED]
npm view stripe repository.url → github.com/stripe/stripe-node [VERIFIED]
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `stripe` | npm | ~13 anos | dezenas de milhões/semana | github.com/stripe/stripe-node (oficial Stripe) | OK | Aprovado — SDK oficial Stripe, sem postinstall |
| `@supabase/supabase-js` | npm | já em uso no projeto | — | github.com/supabase/supabase-js | OK | Aprovado — já dependência do projeto |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> Observação: a seam `gsd-tools query package-legitimacy check` estava indisponível nesta sessão; verdict derivado de verificação manual via `npm view` (versão atual, sem postinstall, repo oficial). `stripe` é a dependência canônica e de altíssima reputação — risco de slopsquat nulo.

## Architecture Patterns

### System Architecture Diagram

```
                                  ┌─────────────────────────────────────────┐
  Owner (browser)                 │            Supabase (ckcdevcxgvueywivefgx) │
  /planos (React SPA)             │                                           │
       │                          │   ┌────────────────────────────────────┐ │
       │ 1. invoke('stripe-checkout',  │  EF stripe-checkout (verify_jwt=true) │ │
       │    {action:'checkout',   │   │  - auth: owner via get_org_role       │ │
       │     tier, org_id})  ─────────>│  - stripe.checkout.sessions.create(   │ │
       │                          │   │      mode:'subscription',             │ │
       │ <─── { url } ────────────────│      client_reference_id=org_id,      │ │
       │                          │   │      metadata:{org_id,tier},          │ │
       │ 2. window.location=url   │   │      subscription_data:{trial_days})  │ │
       ▼                          │   └────────────────────────────────────┘ │
  Stripe Hosted Checkout          │                                           │
  (cartão 4242…)                  │                                           │
       │ 3. paga                  │   ┌────────────────────────────────────┐ │
       │                          │   │  EF stripe-webhook (verify_jwt=FALSE) │ │
  Stripe ── 4. POST event ────────────>│  - body = req.text() (RAW)           │ │
   (checkout.session.completed,   │   │  - constructEventAsync(body,sig,      │ │
    invoice.paid,                 │   │      secret, undefined, cryptoProvider)│ │
    customer.subscription.        │   │  - dedupe: insert billing_events      │ │
      updated/deleted)            │   │      (event.id UNIQUE) → 200 se dup    │ │
       │                          │   │  - switch(event.type) →               │ │
       │ <─── 200 OK ─────────────────│      RPC apply_subscription_tier(...)  │ │
       ▼                          │   └──────────────┬─────────────────────┘ │
  Stripe redirect → success_url   │                  │ atomic                  │
  (/planos?status=success)        │                  ▼                         │
                                  │   ┌────────────────────────────────────┐ │
  5. /planos re-fetch ───────────────>│  Postgres:                            │ │
     organization_plans +        │   │   subscriptions (org_id, cust, sub,   │ │
     subscriptions (via RLS)      │   │     status, price_id, period_end)     │ │
                                  │   │   organization_plans (plan_tier,      │ │
  6. Portal: invoke('stripe-      │   │     sync_interval_minutes,            │ │
     checkout',{action:'portal'}) ───>│     history_days)  ◄── mapping        │ │
       │ <── { url } ─────────────────│   billing_events (event_id UNIQUE)    │ │
       ▼                          │   └────────────────────────────────────┘ │
  Stripe Customer Portal          │   check_quota(org_id) [Phase 43] lê        │
  (upgrade/downgrade/cancel)      │   sync_interval_minutes — continua válido  │
                                  └─────────────────────────────────────────┘
  Enforcement history_days: queries de cache (ml_daily_cache etc.) têm dateFrom
  "clampado" server-side ao teto do tier (RPC/RLS), não só no date-picker do React.
```

### Recommended Project Structure
```
supabase/functions/
├── stripe-checkout/        # verify_jwt=true; actions: 'checkout' | 'portal'
│   └── index.ts
├── stripe-webhook/         # verify_jwt=false; signature verification própria
│   └── index.ts
supabase/migrations/
├── 2026XXXX_subscriptions_billing_events.sql   # tabelas + RLS + índices
├── 2026XXXX_apply_subscription_tier_rpc.sql     # RPC atômica tier→organization_plans
├── 2026XXXX_tier_price_mapping.sql              # mapping price_id→tier→(sync,history)
└── 2026XXXX_history_days_enforcement.sql        # RPC/RLS clamp de data (PAY-04)
src/
├── pages/org/Planos.tsx     # página /planos (RoleRoute owner)
├── hooks/useSubscription.ts # react-query: lê organization_plans + subscriptions
└── integrations/supabase/types.ts  # adicionar tipos à mão
```

### Pattern 1: Criar Checkout Session (EF server-side, sk_test)
**What:** EF autenticada (owner) cria uma sessão de assinatura amarrada à org.
**When to use:** Owner clica "Assinar <tier>" em /planos.
```typescript
// Source: docs.stripe.com/api/checkout/sessions/create (subscription mode)
// EF stripe-checkout (verify_jwt=true) — auth do owner ANTES disto via get_org_role
import Stripe from "https://esm.sh/stripe@22?target=denonext";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2025-XX-XX",                  // [ASSUMED] confirmar via Context7 no plano
  httpClient: Stripe.createFetchHttpClient(),
});

const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: priceIdForTier, quantity: 1 }],
  client_reference_id: organizationId,        // amarra a org
  customer: existingStripeCustomerId ?? undefined, // reusar se já existe
  customer_email: ownerEmail,                 // se ainda não há customer
  subscription_data: {
    trial_period_days: trialDays,             // PAY-01 "trial configurável"
    metadata: { organization_id: organizationId, tier },
  },
  metadata: { organization_id: organizationId, tier },
  success_url: `${appOrigin}/planos?status=success&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${appOrigin}/planos?status=cancel`,
});
return json({ url: session.url });
```
> `appOrigin` deve vir de um secret/allowlist server-side (ex. `APP_ORIGIN`), **não** do `Origin` do request sem validação (open-redirect).

### Pattern 2: Webhook com verificação de assinatura (Deno, raw body)
**What:** EF pública que recebe eventos Stripe e valida a assinatura HMAC.
**When to use:** Único caminho de mutação de tier.
```typescript
// Source: github.com/supabase/supabase examples/edge-functions/.../stripe-webhooks/index.ts
import Stripe from "https://esm.sh/stripe@22?target=denonext";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2025-XX-XX",                   // [ASSUMED] confirmar
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();              // RAW body — NÃO req.json()
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature!,
      Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET")!,
      undefined, cryptoProvider,              // async + Web Crypto (Deno)
    );
  } catch (err) {
    return new Response(err.message, { status: 400 });
  }
  // ... dedupe + switch (Pattern 3) ...
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```
**Config (supabase/config.toml):**
```toml
[functions.stripe-webhook]
verify_jwt = false   # Stripe não envia JWT; auth = assinatura HMAC
[functions.stripe-checkout]
verify_jwt = true    # owner autenticado
```

### Pattern 3: Mapeamento evento → mutação atômica (idempotente)
**What:** Tratar os 4 eventos e propagar tier sem race/duplicação.
```typescript
// dedupe ANTES de processar: billing_events.event_id é UNIQUE
const { error: dupErr } = await admin.from("billing_events")
  .insert({ event_id: event.id, type: event.type, payload: event });
if (dupErr?.code === "23505") return new Response(JSON.stringify({ ok: true, dup: true }), { status: 200 });

switch (event.type) {
  case "checkout.session.completed": {
    const s = event.data.object; // tem client_reference_id, customer, subscription
    await admin.rpc("apply_subscription_tier", {
      _org_id: s.client_reference_id,
      _stripe_customer_id: s.customer,
      _stripe_subscription_id: s.subscription,
      _price_id: /* buscar do subscription via stripe.subscriptions.retrieve OU line_items */,
      _status: "active",
    });
    break;
  }
  case "customer.subscription.updated":     // upgrade/downgrade/trial→active
  case "customer.subscription.deleted": {   // cancelamento → volta a 'free'
    const sub = event.data.object;          // price em sub.items.data[0].price.id
    await admin.rpc("apply_subscription_tier", {
      _org_id: sub.metadata.organization_id,
      _stripe_customer_id: sub.customer,
      _stripe_subscription_id: sub.id,
      _price_id: event.type === "customer.subscription.deleted" ? null : sub.items.data[0].price.id,
      _status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
    });
    break;
  }
  case "invoice.paid": {                     // confirma pagamento de renovação
    // atualiza subscriptions.current_period_end / status; opcionalmente só log
    break;
  }
}
```
A RPC `apply_subscription_tier` (SECURITY DEFINER) faz: UPSERT em `subscriptions` + UPDATE de `organization_plans` lendo o mapping `price_id → (plan_tier, sync_interval_minutes, history_days)`. Como `check_quota` lê `organization_plans.sync_interval_minutes`, o gate de sync (Phase 43) passa a refletir o tier pago **sem alteração**.

### Pattern 4: Customer Portal + página /planos
```typescript
// EF stripe-checkout action:'portal' — Source: docs.stripe.com/api/customer_portal/sessions/create
const portal = await stripe.billingPortal.sessions.create({
  customer: subscription.stripe_customer_id,
  return_url: `${appOrigin}/planos`,
});
return json({ url: portal.url });
```
React `/planos`: react-query lê `organization_plans` (tier atual) + `subscriptions` (status, current_period_end) via RLS; botões "Assinar" (free→pago) chamam `stripe-checkout` action checkout; botão "Gerenciar assinatura" chama action portal. Padrão `supabase.functions.invoke(...)` (já usado em `useMLSync`).

### Pattern 5: Enforcement de history_days (server-side)
**What:** Garantir que org no tier free não leia histórico além de `history_days`.
**Onde aplicar:** As queries de cache (`mlCacheService.ts`) hoje fazem `.gte("date", dateFrom)` com o `dateFrom` que o filtro do React mandar — **sem teto**. Opções (do mais robusto ao mais simples):
1. **RLS por data nas tabelas de cache** (`ml_daily_cache`, `ml_hourly_cache`, `ml_product_daily_cache`, `ml_state_daily_cache`): policy `USING (date >= current_date - history_days_for_org(organization_id))`. Robusto (banco recusa linhas antigas), mas exige função `STABLE` por org e pode pesar em todas as queries.
2. **RPC clamp**: uma RPC `effective_date_from(_org_id, _requested_from)` que retorna `greatest(_requested_from, current_date - history_days)`; o frontend chama antes de montar o range. Menos seguro (depende do cliente chamar), mas simples.
3. **Híbrido recomendado:** RLS por data (defesa real) + frontend limita o date-picker ao tier (UX). Confirmar com Wesley qual nível de rigor (RLS adiciona custo em toda query).

```sql
-- Opção 1 (RLS por data) — esboço
CREATE OR REPLACE FUNCTION public.org_history_floor(_org_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN history_days = -1 THEN '1900-01-01'::date
              ELSE current_date - history_days END
  FROM organization_plans WHERE organization_id = _org_id;
$$;
-- policy adicional FOR SELECT: USING (date >= public.org_history_floor(organization_id))
```

### Anti-Patterns to Avoid
- **Mutar tier no frontend ou na EF de checkout:** o tier só muda via webhook (fonte de verdade). Checkout só cria sessão; não confie no redirect de sucesso.
- **`req.json()` no webhook:** quebra a verificação de assinatura. Sempre `req.text()` (raw).
- **`constructEvent` síncrono no Deno:** não existe `crypto` síncrono do Node → usar `constructEventAsync` + `createSubtleCryptoProvider`.
- **Confiar no `Origin` do request para success/cancel URL:** open-redirect. Usar allowlist server-side.
- **Re-derivar `sync_interval_minutes`/`history_days` em código duplicado:** centralizar o mapping `price_id→tier→limits` numa única tabela/RPC.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coleta de cartão / PCI | Form de cartão próprio | Stripe Hosted Checkout | PCI-DSS, 3DS/SCA, antifraude — Stripe assume tudo |
| Upgrade/downgrade/cancel UI | Telas custom + proration | Stripe Customer Portal | Proration, invoices, métodos de pgto, cancelamento — grátis e mantido |
| Verificação de webhook | HMAC SHA256 manual | `stripe.webhooks.constructEventAsync` | Timestamp tolerance, replay protection, múltiplas assinaturas |
| Idempotência de evento | Lógica ad-hoc | `billing_events.event_id UNIQUE` + insert-first | Stripe reentrega eventos; dedupe no banco é à prova de race |
| Estado da assinatura | Polling do Stripe | Webhooks → `subscriptions` | Stripe é a fonte; webhook mantém espelho local consistente |

**Key insight:** Em billing, quase tudo já é resolvido pelo Stripe (Checkout, Portal, webhooks assinados). O trabalho real do projeto é **só** o espelho local (`subscriptions`) + a propagação atômica do tier para `organization_plans` (que o resto do app já consome) + o enforcement de `history_days` (a única peça que o Stripe não faz).

## Runtime State Inventory

> Phase 44 é majoritariamente greenfield (tabelas/EFs novas), mas há estado de configuração externo (Stripe Dashboard) e secrets que NÃO vivem no git.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Nenhuma tabela `subscriptions`/`billing_events` ainda existe (verificado: grep nas migrations não acha). `organization_plans` já tem 1 linha/org com tier atual. | Criar tabelas (migration). Tier de orgs existentes começa em 'free' default. |
| Live service config | **Stripe Dashboard (test mode)**: Products + Prices (1 price_id por tier) e a **Customer Portal default configuration** precisam ser criados/ativados no Dashboard — NÃO ficam no git. O endpoint de webhook (URL da EF) também é registrado no Dashboard, gerando o `whsec_`. | Setup manual no Stripe Dashboard test mode → anotar price_ids → semear tabela de mapping. Ativar Portal config. Registrar webhook endpoint. |
| OS-registered state | Nenhum (sem cron/OS novo). `check_quota` já roda no `process-sync-job` existente. | Nenhuma. |
| Secrets/env vars | `STRIPE_SECRET_KEY` (sk_test_), `STRIPE_WEBHOOK_SIGNING_SECRET` (whsec_), e `STRIPE_PUBLISHABLE_KEY`/price_ids se forem para o frontend. Hoje **não existem** nos secrets da EF. | `supabase secrets set ... --project-ref ckcdevcxgvueywivefgx`. price_id→tier pode ir numa tabela (não secret). |
| Build artifacts | `types.ts` ficará desatualizado após criar `subscriptions`/`billing_events`. | Editar `types.ts` à mão (regra do projeto). |

**Canonical:** Após todas as migrations/EFs, o estado que NÃO está no git é: (a) Products/Prices/Portal-config no Stripe Dashboard test mode; (b) os 2-3 secrets na EF; (c) o webhook endpoint registrado no Stripe. O plano deve ter uma task de setup manual (checkpoint:human) cobrindo isso.

## Common Pitfalls

### Pitfall 1: Webhook não verifica (raw body / crypto provider errado)
**What goes wrong:** `constructEvent` síncrono ou `req.json()` → "No signatures found matching the expected signature".
**Why it happens:** Deno não tem o `crypto` síncrono do Node; `req.json()` re-serializa e muda os bytes.
**How to avoid:** `req.text()` + `constructEventAsync(..., undefined, Stripe.createSubtleCryptoProvider())`.
**Warning signs:** 400 em todos os eventos; eventos "Failed" no Dashboard Stripe.

### Pitfall 2: verify_jwt errado na EF do webhook
**What goes wrong:** `verify_jwt=true` → Supabase rejeita o POST do Stripe com 401 antes de chegar no código.
**How to avoid:** `[functions.stripe-webhook] verify_jwt = false` no config.toml (precedente: `ml-oauth`). A auth é a assinatura HMAC.
**Warning signs:** Stripe mostra 401 nas tentativas de entrega.

### Pitfall 3: Eventos duplicados / fora de ordem
**What goes wrong:** Stripe reentrega eventos (at-least-once) e `customer.subscription.updated` pode chegar antes/depois de `checkout.session.completed`. Tier "pisca" ou rebaixa indevidamente.
**How to avoid:** Dedupe via `billing_events.event_id UNIQUE` (insert-first → 200 se 23505). Tornar `apply_subscription_tier` idempotente (UPSERT) e tolerante a ordem (usar sempre o estado mais recente do objeto `subscription`, não deltas). Considerar `current_period_end`/`updated` para ignorar eventos mais antigos.
**Warning signs:** tier muda e volta; logs com mesmo event.id 2x.

### Pitfall 4: Projeto Supabase errado no deploy (recorrente neste repo)
**What goes wrong:** Deploy/migration vai para `gionpsuunfkkzzjdubfy` (CLAUDE.md) em vez de `ckcdevcxgvueywivefgx`.
**How to avoid:** Sempre `--project-ref ckcdevcxgvueywivefgx`. Já mordeu o time no pg_cron (STATE.md).
**Warning signs:** webhook chega num projeto sem as tabelas.

### Pitfall 5: Customer Portal sem configuração default ativa
**What goes wrong:** `billingPortal.sessions.create` falha com "No configuration provided and your test mode default configuration has not been created."
**How to avoid:** Ativar a configuração default do Portal no Stripe Dashboard (test mode) uma vez. [CITED: docs.stripe.com/api/customer_portal/sessions/create]
**Warning signs:** /planos botão "Gerenciar" retorna 500 na primeira tentativa.

### Pitfall 6: price_id não amarra a tier
**What goes wrong:** webhook recebe `price_id` mas não sabe qual `plan_tier`/limites aplicar.
**How to avoid:** Tabela `tier_prices(price_id PK, plan_tier, sync_interval_minutes, history_days)` semeada no setup; `apply_subscription_tier` faz o join. Mapping canônico dos limites existentes: free=1440/30, starter=720/?, pro=180/?, enterprise=60(ou -1)/-1. **Os valores de starter/pro precisam ser confirmados com Wesley** (ASSUMED — ver Assumptions Log).
**Warning signs:** tier muda para um valor mas quota não muda.

### Pitfall 7: Enforcement de history_days só no frontend
**What goes wrong:** PAY-04 "aplicado de verdade" falha se o teto for só no date-picker — um usuário pode chamar a query Supabase direto com `dateFrom` antigo e ver histórico do pro.
**Why it happens:** `mlCacheService.ts` repassa `dateFrom` cru para `.gte("date", ...)`; RLS hoje filtra por org, não por data.
**How to avoid:** Enforcement server-side (RLS por data OU RPC clamp). Ver Pattern 5.
**Warning signs:** verifier consegue ler datas além do tier via cliente Supabase direto.

### Pitfall 8: sk_test/whsec vazando para o frontend
**What goes wrong:** Stripe secret key no bundle React.
**How to avoid:** `stripe` importado **só** nas EFs Deno. No frontend, no máximo a publishable key (`pk_test_`) — e com hosted Checkout nem ela é estritamente necessária (o redirect vem da EF).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `constructEvent` síncrono (Node) | `constructEventAsync` + `createSubtleCryptoProvider` (Deno/edge) | desde suporte a edge runtimes | Obrigatório em Deno/Supabase EF |
| `stripe@14` apiVersion `2024-11-20` (exemplo Supabase) | `stripe@22.2.1` (latest, 2026-06-12) | atual | Pinar major fixo; confirmar apiVersion acoplado |
| Cobrança manual / planilha | Stripe Checkout + Portal + webhooks | — | Self-service de assinatura |

**Deprecated/outdated:**
- Não usar `esm.sh/stripe` sem pin de major (reprodutibilidade).
- Não usar Charges API legada para assinaturas — usar Subscriptions/Checkout.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `apiVersion` do Stripe acoplado ao major escolhido (ex. uma string `2025-XX-XX`) | Standard Stack / Pattern 1,2 | Baixo — SDK funciona com a default do major; confirmar via Context7 no plano para evitar warnings |
| A2 | Limites de `sync_interval_minutes`/`history_days` para starter e pro (free=1440/30, enterprise=-1/-1 são conhecidos; starter/pro NÃO) | Pitfall 6 / mapping | Médio — tier pago aplicaria limites errados. **Confirmar valores com Wesley.** |
| A3 | Preços (valor em R$) dos tiers em test mode são placeholders | Standard Stack | Baixo — test mode; foco é mecanismo. Confirmar se há valores desejados. |
| A4 | Decisão de enforcement de `history_days`: RLS por data vs RPC clamp vs híbrido | Pattern 5 | Médio — RLS adiciona custo em toda query de cache; escolha é tradeoff segurança×performance. **Confirmar com Wesley.** |
| A5 | Trial: existe um `trial_period_days` desejado (PAY-01 diz "trial configurável") mas o valor não está definido | Pattern 1 | Baixo — default pode ser 0/sem trial; confirmar. |
| A6 | Stripe major a pinar (18 vs 22). Sugerido 22 (latest), mas exemplo oficial usa 14 | Standard Stack | Baixo — qualquer major recente suporta `constructEventAsync`; pinar e testar. |

**Se A2/A4 não forem confirmados antes de planejar, o planner deve inserir `checkpoint:human-verify` para Wesley definir os limites dos tiers e o nível de enforcement.**

## Open Questions

1. **Reuso de Stripe Customer entre Checkouts**
   - What we know: amarramos via `client_reference_id`/metadata = `organization_id`.
   - What's unclear: criar `Customer` proativamente (antes do Checkout) ou deixar o Checkout criar e capturar no webhook.
   - Recommendation: deixar o Checkout criar o Customer; capturar `customer` em `checkout.session.completed`; armazenar em `subscriptions.stripe_customer_id`; reusar nos próximos checkouts/portal.

2. **Granularidade de billing_events**
   - What we know: precisamos de dedupe (event_id UNIQUE).
   - What's unclear: guardar payload completo (auditoria/debug) ou só metadados.
   - Recommendation: guardar `event_id`, `type`, `payload jsonb`, `received_at` — barato e ajuda debug (precedente: o projeto valoriza auditoria).

3. **Downgrade imediato vs fim do período**
   - What we know: `customer.subscription.deleted` → volta a free.
   - What's unclear: downgrade pro→starter aplica na hora ou no fim do ciclo (Portal/Stripe controla proration).
   - Recommendation: confiar no estado que o `customer.subscription.updated` reportar (price atual) — Stripe já resolve proration; o app só espelha.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Stripe account (test mode) | PAY-01..03 | ✗ (assumir a criar) | — | Sem fallback — necessário sk_test_/whsec_ |
| `stripe` SDK (esm.sh, Deno) | EFs | ✓ (CDN runtime) | 22.2.1 | — |
| Supabase project ckcdevcxgvueywivefgx | tudo | ✓ | — | — |
| `SUPABASE_ACCESS_TOKEN` (deploy de EF) | deploy stripe-checkout/webhook | ✗ (ausente em sessões recentes) | — | Orquestrador faz deploy via CLI; gsd-executor só escreve código |

**Missing dependencies with no fallback:**
- Stripe account em test mode com Products/Prices/Portal-config + webhook endpoint registrado (setup manual — checkpoint:human).
- `SUPABASE_ACCESS_TOKEN` para deploy das EFs (orquestrador, não executor).

**Missing dependencies with fallback:**
- Nenhum.

## Sources

### Primary (HIGH confidence)
- github.com/supabase/supabase — `examples/edge-functions/.../stripe-webhooks/index.ts` — padrão Deno: `esm.sh/stripe@N?target=denonext`, `req.text()`, `constructEventAsync` + `createSubtleCryptoProvider`.
- docs.stripe.com/api/checkout/sessions/create — params de Checkout Session subscription mode.
- docs.stripe.com/api/customer_portal/sessions/create — billing portal session + requisito de config default em test mode.
- npm registry (`npm view stripe`) — versão 22.2.1 (2026-06-12), repo oficial, sem postinstall.
- Codebase: `supabase/functions/ml-oauth/index.ts` (verify_jwt=false), `supabase/config.toml`, `supabase/migrations/20260519120000_organization_plans_quota.sql`, `20260614122000_tenant03_check_quota_rpc.sql`, `src/services/mlCacheService.ts`, `src/integrations/supabase/types.ts`.

### Secondary (MEDIUM confidence)
- supabase.com/docs/guides/functions/examples/stripe-webhooks — guia oficial (confirmou raw body + verify_jwt=false).

### Tertiary (LOW confidence)
- WebSearch sobre billing portal/checkout params — corroborado pelas docs oficiais Stripe.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `stripe` verificado no npm (22.2.1); padrão Deno verificado no exemplo oficial Supabase.
- Architecture: HIGH — 4 eventos + RPC atômica + dedupe seguem o padrão canônico; base (`organization_plans`/`check_quota`) lida diretamente do código.
- Pitfalls: HIGH — raw body, crypto provider, verify_jwt, dedupe, portal config e projeto errado todos documentados/observados no repo.
- Product params (limites de tier, trial, enforcement choice): LOW/MEDIUM — marcados ASSUMED, exigem confirmação de Wesley.

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (Stripe API evolui; confirmar apiVersion no plano)
