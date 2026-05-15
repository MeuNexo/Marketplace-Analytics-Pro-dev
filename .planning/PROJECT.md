# Garment Glow — Plataforma de Gestão ML

## Current Milestone: v2.0 Análise Comercial de Marketplace

**Goal:** Ferramenta de análise de preço × volume que transforma relatórios de pedidos em recomendações comerciais acionáveis (Preço GMV, Neutro, Margem), elasticidade por R$1,00 e sugestões de compra e envio FULL.

**Target features:**
- Curva Preço × Volume — agrupa pedidos por preço unitário, calcula unidades, GMV, venda diária, participações
- Preço GMV, Preço Margem e Preço Neutro com regras de elegibilidade e arredondamento comercial
- Elasticidade por R$1,00 com 4 classificações (Baixa/Média/Alta/Extrema)
- Dashboard de cards por produto com frase descritiva da elasticidade
- Tabela de análise com dropdown de Estratégia (GMV/Neutro/Margem) e destaque visual
- Recomendações de compra e envio FULL com multiplicadores de demanda e cobertura
- Histórico comparativo de análises do mesmo produto

---

# Módulo Fiscal — Tributação por Regime (v1.0)

## What This Is

Módulo de configuração tributária para a plataforma de gestão de vendedores do Mercado Livre. Permite que cada organização configure o regime tributário de cada loja ML (Simples Nacional, Lucro Presumido ou Lucro Real), e usa essa configuração para calcular automaticamente o valor e percentual de impostos exibidos na coluna Impostos do Catálogo de Anúncios.

## Core Value

Cada loja ML tem seu regime tributário configurado, e o imposto sobre cada anúncio é calculado corretamente — sem digitação manual por produto.

## Requirements

### Validated

- ✓ Plataforma multi-tenant com organizations e roles (owner/admin/member/viewer) — existing
- ✓ Roteamento protegido por role via `RoleRoute` — existing
- ✓ Coluna Impostos em Catálogo de Anúncios (`MLProdutos`) com % editável por produto — existing
- ✓ Tabela `ml_tokens` por loja ML com `ml_user_id` e `organization_id` — existing
- ✓ Supabase (PostgreSQL + Auth + Edge Functions) — existing

### Active

- [ ] Aba "Fiscal" em Minha Conta acessível somente a owners
- [ ] Seleção de regime tributário por loja ML (Simples Nacional, Lucro Presumido, Lucro Real)
- [ ] Formulário Simples Nacional: alíquota efetiva (%) — campo único
- [ ] Formulário Lucro Presumido: PIS (%), COFINS (%), IRPJ (%), CSLL (%) — alíquota efetiva resultante = soma
- [ ] Formulário Lucro Real: créditos e débitos de ICMS, PIS e COFINS — alíquota efetiva = (débitos − créditos) / base de cálculo
- [ ] Persistência das configurações por loja ML no banco de dados (tabela `ml_tax_config`)
- [ ] Coluna Impostos em Catálogo de Anúncios exibe valor em R$ e % calculados a partir do regime configurado (base = preço de venda)
- [ ] Fallback para valor manual quando loja não tem regime configurado

### Out of Scope

- NCM / CFOP por produto — complexidade elevada, não necessário para v1
- Cálculo de ICMS por estado de destino (diferencial de alíquota) — fora do v1
- Geração de guias ou SPED fiscal — plataforma é analytics, não fiscal
- Regime por produto individual — configuração é sempre por loja ML
- Múltiplos regimes por organização num mesmo período — uma loja = um regime ativo

## Context

A plataforma é um SPA React 18 + TypeScript com Supabase como backend. A tela de Catálogo de Anúncios (`src/pages/mercadolivre/MLProdutos.tsx`) já tem uma coluna Impostos com % editável inline por produto via `ml_product_costs`. O novo módulo substituirá (ou complementará) essa entrada manual com valores derivados do regime tributário da loja.

O menu de Minha Conta já inclui `/organizacao` (owner/admin) e `/integracoes` (owner only). A nova rota `/fiscal` seguirá o mesmo padrão: `owner only`.

A tabela `ml_tokens` relaciona loja ML → organização. A nova tabela `ml_tax_config` relacionará loja ML → configuração tributária, com os campos variando por regime.

**Convenções do codebase:**
- Páginas em `src/pages/mercadolivre/`
- Rota nova em `src/App.tsx` com `RoleRoute`
- Supabase migration para nova tabela
- Edge function ou query direta via `supabase-js` para leitura

## Constraints

- **Role**: Configuração restrita a `owner` — usar `RoleRoute` existente ou verificação inline
- **Scope**: Configuração é por `ml_user_id` (loja ML), não por organização inteira
- **Cálculo**: Imposto sempre sobre preço de venda (receita bruta), não sobre margem
- **Stack**: React + TypeScript + shadcn/ui + Supabase — sem novas dependências de cálculo fiscal externas
- **Display**: Coluna Impostos mostra `R$ X,XX (Y,Y%)` — ambos

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Configuração por loja ML, não por organização | Empresas podem ter contas ML em regimes diferentes | — Pending |
| Alíquota efetiva como denominador comum | Lucro Real e Presumido têm múltiplos tributos — reduzir a % efetivo simplifica o cálculo na coluna | — Pending |
| Nova tabela `ml_tax_config` | Não poluir `ml_tokens` com dados fiscais; schema separado e versionável | — Pending |
| Owner only para configuração fiscal | Dado sensível e consequente — não delegar a membros comuns | — Pending |

---
*Last updated: 2026-05-14 após inicialização do projeto*

## Evolution

Este documento evolui a cada transição de fase e milestone.

**Após cada transição de fase** (via `/gsd-transition`):
1. Requirements invalidados? → Mover para Out of Scope com motivo
2. Requirements validados? → Mover para Validated com referência de fase
3. Novos requirements emergiram? → Adicionar em Active
4. Decisões a registrar? → Adicionar em Key Decisions
5. "What This Is" ainda preciso? → Atualizar se derivou

**Após cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value ainda é a prioridade certa?
3. Auditar Out of Scope — motivos ainda válidos?
4. Atualizar Context com estado atual
