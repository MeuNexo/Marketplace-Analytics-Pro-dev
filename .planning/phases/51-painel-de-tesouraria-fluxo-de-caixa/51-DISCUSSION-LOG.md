# Phase 51: Painel de Tesouraria (Fluxo de Caixa) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 51-painel-de-tesouraria-fluxo-de-caixa
**Areas discussed:** Cards atuais, Janela Realizado, Limite do alerta, Total Exposicao

---

## Cards atuais (substituicao)

| Option | Description | Selected |
|--------|-------------|----------|
| Substituir os 3 cards | 12 KPIs no lugar de Caixa Hoje + Projecao Futura + Capacidade | ✓ |
| Manter Caixa Hoje | Preserva breakdown de hoje, remove os outros 2 | |
| Remover so Capacidade | Mantem Caixa Hoje + Projecao, KPIs abaixo | |

**User's choice:** Substituir os 3 cards
**Notes:** Wesley considera o card "Posso comprar mais estoque?" irrelevante; quer o painel de tesouraria identico a referencia visual enviada.

---

## Janela Realizado (Entrada/Saida/Resultado + Burn Rate)

| Option | Description | Selected |
|--------|-------------|----------|
| 3 meses-calendario fechados | Burn = Saida / 3, bate com a imagem | |
| Rolling 90 dias | Ultimos 90d corridos | |
| Mes corrente | So o mes atual | |
| **Ultimos 30 dias** (free-text) | Bloco realizado sobre ultimos 30 dias | ✓ |

**User's choice:** Ultimos 30 dias (resposta livre)
**Notes:** Aplicado a Entrada/Saida/Resultado Real. Burn Rate mantido em media de 3 meses (D-08) para nao duplicar a Saida Real — sinalizado como ponto a confirmar no checkpoint visual.

---

## Limite do alerta de saldo

| Option | Description | Selected |
|--------|-------------|----------|
| Configuravel (default R$30k) | Novo campo alert_threshold em financial_settings | ✓ |
| Fixo R$30.000 | Hardcoded | |
| Reusar safety_margin (R$10k) | Margem existente, mas mudaria o numero | |

**User's choice:** Configuravel (default R$30k)
**Notes:** Novo campo em financial_settings, editavel sem deploy.

---

## Total Exposicao

| Option | Description | Selected |
|--------|-------------|----------|
| So fornecedores, todos vencimentos | supplier preenchido, status pending, qualquer data | ✓ |
| Todas as saidas pendentes | Qualquer categoria | |
| Fornecedores ate 90d | = Fornec 90d, contradiz a imagem | |

**User's choice:** So fornecedores, todos vencimentos
**Notes:** Coerente com o grafico de Exposicao por Fornecedor; Total (671k) > Fornec 90d (311k) confirma vencimentos alem de 90d.

---

## Claude's Discretion

- Layout fino do grid de KPIs (3 faixas x 4 colunas), componentes recharts/shadcn a reusar.
- RPC de agregacao (provavel `get_treasury_panel` SECURITY INVOKER) — definir no research/planning.
- Top N de fornecedores no grafico de exposicao; horizonte do grafico de composicao de custos.

## Deferred Ideas

- Drill-down por fornecedor (clicar na barra -> contas a pagar do fornecedor) — fase futura.
- Configuracao do horizonte de projecao (90/120/180d) pela UI — por ora fixo 90d.
