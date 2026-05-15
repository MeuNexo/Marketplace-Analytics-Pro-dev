# Requirements — Módulo Fiscal

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

| REQ-ID | Fase |
|---|---|
| INFRA-01 | Fase 1 |
| INFRA-02 | Fase 1 |
| FISCAL-01 | Fase 2 |
| FISCAL-02 | Fase 2 |
| FISCAL-03 | Fase 2 |
| FISCAL-04 | Fase 2 |
| FISCAL-05 | Fase 2 |
| FISCAL-06 | Fase 2 |
| FISCAL-07 | Fase 2 |
| CATALOG-01 | Fase 3 |
| CATALOG-02 | Fase 3 |
| CATALOG-03 | Fase 3 |
| QA-01 | Fase 3 |
