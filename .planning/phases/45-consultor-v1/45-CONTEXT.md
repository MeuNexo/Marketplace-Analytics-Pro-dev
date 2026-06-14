# Phase 45: Consultor v1 - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Entregar o **Consultor v1**: um motor de regras **determinístico (sem LLM)** que roda **por org** (EF + cron), avalia ~12 regras sobre os dados reais já disponíveis no banco, grava na tabela `insights` (severidade, categoria, ação recomendada, impacto estimado em R$) e calcula um **score de saúde 0-100**. Isso é exposto na UI como:
- Card **"O que fazer agora"** no topo de `/vendas` (top insights acionáveis, linguagem leiga)
- **Painel de insights** com explicação por insight ("por que importa" / "como resolver")
- **Score de saúde** visível no topo de `/vendas`

Meta de aceitação: org Pé Vermeio gera **≥5 insights reais e acionáveis no 1º run**.

**Supabase project correto: `ckcdevcxgvueywivefgx`** (o `gionpsuunfkkzzjdubfy` do CLAUDE.md está desatualizado — NÃO usar).

**Fora de escopo (vão para outras fases):**
- UI para o lojista **editar os limiares** do consultor na tela → fase futura (UX). No v1 a config existe em tabela, editável só via SQL.
- Consultor com análises **geradas por LLM** → v8.0 (já deferido em STATE.md).
- Score/insights **separados por loja ML** → ideia futura; v1 consolida por org.
- **Snooze/adiar** insight → fora do v1 (só auto-resolver + dispensar).
- **Ação em 1 clique** a partir do insight (ex: pausar campanha direto) → fora do v1; o consultor só leva à página certa (não executa). Ações que alteram o ML exigem aprovação Wesley (regra de plataforma).
</domain>

<decisions>
## Implementation Decisions

### Conjunto de regras (CONSUL-01)
- **D-01:** **Todas as ~12 regras candidatas** entram no v1 (regras só disparam quando há problema real → mais cobertura, não mais ruído). Lista base em `REQUIREMENTS.md` (bloco CONSUL): margem < alvo; ROAS/ACoS fora da meta; TACoS subindo; ruptura/cobertura crítica; produto sem custo cadastrado; sem regime fiscal; ticket médio caindo; cancelamentos acima da média; anúncio pausado com histórico de venda; campanha gastando sem venda; meta do mês em risco; pergunta sem resposta > 24h.
- **D-02:** **Limiares vivem numa tabela de config por org** (ex: `consultor_config`, escopo `organization_id`), com defaults sensatos. Editável via SQL no v1; **sem UI de edição** nesta fase. Estruturada para permitir limiar diferente por org no futuro.

### Limiares das regras (defaults — D-02 os torna ajustáveis por org)
- **D-03 (Margem):** 2 níveis. **Crítico:** margem líquida ≤ 0% (vendendo no prejuízo). **Alerta:** margem líquida ≤ alvo configurável (**default 10%**). Fonte = margem real por SKU (`useMLProductMargins` / RPCs de margem, já com CMV/comissão/frete/imposto).
- **D-04 (Ads):** dois gatilhos. **Campanha gastando sem venda** = spend > 0 e 0 vendas na janela de **7 dias**. **TACoS alto** = acima do alvo (**default 15%**). (As demais regras de ads — ROAS/ACoS por anúncio — entram via D-01, mas o gatilho principal de desperdício é esse.)
- **D-05 (Estoque):** **Crítico** ≤ 7 dias de cobertura, **Alerta** ≤ 15 dias. Reusar `useMLCoverage` (classes ruptura/crítico/alerta já existem) — adaptar limiares.
- **D-06 (Meta do mês em risco):** projeção por **run-rate do ritmo do mês**: `(receita acumulada / dias decorridos) × dias do mês`; dispara se projeção < meta. **⚠ `ml_targets` hoje é scoped por `user_id`, não `organization_id`** — o planner DEVE resolver como ler a meta por org no contexto do engine (service role/cron). Se a meta não for confiável por org, esta regra pode ficar de fora (decisão do planner com base no estado real).
- **D-07 (Tendências):** comparação **mês atual vs mês anterior** (ticket médio caindo, cancelamentos acima da média).
- **D-08 (Lookback):** **anúncio pausado com histórico de venda** olha **30 dias**; **campanha gastando sem venda** olha **7 dias** (D-04).

### Score de saúde 0-100 (CONSUL-04)
- **D-09:** **Ponderado** (não igual): **Margem 30, Ads 25, Estoque 20, Reputação 15, Completude 10** (= 100). Reflete que rentabilidade e desperdício de ads pesam mais no bolso.
- **D-10:** **3 faixas com cor e rótulo**, alinhadas aos tokens existentes (`kpi.positive/negative`): **0-49 Crítico (vermelho)**, **50-74 Atenção (amarelo)**, **75-100 Saudável (verde)**.
- **D-11:** Pilar **Completude** reusa a tabela **`onboarding_progress`** (Phase 43): ML conectado, custos cadastrados, regime fiscal, (Tiny opcional). Zero infra nova para esse pilar.
- **D-12:** Mostrar **score + tendência (▲/▼ vs mês anterior)**. Exige **snapshot histórico do score por org a cada run** (nova tabela/coluna, ex: `consultor_health_snapshots` — planner define a forma).

### Impacto estimado em R$ (CONSUL-01)
- **D-13:** **Fórmula específica por regra onde houver R$ óbvio; qualitativo (só severidade) onde não houver.** Exemplos de fórmula: margem perdida × volume vendido; spend desperdiçado em campanha sem venda; venda perdida por ruptura = giro médio × preço. Regras sem R$ direto (ex: pergunta > 24h, reputação) mostram só severidade.
- **D-14:** **Framing = perda/desperdício atual estimado** ("Você está perdendo ~R$ X"). Mais urgente e honesto que "ganho potencial".
- **D-15:** **Período base = projeção mensal** (extrapola o impacto para o mês). Planner ajusta por regra quando o horizonte mensal não fizer sentido.

### Card "O que fazer agora" + Painel (CONSUL-02, CONSUL-03)
- **D-16:** Card mostra **Top 3** insights; link "ver todos" abre o painel completo.
- **D-17:** Priorização = **severidade primeiro, depois impacto R$** (críticos no topo; dentro do nível, ordena pelo maior R$). Previsível para o lojista.
- **D-18:** Ciclo de vida = **auto-resolver + dispensar**. Insight some sozinho quando a condição deixa de existir (engine recalcula a cada run); lojista pode **dispensar** manualmente. **Sem snooze** no v1 (precisa persistir estado de "dismissed" por insight/org).
- **D-19:** No painel, "como resolver" = **texto leigo + link para a página certa já filtrada** (ex: `/publicidade` na campanha, `/anuncios` no produto). Acionável, mas **não executa ação automática**.

### Engine: cadência e taxonomia (CONSUL-01, CONSUL-05)
- **D-20:** **Cron diário** (após o sync da manhã) **+ run on-demand no 1º acesso** (quando o usuário abre `/vendas` e não há run recente). Garante ≥5 insights já no primeiro acesso de uma org recém-onboarded (CONSUL-05).
- **D-21:** **3 níveis de severidade** (Crítico / Alto / Médio — alinhados às faixas do score) + **categorias = os 5 pilares** (Margem, Ads, Estoque, Reputação, Config) + Vendas/Meta.
- **D-22:** Texto de cada insight = **templates por regra com variáveis** (produto, R$, %), determinístico, sem LLM. Ex: *"O produto X está vendendo no prejuízo (−R$ Y/mês). Reveja o preço ou o custo."*
- **D-23:** **Por org consolidado**, identificando a loja ML no insight quando aplicável (ex: "Loja X: campanha Y sem venda"). Score único da org. Visão de COO.

### Claude's Discretion (planner decide)
- Schema exato da tabela `insights` (colunas, índices, RLS org-first) e da `consultor_config` / `consultor_health_snapshots`.
- Mapeamento exato de **pilar → nota 0-100** (como cada pilar converte seus dados em pontuação dentro do seu peso).
- Fórmulas finais de impacto R$ por regra (D-13) e horizonte por regra (D-15).
- Onde computar (EF Deno vs RPC SQL vs híbrido) — desde que rode por org, via cron + on-demand (D-20), e respeite RLS org-first.
- Texto-modelo final dos ~12 insights (Wesley sinalizou abertura a revisar; planner/UI pode redigir e submeter a checkpoint).
- Resolução do escopo org de `ml_targets` para a regra de meta (D-06).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap / requisitos desta fase
- `.planning/ROADMAP.md` §"Phase 45: Consultor v1" — goal + success criteria
- `.planning/REQUIREMENTS.md` — bloco CONSUL-01..05 (linhas 46-52) + lista de regras candidatas
- `.planning/STATE.md` — Supabase project correto (`ckcdevcxgvueywivefgx`); ressalva `ml_targets` sem `organization_id`; aprendizado pg_cron Pattern B (vault `SERVICE_ROLE_KEY` = chave `sb_secret_`)
- `.planning/phases/43-multi-tenant-hardening/43-CONTEXT.md` — padrão RLS org-first, escopo `organization_id` + `ml_user_id`, `onboarding_progress`

### Fontes de dados das regras (reusar hooks/RPCs — não recriar)
- `src/hooks/useMLProductMargins.ts` — margem real por SKU (regra de margem, D-03)
- `src/hooks/useMLMarginAnalysis.ts` — agregados de margem (summary/byProduct/byBrand)
- `src/hooks/useMLAds.ts` (+ `computeAdsSummary`, `useMLAdsDerivedMetrics.ts`) — ROAS/ACoS/TACoS/spend (D-04)
- `src/hooks/useMLCoverage.ts` — cobertura/ruptura em dias, classes ruptura/crítico/alerta (D-05)
- `src/hooks/useMLReputation.ts` — reputação (pilar score + regra)
- `src/hooks/useMLClaims.ts` — cancelamentos/devoluções (regra de cancelamentos)
- `src/hooks/useMLQuestions.ts` — perguntas sem resposta > 24h
- `src/hooks/useMLProductCosts.ts` — produtos sem custo cadastrado
- `supabase/migrations/20260407120000_create_ml_targets.sql` — meta mensal (⚠ scope `user_id`/`seller_id`, sem `organization_id` — D-06)
- `ml_tax_config` (módulo Fiscal) — regra "sem regime fiscal" + pilar Completude

### UI / integração
- `src/pages/MercadoLivre.tsx` — página `/vendas`: topo onde entram o card "O que fazer agora" e o score de saúde
- `supabase/migrations/20260614123000_tenant04_onboarding_progress.sql` — tabela `onboarding_progress` (pilar Completude, D-11)
- `src/components/onboarding/` + `src/hooks/useOnboardingProgress.ts` — padrão de leitura de progresso

### Infra de engine/cron (padrões a seguir)
- `supabase/functions/sync-ml-orders/`, `sync-ml-claims/`, `sync-ml-questions/` — padrão de EF de sync por org (cron Pattern B)
- `supabase/migrations/20260614110000_pg_cron_questions_claims.sql` — padrão pg_cron Pattern B (vault `sb_secret_`)
- `supabase/functions/sync-ml-inventory/index.ts` — `checkAndIncrementQuota()` / guard `is_org_member` (padrão de segurança org-scoped)
- `/root/nexo-mcp/` e `/root/nexo/` — padrões de scores/insights já validados no COO Nexo que podem ser portados como referência conceitual
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Hooks de dados já cobrem **todas as 5 dimensões do score e quase todas as regras** (margem, ads, cobertura, reputação, claims, perguntas, custos) — o engine consome dados que já existem no banco/RPCs.
- `onboarding_progress` (Phase 43) — base direta do pilar Completude (D-11) e da lógica de "1º run" (D-20).
- `useMLCoverage` — classes ruptura/crítico/alerta já implementadas; só adaptar limiares 7/15 dias (D-05).
- Tokens `kpi.positive/negative/neutral` + shadcn/ui — base das 3 faixas de cor do score (D-10) e dos cards de insight, sem novas deps.
- `useMLProductMargins`/RPCs de margem agregada (`20260527110000_margin_aggregate_rpcs.sql`) — margem real por SKU já calculada.

### Established Patterns
- Escopo de dados sempre `organization_id` + `ml_user_id`; RLS **org-first** (`is_org_member`/`get_org_role`) — aplicar nas tabelas novas (`insights`, `consultor_config`, snapshots).
- EF de sync por org + **pg_cron Pattern B** (vault `SERVICE_ROLE_KEY` = `sb_secret_`, não JWT legacy) — modelo para o cron do engine (D-20).
- Migrations aplicadas via **MCP `apply_migration`** no `ckcdevcxgvueywivefgx` (CLI local linkado no projeto errado — NÃO usar `db push`).
- Service role ignora RLS — o engine (EF/cron) escreve `insights` livremente; o gap a cobrir é a policy do role `authenticated` (leitura por org).

### Integration Points
- Card "O que fazer agora" + score → topo de `src/pages/MercadoLivre.tsx` (`/vendas`).
- Painel de insights → nova rota/página ou seção (planner define) + deep-links para `/publicidade`, `/anuncios`, `/estoque`, `/perguntas` já filtrados (D-19).
- Engine → nova EF + pg_cron + run on-demand disparado pelo frontend quando stale (D-20).
- Score histórico → snapshot por run para tendência (D-12).
</code_context>

<specifics>
## Specific Ideas

- A meta de **≥5 insights no 1º run** (CONSUL-05) é o critério-âncora: por isso D-01 (todas as 12 regras) + D-20 (run on-demand no 1º acesso).
- Consultor é o **diferencial de venda** do SaaS (PROJECT.md) — clareza leiga e foco (Top 3, D-16) importam mais que volume de insights na tela.
- Framing de **perda atual em R$** (D-14) escolhido por ser mais motivador/honesto que ganho potencial.
- Nada de **ação automática** sobre o ML a partir do consultor (D-19) — coerente com a regra de plataforma "ações precisam aprovação Wesley".
</specifics>

<deferred>
## Deferred Ideas

- **UI para o lojista editar os limiares** do consultor (config editável na tela) — fase futura de UX (Phase 46 ou v8.0).
- **Snooze/adiar** insight ("lembrar depois") — v2 do consultor.
- **Ação em 1 clique** a partir do insight (ex: pausar campanha, ajustar preço direto) — depende de fluxo de aprovação; futuro.
- **Score e insights separados por loja ML** — v1 consolida por org (D-23); separação por loja fica para depois.
- **Consultor com análises geradas por LLM** — v8.0 (já deferido em STATE.md).

None além dos acima — discussão ficou dentro do escopo da fase.
</deferred>

---

*Phase: 45-consultor-v1*
*Context gathered: 2026-06-14*
