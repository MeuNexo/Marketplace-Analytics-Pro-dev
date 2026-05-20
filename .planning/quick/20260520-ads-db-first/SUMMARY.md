---
slug: ads-db-first
status: complete
completed_at: "2026-05-20"
commit: a1150b6
---

# Summary: Publicidade DB-first migration

## O que foi feito

- `useMLAds.ts` reescrito: lê de `ml_ads_daily_cache`, `ml_ads_campaigns_cache`, `ml_ads_products_cache` via Supabase client direto — zero chamadas ao edge function na navegação normal
- `syncNow()` chama `supabase.functions.invoke("ml-ads", { force: true })` para refresh forçado
- `sync()` mantido como alias para backward compat (`MercadoLivre.tsx` usa o hook também)
- `lastUpdated` calculado como MAX(synced_at) das rows de cache
- In-memory cache de 5 minutos removido (banco é a fonte de verdade)
- `MLPublicidade.tsx`: botão "Sincronizar ML" (outline, chama syncNow) + "Atualizar" (ghost, relê cache)
- `lastUpdated` passado para MLPageHeader
- TypeScript: zero erros
