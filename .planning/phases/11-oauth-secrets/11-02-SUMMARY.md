# Phase 11 — Plan 02 Summary

**Status:** COMPLETED
**Date:** 2026-05-21

## Requisitos satisfeitos

- **OAUTH-01** ✓ — ML_APP_ID (`4419359453616669`) e ML_CLIENT_SECRET configurados no Supabase Dev `ckcdevcxgvueywivefgx`
- **OAUTH-02** ✓ — `https://marketplace-analytics-pro-dev.vercel.app/integracoes` registrado como redirect URL no app ML `4419359453616669`
- **OAUTH-03** ✓ — Fluxo OAuth completo funcionando: botão "Conectar ML" → autorização ML → token salvo em `ml_tokens`
- **OAUTH-04** — Pendente validação manual do ml-token-refresh

## Token salvo em ml_tokens (Supabase Dev)

| Campo | Valor |
|-------|-------|
| user_id | ce8c797c-f984-4abb-b5f1-3e2f2eecbb73 |
| ml_user_id | 1639558873 |
| token_prefix | APP_USR-441935945361... |
| expires_at | 2026-05-21 21:46 UTC |

## Bugs corrigidos nesta fase

1. `redirect_uri` não estava sendo `encodeURIComponent` no auth URL → ML rejeitava
2. `vercel.json` ausente → Vercel retornava 404 em `/integracoes?code=...` (SPA sem rewrites)
3. `ML_APP_ID` errado (Nexo `6718795003094476` vs app correto `4419359453616669`)

## ml_user_id da Pé Vermeio

`1639558873` — usar nas Phases 2 e 3 para sync de vendas, ads e estoque.
