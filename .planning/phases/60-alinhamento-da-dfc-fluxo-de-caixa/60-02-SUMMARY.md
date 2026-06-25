---
phase: 60-alinhamento-da-dfc-fluxo-de-caixa
plan: 02
status: complete
completed: 2026-06-25
---

# 60-02 SUMMARY — Frontend: toggle "Incluir previsões de compra" na /fluxo-de-caixa

## O que foi feito
- `src/hooks/useCashFlowData.ts`: assinatura estendida para `useCashFlowData(startDate, endDate, includePurchaseForecasts = false)`. O booleano entra na `queryKey` (refetch ao alternar) e em `p_include_purchase_forecasts` da chamada `supabase.rpc('get_cashflow', ...)`. Shape de retorno (`CashFlowDataPoint`) inalterado.
- `src/pages/mercadolivre/MLFluxoCaixa.tsx`: estado `const [includePurchaseForecasts, setIncludePurchaseForecasts] = useState(false)`, passado ao hook. `Switch` shadcn (`@/components/ui/switch`) com `Label` "Incluir previsões de compra" + tooltip, **desligado por padrão**, na aba "Caixa Real", numa linha acima do gráfico (à esquerda; botão "Ajustar saldo de hoje" à direita). Aba "Simulador" e demais layouts intactos.

## Verificação
- grep: `includePurchaseForecasts` no hook e na página, import do Switch e a label — PASS.
- `npm run build` (vite) verde (MLFluxoCaixa chunk 32.50 kB).

## Requisitos
- CASHFIX-06 (frontend) ✓

## Pendência (Task 3 — checkpoint)
- Push → Vercel + validação visual do Wesley: toggle OFF idêntico ao atual e curva alinhada com a DFC; toggle ON soma as previsões ao vivo. Pendência aceita explícita.
