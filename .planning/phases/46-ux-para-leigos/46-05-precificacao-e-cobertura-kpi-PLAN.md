---
phase: 46-ux-para-leigos
plan: 05
type: execute
wave: 2
depends_on: ["46-01"]
files_modified:
  - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
  - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
  - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
  - src/pages/mercadolivre/MLPublicidade.tsx
  - src/pages/mercadolivre/MLRelatorios.tsx
  - src/pages/mercadolivre/MLReputacao.tsx
  - src/pages/mercadolivre/MLPerguntas.tsx
  - src/pages/mercadolivre/MLDevolucoes.tsx
  - src/pages/TVModeVendas.tsx
autonomous: true
requirements: [UX-01, UX-04]
user_setup: []

must_haves:
  truths:
    - "Na página /precificacao (aba Simulador e aba Análise), os indicadores binários de valor positivo/negativo (margem boa, acima/abaixo do break-even, delta de comparação, compra recomendada) usam os tokens text-kpi-positive/text-kpi-negative em vez de cores hardcoded emerald/red (D-08)."
    - "A cor de aviso/borderline (text-amber-600 do tier 'warn') e o badge de destaque de estratégia GMV (bg-emerald-500/10 ring-emerald-500/30 text-emerald-700) de /precificacao permanecem inalterados — não são indicadores positivo/negativo (D-08)."
    - "Todo consumidor de KPICard em src/ foi enumerado via grep e, para cada KPICard de métrica não coberto pelos planos 46-02/46-03, recebe a definição leiga do glossário central via prop tooltip (D-01) — fechando a cobertura UX-01."
    - "Os KPICards de status/contagem (ex.: contadores de Integrations) que não correspondem a nenhum termo do glossário são registrados como exclusão justificada, não recebem tooltip forçado (D-01)."
    - "A auditoria de tokens fica restrita às 6 páginas de D-08 (incluindo /precificacao); nenhuma cor de Recharts SVG (fill=/stroke=), status ou categoria é alterada (D-08/D-09)."
  artifacts:
    - path: "src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx"
      provides: "Tokens kpi nos indicadores binários (break-even e tier 'good')"
      contains: "text-kpi-positive"
    - path: "src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx"
      provides: "Delta de comparação com tokens kpi positivo/negativo"
      contains: "text-kpi-positive"
    - path: "src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx"
      provides: "Indicador de compra recomendada com token kpi positivo"
      contains: "text-kpi-positive"
    - path: "src/pages/mercadolivre/MLPublicidade.tsx"
      provides: "KPICards de publicidade ligados ao glossário central"
      contains: "KPI_GLOSSARY"
  key_links:
    - from: "src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx"
      to: "text-kpi-positive"
      via: "substituição de text-emerald-600 nos indicadores binários (tier good + break-even)"
      pattern: "text-kpi-(positive|negative)"
    - from: "src/pages/mercadolivre/MLPublicidade.tsx"
      to: "@/lib/kpi-glossary"
      via: "import KPI_GLOSSARY + helper tip(key) na prop tooltip dos KPICards"
      pattern: "KPI_GLOSSARY"
---

<objective>
Fechar duas lacunas que o plan-checker apontou e que os planos 46-02/46-03 deixaram em aberto, SEM tocar nos arquivos desses planos:

1. UX-04 (D-08) — /precificacao na auditoria de tokens: a rota /precificacao renderiza `MLPrecificacao.tsx` (container fino de 48 linhas) que delega para `SimuladorPrecificacao` e `AnaliseDashboard`. Esses filhos têm cores hardcoded positivo/negativo (`text-emerald-600`/`text-red-600`/`text-destructive`) que devem virar tokens `text-kpi-positive`/`text-kpi-negative` quando representam um indicador binário de valor. Cores de aviso (amber), de categoria/destaque (badge GMV) e de status permanecem.
2. UX-01 (D-01) — varredura de cobertura de KPICard (WARNING 1 do checker): enumerar via `grep -rl "KPICard" src --include='*.tsx'` TODOS os consumidores de KPICard e garantir que cada KPICard de métrica receba a definição leiga do glossário central. Os planos 46-02 e 46-03 já cobrem MLKPIGrid, MLSalesAnalytics, MLAnuncios, MLFinanceiro e MLPedidos; este plano cobre os sites restantes (/tv, /devolucoes, /perguntas, /reputacao, /relatorios, /publicidade) e registra como evidência os sites que não têm termo de glossário aplicável (contadores de status).

Boundary: D-09 mantém as ~14 rotas restantes fora da auditoria *visual* de tokens; a auditoria de tokens deste plano fica restrita a /precificacao (a 6ª página de D-08). A varredura UX-01 (glossário) NÃO tem restrição de página em CONTEXT — é uma cobertura de fonte única (D-01), por isso alcança os sites de KPICard fora das 6 páginas, sem alterar tokens visuais nessas rotas.

Purpose: garantir que a 6ª página da auditoria D-08 (/precificacao) realmente recebe os tokens kpi e que NENHUM KPICard fica sem glossário — fechando os dois blockers/warnings do checker antes do checkpoint visual (46-04).
Output: 9 arquivos modificados (3 de token swap em /precificacao + 6 de wiring de glossário em sites de KPICard descobertos pela varredura). Sem novos arquivos.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/46-ux-para-leigos/46-CONTEXT.md
@.planning/phases/46-ux-para-leigos/46-01-SUMMARY.md

# Token swap /precificacao — ler antes de editar
@src/pages/mercadolivre/MLPrecificacao.tsx
@src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
@src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
@src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
@src/components/mercadolivre/analise/AnalisePrecosTable.tsx

# Glossário e padrão tip(key) — ler antes de wirear
@src/lib/kpi-glossary.ts
@src/components/dashboard/KPICard.tsx
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Tokens kpi nos indicadores binários de /precificacao (UX-04, D-08)</name>
  <files>src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx, src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx, src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx</files>
  <read_first>
    - src/pages/mercadolivre/MLPrecificacao.tsx — confirma que a página é container fino que renderiza `SimuladorPrecificacao` (aba simulador) e `AnaliseDashboard` (aba análise); os indicadores de cor vivem nos filhos.
    - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx — linha ~289 `const tierColor = tier === "good" ? "text-emerald-600" : tier === "warn" ? "text-amber-600" : "text-destructive"` (ternário de 3 tiers) e linha ~709 `result.receitaBruta >= result.breakEven ? "text-emerald-600" : "text-destructive"` (binário acima/abaixo do break-even).
    - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx — linha ~23 `const className = d > 0 ? "text-emerald-600" : "text-red-600"` (delta binário).
    - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx — linha ~185 `result.compraRecomendada > 0 ? "text-xs text-emerald-600 font-semibold" : "text-xs text-muted-foreground"` (positivo vs neutro).
    - src/index.css §`--kpi-positive`/`--kpi-negative` (light/dark) — confirma que os tokens `text-kpi-positive`/`text-kpi-negative` existem e têm variante dark.
  </read_first>
  <action>
    Substituir SOMENTE os indicadores binários de valor positivo/negativo pelos tokens kpi, mantendo as cores de aviso/categoria.

    (a) SimuladorPrecificacao.tsx ~L289 (`tierColor`): trocar APENAS o ramo `good` de `text-emerald-600` por `text-kpi-positive`. MANTER `text-amber-600` (tier `warn` = aviso/borderline, não é positivo nem negativo) e MANTER `text-destructive` (tier `bad`) — este ternário é um indicador de 3 níveis, não um binário pos/neg; só o verde "good" vira token positivo. NÃO tocar em `tierBg` (cores de fundo bg-emerald/amber/destructive são acompanhamento do tier, deixar como estão).

    (b) SimuladorPrecificacao.tsx ~L709 (break-even): este É um indicador binário (acima vs abaixo do ponto de equilíbrio). Trocar `text-emerald-600` por `text-kpi-positive` E `text-destructive` por `text-kpi-negative` — decisão do planner: usar o par kpi-positive/kpi-negative para consistência semântica binária nesta superfície de precificação.

    (c) HistoricoComparacaoPanel.tsx ~L23: `d > 0 ? "text-emerald-600" : "text-red-600"` → `d > 0 ? "text-kpi-positive" : "text-kpi-negative"` (delta binário de comparação).

    (d) CompraRecomendadaPanel.tsx ~L185: trocar `text-emerald-600` por `text-kpi-positive` no ramo positivo; MANTER `text-muted-foreground` no ramo neutro (não é negativo, é ausência de recomendação).

    NÃO tocar em AnalisePrecosTable.tsx: o `STRATEGY_CELL_CLASSES` (~L31, `bg-emerald-500/10 ring-emerald-500/30 text-emerald-700` para a estratégia `gmv`) é um destaque de CATEGORIA de estratégia (gmv/neutral/margin), não um indicador de valor positivo/negativo — deixar inalterado (D-08, exceção de cor de categoria). Não alterar nenhuma cor de Recharts SVG (fill=/stroke=) nem cores de status nesses arquivos.
  </action>
  <verify>
    <automated>cd /root/garment-glow-test && npx tsc --noEmit 2>&1 | grep -iE "SimuladorPrecificacao|HistoricoComparacaoPanel|CompraRecomendadaPanel" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'SimuladorPrecificacao|HistoricoComparacaoPanel|CompraRecomendadaPanel')" && grep -q "text-kpi-positive" src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx && grep -q "text-kpi-positive" src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx && grep -q "text-kpi-positive" src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx && test "$(grep -c 'text-red-600' src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx)" -eq 0 && grep -q "text-emerald-700" src/components/mercadolivre/analise/AnalisePrecosTable.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - SimuladorPrecificacao: ramo `good` do tier e indicador de break-even usam `text-kpi-positive`/`text-kpi-negative`; `text-amber-600` (warn) preservado; `tierBg` intocado.
    - HistoricoComparacaoPanel: delta usa `text-kpi-positive`/`text-kpi-negative`; nenhum `text-red-600` restante no arquivo.
    - CompraRecomendadaPanel: ramo positivo usa `text-kpi-positive`; ramo neutro `text-muted-foreground` preservado.
    - AnalisePrecosTable: badge de estratégia GMV (`text-emerald-700`) PRESERVADO (não é pos/neg).
    - `npx tsc --noEmit` limpo para os três arquivos editados.
  </acceptance_criteria>
  <done>/precificacao exibe os indicadores binários positivo/negativo via tokens kpi (dark mode incluso); cores de aviso e de categoria preservadas; tsc limpo.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Varredura de cobertura de KPICard + wiring do glossário nos sites restantes (UX-01, D-01)</name>
  <files>src/pages/mercadolivre/MLPublicidade.tsx, src/pages/mercadolivre/MLRelatorios.tsx, src/pages/mercadolivre/MLReputacao.tsx, src/pages/mercadolivre/MLPerguntas.tsx, src/pages/mercadolivre/MLDevolucoes.tsx, src/pages/TVModeVendas.tsx</files>
  <read_first>
    - 46-01-SUMMARY.md + src/lib/kpi-glossary.ts — as chaves disponíveis (`keyof typeof KPI_GLOSSARY`) e o tipo das entradas (`definition` + `example?`).
    - src/components/dashboard/KPICard.tsx — confirma a prop `tooltip?: string` (renderizada como texto puro dentro do shadcn Tooltip; sem HTML bruto).
    - O helper `tip(key)` já estabelecido em 46-02 (MLKPIGrid) / 46-03 — concatena `definition` + `example` quando existir, tipado por `keyof typeof KPI_GLOSSARY`. Reusar o MESMO padrão em cada arquivo deste plano.
    - Cada um dos 6 arquivos-alvo — localizar os `<KPICard ... title="...">` e mapear cada título a uma chave do glossário.
  </read_first>
  <action>
    Primeiro, rodar a varredura de cobertura e registrá-la no SUMMARY:
    `grep -rl "KPICard" src --include='*.tsx'`
    Classificar cada consumidor em uma de três categorias e documentar a lista no SUMMARY:
      - JÁ COBERTO por outro plano: MLKPIGrid + MLSalesAnalytics (46-02); MLAnuncios + MLFinanceiro + MLPedidos (46-03); MLEstoque (46-02, sem KPICard de métrica que exija glossário — confirmar). KPICard.tsx é o primitivo, não um consumidor.
      - WIRE NESTE PLANO (KPICards de métrica sem tooltip): src/pages/mercadolivre/MLPublicidade.tsx, src/pages/mercadolivre/MLRelatorios.tsx, src/pages/mercadolivre/MLReputacao.tsx, src/pages/mercadolivre/MLPerguntas.tsx, src/pages/mercadolivre/MLDevolucoes.tsx, src/pages/TVModeVendas.tsx.
      - EXCLUSÃO JUSTIFICADA (KPICard de status/contagem sem termo de glossário aplicável): src/pages/Integrations.tsx — os 4 KPICards são contadores de conexão ("Marketplaces conectados", "Lojas conectadas", "Disponíveis", "Autenticação: OAuth 2.0"), não métricas de e-commerce; NÃO existe termo leigo no glossário para eles, então NÃO forçar tooltip. src/pages/mercadolivre/MLMetas.tsx — grep confirma 0 KPICards (registrar como "sem KPICard"). Registrar essas exclusões com a justificativa no SUMMARY para o verifier ver cobertura UX-01 completa.

    Depois, em CADA um dos 6 arquivos a wirear: importar `KPI_GLOSSARY` de `@/lib/kpi-glossary`, definir o helper local `tip` tipado por `keyof typeof KPI_GLOSSARY` (mesmo padrão de 46-02/46-03), e adicionar `tooltip={tip("<chave>")}` em cada KPICard cujo título corresponda a um termo do glossário (ex.: receita, pedidos, ticket médio, conversão, ROAS/ACoS/TACoS em /publicidade, reputação, perguntas, devoluções, etc.). Se algum título de KPICard num desses arquivos não tiver chave correspondente no glossário, registrar no SUMMARY como exclusão justificada em vez de forçar — NÃO inventar chave. Usar exclusivamente chaves existentes no union `keyof typeof KPI_GLOSSARY` (o tsc valida via keyof; chave inexistente = erro de compilação, que deve ser resolvido escolhendo a chave correta ou marcando como exclusão). NÃO alterar a lógica/cálculo dos KPIs, nem layout, nem cores — apenas adicionar a prop `tooltip`. NÃO tocar em nenhum dos arquivos dos planos 46-02/46-03.
  </action>
  <verify>
    <automated>cd /root/garment-glow-test && npx tsc --noEmit 2>&1 | grep -iE "MLPublicidade|MLRelatorios|MLReputacao|MLPerguntas|MLDevolucoes|TVModeVendas" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'MLPublicidade|MLRelatorios|MLReputacao|MLPerguntas|MLDevolucoes|TVModeVendas')" && for f in src/pages/mercadolivre/MLPublicidade.tsx src/pages/mercadolivre/MLRelatorios.tsx src/pages/mercadolivre/MLReputacao.tsx src/pages/mercadolivre/MLPerguntas.tsx src/pages/mercadolivre/MLDevolucoes.tsx src/pages/TVModeVendas.tsx; do grep -q "KPI_GLOSSARY" "$f" || { echo "FALTA glossario em $f"; exit 1; }; grep -q "tooltip={tip(" "$f" || { echo "FALTA tooltip em $f"; exit 1; }; done && UNCOVERED=$(grep -rl "KPICard" src --include='*.tsx' | grep -vE "KPICard.tsx|MLKPIGrid|MLSalesAnalytics|MLAnuncios|MLFinanceiro|MLPedidos|MLEstoque|MLPublicidade|MLRelatorios|MLReputacao|MLPerguntas|MLDevolucoes|TVModeVendas|Integrations" | grep -vc "KPI_GLOSSARY") && echo "Sites de KPICard fora do mapa conhecido: $UNCOVERED (esperado 0)" && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - A varredura `grep -rl "KPICard" src --include='*.tsx'` foi executada e classificada (coberto / wireado aqui / exclusão justificada) no SUMMARY.
    - Os 6 arquivos-alvo importam `KPI_GLOSSARY`, definem `tip` tipado por `keyof typeof KPI_GLOSSARY` e têm ≥1 KPICard com `tooltip={tip("...")}`.
    - Sites de status (Integrations) e sem KPICard (MLMetas) registrados como exclusão justificada — sem tooltip forçado.
    - Nenhum arquivo dos planos 46-02/46-03 foi modificado por este plano.
    - `npx tsc --noEmit` limpo para os 6 arquivos editados (keyof valida chaves inexistentes).
  </acceptance_criteria>
  <done>Todo KPICard de métrica em src/ recebe glossário (próprio ou via 46-02/03); contadores de status registrados como exclusão; cobertura UX-01 fechada com evidência no SUMMARY; tsc limpo.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Este plano faz apenas (a) troca de classes Tailwind (`text-emerald-*`/`text-red-*` → `text-kpi-*`) e (b) wiring da prop `tooltip` com strings estáticas vindas do glossário, em componentes já existentes. Sem novo fluxo de dados, sem auth, sem input de usuário, sem chamada de rede. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-09 | Tampering (XSS) | tooltips renderizados nos KPICards dos 6 sites wireados | mitigate | As strings vêm de `KPI_GLOSSARY` (literais estáticos no código) e são renderizadas como texto puro pelo shadcn Tooltip do KPICard (prop `tooltip?: string`). Nenhum `dangerouslySetInnerHTML` introduzido; garantia herdada do KPICard. |
| T-46-10 | (S/R/I/D/E) | — | accept | Mudança puramente de apresentação client-side (troca de className + prop de string). Sem superfície nova de rede/auth/input. Risco residual desprezível — não há ameaça real a modelar neste plano. |
</threat_model>

<verification>
- `npx tsc --noEmit` limpo após os 9 arquivos.
- `npm run build` conclui sem erro.
- Grep confirma: `text-kpi-positive` nos 3 arquivos de /precificacao; ausência de `text-red-600` em HistoricoComparacaoPanel; `text-emerald-700` (badge GMV) preservado em AnalisePrecosTable; `KPI_GLOSSARY` + `tooltip={tip(` nos 6 sites de KPICard wireados.
- A varredura `grep -rl "KPICard" src --include='*.tsx'` não revela nenhum consumidor de KPICard de métrica sem cobertura (próprio ou herdado de 46-02/03), e as exclusões (Integrations, MLMetas) estão documentadas no SUMMARY.
- `npm run lint` sem novos erros nos arquivos tocados.
- Nenhum arquivo de 46-02 (MLKPIGrid, MLSalesAnalytics, TopSellingProducts, PublicidadeRelatorios, MLEstoque) ou 46-03 (MLAnuncios, MLPedidos, MLFinanceiro) foi modificado.
</verification>

<success_criteria>
- /precificacao (6ª página de D-08) passa na auditoria de tokens: indicadores binários positivo/negativo usam tokens kpi; aviso (amber), categoria (badge GMV) e status preservados (UX-04).
- Cobertura UX-01 fechada: todo KPICard de métrica em src/ tem glossário (próprio ou via 46-02/03); contadores de status registrados como exclusão justificada (UX-01/D-01).
- Auditoria de tokens restrita às 6 páginas de D-08; Recharts/status/categoria intactos (D-09).
- tsc + build limpos; nenhum arquivo de 46-02/46-03 tocado.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 05)

**Sem novos arquivos.** Consome `KPI_GLOSSARY` (helper `tip(key)`) do plano 01.

**Token swaps aplicados (/precificacao, UX-04):**
- `SimuladorPrecificacao.tsx` — ramo `good` do tier + indicador de break-even via `text-kpi-positive`/`text-kpi-negative`.
- `HistoricoComparacaoPanel.tsx` — delta de comparação via tokens kpi.
- `CompraRecomendadaPanel.tsx` — indicador de compra recomendada via `text-kpi-positive`.
- (Preservados, sem alteração: `text-amber-600` warn, badge GMV `text-emerald-700`, Recharts SVG.)

**Wiring de glossário (UX-01, sites descobertos pela varredura):**
- `MLPublicidade.tsx`, `MLRelatorios.tsx`, `MLReputacao.tsx`, `MLPerguntas.tsx`, `MLDevolucoes.tsx`, `TVModeVendas.tsx` → `KPI_GLOSSARY` via `tip(key)`.

**Evidência de cobertura (registrada no SUMMARY):**
- Lista completa de consumidores de KPICard classificada em coberto / wireado-aqui / exclusão-justificada (Integrations = contadores de status; MLMetas = sem KPICard).
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-05-SUMMARY.md` when done.
</output>
