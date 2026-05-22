# Phase 22: Sync Automático — Cache-First sem Fricção

**Created:** 2026-05-22
**Milestone:** v7.0
**Status:** Planning

---

## Goal

Eliminar toda sincronização disparada pelo frontend ao navegar ou filtrar datas. O dado deve estar sempre fresco no Supabase (via cron intraday), e a UI deve apenas ler — nunca puxar da API ML por conta própria.

---

## Diagnóstico Técnico Completo

### Arquitetura atual de sync

**Tabelas envolvidas:**
- `ml_daily_cache` — agregados diários (receita, pedidos, visitas, conversão). Populado por `mercado-libre-integration`.
- `orders` — pedidos individuais com custo/frete/comissão calculados. Populado por `sync-ml-orders`.
- `sync_jobs` — fila de jobs com status (pending/running/completed/failed).
- `ml_sync_log` — log de execuções (user_id, ml_user_id, date_from, date_to, synced_at, source).
- `organization_plans` — configuração por org: `sync_interval_minutes` (default: 1440 = 24h).

**Crons existentes (pg_cron):**
| Job | Schedule | Ação |
|-----|----------|------|
| `sync-sales-daily` | `0 9 * * *` (06:00 BRT) | `dispatch_sales_jobs()` → D-1 daily_cache |
| `sync-orders-daily` | `0 9 * * *` (06:00 BRT) | `dispatch_orders_jobs()` → D-1 orders |
| `sync-dispatch-every-30min` | `*/30 * * * *` | `dispatch_sync_jobs()` → interval-based por org |
| `sync-process-job-every-5min` | `*/5 * * * *` | `process-sync-job` → consome fila |
| `sync-job-retry-watchdog` | `*/5 * * * *` | Retry de jobs falhos (até 3×) |

**Fluxo de dados:**
```
pg_cron → dispatch_*() → INSERT sync_jobs (pending)
pg_cron → process-sync-job → claim_next_sync_job() → mercado-libre-integration / sync-ml-orders
edge function → ML API → upsert ml_daily_cache / orders
Frontend → Supabase (React Query) → UI
```

**Como `dispatch_sync_jobs()` funciona:**
- Lê `organization_plans.sync_interval_minutes` por org (default 1440 se sem registro)
- Se `sync_interval_minutes = -1`: skip (manual only)
- Verifica quando foi o último job `completed` para aquele (org, ml_user_id, job_type)
- Se elapsed >= interval: insere job com `date_from = NULL, date_to = NULL`
- Jobs com `date_from = null` → edge functions defaultam para "hoje" (mercado-libre-integration: `days = 1`)

**Como `mercado-libre-integration` trata `date_from = null`:**
- Usa `days = 1` (default do schema Zod)  
- Calcula range: hoje em BRT
- Busca pedidos + visitas do dia

### Problema atual no frontend

`MercadoLivre.tsx` tem dois padrões de auto-sync que precisam ser removidos:

**1. Auto-sync no mount** (linhas ~196-218):
```typescript
const autoSyncDoneRef = useRef(false);
useEffect(() => {
  if (!user || storeLoading || autoSyncDoneRef.current || !connected) return;
  autoSyncDoneRef.current = true;
  // inventory fetch...
  if (shouldAutoSync()) {
    syncFromAPI(); // ← dispara se lastSync > 10min atrás
  }
}, [...]);
```
Este bloco sincroniza toda vez que a página é aberta (se stale > 10min). Com o cron intraday rodando, é desnecessário.

**2. `rangeSyncedRef`** — já removido na Phase 21.

**3. `shouldAutoSync()` em `useMLSync.ts`:**
- Baseia-se em `localStorage` (`ml_last_synced_ts`)
- Retorna true se `Date.now() - lastTs > 600_000` (10min)
- Pode ser removida junto com o auto-sync do mount

### "Última atualização" hoje vem de localStorage

`lastSyncedAt` em `useMLSync` é salvo em `localStorage` no momento que o **frontend** sincroniza — não quando o cron rodou. Com sync automático por cron, esse indicador fica desatualizado.

**Fix:** ler `ml_sync_log` do Supabase — o cron já grava lá via `mercado-libre-integration` (source: "auto").

---

## Requisitos Funcionais

### RF-01: Sync intraday automático para hoje
- Dados de hoje devem ser atualizados automaticamente a cada 2 horas via cron
- Sem ação do usuário requerida
- Dentro dos rate limits da API ML

### RF-02: Frontend cache-first
- Remover auto-sync no mount
- UI lê do Supabase via React Query — sem disparar edge functions automaticamente
- Botão "Atualizar" continua disponível para sync manual sob demanda

### RF-03: "Última atualização" real
- Indicador de "última sincronização" deve refletir quando o cron (ou sync manual) realmente rodou
- Fonte: `ml_sync_log.synced_at` (Supabase), não `localStorage`
- Mostrar no header: "atualizado Xmin atrás"

### RF-04: Supabase Realtime (auto-refresh UI)
- Assinar `ml_daily_cache` via Supabase Realtime
- Quando cron atualiza dado → React Query invalida automaticamente → UI refresca sem polling
- Usuário vê dados novos sem clicar em nada

---

## Estratégia de Implementação

### Backend (1 migration)

**Opção escolhida: `dispatch_sync_jobs()` com `sync_interval_minutes = 120` por org.**

Por que não criar novo dispatcher separado?
- `dispatch_sync_jobs()` já existe, já roda a cada 30min, já tem guard contra duplicação, já tem retry via watchdog
- Só falta configurar o intervalo correto na tabela `organization_plans`
- `mercado-libre-integration` com `date_from = null` já sincroniza hoje por padrão

**Migration:**
```sql
-- Upsert organization_plans para todas as orgs ativas com sync_interval_minutes = 120
INSERT INTO public.organization_plans (organization_id, sync_interval_minutes)
SELECT DISTINCT organization_id, 120
FROM public.ml_tokens
WHERE access_token IS NOT NULL
ON CONFLICT (organization_id)
  DO UPDATE SET sync_interval_minutes = 120;
```

Resultado: a cada 30min o dispatcher roda e verifica se passou 2h desde o último sync. Se sim, cria job. Em 5min o processador executa. Dado de hoje atualizado a cada ~2h sem nenhum code no frontend.

### Frontend (3 mudanças)

**1. Remover auto-sync no mount de `MercadoLivre.tsx`:**
- Remover bloco `autoSyncDoneRef` + `shouldAutoSync()` call + inventory fetch do effect de sync
- O inventory pode ser buscado em effect separado sem condicional de sync

**2. Hook `useMLLastSync` — fonte de verdade do último sync:**
```typescript
// src/hooks/useMLLastSync.ts
export function useMLLastSync() {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  return useQuery({
    queryKey: ['ml_last_sync', currentOrg?.id, resolvedMLUserIds],
    queryFn: async () => {
      const { data } = await supabase
        .from('ml_sync_log')
        .select('synced_at, source')
        .eq('organization_id', currentOrg!.id)
        .in('ml_user_id', resolvedMLUserIds)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.synced_at ?? null;
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
```

**3. Supabase Realtime em `MercadoLivre.tsx`:**
```typescript
useEffect(() => {
  if (!orgId || resolvedMLUserIds.length === 0) return;
  const channel = supabase
    .channel('ml_daily_cache_changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'ml_daily_cache',
      filter: `organization_id=eq.${orgId}`,
    }, () => {
      invalidate.invalidateAll();
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [orgId, resolvedMLUserIds, invalidate]);
```

---

## Restrições

- Sem novas dependências
- Sem migração destrutiva — apenas INSERT/UPDATE de configuração
- Rate limits ML: 2h de intervalo → ~12 syncs/dia por loja → seguro
- `useMLSync.syncFromAPI` permanece para o botão "Atualizar" manual
- `shouldAutoSync` pode ser removida (não mais chamada)
- `AUTO_SYNC_STALE_MS` pode ser removida

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/20260522_intraday_sync.sql` | Upsert organization_plans sync_interval_minutes=120 |
| `src/hooks/useMLLastSync.ts` | Novo hook — lê ml_sync_log do Supabase |
| `src/hooks/useMLSync.ts` | Remove shouldAutoSync + AUTO_SYNC_STALE_MS |
| `src/pages/MercadoLivre.tsx` | Remove auto-sync mount; add Realtime; usa useMLLastSync |

---

## Critérios de Sucesso

1. Abrir a página não dispara sync (sem "Atualizando..." automático)
2. Dados de hoje atualizam automaticamente a cada ≤2h (verificável em ml_sync_log)
3. Indicador "última atualização" reflete synced_at real do Supabase
4. Quando cron roda, a UI atualiza automaticamente (Realtime)
5. Botão "Atualizar" continua funcional
6. TypeScript 0 erros, 63/63 testes
