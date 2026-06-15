---
phase: 48-mco-com-ads
verified: 2026-06-15T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification_result: "APPROVED by Wesley on Vercel preview (real ckcdevcxgvueywivefgx data) — all 3 visual checks confirmed: /anuncios columns, DRE sem duplicidade, /consultor ads_eating_margin separado. 2026-06-15."
human_verification:
  - test: "Inspecionar visualmente /anuncios → visão financeiro → colunas Mg. Op. e Mg. Pós-Ads com dados reais"
    expected: "Colunas presentes, valores plausíveis (pós-ads ≤ operacional onde há gasto de ads); itens sem dados no período mostram '—' com tooltip"
    why_human: "Verificação visual de UI com dados reais de produção; grep confirma o código mas não a renderização correta com dados reais do banco ckcdevcxgvueywivefgx"
  - test: "Inspecionar /vendas → card Custos/DRE → confirmar que 'Campanhas de publicidade' aparece como linha no DRE quando há billing real"
    expected: "Linha 'Campanhas de publicidade' visível com valor não-nulo; 'Lucro do mês' subtrai esse valor; ao alternar meses a linha persiste/desaparece conforme disponibilidade de billing"
    why_human: "MCO-03 é implementado via groupBillingCharges (PADS → 'Campanhas de publicidade') — a correção de duplicidade (desvio de plano aprovado por Wesley) exige confirmação visual de que não há dupla contagem no modo estimado"
  - test: "Confirmar no painel /consultor (ou via query insights) que insights ads_eating_margin são separados de margin_critical"
    expected: "Produtos com lucro operacional > 0 aparecem em ads_eating_margin sem estar em margin_critical; a coluna rule_key diferencia os dois grupos"
    why_human: "Separação D-07 (MCO-04) validada em smoke de produção pelo orquestrador, mas não pode ser re-verificada pelo verifier sem acesso direto ao banco ckcdevcxgvueywivefgx"
---

# Phase 48: MCO com Ads — Verification Report

**Phase Goal:** A margem por produto e o MCO da operacao consideram o gasto real de publicidade por anuncio, separando "unit economics ruim" (margem operacional baixa) de "ads comendo a margem" (operacional positiva, pos-ads comprometida).
**Verified:** 2026-06-15T00:00:00Z
**Status:** passed (human checks APPROVED by Wesley on Vercel preview, 2026-06-15)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                               | Status     | Evidence                                                                                                 |
|----|-----------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------|
| 1  | Existe fonte por produto de ads_spend/attributed_revenue (RPC sem truncamento, FULL OUTER JOIN)     | ✓ VERIFIED | `20260615120000_margin_with_ads_rpc.sql` — FULL OUTER JOIN ads_side USING (item_id), SECURITY INVOKER, sem LIMIT; smoke produção: 283 produtos, 11 ads-only |
| 2  | Margem por produto exibe margem operacional E pós-ads lado a lado (MCO-02)                         | ✓ VERIFIED | `MLAnuncios.tsx` l.1280/1290: TableHead "Mg. Op." e "Mg. Pós-Ads"; hook `useMLMarginWithAds` importado e chamado com rankingFrom/rankingTo; mapa O(1) marginByItem; colSpan 13; dados "—" quando sem venda |
| 3  | MCO agregado da operacao (Σ contrib − ads total) visivel no card Custos/DRE (MCO-03)               | ✓ VERIFIED | `groupBillingCharges` mapeia PADS → "Campanhas de publicidade" dentro de `gruposTarifas`; `totalTarifas` inclui ads; `lucro = receitaMes − totalTarifas − cmv − impostos` em MLCostCard l.68-72 já desconta ads. Desvio aprovado por Wesley: linha extra removida para evitar dupla contagem (PADS já está no billing real). |
| 4  | Alerta separado por produto "ads comendo a margem" (ads_eating_margin), independente de margin_critical (MCO-04) | ✓ VERIFIED | `consultor-insights/index.ts` l.256-340: RULE ads_eating_margin filtra `lucro > 0 && lucro_pct_pos_ads <= limiar`; margin_critical filtra `lucro_pct <= 0` (l.200-208); rule_keys distintos confirmados; smoke produção: 30 ads_eating vs 184 margin_critical |
| 5  | ads_no_sale por produto — gasto com zero venda por item_id via ml_ads_products_cache (MCO-05)      | ✓ VERIFIED | `consultor-insights/index.ts` l.342-405: RULE 3 migrada de org-level (ml_ads_daily_cache) para item-level (ml_ads_products_cache); paginação `.range()` l.367; rule_key permanece "ads_no_sale"; ml_user_id_key=item_id; smoke: 9 insights item-level, org-level antigo auto-resolvido |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact                                                                 | Expected                                                         | Status     | Details                                                                                              |
|--------------------------------------------------------------------------|------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------------------|
| `supabase/migrations/20260615120000_margin_with_ads_rpc.sql`            | RPC `get_margin_with_ads_by_product`                             | ✓ VERIFIED | EXISTS 114 lines; FULL OUTER JOIN; SECURITY INVOKER; GRANT authenticated; sem LIMIT; 19 colunas de retorno |
| `supabase/migrations/20260615120100_consultor_config_ads_cols.sql`      | Colunas ads_eating_critical_pct / ads_eating_alert_pct           | ✓ VERIFIED | EXISTS; `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ads_eating_critical_pct NUMERIC NOT NULL DEFAULT 0, ads_eating_alert_pct NUMERIC NOT NULL DEFAULT 10` |
| `src/integrations/supabase/types.ts`                                    | Tipos da nova RPC e colunas                                      | ✓ VERIFIED | `get_margin_with_ads_by_product` em Functions (l.1772); `ads_eating_critical_pct`/`ads_eating_alert_pct` em Row/Insert/Update de consultor_config |
| `supabase/functions/consultor-insights/index.ts`                        | RULE ads_eating_margin + ads_no_sale item-level + pilar Ads      | ✓ VERIFIED | 1167 lines; `ads_eating_margin` (l.256-340); `ads_no_sale` per-item via `ml_ads_products_cache` + `.range()` (l.342-405); `hasErosaoAds ? 15 : 0` no pilar Ads (l.904-909) |
| `src/hooks/useMLMarginWithAds.ts`                                       | Hook + interface ProductMarginWithAds                            | ✓ VERIFIED | EXISTS 76 lines; exports `useMLMarginWithAds` + `ProductMarginWithAds`; consome `get_margin_with_ads_by_product` via supabase.rpc(); coerção de tipos em todos os 19 campos; staleTime 2min |
| `src/pages/mercadolivre/MLAnuncios.tsx`                                 | 2 colunas novas na visão financeiro                              | ✓ VERIFIED | `useMLMarginWithAds` importado (l.40) e chamado (l.687); marginByItem useMemo (l.689); TableHead Mg. Op./Mg. Pós-Ads (l.1280/1290); TableCell com fallback "—" (l.1451-1486); colSpan 13 (l.1554) |
| `src/components/mercadolivre/MLCostCard.tsx`                            | MCO agregado no DRE                                              | ✓ VERIFIED | 271 lines; lucro subtrai totalTarifas (l.68-72); PADS incluído em totalTarifas via gruposTarifas de groupBillingCharges (que mapeia type "PADS" → "Campanhas de publicidade"). Prop `adsTotalMes` REMOVIDA (desvio aprovado por Wesley — evita dupla contagem). |
| `src/pages/MercadoLivre.tsx`                                            | Wiring adsTotalMes e guards de duplicidade                       | ✓ VERIFIED | gruposTarifasEfetivos (l.266-281): com billing real retorna gruposTarifas (contém PADS); no fallback estimado adiciona "Campanhas de publicidade" explicitamente com adsSpendMes (l.276). Sem prop adsTotalMes na chamada de MLCostCard (desvio de plano consistente com fix aprovado). |

---

### Key Link Verification

| From                            | To                                  | Via                                                          | Status     | Details                                                             |
|---------------------------------|-------------------------------------|--------------------------------------------------------------|------------|---------------------------------------------------------------------|
| `get_margin_with_ads_by_product` | `ml_ads_products_cache`            | ads_side CTE (SUM(spend), SUM(attributed_orders) por item_id) | ✓ WIRED   | SQL confirmado na migration; filtro organization_id + ml_user_id   |
| `get_margin_with_ads_by_product` | `orders`                           | orders_side CTE (status paid/shipped/delivered, data_pedido) | ✓ WIRED   | FULL OUTER JOIN ads_side USING (item_id)                            |
| `RULE ads_eating_margin`         | `get_margin_with_ads_by_product`   | `sb.rpc` na janela de 30 dias (marginFrom/marginTo)          | ✓ WIRED   | l.265 consultor-insights/index.ts                                   |
| `RULE 3 ads_no_sale`             | `ml_ads_products_cache`            | select item_id, spend, attributed_orders, date com paginação  | ✓ WIRED   | l.355-390 consultor-insights/index.ts                               |
| `notaAds (pilar Ads do score)`   | `activeRuleKeys`                   | includes('ads_eating_margin') → penalidade -15               | ✓ WIRED   | l.904-909 consultor-insights/index.ts                               |
| `useMLMarginWithAds`             | `get_margin_with_ads_by_product`   | supabase.rpc com p_org_id/p_user_ids/p_from/p_to            | ✓ WIRED   | src/hooks/useMLMarginWithAds.ts l.42-47                             |
| `MLAnuncios columnView financeiro` | `useMLMarginWithAds(rankingFrom, rankingTo)` | mapa item_id → ProductMarginWithAds (useMemo) | ✓ WIRED   | l.687-692 MLAnuncios.tsx                                            |
| `MercadoLivre.tsx → MLCostCard`  | `gruposTarifasEfetivos` inclui PADS | groupBillingCharges mapeia type "PADS" → "Campanhas de publicidade" | ✓ WIRED | l.236-237 MercadoLivre.tsx; l.53-54 useMLBilling.ts                |

---

### Data-Flow Trace (Level 4)

| Artifact                   | Data Variable           | Source                                     | Produces Real Data | Status       |
|----------------------------|-------------------------|--------------------------------------------|--------------------|--------------|
| `useMLMarginWithAds.ts`    | `ProductMarginWithAds[]`| `supabase.rpc("get_margin_with_ads_by_product")` | Yes — RPC agrega orders + ml_ads_products_cache (banco ckcdevcxgvueywivefgx, smoke 283 produtos confirmados) | ✓ FLOWING |
| `MLAnuncios.tsx`           | `marginByItem` Map      | `useMLMarginWithAds(rankingFrom, rankingTo)` | Yes — via hook que consome RPC  | ✓ FLOWING |
| `MLCostCard.tsx`           | `lucro` (DRE)           | `receitaMes - totalTarifas - cmv - impostos` | Yes — `totalTarifas` inclui PADS via groupBillingCharges (real billing) ou adsSpendMes (estimado) | ✓ FLOWING |
| `consultor-insights`       | `candidates[]`          | `sb.rpc("get_margin_with_ads_by_product")` + `ml_ads_products_cache` paginado | Yes — smoke produção: 30 ads_eating_margin + 9 ads_no_sale gravados em insights | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior                                       | Command                                                                                               | Result                                              | Status  |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------|---------|
| RPC migration não tem LIMIT                    | `grep -i "LIMIT" ...margin_with_ads_rpc.sql`                                                         | Único match é comentário explicativo (não cláusula SQL) | ✓ PASS |
| FULL OUTER JOIN presente                       | `grep -c "FULL OUTER JOIN" ...margin_with_ads_rpc.sql`                                               | 2 (declaração + body)                               | ✓ PASS  |
| SECURITY INVOKER (não DEFINER)                 | `grep "SECURITY" ...margin_with_ads_rpc.sql`                                                         | SECURITY INVOKER                                    | ✓ PASS  |
| Hook exporta interface + função                | `grep "export function\|export interface" useMLMarginWithAds.ts`                                     | Ambos presentes                                     | ✓ PASS  |
| MLAnuncios usa o hook e renderiza colunas      | `grep -n "useMLMarginWithAds\|Mg. Op\|Mg. Pós-Ads"` MLAnuncios.tsx                                  | Importado l.40; chamado l.687; TableHead l.1280/1290 | ✓ PASS |
| ads_eating_margin é separado de margin_critical | `grep -n "margin_critical\|ads_eating_margin"` consultor-insights/index.ts                           | Filtros distintos: margin_critical usa lucro_pct≤0; ads_eating_margin usa lucro>0 E pós-ads≤limiar | ✓ PASS |
| Paginação .range() no ads_no_sale per-item     | `grep -n "\.range("` consultor-insights/index.ts                                                     | l.367: `.range(apsOffset, apsOffset + PAGE - 1)`    | ✓ PASS  |
| tsc --noEmit limpo                             | `npx tsc --noEmit 2>&1 \| grep -v node_modules \| wc -l`                                            | 0 erros                                             | ✓ PASS  |
| Sem debt markers (TBD/FIXME/XXX) nos arquivos  | grep em todos os 7 arquivos da phase                                                                  | 0 matches                                           | ✓ PASS  |

---

### Probe Execution

Step 7c: SKIPPED — sem scripts `probe-*.sh` declarados ou convencionais para esta phase; verificação de produção foi feita pelo orquestrador via Supabase MCP (evidência fornecida: smoke PASS, 283 produtos sem truncamento, 30 ads_eating_margin, 9 ads_no_sale item-level, prosecdef=false).

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                          | Status        | Evidence                                                                   |
|-------------|-------------|--------------------------------------------------------------------------------------|---------------|----------------------------------------------------------------------------|
| MCO-01      | 48-01       | RPC por produto ads_spend/attributed_revenue sem truncamento, FULL OUTER JOIN        | ✓ SATISFIED   | Migration existe, FULL OUTER JOIN, sem LIMIT, smoke 283 produtos / 11 ads-only |
| MCO-02      | 48-03       | Margem por produto exibe operacional E pós-ads lado a lado                           | ✓ SATISFIED   | MLAnuncios.tsx colunas Mg. Op./Mg. Pós-Ads com hook; aprovado visualmente por Wesley |
| MCO-03      | 48-03       | MCO agregado (Σ contrib − ads total) visível no card Custos/DRE                     | ✓ SATISFIED   | PADS incluído em totalTarifas via groupBillingCharges; lucro DRE subtrai ads. Desvio de plano (linha extra removida) aprovado por Wesley — sem dupla contagem. |
| MCO-04      | 48-02       | Alerta separado "ads comendo a margem" por produto, independente de margin_critical  | ✓ SATISFIED   | rule_key ads_eating_margin separado; filtra lucro>0 E pós-ads≤limiar; smoke 30 insights |
| MCO-05      | 48-02       | ads_no_sale por produto — gasto com zero venda por item_id                           | ✓ SATISFIED   | RULE 3 migrada para item-level via ml_ads_products_cache paginado; smoke 9 insights; org-level antigo auto-resolvido |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | Nenhum detectado | — | — |

Nenhum `TBD`, `FIXME`, `XXX`, placeholder, `return null`, ou dado hardcoded detectado nos arquivos modificados por esta phase.

---

### Human Verification Required

#### 1. Visual inspection of /anuncios — colunas Mg. Op. e Mg. Pós-Ads

**Test:** Abrir /anuncios, alternar para a visão "financeiro", selecionar um range no ranking (ex.: últimos 30 dias). Confirmar as colunas "Mg. Op." e "Mg. Pós-Ads" lado a lado por anúncio, com valores plausíveis (pós-ads ≤ operacional onde há gasto de ads). Itens sem dados no período mostram "—".
**Expected:** Colunas presentes com dados reais; valores de margem operacional e pós-ads distintos para anúncios com ads spend; anúncios sem pedidos no período mostram "—" com tooltip explicativo.
**Why human:** Verificação visual de UI com dados reais de produção; grep confirma a existência do código mas não a renderização correta com dados reais do banco ckcdevcxgvueywivefgx.

#### 2. Visual inspection of /vendas — card DRE sem dupla contagem de ads

**Test:** Abrir /vendas. No card "Custos"/DRE, confirmar que a linha "Campanhas de publicidade" aparece com valor real quando fonte = "competencia" ou "billing". Confirmar que o "Lucro do mês" subtrai esse valor. Navegar para um mês anterior e confirmar que a linha persiste/desaparece conforme disponibilidade de billing. No modo "estimado", confirmar que ads aparece uma única vez.
**Expected:** "Campanhas de publicidade" visível no DRE; Lucro do mês = Receita − tarifas (incluindo PADS) − CMV − impostos; sem duplicação no modo estimado.
**Why human:** O desvio de plano aprovado por Wesley (remover linha "Publicidade (ads ML)" e prop adsTotalMes) exige confirmação visual de que a implementação via groupBillingCharges é equivalente ao MCO-03 pretendido — e que não há dupla contagem no modo estimado vs billing real.

#### 3. Confirmação de separação D-07: ads_eating_margin ≠ margin_critical em /consultor

**Test:** Acessar /consultor (ou consultar tabela insights via admin). Confirmar que há produtos com rule_key = "ads_eating_margin" que NÃO estão em rule_key = "margin_critical" (ou seja, têm lucro operacional > 0 mas margem pós-ads comprometida).
**Expected:** ≥1 produto com ads_eating_margin cujo lucro operacional seja positivo; separação clara entre os dois tipos de alerta visível para o usuário.
**Why human:** A separação D-07 foi confirmada via smoke em produção pelo orquestrador (30 ads_eating com lucro>0, distintos dos 184 margin_critical), mas o verifier não tem acesso direto ao banco ckcdevcxgvueywivefgx para re-verificar.

---

### Gaps Summary

Nenhum gap identificado. Todos os 5 must-haves da phase estão VERIFIED no código. Os 3 itens de verificação humana são de natureza visual/comportamental e não indicam ausência de implementação — são confirmações de experiência de usuário e validação de dados reais.

**Desvio relevante de plano (MCO-03):** a linha "Publicidade (ads ML)" e prop `adsTotalMes` em MLCostCard foram removidas (desvio aprovado por Wesley) porque `groupBillingCharges` já agrega PADS em "Campanhas de publicidade" dentro de `gruposTarifas` — que compõe `totalTarifas` subtraído no cálculo de `lucro`. O MCO-03 ("MCO agregado visível") é satisfeito via a lógica de billing existente, não via linha DRE extra. Esta interpretação é consistente com o texto do ROADMAP ("MCO agregado da operacao = Σ margem de contribuicao − ads total, visivel") — o valor está visível como "Lucro do mês" que já inclui a subtração de PADS.

---

_Verified: 2026-06-15T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
