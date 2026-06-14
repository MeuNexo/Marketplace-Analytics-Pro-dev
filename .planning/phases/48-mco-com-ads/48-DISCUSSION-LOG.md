# Phase 48: MCO com Ads - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 48-mco-com-ads
**Areas discussed:** Onde exibir, Gatilho do alerta, Escopo no Consultor, Ads sem venda, Limiares de erosão, Fonte do ads total no MCO, Janela temporal

---

## Onde exibir os 2 números + MCO agregado

| Option | Description | Selected |
|--------|-------------|----------|
| Coluna em /anuncios | MLAnuncios visão 'financeiro' — margem operacional E pós-ads por produto (SC2) | ✓ |
| Painel do Consultor | MLConsultor / card "O que fazer agora" — insight "ads comendo a margem" (SC2+SC4) | ✓ |
| Card Custos/DRE em /vendas | MCO agregado = Σ margem contribuição − ads total (SC3) | ✓ |

**User's choice:** As três superfícies.
**Notes:** Alinhado aos três success criteria do ROADMAP (SC2/SC3/SC4).

---

## Gatilho do alerta "ads comendo a margem"

| Option | Description | Selected |
|--------|-------------|----------|
| Erosão de margem | Operacional positiva mas pós-ads abaixo do alvo / negativa. Mede erosão em R$ | ✓ |
| TACoS/ACoS por produto | Reusa limiares do Consultor (TACoS>15%, ACoS>30%) por anúncio | |
| Ambos combinados | TACoS/ACoS alto E pós-ads comprometida | |

**User's choice:** Erosão de margem.
**Notes:** Mede diretamente "ads comendo a margem"; mais honesto e em R$ para o lojista.

---

## Mexe no engine do Consultor v1?

| Option | Description | Selected |
|--------|-------------|----------|
| Estende o engine | Regra nova `ads_eating_margin` por produto + upgrade `ads_no_sale` org→produto (SC4+SC5) | ✓ |
| Só RPC + UI | Phase 48 cria RPC e colunas; não toca no engine | |

**User's choice:** Estende o engine.

---

## Ads com zero venda por produto (SC5)

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, no escopo | products_cache tem date+spend+attributed_orders → quebra por produto viável | ✓ |
| Deferir p/ fase futura | Backlog | |

**User's choice:** Sim, no escopo.

---

## Limiares do alerta de erosão (consultor_config)

| Option | Description | Selected |
|--------|-------------|----------|
| Crítico ≤0% / Alerta ≤10% | Crítico: operacional>0 mas pós-ads≤0; Alerta: pós-ads<10% (alvo Phase 45) | ✓ |
| Crítico ≤0% / Alerta ≤5% | Mais tolerante | |
| Só crítico (≤0%) | Um nível só | |

**User's choice:** Crítico pós-ads ≤0% / Alerta ≤10%.

---

## Fonte do "ads total" no MCO agregado

| Option | Description | Selected |
|--------|-------------|----------|
| ml_ads_daily_cache (total da conta) | Gasto total autoritativo; evita subestimar campanhas marca/display | ✓ |
| Soma do products_cache | Σ ads atribuído por produto; ignora gasto não-atribuível | |

**User's choice:** ml_ads_daily_cache (total da conta).

---

## Janela temporal por superfície

| Option | Description | Selected |
|--------|-------------|----------|
| DRE mês-calendário p/ MCO; seletor das telas p/ produto | MCO segue DRE 01–31; produto segue janela das telas | ✓ |
| Mesma janela em tudo | Uniforme, mas desalinha do DRE mensal | |

**User's choice:** DRE mês-calendário para MCO; seletor das telas para produto.

---

## Claude's Discretion

- Forma exata da nova RPC (join orders × products_cache, LEFT/FULL para ads-only, paginação server-side).
- Colunas novas em `consultor_config` e templates de texto dos insights.
- Se `ads_eating_margin` afeta o pilar Ads do score (peso 25).
- Componentização das colunas (MLAnuncios) e da linha de ads (MLCostCard/DRE).
- Substituir vs complementar o `ads_no_sale` org-level existente.

## Deferred Ideas

- UI para editar limiares de erosão na tela → Phase 46 (UX).
- Atribuir campanhas de marca/display a itens → fora do escopo (MCO usa total da conta).
- Score/insights separados por loja ML → futuro (v1 consolida por org).
