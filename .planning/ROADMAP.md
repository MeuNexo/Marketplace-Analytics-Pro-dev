# Roadmap — v8.0 Consultor v2 (Inteligência)

## Overview

Cinco fases transformam o Consultor v1 (motor determinístico de ~12 regras + score 0-100, em prod) numa camada de inteligência aditiva: fundação de dados (Phase 52), análise narrativa por LLM (Phase 53), pipeline de ação com aprovação (Phase 54), drill-down por loja (Phase 55) e ajuste fino — snooze + limiares na UI (Phase 56).

**Princípio inviolável:** nada substitui o motor determinístico do v1 — tudo é aditivo. O LLM recebe SÓ a saída estruturada do v1 (insights serializados), nunca dados crus para recalcular. Toda ação que altera o ML passa por aprovação do owner (nunca auto-executa).

Supabase project: **ckcdevcxgvueywivefgx** (não o ID em CLAUDE.md). Deploy: push → Vercel auto. LLM: Claude Haiku 4.5 via raw fetch em Deno EF, `ANTHROPIC_API_KEY` no vault Pattern B.

Research completo: `.planning/research/SUMMARY.md` (HIGH confidence). Requisitos: `.planning/REQUIREMENTS.md` (28 reqs / 5 trilhas).

## Phases

- [x] **Phase 52: Fundação de Dados v8.0** — Tabelas (llm_analysis_cache, proposed_actions com state-machine de 6 estados, action_audit_log) + colunas (insights.snoozed_until/ml_user_id, consultor_config: limiares editáveis + llm_enabled) + RLS org-first + transição atômica + RPCs base + types.ts. Bloqueia 53–56. **(completed 2026-06-24 — aplicada em prod ckcdevcxgvueywivefgx, advisors sem erro novo, build verde)**
- [ ] **Phase 53: Camada LLM (Análise Inteligente)** — Resumo narrativo estilo COO + "Explicar" por insight, com cache por org/dia, grounding anti-alucinação e kill-switch (LLM-01..07).
- [ ] **Phase 54: Pipeline de Ações com Aprovação** — Propor ação (diff + impacto) → fila → aprovar → executor ML (preço/anúncio/ads) com gate atômico, pre-flight e audit log imutável (ACT-01..08).
- [ ] **Phase 55: Drill-down Multi-Loja** — Score e insights por loja ML, seletor com badge de saúde, score org = média ponderada por GMV (STORE-01..05).
- [ ] **Phase 56: Ajuste Fino (Snooze + Limiares na UI)** — Adiar insights (amanhã/semana/30d, server-side) + editor de limiares com presets, preview ao vivo e guardrails (SNZ-01..03, TUNE-01..05).

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

**Plans**: TBD

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

**Plans**: TBD

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

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 52. Fundação de Dados v8.0 | 2/2 | Complete | 2026-06-24 |
| 53. Camada LLM | 0/? | Not started | - |
| 54. Pipeline de Ações | 0/? | Not started | - |
| 55. Drill-down Multi-Loja | 0/? | Not started | - |
| 56. Snooze + Limiares | 0/? | Not started | - |

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
