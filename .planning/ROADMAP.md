# Roadmap — v8.0 Consultor v2 (Inteligência)

## Overview

Cinco fases transformam o Consultor v1 (motor determinístico de ~12 regras + score 0-100, em prod) numa camada de inteligência aditiva: fundação de dados (Phase 52), análise narrativa por LLM (Phase 53), pipeline de ação com aprovação (Phase 54), drill-down por loja (Phase 55) e ajuste fino — snooze + limiares na UI (Phase 56).

**Princípio inviolável:** nada substitui o motor determinístico do v1 — tudo é aditivo. O LLM recebe SÓ a saída estruturada do v1 (insights serializados), nunca dados crus para recalcular. Toda ação que altera o ML passa por aprovação do owner (nunca auto-executa).

Supabase project: **ckcdevcxgvueywivefgx** (não o ID em CLAUDE.md). Deploy: push → Vercel auto. LLM: Claude Haiku 4.5 via raw fetch em Deno EF, `ANTHROPIC_API_KEY` no vault Pattern B.

Research completo: `.planning/research/SUMMARY.md` (HIGH confidence). Requisitos: `.planning/REQUIREMENTS.md` (28 reqs / 5 trilhas).

## Phases

- [x] **Phase 52: Fundação de Dados v8.0** — Tabelas (llm_analysis_cache, proposed_actions com state-machine de 6 estados, action_audit_log) + colunas (insights.snoozed_until/ml_user_id, consultor_config: limiares editáveis + llm_enabled) + RLS org-first + transição atômica + RPCs base + types.ts. Bloqueia 53–56. **(completed 2026-06-24 — aplicada em prod ckcdevcxgvueywivefgx, advisors sem erro novo, build verde)**
- [x] **Phase 53: Camada LLM (Análise Inteligente)** — Resumo narrativo estilo COO + "Explicar" por insight, com cache por org/dia, grounding anti-alucinação e kill-switch (LLM-01..07). **(completed 2026-06-24 — provedor Gemini 2.5 Flash, não Anthropic; EF v4 blindada verify_jwt=true; validado em preview + kill-switch demonstrado)**
- [ ] **Phase 54: Pipeline de Ações com Aprovação** — Propor ação (diff + impacto) → fila → aprovar → executor ML (preço/anúncio/ads) com gate atômico, pre-flight e audit log imutável (ACT-01..08).
- [ ] **Phase 55: Drill-down Multi-Loja** — Score e insights por loja ML, seletor com badge de saúde, score org = média ponderada por GMV (STORE-01..05).
- [ ] **Phase 56: Ajuste Fino (Snooze + Limiares na UI)** — Adiar insights (amanhã/semana/30d, server-side) + editor de limiares com presets, preview ao vivo e guardrails (SNZ-01..03, TUNE-01..05).
- [x] **Phase 57: Nexo Conversacional (Chat Consultor)** — Painel de chat flutuante "Nexo" em todas as telas; multi-turno efêmero; persona COO + TODOS os playbooks embutidos; function-calling read-only escopado por org (anti-IDOR) para puxar dados ao vivo da conta; grounding numérico; kill-switch reusado; guardrails de custo (NEXO-01..07). **MERGEADA PRA PROD (PR #9, merge 670ac8be) junto com Phase 58. Pendente: E2E Wesley logado.**
- [ ] **Phase 59: Fluxo de Caixa — Correções (Projeção 7d + Sync Contas a Pagar)** — (a) a linha de projeção (média 15d) não infla os primeiros dias: nos primeiros 7 dias segue só o confirmado e, do 8º dia em diante, a média só preenche dias SEM recebimento confirmado; (b) o contas a pagar volta a sincronizar com o Tiny e PERSISTIR ≥1x/dia (hoje congelado em 18/06 — `net.http_post` estoura o timeout default de 5s vs ~15s da EF, e mesmo com 200 não grava). Correção do Fluxo de Caixa da Phase 49 (CASHFIX-01, CASHFIX-02). **Planejada 2026-06-25 — 2 plans (1 wave), plan-checker PASS de 1ª. Pronta p/ `/gsd-execute-phase 59`.**
- [x] **Phase 58: Nexo — Veracidade & Completude dos Dados** — Corrigir a falta/inconsistência de informação que faz o Nexo afirmar fatos errados (ex: "0 em estoque/ruptura" lendo só o Full, não o consolidado; estoque item-level mascarando variações; sem sinal de frescura). Auditoria fonte-da-verdade das tools vs o que o dashboard mostra; estoque consolidado + por variação; frescura (synced_at); declarar limitação em vez de inventar (VERAC-01..06). **DEPLOYADA (EF nexo-chat v5 + cron billing); re-auditoria VERAC-07 PASS. Pendente: E2E Wesley + rotação de segredos.**
- [ ] **Phase 60: Alinhamento da DFC (Fluxo de Caixa)** — Fechar a projeção do `/caixa` com a DFC/Tiny do Wesley. (a) ENTRADA: dia 8+ usa `GREATEST(d.inc, v_sma)` para a média R$5.880/dia virar PISO (a cauda do MP com recebimentos minúsculos parava de suprimir a média); (b) SAÍDA: `get_cashflow` ganha parâmetro `p_include_purchase_forecasts BOOLEAN DEFAULT false` — por padrão exclui `category='Previsões de compra'` (reconciliação provada ao centavo: R$99.495,58 − R$12.389,79 previsões = R$87.105,79 = Tiny do Wesley) e resolve a OC383 contada 2x; (c) toggle "Incluir previsões de compra" na UI /caixa. Continuação da Phase 59 (CASHFIX-05, CASHFIX-06). **Planejada 2026-06-25.**
- [ ] **Phase 61: Enriquecer Fornecedor + Categoria do Contas a Pagar** — Os gráficos **Composição de Custos por Mês** (só "Outros" + "Previsões de compra", sem categorias reais) e **Exposição por Fornecedor** (só Pralana) só funcionaram 1x e voltaram a quebrar. Causa-raiz: em `cash_outflows`, 1991/2011 linhas têm `category` vazia E `supplier` nulo. O endpoint Tiny `/contas-pagar` (LISTA) NÃO traz categoria nem fornecedor — só o DETALHE `/contas-pagar/{id}` traz (`categoria.descricao` + `contato.nome`). O `sync-tiny-payables` lê só a lista → grava NULL e, a cada sync, **sobrescreve** o que o enriquecimento-detalhe da Phase 51 (fila `cat_backfill_queue` + `enrich_drain`/`enrich_harvest` via pg_net/cron) havia preenchido; o enqueue usa `ON CONFLICT DO NOTHING`, então linhas `done` nunca são re-enriquecidas. Fix (opção A, aprovada): (a) `sync-tiny-payables` para de escrever `category`/`supplier` no upsert → enriquecimento vira fonte única; (b) `enrich_harvest` passa a gravar TAMBÉM `supplier = contato.nome` (hoje só categoria); (c) enqueue re-marca `todo` toda linha com `category IS NULL OR supplier IS NULL`, sobrevivendo a re-syncs; (d) rodar o backfill das ~2011 linhas via fila/cron já existentes (Tiny ~1–2 req/s, drain throttled ~20–30 min, resumível). Continuação da Phase 51 + Phase 60 (CASHFIX-07, CASHFIX-08). **Planejada 2026-06-25.**
- [x] **Phase 62: Reposição Server-Side (Compra Recomendada correta)** — Substitui a "Compra Recomendada" do front (estoque digitado + venda simulada, sem lead time/segurança/gatilho/MOQ/custo) por uma RPC `get_replenishment` server-side: estoque real (`ml_inventory_cache` Full+anúncios), venda/dia real, ponto de reposição com gatilho, MOQ/embalagem, custo nulo/sem-giro, parâmetros global + por marca/fornecedor. Não sugere mais comprar o que já se tem (REPL-01..11). **EXECUTADA + VERIFICADA (PASS 7/7) 2026-06-25 — RPC `get_replenishment` + tabela `replenishment_params` aplicadas em prod via MCP (116 anúncios, 29 sugeridos, gatilho cortando 87, anti-IDOR provado); módulo TS + 203 testes verdes; aba "Compra Recomendada" em /estoque. (completed 2026-06-25)**
- [x] **Phase 65: Compras — Estoque a Chegar** — A `/compras` passa a considerar as ordens de compra em trânsito do Tiny: nova EF `sync-tiny-purchase-orders` (endpoint `/ordem-compra`, waitUntil) → tabela `purchase_orders` (RLS org-first) + cron diário; a RPC `get_replenishment_by_sku` ganha CTE `incoming_by_sku` e desconta TODA a qtd a caminho da sugestão (decisão Wesley), expondo `qtd_a_caminho`/`data_proxima_chegada`; frontend ganha coluna "A caminho". **EXECUTADA + VERIFICADA 2026-06-26 — backend em prod via MCP (22 OCs/135 SKUs/1.885 un; 93 SKUs a caminho, 80 zeraram sugestão; cobertura parcial preservando gatilho); tsc 0 + 208 testes + build ok. Frontend no PR (aguarda ok visual). (completed 2026-06-26)**
- [x] **Phase 66: Compras v2 — Override por Fornecedor** — A `/compras` ganha um terceiro nível de parametrização de reposição: **por fornecedor**, entre SKU e marca (precedência `SKU > fornecedor > marca > global`). As ordens de compra do Tiny passam a gravar o **fornecedor** (`contato.nome`) em `purchase_orders`; a RPC `get_replenishment_by_sku` resolve os params do SKU também pelo fornecedor predominante; o frontend ganha CRUD de params por fornecedor (dropdown). Diferido da Phase 62. **EXECUTADA + VERIFICADA (5/5 must-haves) 2026-06-26 — backend em prod via MCP (migration registrada + EF v2 deployada + re-sync 200/200 OCs com fornecedor/6 distintos; RPC 4 níveis provada param_origem='fornecedor', sem regressão, anti-IDOR SECURITY INVOKER, advisors limpos); frontend 213/213 testes + tsc 0 + build ok na branch `gsd/phase-66-override-fornecedor`. Checkpoints D-12/D-13 (nomes) e schema-push aprovados por Wesley. Pendente: ok visual + merge PR. (completed 2026-06-26)**
- [x] **Phase 67: Compras v3 — Reposição mais esperta (tendência + lead time real)** — A reposição da `/compras` deixa de usar só a média simples e o lead time fixo: velocidade = **EWMA (recência) + índice sazonal marca/mês**; lead time = **mediana real por fornecedor** das OCs; cada camada com **fallback transparente** + toggle "Cálculo esperto" + badges. **EXECUTADA + VERIFICADA (6/7 must-haves; 7º = ok visual pendente) 2026-06-26 — RPC v7 `p_smart` em prod via MCP: não-regressão p_smart=FALSE=Phase 66 (off_nao_simples=0); EWMA 171 SKUs, sazonal ATIVA 284 (13 meses de dados, fatores 0.93–1.68), lead-time-real 93; anti-IDOR SECURITY INVOKER; advisors limpos. Espelho TS + 33 testes (246/246); toggle+badges na /compras (tsc 0, build ok). 3 desvios corrigidos no checkpoint (DROP overload 3-arg ambíguo; p_smart DEFAULT FALSE; #variable_conflict use_column). Pendente: ok visual + merge PR. (completed 2026-06-26)**
- [x] **Phase 69: Reposição de esgotados (demanda censurada)** — SKUs esgotados (estoque 0) que não venderam nos últimos 30d ficam com `venda_dia=0` → `compra_sugerida=0` e somem da compra, mesmo tendo demanda real (83 SKUs hoje na Pé Vermeio, dos quais 70 venderam no último ano). Tratamento **híbrido por recência**: vendeu ≤90d → `repor_esgotado` (estima venda/dia pelo **melhor ritmo de 30d dentro de 180d** + proteção anti-pico ≥2 dias com venda; reusa ponto/alvo/MOQ/pack/a-caminho); vendeu 90–365d → `revisar_esgotado` (sinaliza, sem quantidade); sem venda há +1 ano → `descontinuar` (fora da compra). RPC `get_replenishment_by_sku` ganha `status_esgotado` + `venda_dia_origem='historico_esgotado'` (SECURITY INVOKER mantido); `/compras` ganha os 3 estados na coluna "O que fazer" + badge "demanda estimada pelo histórico" + opções no filtro Situação. Continuação da trilha /compras (62–68). Spec: `docs/superpowers/specs/2026-06-27-reposicao-esgotados-design.md`. **Planejada 2026-06-27.**

### Milestone — Modal de Detalhe do Anúncio (porte do nexointeligence)

> Replica o `ListingDetailModal` do projeto antigo (clicar anúncio → modal rico com info + ações). Decomposto MVP-first em 6 fases. Spec: `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md`.

- [x] **Phase 71: Modal de Detalhe — Shell + Indicadores** — Clicar na miniatura/ícone "Ver detalhes" de um anúncio em `MLAnuncios.tsx` abre um Dialog (`max-w-4xl`) com cabeçalho (título, MLB id, badges de variações e tipo de anúncio, "Ver no ML") e a aba **Indicadores** (quality score via `ProductItem.health`, variações com estoque/vendas, breakdown de tipo logístico, KPIs visitas/vendido/estoque/margem) — reusando só dados já carregados, **zero backend novo**. Abas Vendas/Precificação/Avaliações/Histórico aparecem desabilitadas ("em breve"). **EXECUTADA + VERIFICADA (7/7 SC) 2026-06-29 — 2 planos/2 waves; 6 arquivos novos em `components/mercadolivre/anuncios/`; 17 testes verdes, tsc 0, build OK; `MLAnuncios.tsx` +14 linhas (só estado+gatilho+render). Branch `gsd/anuncio-detail-modal`. Pendente: ok visual Wesley + merge PR.**
- [x] **Phase 72: Aba Quality Score + Issues** — EF nova `ml-listing-health` (API `/item/{id}/performance` + fallback `/items/{id}/health` do ML, busca ao vivo) enriquece a aba Indicadores com lista de problemas acionáveis em PT-BR. **EXECUTADA + VERIFICADA (6/6 SC no código) 2026-06-29 — 2 planos/2 waves; EF deployada (ACTIVE v1, verify_jwt=true) em `ckcdevcxgvueywivefgx`, auth smoke OK; hook `useMLListingHealth` (lazy, guard `_ml_user_id`) + `ListingIssues` (6 estados) na aba Indicadores; `ListingQualityScore` intocado; 6 testes verdes, tsc 0, build OK. Branch `gsd/phase-72-quality-issues` (empilhada sobre 71). Pendente: E2E Wesley logado (smoke positivo real + 403 cross-org ao vivo) + merge.**
- [x] **Phase 73: Aba Vendas** — Gráfico de vendas do anúncio (toggle unidades/receita + seletor 30/90d) a partir da tabela `orders` existente, via query direta (RLS). **EXECUTADA + VERIFICADA (6/6 SC) 2026-06-29 — 1 plano/3 tasks; util puro `listingSalesAgg` + hook lazy `useMLListingSales` (query `orders` item_id+status=paid, cast `data_pedido` TEXT slice(0,10), paginação MAX_ROWS) + `ListingSalesTab` (recharts) ativando a aba; 309 testes, tsc 0, build OK; sem EF/RPC, sem regressão 71/72. Branch `gsd/phase-73-aba-vendas`. Pendente: ok visual Wesley + merge.**
- [ ] **Phase 74: Aba Precificação** — Reaproveita a calculadora existente (`MLPrecificacao`) embutida no modal.
- [ ] **Phase 75: Aba Avaliações** — EF de reviews do ML + resumo IA dos comentários.
- [ ] **Phase 76: Ação "Melhorar com IA" + Histórico de Otimização** — Pipeline IA gera sugestão → aplica via MCP `update_listing_*` **com aprovação** → registra histórico (com revert).
- [x] **Phase 77: Produtos Vendidos + Análise de Preços (porte do app oficial)** — Porte do app oficial (zip 2026-07-01) como DOIS itens separados no grupo Dashboard do menu (não sub-abas de MLAnuncios). Independente do modal (71–76). (completed 2026-07-01)

---

## Phase Details

### Phase 52: Fundação de Dados v8.0

**Goal**: O schema e as RPCs que sustentam as 4 trilhas existem em produção, com RLS org-first e a state-machine de ações atômica — pronto para LLM, ações, snooze, limiares e por-loja serem construídos por cima sem retrabalho de modelo.
**Depends on**: Phase 45 (Consultor v1 — tabelas insights/consultor_config/snapshots em prod)
**Requirements**: base transversal de LLM-*, ACT-*, SNZ-*, TUNE-*, STORE-*
**Success Criteria** (what must be TRUE):

  1. `llm_analysis_cache` (PK org-first: organization_id, analysis_date, prompt_version) criada com RLS org-first — 1 linha por org/dia
  2. `proposed_actions` criada com state-machine de 6 estados (proposed→approved→executing→done/failed; rejected de proposed|approved) + índice de dedup `(organization_id, rule_key, target_ref) WHERE status IN ('proposed','approved','executing')`
  3. `action_audit_log` criada append-only/imutável (actor_id, from_status, to_status, detail jsonb ≤4KB), RLS org-first, sem UPDATE/DELETE
  4. `insights` ganha `snoozed_until timestamptz` e identificação de loja (`ml_user_id`/store ref) quando aplicável; `consultor_config` ganha colunas de limiares editáveis + `llm_enabled boolean`
  5. RPC de transição atômica `UPDATE ... WHERE status='approved' RETURNING *` (SECURITY INVOKER, escopo org) + REVOKE de anon/public
  6. `types.ts` atualizado; migrations aplicadas em ckcdevcxgvueywivefgx via MCP; advisors sem erro crítico novo

**Plans**: 2 plans

- [x] 52-01-PLAN.md — 4 migrations (proposed_actions + action_audit_log + llm_analysis_cache + ALTERs + RPC claim_approved_action) aplicadas via MCP em ckcdevcxgvueywivefgx
- [x] 52-02-PLAN.md — types.ts atualizado manualmente (3 tabelas novas + 5 colunas) + build verde

---

### Phase 53: Camada LLM (Análise Inteligente)

**Goal**: O lojista vê um resumo do consultor em linguagem natural (PT-BR, estilo COO) e pode pedir "Explicar" em cada insight — gerado por LLM sobre os insights determinísticos, cacheado, sem inventar números, desligável por org.
**Depends on**: Phase 52
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, LLM-07
**Success Criteria** (what must be TRUE):

  1. EF `consultor-llm` (Deno, raw fetch Anthropic, Haiku 4.5) recebe SÓ insights serializados + scores; system prompt estático ≥4096 tokens com cache ephemeral 1h
  2. Cache-check é a PRIMEIRA operação da EF (anti-blowup de retry); resposta gravada em llm_analysis_cache por org/dia/prompt_version
  3. Resumo no topo do painel conecta os pilares com narrativa causal (ex: "TACoS subiu 6%, puxando a margem -3pp")
  4. "Explicar" por insight gera explicação sob demanda, cacheada por insight/dia
  5. Validação numérica pós-geração: qualquer valor não rastreável à entrada estruturada → cai para o texto determinístico do v1 (LLM-05)
  6. Indicador "análise desatualizada — clique para atualizar" quando o estado dos insights muda após a geração; botão respeita cap diário por org
  7. Kill-switch por org em `consultor_config.llm_enabled` — desligado volta ao consultor determinístico puro

**Plans**: 2 plans

- [x] 53-01-PLAN.md — EF consultor-llm (**Gemini 2.5 Flash** via raw fetch, não Haiku; cache-check first + grounding + numericGuard + upsert) + GEMINI_API_KEY vault + config.toml. EF v4 blindada (verify_jwt=true, sem smoke_token)
- [x] 53-02-PLAN.md — UI: resumo COO no topo de /vendas + "Explicar" por insight (modo explain na EF) + badge "análise desatualizada" + "Atualizar análise" + kill-switch/fallback caem pro v1

---

### Phase 54: Pipeline de Ações com Aprovação

**Goal**: A partir de um insight acionável, o lojista propõe uma mudança no ML (preço/anúncio/ads), o owner aprova numa fila, e só então o executor aplica — à prova de duplicação, de IDOR e de proposta obsoleta, com auditoria completa.
**Depends on**: Phase 52
**Requirements**: ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, ACT-06, ACT-07, ACT-08
**Success Criteria** (what must be TRUE):

  1. "Propor ação" mostra preview de diff (atual → proposto + impacto estimado em R$/margem) antes de enviar
  2. Ação proposta entra em fila de aprovação com badge de contagem de pendentes; owner aprova ou rejeita
  3. Ação aprovada executa no ML (alterar preço, pausar/ativar anúncio, pausar/ajustar campanha de ads) via executor — nunca sem aprovação
  4. Execução à prova de duplicação (gate atômico UPDATE WHERE status='approved' RETURNING) e de IDOR (ação+token escopados a organization_id + ml_user_id)
  5. Proposta obsoleta (dado do ML mudou desde a criação) bloqueada/sinalizada antes de executar (pre-flight + TTL)
  6. Toda transição registrada em action_audit_log imutável (ator, de→para, timestamp, resposta ML trimada)
  7. Owner vê histórico de ações executadas com o resultado de cada uma

**Plans**: 3 plans

- [ ] 54-01-PLAN.md — EF `consultor-actions` (executor): 5 mutações ML (PUT /items + PUT /advertising/product_ads/campaigns api-version:2) portadas do Nexo MCP, gate atômico `claim_approved_action` (409), pre-flight + TTL 48h, token-por-org (anti-IDOR), audit ≤4KB, dry_run preview
- [ ] 54-02-PLAN.md — `useConsultorActions` (queue/badge/propose/dryRun/approve/reject/history paginado) + `actionMapping` (rule_key→action_type) + testes unit
- [ ] 54-03-PLAN.md — UI no `/consultor`: abas Insights|Fila|Histórico owner-only, `ProposeActionDialog` (diff+impacto), `ActionQueue` (aprovar c/ confirmação, staleness badge), `ActionHistory` + checkpoint visual

---

### Phase 55: Drill-down Multi-Loja

**Goal**: Quem tem mais de uma loja ML enxerga score e insights por loja, com a visão consolidada da org como default e o score agregado ponderado pelo faturamento de cada loja.
**Depends on**: Phase 52 (engine/score), Phase 53 (narrativa por loja — integra se presente)
**Requirements**: STORE-01, STORE-02, STORE-03, STORE-04, STORE-05
**Success Criteria** (what must be TRUE):

  1. Engine calcula score e insights por loja ML, além do consolidado por org
  2. Seletor de loja faz drill-down; consolidado é default; seletor só aparece quando há > 1 loja
  3. Cada loja exibe badge de score (verde/amarelo/vermelho) no seletor
  4. Score consolidado da org = média dos scores das lojas ponderada pelo GMV de cada uma
  5. Cada insight identifica a loja ML afetada quando aplicável

**Plans**: TBD

---

### Phase 56: Ajuste Fino (Snooze + Limiares na UI)

**Goal**: O lojista adia insights que não quer ver agora e ajusta os limiares do consultor pela tela (sem SQL), com presets e preview ao vivo — sem nunca conseguir quebrar o próprio score.
**Depends on**: Phase 52
**Requirements**: SNZ-01, SNZ-02, SNZ-03, TUNE-01, TUNE-02, TUNE-03, TUNE-04, TUNE-05
**Success Criteria** (what must be TRUE):

  1. Adiar insight por duração nomeada (Amanhã / Próxima semana / Em 30 dias), persistido server-side em insights.snoozed_until
  2. Insight adiado some até expirar; ao expirar reaparece se a condição persistir (auto-resolver do v1 respeita o snooze)
  3. Editor de limiares na UI (margem alvo, TACoS alvo, dias de cobertura, etc.) — sem SQL
  4. Presets Conservador/Moderado/Agressivo preenchem todos os limiares de uma vez; "Restaurar padrão" volta aos defaults
  5. Preview ao vivo (debounced) mostra quantos produtos/insights disparariam com a config atual
  6. Guardrails de faixa válidos no cliente E no servidor — o lojista não consegue quebrar o próprio score

**Plans**: TBD

---

### Phase 57: Nexo Conversacional (Chat Consultor)

**Goal**: O lojista conversa com o **Nexo** — um consultor COO em chat (multi-turno) acessível de qualquer tela — que raciocina sobre os dados ao vivo da conta atual e responde calibrado por TODOS os playbooks da metodologia (estratégicos + ads), citando o playbook usado, sem inventar números, e sem nunca executar mudança sozinho (read-only; ações continuam na Phase 54 com aprovação).
**Depends on**: Phase 52 (consultor_config.llm_enabled / kill-switch), Phase 53 (EF Gemini + grounding + numericGuard reaproveitados). Integra Phase 54 (Nexo pode SUGERIR ação; disparo real passa pelo pipeline com aprovação).
**Requirements**: NEXO-01, NEXO-02, NEXO-03, NEXO-04, NEXO-05, NEXO-06, NEXO-07
**Success Criteria** (what must be TRUE):

  1. Painel de chat flutuante "Nexo" abre/fecha de qualquer página (botão no canto); conversa multi-turno fluida; só aparece quando ML conectado
  2. EF `nexo-chat` (Deno, Gemini, function-calling) com persona Nexo (COO PT-BR, foco lucro líquido) + TODOS os playbooks embutidos no system prompt; respostas citam `[playbook: X]` quando aplicável
  3. Function-calling read-only: Nexo puxa dados ao vivo sob demanda (margem por SKU, sales velocity, ads, estoque crítico, KPIs do dia, insights, DRE) via tools — CADA query escopada ao `organization_id` do JWT (anti-IDOR), nunca org fornecida pelo modelo
  4. Conversa efêmera: histórico mantido no cliente e enviado a cada turno; nenhuma tabela nova de mensagens
  5. Grounding numérico: números nas respostas vêm de tool-results/contexto; instrução estrita anti-invenção (mesma filosofia do numericGuard da 53)
  6. Kill-switch reusa `consultor_config.llm_enabled` — desligado, o painel Nexo fica indisponível
  7. Guardrails de custo/latência: cap de tool-calls por turno + timeout; o chat é read-only (não dispara mutação ML — sugere e encaminha pro pipeline da 54)

**Decisões travadas (Wesley 2026-06-24):**

- **Modelo:** chat usa **Gemini 2.5 Pro** (`gemini-2.5-pro:generateContent`, mesmo endpoint/header `x-goog-api-key`, `thinkingConfig.thinkingBudget=0` se truncar) — barra "especialista de verdade". Resumo/explicar da 53 seguem no Flash. Modelo configurável via `consultor_config.llm_model`.
- **Local:** painel de chat **flutuante** em todas as telas. **Conversa efêmera** (histórico no cliente, sem tabela nova).
- **Persona + playbooks:** a voz/metodologia vem da skill Nexo em `/root/.claude/skills/nexo/` — `references/strategic_playbooks.md` (Laura/Gabriel/Estela/Rafael) + `references/ads/` (playbooks, benchmarks, pitfalls, glossary). ~49KB total → embutir TUDO no system prompt (cabe no contexto Gemini). O planner deve COPIAR esses arquivos para dentro do repo (ex: `supabase/functions/nexo-chat/playbooks.ts`) — a EF não tem acesso a `/root/.claude`.
- **Function-calling read-only:** tools que mapeiam a RPCs/dados já existentes em ckcdevcxgvueywivefgx (margem por SKU, sales velocity, ads, estoque crítico, KPIs do dia, insights, DRE). CADA tool filtra por `organization_id` do JWT (anti-IDOR) — nunca org vinda do modelo. Cap de tool-calls por turno + timeout.
- **Reuso:** mesma base da EF `consultor-llm` (auth JWT + is_org_member, vault `get_app_secret('GEMINI_API_KEY')`, verify_jwt=true, kill-switch `consultor_config.llm_enabled`).
- **Read-only:** chat NÃO muta o ML; quando sugere ação, encaminha pro pipeline de aprovação da Phase 54.

**Plans**: 4 plans

- [ ] 57-01-PLAN.md — EF nexo-chat: vitest.config include estendido p/ supabase/functions/** (testes de EF rodam de verdade) + playbooks.ts (bundle versionado da skill Nexo) + prompt.ts (persona COO + buildSystemPrompt) + index.ts skeleton (auth→is_org_member→kill-switch→vault→Gemini 2.5 Pro non-streaming, thinkingBudget=-1) + config.toml (NEXO-02/05/06)
- [ ] 57-02-PLAN.md — Function-calling read-only: tools.ts (12 declarations sem param de org + dispatcher escopado anti-IDOR mapeando às RPCs reais) + loop.ts (runChat cap=5 + timeout 25s) + index.ts resolve mlUserIds server-side (NEXO-03/07)
- [ ] 57-03-PLAN.md — Frontend: useNexoChat (estado efêmero reenviado a cada turno) + NexoChatPanel (Sheet, render anti-XSS) + NexoChatFab (gate hasMLConnection + kill-switch) montado no LayoutShell (NEXO-01/04)
- [ ] 57-04-PLAN.md — Checkpoint: deploy da EF nexo-chat (orquestrador) + validação visual/comportamental de Wesley dos NEXO-01..07 (FAB em todas as telas, grounding, anti-IDOR, read-only)

---

### Phase 58: Nexo — Veracidade & Completude dos Dados

**Goal**: O Nexo nunca afirma um fato errado por falta/incompletude de dado. Cada tool reflete a fonte-da-verdade do dashboard (mesma fonte, escopo e semântica), o estoque é consolidado e por variação (ou claramente rotulado), há sinal de frescura, e quando falta dado o Nexo declara a limitação em vez de inventar. Validado por uma bateria de testes em TODOS os domínios — não só estoque.
**Depends on**: Phase 57 (as 22 tools existem e estão deployadas)
**Requirements**: VERAC-01, VERAC-02, VERAC-03, VERAC-04, VERAC-05, VERAC-06, VERAC-07
**Success Criteria** (what must be TRUE):

  1. Auditoria fonte-da-verdade das tools do Nexo vs o que o dashboard mostra (por domínio) documentada; toda divergência de fonte/escopo/semântica corrigida
  2. Estoque do Nexo = consolidado (Full + CD) quando existir; senão rotulado "Full" e sem afirmar ruptura como fato absoluto; estoque por variação quando o item tem variações
  3. Sinal de frescura (synced_at) disponível ao Nexo; dado defasado é sinalizado, não afirmado como atual
  4. Nexo não confunde campos (vendido≠estoque, receita≠lucro, Full≠total, passado≠projeção); descrições das tools inequívocas
  5. Quando uma tool retorna vazio/parcial, o Nexo declara o que tem/falta (sem inventar, sem "não configurado")
  6. Bateria de testes E2E por domínio (vendas, margem×4, ads×2, estoque/cobertura, caixa/tesouraria, DRE/custos, perguntas, devoluções, reputação, fornecedores, metas, alertas, score) — todos batendo com a fonte-da-verdade

**Plans**: 5/6 plans executed

- [x] 58-01-PLAN.md — tools.ts ESTOQUE: get_inventory status=active default + agregado + variações esgotadas + rótulo "Full" + synced_at; get_coverage rotulado (VERAC-01/02/04)
- [x] 58-02-PLAN.md — tools.ts VENDAS/ADS: get_ads_campaigns neutralizada + nova get_ads_account_summary; faturamento/status/top-50/attributed/waterfall rotulados (VERAC-03/06)
- [x] 58-03-PLAN.md — tools.ts FINANCEIRO: get_dre_monthly via ml_billing_daily mês-calendário + cashflow saldo_hoje + costs descrição; migration cron re-sync ml_billing_daily (VERAC-03/04/06)
- [x] 58-04-PLAN.md — tools NOVAS: get_reputation (EF ml-reputation) + get_goals (ml_targets por seller_id, anti-IDOR adaptado) + claims/health/questions limpos (VERAC-03/05)
- [x] 58-05-PLAN.md — prompt.ts: bloco VERACIDADE/FRESCURA/SEMÂNTICA (fonte certa, Full≠total, declarar limitação, sinalizar defasagem) (VERAC-04/05/06)
- [x] 58-06-PLAN.md — checkpoint: EF nexo-chat v5 DEPLOYADA (script 127kB, smoke 401/200) + cron `billing-daily-resync` aplicado e ATIVO (40 6 * * *) + re-auditoria VERAC-07 4 domínios PASS (58-VERIFICATION.md) + fix inline get_goals.gross_profit. **PENDENTE: validação E2E Wesley logado + rotação dos 2 segredos expostos.** (VERAC-07)

---

### Phase 59: Fluxo de Caixa — Correções (Projeção 7d + Sync Contas a Pagar)

**Goal**: O gráfico de Fluxo de Caixa não infla mais os primeiros dias com previsão, e o contas a
pagar volta a sincronizar com o Tiny de forma confiável (≥1x/dia, com persistência real) — sem o
congelamento desde 18/06.
**Depends on**: Phase 49 (Fluxo de Caixa) + Phase 50 (Simulador, que herda o baseline)
**Requirements**: CASHFIX-01 (projeção), CASHFIX-02 (sync payables)
**Success Criteria** (what must be TRUE):

  1. Na RPC `get_cashflow`, `accumulated_balance_sma` para datas ≤ hoje(BRT)+7 usa só o recebimento
     confirmado (sem média); do 8º dia em diante usa o confirmado nos dias que têm recebimento e a
     média de 15d **somente nos dias sem recebimento** — validado no gráfico (primeiros 7 dias sem inflação)

  2. A linha confirmada e os valores reais (reconciliados ao centavo com a DFC do Wesley) permanecem intactos
  3. Causa-raiz da não-persistência do `sync-tiny-payables` identificada e corrigida; `net.http_post`
     com timeout adequado (ou disparo assíncrono) — a EF deixa de ser abortada aos 5s

  4. `cash_outflows` volta a atualizar: `count(DISTINCT synced_at::date)` cresce dia a dia; total/abertos
     refletem o Tiny ao vivo

  5. (opcional, decidir no plano) indicador de "última atualização do contas a pagar" na UI de fluxo de caixa

**Plans**: 2 plans (1 wave — independentes, arquivos disjuntos)

- [x] 59-01-PLAN.md — CASHFIX-01: RPC `get_cashflow` regra de projeção 7d (CASE em accumulated_balance_sma + daily_projection, data BRT) + legenda/JSDoc frontend. **Aplicada via MCP em prod; validada por SQL (dias 1-7 sem inflação) + reconciliação DFC (saldo inicial corrigido 21.676,91→16.833,14)**
- [x] 59-02-PLAN.md — CASHFIX-02: EF `sync-tiny-payables` + `EdgeRuntime.waitUntil` (202 imediato) + modo debug síncrono. **Causa-raiz REAL: pg_net derrubava a execução de ~15s aos 5s antes do commit (não os 4 suspects). Provado em prod: congelamento 18/06 quebrado, synced_at avançando, 1991 contas gravadas. EF v5 deployada (prod==repo). Cron funciona sem migration nova**

Contexto/diagnóstico: `phases/59-fluxo-caixa-correcoes/59-CONTEXT.md`

---

### Phase 60: Alinhamento da DFC (Fluxo de Caixa)

**Goal**: A projeção do gráfico de Fluxo de Caixa (`/caixa`) reflete a DFC/Tiny do Wesley — entrada
projetada de R$5.880/dia como piso (sem a cauda do MP suprimindo a média) e saídas reconciliadas ao
centavo com o contas a pagar do Tiny, com as "Previsões de compra" controláveis por toggle na UI.
**Depends on**: Phase 59 (Fluxo de Caixa — Correções; baseline `get_cashflow` regra 7d + CASHFIX-04 pending-only)
**Requirements**: CASHFIX-05 (entrada piso GREATEST), CASHFIX-06 (toggle previsões de compra)
**Success Criteria** (what must be TRUE):

  1. Na RPC `get_cashflow`, do 8º dia em diante a linha `accumulated_balance_sma` usa `GREATEST(d.inc, v_sma)`
     — a média de 15d vira piso; recebimentos confirmados maiores que a média mantêm o real. Dias 1-7 seguem
     confirmado-only (regra travada na Phase 59, intacta). `daily_projection` no dia 8+ = `GREATEST(0, v_sma - d.inc)`

  2. `get_cashflow` aceita 4º parâmetro `p_include_purchase_forecasts BOOLEAN DEFAULT false`; com `false` a CTE
     `exp` filtra `AND COALESCE(category,'') <> 'Previsões de compra'` (além do `status='pending'`); com `true` soma as previsões

  3. Reconciliação provada: com toggle OFF, soma das saídas em aberto de 05–12/07 = R$87.105,79 (= Tiny do Wesley),
     e a OC nº 383 deixa de ser contada 2x (some a cópia "previsão" de 09/07, fica a conta real de 11/07)

  4. A assinatura antiga de 3 args é substituída sem ambiguidade (`DROP FUNCTION public.get_cashflow(uuid,date,date)`
     antes do `CREATE` de 4 args); `SECURITY INVOKER` + `REVOKE` de PUBLIC/anon + `GRANT` authenticated preservados

  5. Toggle "Incluir previsões de compra" na página `/caixa` (desligado por padrão) propaga o 4º parâmetro pro RPC;
     a linha confirmada (`accumulated_balance`) permanece intacta

**Plans**: 2 plans (1 wave — arquivos disjuntos). plan-checker PASS.

- [x] 60-01-PLAN.md — Backend: migration get_cashflow 4-arg (entrada piso GREATEST + filtro de Previsões de compra). **Aplicada em prod via MCP; reconciliação provada: OFF=87.105,79 / ON=99.495,58 / OC383 1x / chamada 3-args sem ambiguidade**
- [x] 60-02-PLAN.md — Frontend: toggle "Incluir previsões de compra" (off por padrão) na /fluxo-de-caixa; `useCashFlowData` propaga o 4º arg. **Build verde; commit c910be2f pushado**
- [x] 60-03 (feedback Wesley) — toggle move também os indicadores de SALDO/PROJEÇÃO (TreasuryPanel saldo/alerta/mín + get_projected_balance_summary), NÃO a Exposição por fornecedor (100% previsões — zeraria). Migration 20260660000200 + hooks/prop. **Provado em prod; commit 9d614b1d pushado.** Descoberta: `supplier` só existe nas OCs (dívida de sync futura)

Continuação direta da Phase 59. Diagnóstico fechado nesta sessão (2026-06-25) com dados live + decisões do Wesley. **Pendente: validação visual do Wesley em /fluxo-de-caixa (curva OFF vs DFC + toggle ao vivo).**

---

### Phase 61: Enriquecer Fornecedor + Categoria do Contas a Pagar

**Goal**: Os gráficos "Composição de Custos por Mês" e "Exposição por Fornecedor" da `/fluxo-de-caixa` passam a mostrar as categorias reais do plano de contas do Tiny e os fornecedores reais (multi-fornecedor), e se mantêm estáveis após cada `sync-tiny-payables` (não voltam a "Outros"/só-Pralana).
**Depends on**: Phase 51 (backfill de categoria via fila `cat_backfill_queue` + `enrich_drain`/`enrich_harvest`), Phase 60 (DFC alinhada; descoberta de que `supplier` só existia nas OCs)
**Requirements**: CASHFIX-07 (enriquecimento é fonte única de category/supplier; sync para de sobrescrever), CASHFIX-08 (backfill repovoa as 2011 linhas com categoria + fornecedor)
**Success Criteria** (what must be TRUE):

  1. `sync-tiny-payables` NÃO escreve mais `category` nem `supplier` no upsert de `cash_outflows` (on-conflict preserva os valores enriquecidos); um sync executado após o backfill não zera nenhuma linha já enriquecida (contagem de `category IS NOT NULL` não cai)
  2. `enrich_harvest` grava `supplier = contato.nome` além de `category = categoria.descricao` ao processar o detalhe `/contas-pagar/{id}`
  3. O enqueue (`treasury_cat_enqueue` / função de enfileiramento) re-marca `todo` toda linha de `cash_outflows` com `category IS NULL OR supplier IS NULL`, em vez de `ON CONFLICT DO NOTHING` que pula as `done`
  4. Após drain do backfill, `cash_outflows` tem ≥ 90% das linhas com `category` não-nula E `supplier` não-nulo (hoje 20/2011); `COUNT(DISTINCT supplier) > 1` e `COUNT(DISTINCT category) > 1`
  5. Em produção, "Composição de Custos por Mês" mostra ≥ 3 categorias reais (além de "Outros"/"Previsões de compra") e "Exposição por Fornecedor" mostra ≥ 2 fornecedores reais
  6. Nenhuma regressão na DFC da Phase 60: `get_cashflow` (toggle OFF/ON), reconciliação R$87.105,79 e a Exposição por Fornecedor seguindo o comportamento da Phase 60 (não some/zera)

**Plans**: 3 plans (3 waves)

- [ ] 61-01-PLAN.md — Código fonte única: remover category/supplier do upsert da EF sync-tiny-payables + migration enrich_payable_step/enrich_enqueue_new/enrich_harvest (Wave 1, autônomo)
- [ ] 61-02-PLAN.md — Go-live + prova do risco A1 (preservação no ON CONFLICT, com fallback de trigger) + seed/drain do backfill ≥90% (Wave 2, checkpoints via MCP)
- [ ] 61-03-PLAN.md — Validação final: estabilidade pós-sync + gráficos em prod (≥3 categorias, ≥2 fornecedores) + no-regressão Phase 60 (R$87.105,79) (Wave 3, checkpoints)

---

### Phase 62: Reposição Server-Side (Compra Recomendada correta)

**Goal**: A "Compra Recomendada" deixa de calcular no front com estoque digitado e venda simulada, e passa a sair de uma RPC `get_replenishment` server-side que usa estoque real (`ml_inventory_cache`, Full+anúncios), venda/dia real, modelo de ponto de reposição (lead time + meta de cobertura + estoque de segurança) com gatilho, MOQ/embalagem e tratamento de custo nulo/sem-giro — parametrizável global + por marca/fornecedor. Não sugere mais comprar o que já se tem.
**Depends on**: Phase 58 (estoque consolidado/veracidade — fonte `ml_inventory_cache`)
**Requirements**: REPL-01 (RPC server-side), REPL-02 (estoque real ML), REPL-03 (venda real), REPL-04 (ponto de reposição + gatilho), REPL-05 (params global+marca/fornecedor), REPL-06 (MOQ/pack), REPL-07 (custo nulo), REPL-08 (sem giro), REPL-09 (sem "a chegar" + aviso), REPL-10 (UI read-only da fonte), REPL-11 (testes)
**Success Criteria** (what must be TRUE):

  1. RPC `get_replenishment` em prod (`SECURITY INVOKER`, escopada por org, sem `org_id` em parâmetro) retorna por anúncio: venda/dia real, estoque atual (`ml_inventory_cache` Full+anúncios), cobertura atual, ponto de reposição, sugestão de compra e valor estimado — sem cálculo pesado no front
  2. A sugestão só é > 0 quando `estoque_atual ≤ ponto_reposicao`; um item com estoque acima do alvo retorna compra = 0 (não sugere o que já se tem)
  3. Venda/dia vem de vendas REAIS na janela (default 30d), não da `priceCurve` simulada; `venda_dia = 0` → compra 0 + flag `sem_giro`
  4. Tabela `replenishment_params` com lead_time/meta_cobertura/safety/MOQ/pack configurável global + override por marca/fornecedor (precedência marca > fornecedor > global); a sugestão respeita MOQ e múltiplo de embalagem
  5. Custo nulo → quantidade sugerida mesmo assim, valor R$ omitido + flag `custo_ausente`; a tela mostra aviso fixo de que o v1 NÃO desconta compras a chegar
  6. A tela `/estoque` (CompraRecomendadaPanel) consome a RPC: colunas read-only da fonte (estoque, venda/dia, cobertura, ponto, sugestão, valor, flags, params usados) — sem inputs digitados de estoque
  7. Testes unitários da fórmula + casos da RPC verdes (normal; estoque>alvo→0; sem giro; custo nulo; MOQ/pack; override por marca; fallback sem vendas); sem regressão de build

**Plans**: 3/3 plans complete

- [x] 62-01-PLAN.md — [W1] Backend: migration `replenishment_params` (RLS org-first) + RPC `get_replenishment` (SECURITY INVOKER) + types.ts; apply via MCP + validação SQL [BLOCKING checkpoint] (REPL-01..08)
- [x] 62-02-PLAN.md — [W1] Módulo TS puro `replenishmentUtils.ts` + suite vitest (8 casos travados) (REPL-04/05/06/07/08/11)
- [x] 62-03-PLAN.md — [W2] Frontend: hook `useReplenishment` + `ReplenishmentPanel.tsx` + aba nova em `/estoque` + aviso "a chegar" (REPL-01/09/10)

Contexto/decisões: `phases/62-reposicao-server-side/62-CONTEXT.md`. Sistema antigo a substituir: `src/lib/analysis/compraUtils.ts` + `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx`.

Continuação da Phase 51 + Phase 60. Causa-raiz e estado do banco (1991/2011 com category vazia E supplier nulo) validados em 2026-06-25 com dados live; opção A aprovada pelo Wesley. **Planejada 2026-06-25.**

---

### Phase 63: Compras — Reposição por SKU (página própria)

**Goal**: Evolução da Phase 62. A reposição deixa de ser por anúncio e passa a ser por **SKU/variação** (tamanho/cor), com custos resolvidos por SKU (corrige "custo ausente"), **parâmetros editáveis** por UI (precedência SKU > marca > global), **filtros** na tela, e ganha **página própria `/compras`** (separada de `/estoque`). Inclui a fundação de dados que falta hoje: o sync passa a gravar o **SKU por variação** (estoque) e o **`seller_sku` por item de venda** (velocidade real por SKU).
**Depends on**: Phase 62 (RPC `get_replenishment`, tabela `replenishment_params`, módulo `replenishmentUtils`)
**Requirements**: CMP-01 (sync inventário grava SKU por variação), CMP-02 (sync vendas grava `seller_sku`/variação por item), CMP-03 (RPC reposição por SKU — estoque por variação via unnest, venda/dia por SKU; anúncio sem variação = SKU único), CMP-04 (custo casado por SKU corrige "custo ausente"), CMP-05 (params editáveis por UI, precedência SKU>marca>global, write owner/admin), CMP-06 (filtros: marca, status/gatilho, sem giro, com/sem custo, busca título/SKU/tamanho), CMP-07 (rota `/compras` + nav; aba removida de `/estoque`; legacy `compraUtils` intocado), CMP-08 (drill anúncio→variações + exportação), CMP-09 (testes por SKU + anti-IDOR `SECURITY INVOKER` + sem regressão)
**Success Criteria** (what must be TRUE):

  1. A reposição é calculada **por SKU/variação**: cada linha é uma variação (Cor/Tamanho) com estoque, venda/dia, cobertura, ponto, sugestão e custo próprios; anúncio sem variação aparece como SKU único
  2. O sync de inventário grava o **SKU da variação** (`seller_custom_field` por variação) e o sync de vendas grava o **`seller_sku`/variação por item de pedido** — venda/dia real por SKU (não rateada)
  3. **Custo casa por SKU da variação** → a taxa de "custo ausente" cai drasticamente vs. Phase 62 (44/116); custo nulo ainda gera sugestão + flag, sem valor R$
  4. **Parâmetros editáveis pela UI** (CRUD em `replenishment_params`): global, por marca e **por SKU**, precedência SKU > marca > global; write restrito a owner/admin (RLS mantida)
  5. A tela tem **filtros** (marca, status/gatilho ativo, sem giro, com/sem custo, busca por título/SKU/tamanho) e drill anúncio→variações; exportação disponível
  6. Existe a rota **`/compras`** no menu com a Compra Recomendada por SKU; a aba foi **removida de `/estoque`**; o `compraUtils` legado em `/precos-custos` permanece intocado
  7. RPC por SKU permanece **`SECURITY INVOKER`** (anti-IDOR: org alheia = 0 linhas); testes da fórmula por SKU + casos da RPC verdes; sem regressão de build

**Risco/aberto**: o cache atual mostra `seller_custom_field` da variação **nulo** (amostra MLB3818741753). O researcher DEVE validar na API do ML se o SKU por variação vem no payload antes de fixar CMP-01; se não vier, fallback = ponte via Tiny. `ml_product_daily_cache.seller_sku` está nulo p/ Pé Vermeio → CMP-02 mexe no pipeline de vendas (`mercado-libre-integration`/`sync-ml-orders`).

**Plans**: 4/5 plans executed

- [x] 63-05-PLAN.md

- [x] 63-01-PLAN.md — [W1] Fundação de dados: segundo-passe per-variação no `sync-ml-inventory` (grava `seller_custom_field` por variação) + migration CHECK `scope='sku'`; deploy EF + apply via MCP + validação SQL (CMP-01, CMP-05)
- [x] 63-02-PLAN.md — [W1] Motor backend: RPC `get_replenishment_by_sku` (SECURITY INVOKER, unnest jsonb + venda via `ml_orders` + custo por SKU + params SKU>marca>global) + `resolveParamsBySku`/testes + types + hook `useReplenishmentBySku`; apply via MCP + anti-IDOR (CMP-02/03/04/05/09)
- [x] 63-03-PLAN.md — [W2] Frontend `/compras`: página + tabela com drill anúncio→variações + filtros + export xlsx + CRUD de params (owner/admin) + rota/nav; remove aba de `/estoque` (CMP-05/06/07/08)
- [ ] 63-04-PLAN.md — [W3] Verificação: testes+build sem regressão + prova SQL (custo ausente cai vs 44/116 + anti-IDOR) + ok visual do Wesley (CMP-09)

Contexto/decisões: `phases/63-compras-reposi-o-por-sku-p-gina-pr-pria/63-CONTEXT.md`. Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; projeto Supabase `ckcdevcxgvueywivefgx`. **Planejada 2026-06-25 — 4 plans (waves 1/1/2/3).**

---

### Phase 66: Compras v2 — Override por Fornecedor

**Goal**: A reposição da `/compras` passa a aceitar parâmetros (lead time, meta de cobertura, segurança, MOQ/pack, custo) e overrides **por fornecedor**, inserindo o nível "fornecedor" na precedência hoje existente — de `SKU > marca > global` para **`SKU > fornecedor > marca > global`**. Para isso: (a) as OCs do Tiny gravam o fornecedor (`contato.nome`) em `purchase_orders.fornecedor`; (b) `replenishment_params` aceita `scope='fornecedor'`; (c) a RPC `get_replenishment_by_sku` resolve params pelo fornecedor de origem do SKU; (d) o frontend `/compras` ganha CRUD de params por fornecedor (owner/admin). Diferido da Phase 62 (supplier não existia por item de venda/estoque — só passou a existir nas OCs na Phase 65).
**Depends on**: Phase 65 (tabela `purchase_orders`, EF `sync-tiny-purchase-orders`, RPC `get_replenishment_by_sku`), Phase 63 (página `/compras`, params SKU>marca>global, `replenishment_params`)
**Requirements**: FORN-01 (EF grava `fornecedor=contato.nome` nas OCs; coluna em `purchase_orders`), FORN-02 (`replenishment_params` aceita `scope='fornecedor'`), FORN-03 (RPC resolve precedência SKU>fornecedor>marca>global; regra de mapeamento SKU→fornecedor definida na discussão), FORN-04 (frontend CRUD params por fornecedor, owner/admin, precedência exibida), FORN-05 (testes + anti-IDOR SECURITY INVOKER + sem regressão)
**Success Criteria** (what must be TRUE):

  1. As OCs sincronizadas do Tiny gravam o **fornecedor** (`contato.nome`) em `purchase_orders.fornecedor`; OCs existentes repovoadas por re-sync
  2. `replenishment_params` aceita `scope='fornecedor'` e o CRUD da `/compras` permite criar/editar/remover params por fornecedor (write owner/admin)
  3. A RPC `get_replenishment_by_sku` aplica precedência **SKU > fornecedor > marca > global**: um SKU sem param de SKU mas com param do seu fornecedor usa o do fornecedor (não cai direto na marca/global)
  4. O mapeamento SKU→fornecedor está definido e documentado (ex.: fornecedor da OC mais recente que contém o SKU); SKUs sem OC caem para marca/global sem erro
  5. RPC permanece **SECURITY INVOKER** (anti-IDOR: org alheia = 0 linhas); testes da precedência (SKU/fornecedor/marca/global + fallback) verdes; sem regressão de build/testes da Phase 63/65

**Risco/aberto**: **mapeamento SKU→fornecedor** — resolvido na discussão (D-01/D-02): **fornecedor predominante** = maior `SUM(quantidade)` por fornecedor nas OCs do SKU; desempate = OC mais recente. SKU sem OC pula o nível fornecedor. Fundação de dados (coluna `fornecedor` + scope) já aplicada em prod mas **não commitada** (migration `20260666000000_fornecedor_scope.sql` untracked) + EF alterada localmente sem deploy — o plano 66-01 commita/deploya isso na branch `gsd/phase-66-override-fornecedor`.

**Plans:** 3 plans (3 waves, sequencial — ordem faseada D-12 com checkpoints bloqueantes)

Plans:

- [ ] 66-01-PLAN.md — Fundação: commit migration+EF, deploy+re-sync, gate D-12/D-13 (FORN-01, FORN-02) [wave 1]
- [ ] 66-02-PLAN.md — RPC: CTE fornecedor_by_sku + precedência 4 níveis + get_purchase_order_suppliers (FORN-03, FORN-05) [wave 2]
- [ ] 66-03-PLAN.md — Frontend: resolveParamsBySku 4 níveis + hook + dropdown no diálogo + testes (FORN-04, FORN-05) [wave 3]

Contexto/decisões: `66-CONTEXT.md` + `66-RESEARCH.md`. Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; projeto Supabase `ckcdevcxgvueywivefgx`. **Roadmap criado 2026-06-26 (retomada de sessão interrompida); planejado 2026-06-26.**

---

### Phase 67: Compras v3 — Reposição mais esperta (tendência + lead time real)

**Goal**: A "Compra Recomendada" da `/compras` fica mais precisa ao substituir a **média simples** da janela de vendas (e o **lead time fixo** dos params) por sinais melhores: (a) velocidade de venda ponderada por **tendência** (peso maior em períodos recentes) e/ou **sazonalidade**, em vez de média plana; (b) opcionalmente, **lead time real por fornecedor** derivado do histórico de OCs (intervalo `data_pedido`→`data_entrega`), em vez do parâmetro fixo. Mantém toda a fundação das Phases 62/63/65/66 (RPC `get_replenishment_by_sku`, params por escopo, a chegar, override fornecedor) — é melhoria do **motor de cálculo**, não da fundação de dados.
**Depends on**: Phase 66 (RPC `get_replenishment_by_sku` 4 níveis), Phase 65 (`purchase_orders` com `data_pedido`/`data_entrega`/`fornecedor` — fonte do lead time real)
**Plans:** 3 plans (2 waves)

Plans:

- [ ] 67-01-PLAN.md — RPC `get_replenishment_by_sku` v7: `p_smart` + CTEs `ewma_sales`/`seasonal_index`/`lead_time_by_fornecedor` + 5 colunas de transparência + checkpoint de aplicação/validação via MCP (wave 1)
- [ ] 67-02-PLAN.md — Espelho TS testável (`replenishmentUtils`): EWMA/sazonal/tendência/lead-time real + fallbacks com vitest (wave 2)
- [ ] 67-03-PLAN.md — Frontend: hook `p_smart` + toggle "Cálculo esperto" + badges de transparência na `/compras` + checkpoint visual (wave 2)

**Requirements**: SMART-01 (velocidade esperta = EWMA/recência + índice sazonal no nível marca/categoria, aplicado ao SKU), SMART-02 (lead time real por fornecedor = mediana do intervalo `data_pedido`→`data_entrega` das OCs em trânsito, reusando `fornecedor_by_sku`, fallback no param), SMART-03 (fallback transparente por dimensão + sinal "modo simples"; cada camada liga só com base suficiente, nunca inventa), SMART-04 (toggle "Cálculo esperto" on por padrão + badges de transparência; espelho TS testável + sem regressão + RPC SECURITY INVOKER anti-IDOR)
**Success Criteria** (what must be TRUE):

  1. Com o toggle "Cálculo esperto" ON, `venda_dia` da RPC reflete EWMA (recência) + ajuste sazonal (índice mensal marca/categoria) quando há base; OFF reproduz exatamente a média plana atual
  2. O lead time usado é a mediana real por fornecedor (das OCs em trânsito) quando há OCs; sem OC → cai no param (precedência da Phase 66 mantida)
  3. Cada camada esperta (EWMA/sazonal/lead-time) tem fallback independente para o cálculo simples quando falta dado; a tela sinaliza "modo simples" por SKU
  4. A tela mostra os sinais (tendência ↑↓, ajuste sazonal, lead time real vs param) via badges/tooltip
  5. RPC permanece SECURITY INVOKER (anti-IDOR); espelho TS (`replenishmentUtils`) cobre EWMA/sazonal/lead-time/fallbacks com testes; tsc/build/suite sem regressão das Phases 62-66

**Risco/aberto**: Pé Vermeio é seller pequeno → histórico curto pode limitar sazonalidade confiável; definir fallback (cair na média simples quando dados insuficientes). Escolher o método (tendência linear / EWMA vs sazonalidade explícita) e a fonte de lead time (ex.: mediana do intervalo das OCs por fornecedor) na discussão.

Contexto/decisões: a definir em `67-CONTEXT.md`. Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; projeto Supabase `ckcdevcxgvueywivefgx`. **Roadmap criado 2026-06-26.**

---

### Phase 69: Reposição de esgotados (demanda censurada)

**Goal**: SKUs esgotados (estoque 0) que não venderam nos últimos 30 dias **justamente porque estavam esgotados** ficam com `venda_dia=0` → `compra_sugerida=0` e somem da lista de compra, mesmo tendo demanda real (83 SKUs hoje na Pé Vermeio, 70 venderam no último ano). A `/compras` passa a tratar esses casos com um esquema **híbrido por recência**, estimando a demanda pelo melhor ritmo histórico em vez de descartar o SKU. É melhoria do **motor de cálculo** sobre a fundação das Phases 62–68 (RPC `get_replenishment_by_sku`) — não mexe na fundação de dados.
**Depends on**: Phase 67 (RPC `get_replenishment_by_sku` v7 `p_smart` + colunas de transparência), Phase 65 (`purchase_orders` — a-caminho)
**Plans:** 2 plans (2 waves)

Plans:

- [ ] 69-01-PLAN.md — RPC `get_replenishment_by_sku`: CTE de classificação por recência (`status_esgotado`) + estimativa "melhor ritmo 30d/180d" com proteção anti-pico + `venda_dia_origem='historico_esgotado'`; SECURITY INVOKER mantido; aplicação/validação via MCP (wave 1)
- [ ] 69-02-PLAN.md — Frontend `/compras`: 3 estados na coluna "O que fazer" + badge "demanda estimada pelo histórico" + opções no filtro Situação; espelho TS `replenishmentUtils` + vitest; sem regressão (wave 2)

**Requirements**: ESGOT-01 (classificação por recência: `repor_esgotado` ≤90d / `revisar_esgotado` 90–365d / `descontinuar` >365d, parametrizável), ESGOT-02 (estimativa de venda/dia = melhor janela de 30d dentro de 180d ÷ 30, com proteção anti-pico ≥2 dias com venda; reusa ponto/alvo/MOQ/pack/a-caminho), ESGOT-03 (transparência: `status_esgotado` + `venda_dia_origem='historico_esgotado'` na RPC; badge + filtro na tela distinguindo demanda estimada de real), ESGOT-04 (RPC SECURITY INVOKER anti-IDOR mantido; espelho TS + testes; sem regressão das Phases 62–68)
**Success Criteria** (what must be TRUE):

  1. SKUs esgotados que venderam ≤90d voltam a aparecer com `compra_sugerida > 0`, com venda/dia estimada pelo melhor ritmo histórico (não pela média zerada dos 30d)
  2. SKUs que venderam 90–365d aparecem como `revisar_esgotado` (sinalizados, sem quantidade sugerida)
  3. SKUs sem venda há +1 ano marcados `descontinuar`, fora do total de compra
  4. A tela `/compras` distingue visualmente demanda estimada de demanda real (badge "estoque zerado · demanda estimada pelo histórico")
  5. RPC permanece SECURITY INVOKER (anti-IDOR provado = 0 linhas cross-org); espelho TS cobre classificação + estimativa; tsc/build/vitest sem regressão das Phases 62–68

**Risco/aberto**: estimativa por "melhor ritmo" pode superdimensionar um pico isolado → proteção anti-pico (≥2 dias com venda) cai na média conservadora. Cortes 90d/365d e janela 180d parametrizáveis para calibração.

Contexto/decisões: `docs/superpowers/specs/2026-06-27-reposicao-esgotados-design.md` (spec aprovado por Wesley) → `69-CONTEXT.md`. Org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`; Supabase `ckcdevcxgvueywivefgx`. **Roadmap criado 2026-06-27.**

**EXECUTADA + VERIFICADA (5/5) 2026-06-27** — branch `gsd/phase-69-reposicao-esgotados`. Backend (69-01) APLICADO EM PROD via MCP: migration `20260669000000`, RPC com `status_esgotado` (4 baldes) + estimativa melhor-ritmo set-based (self-join, 2,1s<8s) + `venda_dia_origem='historico_esgotado'`. Prova prod (Pé Vermeio): com_giro 192 (87 compras / R$126.815 = **baseline idêntico, zero regressão**); **repor_esgotado 29 → 27 com compra, +232 un / R$21.219 resgatados**; revisar 59 / descontinuar 13 = compra 0; anti-IDOR cross-org 0; SECURITY INVOKER. Frontend (69-02) na branch: espelho TS + 22 testes (278/278), 3 estados na coluna "O que fazer" + badge "demanda estimada pelo histórico" + filtro Situação; tsc 0 + build ok. **MERGEADO PR #18 → prod (2026-06-27, merge da1ace9e); ok visual Wesley OK. Phase 69 COMPLETA.**

---

### Phase 71: Modal de Detalhe do Anúncio — Shell + Indicadores

**Goal**: O lojista clica num anúncio (na miniatura ou num ícone "Ver detalhes") na página de catálogo (`MLAnuncios.tsx`) e abre um Dialog central (`max-w-4xl`) com o cabeçalho do anúncio e uma aba "Indicadores" completa — quality score, variações, tipo logístico e KPIs (visitas/vendido/estoque/margem) — usando SOMENTE dados já carregados em `ProductItem` (zero chamada de backend nova). As demais abas (Vendas, Precificação, Avaliações, Histórico) já aparecem no shell, porém desabilitadas com tooltip "em breve", para as Phases 72–76 encaixarem sem refazer layout.
**Depends on**: nenhuma (reusa `MLInventoryContext.ProductItem` e helpers já existentes em `MLAnuncios.tsx`)
**Requirements**: ADM-71 (porte do `ListingDetailModal`, Fase A do milestone)
**Success Criteria** (what must be TRUE):

  1. Clicar na miniatura OU no ícone "Ver detalhes" de qualquer anúncio abre o modal com os dados daquele anúncio; o expandir-variações e o link do título permanecem funcionando (sem conflito de clique)
  2. A aba Indicadores mostra quality score (de `ProductItem.health`, com estado "sem dado" quando `null`), lista de variações com estoque/vendido, breakdown de tipo logístico, e KPIs visitas/vendido/estoque/margem — tudo com dados já em memória, sem nenhuma nova request de rede
  3. As abas Vendas/Precificação/Avaliações/Histórico aparecem renderizadas e desabilitadas, com tooltip "em breve"
  4. Botão "Ver no ML" abre o anúncio correto (`https://produto.mercadolivre.com.br/<MLB-id>`) em nova aba
  5. Multi-tenant intacto: o modal só recebe o `ProductItem` já filtrado por org/seller pelo contexto — nenhum dado novo cruza organização
  6. `tsc` sem erros + `build` ok; testes unitários dos utilitários novos (faixa de quality score; agregação de tipo logístico por variação) passando
  7. Componentes novos isolados em `src/components/mercadolivre/anuncios/` (`ListingDetailModal.tsx`, `ListingIndicatorsTab.tsx`, `ListingQualityScore.tsx`); a página `MLAnuncios.tsx` só ganha o estado de abertura + o gatilho (não inflar a página)

**Spec**: `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 5 — Fase A)

**Plans**: 2 plans (2 waves)

- [ ] 71-01-PLAN.md — Componentes do modal + utilitários puros (ListingDetailModal/IndicatorsTab/QualityScore + listingHelpers/listingIndicators + testes)
- [ ] 71-02-PLAN.md — Gatilho na página MLAnuncios.tsx (estado + miniatura/ícone) + refactor de helpers compartilhados

---

### Phase 72: Aba Quality Score + Issues

**Goal**: Ao abrir o modal de um anúncio, a aba Indicadores busca AO VIVO (lazy) a saúde detalhada do anúncio via uma nova edge function que chama a API do ML, e mostra — além do score já existente — a lista de problemas acionáveis (issues) daquele anúncio, em PT-BR. Sem tabela nova, sem cron: a EF é invocada on-demand quando o modal abre.
**Depends on**: Phase 71 (modal + `ListingIndicatorsTab` + `ListingQualityScore`)
**Requirements**: ADM-72
**Decisões travadas** (do alinhamento 2026-06-29):

  - Busca **ao vivo ao abrir o modal** (EF invocada on-demand, com estado de loading), NÃO sync em lote. Sem tabela nova, sem cron.
  - Issues aparecem **só dentro do modal** (aba Indicadores) — nada na tabela de catálogo nesta fase.
  - EF chama `GET /item/{id}/performance` (com fallback `GET /items/{id}/health`) da API ML, espelhando a `fetch-ml-listing-health` do projeto antigo `nexointeligence` (referência em `supabase/functions/fetch-ml-listing-health/index.ts` do repo antigo).
  - Token ML e multi-conta seguindo o padrão das EFs existentes (`ml-inventory`, `ml-token-refresh`); escopo por org/seller (anti-IDOR).

**Success Criteria** (what must be TRUE):

  1. Nova edge function (Deno) recebe `item_id` (+ `ml_account_id` quando conta vinculada), resolve o token ML org-scoped e retorna a saúde detalhada (score + lista de goals/actions/issues) do anúncio; trata erro/timeout do ML retornando estado explícito (não quebra o modal)
  2. A aba Indicadores invoca a EF **lazy** ao abrir o modal (só para o anúncio aberto), com estados loading / erro / vazio; o quality score já existente continua funcionando mesmo se a EF falhar
  3. Os issues são exibidos em PT-BR como lista acionável (o que melhorar no anúncio), dentro do `ListingIndicatorsTab` (reusa/estende `ListingQualityScore` ou um novo subcomponente isolado)
  4. Multi-tenant/anti-IDOR: a EF só retorna dados de anúncios da org/seller do chamador; nenhuma fuga cross-org
  5. Nenhuma tabela nova, nenhum cron novo; nenhuma regressão na aba Indicadores da Phase 71
  6. `tsc` 0 erros + `build` ok; EF deployada via MCP `deploy_edge_function` e testada (smoke) contra um anúncio real

**Spec**: `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 4, Fase B)

**Plans:** 2 plans (2 waves)
Plans:

- [ ] 72-01-PLAN.md — EF `ml-listing-health` (Deno): token org-scoped, anti-IDOR, `/item/{id}/performance` + fallback `/health`, normalização score + issues PT-BR; deploy via MCP + smoke (wave 1)
- [ ] 72-02-PLAN.md — Hook `useMLListingHealth` (lazy on-demand) + subcomponente `ListingIssues` PT-BR no `ListingIndicatorsTab`, com estados loading/vazio/erro (wave 2)

---

### Phase 73: Aba Vendas

**Goal**: A aba "Vendas" do modal (hoje desabilitada "em breve") passa a mostrar um gráfico do histórico de vendas do anúncio aberto, a partir da tabela `orders` já existente — com toggle **unidades vendidas ↔ receita (R$)** e seletor de janela **30/90 dias**. Busca via query direta no client (RLS org-scoped, sem EF/RPC nova).
**Depends on**: Phase 71 (modal + abas) ; complementa Phase 72
**Requirements**: ADM-73
**Plans**: 1 plan (1 wave)

  - [ ] 73-01-PLAN.md — util de agregação (+testes vitest), hook lazy `useMLListingSales`, componente `ListingSalesTab` (recharts + toggle + 30/90d) e wiring da aba no modal

**Decisões travadas** (alinhamento 2026-06-29):

  - Gráfico com **toggle unidades/receita** + **seletor 30/90 dias**.
  - **Query direta** via `supabase.from("orders")` (RLS org-scoped já existe — 2 policies, anti-IDOR pelo RLS; NÃO criar EF/RPC).
  - Filtro: `item_id` = anúncio aberto, `status = 'paid'` (alinhado ao resto do app), agregação por dia somando `quantidade` e `receita_bruta`.
  - **`data_pedido` é TEXT** → cast para data no agrupamento (lição da Phase 63).
  - Agrega TODAS as variações do anúncio (gráfico por item_id, não por SKU separado).

**Success Criteria** (what must be TRUE):

  1. A aba "Vendas" deixa de ficar `disabled`/"em breve" e renderiza um gráfico (recharts) com as vendas do anúncio aberto
  2. Toggle alterna entre **unidades vendidas/dia** e **receita (R$)/dia**; seletor alterna janela **30 ↔ 90 dias**, refazendo a consulta
  3. Dados vêm de `orders` via query direta filtrada por `item_id` + `status='paid'`, agregados por dia (cast de `data_pedido` TEXT→date); sem EF/RPC nova
  4. Estados tratados: loading (skeleton), vazio ("sem vendas no período") e erro — sem quebrar o modal nem as outras abas
  5. Multi-tenant: a query respeita o RLS org-scoped de `orders` (nenhum dado cross-org); lazy (só busca ao abrir o anúncio / ativar a aba)
  6. `tsc` 0 erros + `build` ok; testes do(s) utilitário(s) puro(s) de agregação (bucketização por dia, soma) passando

**Spec**: `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 4, Fase C)

---

### Phase 74: Aba Precificação

**Goal**: A calculadora de precificação já existente (`MLPrecificacao`/hooks de preço-custo) é reaproveitada embutida como aba dentro do modal, no contexto do anúncio clicado.
**Depends on**: Phase 71
**Requirements**: ADM-74

---

### Phase 75: Aba Avaliações

**Goal**: Nova(s) EF de reviews do ML traz as avaliações dos compradores do anúncio + um resumo por IA dos comentários, exibidos na aba Avaliações.
**Depends on**: Phase 71
**Requirements**: ADM-75

### Phase 76: Ação "Melhorar com IA" + Histórico de Otimização

**Goal**: O modal ganha a ação "Melhorar com IA" — pipeline IA gera sugestão de otimização do anúncio (título/descrição/atributos), que o owner aprova e aplica via MCP `update_listing_*` (nunca auto-executa), registrando em tabela de histórico de otimização com possibilidade de revert.
**Depends on**: Phase 71
**Requirements**: ADM-76

### Phase 77: Página Análise de Anúncios — Produtos Vendidos + Análise de Preços (porte do app oficial)

**Goal**: Portar da versão oficial do app (código de referência em `/root/garment-glow-official/` — extraído do zip enviado pelo Wesley em 2026-07-01) duas análises hoje ausentes no nosso dash, entregues como **DOIS itens separados no grupo "Dashboard" do menu lateral** (decisão do Wesley 2026-07-01: NÃO replicar como sub-abas de Relatórios em MLAnuncios como no app oficial): (1) **Produtos Vendidos** (rota própria, ex. `/produtos-vendidos`) — painel duplo marcas/categorias (receita+qtd) → produtos vendidos do grupo no período; (2) **Análise de Preços** (rota própria, ex. `/analise-precos`) — porte do componente `PrecoPraticadoReport` (evolução do preço praticado médio/mín/máx por anúncio + volume sobreposto, granularidade dia/semana/mês) com atalho a partir da listagem de anúncios. Menu definido em `src/components/layout/ApiSidebar.tsx` (grupo Dashboard) + rotas em `App.tsx` + `roleAccess.ts` (lição da Phase 54: rota fora do roleAccess = default-deny). Adaptar TODAS as queries ao nosso schema e lições aprendidas: tabela `orders` (não `ml_orders`), `data_pedido` TEXT → cast/slice, `status='paid'`, RLS org-scoped, paginação PostgREST `.range()`, sem subqueries correlacionadas em RPC INVOKER.
**Depends on**: nenhuma (independente do modal das Phases 71–76; a pasta `components/mercadolivre/analise/` já existe idêntica nos dois projetos)
**Requirements**: TBD
**Plans:** 3/3 plans complete

Plans:

- [x] 77-01-PLAN.md — Camada de dados + migration: util soldProductsAgg (+testes), hook useMLSoldProducts, RPC orders_price_timeseries [BLOCKING push no banco real]
- [x] 77-02-PLAN.md — UI: porte de PrecoPraticadoReport + páginas MLProdutosVendidos e MLAnalisePrecos
- [x] 77-03-PLAN.md — Fiação: rotas em App.tsx + roleAccess.ts (default-deny evitado) + 2 itens no menu Dashboard

### Phase 78: Revisao Mobile-First - responsividade e UX 100 por cento no mobile

**Goal:** Dashboard 100% responsivo e utilizável no mobile (360-430px): todos os 38 findings de auditoria (6 BLOCKER, 16 MAJOR, 16 MINOR) corrigidos, sem nenhum bug de layout/overflow/touch — nenhuma função é desktop-only.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 77
**Plans:** 4/4 plans executed — PHASE COMPLETE

Plans:

- [x] 78-01-PLAN.md — Shell + componentes compartilhados (MLPeriodPicker, OrganizationSwitcher/Header)
- [x] 78-02-PLAN.md — Páginas Dashboard (Publicidade, Financeiro, Produtos Vendidos, Análise de Preços, Vendas)
- [x] 78-03-PLAN.md — Operações (Anúncios + modal/sheet, Estoque, Pedidos, Precificação, Fluxo de Caixa)
- [x] 78-04-PLAN.md — Pós-venda + Configurações (Devoluções, Organização, Sellers, Integrações, Perfil, Fiscal, Perguntas, Metas)

### Phase 79: Análise de Preços com MCO — gráfico preço vs. break-even

**Goal:** A página `/analise-precos` responde "o preço praticado deu MCO?": (1) RPC `orders_price_timeseries` estendida com componentes firmes por bucket (cmv = Σ custo_unit×qtd, comissão, frete, qtd_sem_custo), mantendo SECURITY INVOKER (RLS de `orders`, padrão anti-IDOR Phases 63/69, sem subquery correlacionada); (2) util puro `src/lib/precoMcoSeries.ts` calcula MCO completo por bucket = venda − custo − comissão − frete − ads rateado − imposto, reusando `computeMco` (`src/lib/mco.ts`) + helpers `src/lib/tax/*` com `ml_tax_config`; ads rateado do spend do item (`ml_ads_products_cache`) proporcional à receita de cada bucket (melhor-esforço, carimbado); (3) gráfico refeito em `PrecoPraticadoReport`: linha preço praticado × linha break-even (R$/un) com colchão verde/vermelho entre elas + linha MCO% no eixo direito (saem as barras de volume e o toggle Qtd/Receita); toggle "incluir ads" (default ON); (4) KPIs: Preço médio · Break-even médio · MCO R$ · MCO % · Qtd · Receita; (5) avisos explícitos de custo ausente (nunca inventar número) e regime fiscal não configurado. Spec aprovada: `docs/superpowers/specs/2026-07-02-analise-precos-mco-design.md`.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 78
**Plans:** 3/3 plans executed — VERIFICATION PASSED 6/6 (pendente só ok visual Wesley em preview)

> Nota de planejamento (2026-07-02): decisão de design pós-research adotada (CONTEXT.md/spec adendo = fonte de verdade): imposto = `SUM(o.tax_amount)` firme na RPC (não taxa efetiva client-side) e **ads = série diária real de `ml_ads_products_cache` bucketizada pela granularidade** (NÃO rateio por receita — o texto "ads rateado" acima foi superado pelo adendo).

Plans:

- [x] 79-01-PLAN.md — Backend: migration DROP+CREATE da RPC (6 colunas firmes) + util puro `precoMcoSeries.ts` + testes (wave 1)
- [x] 79-02-PLAN.md — [BLOCKING] Aplicar migration via MCP + smoke reconciliação + anti-IDOR (checkpoint orquestrador, wave 2) — aplicada em prod, reconciliada ao centavo, anti-IDOR 0 linhas
- [x] 79-03-PLAN.md — UI: gráfico preço×break-even com colchão MCO + MCO% + toggle ads + 6 KPIs (wave 3) — executado; checkpoint visual Wesley PENDENTE (preview + PR #25)

### Phase 80: Análise de Preços — onde vendo bem

**Goal:** Redesenhar a visão principal de `/analise-precos` (`PrecoPraticadoReport.tsx`) para responder "em que preço eu vendo bem?", trocando a série temporal por um **histograma de faixas de preço**: eixo X = faixas de preço, altura da barra = volume OU lucro (toggle Unidades↔Lucro R$), cor + rótulo = margem % da faixa, marcador do preço recente. (1) util puro novo `src/lib/precoFaixas.ts` reagrupa **por faixa de preço** os pontos diários já reconciliados de `computePrecoMcoSeries` (mesma RPC `orders_price_timeseries`, sem recalcular custo/imposto), com bucketização "redonda" (série 1/2/5) centrada em ~90% das vendas e agregação de outliers de preço alto numa única barra "+R$X"; (2) veredito determinístico (sem LLM) — frase de saúde do preço atual (saudável/apertada/prejuízo por threshold `MCO_SAUDAVEL_PCT`) + frase da faixa ótima que acompanha o modo do toggle; (3) 4 KPIs enxutos (Preço recente · Margem recente % · Faixa campeã · Unidades no período) com comparativo vs. período anterior; (4) o gráfico de linha temporal atual (Phase 79) é **preservado** numa aba secundária recolhida "Evolução no tempo"; (5) cor de margem verde/âmbar/vermelho validada CVD-safe (skill dataviz, light+dark), com rótulo % em toda barra (cor nunca é sinal único). Spec: `docs/superpowers/specs/2026-07-02-analise-precos-onde-vendo-bem-design.md`. Plano: `docs/superpowers/plans/2026-07-02-analise-precos-onde-vendo-bem.md`.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 79
**Plans:** 2/2 plans complete

Plans:

- [x] 80-01-PLAN.md — Util `precoFaixas.ts`: bucketização por faixa de preço + veredito determinístico + testes (wave 1)
- [x] 80-02-PLAN.md — UI: histograma de faixas com toggle Unidades/Lucro + veredito + 4 KPIs + aba temporal secundária + CVD (wave 2, depende de 80-01)

### Phase 81: Giro e Cobertura por Faixa de Preço

**Goal:** Cada faixa de preço em `/analise-precos` (`PrecoPraticadoReport.tsx`) passa a mostrar **giro** (unidades/dia) e **cobertura em dias** do estoque atual, respondendo "nesse preço, em quanto tempo esvazio meu estoque?". (1) util puro `src/lib/precoFaixas.ts` estendido: conta dias-com-venda por faixa a partir dos `McoSeriesPoint` já em memória, calcula `giroDia = unidades ÷ diasNaFaixa` e `coberturaDias = estoqueAtual ÷ giroDia`, estende `FaixaPreco` com `diasNaFaixa/giroDia/coberturaDias/baixaConfianca` + constantes `MIN_DIAS_CONFIANCA=3` e `COBERTURA_RISCO_DIAS=7`; (2) estoque atual do anúncio vem de `ml_inventory_cache.available_quantity` por `item_id` via `MLInventoryContext` (DB-first, sem RPC/migration nova, sem mapear SKU); (3) UI: rótulo `~Xd` em cada barra (texto vermelho quando cobertura<7d; sufixo `?` + esmaecido quando baixa confiança), tooltip com giro/cobertura/estoque, frase de cobertura no cartão-veredito do preço vigente, rodapé de transparência (giro nos dias-com-venda do período; estoque = saldo atual). Cor da barra segue sendo saúde de margem (sem conflito de sinal). Spec: `docs/superpowers/specs/2026-07-02-giro-cobertura-por-faixa-design.md`.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 80
**Plans:** 2/2 plans executed — VERIFICATION human_needed (9/9 code truths OK; pendente só ok visual Wesley light/dark)

Plans:

- [x] 81-01-PLAN.md — Util `precoFaixas.ts` estendido: contagem de dias-com-venda por faixa + giro + cobertura + baixa confiança + constantes + frase de cobertura no veredito + testes (wave 1) — 366/366 testes, tsc limpo
- [x] 81-02-PLAN.md — UI `PrecoPraticadoReport.tsx`: estoque via MLInventoryContext, rótulo `~Xd` na barra (vermelho <7d, `?` esmaecido baixa confiança), tooltip giro/cobertura/estoque, frase no cartão-veredito, rodapé + checkpoint visual (wave 2, depende de 81-01) — implementado; **checkpoint visual Wesley PENDENTE**

### Phase 82: Análise de Preços por Variação (seletor de variação)

**Goal:** Adicionar um **seletor de variação** em `/analise-precos` (`PrecoPraticadoReport.tsx`). Por padrão a análise é do anúncio pai (Phase 81 intacta); ao selecionar uma variação, toda a análise — faixas de preço, giro, estoque e cobertura — passa a ser daquela variação, corrigindo o número enganoso do pai (cobertura pelo pai vira média que esconde rupturas por variação). (1) RPC `orders_price_timeseries` ganha parâmetro **opcional** `_sku text DEFAULT NULL` (quando não-nulo, `AND o.sku = _sku`; migration DROP+CREATE, SECURITY INVOKER, deploy via MCP no `ckcdevcxgvueywivefgx`); (2) UI: dropdown de variações do `MLInventoryContext` (label = tamanho + SKU + estoque; default "Todas (anúncio)"), passa `_sku` à RPC e injeta `estoqueAtual` = estoque da variação (do jsonb via `seller_custom_field`) em `computePrecoFaixas` — o util NÃO muda; (3) badge "analisando variação X" + aviso no nível pai ("N variações, M esgotadas — selecione uma para cobertura precisa"); reset ao trocar de anúncio; seletor oculto se `has_variations=false`. **LIÇÃO CRÍTICA:** vínculo vendas↔estoque é por **SKU** (`orders.sku` = `seller_custom_field`), NÃO `variation_id` (casou 0/43). Fora de escopo: métrica agregada "sustentável + % rompido" (descartada em favor do seletor). Spec: `docs/superpowers/specs/2026-07-03-analise-precos-por-variacao-design.md`.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 81
**Plans:** 3/3 plans executed — VERIFICATION passed 8/8 (RPC _sku em prod; pendente ok visual Wesley)

Plans:

- [x] 82-01-PLAN.md — Migration: `orders_price_timeseries` ganha `_sku text DEFAULT NULL` (predicado `AND o.sku = _sku`; DROP+CREATE; SECURITY INVOKER). Executor escreve o arquivo.
- [x] 82-02-PLAN.md — [BLOCKING/checkpoint do orquestrador] Migration aplicada em prod via MCP + smoke: retrocompat, prova cobertura 0d (variação) vs 6d (pai), reconciliação por SKU, anti-IDOR 0 linhas.
- [x] 82-03-PLAN.md — UI: util `variacoesResumo.ts` (8 testes) + dropdown de variação em `PrecoPraticadoReport.tsx` (`_sku` na RPC, estoque via `seller_custom_field`, badge, aviso do pai, reset). `precoFaixas.ts` intacto. 374/374 testes.

### Phase 83: MCO por anúncio em Produtos Vendidos + redesign UX

**Goal:** A página `/produtos-vendidos` (`src/pages/mercadolivre/MLProdutosVendidos.tsx`, painel duplo: esquerda = grupos Marca/Categoria, direita = anúncios do grupo) passa a mostrar MCO e responder "vende bem, mas sobra?". (1) DADOS: trocar a fonte da página de `orders_sold_products_agg` (só qtd+receita) para **fonte única** `get_margin_with_ads_by_product` (por `item_id`: receita/cmv/comissão/frete/imposto/`lucro`/`lucro_pos_ads`/`ads_spend`/`has_cmv`/`unidades`) — RPC já existente, SECURITY INVOKER, + pequena migration DROP+CREATE adicionando `marca` (para o agrupamento). Agregados por marca (painel esquerdo) = client-side pós-ads (Σ`lucro_pos_ads`÷Σ`receita`), NÃO `get_margin_by_brand` (pré-ads, inconsistente). Estoque continua do `MLInventoryContext` por `item_id`; critério de vendas unificado `paid+shipped+delivered` (números da tela mudam levemente vs. hoje que conta só `paid` — esperado). (2) PAINEL DIREITO: nova coluna **MCO%** (com ads = `lucro_pos_ads`) com semáforo CVD-safe (🔴 ≤5% · 🟡 6–8% · 🟢 ≥9%, rótulo % sempre visível, cor nunca é sinal único — skill dataviz) via constante `MCO_SAUDAVEL_PCT`; nova coluna **% Ads (ACoS)**; tabela **ordenável** por qualquer coluna (hoje fixa por receita); hover com quebra de custos (R$ MCO, ads, comissão, frete, imposto). (3) PAINEL ESQUERDO: MCO% por marca ao lado da receita, com bolinha de cor. (4) CABEÇALHO DO GRUPO: faixa-resumo ao selecionar marca (Receita total · MCO% médio · nº de anúncios no vermelho). Decisões travadas com Wesley (2026-07-03): MCO principal = com ads; formato = % com semáforo + R$/quebra no hover; faixas 🔴≤5/🟡6–8/🟢≥9; critério unificado paid+shipped+delivered. Supabase `ckcdevcxgvueywivefgx` (NÃO o do CLAUDE.md); testes vitest; deploy migration/EF só via MCP (sem token CLI); nunca inventar número quando custo ausente — mostrar aviso (padrão phases 79-82).
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 82
**Plans:** 1/3 plans executed

Plans:

- [x] 83-01-PLAN.md — [W1] Fundação backend+lógica pura: migration DROP+CREATE de `get_margin_with_ads_by_product` com coluna `marca` + `mcoHealth.ts` (constante `MCO_SAUDAVEL_PCT` + `classifyMcoHealth` semáforo) + `soldProductsMcoAgg.ts` (agregação pós-ads por marca/anúncio) — tudo com vitest
- [ ] 83-02-PLAN.md — [W2][BLOCKING] Orquestrador aplica migration via MCP em `ckcdevcxgvueywivefgx` + smoke: marca preenchida, retrocompat do consumidor useMLMarginWithAds, reconciliação de receita (paid+shipped+delivered), anti-IDOR
- [ ] 83-03-PLAN.md — [W3] UI: `useMLMarginWithAds` expõe `marca` + reescrita de `MLProdutosVendidos.tsx` (coluna MCO% com semáforo+tooltip, % Ads, tabela ordenável, MCO% por marca no painel esquerdo, cabeçalho-resumo, cards mobile, aviso de custo ausente) + checkpoint visual Wesley (light+dark)

### Phase 84: DRE por Competência de Venda (método Tiny)

**Goal:** A DRE do Mês em `/vendas` (`MLCostCard`) passa a operar por **competência de venda** — igual ao método da página "custos ecommerce" do Tiny: escolhe-se o mês e ele traz receita/CMV/impostos + **todas as tarifas ML das vendas daquele mês**, independentemente de quando o ML cobrou. Hoje as tarifas são alocadas por `charge_date` (lançamento na fatura), causando (a) descasamento — pedido vendido em junho e cancelado em julho carrega tarifa cheia em junho e estorno em julho — e (b) estornos de venda fora da janela da fatura que a EF **descarta** (regra `within`), sumindo da DRE. Descoberta habilitadora: o ML já entrega `sales_info[].sale_date_time` em cada movimento de billing (a EF lê como `saleDate` em `sync-ml-billing/index.ts:136` e descarta na agregação) — **sem cruzar com `orders`**. (1) SCHEMA: `ml_billing_daily` ganha coluna `competence_date` (= `sale_date_time`; fallback `charge_date` p/ tarifas sem venda: mensalidade, `PADS`); `charge_date` permanece p/ reconciliar com a fatura ML; grão passa a `(competence_date, charge_date, charge_type)`. (2) EF `sync-ml-billing`: `aggregateInvoice()` agrega por `competence_date` e **remove a exclusão `within`** na trilha de competência (estornos de venda antiga passam a contar no mês da venda; sinal `B*` negativo mantido); trilha `ml_billing_monthly` (por lançamento, com `within`) intacta p/ reconciliação. (3) DRE `useMLBilling.ts` (`useMLBillingDaily`): filtro `.gte/lte("charge_date")` → `("competence_date")`. (4) UI: **dropdown de seleção direta de mês** no `MLCostCard` (hoje só setas ◄ ►, com trava no futuro). (5) BACKFILL: re-sync das faturas de **2026** via `net.http_post` + `service_role_key` do vault (Pattern B), fan-out multi-conta. Decisões travadas com Wesley (2026-07-03): regime = competência de venda p/ TODAS as tarifas; Tiny é referência de método (cálculo continua no ML); dropdown de mês; backfill 2026. Efeitos aceitos: meses fechados se remexem; a DRE (competência) deixa de bater linha-a-linha com a fatura ML de propósito (`ml_billing_monthly` é a visão "igual à fatura"); estornos de venda antiga que hoje somem passam a contar. Supabase `ckcdevcxgvueywivefgx` (NÃO o do CLAUDE.md); deploy migration/EF só via MCP; smoke obrigatório de invariante (nenhum movimento perdido/duplicado, dedup por `detail_id`) + anti-IDOR + reconciliação ao centavo de um mês de referência. Spec: `docs/superpowers/specs/2026-07-03-dre-competencia-venda-design.md`.
**Requirements**: (phase ad-hoc — nenhum requirement ID)
**Depends on:** Phase 83
**Plans:** 6 plans

Plans:

- [ ] 84-01-PLAN.md — Autoria migration (competence_date + backfill + UNIQUE alargada + índice) + types.ts [Wave 1]
- [ ] 84-02-PLAN.md — Autoria EF sync-ml-billing: aggregateMoves por competência + remove within + testes [Wave 1]
- [ ] 84-03-PLAN.md — Frontend: DRE filtra por competence_date + dropdown de mês no MLCostCard [Wave 2]
- [ ] 84-04-PLAN.md — [BLOCKING MCP] Verificar constraint + aplicar migration + provar backfill [Wave 2]
- [ ] 84-05-PLAN.md — [BLOCKING MCP] Deploy EF + backfill 2026 sequencial + smoke/reconciliação/anti-IDOR/cross-month [Wave 3]
- [ ] 84-06-PLAN.md — [Checkpoint visual] Wesley valida /vendas DRE+dropdown (light+dark) + merge [Wave 4]

---
