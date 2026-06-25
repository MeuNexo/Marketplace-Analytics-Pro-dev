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
- [ ] **Phase 62: Reposição Server-Side (Compra Recomendada correta)** — Substitui a "Compra Recomendada" do front (estoque digitado + venda simulada, sem lead time/segurança/gatilho/MOQ/custo) por uma RPC `get_replenishment` server-side: estoque real (`ml_inventory_cache` Full+anúncios), venda/dia real, ponto de reposição com gatilho, MOQ/embalagem, custo nulo/sem-giro, parâmetros global + por marca/fornecedor. Não sugere mais comprar o que já se tem (REPL-01..11). **Planejada 2026-06-25 — 3 plans (2 waves), plan-checker PASS. Pronta p/ `/gsd-execute-phase 62`.**

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

**Plans**: 3 plans (2 waves)

- [ ] 62-01-PLAN.md — [W1] Backend: migration `replenishment_params` (RLS org-first) + RPC `get_replenishment` (SECURITY INVOKER) + types.ts; apply via MCP + validação SQL [BLOCKING checkpoint] (REPL-01..08)
- [ ] 62-02-PLAN.md — [W1] Módulo TS puro `replenishmentUtils.ts` + suite vitest (8 casos travados) (REPL-04/05/06/07/08/11)
- [ ] 62-03-PLAN.md — [W2] Frontend: hook `useReplenishment` + `ReplenishmentPanel.tsx` + aba nova em `/estoque` + aviso "a chegar" (REPL-01/09/10)

Contexto/decisões: `phases/62-reposicao-server-side/62-CONTEXT.md`. Sistema antigo a substituir: `src/lib/analysis/compraUtils.ts` + `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx`.

Continuação da Phase 51 + Phase 60. Causa-raiz e estado do banco (1991/2011 com category vazia E supplier nulo) validados em 2026-06-25 com dados live; opção A aprovada pelo Wesley. **Planejada 2026-06-25.**

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 52. Fundação de Dados v8.0 | 2/2 | Complete | 2026-06-24 |
| 53. Camada LLM | 2/2 | Complete | 2026-06-24 |
| 54. Pipeline de Ações | 0/3 | Planned | - |
| 55. Drill-down Multi-Loja | 0/? | Not started | - |
| 56. Snooze + Limiares | 0/? | Not started | - |
| 57. Nexo Conversacional | 0/4 | Em execução (preview) | - |
| 58. Veracidade & Completude | 5/6 | In Progress|  |
| 59. Fluxo de Caixa — Correções | 2/2 | Executed (provado em prod) | 2026-06-25 |

## Build Order / Dependências

```
Phase 52 (Fundação de Dados) ──┬── Phase 53 (LLM)        ──┐
                               ├── Phase 54 (Ações)      ──┤
                               ├── Phase 55 (Multi-Loja) ──┤ → v8.0
                               └── Phase 56 (Snooze/Limiares)┘
```

- **52 bloqueia tudo** (schema + state-machine + RPCs).
- **53 e 54 podem rodar em paralelo** após a 52 (sem overlap de arquivos: EF/UI distintas).
- **55** usa o engine da 52 e integra a narrativa da 53 quando presente.
- **56** depende só da 52 (colunas snoozed_until + limiares em consultor_config).
- Sugestão de início: **Phase 52** (fundação), depois **53 + 54** em paralelo.

## Traceability

| Trilha | Requisitos | Phase |
|--------|-----------|-------|
| LLM | LLM-01..07 (7) | 53 |
| ACT | ACT-01..08 (8) | 54 |
| STORE | STORE-01..05 (5) | 55 |
| SNZ | SNZ-01..03 (3) | 56 |
| TUNE | TUNE-01..05 (5) | 56 |
| (base de dados transversal) | — | 52 |

**Coverage:** 28/28 requisitos v1 mapeados (LLM→53, ACT→54, STORE→55, SNZ+TUNE→56; fundação→52). Deferidos v2: NOTF-01, LLM-A1, SNZ-A1.
