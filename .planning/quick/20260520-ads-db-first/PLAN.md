---
slug: ads-db-first
created_at: "2026-05-20"
---

# Migrar Publicidade para DB-first

Refatorar `useMLAds.ts` para ler diretamente das tabelas `ml_ads_daily_cache`, `ml_ads_campaigns_cache`, `ml_ads_products_cache` em vez de chamar o edge function `ml-ads` a cada mount.

## Tasks

1. Rewrite `src/hooks/useMLAds.ts` — DB reads + syncNow() for forced refresh
2. Update `src/pages/mercadolivre/MLPublicidade.tsx` — separate Atualizar (refresh) and Sincronizar ML (syncNow) buttons
3. Atomic commit + push
