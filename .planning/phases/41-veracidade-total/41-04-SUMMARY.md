---
phase: 41-veracidade-total
plan: 04
subsystem: frontend
tags: [billing, dre, meses, waterfall, react, typescript, shadcn]

# Dependency graph
requires:
  - phase: 41-veracidade-total (plan 02)
    provides: "useMLBilling + tabela ml_billing_monthly + charges reais (CFFE/CFONPN e outros)"
provides:
  - "groupBillingCharges() em useMLBilling.ts — agrupa charges em 8 grupos + fallback Outras"
  - "MLCostCard reescrito como DRE mensal com badge billing/estimado"
  - "MercadoLivre.tsx wire completo: waterfall do mês do filtro, mesLabel pt-BR, fallback estimado"
affects: [/vendas card Custos, GoalsCard (não alterado), MLTopProducts (não alterado)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "groupBillingCharges: Map de types → grupos semânticos com bucket fallback Outras"
    - "dreWaterfall: instancia waterfall para o mês do filtro quando ≠ mês corrente"
    - "DRE mensal: receita − tarifas (grupos) − CMV − impostos = lucro + margem%"

key-files:
  created: []
  modified:
    - src/hooks/useMLBilling.ts
    - src/components/mercadolivre/MLCostCard.tsx
    - src/pages/MercadoLivre.tsx
    - supabase/functions/sync-ml-billing/index.ts

key-decisions:
  - "groupBillingCharges combina Afiliados + Outras em linha única quando ambos presentes"
  - "Waterfall do mês do filtro (filterMonthWaterfall) instanciado apenas quando billingMonth ≠ mês corrente — evita query duplicada"
  - "Fallback estimado usa comissão+frete do dreWaterfall + adsSpendMes quando sem billing real"
  - "Removidas impostosParaCard/cmvParaCard/trailingWaterfall — sem uso após migração para DRE mensal"
  - "REGRA DE DOMÍNIO: fatura ML = mês de FECHAMENTO; consumo N → fatura N+1 (EF busca key consumo+1)"
  - "Cancelamentos (bill_includes.bonuses, types B*) entram nos charges e viram última linha do DRE — totalTarifas líquido bate com total_amount da fatura"
  - "Navegação de meses: dreMonthOverride sobrepõe o mês do filtro; sync on-demand da EF (user JWT) para mês sem dados, 1 tentativa por período"

requirements-completed: [DATA-06]

# Metrics
duration: ~25min
completed: 2026-06-12
---

# Phase 41 Plan 04: Card Custos vira DRE Mensal Summary

**groupBillingCharges() com 8 grupos de tarifas ML + MLCostCard reescrito como DRE do mês com badge billing/estimado, wiring completo em MercadoLivre.tsx**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-12
- **Tasks:** 3/3 auto + checkpoint (Task 4 pendente Wesley)
- **Files modified:** 3

## Accomplishments

- `groupBillingCharges(charges)` exportado de `useMLBilling.ts` — 8 grupos semânticos conforme plano 41-04, bucket Outras para types não mapeados, valores somados com sinal (estornos subtraem)
- `MLCostCard` reescrito como DRE mensal: receita do mês → grupos de tarifas individuais → Total de tarifas ML (negrito) → CMV do mês → impostos próprios → Lucro do mês (margem %)
- Badge `billing ML` (azul) ou `estimado` (âmbar) no cabeçalho do card
- `MercadoLivre.tsx`: `filterMonthWaterfall` instanciado para o mês do filtro quando ≠ mês corrente, `mesLabel` pt-BR (ex.: "Junho/2026"), fallback estimado por grupos via orders quando sem billing real
- Cleanup: `cmvParaCard`, `impostosParaCard`, `trailingWaterfall`, `trailing30From`, `subDays` removidos (dead code após migração)

## Task Commits

1. **Task 1: groupBillingCharges** - `fdd9ecd7` (feat)
2. **Task 2: MLCostCard DRE + wiring MercadoLivre** - `0e27e711` (feat)
3. **Task 3: push origin main** - incluído em `0e27e711` (Vercel auto-deploy)
4. **Task 4 (mid-phase, regra de domínio): fatura = mês de fechamento** - `2a0dcc11` (fix) — EF v3, dados re-rotulados, jun CFONPN R$3.008,28 bate exato com print Wesley
5. **Task 5: bonuses (cancelamentos B*) nos charges** - `92ef99e6` (EF) — v4 deployada 2026-06-13; re-sync mar–jun validado (cancelamentos jun = -674,87; mar -9.301,68; abr -8.895,29; mai -6.820,03)
6. **Task 6: linha Cancelamentos + navegação de meses no DRE** - sessão 2026-06-13 (feat) — useMLBillingWithSync, ‹ Mês/Ano › no card, sync on-demand

## Files Created/Modified

- `src/hooks/useMLBilling.ts` — exporta `groupBillingCharges`, `BillingGroup`, `GroupedBillingResult`, `BILLING_GROUP_MAP`
- `src/components/mercadolivre/MLCostCard.tsx` — reescrito como DRE mensal (props novas: mesLabel, receitaMes, gruposTarifas, totalTarifas, cmvMes, impostosMes, fonte)
- `src/pages/MercadoLivre.tsx` — wire DRE: filterMonthWaterfall, mesLabel, gruposTarifasEfetivos, totalTarifasEfetivo, dreFonte, adsSpendMes

## Decisions Made

- **groupBillingCharges combina Afiliados + Outras** em linha única com label dinâmico ("Afiliados / Outras tarifas" quando afiliados ≠ 0, "Outras tarifas" quando zero) — reduz ruído visual
- **filterMonthWaterfall instanciado condicionalmente** apenas quando billingMonth ≠ mês corrente; usa `monthlyCostWaterfall` quando coincide — evita query duplicada desnecessária
- **Fallback estimado** mantido como grupos estruturados (comissão→tarifas de venda, frete→envios ML, ads→publicidade) para que a estrutura DRE seja consistente mesmo sem billing real

## Deviations from Plan

None — plano executado exatamente como especificado. Dead code removido proativamente (cmvParaCard, impostosParaCard, trailingWaterfall) para deixar o arquivo limpo.

## Known Stubs

Nenhum stub. Todos os grupos de tarifas são populados a partir de dados reais (billing) ou estimados de orders; a lógica de fallback é explícita e sinalizada com badge "estimado".

## Threat Flags

Nenhuma superfície nova. Dados lidos via RLS org-scoped existente; nenhum endpoint novo; labels do billing são texto puro (sem XSS).

## Self-Check: PASSED

- `src/hooks/useMLBilling.ts` contém `groupBillingCharges`: FOUND
- `src/components/mercadolivre/MLCostCard.tsx` contém `Total de tarifas`: FOUND
- Commits fdd9ecd7, 0e27e711: FOUND no git log
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 63/63 passed

---
*Phase: 41-veracidade-total*
*Completed: 2026-06-12*
