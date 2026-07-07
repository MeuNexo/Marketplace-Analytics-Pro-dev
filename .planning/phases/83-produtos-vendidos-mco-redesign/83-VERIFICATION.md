---
phase: 83-produtos-vendidos-mco-redesign
verified: 2026-07-03T12:50:45Z
status: human_needed
score: 15/15 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /produtos-vendidos em preview/produção logado como Pé Vermeio, tema CLARO e tema ESCURO."
    expected: "As 3 cores do semáforo MCO% (🔴≤5% / 🟡6-8% / 🟢≥9%) são distinguíveis e legíveis em ambos os temas; o rótulo % está sempre visível ao lado da bolinha (nunca cor sozinha)."
    why_human: "Contraste de cor, legibilidade e distinguibilidade CVD-safe em light/dark são julgamentos visuais que grep/análise estática não capturam."
  - test: "Selecionar uma marca no painel esquerdo e conferir o cabeçalho-resumo (Receita total, MCO% médio, nº de anúncios no vermelho); ordenar a tabela por MCO% asc/desc e pelas demais colunas (%Ads, Receita, Qtd, Estoque, %Grupo)."
    expected: "Cabeçalho-resumo mostra os 3 números corretos para a marca selecionada; ordenação funciona em todas as colunas numéricas com indicador visual da coluna ativa; ordenar por MCO% asc revela os anúncios 'mico' (vende bem, margem baixa)."
    why_human: "Comportamento interativo de clique/ordenação e correção visual do resultado no navegador real — não coberto por testes automatizados desta fase."
  - test: "Conferir um anúncio de marca de revenda (ex.: Sandrini/Fila/New Balance) sem custo cadastrado: MCO% deve exibir '—' com ícone de aviso, nunca 0% ou um número calculado."
    expected: "Célula mostra '—' + ícone de alerta; tooltip mostra 'Sem custo cadastrado — MCO indefinido' antes da quebra de custos."
    why_human: "Validação de dado real em produção (existência de anúncios com has_cmv=false no período corrente) depende do estado ao vivo do banco, não apenas da lógica (já coberta por testes unitários)."
  - test: "Hover no MCO% de um anúncio qualquer; conferir mobile (cards) mostrando MCO% com cor e % Ads."
    expected: "Tooltip mostra a quebra de custos (MCO R$, Ads, Comissão, Frete, Imposto); cards mobile replicam as mesmas métricas do desktop."
    why_human: "Renderização de tooltip/hover e layout responsivo real (viewport mobile) exigem inspeção visual no navegador."
---

# Phase 83: MCO por anúncio em Produtos Vendidos + redesign UX — Verification Report

**Phase Goal:** A página `/produtos-vendidos` passa a mostrar MCO (pós-ads) por anúncio e por marca, com semáforo de saúde, coluna % Ads, tabela ordenável, cabeçalho-resumo por grupo e tratamento correto de custo ausente — usando `get_margin_with_ads_by_product` como fonte única (com `marca`), em vez de `orders_sold_products_agg`.

**Verified:** 2026-07-03T12:50:45Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `MCO_SAUDAVEL_PCT` centraliza cortes 🔴≤5 / 🟡6–8 / 🟢≥9 | ✓ VERIFIED | `src/lib/mcoHealth.ts:16-21` (`red: 5, green: 9`) |
| 2 | `classifyMcoHealth` retorna `'indefinido'` quando pct é `null`/`undefined` (nunca zera/inventa) | ✓ VERIFIED | `src/lib/mcoHealth.ts:34-39`; testado em `src/lib/mcoHealth.test.ts` (14 testes, bordas 5/6/8.9/9/null/undefined) |
| 3 | `aggregateMcoItems` calcula `mcoPct` (=`lucro_pct_pos_ads`), `acosPct`, `health`, `shareOfGroup` e os 6 campos de tooltip (cmv/comissao/frete/impostos/adsSpend/mcoReais) | ✓ VERIFIED | `src/components/mercadolivre/anuncios/soldProductsMcoAgg.ts:177-210` |
| 4 | `aggregateMcoGroups` calcula `mcoPct` pós-ads como razão de somas (Σ`lucro_pos_ads`÷Σ`receita`), não média simples; expõe `redCount` e `hasMissingCost` | ✓ VERIFIED | `soldProductsMcoAgg.ts:130-166` (linha 161: `d.lucroPosAdsSum / d.revenue`); testado em `soldProductsMcoAgg.test.ts` (19 testes, incl. caso do plano: grupo 100/3+200/30 → 11%, redCount=1) |
| 5 | `useMLMarginWithAds` expõe `marca: string \| null` | ✓ VERIFIED | `src/hooks/useMLMarginWithAds.ts:32` (interface) e `:73` (mapper) |
| 6 | `MLProdutosVendidos.tsx` usa `useMLMarginWithAds` como fonte, NÃO mais `orders_sold_products_agg`/`useMLSoldProducts` | ✓ VERIFIED | `MLProdutosVendidos.tsx:9,223`; `grep -n "useMLSoldProducts\|orders_sold_products_agg"` no arquivo = 0 ocorrências |
| 7 | Filtra `unidades > 0` (semântica "produtos vendidos", descarta linhas ads-only) | ✓ VERIFIED | `MLProdutosVendidos.tsx:226-229` |
| 8 | Coluna MCO% com semáforo (bolinha de cor) + rótulo % sempre visível (cor nunca é sinal único) | ✓ VERIFIED | `McoCell` (linhas 72-99): bolinha (`w-2 h-2 rounded-full`) + `<span>{label}</span>` sempre renderizado, mesmo quando `hasCmv=false` (label vira `"—"`) |
| 9 | `has_cmv=false` → célula mostra `"—"` com aviso, NUNCA número zerado/inventado | ✓ VERIFIED | `MLProdutosVendidos.tsx:75` (`item.hasCmv ? pctFmt(item.mcoPct) : "—"`) + ícone `AlertCircle` (linhas 83-85) + tooltip "Sem custo cadastrado — MCO indefinido" (linha 90) |
| 10 | Coluna % Ads (ACoS) por anúncio | ✓ VERIFIED | `MLProdutosVendidos.tsx:502-508` (header), `560-562` (célula desktop), `616-617` (card mobile) |
| 11 | Tabela ordenável (Qtd/Receita/MCO%/%Ads/Estoque/%Grupo), clique alterna asc/desc, indicador visual da coluna ativa | ✓ VERIFIED | `SortKey` type + `sortValue`/`onSortClick`/`SortHead`/`SortIndicator` (linhas 41-192, 271-303); nulls (MCO%/ACoS indefinidos) sempre empurrados ao fim independente da direção (linhas 282-284) |
| 12 | MCO% por marca no painel esquerdo (bolinha de cor ao lado da receita) | ✓ VERIFIED | `GroupMcoBadge` renderizado por item da lista de grupos, `MLProdutosVendidos.tsx:404` |
| 13 | Cabeçalho-resumo do grupo: Receita total · MCO% médio · nº de anúncios no vermelho | ✓ VERIFIED | `MLProdutosVendidos.tsx:436-474` (os 3 números + aviso de custo ausente quando aplicável) |
| 14 | Cards mobile coerentes com as novas métricas (MCO%, %Ads) | ✓ VERIFIED | `MLProdutosVendidos.tsx:577-635` (grid com Qtd/Receita/MCO%/%Ads/Estoque/%Grupo) |
| 15 | Migration `marca` aplicada em prod e reconciliada (diff 0,00, anti-IDOR 0 linhas) | ✓ VERIFIED (evidência do 83-02-SUMMARY, sem MCP disponível para reconferir ao vivo nesta verificação) | `83-02-SUMMARY.md`: retrocompat 20 colunas por nome ✓, Σreceita RPC ≡ Σreceita manual em `orders` (diff 0,00) ✓, anti-IDOR = 0 linhas para org alheia ✓ |

**Score:** 15/15 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/mcoHealth.ts` | `MCO_SAUDAVEL_PCT` + `classifyMcoHealth` + role de cor | ✓ VERIFIED | Existe, substantivo, 14 testes próprios passando |
| `src/components/mercadolivre/anuncios/soldProductsMcoAgg.ts` | `aggregateMcoItems`/`aggregateMcoGroups` | ✓ VERIFIED | Existe, substantivo, 19 testes próprios passando, importado e usado em `MLProdutosVendidos.tsx` |
| `src/hooks/useMLMarginWithAds.ts` | expõe `marca` | ✓ VERIFIED | Campo presente na interface e no mapper; usado por `MLProdutosVendidos.tsx`, `MLAnuncios.tsx`, `ListingDetailModal.tsx`, `ListingIndicatorsTab.tsx` (retrocompat intacta — campo é aditivo) |
| `src/pages/mercadolivre/MLProdutosVendidos.tsx` | reescrita com MCO/semáforo/ordenação/cabeçalho-resumo | ✓ VERIFIED | 644 linhas, todos os elementos do goal presentes e wired; rota `/produtos-vendidos` em `App.tsx:147` aponta para este componente |
| `supabase/migrations/20260683000000_margin_with_ads_marca.sql` | DROP+CREATE de `get_margin_with_ads_by_product` com `marca` | ✓ VERIFIED | Arquivo presente, `marca` como última coluna da `RETURNS TABLE`, `SECURITY INVOKER` mantido, `GRANT EXECUTE` para `authenticated` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `MLProdutosVendidos.tsx` | `useMLMarginWithAds.ts` | `useMLMarginWithAds(currentFrom, currentTo)` | ✓ WIRED | Linha 223; resultado filtrado e passado para `aggregateMcoGroups`/`aggregateMcoItems` |
| `MLProdutosVendidos.tsx` | `soldProductsMcoAgg.ts` | import + chamadas `aggregateMcoGroups`/`aggregateMcoItems` | ✓ WIRED | Linhas 11-17, 255-263 |
| `MLProdutosVendidos.tsx` | `mcoHealth.ts` | import + `classifyMcoHealth`/`mcoHealthRole` no `GroupMcoBadge`/`McoCell` | ✓ WIRED | Linha 18, 73, 112-113 |
| `soldProductsMcoAgg.ts` (item) | UI (tooltip) | campos `cmv`/`comissao`/`frete`/`impostos`/`adsSpend`/`mcoReais` consumidos sem recálculo | ✓ WIRED | `McoCell` tooltip (linhas 92-95) usa diretamente `item.mcoReais`/`item.adsSpend`/`item.comissao`/`item.frete`/`item.impostos` |
| `useMLMarginWithAds.ts` | RPC `get_margin_with_ads_by_product` | `supabase.rpc(...)` | ✓ WIRED | Linhas 44-49; mapeamento por nome de coluna inclui `marca` (linha 73) |
| Migration `marca` | Consumidores existentes (`MLAnuncios.tsx`, `ListingDetailModal.tsx`, `ListingIndicatorsTab.tsx`) | coluna aditiva no fim da `RETURNS TABLE`, mapeamento por nome | ✓ WIRED (retrocompat confirmada em 83-02-SUMMARY: 20 colunas, 18 antigas por nome) | Nenhum desses 3 consumidores foi tocado nesta phase e continuam funcionando (campo `marca` é opt-in) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsc limpo (typecheck de todo o projeto, incl. arquivos da phase) | `npx tsc --noEmit` | sem erros/saída | ✓ PASS |
| Suíte vitest completa (uma única execução) | `npx vitest run` | 27 arquivos, 407/407 testes passando (incl. `mcoHealth.test.ts` 14, `soldProductsMcoAgg.test.ts` 19) | ✓ PASS |
| Página não referencia mais a fonte antiga | `grep -n "useMLSoldProducts\|orders_sold_products_agg" MLProdutosVendidos.tsx` | 0 ocorrências (exit 1) | ✓ PASS |
| Rota `/produtos-vendidos` aponta para o componente reescrito | `grep -n "produtos-vendidos" App.tsx` | `<Route path="/produtos-vendidos" ... element={<MLProdutosVendidos />} />` | ✓ PASS |

### Requirements Coverage

Phase ad-hoc — sem IDs formais em REQUIREMENTS.md. `requirements-completed` declarados nas SUMMARYs (`MCO-PV-RPC`, `MCO-PV-LOGIC`, `MCO-PV-UI`) são tags internas do plano, não requirements rastreados centralmente; nenhuma cobertura ORPHANED a reportar.

### Anti-Patterns Found

Nenhum. Scan de `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|placeholder|coming soon|not yet implemented` nos 4 arquivos-fonte principais (`mcoHealth.ts`, `soldProductsMcoAgg.ts`, `useMLMarginWithAds.ts`, `MLProdutosVendidos.tsx`) retornou 0 matches.

### Human Verification Required

A Task 3 do plano 83-03 é um checkpoint visual bloqueante explicitamente pendente (83-03-SUMMARY: `status: blocked`, "Task 3 [BLOCKING]: Checkpoint visual do Wesley (light + dark) — PENDENTE"). Todo o código correspondente está implementado e coberto por teste unitário onde aplicável; o que resta é validação visual/interativa em navegador real (light+dark), listada no frontmatter `human_verification`.

### Gaps Summary

Nenhum gap de código encontrado. Todas as 15 truths derivadas do Goal (ROADMAP Phase 83 + 83-CONTEXT.md decisões travadas) estão implementadas, testadas (onde testável por unidade) e conectadas (fonte de dados trocada, filtro unidades>0, semáforo com cortes corretos, tratamento de custo ausente sem inventar número, coluna %Ads, ordenação por qualquer coluna numérica, MCO% por marca, cabeçalho-resumo, cards mobile). `tsc --noEmit` limpo e `vitest run` 407/407 verdes, sem regressão. A migration `marca` foi aplicada e reconciliada em produção (evidência registrada no 83-02-SUMMARY, sem MCP disponível nesta sessão de verificação para reconferir ao vivo — aceita por instrução explícita do solicitante).

A única pendência é o checkpoint visual humano (light+dark) do plano 83-03 (Task 3), que é uma etapa de validação intencionalmente deixada para Wesley — não uma falha de implementação. Por isso o status desta verificação é `human_needed`, não `gaps_found`.

---

*Verified: 2026-07-03T12:50:45Z*
*Verifier: Claude (gsd-verifier)*
