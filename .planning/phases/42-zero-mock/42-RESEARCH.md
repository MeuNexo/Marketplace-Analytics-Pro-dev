# Phase 42: Zero Mock — Research

**Researched:** 2026-06-13
**Domain:** ML Questions API, Claims API, Feedback API, pg_cron EF auth, React hook patterns, sellers table
**Confidence:** HIGH (all claims from codebase inspection + Nexo MCP production code)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Sync via pg_cron periódico — perguntas a cada ~15min, claims a cada ~30min. Não on-demand.
- **D-02:** Auth de pg_cron deve usar padrão correto deste projeto — evitar pitfall `sb_secret_` vs `SERVICE_ROLE_KEY`.
- **D-03:** Backfill inicial: perguntas = não-respondidas + respondidas recentes; claims = últimos 90 dias.
- **D-04:** Resposta inline — linha expande com textarea + botão "Responder".
- **D-05:** Passo de confirmação obrigatório antes de enviar (resposta ML é irreversível).
- **D-06:** Optimistic update + toast (sonner) após sucesso; contador de caracteres 0/2000.
- **D-07:** Gráfico "feedback diário 30d" derivado das datas reais dos feedbacks (groupBy day). Série esparsa aceita.
- **D-08:** Remoção de `getMockReputationSummary`, `getMockFeedbackDaily`, `getMockFeedbackEntries` e fallback em `useMLReputation.ts`.
- **D-09:** Lista unificada `ml_claims` com coluna "tipo" (reclamação / devolução) e filtro por status. Read-only.
- **D-10:** /perguntas, /devolucoes, /reputacao respeitam filtro de loja (`selectedStore`/HeaderScope) e sincronizam por `ml_user_id`. Merge em "todas" via padrão CR-01 da Phase 41.
- **D-11:** TV: substituir array `SELLERS` hardcoded por leitura da tabela `sellers` filtrada por `organization_id`, apenas sellers com ML conectado.
- **D-12:** Logo e iniciais da tabela `sellers`; fallback ML quando ausentes. Ciclagem alfabética por nome.

### Claude's Discretion

- Empty state quando tabela vazia antes do 1º cron (seller recém-conectado): exibir "sincronizando — volte em alguns minutos".
- Estrutura exata das tabelas `ml_questions` / `ml_claims` (colunas, índices, constraint única, RLS).
- Janela exata de backfill (D-03) — ajustável conforme custo de API observado.
- Paginação / ordenação default das listas.

### Deferred Ideas (OUT OF SCOPE)

- Responder/mediar reclamação em /devolucoes (reply_to_claim).
- Badge de contagem de pendências (perguntas não-respondidas / claims abertos) na sidebar.
- Notificação push/Telegram de nova pergunta ou claim.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOCK-01 | /perguntas lista perguntas reais do ML (tabela `ml_questions` + EF de sync via ML Questions API) | ML Questions API endpoint + fetch pattern de `/root/nexo-mcp/ml_client.py:945`; DDL proposto na seção Table Schemas |
| MOCK-02 | Usuário responde pergunta do comprador direto pela UI (POST answer na API ML) | ML Answers endpoint (`POST /answers`) de `/root/nexo-mcp/ml_client.py:2003`; padrão inline confirm em D-04/05/06 |
| MOCK-03 | /devolucoes lista reclamações e devoluções reais (tabela `ml_claims` + EF de sync via ML Claims API) | ML Claims API de `/root/nexo-mcp/ml_client.py:1002`; DDL proposto na seção Table Schemas |
| MOCK-04 | /reputacao exibe feedback real da API ML — remoção de todos os `getMock*` | Feedback endpoints de `/root/nexo-mcp/ml_client.py:1065`; análise de `useMLReputation.ts`; remoção de 3 funções mock |
| MOCK-05 | /tv lê sellers da tabela `sellers` filtrada por `organization_id` (sem UUIDs hardcoded) | Análise de `TVModeVendas.tsx:16`; padrão SellerContext + ml_tokens join |
</phase_requirements>

---

## Summary

Phase 42 elimina dados simulados de quatro páginas do produto. A maior parte do trabalho é **copiar lógica já validada em produção** do repositório Nexo MCP — não reinventar. O Nexo MCP já tem `fetch_questions`, `fetch_claims`, `fetch_feedback`, e `answer_question` funcionando com as APIs reais do ML; a tarefa é portá-los para Edge Functions Deno que escrevem em novas tabelas Supabase (`ml_questions`, `ml_claims`), criar os hooks React Query correspondentes, e modificar as três páginas + TVModeVendas.

O principal risco é o **pg_cron auth pitfall**: o projeto usa duas estratégias — (a) `X-Cron-Secret` via vault (para EFs com `verify_jwt=false` mas que não aceitam service_role_key diretamente) e (b) `Bearer <service_role_key>` lido do vault via `decrypted_secrets WHERE name='service_role_key'` (para EFs que aceitam Bearer service-role key). O padrão (b) é o que foi usado para `sync-tiny-costs` e é o correto para as novas EFs `sync-ml-questions` e `sync-ml-claims`.

A reputação (MOCK-04) é a mais simples: `useMLReputation.ts` já busca dados reais — basta remover o fallback mock e adicionar a lógica de derivar o gráfico diário das datas dos feedbacks reais retornadas pela EF `ml-reputation` existente.

**Primary recommendation:** Porte direto do Nexo MCP. Use `fetch_questions` e `fetch_claims` como especificação canônica dos endpoints ML. Crie EFs Deno seguindo o padrão de `sync-ads` (verify_jwt=false, Bearer service-role-key, multi-seller loop sobre ml_tokens).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sincronização periódica questions/claims | pg_cron + Edge Function Deno | — | Modelo cron já estabelecido no projeto; EF acessa ML API com token de ml_tokens |
| Cache de questions/claims | Tabelas Supabase (`ml_questions`, `ml_claims`) | — | Todas as outras entidades ML usam tabelas de cache; leitura via hook React Query |
| Reply to question (POST ML) | Edge Function Deno | — | Não pode ser client-side (expõe ML token); padrão de outras EFs que escrevem no ML |
| Feedback real-time | Edge Function existente `ml-reputation` | — | Já funciona; só remover mock no hook |
| Gráfico feedback diário | Frontend (derivação em hook/página) | — | Aggregação de datas é cálculo simples; sem tabela nova necessária |
| /tv sellers dinâmicos | Frontend direto Supabase | — | Tabela `sellers` é acessível ao cliente autenticado via RLS; join ml_tokens para filtrar ML-conectados |
| Filtro multi-loja | HeaderScopeContext + hook | — | Padrão CR-01 já existe; hooks novos consomem `resolvedMLUserIds` |

---

## Standard Stack

### Core (já instalado — sem dependências novas)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | 5.83.0 | Cache server state questions/claims | Padrão dominante do projeto |
| @supabase/supabase-js | 2.98.0 | Leitura de tabelas e invocação de EFs | Infraestrutura base |
| sonner | 1.7.4 | Toast de sucesso/erro na resposta | Já usado no projeto |
| lucide-react | 1.7.0 | Ícones (MessageCircle, CheckCircle, etc.) | Design system do projeto |
| recharts | 2.15.4 | Gráfico de feedback diário (D-07) | Já usado em MLReputacao |
| date-fns | 3.6.0 | groupBy day para gráfico de feedback | Já importado no projeto |

**Nenhuma dependência nova é necessária.** [VERIFIED: codebase inspection]

---

## Package Legitimacy Audit

Nenhum pacote novo a instalar. Esta fase é puramente de código — novas tabelas, novas EFs Deno (sem deps adicionais), modificações de hooks/páginas existentes.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| N/A | — | — | — | — | — | Nenhum pacote novo |

**Packages removed due to [SLOP] verdict:** nenhum
**Packages flagged as suspicious [SUS]:** nenhum

---

## ML API Reference (portado do Nexo MCP — produção validada)

### Questions API [VERIFIED: /root/nexo-mcp/ml_client.py:945]

```
GET https://api.mercadolibre.com/questions/search
  ?seller_id={ml_user_id_numerico}
  &status=unanswered|answered|closed
  &limit=50
  &offset={n}

Response:
{
  "questions": [
    {
      "id": 1234567890,          // question_id (int)
      "item_id": "MLB123456789", // item
      "text": "...",             // texto da pergunta
      "status": "UNANSWERED",   // UNANSWERED | ANSWERED | CLOSED
      "date_created": "2026-06-01T10:00:00.000-03:00",
      "from": { "id": 123456 }, // comprador_id
      "answer": {               // null se não respondida
        "text": "...",
        "date_created": "..."
      }
    }
  ],
  "paging": { "total": 42, "offset": 0, "limit": 50 }
}
```

**Rate limit:** 0.2s entre páginas (validado em produção pelo Nexo MCP)
**Paginação:** page_size=50, iterar até `offset >= min(total, limit)`
**Status filter:** A API aceita `status` como parâmetro de query. Buscar `UNANSWERED` primeiro para backfill urgente, depois `ANSWERED` recentes.

### Answer Question API [VERIFIED: /root/nexo-mcp/ml_client.py:2003]

```
POST https://api.mercadolibre.com/answers
Authorization: Bearer {access_token}
Content-Type: application/json

Body: { "question_id": 1234567890, "text": "Texto da resposta até 2000 chars" }

Response 201: { "id": 9876543, ... }
Response 4xx: { "message": "..." }
```

**Irreversível.** Sem endpoint de deleção/edição. Limite: 2000 caracteres. [VERIFIED: /root/nexo-mcp/server.py:1448 — contexto da tool reply_to_question]

### Claims API [VERIFIED: /root/nexo-mcp/ml_client.py:1002]

Nexo MCP tenta dois URLs em sequência (fallback):

```
GET https://api.mercadolibre.com/v1/claims/search
GET https://api.mercadolibre.com/post-purchase/v1/claims/search  (fallback)

Params:
  role=respondent
  status=opened|closed
  limit=50
  offset={n}

Response:
{
  "data": [              // ou "claims" ou "results" dependendo do endpoint
    {
      "id": "claim_id_string",
      "resource_id": "order_id",
      "status": "opened|closed",
      "type": "mediations|returns|...",   // discrimina reclamação vs devolução
      "reason_id": "not_received|item_damaged|...",
      "date_created": "2026-05-01T...",
      "resolution_due_date": "2026-05-08T...",
      "resolution": { "type": "refund|..." }
    }
  ],
  "paging": { "total": 5, "offset": 0, "limit": 50 }
}
```

**Nota:** O campo `type` diferencia reclamação (mediations) de devolução (returns) — é o discriminador para a coluna "tipo" da tabela `ml_claims` (D-09). [VERIFIED: /root/nexo-mcp/ml_client.py:1047]

### Feedback API [VERIFIED: /root/nexo-mcp/ml_client.py:1065]

ML deprecou o endpoint público de feedback individual em 2023+. O Nexo MCP tenta três URLs em sequência:

```
GET /users/{ml_user_id}/feedbacks/received
GET /users/{ml_user_id}/feedbacks?as=seller
GET /users/{ml_user_id}/feedback?as=seller

Response (quando disponível):
{
  "feedbacks": [
    {
      "id": 123,
      "order_id": 456789,
      "fulfilled": "positive" | true | false,   // pode ser string ou bool
      "message": "Ótimo produto!",
      "date_created": "2026-05-15T...",
      "replied": false
    }
  ],
  "paging": { "total": 20, "offset": 0, "limit": 20 }
}
```

**Importante:** page_size=20 (limite do ML). `fulfilled` pode ser string `"positive"` ou boolean. Normalizar com `rating = fulfilled === "positive" || fulfilled === true ? "positive" : "negative"`. [VERIFIED: /root/nexo-mcp/ml_client.py:1121-1133]

**Implication for D-07 (gráfico diário):** A disponibilidade do endpoint é incerta (deprecated). Se o endpoint retornar 200, o campo `date_created` existe e permite groupBy day. Se retornar erro, exibir gráfico vazio sem falha. O hook deve tratar `[]` como estado válido.

---

## Architecture Patterns

### System Architecture Diagram

```
pg_cron (*/15 questions, */30 claims)
    │
    ▼ net.http_post (Bearer service_role_key via vault)
EF sync-ml-questions / sync-ml-claims
    │  ├── lê ml_tokens (todos com access_token)
    │  ├── para cada ml_user_id: GET ML API com paginação
    │  └── upsert → ml_questions / ml_claims (org+ml_user_id scoped)
    │
    ▼ (frontend, usuário autenticado)
useMLQuestions(mlUserIds[]) / useMLClaims(mlUserIds[])
    │  React Query v5
    │  lê de ml_questions / ml_claims via Supabase client
    │  filtra por organization_id + ml_user_id[]
    │
    ├── MLPerguntas.tsx (lista, inline reply)
    └── MLDevolucoes.tsx (lista read-only, filtro status)

Para reply (MOCK-02):
Frontend → EF reply-ml-question (verify_jwt=true, user JWT)
    │  valida organização, busca token de ml_tokens
    └── POST /answers → ML API → optimistic update + toast

Para /reputacao (MOCK-04):
useMLReputation.ts (já funciona) → EF ml-reputation (existente)
    │  remove getMock* + fallback
    └── derivar gráfico diário de feedbacks reais recebidos

Para /tv (MOCK-05):
TVModeVendas.tsx
    │  useEffect: query sellers WHERE organization_id = currentOrg.id
    │  join ml_tokens to filter only ML-connected sellers
    └── sort alphabetically by name
```

### Recommended Project Structure

```
supabase/
├── functions/
│   ├── sync-ml-questions/index.ts   (novo — cron-invoked, verify_jwt=false)
│   ├── sync-ml-claims/index.ts      (novo — cron-invoked, verify_jwt=false)
│   └── reply-ml-question/index.ts   (novo — user-invoked, verify_jwt=true)
├── migrations/
│   └── 2026XXXXXX_ml_questions_claims.sql  (CREATE TABLE + RLS + pg_cron schedules)
src/
├── hooks/
│   ├── useMLQuestions.ts    (novo — React Query v5, lê ml_questions)
│   └── useMLClaims.ts       (novo — React Query v5, lê ml_claims)
├── pages/mercadolivre/
│   ├── MLPerguntas.tsx      (modificar — substituir mock por useMLQuestions)
│   ├── MLDevolucoes.tsx     (modificar — substituir mock por useMLClaims)
│   └── MLReputacao.tsx      (modificar — usar feedback real, remover mock)
├── pages/
│   └── TVModeVendas.tsx     (modificar — substituir SELLERS por query dinâmica)
└── data/
    ├── perguntasMockData.ts    (deletar ou deixar para remoção)
    ├── reputacaoMockData.ts    (manter apenas tipos — remover getMock*)
    └── devolucoesMockData.ts   (deletar ou deixar para remoção)
```

---

## Table Schemas (Claude's Discretion)

### ml_questions

Seguindo padrão de `ml_billing_monthly` e `orders`:

```sql
CREATE TABLE public.ml_questions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  question_id     BIGINT NOT NULL,           -- ML numeric ID
  item_id         TEXT,                      -- MLB...
  item_title      TEXT,                      -- enriquecimento opcional
  texto           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'UNANSWERED', -- UNANSWERED | ANSWERED | CLOSED
  comprador_id    TEXT,
  data_pergunta   TIMESTAMPTZ,               -- date_created da API
  resposta        TEXT,                      -- answer.text (null se não respondida)
  data_resposta   TIMESTAMPTZ,               -- answer.date_created
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, question_id)
);

ALTER TABLE public.ml_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_questions"
  ON public.ml_questions
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));

-- Índices para queries comuns
CREATE INDEX idx_ml_questions_scope ON public.ml_questions (organization_id, ml_user_id);
CREATE INDEX idx_ml_questions_status ON public.ml_questions (organization_id, ml_user_id, status);
CREATE INDEX idx_ml_questions_data ON public.ml_questions (organization_id, ml_user_id, data_pergunta DESC);
```

### ml_claims

```sql
CREATE TABLE public.ml_claims (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  ml_user_id      TEXT NOT NULL,
  claim_id        TEXT NOT NULL,             -- ML claim ID (string)
  order_id        TEXT,                      -- resource_id / order_id
  tipo            TEXT NOT NULL DEFAULT 'mediations', -- 'mediations' | 'returns'
  status          TEXT NOT NULL DEFAULT 'opened',     -- 'opened' | 'closed'
  motivo          TEXT,                      -- reason_id
  data_abertura   DATE,
  data_limite     DATE,                      -- resolution_due_date
  solucao         TEXT,                      -- resolution.type
  synced_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, ml_user_id, claim_id)
);

ALTER TABLE public.ml_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_claims"
  ON public.ml_claims
  FOR ALL
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE INDEX idx_ml_claims_scope ON public.ml_claims (organization_id, ml_user_id);
CREATE INDEX idx_ml_claims_status ON public.ml_claims (organization_id, ml_user_id, status);
CREATE INDEX idx_ml_claims_data ON public.ml_claims (organization_id, ml_user_id, data_abertura DESC);
```

---

## pg_cron Auth Pattern (CRÍTICO — pitfall D-02)

### Como funciona neste projeto [VERIFIED: codebase inspection]

O projeto usa **dois** padrões de auth para EFs invocadas por cron:

**Padrão A — `X-Cron-Secret`** (para EFs que não aceitam service_role_key como Bearer):
```sql
-- Usado por: ml-token-refresh, sync-ads (via cron scheduler na Supabase UI, não via migration)
SELECT net.http_post(
  url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-token-refresh',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
  ),
  body := '{}'::jsonb
);
```
EF correspondente lê e valida `X-Cron-Secret` via `get_cron_secret()` RPC.

**Padrão B — `Bearer service_role_key`** (para EFs que aceitam service-role como Bearer):
```sql
-- Usado por: sync-tiny-costs — este é o padrão a usar para sync-ml-questions / sync-ml-claims
SELECT net.http_post(
  url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'service_role_key' LIMIT 1
    )
  ),
  body    := '{}'::jsonb
) AS request_id;
```
EF correspondente verifica `token === SUPABASE_SERVICE_ROLE_KEY`. [VERIFIED: /root/garment-glow-test/supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql:168-172 + sync-ads/index.ts requireServiceRole()]

### Por que o Nexo MCP falhou [VERIFIED: STATE.md "Sessão 2026-06-13 — Aprendizados de domínio"]

> "Invocar EF programaticamente: net.http_get/post com token de ml_tokens (ML API direto); key sb_secret do cron ≠ SERVICE_ROLE_KEY env → 401 esperado na EF"

A key `sb_secret_*` que o pg_cron do Supabase pode injetar automaticamente é o JWT do `anon` role — não o SERVICE_ROLE_KEY. A EF que verifica `token === SUPABASE_SERVICE_ROLE_KEY` rejeita a anon key com 401. A solução é **ler a service_role_key do vault** (como já feito em sync-tiny-costs) e passá-la explicitamente.

### config.toml para novas EFs [VERIFIED: /root/garment-glow-test/supabase/config.toml]

```toml
[functions.sync-ml-questions]
verify_jwt = false   # cron não envia JWT válido; auth interna checa service_role_key

[functions.sync-ml-claims]
verify_jwt = false

[functions.reply-ml-question]
verify_jwt = true    # chamada por usuário autenticado (user JWT)
```

### pg_cron Schedule Pattern (migration)

```sql
-- Limpar job anterior se existir (idempotente)
DO $$ BEGIN PERFORM cron.unschedule('sync-ml-questions-every-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-ml-questions-every-15min',
  '*/15 * * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-questions',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cmd$
);

DO $$ BEGIN PERFORM cron.unschedule('sync-ml-claims-every-30min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-ml-claims-every-30min',
  '*/30 * * * *',
  $cmd$
    SELECT net.http_post(
      url     := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-ml-claims',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $cmd$
);
```

---

## Edge Function Patterns

### sync-ml-questions (novo) — baseado em sync-ads [VERIFIED: codebase]

```typescript
// supabase/functions/sync-ml-questions/index.ts
// verify_jwt = false (config.toml)

serve(async (req) => {
  // Auth: apenas service_role_key (cron) ou invocação manual
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);

  // Buscar todos os ml_tokens com access_token válido
  const { data: tokens } = await sb
    .from("ml_tokens")
    .select("ml_user_id, organization_id, access_token, refresh_token, expires_at")
    .not("access_token", "is", null);

  // Para cada token: fetch questions + upsert
  for (const tokenRow of tokens ?? []) {
    const accessToken = await ensureFreshToken(sb, tokenRow);
    const questions = await fetchQuestions(accessToken, tokenRow.ml_user_id);
    // upsert via INSERT ON CONFLICT DO UPDATE
    await sb.from("ml_questions").upsert(
      questions.map(q => ({
        organization_id: tokenRow.organization_id,
        ml_user_id: tokenRow.ml_user_id,
        question_id: q.id,
        item_id: q.item_id,
        texto: q.text,
        status: q.status,
        comprador_id: String(q.from?.id ?? ""),
        data_pergunta: q.date_created,
        resposta: q.answer?.text ?? null,
        data_resposta: q.answer?.date_created ?? null,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "organization_id,ml_user_id,question_id" }
    );
  }
  return json({ ok: true });
});
```

**Token refresh inline:** Mesmo padrão de `sync-ads/getAccessToken()` — verificar `expires_at`, se < 5min, refresh via `POST /oauth/token`. [VERIFIED: /root/garment-glow-test/supabase/functions/sync-ads/index.ts]

### reply-ml-question (novo) — baseado em ml-reputation [VERIFIED: codebase]

```typescript
// verify_jwt = true
// Recebe: { question_id: number, text: string, ml_user_id: string }
// Valida: org membership, tamanho do texto (≤2000)
// POST /answers no ML
// Atualiza ml_questions localmente após sucesso (optimistic confirm)
```

---

## Code Examples

### useMLQuestions hook (React Query v5, padrão do projeto)

```typescript
// src/hooks/useMLQuestions.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHeaderScope } from "@/contexts/HeaderScopeContext";
import { useOrganization } from "@/contexts/OrganizationContext";

export function useMLQuestions(status?: "UNANSWERED" | "ANSWERED" | "CLOSED") {
  const { resolvedMLUserIds, scopeKey } = useHeaderScope();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery({
    queryKey: ["ml_questions", orgId, scopeKey, status],
    enabled: !!orgId && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,  // 2min — cron roda a cada 15min
    queryFn: async () => {
      let q = supabase
        .from("ml_questions")
        .select("*")
        .eq("organization_id", orgId!)
        .in("ml_user_id", resolvedMLUserIds)
        .order("data_pergunta", { ascending: false })
        .limit(200);

      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

**Padrão CR-01 multi-loja:** `resolvedMLUserIds` já contém os IDs corretos para a loja selecionada (ou todas as lojas se "all"). O filtro `.in("ml_user_id", resolvedMLUserIds)` implementa o merge automaticamente. [VERIFIED: src/contexts/HeaderScopeContext.tsx]

### Remoção de mocks em MLPerguntas.tsx

```typescript
// REMOVER:
import {
  getMockPerguntasSummary,
  getMockPerguntasDailyStats,
  getMockPerguntaEntries,
} from "@/data/perguntasMockData";

// SUBSTITUIR:
import { useMLQuestions } from "@/hooks/useMLQuestions";

// No componente:
const { data: questions = [], isLoading } = useMLQuestions();
// Derivar summary, dailyStats e entries de questions[]
```

### Derivar gráfico diário de feedback (D-07)

```typescript
// Em MLReputacao.tsx ou hook auxiliar
// Source: feedbacks do EF ml-reputation (já retorna feedbacks? — verificar abaixo)
// Alternativa: nova EF ou expandir ml-reputation para retornar feedbacks

function buildDailyFeedback(feedbacks: FeedbackEntry[]): FeedbackDailyStat[] {
  const byDay = new Map<string, { positive: number; neutral: number; negative: number }>();
  for (const f of feedbacks) {
    const day = f.date.substring(0, 10);
    const cur = byDay.get(day) ?? { positive: 0, neutral: 0, negative: 0 };
    cur[f.rating]++;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));
}
```

### TVModeVendas — substituição do array SELLERS

```typescript
// ANTES (TVModeVendas.tsx:16):
const SELLERS = [
  { id: "8c57110c-...", name: "Sandrini", initials: "SA", logo: "https://..." },
  { id: "52a7ed04-...", name: "Buy Clock", initials: "BC", logo: "https://..." },
];

// DEPOIS:
// No componente TVModeVendas, adicionar useEffect para carregar sellers dinâmicos:
const { currentOrg } = useOrganization();

const [sellers, setSellers] = useState<Array<{
  id: string; name: string; initials: string; logo: string | null;
}>>([]);

useEffect(() => {
  if (!currentOrg?.id) return;
  // Buscar sellers com ML conectado via join ml_tokens
  supabase
    .from("sellers")
    .select("id, name, initials, logo_url, organization_id")
    .eq("organization_id", currentOrg.id)
    .eq("is_active", true)
    .order("name")
    .then(async ({ data: sellerRows }) => {
      if (!sellerRows) return;
      // Filtrar apenas sellers com ml_tokens
      const { data: tokenRows } = await supabase
        .from("ml_tokens")
        .select("seller_id")
        .eq("organization_id", currentOrg.id)
        .not("access_token", "is", null);
      const connectedIds = new Set((tokenRows ?? []).map(t => t.seller_id));
      setSellers(
        sellerRows
          .filter(s => connectedIds.has(s.id))
          .map(s => ({
            id: s.id,
            name: s.name,
            initials: s.initials ?? generateInitials(s.name),
            logo: s.logo_url,
          }))
      );
    });
}, [currentOrg?.id]);
```

[VERIFIED: TVModeVendas.tsx:16, SellerContext.tsx, src/types/seller.ts]

---

## Existing Code to Modify

### 1. useMLReputation.ts

**Arquivo:** `src/hooks/useMLReputation.ts`

**O que remover:**
- Import de `getMockReputationSummary` de `@/data/reputacaoMockData`
- O estado/useMemo `mockReputation`
- O campo `mockReputation` no return (quebra a interface — verificar consumidores)

**O que adicionar:**
- Busca de feedbacks individuais via endpoint ML (mesma lógica do Nexo MCP `fetch_feedback`)
- Campo `feedbacks: FeedbackEntry[]` no return para o gráfico diário (D-07)

**Consumidores de `mockReputation`:** Verificar se MLReputacao.tsx ou outros componentes consomem `mockReputation` do hook — se sim, substituir pela lista real de feedbacks.

**Nota:** A EF `ml-reputation` atual retorna apenas `seller_reputation` e `power_seller_status` — NÃO retorna feedbacks individuais. Para D-07, há duas opções:
- **Opção A (recomendada):** Expandir a EF `ml-reputation` para incluir busca de feedbacks (mesmo endpoint do Nexo MCP), retornando o array de feedbacks no response.
- **Opção B:** Criar EF separada `ml-feedback` invocada pelo hook.

Claude's discretion: Opção A é mais simples — uma única chamada de EF para toda a página /reputacao.

### 2. MLPerguntas.tsx

**Arquivo:** `src/pages/mercadolivre/MLPerguntas.tsx`

**O que remover:**
```typescript
// Linhas ~22-26:
import {
  getMockPerguntasSummary,
  getMockPerguntasDailyStats,
  getMockPerguntaEntries,
} from "@/data/perguntasMockData";
// linhas ~47-50: chamadas getMock*
```

**O que adicionar:**
- Hook `useMLQuestions()`
- Estado de resposta inline (D-04): `answeringId: string | null`, `answerText: string`
- Componente de confirmação (D-05): Dialog/Alert de confirmação antes do POST
- Invocação da EF `reply-ml-question` + toast sonner (D-06)
- Contador de chars `answerText.length / 2000` (D-06)
- Badge "dados simulados" → remover

### 3. MLDevolucoes.tsx

**O que remover:** import e chamadas de `getMockDevolucoesSummary` / `getMockDevolucaoEntries` / `getMockDevolucoesDailyStats`

**O que adicionar:**
- Hook `useMLClaims()`
- Filtro por status (aberto / disputa / fechado) — Tab ou Select
- Filtro por tipo (reclamação / devolução) — Tab ou Select
- Badge "dados simulados" → remover

### 4. TVModeVendas.tsx

**O que remover:** `const SELLERS = [...]` (linhas 16-19)

**O que adicionar:** carregamento dinâmico via Supabase (ver padrão acima)

**Atenção:** O ciclo atual usa `SELLERS.length` e `SELLERS[sellerIdx]` em múltiplos useEffects. Substituir por `sellers` state — os effects precisam de `sellers` como dependência para reinicializar quando a lista muda.

### 5. MLReputacao.tsx

Verificar quais `getMock*` são chamados diretamente nesta página (vs. via hook). Remover todos. Garantir que o gráfico usa dados reais mesmo quando esparso.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Paginação ML API | Loop customizado ad-hoc | Padrão do Nexo MCP (offset + total comparison) | Rate limit tratado, testado em produção |
| Token refresh inline | Lógica própria de OAuth | Padrão de `sync-ads/getAccessToken()` | Já handle expires_at, ML credentials, retry |
| Multi-loja merge | Lógica de merge própria | `resolvedMLUserIds` do HeaderScopeContext | CR-01 já implementado; consistente com todas as outras páginas |
| pg_cron auth | Injeção de JWT customizado | Vault `service_role_key` + Bearer (padrão B) | `sb_secret_*` ≠ SERVICE_ROLE_KEY → 401 |
| Optimistic update | Rollback manual | `useMutation` React Query v5 + toast sonner | Já no projeto; fire-and-forget pattern aceitável aqui |
| Char counter | Implementação própria | `text.length / 2000` inline + Tailwind | Trivial — sem lib necessária |

---

## Common Pitfalls

### Pitfall 1: `sb_secret_*` ≠ SERVICE_ROLE_KEY
**What goes wrong:** pg_cron tenta invocar a EF mas recebe 401.
**Why it happens:** O Supabase pode injetar o anon JWT (prefixo `sb_secret_` em alguns ambientes) em vez do service_role_key. A EF verifica `token === SUPABASE_SERVICE_ROLE_KEY` e rejeita.
**How to avoid:** Sempre ler service_role_key do vault na migration do cron: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1`. [VERIFIED: codebase + STATE.md]
**Warning signs:** Logs da EF mostram "Unauthorized"; `cron.job_run_details` mostra status error com body `{"error":"Unauthorized"}`.

### Pitfall 2: SELLERS array hardcoded no useEffect dependency array
**What goes wrong:** Após substituir o array por state dinâmico, os useEffects que dependem de `SELLERS.length` não reagem quando a lista de sellers muda.
**Why it happens:** Dependência de comprimento de array constante → não invalidada.
**How to avoid:** Usar `sellers.length` e `sellers[sellerIdx]` no state dinâmico; incluir `sellers` como dependência dos useEffects de ciclo. Reinicializar `sellerIdx = 0` quando a lista muda.

### Pitfall 3: `fulfilled` booleano vs string na API de feedback
**What goes wrong:** O campo `fulfilled` pode ser `true`, `false`, `"positive"`, ou `"negative"` dependendo da versão da API ML.
**Why it happens:** ML mudou o schema ao longo do tempo sem versionar o endpoint.
**How to avoid:** Normalizar: `rating = (f.fulfilled === "positive" || f.fulfilled === true) ? "positive" : "negative"`. [VERIFIED: /root/nexo-mcp/ml_client.py:1121]

### Pitfall 4: ml-reputation EF não retorna feedbacks individuais
**What goes wrong:** D-07 (gráfico diário) não tem dados para renderizar.
**Why it happens:** A EF atual só retorna `seller_reputation` e `power_seller_status` — não busca feedbacks.
**How to avoid:** Expandir a EF `ml-reputation` para incluir busca de feedbacks OU criar nova EF. Decidir na Wave 0 do plan.

### Pitfall 5: Claims API dual URL
**What goes wrong:** `GET /v1/claims/search` retorna 404 ou 403 dependendo do tipo de conta ML.
**Why it happens:** ML mudou o endpoint de claims — o Nexo MCP trata isso tentando dois URLs.
**How to avoid:** Implementar o mesmo fallback: tentar `/v1/claims/search` primeiro; se não-200, tentar `/post-purchase/v1/claims/search`. [VERIFIED: /root/nexo-mcp/ml_client.py:1012-1029]

### Pitfall 6: UNIQUE constraint de questions sem organization_id
**What goes wrong:** Ao fazer upsert, question_id não é globalmente único — dois sellers podem ter a mesma pergunta com IDs numéricos próximos (improvável mas possível), e mais importante, dois orgs podem ter o mesmo ml_user_id se uma conta ML se desconectar e reconectar.
**How to avoid:** Unique constraint em `(organization_id, ml_user_id, question_id)` — como proposto no DDL acima.

### Pitfall 7: Feedback endpoint deprecated não tratado
**What goes wrong:** Se todos os endpoints de feedback retornarem não-200, o hook lança exceção e quebra a página.
**Why it happens:** ML deprecated o endpoint público de feedback (2023+).
**How to avoid:** A EF de feedback deve retornar `[]` (não lançar exceção) se nenhum endpoint responder. O hook trata `feedbacks: []` como estado válido — gráfico mostra linha vazia, não erro. [VERIFIED: /root/nexo-mcp/ml_client.py:1143-1152]

---

## Sellers Table Schema (MOCK-05)

### Colunas confirmadas via codebase [VERIFIED: src/types/seller.ts + migrations]

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | UUID | PK |
| `name` | TEXT | Nome do seller |
| `initials` | TEXT | Sigla (2 chars) — nullable, gerado por `generateInitials()` |
| `logo_url` | TEXT | URL da foto — adicionada em migration `20260331133001` |
| `is_active` | BOOLEAN | Flag de ativo |
| `organization_id` | UUID | FK organizations |
| `created_at` | TIMESTAMPTZ | — |

**Não existe coluna `ml_user_id` na tabela `sellers`.** A ligação é via `ml_tokens.seller_id` → `sellers.id`. [VERIFIED: HeaderScopeContext.tsx:70-80, TVModeVendas.tsx:114-119]

**Portanto, para MOCK-05:** O padrão correto é:
1. Query `sellers WHERE organization_id = currentOrg.id AND is_active = true ORDER BY name`
2. Query `ml_tokens WHERE organization_id = currentOrg.id AND seller_id IN (sellerIds) AND access_token IS NOT NULL`
3. Filter sellers: apenas os que têm entrada em ml_tokens
4. Sort alphabetically by name (já feito pelo ORDER BY name na query)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase project ckcdevcxgvueywivefgx | Todas as EFs | ✓ | Confirmado em STATE.md + config.toml | — |
| ML API (api.mercadolibre.com) | sync EFs + reply EF | ✓ | — | — |
| vault.secrets 'service_role_key' | pg_cron auth | ✓ | Confirmado em sync-tiny-costs migration | — |
| pg_cron extension | cron schedules | ✓ | Confirmado em migration inicial | — |
| net.http_post | cron → EF | ✓ | Confirmado em múltiplas migrations | — |

**Missing dependencies:** nenhum.

---

## Validation Architecture

> nyquist_validation não está setado como false — seção incluída.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | vite.config.ts (vitest config inline) |
| Quick run command | `npm run test` |
| Full suite command | `npm run test -- --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOCK-01 | useMLQuestions lê ml_questions da org correta | unit | `npm test -- src/hooks/useMLQuestions.test.ts` | ❌ Wave 0 |
| MOCK-02 | reply-ml-question: valida 2000 chars, rejeita sem confirmação | unit | `npm test -- src/hooks/useMLQuestions.test.ts` | ❌ Wave 0 |
| MOCK-03 | useMLClaims filtra por status e tipo | unit | `npm test -- src/hooks/useMLClaims.test.ts` | ❌ Wave 0 |
| MOCK-04 | getMock* não existem mais no bundle | smoke/grep | `grep -r "getMock" src/ | grep -v "\.test\."` (0 resultados) | ❌ Wave 0 |
| MOCK-05 | TVModeVendas não contém UUIDs hardcoded | smoke/grep | `grep -n "8c57110c\|52a7ed04" src/pages/TVModeVendas.tsx` (0 resultados) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run build` (verifica tsc + bundle)
- **Per wave merge:** `npm test`
- **Phase gate:** `npm run build` + `npm test` limpos + smoke visual nas 4 páginas

### Wave 0 Gaps
- [ ] `src/hooks/useMLQuestions.test.ts` — cobre MOCK-01, MOCK-02
- [ ] `src/hooks/useMLClaims.test.ts` — cobre MOCK-03
- [ ] Smoke checks via grep para MOCK-04 e MOCK-05

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (user JWT em reply-ml-question); service_role_key em sync EFs |
| V3 Session Management | no | Sem nova sessão; reutiliza Supabase session |
| V4 Access Control | yes | RLS org_member em ml_questions e ml_claims; is_org_member() verificado no reply EF |
| V5 Input Validation | yes | Zod schema em reply-ml-question (question_id: bigint, text: max 2000 chars) |
| V6 Cryptography | no | Sem cripto nova; ML tokens já gerenciados |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reply para question de outra org | Elevation of Privilege | EF verifica `is_org_member(user_id, org_id_do_token)` antes de POST no ML |
| Service role key exposed via SQL | Information Disclosure | Usar vault.decrypted_secrets (não hardcodar em migrations commitadas) |
| Rate limit bypass (muitas perguntas) | DoS | 0.2s sleep entre páginas no sync EF; cron a cada 15min por design |
| XSS em texto de pergunta/resposta | Tampering | React escapa strings por padrão em JSX; não usar dangerouslySetInnerHTML |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | vault.secrets tem entry `'service_role_key'` (não apenas `'CRON_SECRET'`) neste projeto | pg_cron Auth Pattern | Se não existir, cron vai com 401; requer INSERT manual na vault antes de deployar |
| A2 | ML Questions API aceita `status` em UPPERCASE (`UNANSWERED`) — o Nexo MCP usa lowercase (`unanswered`) mas a resposta retorna UPPERCASE | ML API Reference | Se a API for case-sensitive no request, o filtro de status pode não funcionar; testar no primeiro sync |
| A3 | O endpoint de feedback retorna dados suficientes para construir a série temporal 30d (i.e., não está bloqueado para esta conta ML) | MOCK-04 / Feedback API | Se bloqueado, gráfico fica vazio; aceitável per D-07 ("sem fabricação") |
| A4 | `sellers` table tem `organization_id` acessível via RLS para usuários autenticados | MOCK-05 / TVModeVendas | Se RLS bloquear, TVModeVendas fica sem sellers; verificar política existente |

**A1 é o mais crítico.** Antes de aplicar a migration de pg_cron, verificar via SQL Editor se `'service_role_key'` existe: `SELECT name FROM vault.secrets WHERE name = 'service_role_key';`. Se não existir, inserir manualmente via Supabase Dashboard (Vault UI) ou via: `SELECT vault.create_secret('<valor>', 'service_role_key', 'Service role key para pg_cron');`

---

## Open Questions

1. **vault.secrets tem `service_role_key`?**
   - O que sabemos: migration `sync-tiny-costs` a usa, e foi aplicada em produção com sucesso
   - O que não sabemos: se foi inserida manualmente antes, ou está presente por padrão
   - Recomendação: planner inclui Wave 0 task de validar via SQL antes de aplicar cron migration

2. **ml-reputation EF deve retornar feedbacks?**
   - O que sabemos: atualmente não retorna; D-07 precisa de feedbacks com datas
   - O que não sabemos: se a conta Pé Vermeio tem feedbacks acessíveis via API ML
   - Recomendação: expandir EF `ml-reputation` para retornar `feedbacks[]` na mesma resposta; tratar [] como válido

3. **Status de questions: UPPERCASE ou lowercase no request?**
   - Nexo MCP usa lowercase no request (`status: "unanswered"`) mas retorna UPPERCASE na response
   - Recomendação: seguir o Nexo MCP (lowercase no request); normalizar para UPPERCASE ao salvar na tabela

---

## Sources

### Primary (HIGH confidence)
- `/root/nexo-mcp/ml_client.py` — endpoints ML Questions/Claims/Feedback/Answers, paginations, status parsing, rate limits — todos validados em produção
- `/root/nexo-mcp/server.py` — tools get_questions, get_claims, reply_to_question, reply_to_claim — contexto de uso + limites
- `/root/garment-glow-test/supabase/migrations/20260521300000_recalc_tax_and_cron_custos.sql` — padrão de pg_cron com vault service_role_key
- `/root/garment-glow-test/supabase/functions/sync-ads/index.ts` — padrão de EF cron-invoked com requireServiceRole
- `/root/garment-glow-test/supabase/config.toml` — verify_jwt settings existentes
- `/root/garment-glow-test/src/hooks/useMLReputation.ts` — padrão atual de hook ML (a ser modificado)
- `/root/garment-glow-test/src/pages/TVModeVendas.tsx` — SELLERS hardcoded + fetchSellerData pattern

### Secondary (MEDIUM confidence)
- `/root/garment-glow-test/.planning/STATE.md` — aprendizados de domínio de auth pg_cron (sessão 2026-06-13)
- `/root/garment-glow-test/.planning/codebase/INTEGRATIONS.md` — documentação de tabelas e EFs existentes
- `/root/garment-glow-test/.planning/codebase/ARCHITECTURE.md` — data fetching patterns

### Tertiary (LOW confidence — assumptions)
- A4 (RLS de sellers acessível) — inferido do padrão org_member mas não verificado diretamente

---

## Metadata

**Confidence breakdown:**
- ML API endpoints: HIGH — portado de produção Nexo MCP
- pg_cron auth pattern: HIGH — verificado em migrations existentes deste projeto
- Table schemas: HIGH (estrutura) / MEDIUM (todos os campos necessários)
- TVModeVendas seller loading: HIGH — padrão SellerContext + HeaderScopeContext verificado
- Mock removal: HIGH — arquivos inspecionados linha a linha
- Feedback availability (D-07): LOW — depende do ML não ter bloqueado o endpoint para esta conta

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (stable — APIs ML em produção)
