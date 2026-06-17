---
phase: 46-ux-para-leigos
plan: 02
type: execute
wave: 2
depends_on: ["46-01"]
files_modified:
  - src/components/mercadolivre/MLKPIGrid.tsx
  - src/components/mercadolivre/MLSalesAnalytics.tsx
  - src/components/mercadolivre/TopSellingProducts.tsx
  - src/components/mercadolivre/PublicidadeRelatorios.tsx
  - src/pages/mercadolivre/MLEstoque.tsx
autonomous: true
requirements: [UX-01, UX-02, UX-04]
user_setup: []

must_haves:
  truths:
    - "Cada KPICard do MLKPIGrid recebe sua definição leiga do glossário central via prop tooltip (D-01)."
    - "Os empty states ad-hoc de MLSalesAnalytics, TopSellingProducts e PublicidadeRelatorios usam o componente <EmptyState> com instrução de ação específica por contexto (D-04/D-05)."
    - "O estado 'Mercado Livre não conectado' de /estoque usa <EmptyState> com CTA para /integracoes (D-05)."
    - "Os badges logísticos dark-mode de /estoque permanecem com suas cores de categoria (não são tokens kpi) (D-08)."
    - "Apenas as 6 páginas mais usadas recebem auditoria visual; as ~14 rotas restantes não são tocadas (D-09)."
  artifacts:
    - path: "src/components/mercadolivre/MLKPIGrid.tsx"
      provides: "Wiring do glossário em ~10 KPICards"
      contains: "KPI_GLOSSARY"
    - path: "src/components/mercadolivre/MLSalesAnalytics.tsx"
      provides: "Empty states migrados para <EmptyState>"
      contains: "EmptyState"
    - path: "src/pages/mercadolivre/MLEstoque.tsx"
      provides: "NotConnected migrado para <EmptyState> com CTA"
      contains: "EmptyState"
  key_links:
    - from: "src/components/mercadolivre/MLKPIGrid.tsx"
      to: "@/lib/kpi-glossary"
      via: "import KPI_GLOSSARY + lookup por chave em cada tooltip"
      pattern: "KPI_GLOSSARY"
    - from: "src/pages/mercadolivre/MLEstoque.tsx"
      to: "@/components/ui/empty-state"
      via: "import EmptyState com actionHref=/integracoes"
      pattern: "EmptyState"
---

<objective>
Ligar os dois primitivos do plano 01 aos consumidores que NÃO são as três páginas-tabela (essas ficam no plano 03, para garantir ownership exclusivo de arquivo e paralelismo na Wave 2):

1. UX-01: ligar o glossário central aos ~10 KPICards do `MLKPIGrid` (principal consumidor de KPIs do dashboard ML) via a prop `tooltip` (D-01).
2. UX-02: migrar os empty states ad-hoc de `MLSalesAnalytics` (3 abas), `TopSellingProducts`, `PublicidadeRelatorios` e o `NotConnected` de `MLEstoque` para o `<EmptyState>` compartilhado, cada um com instrução de ação específica por contexto (D-04/D-05), reaproveitando a linguagem do Consultor v1 quando couber.
3. UX-04 (parcial): conferência de dark-mode em `MLEstoque` — os badges logísticos `dark:text-*` são cores de categoria e devem permanecer (não são tokens kpi positivo/negativo).

Boundary (D-09): a auditoria visual UX-04 fica restrita às 6 páginas mais usadas (D-08); as ~14 rotas restantes ficam explicitamente fora desta fase (D-09) e não devem ser tocadas por este plano além de /estoque.

Purpose: Consolidar conteúdo leigo e empty states acionáveis nas superfícies de KPI/analytics que não têm tabela responsiva. Mantém os arquivos deste plano sem sobreposição com o plano 03 → ambos rodam em paralelo na Wave 2.
Output: 5 arquivos modificados (MLKPIGrid, MLSalesAnalytics, TopSellingProducts, PublicidadeRelatorios, MLEstoque).
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

# Consumidores a modificar (ler antes de editar)
@src/components/mercadolivre/MLKPIGrid.tsx
@src/components/mercadolivre/MLSalesAnalytics.tsx
@src/components/mercadolivre/TopSellingProducts.tsx
@src/components/mercadolivre/PublicidadeRelatorios.tsx
@src/pages/mercadolivre/MLEstoque.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Ligar o glossário aos KPICards do MLKPIGrid (UX-01, D-01)</name>
  <files>src/components/mercadolivre/MLKPIGrid.tsx</files>
  <read_first>
    - PATTERNS.md §"MLKPIGrid.tsx" — helper `const tip = (key) => e.example ? \`${e.definition} ${e.example}\` : e.definition` e o mapeamento KPICard→chave de glossário; o "Compradores" já tem tooltip string que deve passar a usar o glossário.
    - RESEARCH.md §"Pattern 2" — padrão de consumo (string direta vinda do glossário, não key-lookup dentro do KPICard).
    - src/components/mercadolivre/MLKPIGrid.tsx — os ~10/11 KPICards atuais e seus títulos.
    - src/lib/kpi-glossary.ts (criado no plano 01) — chaves disponíveis.
  </read_first>
  <action>
    Importar `KPI_GLOSSARY` de `@/lib/kpi-glossary` no topo do MLKPIGrid e definir o helper local `tip(key)` que concatena `definition` + `example` (quando existir), conforme PATTERNS.md. Para cada KPICard do grid, adicionar/atualizar a prop `tooltip={tip("<chave>")}` mapeando o título ao termo do glossário (Receita Total→receita_total, Pedidos→pedidos, Ticket Médio→ticket_medio, Visitas→visitas, Conversão→conversao, Compradores→compradores — substituir a string hardcoded atual, Unidades Vendidas→unidades_vendidas, Markup→markup, Custo Operacional→custo_operacional, Impostos→impostos). Usar a chave exata do union `GlossaryKey` — `tip()` deve ser tipado como `keyof typeof KPI_GLOSSARY` para o tsc pegar erros de digitação. Não alterar o grid wrapper nem a lógica de cálculo dos KPIs — apenas adicionar a prop `tooltip`.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "MLKPIGrid" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i MLKPIGrid)" && grep -q "KPI_GLOSSARY" src/components/mercadolivre/MLKPIGrid.tsx && test "$(grep -c 'tooltip={tip(' src/components/mercadolivre/MLKPIGrid.tsx)" -ge 8 && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - MLKPIGrid importa `KPI_GLOSSARY` e define o helper `tip(key)` tipado por `keyof typeof KPI_GLOSSARY`.
    - ≥8 KPICards recebem `tooltip={tip("...")}`; o "Compradores" deixa de usar a string hardcoded.
    - Nenhuma chave de glossário inexistente (tsc valida via keyof).
    - `npx tsc --noEmit` limpo para o arquivo.
  </acceptance_criteria>
  <done>Todos os KPICards do MLKPIGrid exibem definição leiga vinda do glossário central; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 2: Migrar empty states ad-hoc para o componente EmptyState (UX-02, D-04/D-05)</name>
  <files>src/components/mercadolivre/MLSalesAnalytics.tsx, src/components/mercadolivre/TopSellingProducts.tsx, src/components/mercadolivre/PublicidadeRelatorios.tsx</files>
  <read_first>
    - RESEARCH.md §"Pattern 3" tabela "Sites de migração mapeados" — ícone/título/descrição/CTA propostos por local (TopSellingProducts L95, MLSalesAnalytics L107/L261/L539, PublicidadeRelatorios L107).
    - PATTERNS.md §"MLSalesAnalytics.tsx" — o EmptyState LOCAL atual (prop `message`) é um componente DIFERENTE do novo; substituir completamente, não reusar. Nota crítica #5.
    - src/components/mercadolivre/MLSalesAnalytics.tsx, TopSellingProducts.tsx, PublicidadeRelatorios.tsx — os blocos ad-hoc atuais.
  </read_first>
  <action>
    Em cada um dos três componentes, importar `{ EmptyState }` de `@/components/ui/empty-state` e os ícones lucide necessários, e substituir os blocos de empty state ad-hoc pelo `<EmptyState>` com `icon`, `title` e `description` específicos por contexto conforme a tabela de RESEARCH §Pattern 3 (D-05: instrução do que fazer para ter dados aqui, não genérica). Detalhes por arquivo: (a) `TopSellingProducts` → icon=Package, title="Nenhum produto encontrado", description="Sincronize suas vendas para ver os produtos mais vendidos.", sem CTA (dados vêm de sync automático), size="compact". (b) `MLSalesAnalytics` → as 3 abas (Horário icon=Clock, Diário icon=TrendingUp, Conversão icon=Percent) com os títulos/descrições da tabela; ATENÇÃO: o `EmptyState` LOCAL com prop `message` neste arquivo é outro componente — remover/substituir suas chamadas pelo novo, não tentar reusar (PATTERNS nota #5). (c) `PublicidadeRelatorios` → icon=Megaphone, title="Sem dados de publicidade", description com instrução de ativar campanha, actionLabel="Ir para Publicidade", actionHref="/publicidade". Reaproveitar a linguagem de ação do Consultor v1 (Fase 45) onde a descrição puder reusá-la (D-05). Não alterar a lógica de quando o empty state aparece — só o markup.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -iE "MLSalesAnalytics|TopSellingProducts|PublicidadeRelatorios" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'MLSalesAnalytics|TopSellingProducts|PublicidadeRelatorios')" && grep -q "EmptyState" src/components/mercadolivre/MLSalesAnalytics.tsx && grep -q "EmptyState" src/components/mercadolivre/TopSellingProducts.tsx && grep -q "EmptyState" src/components/mercadolivre/PublicidadeRelatorios.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Os três componentes importam e usam `<EmptyState>` de `@/components/ui/empty-state`.
    - Cada empty state tem descrição de ação específica por contexto (não genérica) — D-05.
    - O `EmptyState` local antigo (prop `message`) em MLSalesAnalytics foi substituído, não reusado.
    - PublicidadeRelatorios tem CTA actionHref="/publicidade".
    - `npx tsc --noEmit` limpo para os três arquivos.
  </acceptance_criteria>
  <done>Os empty states ad-hoc desses três componentes usam o componente compartilhado com instrução acionável; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 3: Migrar NotConnected de /estoque para EmptyState + check dark-mode (UX-02/UX-04, D-05/D-08)</name>
  <files>src/pages/mercadolivre/MLEstoque.tsx</files>
  <read_first>
    - RESEARCH.md §"Code Examples" exemplo "EmptyState usage" (substituição do NotConnected inline L971) + §"Pattern 3" linha MLEstoque.
    - PATTERNS.md §"MLEstoque.tsx" — substituir NotConnected inline (≈L971) por EmptyState; NÃO converter tabela (fora do escopo UX-03); badges logísticos `dark:text-blue-400`/`dark:text-violet-400` (L43-48) são cores de categoria e devem PERMANECER (D-08/RESEARCH §Visual audit exceção).
    - src/pages/mercadolivre/MLEstoque.tsx — bloco NotConnected inline (≈L971) e badges logísticos (≈L43-48).
  </read_first>
  <action>
    Substituir o bloco inline "Mercado Livre não conectado" (≈L971, atualmente `<div>` + `<Plug>` + texto + botão Link) por `<EmptyState icon={Plug} title="Mercado Livre não conectado" description="Conecte sua conta para visualizar o estoque em tempo real." actionLabel="Ir para Integrações" actionHref="/integracoes" />` (D-05). Importar `{ EmptyState }` e `Plug` (lucide). NÃO converter nenhuma tabela para cards aqui — /estoque está fora do escopo UX-03 (que é só /anuncios, /pedidos, /financeiro). Para UX-04: verificar visualmente que os badges logísticos com `dark:text-blue-400`/`dark:text-violet-400`/etc. permanecem inalterados — são cores de categoria, não semântica positivo/negativo, e estão corretos (D-08, RESEARCH §Visual audit "Exceção encontrada"). Não substituí-los por tokens kpi.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "MLEstoque" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i MLEstoque)" && grep -q "EmptyState" src/pages/mercadolivre/MLEstoque.tsx && grep -q "actionHref=\"/integracoes\"" src/pages/mercadolivre/MLEstoque.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - O NotConnected de /estoque usa `<EmptyState>` com CTA para /integracoes (D-05).
    - Nenhuma tabela de /estoque foi convertida para cards (fora do escopo UX-03).
    - Os badges logísticos `dark:text-*` (cores de categoria) permanecem inalterados (D-08).
    - `npx tsc --noEmit` limpo para o arquivo.
  </acceptance_criteria>
  <done>/estoque usa EmptyState para o estado não-conectado; badges de categoria preservados; tsc limpo.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Apenas wiring de strings estáticas (glossário) e markup de empty states em componentes já existentes. Sem novo fluxo de dados, auth ou input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-03 | Tampering (XSS) | tooltip/description renderizados nos KPICards e EmptyStates | mitigate | Strings vêm do glossário estático e de literais no código; renderizadas como texto puro JSX. Nenhum `dangerouslySetInnerHTML` introduzido (herda a garantia do EmptyState/KPICard do plano 01). |
| T-46-04 | (S/R/I/D/E) | — | accept | Sem superfície nova de rede/auth/input; mudanças de apresentação client-side. Risco residual desprezível. |
</threat_model>

<verification>
- `npx tsc --noEmit` limpo após os 5 arquivos.
- `npm run build` conclui sem erro.
- Grep confirma KPI_GLOSSARY no MLKPIGrid e EmptyState nos 4 consumidores; actionHref=/integracoes em MLEstoque.
- Lint: `npm run lint` sem novos erros nos arquivos tocados.
</verification>

<success_criteria>
- Todos os KPICards do MLKPIGrid têm definição leiga do glossário (UX-01).
- Empty states de MLSalesAnalytics/TopSellingProducts/PublicidadeRelatorios/MLEstoque usam `<EmptyState>` com ação específica (UX-02).
- Badges de categoria de /estoque preservados; nenhuma cor de categoria virou token kpi; auditoria restrita às 6 páginas (D-08/D-09) (UX-04).
- tsc + build limpos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 02)

**Sem novos arquivos.** Consome os artefatos do plano 01.

**Wiring estabelecido:**
- `MLKPIGrid` → `KPI_GLOSSARY` (helper `tip(key)` tipado por `keyof typeof KPI_GLOSSARY`).
- `MLSalesAnalytics`, `TopSellingProducts`, `PublicidadeRelatorios`, `MLEstoque` → `EmptyState` com props específicas por contexto.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-02-SUMMARY.md` when done.
</output>
