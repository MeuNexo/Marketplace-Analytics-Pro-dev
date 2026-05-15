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
- [ ] **Phase 5: Dashboard de Análise** - Cards de produto com preços estratégicos e elasticidade, tabela com dropdown de estratégia e destaque visual
- [ ] **Phase 6: Recomendações de Compra & FULL** - Inputs de estoque/cobertura, multiplicador de demanda, cálculo de compra recomendada e sugestão de envio FULL
- [ ] **Phase 7: Histórico Comparativo** - Listagem de snapshots salvos e comparação lado a lado de análises do mesmo produto

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
- [ ] 04-01-PLAN.md — Motor de análise puro: tipos, engine.ts e testes TDD (MOTOR-01 a MOTOR-05)
- [ ] 04-02-PLAN.md — Migration SQL da tabela commercial_analysis_snapshots + supabase db push
- [ ] 04-03-PLAN.md — Hook useAnalysisSnapshots: saveSnapshot, fetchSnapshots, updateStrategy

### Phase 5: Dashboard de Análise
**Goal**: O usuário consegue visualizar os resultados da análise em cards de produto e numa tabela interativa com seleção de estratégia
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. O usuário vê cards por produto exibindo Preço GMV, Preço Neutro, Preço Margem e a frase de elasticidade ("A cada R$1,00 de subida a partir de R$XX,XX, perde aproximadamente X,XX% em volume")
  2. O usuário vê a tabela de análise com colunas Produto, Marca, Preço GMV, Preço Neutro, Preço Margem e Impacto Comercial (classificação da elasticidade)
  3. O usuário seleciona uma Estratégia (GMV / Neutro / Margem) via dropdown por linha; o preço correspondente é destacado visualmente na linha
**Plans**: TBD
**UI hint**: yes

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
| 4. Motor de Análise + Snapshots | 0/3 | Not started | - |
| 5. Dashboard de Análise | 0/? | Not started | - |
| 6. Recomendações de Compra & FULL | 0/? | Not started | - |
| 7. Histórico Comparativo | 0/? | Not started | - |
