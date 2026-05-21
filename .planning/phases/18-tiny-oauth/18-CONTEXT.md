# Phase 18: Tiny ERP OAuth Authorization Code Flow

**Created:** 2026-05-21
**Milestone:** v6.0 — Dashboard de Vendas — KPIs de Marca
**Status:** Planning

---

## Goal

Substituir o `client_credentials` implementado na Fase 17-02 pelo fluxo completo de **Authorization Code OAuth**, idêntico ao fluxo do Mercado Livre. Cada usuário conecta a própria conta Tiny ERP via redirect OAuth — sem necessidade de env vars globais `TINY_CLIENT_ID`/`TINY_CLIENT_SECRET` no sistema.

---

## Por que mudar de client_credentials para Authorization Code

| | client_credentials (17-02) | Authorization Code (18) |
|---|---|---|
| Escopo | Servidor → Servidor | Usuário delega acesso |
| Credenciais | Env vars globais (admin config) | Cada usuário conecta a própria conta |
| Multi-tenant | ❌ Uma conta Tiny para todos | ✅ Cada loja ML tem seu Tiny |
| Refresh token | ❌ Não existe | ✅ Renova automaticamente |
| UX | Botão sync (requer config admin) | "Conectar Tiny ERP" igual ao ML |

---

## Tiny ERP API v3 — OAuth2 Keycloak

```
Authorization URL: https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth
Token URL:        https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token

Params (get_auth_url):
  response_type=code
  client_id={TINY_APP_ID}
  redirect_uri={redirect_uri}
  state=tiny-{random}        ← distingue do callback ML
  scope=openid

Params (exchange_code POST):
  grant_type=authorization_code
  client_id={TINY_APP_ID}
  client_secret={TINY_APP_SECRET}
  code={code}
  redirect_uri={redirect_uri}

Params (refresh_token POST):
  grant_type=refresh_token
  client_id={TINY_APP_ID}
  client_secret={TINY_APP_SECRET}
  refresh_token={refresh_token}

Env vars necessárias:
  TINY_APP_ID       — client_id do app Tiny (env var da edge function)
  TINY_APP_SECRET   — client_secret do app Tiny (env var da edge function)
```

Nota: As env vars `TINY_APP_ID`/`TINY_APP_SECRET` são **credenciais do app** (registrado no portal Tiny), não da conta do usuário. São configuradas UMA vez pelo admin no Supabase Vault. O token de acesso individual de cada usuário fica em `ml_tokens`.

---

## Como distinguir callback ML vs Tiny

O ML OAuth atual usa PKCE mas **não usa `state`**. O Tiny OAuth usará `state=tiny-{randomHex}`.

Quando o usuário retorna de qualquer OAuth com `?code=...`:
- Se `?state=tiny-...` → é callback Tiny → `handleTinyOAuthCallback()`
- Se não tem `state` ou state sem prefixo `tiny-` → é callback ML → lógica atual

O `OAuthCodeRedirect` component já faz forward de `?code=` para `/integracoes`. Precisamos passar também o `state` no redirect.

---

## Estado atual (pós Fase 17-02)

```
ml_tokens:
  - tiny_access_token TEXT    ← adicionado em 17-02
  - tiny_expires_at BIGINT    ← adicionado em 17-02
  - (FALTA) tiny_refresh_token TEXT

sync-tiny-costs/index.ts:
  - getTinyToken() usa client_credentials
  - Sem refresh token real

Integrations.tsx:
  - TinyIntegrationSection: só tem botão "Sincronizar Custos"
  - Não tem fluxo de conexão OAuth
```

---

## Estado alvo (pós Fase 18)

```
ml_tokens:
  + tiny_refresh_token TEXT   ← nova coluna

supabase/functions/tiny-oauth/index.ts  ← NOVO (espelho de ml-oauth)
  actions: get_auth_url | exchange_code | refresh_token

supabase/functions/sync-tiny-costs/index.ts  ← ATUALIZADO
  getTinyToken() usa tiny_refresh_token para renovar (não mais client_credentials)

src/components/auth/OAuthCodeRedirect.tsx  ← ATUALIZADO
  Passa state= no redirect para /integracoes

src/pages/Integrations.tsx  ← ATUALIZADO
  TinyIntegrationSection: botão "Conectar Tiny ERP" (igual ao ML)
  handleTinyOAuthCallback() detectado via state=tiny-...
  Status: conectado/desconectado baseado em tiny_access_token
```

---

## Supabase Project
- ID: `ckcdevcxgvueywivefgx`

## Stack
- Edge functions: Deno — `https://deno.land/std@0.168.0/http/server.ts`
- Frontend: React 18 + TypeScript + shadcn/ui
- Auth: Supabase Auth + JWT

## Constraints
- Não usar PKCE para Tiny (manter simples — Keycloak suporta sem PKCE também)
- `redirect_uri` deve ser o mesmo domínio registrado no app Tiny
- `TINY_APP_ID` e `TINY_APP_SECRET` são env vars da edge function (não frontend)
- `ml_tokens` usa `user_id` + `ml_user_id` como conflict key — Tiny tokens ficam nas mesmas linhas
- Zero erros TypeScript após execução
