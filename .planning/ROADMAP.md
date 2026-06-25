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
- [ ] 59-01-PLAN.md — CASHFIX-01: RPC `get_cashflow` regra de projeção 7d (CASE em accumulated_balance_sma + daily_projection, data BRT) + legenda/JSDoc frontend; aplicar via MCP apply_migration (checkpoint orquestrador) + validação SQL/visual
- [ ] 59-02-PLAN.md — CASHFIX-02: EF `sync-tiny-payables` debug-first (observabilidade) + `EdgeRuntime.waitUntil` (202 imediato, sem timeout pg_net) + fix da causa-raiz do silent-no-write; deploy + prova de persistência por SQL (checkpoints orquestrador)

Contexto/diagnóstico: `phases/59-fluxo-caixa-correcoes/59-CONTEXT.md`

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
| 59. Fluxo de Caixa — Correções | 0/2 | Planned (plan-checker PASS) | - |

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
