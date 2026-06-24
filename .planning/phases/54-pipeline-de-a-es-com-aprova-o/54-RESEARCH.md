# Phase 54: Pipeline de Ações com Aprovação — Research

**Researched:** 2026-06-24
**Domain:** Executor de mutações no Mercado Livre com fila de aprovação, gate atômico, anti-IDOR, pre-flight de proposta obsoleta e audit log imutável — camada ACT do Consultor v2.
**Confidence:** HIGH (arquitetura e schema confirmados em prod via Phase 52; padrão de mutação ML confirmado por inspeção direta de `reply-ml-question` e do Nexo MCP em produção)

---

## User Constraints (de REQUIREMENTS.md + ROADMAP.md)

### Decisões fixadas (LOCKED — não pesquisar alternativas)
- **Ação em 1 clique = PREPARAR para aprovação, NUNCA auto-executa.** Regra de plataforma, sem exceção. Toda mutação no ML passa pela fila do owner.
- **Notificação de nova proposta = só na UI** (fila + badge de contagem). Telegram fica para v2 (NOTF-01, deferido).
- **Diff na proposta (atual → proposto + impacto R$/margem) entra já no v8** — é diferencial obrigatório.
- **LLM recebe SÓ saída estruturada do v1** — não recalcula números. Para ACT: o diff/impacto da proposta vem do insight do v1, **não é recalculado** (decisão do briefing).
- **Gate atômico** `UPDATE ... WHERE status='approved' RETURNING *` é o único padrão de transição aceito.
- **Ações e token escopados a `organization_id` + `ml_user_id`** (anti-IDOR, anti-leak).
- **Role**: aprovar/rejeitar/executar é restrito a `owner` (RoleRoute / `get_org_role`). INSERT da proposta por qualquer membro da org.

### Discrição do Claude
- Onde plugar a UI da fila: página `/consultor` existente (aba "Fila"/"Histórico") vs. nova rota `/acoes`. Recomendação abaixo: aba no `/consultor`.
- Nomes exatos dos componentes/hooks (seguindo convenção do projeto).
- Forma do `proposed_value`/`current_value` jsonb por `action_type`.
- TTL exato da proposta (research sugere 48h para `approved` não executado; 24h para badge de "impacto pode ter mudado").

### Out of Scope (IGNORAR)
- Auto-execução sem fila de aprovação.
- Notificação Telegram da proposta (deferida v2 — NOTF-01).
- "Reverter" como `action_type` (mencionado só como runbook de incidente, não é requisito).
- Novos pacotes npm — zero dependências novas em todo o v8.0.

---

## Phase Requirements

| ID | Descrição | Suporte da pesquisa |
|----|-----------|---------------------|
| ACT-01 | "Propor ação" com preview de diff (atual→proposto + impacto R$) antes de enviar | `dry_run=true` na EF computa payload sem executar e grava `dry_run_preview`; diff/impacto vem do insight (não recalcula). `current_value`/`proposed_value` jsonb. |
| ACT-02 | Fila de aprovação visível com badge de contagem de pendentes | `useConsultorActions` lê `proposed_actions WHERE status IN ('proposed','approved')`; badge = `.length`. Componente `ActionQueue`. |
| ACT-03 | Owner aprova ou rejeita | RLS UPDATE owner-only já move para `approved`/`rejected` (Phase 52). Mutação no hook. |
| ACT-04 | Ação aprovada executa no ML (preço/anúncio/ads) via executor — nunca sem aprovação | EF `consultor-actions` (NOVA) inline ML write por `action_type`. 5 tipos. |
| ACT-05 | Toda transição em audit log imutável (ator, de→para, ts, resposta ML) | INSERT em `action_audit_log` (service_role) por transição; `detail` jsonb com resposta ML ≤4KB. |
| ACT-06 | Anti-duplicação (gate atômico) + anti-IDOR (escopo org+ml_user_id) | RPC `claim_approved_action` (já em prod) + token lookup de 2 colunas. |
| ACT-07 | Proposta obsoleta bloqueada/sinalizada (pre-flight + TTL) | pre-flight re-lê estado ML via `ml-precos-custos`/`ml-inventory`; TTL 48h; badge de staleness. |
| ACT-08 | Owner vê histórico de ações executadas com resultado | Aba "Histórico": `status IN ('done','failed')` + `action_audit_log`. Paginar com `.range()`. |

---

## Summary

A Phase 52 **já entregou em produção** (verificado 6/6 SC, `ckcdevcxgvueywivefgx`) o esqueleto de dados que esta fase consome: as tabelas `proposed_actions` (6 estados, dedup parcial, RLS org-first com owner-only para `approved`/`rejected`), `action_audit_log` (append-only por ausência de GRANT) e a RPC atômica `claim_approved_action(uuid)` (SECURITY INVOKER, EXECUTE só para service_role). Os types TypeScript dessas tabelas já estão em `src/integrations/supabase/types.ts`. **A Phase 54 não cria schema novo** — ela escreve o **executor** (EF `consultor-actions`), os **hooks** (`useConsultorActions`) e a **UI da fila** (`ActionQueue` + botão "Propor ação" nos cards de insight).

O ponto crítico de implementação é o **executor**, que ainda não existe. O projeto **nunca mutou o ML** até hoje exceto por `reply-ml-question` (POST /answers). Não há nenhum PUT/PATCH de preço, status de anúncio ou campanha de ads no `garment-glow-test`. **O executor precisa criar essas chamadas do zero**, portando o padrão validado em produção do **Nexo MCP** (`/root/nexo-mcp/ml_client.py`), que já roda mutações reais de preço, status e ads. `reply-ml-question` (`supabase/functions/reply-ml-question/index.ts`) é o molde de segurança a copiar verbatim: validação de JWT → zod → lookup de token por `ml_user_id` → checagem de org (`is_org_member`) com **fail-closed** → chamada ML inline → nunca logar/retornar o `access_token`.

**Primary recommendation:** Escreva uma única EF `consultor-actions` (verify_jwt=true) que faz, nesta ordem por requisição de execução: (1) valida JWT + verifica `owner` via `get_org_role`; (2) `dry_run=true` → computa payload e grava `dry_run_preview`, retorna sem tocar o ML; (3) `dry_run=false` → `claim_approved_action(id)` (0 linhas = aborta 409); (4) pre-flight: re-lê estado atual do ML, compara com `current_value`, se divergiu marca `failed`+audit `no_op`/`conflict`; (5) refresca o token da org dona e aplica o write inline (PUT/PATCH conforme `action_type`, padrão Nexo MCP); (6) grava `action_audit_log` (de→para, resposta ML trimada ≤4KB) e seta `done`/`failed`. Token e ação **sempre** escopados a `organization_id` + `ml_user_id` (anti-IDOR ACT-06).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Criar proposta a partir do insight | Frontend (React hook) → Supabase RLS | — | INSERT direto em `proposed_actions` via cliente authenticated; RLS força `status='proposed'` + `proposed_by=auth.uid()`. Não precisa EF. |
| Preview de diff (dry_run) | API/Backend (EF `consultor-actions`) | Frontend | Cálculo do payload ML é server-side (`dry_run_preview`); a UI só renderiza. |
| Aprovar/Rejeitar | Frontend → Supabase RLS | — | UPDATE owner-only (Phase 52 RLS WITH CHECK limita a `approved`/`rejected`). |
| Gate atômico + execução ML | API/Backend (EF `consultor-actions`, service_role) | — | Único lugar que pode mover para `executing`/`done`/`failed`; chama ML API; escreve audit. RLS bloqueia esses estados para authenticated. |
| Pre-flight (estado obsoleto) | API/Backend (EF) | — | Re-leitura do ML é credencial-sensível; nunca no browser. |
| Token ML por org | API/Backend (EF, service_role) | — | `ml_tokens.access_token` nunca sai do servidor (T-42-04). |
| Fila + badge + histórico | Frontend (TanStack Query) | Database (RLS SELECT) | Leitura org-scoped via `is_org_member`. |
| Audit log imutável | Database (RLS append-only) + EF write (service_role) | — | Imutabilidade = ausência de GRANT de UPDATE/DELETE (Phase 52). |

---

## Mutação ML (endpoints por action_type)

### Estado atual do codebase: **não existe mutação ML de preço/anúncio/ads**

Grep em `supabase/functions/` por mutações: o **único** write na API ML hoje é `reply-ml-question` (`POST /answers`). Não há nenhum PUT/PATCH para `/items/{id}` (preço/status) nem para `/advertising/...` (campanhas). `ml-precos-custos`, `ml-ads`, `ml-inventory` são **read-only** (GET). [VERIFIED: grep `supabase/functions/`]

**Conclusão:** o executor desta fase **cria as 5 mutações do zero**. Não há precedente local de payload de write além do POST de `reply-ml-question`. A referência de payloads é o **Nexo MCP** (produção, validado).

### Endpoints por `action_type` (portados do Nexo MCP `ml_client.py`)

A tabela `proposed_actions` já restringe `action_type` aos 5 valores via CHECK (Phase 52). Base ML: `https://api.mercadolibre.com`.

| `action_type` | Método + endpoint | Body | Fonte (Nexo MCP) |
|---------------|-------------------|------|------------------|
| `update_price` | `PUT /items/{item_id}` (ou `PUT /items/{item_id}/variations/{variation_id}` se variação) | `{ "price": <number> }` | `update_price()` `ml_client.py:1676-1709` [VERIFIED] |
| `pause_listing` | `PUT /items/{item_id}` | `{ "status": "paused" }` | `set_listing_status()` `ml_client.py:1958-1972` [VERIFIED] |
| `activate_listing` | `PUT /items/{item_id}` | `{ "status": "active" }` | mesmo `set_listing_status()` `ml_client.py:1958` [VERIFIED] |
| `pause_ads_campaign` | `PUT /advertising/product_ads/campaigns/{campaign_id}` com header `api-version: 2` + query `advertiser_id=<id>` | `{ "status": "paused" }` | `update_campaign_ml()` `ml_client.py:2451-2466` + `_adv_request()` `ml_client.py:2406-2434` [VERIFIED] |
| `update_ads_budget` | `PUT /advertising/product_ads/campaigns/{campaign_id}` com header `api-version: 2` + query `advertiser_id=<id>` | `{ "budget": <number> }` | `update_campaign_ml()` `ml_client.py:2451` (payload aceita `{name,budget,status,acos_target,strategy}`) [VERIFIED] |

> ⚠️ **Correção sobre ARCHITECTURE.md (research do milestone):** `ARCHITECTURE.md:501-520` sugere `PATCH /pads/campaigns/{id}` para ads e `PATCH /items/{id}` para preço. **Isso está desatualizado.** O padrão **validado em produção** (Nexo MCP) é:
> - **Preço/status de anúncio:** `PUT /items/{id}` (não PATCH) — `[VERIFIED: ml_client.py:1690,1961]`
> - **Ads:** a API nova de Product Ads é `PUT /advertising/product_ads/campaigns/{campaign_id}` com header `api-version: 2` e query `advertiser_id`, **não** `/pads/campaigns/`. `[VERIFIED: ml_client.py:2460, BASE_ADV:2383]`
>
> Use o padrão do Nexo MCP. A planner deve gravar isto como decisão e a EF deve refletir os endpoints acima.

### Detalhes que o executor precisa replicar do Nexo MCP

1. **Ads exige resolver `advertiser_id` antes do write.** `_resolve_advertiser(token)` faz `GET /advertising/advertisers?product_id=PADS` e pega `advertisers[0].advertiser_id` + `site_id`. Sem ele, o PUT de campanha falha. `[VERIFIED: ml_client.py:2386-2401]`
2. **Header `api-version: 2`** é obrigatório nos endpoints de Product Ads novos. `[VERIFIED: ml_client.py:2407]`
3. **Retry/backoff:** Nexo MCP retenta 3× em 429 (respeita `Retry-After`) e em 5xx (backoff `[2,8]s`). PUT é idempotente → retry seguro. `[VERIFIED: ml_client.py:91-116 `_ml_put`, :2406-2434 `_adv_request`]`
4. **Trim de erro:** retornos de erro do Nexo MCP usam `r.text[:500]`. Para o `action_audit_log.detail`, o executor deve cappar a resposta ML completa a **≤4KB** (decisão Phase 52: cap é responsabilidade do executor, não CHECK no schema). `[VERIFIED: ml_client.py:1701; PITFALLS.md:124]`
5. **`target_ref`** guarda o `item_id` (preço/anúncio) ou `campaign_id` (ads). `proposed_value` jsonb guarda `{price}` / `{status}` / `{budget}`. `current_value` jsonb guarda o valor lido na criação da proposta (para diff e pre-flight). `[CITED: ARCHITECTURE.md:103-114]`

### Molde de segurança/HTTP (copiar de `reply-ml-question`)

`reply-ml-question/index.ts` é o padrão verbatim para a EF nova — inline ML call, sem EF-to-EF:
- `corsHeaders` + `jsonResponse()` helpers `[reply-ml-question:24-35]`
- JWT: `Bearer` → `supabase.auth.getUser(token)` → 401 `[:50-61]`
- zod `BodySchema.safeParse` → 400 `[:38-75]`
- token lookup: `.from("ml_tokens").select("access_token, organization_id").eq("ml_user_id", ...).maybeSingle()` `[:78-88]`
- **fail-closed**: `if (!tokenRow.organization_id) return 403` antes do write irreversível `[:94-96]`
- `is_org_member` RPC → 403 `[:97-101]`
- `fetch(ML_API + path, { headers: { Authorization: "Bearer " + access_token } })` — **nunca logar o token** `[:104-113]`
- forward de erro ML sanitizado (`mlBody?.message ?? mlBody?.cause`), status 502 em 5xx `[:115-124]`

---

## Token por org (anti-IDOR ACT-06)

### Lookup de 2 colunas (obrigatório)

O executor obtém o token da **org dona da ação**, escopado por **org + ml_user_id**:

```ts
const { data: tokenRow } = await supabase
  .from("ml_tokens")
  .select("access_token, organization_id, expires_at, refresh_token")
  .eq("ml_user_id", action.ml_user_id)        // loja ML da ação
  .eq("organization_id", action.organization_id) // org dona — anti-IDOR
  .not("access_token", "is", null)
  .maybeSingle();
```

> **Anti-IDOR (PITFALLS.md Pitfall 5, :287):** buscar o token só por `ml_user_id` é o bug. Org B chamando com `action_id` de Org A não pode acabar escrevendo no ML de Org A. O fetch da ação **e** o fetch do token precisam casar `organization_id = caller_org_id`. A ação já está atrelada à org via `proposed_actions.organization_id`; o caller é resolvido do JWT → `get_org_role`/`is_org_member`. `[CITED: PITFALLS.md:94-111, :287]`

### Refresh do token antes do write

`ml_tokens` tem `access_token`, `refresh_token`, `expires_at`. O cron `ml-token-refresh` (verify_jwt=false) renova tokens expirando em <30min via `POST https://api.mercadolibre.com/oauth/token` com `grant_type=refresh_token`, `client_id=ML_APP_ID`, `client_secret=ML_CLIENT_SECRET`. `[VERIFIED: ml-token-refresh/index.ts:33-92]`

**Para o executor:** antes do write, checar `expires_at`; se expirado/perto, fazer o refresh inline (mesmo payload do `ml-token-refresh`) e atualizar `ml_tokens`, OU tratar um 401 do ML refrescando e retentando 1×. O padrão Nexo MCP retenta em 401 com refresh. `ML_APP_ID`/`ML_CLIENT_SECRET` já estão no env das EFs (Pattern B do vault). `[VERIFIED: ml-token-refresh:16-19, :62-71]`

---

## Executor EF (`consultor-actions`) — fluxo

EF **nova**: `supabase/functions/consultor-actions/index.ts`. Config: `verify_jwt = true` em `config.toml` (igual `reply-ml-question`, que é user-invoked). `[VERIFIED: config.toml:4]`

Auth dupla + owner: valida JWT → resolve user → verifica `get_org_role` = `owner` para a org da ação (aprovar/executar é owner-only). `[CITED: ARCHITECTURE.md:540]`

**Fluxo de execução (`dry_run=false`):**

1. **JWT + owner check** — 401 se sem JWT; 403 se não for `owner` da `action.organization_id`.
2. **Fetch da ação escopada** — `proposed_actions WHERE id=$1 AND organization_id=$caller_org`. 404/403 se não casar (anti-IDOR).
3. **TTL/staleness** — se `status='approved'` e `approved_at` > 48h, marcar `failed` (`result_summary='expired'`) + audit; não executar. `[CITED: PITFALLS.md:83]`
4. **Gate atômico** — `supabase.rpc("claim_approved_action", { p_action_id })`. **0 linhas = já reivindicada → 409 Conflict, abortar antes de tocar o ML.** A RPC já existe e é service_role-only (Phase 52). `[VERIFIED: 52-VERIFICATION.md SC-5; ARCHITECTURE.md:545-555]`
5. **Pre-flight (ACT-07)** — re-ler estado atual do ML:
   - preço/anúncio: `GET /items/{target_ref}` (ou `/items/{id}/prices`, como `ml-precos-custos` faz `[ml-precos-custos:142]`).
   - ads: `GET /advertising/advertisers/{adv}/product_ads/campaigns` (como `ml-ads`/`fetch_campaigns` `[ml_client.py:1198]`).
   - Comparar com `current_value`. Se o estado **já está no alvo** (preço já é o proposto, anúncio já paused) → `no_op`, marcar `done` com `result_summary='no_op'` + audit, **sem** chamar o write. Se mudou para algo **inesperado** (preço diferente setado externamente) → `failed`/`conflict` + audit, exigir re-aprovação. `[CITED: PITFALLS.md:83-90]`
6. **Token da org** — lookup de 2 colunas + refresh inline se preciso (acima).
7. **Write ML inline** — PUT/PUT-ads conforme `action_type` (tabela acima), com retry 429/5xx + `api-version: 2` para ads.
8. **Audit + estado final** — INSERT `action_audit_log` (`from_status='executing'`, `to_status='done'|'failed'`, `actor_id`, `detail` = `{ml_status, ml_body_trimmed_4kb, state_before}`). UPDATE `proposed_actions` set `status`, `executed_at=now()`, `result_summary`. Service_role → RLS bypass na escrita; imutabilidade do audit garantida por ausência de policy de UPDATE/DELETE. `[CITED: PITFALLS.md:118-132; 52-PLAN Task 1]`

**Fluxo `dry_run=true` (ACT-01, preview):** após auth+owner, computa o payload ML (mesma lógica do switch) **sem** chamar o ML, grava em `proposed_actions.dry_run_preview` e retorna `{ current, proposed, payload, estimated_impact_brl }`. Não usa o gate atômico nem pre-flight. `[CITED: ARCHITECTURE.md:313, :457]`

**Switch por action_type** (esqueleto; endpoints corrigidos pelo Nexo MCP):

```ts
switch (action.action_type) {
  case "update_price":       // PUT /items/{target_ref}  body { price }
  case "pause_listing":      // PUT /items/{target_ref}  body { status: "paused" }
  case "activate_listing":   // PUT /items/{target_ref}  body { status: "active" }
  case "pause_ads_campaign": // resolve advertiser → PUT /advertising/product_ads/campaigns/{target_ref}?advertiser_id=.. (api-version:2) body { status: "paused" }
  case "update_ads_budget":  // idem ads, body { budget }
}
```

**Anti-pattern (NÃO fazer):** EF-to-EF para executar. Inline as chamadas ML como `reply-ml-question`. `[CITED: ARCHITECTURE.md:469, :574]`

---

## Criação da proposta (ACT-01 — diff/impacto do insight)

**INSERT direto pelo frontend** (não precisa EF), via cliente authenticated. RLS da Phase 52 força `status='proposed'` + `proposed_by=auth.uid()` + `is_org_member`. `[VERIFIED: 52-PLAN:123]`

Montagem da row a partir do insight (`insights` já tem `rule_key`, `severity`, `impact_brl`, `action_href`, `ml_user_id`, `item_id` embutido no `action_href` como `?items=`):

| Campo `proposed_actions` | Origem |
|---|---|
| `rule_key` | `insight.rule_key` (ex: `margin_critical`, `ads_eating_margin`, `ads_no_sale`, `tacos_high`) |
| `action_type` | Mapeado do `rule_key` → tipo de ação sugerida (ver mapa abaixo) |
| `target_ref` | `item_id`/`campaign_id` extraído do insight (`action_href` carrega `?items=<id>`) |
| `current_value` | Valor atual lido do ML/cache no momento da criação (preço atual, status atual) |
| `proposed_value` | Valor proposto (preço novo, `paused`, etc.) |
| `estimated_impact_brl` | **`insight.impact_brl` do v1 — NÃO recalcular** (decisão do briefing). `[CITED: REQUIREMENTS.md:19]` |
| `ml_user_id` | `insight.ml_user_id` (loja afetada — STORE-05) |
| `insight_id` | `insight.id` (FK, ON DELETE SET NULL) |
| `proposed_by` | `auth.uid()` |

**Mapa rule_key → action_type (a finalizar no planejamento com Wesley):**
- `margin_critical` / `margin_alert` → `update_price` (subir preço para recompor margem).
- `ads_eating_margin` / `tacos_high` → `pause_ads_campaign` ou `update_ads_budget`.
- `ads_no_sale` → `pause_ads_campaign` (campanha sem venda).
- Anúncio inativo/sem giro → `pause_listing` / `activate_listing`.

> O `proposed_value` (ex: quanto subir o preço) é uma **decisão de produto** — não está nos insights hoje. Open Question abaixo. O insight dá o `item_id` e o `impact_brl`, não o "preço alvo". A UI de "Propor ação" precisa de um input para o owner definir o valor proposto (ou um default sugerido).

---

## UI da fila de aprovação

### Onde plugar

**Recomendação:** aba dentro de `/consultor` (`MLConsultor.tsx`), não rota nova. Razões: o card `ConsultorCard` já linka para `/consultor` ("Ver todos"); os insights acionáveis vivem ali; evita churn de roteamento. `[VERIFIED: ConsultorCard.tsx:180; App.tsx:141]`

Estrutura: `MLConsultor` ganha tabs shadcn — **Insights** (atual) | **Fila** (`status IN ('proposed','approved')`) | **Histórico** (`status IN ('done','failed')`). A Fila e o badge só aparecem para `owner` (RoleRoute já gateia a página; o badge usa `orgRole === 'owner'`). `[VERIFIED: OrganizationContext.tsx:5 OrgRole, :156 orgRole]`

### Componentes (shadcn — zero deps novas)

| Componente | Papel | Primitivos |
|---|---|---|
| `ActionQueue` | Lista de pendentes/aprovadas; aprovar/rejeitar; diff preview; badge de staleness | `Card`, `Badge`, `Button`, `Tabs`, `AlertDialog` (confirmar execução irreversível) |
| `ProposeActionDialog` | Modal "Propor ação": input do `proposed_value` + diff via `dry_run` + impacto R$ | `Dialog`, `Input`, `Label`, `Button` |
| `ActionHistory` | Histórico `done`/`failed` com resultado por ação (ACT-08) | `Table`, `Badge`; **paginar com `.range()`** |
| Botão "Propor ação" | Nos cards de insight acionável (`ConsultorCard`/`MLConsultor` insight item) | `Button` |

### Hook `useConsultorActions` (espelha `useConsultorInsights`)

`src/hooks/useConsultorActions.ts`, padrão TanStack Query v5 (`useQuery`/`useMutation`/`useQueryClient`), org-scoped por `useOrganization().currentOrg.id`. `[VERIFIED: useConsultorInsights.ts:1-3, :60-63]`

- `queryFn`: `proposed_actions WHERE organization_id=orgId AND status IN ('proposed','approved')` ordenado por `created_at desc`.
- `pendingCount` derivado para o badge (ACT-02).
- `propose(insight, proposed_value)` — INSERT (authenticated, RLS força `proposed`).
- `dryRun(action_id)` — `supabase.functions.invoke("consultor-actions", { body: { action_id, dry_run: true } })`.
- `approve(id)` — UPDATE `status='approved', approved_by=auth.uid(), approved_at=now()` (RLS owner-only) **e então** invoke `consultor-actions` `{ action_id, dry_run:false }`.
- `reject(id)` — UPDATE `status='rejected'`.
- `historyQuery` — `status IN ('done','failed')`, paginado com `.range()`.
- `onSuccess` → `invalidateQueries(["consultor_actions", orgId])`.

### RLS (já em prod — Phase 52)
- **INSERT**: any member, `WITH CHECK (is_org_member AND proposed_by=auth.uid() AND status='proposed')`.
- **UPDATE**: owner-only, `WITH CHECK (get_org_role='owner' AND status IN ('approved','rejected'))` — nunca `executing`/`done`/`failed`.
- **SELECT**: `is_org_member`.
- `executing`/`done`/`failed` só via service_role (executor). `[VERIFIED: 52-PLAN:123, 52-VERIFICATION SC-2/SC-4]`

---

## Don't Hand-Roll

| Problema | Não construir | Usar | Por quê |
|---|---|---|---|
| Transição atômica de estado | SELECT-then-UPDATE; lock manual | RPC `claim_approved_action` (já em prod) | TOCTOU; a RPC é o único padrão seguro (`UPDATE ... WHERE status='approved' RETURNING *`) |
| Refresh de token ML | Fluxo OAuth novo | Payload de `ml-token-refresh` (inline) | Já validado; `ML_APP_ID`/`SECRET` no env |
| Chamada HTTP ML com retry | `fetch` solto | Padrão `_ml_put`/`_adv_request` do Nexo MCP (429/5xx backoff, api-version) | Rate limit ML + idempotência |
| Imutabilidade do audit | Trigger de bloqueio | Ausência de GRANT UPDATE/DELETE (Phase 52) | Padrão do projeto; default-deny |
| Auth/owner check | Novo middleware | `reply-ml-question` + `get_org_role`/`is_org_member` | Precedente fail-closed verificado |
| Resposta ML grande no audit | CHECK no schema | Trim ≤4KB no executor | CHECK rígido faria o INSERT de auditoria falhar (Phase 52 Q4) |

**Key insight:** a Phase 52 já desenhou o schema para ser à prova de IDOR/TOCTOU/repudiation. A Phase 54 não deve recriar nada disso — só **consumir** corretamente (gate via RPC, escopo de 2 colunas, escrita service_role no audit).

---

## Common Pitfalls

### Pitfall 1: Execução dupla (TOCTOU)
**O que dá errado:** owner clica "aprovar"/"executar" 2× ou 2 abas disparam o executor → ML recebe o write 2×.
**Como evitar:** o **primeiro** statement do executor após auth é `claim_approved_action(id)`. 0 linhas → 409, aborta. Nunca SELECT-then-UPDATE. `[CITED: PITFALLS.md:59-67]`
**Sinais:** duas linhas `executing` no audit para o mesmo `action_id`.

### Pitfall 2: IDOR (token de outra org)
**O que dá errado:** fetch do token só por `ml_user_id` → Org B executa no ML de Org A.
**Como evitar:** ação E token com `organization_id = caller_org`. Teste do verifier: Org B chama com `action_id` de Org A → **403**. `[CITED: PITFALLS.md:94-111, :287]`

### Pitfall 3: Proposta obsoleta
**O que dá errado:** preço já foi mudado externamente; executar de novo aplica valor errado/redundante.
**Como evitar:** pre-flight re-lê o ML e compara com `current_value`; `no_op` se já no alvo, `conflict`/`failed` se divergente; TTL de 48h para `approved` não executado. `[CITED: PITFALLS.md:83-90]`
**Sinais:** owner aprova com impacto R$ estimado de >24h atrás → badge "impacto pode ter mudado".

### Pitfall 4: Resposta ML grande estoura o audit
**O que dá errado:** resposta de erro ML extensa em `action_audit_log.detail`.
**Como evitar:** trim do corpo ML a ≤4KB no executor antes do INSERT. `[CITED: PITFALLS.md:124; 52-PLAN threat T-52-07]`

### Pitfall 5: Endpoint de ads errado (desatualizado no research)
**O que dá errado:** seguir `ARCHITECTURE.md:507-512` (`PATCH /pads/campaigns/{id}`) → 404/erro.
**Como evitar:** usar `PUT /advertising/product_ads/campaigns/{campaign_id}` + `api-version:2` + `advertiser_id` (Nexo MCP). Resolver `advertiser_id` antes. `[VERIFIED: ml_client.py:2460, :2386]`

### Pitfall 6: Rate limit ML (429)
**O que dá errado:** write sem retry → falha intermitente marcada como `failed` definitivo.
**Como evitar:** retry com `Retry-After` em 429 e backoff em 5xx (padrão `_ml_put`). PUT é idempotente. `[VERIFIED: ml_client.py:91-116]`

### Pitfall 7: Estados de execução vazando para o cliente
**O que dá errado:** tentar setar `executing`/`done` via cliente authenticated.
**Como evitar:** RLS já bloqueia (owner só move para `approved`/`rejected`). Esses estados **só** pelo executor service_role. `[VERIFIED: 52-VERIFICATION SC-2]`

---

## State of the Art

| Abordagem antiga (research milestone) | Abordagem corrigida (codebase real) | Impacto |
|---|---|---|
| `PATCH /items/{id}` para preço (`ARCHITECTURE.md:503`) | `PUT /items/{id}` body `{price}` | ML usa PUT; Nexo MCP confirma |
| `PATCH /pads/campaigns/{id}` para ads (`ARCHITECTURE.md:508`) | `PUT /advertising/product_ads/campaigns/{id}` + `api-version:2` + `advertiser_id` | API de Product Ads nova; resolver advertiser antes |
| `executed_by`/`ml_api_response`/`state_before` como colunas (`PITFALLS.md:124`) | Phase 52 consolidou em `result_summary` + `action_audit_log.detail` jsonb + `approved_by`/`executed_at` | Schema já fechado; usar o que existe, não adicionar colunas |

---

## Assumptions Log

| # | Claim | Seção | Risco se errado |
|---|-------|-------|-----------------|
| A1 | `update_ads_budget` usa campo `budget` no PUT da campanha | Mutação ML | Nexo MCP doc diz payload aceita `{name,budget,status,acos_target,strategy}`; o nome exato do campo de orçamento na API ML deve ser confirmado no planejamento (pode ser `budget` ou `daily_budget`). `[ASSUMED]` |
| A2 | `proposed_value` precisa de input do owner (insight não traz "preço alvo") | Criação da proposta | Se o motor v1 vier a gerar o valor proposto, a UI muda; hoje o insight só dá `item_id`+`impact_brl`. `[ASSUMED]` |
| A3 | TTL de 48h para `approved` não executado | Executor | Valor sugerido pelo research; Wesley pode querer outro. `[ASSUMED]` |
| A4 | Mapa rule_key→action_type (margin→update_price, etc.) | Criação da proposta | Mapeamento de produto; confirmar com Wesley quais regras viram quais ações. `[ASSUMED]` |
| A5 | Pre-flight de ads compara status de campanha (não há cache local de campanha por target_ref) | Executor | Pode exigir GET extra por campanha; confirmar custo/latência. `[ASSUMED]` |

---

## Open Questions

1. **`proposed_value` de preço:** quem define o preço alvo? Input manual do owner no modal vs. sugestão automática (margem alvo do `consultor_config`)? Recomendação: input manual com default = preço que recompõe a margem alvo.
2. **Nome do campo de orçamento de ads na API ML** (`budget` vs `daily_budget`) — verificar contra ML docs/Nexo MCP no planejamento (A1).
3. **Pre-flight de ads:** `target_ref` para ads é `campaign_id`; o pre-flight precisa de `GET` da campanha (resolver advertiser + listar). Confirmar se vale a pena vs. só TTL.
4. **`no_op` como estado vs. resultado:** o CHECK de `status` tem 6 estados fixos (sem `no_op`). Decisão: `no_op` vira `done` com `result_summary='no_op'` (não novo estado). Confirmado pelo schema da Phase 52.

---

## Environment Availability

| Dependência | Requerida por | Disponível | Versão | Fallback |
|---|---|---|---|---|
| Tabelas `proposed_actions`/`action_audit_log` | Toda a fase | ✓ (Phase 52, prod) | — | — |
| RPC `claim_approved_action` | Gate atômico ACT-06 | ✓ (Phase 52, prod) | — | — |
| Types TS das tabelas | Hooks/UI | ✓ (`types.ts:17,1652`) | — | — |
| EF `consultor-actions` | ACT-04/dry_run | ✗ (criar nesta fase) | — | sem fallback — é o core da fase |
| `ML_APP_ID`/`ML_CLIENT_SECRET` env | Refresh de token | ✓ (`ml-token-refresh`) | — | — |
| Padrão de mutação ML (Nexo MCP) | Endpoints/payloads | ✓ (`/root/nexo-mcp/ml_client.py`, prod) | — | — |
| Acesso MCP Supabase p/ deploy de EF | Deploy `consultor-actions` | ⚠️ só orquestrador | — | gsd-executor escreve; orquestrador faz deploy (igual Phase 52) |

**Bloqueante:** deploy da EF exige MCP Supabase (orquestrador), pois `gsd-executor` não tem deploy. CLI local linkado no projeto errado (`gionpsuunfkkzzjdubfy`) — **nunca** `supabase functions deploy` via CLI; usar MCP em `ckcdevcxgvueywivefgx`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + @testing-library/react 16 + jsdom |
| Config file | `vite.config.ts` (vitest config inline) / `package.json` |
| Quick run | `npm run test -- src/hooks/useConsultorActions.test.ts` |
| Full suite | `npm run test` + `npm run build` (`tsc --noEmit`) |

### Phase Requirements → Test Map
| Req | Behavior | Type | Comando | Existe? |
|---|---|---|---|---|
| ACT-06 (gate) | 2ª chamada de execução do mesmo id retorna 409 | integration (EF) | execute_sql: 2× `claim_approved_action` → 1 linha/0 linhas | ❌ Wave de verifier |
| ACT-06 (IDOR) | Org B com action de Org A → 403 | security (EF) | invoke EF com JWT de outra org | ❌ Wave de verifier |
| ACT-07 (pre-flight) | proposta com `current_value` divergente → `failed`/`conflict` | integration | seed ação + estado ML mockado | ❌ Wave de verifier |
| ACT-05 (audit) | toda transição grava `action_audit_log` (de→para) | integration | execute_sql contar linhas de audit | ❌ Wave de verifier |
| ACT-02 (badge) | `pendingCount` reflete `proposed`+`approved` | unit (hook) | vitest mock supabase | ❌ Wave 0 |

### Sampling Rate
- **Por commit:** `npm run test -- <arquivo do hook>` + `tsc --noEmit`.
- **Por wave:** `npm run test` + `npm run build`.
- **Phase gate:** verifier de segurança (IDOR 403 + gate 409 + audit populado) green antes de `/gsd-verify-work`. EFs verificadas via MCP `execute_sql`/`invoke` em `ckcdevcxgvueywivefgx` (executor não tem MCP).

### Wave 0 Gaps
- [ ] `src/hooks/useConsultorActions.ts` — não existe; criar.
- [ ] `supabase/functions/consultor-actions/index.ts` — não existe; criar (verify_jwt=true no config.toml).
- [ ] Teste unit do hook (`pendingCount`, propose/approve mutations).
- [ ] Verifier de segurança (IDOR/gate/pre-flight/audit) via MCP — orquestrador.

---

## Security Domain

### Applicable ASVS Categories
| ASVS | Applies | Standard Control |
|---|---|---|
| V4 Access Control (IDOR) | **yes** | Escopo de 2 colunas `organization_id+ml_user_id` no fetch de ação e token; owner-only via `get_org_role`; RLS org-first |
| V5 Input Validation | yes | zod no body da EF (`action_id` uuid, `dry_run` bool); CHECK de `action_type` no schema |
| V7 Error/Logging (audit) | yes | `action_audit_log` append-only (imutável por ausência de GRANT); `actor_id`, de→para, ts |
| V6 Cryptography/Secrets | yes | `access_token` nunca logado/retornado (T-42-04); secret no env (Pattern B) |
| V2 Authentication | yes | JWT do usuário (`getUser`); token ML via refresh OAuth |

### Known Threat Patterns
| Pattern | STRIDE | Mitigação |
|---|---|---|
| Execução dupla (TOCTOU) | Tampering | Gate atômico `claim_approved_action` (0 linhas = abort) |
| Cross-org execute (IDOR) | Elevation | Fetch ação+token escopado a `organization_id` do caller → 403 |
| Forja de estado de execução | Tampering | RLS WITH CHECK limita authenticated a `approved`/`rejected`; `executing`/`done`/`failed` só service_role |
| Proposta obsoleta executada | Tampering | Pre-flight re-lê ML + TTL 48h |
| Repúdio de quem aprovou/executou | Repudiation | `approved_by`/`executed_at` + audit log imutável |
| Vazamento de token | Info Disclosure | nunca logar/retornar `access_token` |

---

## Sources

### Primary (HIGH)
- `supabase/functions/reply-ml-question/index.ts` — molde de write ML (auth fail-closed, token lookup, inline call, sanitização)
- `supabase/functions/ml-token-refresh/index.ts` — refresh OAuth (grant_type, env)
- `supabase/functions/ml-precos-custos/index.ts` — leitura de preço/itens (pre-flight)
- `/root/nexo-mcp/ml_client.py` — mutações ML validadas em prod (update_price :1676, set_listing_status :1958, update_campaign_ml :2451, _adv_request/_resolve_advertiser :2386-2434, _ml_put retry :91)
- `.planning/phases/52-funda-o-de-dados-v8-0/52-01-PLAN.md` + `52-VERIFICATION.md` — schema/RPC já em prod
- `src/integrations/supabase/types.ts:1652,17` — types de `proposed_actions`/`action_audit_log`
- `src/hooks/useConsultorInsights.ts` + `src/components/mercadolivre/ConsultorCard.tsx` + `App.tsx:141` — padrão de hook/UI/rota
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — fluxo do executor, pitfalls

### Secondary (MEDIUM)
- `.planning/research/SUMMARY.md` — sequenciamento e riscos do milestone

### Tertiary (project memory)
- `feedback_supabase_security_invoker.md` — IDOR DEFINER+org param (precedente Pitfall 2)
- `feedback_postgrest_pagination.md` — `.range()` no histórico de ações

## Metadata
**Confidence breakdown:**
- Mutação ML (endpoints): HIGH — Nexo MCP em produção; corrige ARCHITECTURE.md desatualizado.
- Token/anti-IDOR: HIGH — `reply-ml-question` + `ml-token-refresh` verificados.
- Schema/gate: HIGH — Phase 52 verificada 6/6 em prod.
- UI/hooks: HIGH — padrão `useConsultorInsights` replicável.
- `proposed_value`/mapa de regras: MEDIUM — decisões de produto (Assumptions A2/A4).

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (estável; ML API de ads pode evoluir — revalidar endpoints de campanha)

## RESEARCH COMPLETE

- **O executor é o trabalho real:** o projeto nunca mutou preço/anúncio/ads no ML (só `reply-ml-question`). A EF `consultor-actions` cria as 5 mutações do zero, portando os endpoints **verificados** do Nexo MCP — `PUT /items/{id}` (preço/status) e `PUT /advertising/product_ads/campaigns/{id}` com `api-version:2`+`advertiser_id` (ads), **corrigindo** o `PATCH /pads/...` desatualizado do ARCHITECTURE.md.
- **Schema e gate já estão prontos em prod (Phase 52):** `proposed_actions`, `action_audit_log`, RPC atômica `claim_approved_action` e types TS. A fase consome — gate via RPC (0 linhas=abort), escopo de 2 colunas `org+ml_user_id` (anti-IDOR 403), pre-flight + TTL 48h, audit ≤4KB.
- **UI = aba na `/consultor` + `useConsultorActions`** (zero deps novas): propor (INSERT RLS `proposed`), `dry_run` para diff, aprovar/rejeitar (RLS owner-only), executar (invoke EF), Fila com badge de pendentes e Histórico paginado. Pontos a decidir com Wesley: `proposed_value` de preço (A2) e mapa rule_key→action_type (A4).
