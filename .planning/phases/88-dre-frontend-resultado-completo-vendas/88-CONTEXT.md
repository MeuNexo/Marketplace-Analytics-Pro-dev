# Phase 88: DRE — Frontend Resultado Completo (/vendas) - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Source:** Discussão consolidada + reconciliação de junho validada por Wesley (memória project_garment_dre_resultado_completa).

<domain>
## Phase Boundary
Levar a DRE de Resultado completa pra tela do `/vendas`: hoje a "DRE do mês" para na margem/lucro-de-marketplace (após receita, CMV, impostos, tarifas ML). Esta fase adiciona os **custos operacionais** (via RPC `get_dre_operational_by_competence`, Phase 87) e mostra o **resultado líquido real** do mês.
Fecha o milestone DRE de Resultado. Backend já pronto (Phases 86+87 em prod).
</domain>

<decisions>
## Decisões (LOCKED)
- **Estrutura visual da DRE:** Receita → (−) impostos venda, comissão/tarifas ML, frete, CMV, ads = **Margem de contribuição / "lucro de marketplace"** (já existe no /vendas) → (−) **Pessoal, Estrutura, Serviços, Outros** = **Resultado operacional** → (−) **Financeiro** = **Resultado líquido**.
- **Fonte dos custos operacionais:** RPC `get_dre_operational_by_competence(p_org_id, p_month)` retorna blocos {impostos_venda, pessoal, estrutura, servicos, financeiro, outros_operacionais, excluido}. O frontend usa pessoal/estrutura/servicos/outros_operacionais/financeiro; IGNORA `excluido` e `impostos_venda` (esse já está na margem existente — não re-subtrair).
- **Financeiro:** mostrar com selo/badge **"aproximado"** quando `financeiro_is_approximate=true` (juro não separado do principal; pendente tabela do banco). Tooltip explicando.
- **Régua:** competência (o `p_month` = 1º dia do mês). Casar com o seletor de mês que a DRE atual já usa no /vendas.
- **Não re-derivar a margem** — ela já é composta client-side no `/vendas` (get_cost_waterfall + ml_billing). Phase 88 só ANEXA os blocos operacionais + calcula o resultado líquido (margem − custos operacionais).
- **Caso de validação:** junho/2026 deve mostrar resultado ≈ **−R$29k** (validado: margem +20.888 − pessoal 27.852 − financeiro 20.027 − serviços 1.953 − outros 150).
- **Visual:** consistente com o dashboard (tokens, BRL, semáforo de sinal +/−), **light+dark**, **mobile** (padrão Phase 78). Recharts se fizer gráfico; mas o núcleo é uma DRE em formato de tabela/waterfall.
</decisions>

<canonical_refs>
- `src/pages/MercadoLivre.tsx` — onde a "DRE do mês" / margem é composta client-side (get_cost_waterfall + ml_billing_daily/monthly, fallback 3-tier). Ponto de integração.
- Componente de custo/DRE existente (localizar: MLCostCard ou similar) — replicar padrão visual.
- RPC `get_dre_operational_by_competence` (migrations 20260687000000 + 20260687000100). Retorna bloco/category/total/n/financeiro_is_approximate.
- `src/components/financial/CostCompositionChart.tsx` (paleta CVD-safe por índice, Phase 85) se precisar de cores.
- Supabase garment = ckcdevcxgvueywivefgx (NÃO o do CLAUDE.md). Hook via supabase client `.rpc('get_dre_operational_by_competence', {...})`.
</canonical_refs>

<deferred>
- Reconciliação de impostos (DRE estima R$53k vs guias R$4,8k competência — timing/créditos Lucro Real) — fora desta fase.
- Classificação fina de outros_operacionais (Serviços gerais, Impostos-taxas) — quando Wesley definir.
- Separar juro/principal do financeiro (pendente tabela do banco).
</deferred>

---
*Phase: 88-dre-frontend-resultado-completo-vendas · Context 2026-07-06*
