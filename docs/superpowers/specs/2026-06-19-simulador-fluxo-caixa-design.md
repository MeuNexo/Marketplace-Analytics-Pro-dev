# Simulador "E se...?" — Fluxo de Caixa

**Data:** 2026-06-19
**Projeto:** garment-glow-test (Marketplace Analytics Pro) — Supabase `ckcdevcxgvueywivefgx`
**Origem:** porte da ideia do `ScenarioSimulator` do nexointeligence, enxuto para o caso de uso do Wesley.
**Relacionado:** Phase 49 (Fluxo de Caixa) — esta feature foi explicitamente deferida no escopo da Phase 49.

## 1. Objetivo

Permitir simular cenários de caixa arrastando médias de **recebimento** e **gasto** (mais até 2 eventos pontuais) para responder, de forma direta: **"posso gastar mais ou preciso receber mais?"**. Sem sair da página de Fluxo de Caixa, sem salvar nada.

## 2. Decisões travadas (Wesley, 2026-06-19)

- **Modelo:** híbrido — 2 sliders de média (delta) + até 2 eventos pontuais.
- **Semântica dos sliders:** "extra sobre o real" (delta sobre o cenário projetado). Recebimento extra/dia e gasto extra/dia.
- **Veredito:** Folga + status. "Pode gastar até +R$X/dia" OU "precisa +R$Y/dia de recebimento", mais selo Saudável/Risco.
- **Saúde:** saldo nunca abaixo da margem de segurança (`financial_settings.safety_margin`, default R$ 10.000).
- **Localização:** aba na própria página de Fluxo de Caixa (`/fluxo-de-caixa`): "Caixa Real" | "Simulador".
- **Persistência:** nenhuma. Estado só na sessão (recarregou → volta ao real).
- **Cálculo:** 100% frontend, reusando o RPC `get_cashflow` existente. Zero migration, zero tabela, zero RPC nova.

## 3. Escopo

**No escopo (MVP):**
- Aba "Simulador" na página de Fluxo de Caixa (Tabs shadcn).
- 2 sliders (recebimento extra/dia, gasto extra/dia) + até 2 eventos pontuais (valor, data, tipo entrada/saída).
- Gráfico = base do Fluxo de Caixa + 3ª linha "Cenário simulado" (só aparece quando há simulação ativa).
- Painel de veredito (status + folga/necessidade + menor saldo e data).
- Botão "Limpar" (reseta para o real).

**Fora do escopo:**
- Salvar/comparar cenários nomeados (sem tabela).
- Recomendações de renegociação por conta (o "renegociar conta X pra data Y" do clone).
- CRUD de regras com frequência (diário/semanal/mensal) — substituído por sliders de média + eventos pontuais.
- Qualquer mudança de backend (RPC/EF/migration).

## 4. UI / Layout

A página `/fluxo-de-caixa` (componente atual `MLFluxoCaixa`) passa a ter `Tabs`:
- **Aba "Caixa Real"** — conteúdo atual intocado (cards + `CashFlowChart`).
- **Aba "Simulador"** — novo componente `CashFlowSimulator`:
  - **Coluna controles** (esquerda em desktop, topo em mobile):
    - Slider "Recebimento extra por dia": range −5.000 … +5.000, step 100, default 0. Label mostra o valor atual formatado.
    - Slider "Gasto extra por dia": range 0 … +10.000, step 100, default 0.
    - Lista de **eventos pontuais** (0 a 2): cada um com input de valor (R$), date picker (dentro do horizonte de 120d), toggle entrada/saída, botão remover. Botão "+ Adicionar evento" some ao atingir 2.
    - Botão "Limpar" (zera sliders e eventos).
  - **Coluna resultado** (direita):
    - **Painel de veredito** no topo (card): selo Saudável/Risco + frase de folga/necessidade + menor saldo e data crítica.
    - **Gráfico** abaixo: reusa o visual do `CashFlowChart` com a 3ª linha "Cenário simulado".

Ranges/step são ajustáveis; valores acima são os defaults aprovados.

## 5. Matemática (núcleo testável)

Entrada: série base do `get_cashflow` (cada ponto tem `fullDate` e `accumulated_balance_sma` = saldo projetado), `recebExtra` (R$/dia), `gastoExtra` (R$/dia), `eventos[]` ({valor, data, tipo}), `margem` (R$).

Para cada ponto `i` (0-indexed, i=0 é hoje), com `diasDecorridos = i + 1`:
```
deltaMediaAcum(i) = (recebExtra − gastoExtra) × diasDecorridos
eventosAcum(i)    = Σ eventos cujo data ≤ fullDate(i)   (entrada: +valor, saída: −valor)
cenario(i)        = accumulated_balance_sma(i) + deltaMediaAcum(i) + eventosAcum(i)
```
Veredito:
```
menorSaldo   = min(cenario(i))     ao longo do horizonte
valeIdx      = argmin(cenario(i))
diasAteVale  = valeIdx + 1
status       = menorSaldo ≥ margem ? "saudavel" : "risco"
folgaGastoDia        = max(0, (menorSaldo − margem) / diasAteVale)   // quando saudável
necessidadeReceitaDia = max(0, (margem − menorSaldo) / diasAteVale)  // quando risco
```
Notas:
- `folgaGastoDia` é uma aproximação pelo dia do vale (cada R$1/dia de gasto extra reduz o saldo no vale em ~`diasAteVale`). Suficiente para orientar; não é otimização exata.
- A linha "Cenário simulado" só é renderizada quando há simulação ativa (`recebExtra≠0 || gastoExtra≠0 || eventos.length>0`).

## 6. Arquitetura de componentes

- **`src/lib/cashflowSimulation.ts`** (novo) — função pura `simulateCashflow(base, params) → { series, verdict }`. Sem React, sem Supabase. **É onde mora a matemática e o alvo dos testes unitários.**
- **`src/hooks/useCashFlowData.ts`** (existente) — fonte do baseline; reusado como está (já expõe `accumulated_balance` / `accumulated_balance_sma` / `daily_projection`).
- **`src/components/financial/CashFlowSimulator.tsx`** (novo) — estado de sessão (`useState`: recebExtra, gastoExtra, eventos), controles, chama `simulateCashflow`, renderiza veredito + gráfico.
- **`src/components/financial/SimulatorVerdictCard.tsx`** (novo) — card de status/folga (isolado, fácil de testar visualmente).
- **`src/components/financial/CashFlowChart.tsx`** (existente) — estender para aceitar uma série/linha opcional "Cenário simulado" (prop opcional `simulatedSeries`), mantendo 100% compatível com o uso atual (aba Caixa Real não passa a prop → nada muda).
- **`src/pages/.../MLFluxoCaixa.tsx`** (existente) — adicionar `Tabs` ("Caixa Real" | "Simulador").

Cor da linha simulada: `hsl(var(--kpi-neutral))` (azul) tracejada — distinta do verde (Saldo Real) e âmbar (Projetado).

## 7. Edge cases

- **Baseline ainda carregando / vazio:** aba mostra skeleton/aviso, controles desabilitados.
- **Sem simulação ativa:** linha simulada oculta; veredito reflete o próprio cenário projetado (menorSaldo do baseline).
- **Evento com data fora do horizonte (>120d ou no passado):** date picker limita ao intervalo [hoje, hoje+120]; eventos fora são bloqueados na UI.
- **menorSaldo já abaixo da margem sem simular:** status Risco já no estado inicial — correto (reflete a realidade que validamos).
- **Divisão por zero:** `diasAteVale ≥ 1` sempre (i começa em 0 → +1).

## 8. Testes

- **Unitários (vitest) em `cashflowSimulation.ts`:**
  - sem params → série == baseline; veredito usa menorSaldo do baseline.
  - gastoExtra empurra menorSaldo abaixo da margem → status risco + necessidadeReceitaDia > 0.
  - recebExtra suficiente → status saudável + folgaGastoDia > 0.
  - evento de saída pontual rebaixa o saldo a partir da data certa (não antes).
  - evento de entrada pontual sobe o saldo a partir da data certa.
  - folga/necessidade calculadas no dia do vale correto.
- **Smoke manual:** arrastar sliders atualiza gráfico e veredito em tempo real; "Limpar" volta ao real; mobile responsivo.

## 9. Não-objetivos / riscos

- A folga é aproximação pelo vale, não garante o ponto ótimo exato — comunicar como orientação ("até ~R$X/dia").
- Não altera nem grava nada no banco; é leitura + cálculo client-side.
- Não toca a aba "Caixa Real" (já validada com a planilha DFC do Wesley).
