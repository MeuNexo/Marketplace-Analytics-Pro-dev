# Requirements — v2.0 Análise Comercial de Marketplace

## Milestone Goal

Ferramenta de análise de preço × volume que transforma os pedidos já sincronizados do ML
em recomendações comerciais acionáveis: Preço GMV, Preço Neutro, Preço Margem, elasticidade
por R$1,00 e sugestões de compra e envio FULL, com histórico comparativo por produto.

---

## Active Requirements — v2.0

### MOTOR — Motor de Análise (cálculos puros)

- [ ] **MOTOR-01**: Sistema agrupa os pedidos por preço unitário praticado e calcula unidades vendidas, GMV total, dias ativos no período, venda média diária e participações em volume e GMV para cada faixa de preço
- [ ] **MOTOR-02**: Sistema determina o Preço GMV como o preço com maior venda média diária; em empate escolhe o maior GMV total
- [ ] **MOTOR-03**: Sistema determina o Preço Margem como o maior preço que possui volume ≥ 15% do volume do Preço GMV; quando nenhum preço acima do GMV atinge o mínimo, usa preço_gmv × 1,10 arredondado para final .99
- [ ] **MOTOR-04**: Sistema determina o Preço Neutro como o preço real mais próximo da média ponderada entre Preço GMV e Preço Margem; quando não existe preço real nessa faixa, calcula a média e arredonda para final .99 ou .90
- [ ] **MOTOR-05**: Sistema calcula a Elasticidade por R$1,00 (% de queda na venda diária para cada R$1,00 acima do Preço GMV usando Preço Margem como referência) e classifica em: Baixa (≤ 0,70%/R$), Média (0,71–1,30%/R$), Alta (1,31–2,00%/R$), Extrema (> 2,00%/R$)

### DASH — Dashboard & Visualização

- [ ] **DASH-01**: Usuário vê cards de produto com Preço GMV, Preço Neutro, Preço Margem e frase de elasticidade: "A cada R$1,00 de subida a partir de R$XX,XX, perde aproximadamente X,XX% em volume"
- [ ] **DASH-02**: Usuário vê tabela de análise com colunas Produto, Marca, Preço GMV, Preço Neutro, Preço Margem e Impacto Comercial (classificação da elasticidade)
- [ ] **DASH-03**: Usuário seleciona Estratégia (GMV / Neutro / Margem) via dropdown por linha na tabela; o preço correspondente é destacado visualmente

### COMP — Recomendações de Compra & FULL

- [ ] **COMP-01**: Usuário informa, por produto, dias de cobertura desejada, estoque atual total, estoque FULL atual e estoque casa/CD
- [ ] **COMP-02**: Usuário seleciona multiplicador de demanda (Normal ×1,0 / Campanha leve ×1,2 / Data forte ×1,5 / Live–oferta ×2,0)
- [ ] **COMP-03**: Sistema calcula compra recomendada = (venda_diária_estratégia × multiplicador × dias_cobertura) − estoque_total_atual
- [ ] **COMP-04**: Sistema sugere volume a enviar para FULL segundo a estratégia escolhida: GMV → 70–90%, Neutro → 50–70%, Margem → 40–60% da cobertura

### HIST — Histórico & Comparação

- [ ] **HIST-01**: Sistema salva snapshot de cada análise executada (produto, período, curva de preços, Preços GMV/Neutro/Margem, elasticidade, data de execução)
- [ ] **HIST-02**: Usuário pode comparar análises anteriores do mesmo produto lado a lado para identificar variações de elasticidade e recomendações ao longo do tempo

---

## Future Requirements — v2.0 (deferred)

- Upload de CSV/Excel do painel do ML como fonte alternativa de pedidos
- Análise automática agendada (snapshot semanal)
- Exportação da tabela de análise para XLSX
- Integração do Preço recomendado direto na tela de Precificação (pré-preencher campo de preço de venda)

---

## Out of Scope — v2.0

- **Previsão de demanda com ML/IA** — complexidade fora do escopo de v2.0
- **Análise de concorrentes externos** — fora do ecossistema de dados disponíveis
- **Cálculo de rentabilidade por preço** — foco é em volume; margem financeira fica em Precificação
- **Multi-produto no módulo de compras** — usuário analisa um produto por vez nesta versão

---

## Traceability — v2.0

| REQ-ID | Phase | Notes |
|--------|-------|-------|
| MOTOR-01 | Phase 4 | Motor de Análise + Snapshots |
| MOTOR-02 | Phase 4 | Motor de Análise + Snapshots |
| MOTOR-03 | Phase 4 | Motor de Análise + Snapshots |
| MOTOR-04 | Phase 4 | Motor de Análise + Snapshots |
| MOTOR-05 | Phase 4 | Motor de Análise + Snapshots |
| HIST-01 | Phase 4 | Motor de Análise + Snapshots — infra de persistência junto ao motor |
| DASH-01 | Phase 5 | Dashboard de Análise |
| DASH-02 | Phase 5 | Dashboard de Análise |
| DASH-03 | Phase 5 | Dashboard de Análise |
| COMP-01 | Phase 6 | Recomendações de Compra & FULL |
| COMP-02 | Phase 6 | Recomendações de Compra & FULL |
| COMP-03 | Phase 6 | Recomendações de Compra & FULL |
| COMP-04 | Phase 6 | Recomendações de Compra & FULL |
| HIST-02 | Phase 7 | Histórico Comparativo |

---

---

# Requirements — v1.0 Módulo Fiscal

## v1 Requirements

### Infraestrutura (INFRA)

- [ ] **INFRA-01**: Migration cria tabela `ml_tax_config` com enum `tax_regime` ('simples_nacional', 'lucro_presumido', 'lucro_real'), colunas normalizadas por regime, `effective_rate` NUMERIC(6,4) calculado por trigger PostgreSQL, UNIQUE (ml_user_id, organization_id), RLS (SELECT = todos org members via is_org_member; INSERT/UPDATE/DELETE = owner via get_org_role)
- [ ] **INFRA-02**: Hook `useMLTaxConfig(mlUserIds: string[], orgId: string)` em `src/hooks/useMLTaxConfig.ts` — query Supabase direta, retorna `Map<ml_user_id, { regime, effective_rate }>`, segue padrão TanStack Query existente

### Configuração Fiscal (FISCAL)

- [ ] **FISCAL-01**: Nova rota `/fiscal` em `src/App.tsx` com `RoleRoute` restrita a `owner`; item no sidebar (owner only) agrupado com `/integracoes`; page lazy-loaded
- [ ] **FISCAL-02**: Página `MLFiscal.tsx` — lista todas as lojas ML da org com card por loja mostrando nome, badge de regime ativo ou "Não configurado", botão Configurar/Editar
- [ ] **FISCAL-03**: Formulário Simples Nacional — campo alíquota efetiva (%) com label "Alíquota efetiva do DAS", tooltip explicando que o valor vem do PGDAS-D/contador, validação `0.5 ≤ x ≤ 19.5`
- [ ] **FISCAL-04**: Formulário Lucro Presumido — seletor de tipo de atividade (Comércio, Indústria, Serviços); campos PIS (default 0.65%), COFINS (default 3.00%), IRPJ efetivo, CSLL efetivo com defaults por atividade; total calculado em tempo real; validação de range por campo
- [ ] **FISCAL-05**: Formulário Lucro Real — campos PIS débito (default 1.65%), PIS crédito (default 0%), COFINS débito (default 7.60%), COFINS crédito (default 0%), ICMS débito e crédito (opcionais); taxa efetiva líquida = débitos − créditos calculada em tempo real; exibir badge "Crédito" se resultado < 0%, limitar display a 0%
- [ ] **FISCAL-06**: Troca de regime (tab diferente do regime salvo) exige dialog de confirmação antes de salvar, informando o regime atual e o novo
- [ ] **FISCAL-07**: Disclaimer legal em destaque na aba Fiscal: "Os valores de impostos exibidos são estimativas para análise de margem e não constituem apuração fiscal oficial. Consulte seu contador."

### Integração Catálogo (CATALOG)

- [ ] **CATALOG-01**: Coluna Impostos em `MLProdutos.tsx` exibe `R$ X,XX (Y,Y%)` derivado de `effective_rate` do regime da loja (base = preço de venda); fallback para `ml_product_costs.tax_rate` manual; exibe `—` quando nenhum dos dois está configurado
- [ ] **CATALOG-02**: Banner informativo em `MLProdutos.tsx` quando alguma loja ativa não tem `ml_tax_config` configurado, com link direto para `/fiscal`
- [ ] **CATALOG-03**: Tooltip na coluna Impostos: "Estimativa baseada no regime tributário configurado em Fiscal. Não considere créditos de entrada. Consulte seu contador."

### Qualidade (QA)

- [ ] **QA-01**: Testes unitários em `src/lib/tax/index.test.ts` cobrindo as fórmulas de cálculo dos 3 regimes, edge cases (crédito > débito, taxa zero, taxa negativa) e validação de inputs

---

## v2 Requirements (deferred)

- Tabela de referência Simples Nacional inline (Anexos I–V + faixas de faturamento) para o vendedor confirmar seu enquadramento
- Histórico de alterações de regime com log de usuário, timestamp e valor anterior
- Alerta quando faturamento acumulado se aproxima da próxima faixa do Simples Nacional
- ICMS detalhado por par de estados de origem/destino (Lucro Real)
- Simulação comparativa entre regimes tributários

---

## Out of Scope

- **DIFAL** — requer estado de destino por pedido + fórmulas específicas por regime; 6–10 semanas de complexidade
- **Substituição Tributária (ST)** — requer NCM + par de estados simultaneamente; pauta muda frequentemente; 12–20 semanas
- **ISS** — 5.570 municípios com alíquotas próprias (2–5%); Simples já inclui ISS no DAS; 4–20 semanas
- **Geração de guias / SPED / NF-e** — plataforma é analytics, não emissor fiscal
- **Cálculo de regime por produto individual** — config é sempre por loja ML
- **Regime por organização inteira** — cada loja ML pode ter regime diferente

---

## Traceability

| REQ-ID | Fase | Nome da Fase | Status |
|--------|------|--------------|--------|
| INFRA-01 | Fase 1 | Infraestrutura | Pending |
| INFRA-02 | Fase 1 | Infraestrutura | Pending |
| FISCAL-01 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-02 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-03 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-04 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-05 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-06 | Fase 2 | Configuração Fiscal | Pending |
| FISCAL-07 | Fase 2 | Configuração Fiscal | Pending |
| CATALOG-01 | Fase 3 | Catálogo + Qualidade | Pending |
| CATALOG-02 | Fase 3 | Catálogo + Qualidade | Pending |
| CATALOG-03 | Fase 3 | Catálogo + Qualidade | Pending |
| QA-01 | Fase 3 | Catálogo + Qualidade | Pending |
