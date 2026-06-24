# Requirements — v8.0 Consultor v2 (Inteligência)

**Defined:** 2026-06-23
**Core Value:** Consultor que explica, prioriza e ajuda a agir — LLM sob demanda + ações com aprovação, sobre o motor determinístico do v1.

## Contexto

Camada aditiva sobre o Consultor v1 (Phase 45, em prod): motor determinístico de ~12 regras, tabela `insights`, score 0-100 (5 pilares), cron diário + on-demand. v8.0 adiciona três trilhas: (1) análise narrativa por LLM sobre os insights determinísticos, (2) pipeline de ação proposta → aprovação → execução, (3) UX (snooze, limiares na UI, drill-down por loja).

Pesquisa completa em `.planning/research/SUMMARY.md` (HIGH confidence — arquitetura e pitfalls de inspeção do código real do v1). Requisitos do milestone anterior em `.planning/MILESTONE-v7-SAAS.md` e no histórico do PROJECT.md.

**Decisões fixadas por Wesley (2026-06-23):**
- Ação em 1 clique = **preparar para aprovação** (nunca auto-executar). Regra de plataforma.
- LLM = **Claude Haiku 4.5, sob demanda + cache por org/dia** (raw fetch no Deno EF; `ANTHROPIC_API_KEY` no vault Pattern B).
- Score consolidado de múltiplas lojas = **média ponderada por GMV**.
- Notificação de nova proposta = **só na UI** (fila + badge); Telegram fica para depois.
- Os 4 diferenciais (diff na proposta, preview ao vivo de limiares, badge por loja, narrativa causal) entram **já no v8**.

**Restrição de fundo (pitfalls):** LLM recebe SÓ a saída estruturada do v1 (nunca recalcula números); execução com gate atômico `UPDATE ... WHERE status='approved' RETURNING *`; cache e ações escopados a `organization_id` (anti-IDOR, anti-leak).

---

## v1 Requirements

### LLM — Análise Inteligente

- [ ] **LLM-01**: Lojista vê um resumo do consultor em linguagem natural (PT-BR, estilo COO) no topo do painel, gerado por LLM sobre os insights determinísticos do v1
- [ ] **LLM-02**: Lojista clica "Explicar" em um insight e recebe explicação contextual gerada sob demanda (cacheada por insight/dia)
- [ ] **LLM-03**: O resumo conecta os pilares com narrativa causal (ex: "TACoS subiu 6%, puxando a margem para baixo 3pp")
- [ ] **LLM-04**: Análise é cacheada por org/dia — reabrir o painel não re-gera nem re-cobra; botão "Atualizar análise" força regeneração respeitando cap diário por org
- [ ] **LLM-05**: A análise nunca inventa números — usa apenas dados dos insights; qualquer valor não rastreável à entrada estruturada faz cair para o texto determinístico do v1
- [ ] **LLM-06**: Lojista vê indicador "análise desatualizada — clique para atualizar" quando o estado dos insights muda após a geração
- [ ] **LLM-07**: Owner pode desligar a camada LLM por org (kill-switch em `consultor_config.llm_enabled`)

### ACT — Ações com Aprovação

- [ ] **ACT-01**: A partir de um insight acionável, lojista clica "Propor ação" e vê preview de diff (atual → proposto + impacto estimado em R$/margem) antes de enviar
- [ ] **ACT-02**: Ação proposta entra numa fila de aprovação visível, com badge de contagem de pendentes
- [ ] **ACT-03**: Owner aprova ou rejeita uma ação proposta na fila
- [ ] **ACT-04**: Ação aprovada é executada no ML (alterar preço, pausar/ativar anúncio, pausar/ajustar campanha de ads) via executor — nunca automaticamente sem aprovação
- [ ] **ACT-05**: Toda transição de estado da ação é registrada em log de auditoria imutável (ator, de→para, timestamp, resposta da API ML)
- [ ] **ACT-06**: Execução é à prova de duplicação (gate atômico) e de IDOR (ação e token escopados a `organization_id` + `ml_user_id`)
- [ ] **ACT-07**: Proposta obsoleta (dado do ML mudou desde a criação) é bloqueada/sinalizada antes de executar (pre-flight check + TTL de validade)
- [ ] **ACT-08**: Owner vê o histórico de ações executadas (aba "Ver histórico") com o resultado de cada uma

### SNZ — Snooze / Dispensar

- [ ] **SNZ-01**: Lojista adia um insight por uma duração nomeada (Amanhã / Próxima semana / Em 30 dias)
- [ ] **SNZ-02**: O estado de adiamento é persistido por org no servidor (em `insights.snoozed_until`), não no navegador
- [ ] **SNZ-03**: Insight adiado some da lista até expirar; ao expirar reaparece se a condição ainda existir (auto-resolver do v1 respeita o snooze)

### TUNE — Limiares na UI

- [ ] **TUNE-01**: Lojista edita os limiares do consultor pela tela, sem SQL (margem alvo, TACoS alvo, dias de cobertura, etc.)
- [ ] **TUNE-02**: Presets "Conservador / Moderado / Agressivo" preenchem todos os limiares de uma vez
- [ ] **TUNE-03**: Ao ajustar um limiar, preview ao vivo mostra quantos produtos/insights disparariam com a config atual (debounced)
- [ ] **TUNE-04**: Limiares têm faixas válidas (guardrails) validadas no cliente e no servidor — o lojista não consegue quebrar o próprio score
- [ ] **TUNE-05**: Botão "Restaurar padrão" volta os limiares aos defaults

### STORE — Score / Insights por Loja

- [ ] **STORE-01**: O consultor calcula score e insights por loja ML, além do consolidado por org
- [ ] **STORE-02**: Seletor de loja permite drill-down por loja; a visão consolidada da org é o default (seletor só aparece quando há > 1 loja)
- [ ] **STORE-03**: Cada loja exibe seu badge de score de saúde (verde/amarelo/vermelho) no seletor
- [ ] **STORE-04**: O score consolidado da org é a média dos scores das lojas ponderada pelo faturamento (GMV) de cada uma
- [ ] **STORE-05**: Cada insight identifica a loja ML afetada quando aplicável

### NEXO — Consultor Conversacional (decisão Wesley 2026-06-24)

> **Mudança de decisão:** "Chat aberto com IA" estava em Out of Scope (risco de alucinação para leigos). Wesley reverteu — o risco é mitigado porque NÃO é chat aberto "pergunte qualquer coisa": é ancorado em dados reais da conta (function-calling read-only escopado por org) + playbooks da metodologia + anti-invenção de número + read-only (não executa). Domínio restrito ao consultor.

- [ ] **NEXO-01**: Lojista conversa com o "Nexo" num painel de chat flutuante acessível de qualquer tela (botão no canto); multi-turno; só disponível com ML conectado
- [ ] **NEXO-02**: Nexo tem **persona completa de COO/especialista do negócio** (PT-BR, foco em lucro líquido) e **habilidades completas** — reúne num só agente as competências dos 4 analistas (Gabriel/Financeiro, Laura/Ads-SEO-Conversão, Estela/Estoque, Rafael/Competitivo), calibrado por TODOS os playbooks da metodologia (estratégicos + ads: break_even, lifecycle, tacos_guardrail, funnel, bidding, ads_x_organic, inventory_runway, benchmarks, pitfalls, glossary), citando `[playbook: X]` quando aplicável. Barra: nível especialista de verdade, raciocínio analítico (não respostas rasas)
- [ ] **NEXO-03**: Nexo consulta dados ao vivo da conta sob demanda (function-calling read-only: margem por SKU, sales velocity, ads, estoque crítico, KPIs do dia, insights, DRE) — cada query escopada ao `organization_id` do JWT (anti-IDOR), nunca org fornecida pelo modelo
- [ ] **NEXO-04**: Conversa efêmera — histórico mantido no cliente e reenviado a cada turno; sem tabela de mensagens
- [ ] **NEXO-05**: Nexo não inventa números — valores vêm de tool-results/contexto; instrução estrita anti-invenção (mesma filosofia do numericGuard da 53)
- [ ] **NEXO-06**: Kill-switch reusa `consultor_config.llm_enabled` — desligado, o painel Nexo fica indisponível
- [ ] **NEXO-07**: Read-only e com guardrails — o chat não executa mutação no ML (sugere e encaminha para o pipeline de aprovação da Phase 54); cap de tool-calls por turno + timeout para conter custo/latência

### VERAC — Veracidade & Completude dos Dados do Nexo (Phase 58, decisão Wesley 2026-06-24)

> **Motivo:** em testes, o Nexo afirmou fatos errados por **fonte de dado incompleta**, não por falha da IA. Ex.: disse "0 em estoque / ruptura" lendo só o estoque **Full** (`ml_inventory_cache`, `logistic_type=fulfillment`), ignorando CD/consolidado; reportou estoque **item-level** como se fosse por variação; sem sinal de frescura. Wesley quer **certeza ampla em TODOS os domínios**, não só estoque.

- [ ] **VERAC-01**: Estoque do Nexo é o CONSOLIDADO (Full + CD/Tiny) quando existir; se só houver Full nesta base, é rotulado explicitamente como "estoque Full" e o Nexo NUNCA afirma "ruptura/0 em estoque" como fato absoluto a partir do Full sozinho
- [ ] **VERAC-02**: Estoque por VARIAÇÃO (tamanho/cor) quando o item tem variações — o Nexo não reporta número item-level como se fosse por SKU/variação
- [ ] **VERAC-03**: Reconciliação fonte-da-verdade — para CADA tool do Nexo, a fonte (tabela/RPC), escopo (Full/total, período) e semântica batem com o que o dashboard mostra para o mesmo indicador; divergências corrigidas
- [ ] **VERAC-04**: Frescura — o Nexo conhece o `synced_at`/recência das fontes e sinaliza quando um dado está defasado, em vez de afirmá-lo como atual
- [ ] **VERAC-05**: Declarar limitação — quando uma tool retorna parcial/vazio, o Nexo diz o que tem e o que falta (ex.: "só tenho o estoque Full") em vez de inventar número ou dizer "não configurado"
- [ ] **VERAC-06**: O Nexo não confunde campos — unidades vendidas ≠ estoque; receita ≠ lucro; Full ≠ total; período passado ≠ projeção futura. Descrições das tools deixam a semântica inequívoca
- [ ] **VERAC-07**: Bateria de testes cobrindo TODOS os domínios (vendas/faturamento, margem por produto/marca/UF/dia, ads por produto/campanha, estoque/cobertura, caixa/tesouraria, DRE/custos, perguntas, devoluções, reputação, fornecedores, metas, alertas, score) — cada domínio validado contra a fonte-da-verdade do dashboard, com as divergências corrigidas e documentadas

## v2 Requirements (deferidos)

### Notificações
- **NOTF-01**: Notificação no Telegram quando uma nova ação proposta entra na fila (infra `nexo_telegram.py` existe)

### Inteligência avançada
- **LLM-A1**: Modelo Sonnet para análise multi-step / raciocínio quando o caso exigir (v8 usa só Haiku)
- **SNZ-A1**: Smart snooze — reaparecer ao mudar a métrica, além do TTL nomeado

## Out of Scope

| Feature | Motivo |
|---------|--------|
| ~~Chat aberto com IA ("pergunte qualquer coisa")~~ | **REVERTIDO 2026-06-24 → Phase 57 (NEXO).** Risco de alucinação mitigado: chat NÃO é aberto — é ancorado (function-calling em dados reais + playbooks + anti-invenção + read-only), domínio restrito ao consultor. Barra de qualidade: agente nível especialista do negócio |
| Auto-execução de ação sem fila de aprovação | Regra de plataforma "ações que alteram o ML exigem aprovação" — sem exceção |
| Exibir score de confiança do LLM | Leigos tratam como certeza; amplifica percepção de alucinação |
| Múltiplos perfis de limiar por org | Prematuro; confunde o leigo. "Restaurar padrão" é a rede de segurança |
| Notificação Telegram de proposta | Adiada para v2 (NOTF-01) — v8 usa só fila + badge na UI |
| Streaming da resposta do LLM | Resposta curta e cacheada; non-streaming é suficiente e mais simples |

## Traceability

Mapeada no roadmap v8.0 (2026-06-24).

| Trilha | Requisitos | Phase |
|--------|-----------|-------|
| LLM (Análise Inteligente) | LLM-01..07 | 53 |
| ACT (Ações com Aprovação) | ACT-01..08 | 54 |
| STORE (Score/Insights por Loja) | STORE-01..05 | 55 |
| SNZ (Snooze) | SNZ-01..03 | 56 |
| TUNE (Limiares na UI) | TUNE-01..05 | 56 |
| NEXO (Consultor Conversacional) | NEXO-01..07 | 57 |
| Fundação de dados (transversal) | — | 52 |

**Coverage:**
- v1 requirements: 28 total (LLM 7 / ACT 8 / SNZ 3 / TUNE 5 / STORE 5)
- Mapped to phases: 28 ✅ (Phase 52 entrega o schema/RPCs base que sustentam todas as trilhas)
- Unmapped: 0
- Deferidos v2: NOTF-01, LLM-A1, SNZ-A1

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-23 after milestone v8.0 definition*
