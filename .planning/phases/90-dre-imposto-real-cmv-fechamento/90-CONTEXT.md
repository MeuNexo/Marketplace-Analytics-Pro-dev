# Phase 90: DRE — Imposto real e CMV cheio no fechamento do mês - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Source:** Discussão consolidada com Wesley (07-06) + reconciliação da DRE de junho contra a planilha dele (memória `project_garment_dre_resultado_completa`).

<domain>
## Phase Boundary
Hoje o DRE do `/vendas` desconta imposto **sempre** pela estimativa automática por item (`~tax_amount`, "por dentro" da margem) e usa CMV a **custo médio**. Isso está correto apenas para o **mês em aberto** (funciona como provisão). Esta fase faz o DRE distinguir mês **ABERTO** vs **FECHADO**:
- **Mês aberto** (guia da competência ainda não lançada na Tiny): mantém o comportamento atual — imposto estimado (provisão) + CMV custo médio.
- **Mês fechado** (guia já lançada na Tiny): troca a estimativa pelo **imposto real** das guias (`impostos_venda` por competência, via `get_dre_operational_by_competence`) e troca o CMV para **preço de custo cheio**.

Fecha o milestone "DRE de Resultado" alinhando a foto do mês com a DRE do Wesley (planilha). **Bloqueia o merge da Phase 88** — devem ir juntas para prod, senão prod exibe −R$29k enganoso (a estimativa de ~20% infla o imposto; com imposto real, junho ≈ break-even).
</domain>

<decisions>
## Decisões (LOCKED com Wesley — 07-06)
- **Régua de imposto:** por **mês de referência (venda) = "de onde a venda ocorreu"**. Wesley confirmou que a competência da guia no Tiny JÁ é o mês da venda → usa a guia **direto, SEM deslocar −1 mês**. O bloco `impostos_venda` que a RPC `get_dre_operational_by_competence` retorna por competência É o imposto real daquela venda.
- **Gatilho provisão→real:** existe guia `impostos_venda` para a competência? Se **não** → mês aberto → estimativa automática (provisão). Se **sim** → mês fechado → imposto real da(s) guia(s). Determinístico.
- **CMV no fechamento = PREÇO DE CUSTO CHEIO, não custo médio.** Motivo (Lucro Real não-cumulativo): a apuração de crédito/débito de ICMS/PIS/COFINS já está embutida na guia real; usar custo líquido/médio **+** guia contaria o crédito 2×. Par correto = **(custo cheio + guia real)**; par aproximado (mês aberto) = **(custo médio + estimativa)**. "preço de custo" vs "custo médio" = os **dois campos da Tiny** (Preço de custo cadastrado manual vs Custo médio calculado por entradas de compra) — Wesley confirmou.
- **Mês aberto = zero regressão.** Não mexer no número/aparência do mês corrente. Só o mês fechado muda de base.
- **UI:** selo/badge explicando a base usada — "imposto real (guia)" vs "imposto estimado (provisão)". Consistente com o dashboard (tokens, BRL, semáforo +/−), **light+dark**, **mobile** (padrão Phase 78).
- **Escopo = só Mercado Livre**, org Pé Vermeio (`7f615df7`, seller 1639558873 — a única no Tiny com custos). Anti-IDOR por `organization_id` + `SECURITY INVOKER`.
</decisions>

<canonical_refs>
## Canonical References
**Downstream agents MUST read these before planning or implementing.**

### Composição da margem / DRE no /vendas (onde vive a estimativa de imposto e o CMV)
- `src/pages/MercadoLivre.tsx` — página `/vendas`; compõe a "DRE do mês" client-side (margem = receita − impostos estimados − tarifas ML − CMV − ads). Ponto onde entram `tax_amount` (~20%) e o CMV. **Mapear exatamente qual variável carrega o imposto estimado e qual RPC/campo alimenta o CMV (custo médio vs preço de custo) — SC#4, NÃO assumir.**
- `src/components/mercadolivre/MLCostCard.tsx` — card que renderiza a DRE; a Phase 88 já anexou os blocos operacionais aqui (reusa a var `lucro`). É onde o selo provisão/real deve aparecer.
- `src/hooks/useDreOperational.ts` (Phase 88) — hook que chama `get_dre_operational_by_competence(p_org_id, p_month)`; já retorna o bloco `impostos_venda`. Reusar para obter o imposto real por competência.
- `src/lib/dreOperational.ts` (Phase 88) — lib de composição do resultado; extensão natural do cálculo aberto/fechado + testes.

### Fonte do imposto real e do CMV
- RPC `get_dre_operational_by_competence` (migrations `20260687000000` + `20260687000100`) — bloco `impostos_venda` (ICMS/PIS/COFINS) por competência. Já em prod.
- Custo do produto: localizar a fonte atual do CMV no `/vendas` — candidatos `get_cost_waterfall`, `get_product_costs`, `get_margin_with_ads_by_product`, `mlCacheService`. Verificar se expõe custo médio E preço de custo, ou se falta um campo (pode exigir migration/RPC nova para trazer o preço de custo cheio).

### Infra / convenções
- Supabase garment = **`ckcdevcxgvueywivefgx`** (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md). Deploy de migration/EF só via Supabase MCP (`apply_migration`/`deploy_edge_function`) — não há token CLI para este projeto.
- `src/components/financial/CostCompositionChart.tsx` (paleta CVD-safe por índice, Phase 85) se precisar de cores.
- Worktree de trabalho: `/root/garment-glow-dre`, branch `gsd/phase-86-dre-competencia` (mesma branch onde a Phase 88 está; a 90 vai junto no mesmo PR).
</canonical_refs>

<specifics>
## Pontos concretos
- **Reconciliação junho (validada):** DRE do Wesley ≈ **+R$849,97** (break-even); nossa DRE atual = **−R$29k**. Gap = imposto: dashboard estima ~R$53k "por dentro"; junho real ≈ R$0 (guia ainda não saiu). Batem: capital de giro −20.027, contabilidade −1.953, folha/pró-labore ~24.000.
- **Junho está em LIMBO:** hoje é 06/jul; a guia de junho sai ~20-25/jul (competência=junho). Até lá, junho fica na **provisão**. **Investigar o que é o R$4.793 já visto em `impostos_venda` de junho** (resíduo/parcial/guia de outro mês?) — não assumir que é a guia de junho.
- **Caso de reconciliação da fase:** escolher um mês de 2026 **anterior a junho cuja guia já esteja na Tiny** (mês fechado) e provar que o DRE com (imposto real + custo cheio) bate com a planilha do Wesley.
- Alíquota efetiva real histórica ≈ 2-10% (planilha do Wesley, coluna "Porcentagem de Imposto") — MUITO menor que os ~20% estimados; é o que explica o −29k vs break-even.
</specifics>

<deferred>
## Fora do escopo desta fase
- IRPJ/CSLL (empresa não recolhe hoje) e FGTS (só INSS) — decidido não incluir.
- Separar juro×principal do Empréstimo (financeiro aproximado, pendente tabela de amortização do banco) — Phase 87 deixou como flag "aproximado".
- Classificar `outros_operacionais` (Serviços gerais / Impostos-taxas residual) — quando Wesley definir.
- Verificar possível duplicidade "Pró-labore CEO" 2× em junho (R$10k + R$2k) — tarefa de dados à parte.
- Ajustar a **provisão do mês aberto** para uma alíquota efetiva histórica (~5-8%) em vez dos ~20%: Wesley disse que o **cálculo automático atual está correto como provisão** → NÃO mexer nele nesta fase. Só o mês fechado troca de base.
</deferred>

---
*Phase: 90-dre-imposto-real-cmv-fechamento · Context 2026-07-06*
