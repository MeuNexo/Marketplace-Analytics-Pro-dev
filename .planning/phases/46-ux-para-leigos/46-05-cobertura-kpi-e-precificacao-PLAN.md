---
phase: 46-ux-para-leigos
plan: 05
type: execute
wave: 2
depends_on: ["46-01"]
files_modified:
  - src/pages/mercadolivre/MLPublicidade.tsx
  - src/pages/mercadolivre/MLRelatorios.tsx
  - src/pages/mercadolivre/MLReputacao.tsx
  - src/pages/mercadolivre/MLDevolucoes.tsx
  - src/pages/mercadolivre/MLPerguntas.tsx
  - src/pages/mercadolivre/MLMetas.tsx
  - src/pages/TVModeVendas.tsx
  - src/pages/Integrations.tsx
  - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
  - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
  - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
  - src/components/mercadolivre/analise/AnalisePrecosTable.tsx
autonomous: true
requirements: [UX-01, UX-04]
user_setup: []

must_haves:
  truths:
    - "TODO site reachable que renderiza <KPICard> recebe tooltip do glossário quando existe termo correspondente; sites sem termo aplicável são documentados explicitamente (UX-01, D-01)."
    - "A página /precificacao (SimuladorPrecificacao + AnaliseDashboard e filhos) teve sua auditoria visual UX-04 feita: cores semânticas hardcoded migradas para tokens kpi, dark mode verificado (D-08)."
  artifacts:
    - path: "src/pages/mercadolivre/MLPublicidade.tsx"
      provides: "KPICards de /publicidade com tooltip do glossário (roas/acos/tacos/publicidade)"
      contains: "KPI_GLOSSARY"
    - path: "src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx"
      provides: "Tokens kpi aplicados nas cores semânticas de /precificacao"
      contains: "text-kpi-positive"
  key_links:
    - from: "src/pages/mercadolivre/MLPublicidade.tsx"
      to: "@/lib/kpi-glossary"
      via: "import KPI_GLOSSARY + tooltip nos KPICards de ads"
      pattern: "KPI_GLOSSARY"
    - from: "src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx"
      to: "text-kpi-positive"
      via: "substituição de text-emerald-600/text-red-600 semânticos"
      pattern: "text-kpi-(positive|negative)"
---

<objective>
Fechar duas lacunas de cobertura que os planos 02/03 não alcançam, mantendo ownership de arquivo disjunto (este plano roda em paralelo com 02 e 03 na Wave 2):

1. UX-01 (cobertura total, D-01): a pesquisa estimou "~16 sites de KPI", mas o codebase tem MAIS consumidores de `<KPICard>` reachable além do MLKPIGrid e das 3 páginas-tabela: /publicidade (MLPublicidade), /relatorios (MLRelatorios), /reputacao (MLReputacao), /devolucoes (MLDevolucoes), /perguntas (MLPerguntas), /metas (MLMetas), /tv (TVModeVendas) e /integracoes (Integrations). UX-01 diz "TODO KPI tem tooltip/glossário" — não é escopo-limitado às 6 páginas (essa limitação é só da auditoria visual UX-04, D-08). Este plano faz a varredura: cada `<KPICard>` reachable recebe `tooltip` do glossário quando há termo correspondente; onde não houver termo aplicável (ex.: "perguntas sem resposta", "nível de reputação"), documentar explicitamente para dar evidência de cobertura ao verifier.

2. UX-04 (página /precificacao, D-08): /precificacao é a 6ª página obrigatória da auditoria visual de D-08, mas é um wrapper fino (`MLPrecificacao.tsx`) que delega para `SimuladorPrecificacao` e `AnaliseDashboard` (+ filhos em `precificacao/` e `analise/`). Os filhos contêm cores semânticas hardcoded (`text-emerald-600`/`text-red-600`) que precisam virar tokens kpi. Este plano cobre essa auditoria.

Purpose: Sem este plano, UX-01 fica com cobertura parcial (sem evidência dos sites fora do radar) e D-08 fica com /precificacao ausente — o blocker apontado pelo plan-checker. O ownership é disjunto dos planos 02 e 03, então roda em paralelo na Wave 2.
Output: 12 arquivos modificados (8 consumidores de KPICard fora do radar + 4 arquivos de /precificacao).
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/46-ux-para-leigos/46-CONTEXT.md
@.planning/phases/46-ux-para-leigos/46-RESEARCH.md
@.planning/phases/46-ux-para-leigos/46-PATTERNS.md
@.planning/phases/46-ux-para-leigos/46-01-SUMMARY.md

# Consumidores de KPICard fora do radar (ler antes de editar)
@src/pages/mercadolivre/MLPublicidade.tsx
@src/pages/mercadolivre/MLRelatorios.tsx
@src/pages/mercadolivre/MLReputacao.tsx
@src/pages/mercadolivre/MLMetas.tsx
@src/pages/TVModeVendas.tsx

# /precificacao (wrapper + filhos com cores semânticas)
@src/pages/mercadolivre/MLPrecificacao.tsx
@src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx
@src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx
@src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx
@src/components/mercadolivre/analise/AnalisePrecosTable.tsx

# Glossário e tokens
@src/lib/kpi-glossary.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Varredura de cobertura UX-01 — tooltip do glossário em TODO site reachable de KPICard (D-01)</name>
  <files>src/pages/mercadolivre/MLPublicidade.tsx, src/pages/mercadolivre/MLRelatorios.tsx, src/pages/mercadolivre/MLReputacao.tsx, src/pages/mercadolivre/MLDevolucoes.tsx, src/pages/mercadolivre/MLPerguntas.tsx, src/pages/mercadolivre/MLMetas.tsx, src/pages/TVModeVendas.tsx, src/pages/Integrations.tsx</files>
  <read_first>
    - PATTERNS.md §"MLKPIGrid.tsx" — o padrão de consumo `tip(key)` (definition + example) é o mesmo a aplicar aqui.
    - src/lib/kpi-glossary.ts — as ~26 chaves disponíveis (roas, acos, tacos, publicidade, receita_total, pedidos, ticket_medio, conversao, visitas, compradores, unidades_vendidas, margem_*, cobertura, ruptura, etc.).
    - Cada arquivo da lista de <files> — identificar o título de cada `<KPICard>` e mapear ao termo do glossário; observar que /relatorios já tem 7 tooltips (strings) e /reputacao 1 — converter os existentes para o glossário e cobrir os faltantes.
  </read_first>
  <action>
    Para CADA arquivo, importar `KPI_GLOSSARY` de `@/lib/kpi-glossary` e definir o helper `tip(key: keyof typeof KPI_GLOSSARY)` (concatena definition + example), e adicionar/atualizar a prop `tooltip={tip("<chave>")}` em cada `<KPICard>` cujo conceito tem termo no glossário. Mapeamentos esperados: MLPublicidade → publicidade, roas, acos, tacos (e receita/vendas atribuídas quando aplicável); MLRelatorios → converter as 7 strings existentes para o glossário + cobrir os 4 faltantes (receita, pedidos, ticket_medio, margens conforme os títulos); MLReputacao → onde houver KPI mapeável (ex.: nenhuma chave de reputação existe hoje no glossário → ver regra abaixo); MLMetas, TVModeVendas, MLDevolucoes, MLPerguntas, Integrations → idem. REGRA PARA KPIs SEM TERMO: alguns KPIs não têm equivalente no glossário (ex.: "perguntas sem resposta", "reclamações abertas", "nível de reputação", status de integração). NÃO inventar termos novos fora do escopo do glossário definido no plano 01 nem alterar `GlossaryKey` aqui. Para esses, deixar o `<KPICard>` SEM tooltip e registrar no SUMMARY a lista exata "KPIs sem termo de glossário (sem tooltip por design): <arquivo:título>" — isso dá ao verifier evidência de que a ausência é intencional, não um esquecimento. Não alterar lógica de cálculo dos KPIs; apenas a prop tooltip.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -iE "MLPublicidade|MLRelatorios|MLReputacao|MLDevolucoes|MLPerguntas|MLMetas|TVModeVendas|Integrations" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'MLPublicidade|MLRelatorios|MLReputacao|MLDevolucoes|MLPerguntas|MLMetas|TVModeVendas|Integrations')" && for f in src/pages/mercadolivre/MLPublicidade.tsx src/pages/mercadolivre/MLRelatorios.tsx; do grep -q "KPI_GLOSSARY" "$f" || { echo "FALTA glossário em $f"; exit 1; }; done && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Cada `<KPICard>` reachable com conceito mapeável recebe `tooltip={tip("...")}` do glossário (D-01).
    - MLPublicidade cobre pelo menos roas/acos/tacos/publicidade; MLRelatorios converte as 7 strings existentes para o glossário e cobre os faltantes mapeáveis.
    - KPIs sem termo de glossário ficam sem tooltip POR DESIGN e estão listados explicitamente no SUMMARY (evidência de cobertura intencional).
    - Nenhum termo novo inventado fora do `GlossaryKey` do plano 01.
    - `npx tsc --noEmit` limpo para os 8 arquivos.
  </acceptance_criteria>
  <done>Cobertura UX-01 total: todo KPICard reachable mapeável tem glossário; exceções intencionais documentadas; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 2: Auditoria visual UX-04 da página /precificacao (D-08) — 6ª página obrigatória</name>
  <files>src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx, src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx, src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx, src/components/mercadolivre/analise/AnalisePrecosTable.tsx</files>
  <read_first>
    - RESEARCH.md §"Visual Consistency Audit Findings" e §"Shared Patterns / KPI token substitution" — a regra: `text-emerald-600`→`text-kpi-positive`, `text-red-600`→`text-kpi-negative` SOMENTE em contexto semântico positivo/negativo; preservar amber/orange (warning), `text-destructive` (já é token), cores de Recharts SVG, e cores de status/categoria (bg+ring highlights).
    - src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx (L289 tierColor: emerald/amber/destructive; L709 emerald vs destructive).
    - src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx (L23: emerald/red por delta — semântico positivo/negativo).
    - src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx (L185: emerald semântico).
    - src/components/mercadolivre/analise/AnalisePrecosTable.tsx (L31: `bg-emerald-500/10 ring-... text-emerald-700` — highlight de categoria "gmv", NÃO semântico positivo/negativo).
  </read_first>
  <action>
    Auditar a página /precificacao via seus filhos (o wrapper MLPrecificacao.tsx não tem cor hardcoded, não editar). Substituições: (a) `HistoricoComparacaoPanel.tsx` L23 — `d > 0 ? "text-emerald-600" : "text-red-600"` é semântico positivo/negativo → `text-kpi-positive`/`text-kpi-negative`. (b) `CompraRecomendadaPanel.tsx` L185 — `text-emerald-600` semântico → `text-kpi-positive`. (c) `SimuladorPrecificacao.tsx` L289 — em `tierColor`, `text-emerald-600`→`text-kpi-positive`; MANTER `text-amber-600` (warning) e `text-destructive` (já token). (d) `SimuladorPrecificacao.tsx` L709 — `text-emerald-600`→`text-kpi-positive`; MANTER `text-destructive`. (e) `AnalisePrecosTable.tsx` L31 — AVALIAR: `bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-700` é um highlight de CATEGORIA (coluna "gmv"), análogo a cores de status — pela regra de D-08/RESEARCH esses NÃO devem virar token. MANTER como está e registrar no SUMMARY "AnalisePrecosTable L31: highlight de categoria preservado (não semântico positivo/negativo)". Após as edições, verificar em dark mode que os valores positivos/negativos ficam legíveis. Se ao auditar não restar nenhuma cor semântica não-migrada, registrar no SUMMARY "/precificacao auditado — cores semânticas migradas; categoria/destructive/amber preservados".
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -iE "SimuladorPrecificacao|HistoricoComparacaoPanel|CompraRecomendadaPanel|AnalisePrecosTable" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'SimuladorPrecificacao|HistoricoComparacaoPanel|CompraRecomendadaPanel|AnalisePrecosTable')" && grep -q "text-kpi-positive" src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx && grep -q "text-kpi-negative" src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Todas as cores semânticas positivo/negativo de /precificacao (Simulador L289/L709, HistoricoComparacao L23, CompraRecomendada L185) usam tokens kpi.
    - `text-amber-600` (warning), `text-destructive` (token) e o highlight de categoria de AnalisePrecosTable L31 PRESERVADOS, com a decisão registrada no SUMMARY.
    - Dark mode de /precificacao verificado sem elementos quebrados.
    - `npx tsc --noEmit` limpo para os 4 arquivos.
  </acceptance_criteria>
  <done>/precificacao auditada (6ª página de D-08): cores semânticas em tokens kpi, exceções de categoria/warning preservadas e documentadas; tsc limpo.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Wiring de strings estáticas (glossário) + troca de classes Tailwind sobre dados já carregados nas páginas. Sem novo fluxo de dados, auth ou input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-09 | Tampering (XSS) | tooltip do glossário renderizado nos KPICards fora do radar | mitigate | Strings vêm do glossário estático; renderizadas como texto puro JSX (garantia herdada do KPICard do plano 01). Nenhum `dangerouslySetInnerHTML`. |
| T-46-10 | (S/R/I/D/E) | — | accept | Sem superfície nova de rede/auth/input; mudanças de apresentação e classes CSS client-side. Risco residual desprezível. |
</threat_model>

<verification>
- `npx tsc --noEmit` limpo após os 12 arquivos.
- `npm run build` conclui sem erro.
- Enumeração de cobertura: `grep -rl "KPICard" src --include='*.tsx'` lista todos os consumidores; cada um reachable mapeável tem glossário ou exceção documentada no SUMMARY.
- Grep confirma `text-kpi-positive`/`text-kpi-negative` em /precificacao; `KPI_GLOSSARY` nos sites de ads/relatórios.
- `npm run lint` sem novos erros nos arquivos tocados.
</verification>

<success_criteria>
- Cobertura UX-01 total e auditável: todo KPICard reachable mapeável tem glossário; exceções intencionais documentadas (D-01).
- /precificacao (6ª página D-08) auditada: cores semânticas em tokens kpi, dark mode ok (D-08).
- tsc + build limpos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 05)

**Sem novos arquivos.** Consome `KPI_GLOSSARY` do plano 01.

**Cobertura estabelecida:**
- Glossário ligado a TODO KPICard reachable mapeável (8 sites adicionais); exceções listadas no SUMMARY.
- /precificacao migrada para tokens kpi (4 arquivos de filhos), fechando a 6ª página de D-08.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-05-SUMMARY.md` when done.
</output>
