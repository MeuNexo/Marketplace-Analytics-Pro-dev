# Research Summary — Módulo Fiscal

## Stack

- Sem biblioteca JS/TS para tributos federais BR; implementar funções TypeScript puras em `src/lib/tax/`
- Schema: tabela `ml_tax_config` com colunas normalizadas por regime + coluna `effective_rate` derivada por trigger PostgreSQL
- JSONB descartado: colunas normalizadas são mais queryáveis e permitem `CHECK` constraints por regime
- Zod discriminated union valida cada shape no frontend antes de persistir

## Features

- **Simples Nacional**: aceitar apenas alíquota efetiva (não nominal) — fornecida pelo contador via PGDAS-D
- **Lucro Presumido**: PIS 0,65% e COFINS 3,00% pré-preenchidos (fixados em lei, regime cumulativo); IRPJ/CSLL variam por atividade (Comércio vs. Serviços)
- **Lucro Real**: débitos e créditos de PIS/COFINS (e opcionalmente ICMS); `effective_rate = débitos − créditos`
- UX: tabs por regime (não dropdown); preview em tempo real; aviso de disclaimer obrigatório
- Seletor de tipo de atividade no Lucro Presumido para pré-preencher defaults de IRPJ/CSLL

## Architecture

- Tabela `ml_tax_config` com UNIQUE (ml_user_id, organization_id) — um regime ativo por loja
- RLS: SELECT para todos os membros da org; INSERT/UPDATE/DELETE apenas para owner
- Consumo no frontend: hook `useMLTaxConfig` → Map<ml_user_id, effective_rate>
- Coluna Impostos em MLProdutos: `taxRate = taxConfigMap.get(item._ml_user_id) ?? productCost?.tax_rate ?? null`
- Sem edge function; sem DB view — aritmética simples no frontend

## Pitfalls

- Disclaimer legal obrigatório: "estimativa para análise de margem — não use para emissão de guias/SPED/NFe"
- Dialog de confirmação na troca de regime para evitar sobrescrever acidentalmente
- Armazenar como `NUMERIC(6,4)`, arredondar apenas no display final
- DIFAL, ST, ISS, NF-e = scope creep de meses — manter hard boundary no PROJECT.md
- Taxa efetiva negativa (LR com créditos): limitar display em 0%, exibir badge "Crédito"
