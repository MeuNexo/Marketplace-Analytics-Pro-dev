# Phase 50: Simulador de Cenarios de Caixa ("E se...?") - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning
**Source:** Brainstorm completo com Wesley (superpowers:brainstorming) — spec aprovado.

<domain>
## Phase Boundary

Adicionar uma **aba "Simulador"** na pagina de Fluxo de Caixa (`/fluxo-de-caixa`, componente `MLFluxoCaixa`) que permite simular cenarios de caixa: o lojista arrasta medias de **recebimento extra/dia** e **gasto extra/dia** (deltas sobre o cenario real) e adiciona ate **2 eventos pontuais** (valor/data/tipo), vendo na hora como o saldo evolui. Responde "posso gastar mais ou preciso receber mais?" via veredito **Folga + status** (Saudavel/Risco).

Reusa o RPC `get_cashflow` ja existente (Phase 49) como baseline. **Calculo 100% no frontend.** ZERO migration, ZERO tabela, ZERO RPC nova, ZERO Edge Function. Sem persistencia (estado so de sessao).
</domain>

<decisions>
## Implementation Decisions (LOCKED — Wesley 2026-06-19)

### Modelo de interacao
- Hibrido: 2 sliders de media (delta "extra sobre o real") + ate 2 eventos pontuais.
- Slider "recebimento extra/dia": range -5000..+5000, step 100, default 0.
- Slider "gasto extra/dia": range 0..+10000, step 100, default 0.
- Eventos pontuais (0 a 2): valor (R$) + data (dentro de [hoje, hoje+120]) + tipo (entrada/saida). Botao "+ Adicionar evento" some ao atingir 2; lixeira remove.
- Botao "Limpar" (zera sliders e eventos).

### Matematica (sobre o baseline da linha projetada `accumulated_balance_sma`)
- Para cada ponto i (0-indexed, i=0 = hoje), diasDecorridos = i+1:
  - `deltaMediaAcum(i) = (recebExtra - gastoExtra) * diasDecorridos`
  - `eventosAcum(i) = soma de eventos com data <= fullDate(i)` (entrada +valor, saida -valor)
  - `cenario(i) = accumulated_balance_sma(i) + deltaMediaAcum(i) + eventosAcum(i)`
- Veredito:
  - `menorSaldo = min(cenario)`, `valeIdx = argmin`, `diasAteVale = valeIdx+1`
  - `status = menorSaldo >= margem ? "saudavel" : "risco"` (margem = financial_settings.safety_margin, default 10000)
  - `folgaGastoDia = max(0, (menorSaldo - margem) / diasAteVale)` (quando saudavel)
  - `necessidadeReceitaDia = max(0, (margem - menorSaldo) / diasAteVale)` (quando risco)

### Veredito (output)
- Selo Saudavel (verde) / Risco (vermelho).
- Saudavel: "Voce ainda pode gastar ate +R$X/dia mantendo o caixa seguro".
- Risco: "Caixa fica abaixo da margem em [data]. Precisa de +R$Y/dia de recebimento (ou cortar R$Z) para equilibrar".
- Mostra menor saldo e a data.

### UI / Localizacao
- Aba na propria pagina de Fluxo de Caixa: Tabs shadcn "Caixa Real" | "Simulador".
- Aba "Caixa Real" = conteudo atual INTOCADO (ja validado com a planilha DFC do Wesley).
- 3a linha "Cenario simulado" no grafico (tracejada, cor `hsl(var(--kpi-neutral))` = azul), so aparece quando ha simulacao ativa.

### Persistencia
- Nenhuma. Estado so na sessao (useState). Recarregou -> volta ao real.

### Escopo FORA (nao fazer)
- Salvar/comparar cenarios nomeados (sem tabela).
- Recomendacoes de renegociacao por conta (o "renegociar conta X" do clone).
- CRUD de regras com frequencia (substituido por sliders + eventos pontuais).
- Qualquer mudanca de backend.

### Claude's Discretion (resolver no plano)
- Layout exato dos controles (grid/stack), responsividade mobile.
- Componente de date picker para eventos (reusar Calendar/Popover shadcn ja no projeto).
- Como estender CashFlowChart sem quebrar o uso atual (prop opcional `simulatedSeries`).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec da feature (fonte primaria)
- `docs/superpowers/specs/2026-06-19-simulador-fluxo-caixa-design.md` — design completo aprovado (arquitetura, matematica, UI, edge cases, testes). É o contrato desta fase.

### Codigo existente a reusar (Phase 49)
- `src/hooks/useCashFlowData.ts` — baseline; expoe `CashFlowDataPoint` (fullDate, accumulated_balance, accumulated_balance_sma, daily_projection, daily_income, daily_expense). Reusar como esta.
- `src/components/financial/CashFlowChart.tsx` — grafico atual (Recharts ComposedChart). Estender com prop opcional `simulatedSeries`, 100% compativel.
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` — pagina alvo; adicionar Tabs.
- `src/hooks/useFinancialSettings.ts` (se existir) ou financial_settings — margem de seguranca (safety_margin).
- shadcn ja disponiveis: `src/components/ui/{slider,tabs,switch,popover,calendar,card,button,input,label}.tsx`.

### Padroes do projeto
- `./CLAUDE.md` — convencoes (React 18 + TS + shadcn + Recharts 2.15.4 + TanStack Query; cores SEMPRE `hsl(var(--token))`, nunca var cru — foi bug em sessao anterior).
- Testes: vitest 3.2.4 + @testing-library/react ja configurados.
</canonical_refs>

<specifics>
## Specific Ideas

- Modulo puro `src/lib/cashflowSimulation.ts` (sem React/Supabase) = onde mora a matematica; alvo dos testes unitarios vitest.
- Cor da linha simulada: `hsl(var(--kpi-neutral))` (azul) tracejada — distinta do verde (Saldo Real) e ambar (Projetado).
- Card de veredito isolado: `src/components/financial/SimulatorVerdictCard.tsx`.
- Componente da aba: `src/components/financial/CashFlowSimulator.tsx` (estado de sessao + controles + integra tudo).
</specifics>

<deferred>
## Deferred Ideas

- Salvar cenarios nomeados (tabela + CRUD).
- Recomendacoes de renegociacao por conta.
- Eventos recorrentes (frequencia diaria/semanal/mensal).
</deferred>

---

*Phase: 50-simulador-de-cenarios-de-caixa-e-se*
*Context: brainstorm 2026-06-19 — decisoes travadas do Wesley + spec aprovado*
