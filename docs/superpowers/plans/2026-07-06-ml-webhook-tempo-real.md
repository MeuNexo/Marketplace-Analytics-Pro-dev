# Webhook ML (tempo real) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. EF/migration deploys go through the Supabase **MCP** (project `ckcdevcxgvueywivefgx`), never the CLI (no token).

**Goal:** Uma EF pública `ml-webhook` recebe notificações do Mercado Livre (`questions`/`claims`/`orders_v2`), grava auditoria em `ml_webhook_events`, responde 200 em <500ms e processa em `waitUntil` — perguntas e reclamações aparecem no dashboard em segundos.

**Architecture:** EF pública (`verify_jwt=false`) valida (secret no path + `user_id ∈ ml_tokens`), persiste o evento cru, responde 200, e em `EdgeRuntime.waitUntil` busca o recurso no ML e faz upsert (questions/claims) ou cutuca o `sync-ml-orders` (orders, com debounce 60s). Polling desacelera para rede de segurança + um cron reprocessa eventos presos.

**Tech Stack:** Deno (EF, `std@0.168.0`, `@supabase/supabase-js@2` via esm.sh), Postgres/pg_cron (migrations via MCP), React 18 + TS + shadcn/ui + TanStack Query (UI), vitest (lógica pura frontend).

## Global Constraints

- Supabase project = **`ckcdevcxgvueywivefgx`** (NÃO `gionpsuunfkkzzjdubfy` do CLAUDE.md). URL base: `https://ckcdevcxgvueywivefgx.supabase.co`.
- Deploy de EF e migration **só via MCP** (`mcp__claude_ai_Supabase__deploy_edge_function` / `apply_migration`). Smoke via `execute_sql` ou POST HTTP.
- EFs internas autenticam por **Pattern B**: `Authorization: Bearer <service_role_key>` (vault `service_role_key` para crons). NÃO usar X-Cron-Secret.
- RLS org-first: policy de SELECT usa `public.is_org_member(auth.uid(), organization_id)`. Service role ignora RLS (a EF escreve com service key).
- Nunca logar `access_token`/`refresh_token` (T-42-04).
- `ml_tokens` colunas: `ml_user_id` (id numérico ML do seller, texto), `user_id`, `organization_id`, `seller_id`, `access_token`, `refresh_token`, `expires_at`.
- ML espera **HTTP 200 em ~500ms**; senão reenvia. ML **não assina** a mensagem.
- Frontend: named exports, `use<Name>` hooks, constantes `SCREAMING_SNAKE_CASE`, tokens de tema (light/dark), sem novas dependências.
- Não remover o polling. Não redesenhar `/perguntas` nem `/devolucoes` (só adicionar badge de saúde).

---

### Task 1: Migration — tabela `ml_webhook_events` + RLS + índices

**Files:**
- Create: `supabase/migrations/20260689000000_ml_webhook_events.sql`

**Interfaces:**
- Produces: tabela `public.ml_webhook_events` com colunas `id, topic, resource, ml_user_id, organization_id, status, attempts, error_msg, raw, sent_at, received_at, processed_at`; índice único `(topic, resource, sent_at) WHERE sent_at IS NOT NULL`; RLS habilitada com SELECT para membros da org.

- [ ] **Step 1: Escrever a migration**

```sql
-- ml_webhook_events: auditoria + fila de retry das notificações do ML.
-- Grão de dedup: (topic, resource, sent_at). Service role escreve (ignora RLS);
-- membros da org leem via is_org_member.

CREATE TABLE IF NOT EXISTS public.ml_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic           text NOT NULL,
  resource        text NOT NULL,
  ml_user_id      text,
  organization_id uuid,
  status          text NOT NULL DEFAULT 'received',  -- received | processed | error | rejected
  attempts        int  NOT NULL DEFAULT 0,
  error_msg       text,
  raw             jsonb NOT NULL,
  sent_at         timestamptz,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- Idempotência: reenvio do ML com mesmo `sent` não cria linha nova.
CREATE UNIQUE INDEX IF NOT EXISTS ml_webhook_events_dedup
  ON public.ml_webhook_events (topic, resource, sent_at)
  WHERE sent_at IS NOT NULL;

-- Retry-cron varre presos.
CREATE INDEX IF NOT EXISTS ml_webhook_events_status_idx
  ON public.ml_webhook_events (status)
  WHERE status IN ('received', 'error');

-- Painel admin / badge de saúde.
CREATE INDEX IF NOT EXISTS ml_webhook_events_org_recv_idx
  ON public.ml_webhook_events (organization_id, received_at DESC);

ALTER TABLE public.ml_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ml_webhook_events_select_member ON public.ml_webhook_events;
CREATE POLICY ml_webhook_events_select_member
  ON public.ml_webhook_events
  FOR SELECT
  USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
```

- [ ] **Step 2: Aplicar via MCP**

Chamar `mcp__claude_ai_Supabase__apply_migration` com `project_id="ckcdevcxgvueywivefgx"`, `name="ml_webhook_events"`, `query=<conteúdo do arquivo>`.
Expected: sucesso sem erro.

- [ ] **Step 3: Verificar tabela + RLS via execute_sql**

Rodar via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'ml_webhook_events' ORDER BY ordinal_position;
SELECT relrowsecurity FROM pg_class WHERE relname = 'ml_webhook_events';
SELECT polname FROM pg_policy WHERE polrelid = 'public.ml_webhook_events'::regclass;
```
Expected: 11 colunas; `relrowsecurity = true`; policy `ml_webhook_events_select_member` presente.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260689000000_ml_webhook_events.sql
git commit -m "feat(webhook): tabela ml_webhook_events + RLS org-first (Phase 89)"
```

---

### Task 2: EF `ml-webhook` — validação + persistência + 200 (sem processamento)

**Files:**
- Create: `supabase/functions/ml-webhook/index.ts`
- Modify: `supabase/config.toml` (adicionar bloco `[functions.ml-webhook] verify_jwt = false`)

**Interfaces:**
- Consumes: tabela `ml_webhook_events` (Task 1); tabela `ml_tokens`.
- Produces: endpoint `POST /functions/v1/ml-webhook/<secret>`. Corpo ML `{topic, resource, user_id, sent}`. Env novo: `ML_WEBHOOK_SECRET`. Função exportável para Task 3/4 estende o mesmo arquivo (handler + `processEvent` stub).

- [ ] **Step 1: Escrever a EF (esqueleto — valida, grava `received`/`rejected`, responde 200)**

```typescript
// supabase/functions/ml-webhook/index.ts
//
// Webhook receiver do Mercado Livre (verify_jwt=false).
// ML faz POST em /functions/v1/ml-webhook/<secret> com { topic, resource, user_id, sent }.
// Fluxo: valida secret+seller → grava evento cru → responde 200 <500ms → processa em waitUntil.
// Confiabilidade: evento salvo antes de processar; nada se perde (T-42-04: nunca logar tokens).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL   = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY    = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const WEBHOOK_SECRET = (Deno.env.get("ML_WEBHOOK_SECRET") ?? "").trim();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function ok200() { return new Response("ok", { status: 200, headers: CORS }); }

// Timing-safe string compare (evita timing attack no secret).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Extrai o secret do último segmento do path após "ml-webhook".
function secretFromPath(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("ml-webhook");
  return idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Reprocess mode (cron, Pattern B) — implementado na Task 5. Por ora ignora.
  const auth = req.headers.get("Authorization") ?? "";
  const isServiceCall = SERVICE_KEY.length > 0 && auth === "Bearer " + SERVICE_KEY;

  // 1. Valida secret no path (exceto chamada de serviço/cron).
  if (!isServiceCall) {
    const provided = secretFromPath(req.url);
    if (!WEBHOOK_SECRET || !safeEqual(provided, WEBHOOK_SECRET)) {
      console.warn("ml-webhook: secret inválido");
      return ok200(); // 200 mudo — não vira retry infinito nem revela nada.
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { return ok200(); }

  const topic    = String(body.topic ?? "");
  const resource = String(body.resource ?? "");
  const mlUserId = body.user_id != null ? String(body.user_id) : null;
  const sentAt   = body.sent ?? null;
  if (!topic || !resource) return ok200();

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 2. Resolve seller pelo user_id da notificação.
  let orgId: string | null = null;
  if (mlUserId) {
    const { data: tok } = await sb
      .from("ml_tokens")
      .select("organization_id")
      .eq("ml_user_id", mlUserId)
      .limit(1)
      .maybeSingle();
    orgId = (tok?.organization_id as string | undefined) ?? null;
  }
  const rejected = !orgId; // seller desconhecido

  // 3. Grava evento cru (dedup por (topic,resource,sent_at)).
  const { data: inserted, error: insErr } = await sb
    .from("ml_webhook_events")
    .upsert(
      {
        topic, resource, ml_user_id: mlUserId, organization_id: orgId,
        status: rejected ? "rejected" : "received",
        raw: body, sent_at: sentAt,
      },
      { onConflict: "topic,resource,sent_at", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (insErr) console.error("ml-webhook insert:", insErr.message);

  // 4. Responde 200 já. Processamento vem na Task 3/4 (waitUntil).
  //    (esqueleto: sem processamento ainda)
  return ok200();
});
```

- [ ] **Step 2: Registrar verify_jwt=false no config.toml**

Adicionar ao final de `supabase/config.toml`:
```toml
[functions.ml-webhook]
verify_jwt = false
```

- [ ] **Step 3: Setar o secret env + deploy via MCP**

Gerar um secret forte (ex.: 32 hex). Definir env `ML_WEBHOOK_SECRET` no projeto (via painel Supabase → Edge Functions → Secrets, ou incluir no deploy). Deploy com `mcp__claude_ai_Supabase__deploy_edge_function` (`project_id="ckcdevcxgvueywivefgx"`, `name="ml-webhook"`, arquivo `index.ts`).
Expected: deploy ok, função ativa.

- [ ] **Step 4: Smoke — happy/rejeição/secret/idempotência**

Descobrir um `ml_user_id` real:
```sql
SELECT ml_user_id, organization_id FROM ml_tokens WHERE refresh_token IS NOT NULL LIMIT 1;
```
POST válido (substituir `<SECRET>` e `<ML_USER_ID>`):
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
  -X POST "https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"topic":"questions","resource":"/questions/999999","user_id":<ML_USER_ID>,"sent":"2026-07-06T12:00:00Z"}'
```
Expected: `200` em <0.5s.
```sql
SELECT status, organization_id FROM ml_webhook_events WHERE resource='/questions/999999';
```
Expected: `status=received`, `organization_id` = org do seller.

Rejeição (seller desconhecido `user_id:1`): → linha `status=rejected`.
Secret errado (`.../ml-webhook/errado`): → `200`, **nenhuma** linha nova.
Idempotência (repetir o POST válido idêntico): → continua **1** linha para aquele resource+sent.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ml-webhook/index.ts supabase/config.toml
git commit -m "feat(webhook): EF ml-webhook — validação + persistência + 200 (Phase 89)"
```

---

### Task 3: EF processamento — questions + claims em `waitUntil`

**Files:**
- Modify: `supabase/functions/ml-webhook/index.ts` (adicionar helpers de token/ML GET + `processEvent` + chamar `EdgeRuntime.waitUntil`)

**Interfaces:**
- Consumes: helpers de token (mesmo padrão de `sync-ml-questions`), `ml_webhook_events.id` do insert.
- Produces: `processEvent(sb, eventId, topic, resource, mlUserId)` que busca o recurso, faz upsert em `ml_questions`/`ml_claims` e atualiza `status`.

- [ ] **Step 1: Adicionar helpers + processEvent (questions/claims) ao index.ts**

Inserir antes do `serve(...)` (mesmo padrão dos syncs — `ML_APP_ID`/`ML_CLIENT_SECRET` já são env das EFs):

```typescript
const ML_APP_ID        = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
const ML_API           = "https://api.mercadolibre.com";

async function getAccessToken(sb: any, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens").select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId).order("updated_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);
  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  if (row.access_token && expiresTs - Date.now() / 1000 > 300) return row.access_token;
  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");
  const resp = await fetch(ML_API + "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET, refresh_token: row.refresh_token }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status);
  const data = await resp.json();
  await sb.from("ml_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? row.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString(),
  }).eq("ml_user_id", mlUserId);
  return data.access_token;
}

async function mlGet(url: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token, "api-version": "2" } });
    if (res.ok) return res.json();
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
    if (i < 2 && [500,502,503,504].includes(res.status)) { await new Promise(r => setTimeout(r, 1000*(i+1))); continue; }
    throw new Error("ML " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("ML retries exhausted");
}

// Normaliza 1 pergunta ML → linha ml_questions (mesmo shape de sync-ml-questions).
function questionRow(q: any, orgId: string, mlUserId: string) {
  return {
    organization_id: orgId, ml_user_id: mlUserId, question_id: q.id,
    item_id: q.item_id ?? null, texto: q.text ?? "",
    status: String(q.status ?? "UNANSWERED").toUpperCase(),
    comprador_id: String(q.from?.id ?? ""), data_pergunta: q.date_created ?? null,
    resposta: q.answer?.text ?? null, data_resposta: q.answer?.date_created ?? null,
    synced_at: new Date().toISOString(),
  };
}
// Normaliza 1 claim ML → linha ml_claims (mesmo shape de sync-ml-claims).
function claimRow(c: any, orgId: string, mlUserId: string) {
  return {
    organization_id: orgId, ml_user_id: mlUserId, claim_id: String(c.id ?? ""),
    order_id: c.resource_id != null ? String(c.resource_id) : null,
    tipo: c.type ?? "mediations", status: c.status ?? "opened",
    motivo: c.reason_id ?? null,
    data_abertura: (c.date_created ?? "").substring(0,10) || null,
    data_limite: (c.resolution_due_date ?? "").substring(0,10) || null,
    solucao: c.resolution?.type ?? null, synced_at: new Date().toISOString(),
  };
}

async function markEvent(sb: any, id: string, patch: Record<string, unknown>) {
  await sb.from("ml_webhook_events").update(patch).eq("id", id);
}

// Processa 1 evento: busca o recurso e faz upsert. Orders é tratado na Task 4.
async function processEvent(sb: any, ev: {
  id: string; topic: string; resource: string; ml_user_id: string; organization_id: string;
}): Promise<void> {
  try {
    const token = await getAccessToken(sb, ev.ml_user_id);
    if (ev.topic === "questions") {
      const q = await mlGet(ML_API + ev.resource, token);
      const { error } = await sb.from("ml_questions")
        .upsert([questionRow(q, ev.organization_id, ev.ml_user_id)],
          { onConflict: "organization_id,ml_user_id,question_id" });
      if (error) throw new Error(error.message);
    } else if (ev.topic === "claims") {
      const c = await mlGet(ML_API + ev.resource, token);
      const { error } = await sb.from("ml_claims")
        .upsert([claimRow(c, ev.organization_id, ev.ml_user_id)],
          { onConflict: "organization_id,ml_user_id,claim_id" });
      if (error) throw new Error(error.message);
    } else {
      // orders → Task 4; tópico desconhecido → deixa received
      return;
    }
    await markEvent(sb, ev.id, { status: "processed", processed_at: new Date().toISOString() });
  } catch (e: any) {
    await markEvent(sb, ev.id, { status: "error", error_msg: String(e?.message ?? e),
      attempts: (await bumpAttempts(sb, ev.id)) });
  }
}
async function bumpAttempts(sb: any, id: string): Promise<number> {
  const { data } = await sb.from("ml_webhook_events").select("attempts").eq("id", id).maybeSingle();
  return ((data?.attempts as number) ?? 0) + 1;
}
```

- [ ] **Step 2: Disparar processEvent no handler após responder 200**

Substituir o passo "4." do handler (Task 2) por:
```typescript
  // 4. Responde 200 já; processa em background (só se não rejeitado e não duplicado).
  if (!rejected && orgId && inserted?.id) {
    const ev = { id: inserted.id as string, topic, resource, ml_user_id: mlUserId!, organization_id: orgId };
    // @ts-ignore EdgeRuntime é global no Supabase Edge
    EdgeRuntime.waitUntil(processEvent(sb, ev));
  }
  return ok200();
```
Nota: quando o insert é duplicado (idempotência), `inserted` é `null` → não reprocessa. Correto.

- [ ] **Step 3: Redeploy via MCP**

`mcp__claude_ai_Supabase__deploy_edge_function` name `ml-webhook`.
Expected: deploy ok.

- [ ] **Step 4: Smoke com recursos REAIS**

Pegar ids reais do banco:
```sql
SELECT ml_user_id, question_id FROM ml_questions ORDER BY synced_at DESC LIMIT 1;
SELECT ml_user_id, claim_id FROM ml_claims ORDER BY synced_at DESC LIMIT 1;
```
POST de pergunta real (usar `question_id` e `ml_user_id` acima):
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -X POST \
 "https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<SECRET>" \
 -H "Content-Type: application/json" \
 -d '{"topic":"questions","resource":"/questions/<QUESTION_ID>","user_id":<ML_USER_ID>,"sent":"2026-07-06T13:00:00Z"}'
```
Expected: `200` <0.5s. Após ~5s:
```sql
SELECT status, error_msg, processed_at FROM ml_webhook_events
WHERE resource='/questions/<QUESTION_ID>' AND sent_at='2026-07-06T13:00:00Z';
SELECT synced_at FROM ml_questions WHERE question_id=<QUESTION_ID>;  -- synced_at atualizado
```
Expected: `status=processed`, `error_msg` null, `synced_at` recente.
Repetir o análogo para claims (`/claims/<CLAIM_ID>`, sent diferente). Expected `processed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ml-webhook/index.ts
git commit -m "feat(webhook): processa questions+claims em waitUntil (Phase 89)"
```

---

### Task 4: EF processamento — orders (cutuca sync-ml-orders + debounce 60s)

**Files:**
- Modify: `supabase/functions/ml-webhook/index.ts` (ramo `orders` em `processEvent`)

**Interfaces:**
- Consumes: EF `sync-ml-orders` (POST Bearer service key, body `{ml_user_id,date_from,date_to,seller_id?}`).
- Produces: no ramo `orders`, dispara sync da janela de hoje (BRT) para o seller, com debounce por seller.

- [ ] **Step 1: Adicionar ramo orders em processEvent**

No `processEvent`, trocar o `else` que ignora orders por:
```typescript
    } else if (ev.topic === "orders" || ev.topic === "orders_v2") {
      // Debounce: se já houve order processado deste seller nos últimos 60s, não redispara.
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await sb.from("ml_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("ml_user_id", ev.ml_user_id).in("topic", ["orders", "orders_v2"])
        .eq("status", "processed").gte("processed_at", since);
      if ((count ?? 0) === 0) {
        // Janela = hoje em BRT (UTC-3).
        const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const today  = brtNow.toISOString().substring(0, 10);
        const resp = await fetch(SUPABASE_URL + "/functions/v1/sync-ml-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SERVICE_KEY },
          body: JSON.stringify({ ml_user_id: ev.ml_user_id, date_from: today, date_to: today }),
        });
        if (!resp.ok) throw new Error("sync-ml-orders " + resp.status);
      }
    } else {
```

- [ ] **Step 2: Redeploy via MCP**

`deploy_edge_function` name `ml-webhook`. Expected: ok.

- [ ] **Step 3: Smoke orders + debounce**

Pegar um `ml_user_id` real. POST order:
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}\n" -X POST \
 "https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<SECRET>" \
 -H "Content-Type: application/json" \
 -d '{"topic":"orders_v2","resource":"/orders/2000003508xxxxx","user_id":<ML_USER_ID>,"sent":"2026-07-06T14:00:00Z"}'
```
Expected: `200` <0.5s; evento vira `processed`. Verificar nos logs da EF (`mcp__claude_ai_Supabase__get_logs` service=edge-function) que `sync-ml-orders` foi chamado.
Debounce: POST de outro order do mesmo seller (sent diferente) dentro de 60s → `processed` **sem** novo disparo do sync (contagem de chamadas não sobe nos logs).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/ml-webhook/index.ts
git commit -m "feat(webhook): orders cutuca sync-ml-orders com debounce 60s (Phase 89)"
```

---

### Task 5: Reprocess mode + migration de crons (polling lento + retry)

**Files:**
- Modify: `supabase/functions/ml-webhook/index.ts` (bloco reprocess quando `isServiceCall`)
- Create: `supabase/migrations/20260689000100_webhook_crons.sql`

**Interfaces:**
- Consumes: `processEvent` (Task 3/4); vault `service_role_key`.
- Produces: chamada de serviço `POST /ml-webhook` (Bearer service key) reprocessa eventos presos; crons `sync-ml-questions` (hora), `sync-ml-claims` (2h), novo `reprocess-webhook-events` (*/10).

- [ ] **Step 1: Adicionar bloco reprocess no handler (logo após `isServiceCall`)**

```typescript
  // Reprocess mode: cron (Pattern B) repesca eventos presos.
  if (isServiceCall) {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // presos há >5min
    const { data: stuck } = await sb.from("ml_webhook_events")
      .select("id,topic,resource,ml_user_id,organization_id")
      .in("status", ["received", "error"]).lt("attempts", 5)
      .not("organization_id", "is", null).lt("received_at", cutoff)
      .order("received_at", { ascending: true }).limit(50);
    let done = 0;
    for (const ev of (stuck ?? [])) { await processEvent(sb, ev as any); done++; }
    return new Response(JSON.stringify({ ok: true, reprocessed: done }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
```
(colocar este bloco **antes** da validação de secret; o resto do handler segue igual). Redeploy via MCP.

- [ ] **Step 2: Escrever a migration de crons**

```sql
-- Webhook em tempo real: polling vira rede de segurança + retry-cron.
-- Pattern B (Bearer service_role_key via vault.decrypted_secrets).

-- Perguntas: 15min → de hora em hora.
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-questions-every-15min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-questions-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sync-ml-questions-hourly', '0 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);

-- Claims: 30min → a cada 2h.
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-claims-every-30min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-claims-2h');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sync-ml-claims-2h', '0 */2 * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-claims',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);

-- Retry: reprocessa eventos presos a cada 10min.
DO $$ BEGIN PERFORM cron.unschedule('reprocess-webhook-events');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('reprocess-webhook-events', '*/10 * * * *', $cmd$
  SELECT net.http_post(
    url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body := '{}'::jsonb) AS request_id; $cmd$);
```

- [ ] **Step 3: Aplicar migration via MCP + verificar jobs**

`apply_migration` name `webhook_crons`. Depois:
```sql
SELECT jobname, schedule FROM cron.job
WHERE jobname IN ('sync-ml-questions-hourly','sync-ml-claims-2h','reprocess-webhook-events',
                  'sync-ml-questions-every-15min','sync-ml-claims-every-30min');
```
Expected: os 3 novos presentes; os 2 antigos ausentes.

- [ ] **Step 4: Smoke retry**

Forçar um evento a `error`:
```sql
UPDATE ml_webhook_events SET status='error', attempts=0,
  received_at = now() - interval '10 min'
WHERE resource='/questions/<QUESTION_ID>';
```
Chamar reprocess manualmente:
```bash
curl -s -X POST "https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -H "Content-Type: application/json" -d '{}'
```
Expected: `{"ok":true,"reprocessed":N>=1}`; o evento volta a `processed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ml-webhook/index.ts supabase/migrations/20260689000100_webhook_crons.sql
git commit -m "feat(webhook): reprocess-cron + polling desacelerado (Phase 89)"
```

---

### Task 6: Frontend — badge "tempo real ativo" em /perguntas e /devolucoes

**Files:**
- Create: `src/lib/webhookHealth.ts` (formatação pura)
- Create: `src/lib/webhookHealth.test.ts` (vitest)
- Create: `src/hooks/useWebhookHealth.ts`
- Create: `src/components/mercadolivre/WebhookHealthBadge.tsx`
- Modify: `src/pages/mercadolivre/MLPerguntas.tsx` (renderizar badge no cabeçalho)
- Modify: `src/pages/mercadolivre/MLDevolucoes.tsx` (renderizar badge no cabeçalho)

**Interfaces:**
- Produces: `formatWebhookHealth(lastEventIso: string | null, nowMs: number): { state: "active"|"idle"|"waiting"; label: string }`; hook `useWebhookHealth(): { lastEventIso: string | null; isLoading: boolean }`; componente `<WebhookHealthBadge />`.

- [ ] **Step 1: Teste da formatação pura (falha primeiro)**

```typescript
// src/lib/webhookHealth.test.ts
import { describe, it, expect } from "vitest";
import { formatWebhookHealth } from "./webhookHealth";

const NOW = new Date("2026-07-06T12:00:00Z").getTime();
describe("formatWebhookHealth", () => {
  it("nunca recebeu evento → waiting", () => {
    expect(formatWebhookHealth(null, NOW)).toEqual({ state: "waiting", label: "Aguardando eventos" });
  });
  it("evento há 30s → active em segundos", () => {
    const r = formatWebhookHealth("2026-07-06T11:59:30Z", NOW);
    expect(r.state).toBe("active");
    expect(r.label).toBe("Tempo real ativo · há 30s");
  });
  it("evento há 5min → active em minutos", () => {
    const r = formatWebhookHealth("2026-07-06T11:55:00Z", NOW);
    expect(r.state).toBe("active");
    expect(r.label).toBe("Tempo real ativo · há 5min");
  });
  it("evento há 2h → active em horas", () => {
    const r = formatWebhookHealth("2026-07-06T10:00:00Z", NOW);
    expect(r.label).toBe("Tempo real ativo · há 2h");
  });
  it("evento há >24h → idle", () => {
    const r = formatWebhookHealth("2026-07-04T12:00:00Z", NOW);
    expect(r.state).toBe("idle");
    expect(r.label).toBe("Sem eventos recentes");
  });
});
```

- [ ] **Step 2: Rodar teste — falha (módulo inexistente)**

Run: `npx vitest run src/lib/webhookHealth.test.ts`
Expected: FAIL "Cannot find module './webhookHealth'".

- [ ] **Step 3: Implementar webhookHealth.ts**

```typescript
// src/lib/webhookHealth.ts
export type WebhookHealthState = "active" | "idle" | "waiting";
export interface WebhookHealth { state: WebhookHealthState; label: string; }

const IDLE_MS = 24 * 60 * 60 * 1000;

export function formatWebhookHealth(lastEventIso: string | null, nowMs: number): WebhookHealth {
  if (!lastEventIso) return { state: "waiting", label: "Aguardando eventos" };
  const diff = nowMs - new Date(lastEventIso).getTime();
  if (diff >= IDLE_MS) return { state: "idle", label: "Sem eventos recentes" };
  let ago: string;
  if (diff < 60_000)            ago = `há ${Math.max(1, Math.floor(diff / 1000))}s`;
  else if (diff < 60 * 60_000)  ago = `há ${Math.floor(diff / 60_000)}min`;
  else                          ago = `há ${Math.floor(diff / (60 * 60_000))}h`;
  return { state: "active", label: `Tempo real ativo · ${ago}` };
}
```

- [ ] **Step 4: Rodar teste — passa**

Run: `npx vitest run src/lib/webhookHealth.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Hook useWebhookHealth (query MAX(received_at) da org)**

```typescript
// src/hooks/useWebhookHealth.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWebhookHealth() {
  const { data, isLoading } = useQuery({
    queryKey: ["webhook-health"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("ml_webhook_events")
        .select("received_at")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data?.received_at as string | undefined) ?? null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { lastEventIso: data ?? null, isLoading };
}
```
(RLS já filtra por org do usuário logado — a query só vê eventos da própria org.)

- [ ] **Step 6: Componente WebhookHealthBadge**

```tsx
// src/components/mercadolivre/WebhookHealthBadge.tsx
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWebhookHealth } from "@/hooks/useWebhookHealth";
import { formatWebhookHealth } from "@/lib/webhookHealth";

export function WebhookHealthBadge() {
  const { lastEventIso, isLoading } = useWebhookHealth();
  if (isLoading) return null;
  const { state, label } = formatWebhookHealth(lastEventIso, Date.now());
  const tone =
    state === "active" ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
    : state === "idle" ? "text-muted-foreground border-border bg-muted/40"
    : "text-muted-foreground border-border bg-muted/20";
  return (
    <Badge variant="outline" className={`gap-1.5 font-normal ${tone}`} title="Notificações em tempo real do Mercado Livre">
      <Radio className={`w-3 h-3 ${state === "active" ? "animate-pulse" : ""}`} />
      {label}
    </Badge>
  );
}
```

- [ ] **Step 7: Renderizar em MLPerguntas e MLDevolucoes**

Em ambos os arquivos, importar `import { WebhookHealthBadge } from "@/components/mercadolivre/WebhookHealthBadge";` e inserir `<WebhookHealthBadge />` junto ao `<MLPageHeader ... />` (ao lado do botão de sync/atualizar já existente). Manter o layout — só adicionar o badge na mesma linha do cabeçalho.

- [ ] **Step 8: Verificar build + testes**

Run: `npx tsc --noEmit && npx vitest run src/lib/webhookHealth.test.ts`
Expected: tsc 0 erros; testes PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/webhookHealth.ts src/lib/webhookHealth.test.ts src/hooks/useWebhookHealth.ts \
  src/components/mercadolivre/WebhookHealthBadge.tsx \
  src/pages/mercadolivre/MLPerguntas.tsx src/pages/mercadolivre/MLDevolucoes.tsx
git commit -m "feat(webhook): badge tempo-real em /perguntas e /devolucoes (Phase 89)"
```

---

### Task 7: Admin — painel de eventos de webhook em AdminMonitoring

**Files:**
- Create: `src/hooks/useWebhookEvents.ts`
- Create: `src/components/admin/WebhookEventsPanel.tsx`
- Modify: `src/pages/AdminMonitoring.tsx` (renderizar o painel)

**Interfaces:**
- Produces: hook `useWebhookEvents(limit?: number)` → últimos eventos da org; painel de tabela com topic/status/received_at.

- [ ] **Step 1: Hook useWebhookEvents**

```typescript
// src/hooks/useWebhookEvents.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WebhookEventRow {
  id: string; topic: string; status: string; resource: string;
  attempts: number; error_msg: string | null; received_at: string; processed_at: string | null;
}

export function useWebhookEvents(limit = 50) {
  return useQuery({
    queryKey: ["webhook-events", limit],
    queryFn: async (): Promise<WebhookEventRow[]> => {
      const { data, error } = await supabase
        .from("ml_webhook_events")
        .select("id,topic,status,resource,attempts,error_msg,received_at,processed_at")
        .order("received_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as WebhookEventRow[];
    },
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 2: Painel WebhookEventsPanel**

```tsx
// src/components/admin/WebhookEventsPanel.tsx
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWebhookEvents } from "@/hooks/useWebhookEvents";

const STATUS_TONE: Record<string, string> = {
  processed: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  received:  "text-amber-600 bg-amber-500/10 border-amber-500/30",
  error:     "text-red-600 bg-red-500/10 border-red-500/30",
  rejected:  "text-muted-foreground bg-muted/40 border-border",
};

export function WebhookEventsPanel() {
  const { data, isLoading } = useWebhookEvents(50);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Webhook ML — últimos eventos</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3">Recebido</th><th className="pr-3">Tópico</th>
                  <th className="pr-3">Status</th><th className="pr-3">Recurso</th><th>Tent.</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {format(parseISO(e.received_at), "dd/MM HH:mm:ss", { locale: ptBR })}</td>
                    <td className="pr-3">{e.topic}</td>
                    <td className="pr-3">
                      <Badge variant="outline" className={STATUS_TONE[e.status] ?? ""}>{e.status}</Badge></td>
                    <td className="pr-3 max-w-[220px] truncate" title={e.error_msg ?? e.resource}>
                      {e.error_msg ? `⚠ ${e.error_msg}` : e.resource}</td>
                    <td>{e.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Renderizar em AdminMonitoring**

Importar `import { WebhookEventsPanel } from "@/components/admin/WebhookEventsPanel";` e inserir `<WebhookEventsPanel />` como uma seção da página (seguindo o layout de cards existente).

- [ ] **Step 4: Build**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWebhookEvents.ts src/components/admin/WebhookEventsPanel.tsx src/pages/AdminMonitoring.tsx
git commit -m "feat(webhook): painel de eventos em AdminMonitoring (Phase 89)"
```

---

### Task 8: Entregável — URL de callback + passo a passo para o Wesley

**Files:**
- Create: `docs/superpowers/ml-webhook-setup.md`

- [ ] **Step 1: Escrever o doc de setup**

Conteúdo (preencher `<SECRET>` com o valor real definido na Task 2):
```markdown
# Registrar o webhook no painel do Mercado Livre

**URL de callback (Notifications callback URL):**
`https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<SECRET>`

**Passos (developers.mercadolivre.com.br):**
1. Entre em "Suas aplicações" → selecione a app da Pé Vermeio.
2. Aba **Notificações / Webhooks**.
3. Em "URL de retorno de chamada", cole a URL acima.
4. Marque os tópicos: **questions**, **claims**, **orders_v2**.
5. Salve. O ML envia um teste — deve retornar 200.

**Como conferir que está entrando:** em /monitoramento (owner) veja o painel
"Webhook ML — últimos eventos". Faça uma pergunta de teste num anúncio; deve
aparecer como `processed` em segundos.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/ml-webhook-setup.md
git commit -m "docs(webhook): URL de callback + passo a passo ML (Phase 89)"
```

---

### Task 9: Verificação final + PR

- [ ] **Step 1: Suíte completa**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0; vitest todos verdes (suite existente + 5 novos); build ok.

- [ ] **Step 2: Advisors (segurança/perf) via MCP**

`mcp__claude_ai_Supabase__get_advisors` type `security` e `performance`.
Expected: nenhum issue novo referente a `ml_webhook_events` (RLS habilitada já cobre o principal).

- [ ] **Step 3: Anti-IDOR (prova via SQL como role authenticated)**

Confirmar que a policy só deixa membro ler a própria org (evento gravado com `organization_id` do seller; RLS bloqueia outra org). Registrar no VERIFICATION.

- [ ] **Step 4: Atualizar ROADMAP + STATE (marcar Phase 89 executada) e abrir PR**

```bash
git push -u origin HEAD
gh pr create --title "Phase 89: Webhook ML tempo real (perguntas/reclamações/pedidos)" \
  --body "Ver docs/superpowers/plans/2026-07-06-ml-webhook-tempo-real.md. Pendente: Wesley registra a URL no painel ML (docs/superpowers/ml-webhook-setup.md) e valida em /monitoramento."
```

- [ ] **Step 5: Checkpoint Wesley**

Entregar a URL de callback e pedir validação visual do badge (light+dark) em /perguntas e /devolucoes + registro no painel ML.

---

## Self-Review (cobertura do spec)

- **Webhook receiver + 200<500ms + persist-first:** Tasks 2/3. ✓
- **Validação secret + user_id:** Task 2 (`safeEqual`, resolve seller). ✓
- **questions/claims upsert reusando normalização:** Task 3 (`questionRow`/`claimRow` = shapes dos syncs). ✓
- **orders cutuca sync + debounce 60s:** Task 4. ✓
- **Auditoria ml_webhook_events + idempotência + retry:** Tasks 1/3/5. ✓
- **Polling desacelerado (rede de segurança):** Task 5. ✓
- **Multi-conta por ml_user_id:** Tasks 2/3 (lookup por `ml_user_id`). ✓
- **Anti-IDOR/RLS org-first:** Task 1 (policy) + Task 9 (prova). ✓
- **UI badge + painel admin (sem redesenho):** Tasks 6/7. ✓
- **Dependência externa (URL + passo a passo):** Task 8. ✓
- **tsc/vitest/build/advisors + deploy via MCP:** Task 9 + constraints. ✓
