---
phase: 19-imposto-custo-real
plan: "02"
status: completed
completed_at: 2026-05-21
---

# 19-02 SUMMARY — Frontend Vendas usa SUM(orders.tax_amount)

## O que foi feito

### Task 1: useMLKPISummary atualizado
- `src/hooks/useMLKPISummary.ts`
- Adicionados à interface `MLKPISummary`:
  - `total_tax: number` — SUM(orders.tax_amount) para o período
  - `has_tax_data: boolean` — true se ao menos 1 order com tax_amount > 0
- `tax_amount` adicionado ao SELECT da query
- Cálculo no queryFn:
  ```typescript
  const total_tax = rows.reduce((s, r) => s + (r.tax_amount ?? 0), 0);
  const has_tax_data = rows.some((r) => (r.tax_amount ?? 0) > 0);
  ```

### Task 2: MercadoLivre.tsx substituído
- Removido `import { useMLTaxConfig }` (não mais necessário)
- Removido bloco `useMLTaxConfig(resolvedMLUserIds, ...)` + `useMemo` que calculava via `effective_rate × receita` (retornava null com Lucro Real)
- Adicionado:
  ```typescript
  const impostosTotal = kpiSummary?.has_tax_data ? (kpiSummary.total_tax || null) : null;
  ```
- `MLCostCard` recebe `impostos={impostosTotal}` — sem mudança no componente (já aceita null → mostra "—")

## Resultado
- Menu Vendas → card Impostos agora mostra `SUM(orders.tax_amount)` do período
- Com 327 orders recalculados pela migration 19-01: exibe R$5.468,78
- Quando `has_tax_data = false` (nenhum order com tax): mostra "—" (não R$0 falso)
- KPIs existentes (markup, custo operacional, receita, pedidos) não regridem

## TypeScript
- 63/63 testes passando
- 0 erros TypeScript
