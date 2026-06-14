# Phase 45: Consultor v1 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-14
**Phase:** 45-consultor-v1
**Areas discussed:** Regras & limiares, Score de saúde 0-100, Impacto em R$, Card & painel, Engine (cadência/taxonomia/texto/multi-loja)

---

## Regras & limiares

| Opção | Descrição | Selecionada |
|-------|-----------|-------------|
| Todas as ~12 candidatas | Maximiza chance de ≥5 insights no 1º run | ✓ |
| Subconjunto enxuto (6-8) | Só as de maior confiança | |
| Você decide o corte | Claude lista e Wesley marca | |

| Opção (margem) | Descrição | Selecionada |
|-------|-----------|-------------|
| Prejuízo + baixa margem (2 níveis) | Crítico ≤0%, alerta ≤10% via useMLProductMargins | ✓ |
| Alvo único global | Piso único | |
| Por marca/categoria | Alvo por marca | |

| Opção (ads) | Descrição | Selecionada |
|-------|-----------|-------------|
| Campanha sem venda + TACoS alto | Spend sem retorno + TACoS >15% | ✓ |
| Só campanha sem venda | Caso mais óbvio | |
| ACoS/ROAS por anúncio | Granular por anúncio | |

| Opção (estoque) | Descrição | Selecionada |
|-------|-----------|-------------|
| Crítico ≤7d / alerta ≤15d | Dois níveis (reusa useMLCoverage) | ✓ |
| Só ruptura ≤3d | Só urgente | |
| Config reposição existente | Puxar do Nexo | |

| Opção (config limiares) | Descrição | Selecionada |
|-------|-----------|-------------|
| Defaults no código | Constantes centralizadas | |
| Tabela de config por org | consultor_config editável (SQL no v1) | ✓ |

| Opção (meta do mês) | Descrição | Selecionada |
|-------|-----------|-------------|
| Run-rate pelo ritmo do mês | Projeção linear acumulada | ✓ |
| Ritmo últimos 7d | Mais sensível | |
| Pular meta no v1 | Fora se ml_targets não confiável | |

| Opção (tendência) | Descrição | Selecionada |
|-------|-----------|-------------|
| 7d vs 30d anteriores | Semana vs 4 semanas | |
| Mês atual vs mês anterior | Comparação mensal cheia | ✓ |
| Você define o delta | Wesley dita o % | |

| Opção (lookback) | Descrição | Selecionada |
|-------|-----------|-------------|
| 30 dias | Janela única | |
| 60-90 dias | Sazonalidade | |
| Campanha 7d / anúncio 30d | Janelas distintas por regra | ✓ |

**Notas:** Foco em cobertura (12 regras) porque CONSUL-05 exige ≥5 insights no 1º run; limiares na tabela permitem ajuste por org no futuro.

---

## Score de saúde 0-100

| Opção (pesos) | Descrição | Selecionada |
|-------|-----------|-------------|
| Ponderado (margem/ads pesam mais) | M30/A25/E20/R15/C10 | ✓ |
| Iguais (20% cada) | Simples | |
| Você define os pesos | — | |

| Opção (faixas) | Descrição | Selecionada |
|-------|-----------|-------------|
| 3 faixas com cor e rótulo | 0-49 Crítico / 50-74 Atenção / 75-100 Saudável | ✓ |
| Só número + gradiente | — | |
| Número + rótulo, sem cor forte | — | |

| Opção (completude) | Descrição | Selecionada |
|-------|-----------|-------------|
| Reusar onboarding_progress | Zero infra nova | ✓ |
| Cobertura de dados-chave | % produtos com custo etc. | |
| Híbrido | Onboarding + % custos | |

| Opção (tendência) | Descrição | Selecionada |
|-------|-----------|-------------|
| Número + tendência (▲/▼ vs mês anterior) | Exige snapshot histórico | ✓ |
| Só número atual | Menos infra | |

**Notas:** Tendência implica snapshot do score por run (nova tabela/coluna).

---

## Impacto em R$

| Opção (cálculo) | Descrição | Selecionada |
|-------|-----------|-------------|
| Fórmula por regra onde der, qualitativo onde não | Híbrido honesto | ✓ |
| Heurística única simples | — | |
| Sempre qualitativo no v1 | — | |

| Opção (framing) | Descrição | Selecionada |
|-------|-----------|-------------|
| Perda/desperdício atual estimado | "Você está perdendo ~R$ X" | ✓ |
| Ganho potencial ao resolver | — | |
| O que fizer sentido por regra | — | |

| Opção (período) | Descrição | Selecionada |
|-------|-----------|-------------|
| Últimos 30 dias realizados | — | |
| Projeção mensal | Impacto mensal projetado | ✓ |
| Mensal p/ fluxo, 30d p/ estoque | — | |

---

## Card & painel

| Opção (quantos) | Descrição | Selecionada |
|-------|-----------|-------------|
| Top 3 | Foco total + "ver todos" | ✓ |
| Top 5 | Alinha com ≥5 | |
| Top 3 + contador | 3 + badge | |

| Opção (prioridade) | Descrição | Selecionada |
|-------|-----------|-------------|
| Severidade, depois impacto R$ | Críticos primeiro, R$ desempata | ✓ |
| Maior impacto R$ primeiro | — | |
| Score combinado (sev × R$) | — | |

| Opção (ciclo de vida) | Descrição | Selecionada |
|-------|-----------|-------------|
| Auto-resolver + dispensar | Sem snooze | ✓ |
| Só auto-resolver | — | |
| Auto-resolver + dispensar + adiar | Inclui snooze | |

| Opção (ação) | Descrição | Selecionada |
|-------|-----------|-------------|
| Texto + link para a página certa | Deep-link filtrado, sem ação automática | ✓ |
| Só explicação textual | — | |
| Link + ação em 1 clique | Vira escopo de aprovação | |

---

## Engine (cadência / taxonomia / texto / multi-loja)

| Opção (cadência) | Descrição | Selecionada |
|-------|-----------|-------------|
| Cron diário + on-demand no 1º acesso | Garante insights no 1º acesso | ✓ |
| Só cron diário | Pode ter card vazio inicial | |
| Cron + botão recalcular | Exige ação do usuário | |

| Opção (taxonomia) | Descrição | Selecionada |
|-------|-----------|-------------|
| 3 sev. + categorias = 5 pilares | Crítico/Alto/Médio + 5 pilares (+Vendas/Meta) | ✓ |
| 2 sev. + 5 pilares | Crítico/Atenção | |
| Você decide | — | |

| Opção (texto) | Descrição | Selecionada |
|-------|-----------|-------------|
| Templates por regra com variáveis | Determinístico, sem LLM | ✓ |
| Templates + Claude escreve agora | — | |
| Texto genérico por categoria | — | |

| Opção (multi-loja) | Descrição | Selecionada |
|-------|-----------|-------------|
| Por org, identificando a loja no insight | Score único da org, visão COO | ✓ |
| Por loja (separado) | — | |
| Org agora, por loja depois | — | |

---

## Claude's Discretion

- Schema das tabelas `insights`, `consultor_config`, snapshots de score.
- Mapeamento pilar → nota 0-100 dentro de cada peso.
- Fórmulas finais de impacto R$ por regra e horizonte por regra.
- Onde computar (EF Deno vs RPC SQL vs híbrido).
- Texto-modelo final dos ~12 insights (Wesley aberto a revisar).
- Resolução do escopo org de `ml_targets` para a regra de meta.

## Deferred Ideas

- UI para editar limiares do consultor na tela (fase futura UX).
- Snooze/adiar insight (v2).
- Ação em 1 clique a partir do insight (depende de aprovação).
- Score/insights separados por loja ML (futuro).
- Consultor com LLM (v8.0).
