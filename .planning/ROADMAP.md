# Roadmap — Módulo Fiscal

## Overview

Três fases entregam o módulo fiscal completo: a fundação de banco de dados e hook de dados (Fase 1), a interface de configuração de regimes tributários acessível ao owner (Fase 2) e a integração da coluna Impostos no catálogo com cobertura de testes (Fase 3).

## Phases

- [ ] **Phase 1: Infraestrutura** - Migration, trigger e hook de dados para `ml_tax_config`
- [ ] **Phase 2: Configuração Fiscal** - Página /fiscal com formulários por regime, rota e sidebar
- [ ] **Phase 3: Catálogo + Qualidade** - Coluna Impostos derivada do regime, banner, tooltip e testes unitários

## Phase Details

### Phase 1: Infraestrutura
**Goal**: A base de dados e o contrato de dados estão prontos para o módulo fiscal
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. A tabela `ml_tax_config` existe no banco com enum `tax_regime`, colunas por regime, coluna `effective_rate` e constraints UNIQUE + RLS corretas
  2. O hook `useMLTaxConfig` retorna um `Map<ml_user_id, { regime, effective_rate }>` consultado via TanStack Query, sem erros de tipo TypeScript
  3. Inserir ou atualizar uma configuração via Supabase reflete o `effective_rate` calculado automaticamente pelo trigger
**Plans**: TBD

### Phase 2: Configuração Fiscal
**Goal**: O owner pode configurar o regime tributário de cada loja ML pela aba /fiscal
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FISCAL-01, FISCAL-02, FISCAL-03, FISCAL-04, FISCAL-05, FISCAL-06, FISCAL-07
**Success Criteria** (what must be TRUE):
  1. O item "Fiscal" aparece no sidebar apenas para owners e a rota `/fiscal` está protegida por `RoleRoute`
  2. A página lista todas as lojas ML da organização com badge de regime ativo ou "Não configurado" e botão Configurar/Editar
  3. O owner consegue salvar configurações para Simples Nacional, Lucro Presumido e Lucro Real com validação de campos e preview de taxa em tempo real
  4. Trocar de regime exibe um dialog de confirmação; o disclaimer legal está visível na página
**Plans**: TBD
**UI hint**: yes

### Phase 3: Catálogo + Qualidade
**Goal**: A coluna Impostos do catálogo exibe valores derivados do regime configurado e os cálculos estão cobertos por testes
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CATALOG-01, CATALOG-02, CATALOG-03, QA-01
**Success Criteria** (what must be TRUE):
  1. A coluna Impostos exibe `R$ X,XX (Y,Y%)` calculado a partir do `effective_rate` da loja; exibe o valor manual existente como fallback; exibe `—` quando nenhum está configurado
  2. Um banner aparece no catálogo quando alguma loja ativa não tem regime configurado, com link para `/fiscal`
  3. O tooltip da coluna Impostos exibe o aviso de estimativa fiscal
  4. Os testes unitários cobrem os três regimes, edge cases (crédito > débito, taxa zero, taxa negativa) e validação de inputs, e passam sem erros
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infraestrutura | 0/? | Not started | - |
| 2. Configuração Fiscal | 0/? | Not started | - |
| 3. Catálogo + Qualidade | 0/? | Not started | - |

---

# Roadmap — v2.0 Análise Comercial de Marketplace

## Overview

Quatro fases entregam a ferramenta de análise comercial completa: o motor de cálculo puro e infraestrutura de snapshots (Fase 4), o dashboard de visualização com cards e tabela de estratégia (Fase 5), as recomendações de compra e envio FULL (Fase 6) e o histórico comparativo de análises (Fase 7).

## Phases — v2.0

- [ ] **Phase 4: Motor de Análise + Snapshots** - Engine TypeScript de cálculos (curva preço×volume, GMV/Neutro/Margem, elasticidade) e tabela Supabase para snapshots
- [x] **Phase 5: Dashboard de Análise** - Cards de produto com preços estratégicos e elasticidade, tabela com dropdown de estratégia e destaque visual (completed 2026-05-18)
- [x] **Phase 6: Recomendações de Compra & FULL** - Inputs de estoque/cobertura, multiplicador de demanda, cálculo de compra recomendada e sugestão de envio FULL (completed 2026-05-18)
- [x] **Phase 7: Histórico Comparativo** - Listagem de snapshots salvos e comparação lado a lado de análises do mesmo produto (completed 2026-05-18)

## Phase Details — v2.0

### Phase 4: Motor de Análise + Snapshots
**Goal**: Os algoritmos de análise comercial estão implementados como módulo TypeScript testável e a infraestrutura de persistência de snapshots está pronta no Supabase
**Depends on**: Phase 3
**Requirements**: MOTOR-01, MOTOR-02, MOTOR-03, MOTOR-04, MOTOR-05, HIST-01
**Success Criteria** (what must be TRUE):
  1. Dado um conjunto de pedidos por produto, o módulo retorna a curva preço×volume com unidades vendidas, GMV, dias ativos, venda média diária e participações corretas para cada faixa de preço
  2. O módulo determina corretamente o Preço GMV, Preço Margem e Preço Neutro segundo as regras de elegibilidade e arredondamento (incluindo fallbacks com .99/.90)
  3. O módulo calcula a elasticidade por R$1,00 e classifica em Baixa/Média/Alta/Extrema com os thresholds definidos
  4. A tabela de snapshots existe no Supabase e o sistema salva automaticamente um registro completo (produto, período, curva, preços estratégicos, elasticidade, data) após cada análise executada
**Plans**: 3 plans
Plans:
- [x] 04-01-PLAN.md — Motor de análise puro: tipos, engine.ts e testes TDD (MOTOR-01 a MOTOR-05)
- [x] 04-02-PLAN.md — Migration SQL da tabela commercial_analysis_snapshots + supabase db push
- [x] 04-03-PLAN.md — Hook useAnalysisSnapshots: saveSnapshot, fetchSnapshots, updateStrategy

### Phase 5: Dashboard de Análise
**Goal**: O usuário consegue visualizar os resultados da análise em cards de produto e numa tabela interativa com seleção de estratégia
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. O usuário vê cards por produto exibindo Preço GMV, Preço Neutro, Preço Margem e a frase de elasticidade ("A cada R$1,00 de subida a partir de R$XX,XX, perde aproximadamente X,XX% em volume")
  2. O usuário vê a tabela de análise com colunas Produto, Marca, Preço GMV, Preço Neutro, Preço Margem e Impacto Comercial (classificação da elasticidade)
  3. O usuário seleciona uma Estratégia (GMV / Neutro / Margem) via dropdown por linha; o preço correspondente é destacado visualmente na linha
**Plans**: 2 plans
Plans:
- [x] 05-01-PLAN.md — Hook useMLOrdersByItem + stub da aba Análise em MLPrecificacao
- [x] 05-02-PLAN.md — AnalysisProductCard, AnalisePrecosTable, AnaliseDashboard + wire final

### Phase 6: Recomendações de Compra & FULL
**Goal**: O usuário consegue informar estoque atual e cobertura desejada para obter recomendação de compra e sugestão de envio FULL calibrada pela estratégia escolhida
**Depends on**: Phase 5
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04
**Success Criteria** (what must be TRUE):
  1. O usuário informa dias de cobertura, estoque total atual, estoque FULL atual e estoque casa/CD por produto sem erros de validação
  2. O usuário seleciona um multiplicador de demanda (Normal ×1,0 / Campanha leve ×1,2 / Data forte ×1,5 / Live–oferta ×2,0) e o cálculo atualiza em tempo real
  3. O sistema exibe a compra recomendada calculada corretamente como (venda_diária_estratégia × multiplicador × dias_cobertura) − estoque_total_atual
  4. O sistema exibe a sugestão de volume para envio FULL de acordo com a estratégia selecionada (GMV → 70–90%, Neutro → 50–70%, Margem → 40–60% da cobertura)
**Plans**: TBD
**UI hint**: yes

### Phase 7: Histórico Comparativo
**Goal**: O usuário consegue consultar análises anteriores do mesmo produto e compará-las lado a lado para identificar variações de elasticidade e recomendações ao longo do tempo
**Depends on**: Phase 6
**Requirements**: HIST-02
**Success Criteria** (what must be TRUE):
  1. O usuário vê a lista de análises salvas de um produto com data de execução, período analisado e preços estratégicos de cada snapshot
  2. O usuário seleciona duas análises do mesmo produto e visualiza uma comparação lado a lado mostrando variações nos Preços GMV/Neutro/Margem e na classificação de elasticidade
**Plans**: TBD
**UI hint**: yes

## Progress — v2.0

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Motor de Análise + Snapshots | 3/3 | Complete ✅ | 2026-05-15 |
| 5. Dashboard de Análise | 2/2 | Complete   | 2026-05-18 |
| 6. Recomendações de Compra & FULL | 2/2 | Complete   | 2026-05-18 |
| 7. Histórico Comparativo | 2/2 | Complete   | 2026-05-18 |

---

# Roadmap — v3.0 Sync Engine & Arquitetura DB-First

## Overview

Quatro fases entregam o motor de sync completo: infraestrutura de planos e quotas (Fase 8), fila de jobs e dispatcher automático (Fase 9), cache de inventário com edge function de sync (Fase 10) e refatoração do front-end para leitura exclusiva do banco (Fase 11).

## Phases — v3.0

- [ ] **Phase 8: Infraestrutura de Planos** - Tabelas `organization_plans` e `sync_quota_daily` + seed de plano enterprise para organizações existentes
- [ ] **Phase 9: Job Queue & Dispatcher** - Tabela `sync_jobs`, função SQL `dispatch_sync_jobs()`, edge function `process-sync-job` e agendamentos pg_cron de dispatch + drain
- [ ] **Phase 10: Inventory Cache** - Tabela `ml_inventory_cache`, edge function `sync-ml-inventory` com upsert atômico e pg_cron diário às 04:00 BRT
- [ ] **Phase 11: Frontend DB-First** - `MLInventoryContext` lê de `ml_inventory_cache`; quota check nas edge functions de sync; zero live calls à ML API durante navegação

## Phase Details — v3.0

### Phase 8: Infraestrutura de Planos
**Goal**: As tabelas de controle de planos e quotas existem no banco e todas as organizações já possuem um plano configurado
**Depends on**: Phase 7
**Requirements**: PLANS-01, PLANS-02, PLANS-04
**Success Criteria** (what must be TRUE):
  1. A tabela `organization_plans` existe com a coluna `plan_tier` (enum free/starter/pro/enterprise), `sync_interval_minutes` e `history_days`; a tabela `sync_quota_daily` existe com chave primária composta `(organization_id, date)` e `sync_count` inicializado em zero
  2. Toda organização existente no banco possui exatamente um registro em `organization_plans` com `plan_tier = 'enterprise'` e limites `-1` (unlimited) após a execução do seed
  3. Inserir uma nova organização sem plano e executar o seed novamente não duplica registros (operação idempotente)
**Plans**: TBD

### Phase 9: Job Queue & Dispatcher
**Goal**: O sistema enfileira, despacha e reprocessa jobs de sync de forma totalmente automática sem intervenção manual
**Depends on**: Phase 8
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07
**Success Criteria** (what must be TRUE):
  1. A tabela `sync_jobs` existe com todos os campos especificados; inserir um job `pending` e invocar `process-sync-job` resulta em status `completed` ou `failed` com `finished_at` preenchido
  2. Executar `dispatch_sync_jobs()` duas vezes consecutivas para o mesmo par `(organization_id, ml_user_id, job_type)` cria apenas um job `pending` — sem duplicatas
  3. Um job com status `failed` e `retries < 3` é reinserido como `pending` pelo watchdog; um job com `retries >= 3` permanece `failed` e não é reinserido
  4. O pg_cron tem dois agendamentos ativos: dispatch a cada 30 minutos e drain (invocação de `process-sync-job`) a cada 5 minutos
**Plans**: TBD

### Phase 10: Inventory Cache
**Goal**: O inventário de todas as organizações é sincronizado automaticamente do ML para o banco todo dia de madrugada
**Depends on**: Phase 9
**Requirements**: INV-01, INV-02, INV-03
**Success Criteria** (what must be TRUE):
  1. A tabela `ml_inventory_cache` existe com constraint UNIQUE em `(organization_id, ml_user_id, item_id)`; invocar `sync-ml-inventory` para uma organização percorre todas as páginas da ML API e salva/atualiza os registros via upsert sem erros de conflito
  2. Executar `sync-ml-inventory` duas vezes seguidas para a mesma organização produz o mesmo conjunto de registros — sem duplicatas, sem registros fantasma
  3. O pg_cron possui agendamento ativo para executar o sync de inventário às 04:00 BRT para todas as organizações com `ml_tokens` ativos
**Plans**: TBD

### Phase 11: Frontend DB-First
**Goal**: As telas de Estoque e Anúncios leem exclusivamente do banco de dados — nenhuma chamada live à ML API ocorre durante a navegação do usuário
**Depends on**: Phase 10
**Requirements**: INV-04, INV-05, PLANS-03
**Success Criteria** (what must be TRUE):
  1. Abrir as telas MLEstoque ou MLAnuncios não dispara nenhuma invocação à edge function `ml-inventory` nem qualquer chamada direta à API do ML; os dados exibidos vêm de `ml_inventory_cache` via query Supabase
  2. Quando `sync_count >= sync_limit_daily` (e o limite não é `-1`), a edge function de sync retorna HTTP 429 com o corpo `{ error: "sync_limit_reached", resets_at: "tomorrow" }`; organizações com plano enterprise (limite `-1`) nunca recebem esse erro
  3. O `MLInventoryContext` refatorado compila sem erros de TypeScript e os tipos derivam dos campos de `ml_inventory_cache`
**Plans**: TBD
**UI hint**: yes

## Progress — v3.0

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 8. Infraestrutura de Planos | 0/? | Not started | - |
| 9. Job Queue & Dispatcher | 0/? | Not started | - |
| 10. Inventory Cache | 0/? | Not started | - |
| 11. Frontend DB-First | 0/? | Not started | - |
