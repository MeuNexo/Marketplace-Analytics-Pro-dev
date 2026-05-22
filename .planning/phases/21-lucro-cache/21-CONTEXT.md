# Phase 21: Lucro Bruto Consistente + Cache Inteligente

**Created:** 2026-05-22
**Milestone:** v7.0
**Status:** Planning

---

## Goal

Dois problemas críticos identificados na página de Vendas:

1. **Lucro Bruto diverge entre os painéis** — GoalsCard mostra 10.7% e MLCostCard mostra 7.4% para o mesmo período. O MLCostCard é o correto (filtra somente pedidos pagos, desconta cancelamentos). O GoalsCard usa `useMLKPISummary` que não filtra por status → inclui pedidos cancelados na receita → denominador inflado.

2. **Re-sync obrigatório ao mudar filtro** — Toda vez que o usuário muda o período, a página exige nova sincronização e o usuário aguarda. O banco já tem os dados históricos (sincronia passada), mas o frontend não consegue servir os dados do cache sem acionar um novo sync. Isso degrada muito o UX em uso diário.

---

## Diagnóstico Técnico

### Problema 1 — Lucro Bruto

**Causa raiz:** `useMLKPISummary` consulta `orders` sem filtro de status:
```typescript
// src/hooks/useMLKPISummary.ts (linha 31)
await supabase.from("orders").select("receita_bruta, custo_unit, quantidade, frete, comissao, tax_amount")
// SEM .in("status", ["paid", "shipped", "delivered"])
```

Pedidos cancelados têm `receita_bruta > 0` na tabela → inflam `gross_revenue` → denominador errado → `gross_revenue - custos` fica artificialmente alto.

`useMLCostWaterfall` faz certo: filtra `PAID_STATUSES = ["paid", "shipped", "delivered"]`.

**Fix:** Computar `currentGrossProfit` a partir de `useMLCostWaterfall` (já existente, já correto) ao invés de `useMLKPISummary`. O hook mensal pode usar os mesmos dados do waterfall com datas do mês corrente.

### Problema 2 — Re-sync no filtro

**Causa raiz:** O `rangeSyncedRef` em `MercadoLivre.tsx` detecta ausência de dados no range e chama `syncFromAPI()`. O problema:

```typescript
// linha 229-234 MercadoLivre.tsx
const hasRangeData = allDaily.some(d => d.date >= currentFrom && d.date <= currentTo);
if (hasRangeData) return;
rangeSyncedRef.current = rangeKey;
syncFromAPI({ periodDays: 1 }); // ← aciona sync se QUALQUER data faltar
```

O cache `ml_daily_cache` armazena dados por dia, mas o `fetchFrom/fetchTo` carrega uma janela mais ampla. Quando o usuário muda para um range que inclui datas sem dados, o sync dispara mesmo que a maioria dos dados já esteja em cache.

**Fix:** Dados históricos (datas anteriores a hoje) nunca mudam — devem ser servidos do cache sem sync. Sync só deve acontecer para datas recentes (hoje e ontem). O cache `ml_daily_cache` já guarda dados por dia; a página deve consumir o que há sem exigir sync completo antes de renderizar.

---

## Estado Atual dos Arquivos

```
src/hooks/useMLKPISummary.ts          ← consulta orders sem filtro status
src/hooks/useMLCostWaterfall.ts       ← correto: só pedidos pagos
src/pages/MercadoLivre.tsx            ← usa monthlyKpiSummary para gross_profit
src/components/mercadolivre/GoalsCard.tsx ← recebe currentGrossProfit calculado errado
src/hooks/useMLSync.ts                ← AUTO_SYNC_STALE_MS = 10min
src/hooks/useMLQueries.ts             ← fetchFrom/fetchTo, staleTime configs
```

---

## Requisitos Funcionais

### RF-01: Lucro Bruto Único e Correto
- GoalsCard e MLCostCard devem mostrar o mesmo percentual de Lucro Bruto
- Fórmula: `receita_paga − CMV − (frete + comissão + ads) − impostos` / `receita_paga`
- Cancelamentos **não entram** no cálculo

### RF-02: Dashboard Sem Re-sync ao Filtrar
- Ao mudar o período, a página deve renderizar os dados do cache imediatamente
- Sync automático só para hoje e ontem (dados em aberto)
- Dados históricos (< hoje): servidos direto do cache, sem sync
- Indicador visual de "última atualização" no header (já existe `lastSyncedAt`)

### RF-03: Cache Pré-aquecido para o Mês
- Na primeira carga do mês, se não houver dados do mês corrente: sync único do mês inteiro
- Nos acessos seguintes: sem sync, usa cache
- Não triggar sync para períodos históricos nunca

---

## Restrições

- Sem novas dependências
- Sem migração de banco — apenas mudanças de lógica frontend
- `useMLCostWaterfall` já é a fonte de verdade para todos os custos — manter como referência
- Modo TV (`/tv`) deve continuar funcionando

---

## Critérios de Sucesso

1. GoalsCard Lucro Bruto % == MLCostCard Lucro Bruto % para o mesmo período
2. Mudar o filtro de período **não aciona sync** se os dados já estão no cache
3. Sync automático ocorre apenas 1x por sessão (ou 1x por 10min para hoje)
4. TypeScript 0 erros, 63/63 testes passando
