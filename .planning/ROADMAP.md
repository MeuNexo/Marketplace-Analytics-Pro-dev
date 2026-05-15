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
