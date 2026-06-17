---
phase: 46-ux-para-leigos
plan: 03
type: execute
wave: 2
depends_on: ["46-01"]
files_modified:
  - src/pages/mercadolivre/MLAnuncios.tsx
  - src/pages/mercadolivre/MLPedidos.tsx
  - src/pages/mercadolivre/MLFinanceiro.tsx
autonomous: true
requirements: [UX-01, UX-02, UX-03, UX-04]
user_setup: []

must_haves:
  truths:
    - "Em viewport <768px, a tabela principal de /anuncios, /pedidos e /financeiro renderiza como lista de cards empilhados (1 registro = 1 card) sem overflow horizontal quebrado (D-06)."
    - "Em viewport ≥768px, as três páginas mantêm o layout de tabela atual inalterado (D-07)."
    - "Os KPICards dessas três páginas exibem definição leiga vinda do glossário central (D-01)."
    - "Os empty states dessas páginas (NotConnected, EmptyReport, filtro vazio) usam <EmptyState> com ação específica (D-04/D-05)."
    - "As cores semânticas hardcoded (text-emerald-600/text-red-600) das três páginas usam os tokens text-kpi-positive/text-kpi-negative; cores de Recharts SVG (fill=/stroke=) e cores de status permanecem (D-08)."
  artifacts:
    - path: "src/pages/mercadolivre/MLAnuncios.tsx"
      provides: "Tabela→cards mobile + glossário + EmptyState + tokens"
      contains: "useIsMobile"
    - path: "src/pages/mercadolivre/MLPedidos.tsx"
      provides: "Tabela→cards mobile + EmptyState + tokens kpi"
      contains: "useIsMobile"
    - path: "src/pages/mercadolivre/MLFinanceiro.tsx"
      provides: "Tabela→cards mobile + tokens kpi + spacing fix"
      contains: "useIsMobile"
  key_links:
    - from: "src/pages/mercadolivre/MLPedidos.tsx"
      to: "@/hooks/use-mobile"
      via: "useIsMobile() controla render tabela↔cards"
      pattern: "useIsMobile"
    - from: "src/pages/mercadolivre/MLFinanceiro.tsx"
      to: "text-kpi-positive"
      via: "substituição de text-emerald-600/text-red-600"
      pattern: "text-kpi-(positive|negative)"
---

<objective>
Tratar as três páginas-tabela como uma unidade de ownership exclusivo (sem sobreposição com o plano 02 → roda em paralelo na Wave 2), aplicando os quatro entregáveis da fase nelas:

1. UX-03 (D-06/D-07): abaixo de 768px, a tabela principal de cada página vira lista de cards empilhados via `useIsMobile()`; acima de 768px o layout de tabela atual permanece intacto.
2. UX-01 (D-01): ligar o glossário aos KPICards dessas páginas (MLFinanceiro tem 9, MLPedidos 5, MLAnuncios 16).
3. UX-02 (D-04/D-05): migrar os empty states locais (NotConnected, EmptyReport, filtro vazio) para `<EmptyState>`.
4. UX-04 (D-08): substituir as cores semânticas hardcoded por tokens kpi e corrigir o spacing do grid de KPIs do MLFinanceiro; preservar cores de Recharts SVG e de status.

Purpose: Concentrar todo o trabalho dos três arquivos de maior risco de conflito num único plano garante ownership exclusivo e permite paralelizar com o plano 02. Cada página recebe os 4 cuidados de UX de uma vez, com menos passes de leitura.
Output: 3 arquivos modificados (MLAnuncios, MLPedidos, MLFinanceiro).
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

# Páginas a modificar (ler antes de editar)
@src/pages/mercadolivre/MLAnuncios.tsx
@src/pages/mercadolivre/MLPedidos.tsx
@src/pages/mercadolivre/MLFinanceiro.tsx
@src/hooks/use-mobile.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: MLPedidos + MLFinanceiro — tabela→cards mobile, glossário, EmptyState, tokens kpi (UX-03/01/02/04)</name>
  <files>src/pages/mercadolivre/MLPedidos.tsx, src/pages/mercadolivre/MLFinanceiro.tsx</files>
  <read_first>
    - RESEARCH.md §"Pattern 4: Tabela → Cards mobile" + §"Code Examples" (card mobile MLPedidos) — padrão `const isMobile = useIsMobile()` + render condicional; tabelas alvo e colunas prioritárias por página.
    - PATTERNS.md §"MLPedidos.tsx" e §"MLFinanceiro.tsx" — estrutura de row atual, padrão de card mobile, e a lista exata de cores a substituir (MLPedidos: marginColor() L113-116, L282, L538, L1371; MLFinanceiro: L808/816/818/951/959/961/1023/1031). NÃO tocar fill=/stroke= Recharts (MLFinanceiro L579-584).
    - RESEARCH.md §"Visual Consistency Audit Findings" — regra clara token vs Recharts vs status; spacing fix MLFinanceiro grid KPIs (adicionar md:grid-cols-*).
    - src/hooks/use-mobile.tsx — `useIsMobile()`, breakpoint 768px.
  </read_first>
  <action>
    Para CADA arquivo (MLPedidos e MLFinanceiro): (a) UX-03 — importar `useIsMobile` de `@/hooks/use-mobile`, e na tabela PRINCIPAL envolver o render com `isMobile ? <lista de cards> : <tabela existente>`, conforme o padrão de PATTERNS (container `space-y-2 p-2`, card `rounded-lg border border-border bg-card p-3`, grid de pares label:valor `grid grid-cols-2 gap-x-4 gap-y-1 text-xs`, valores `font-mono tabular-nums`). Escolher 4-6 colunas prioritárias por card (MLPedidos: Data, Bruto, Comissão, Frete, Líquido, Margem + status; MLFinanceiro tabela por produto: Receita, Comissão, Frete, Lucro R$, Lucro %). A tabela ≥768px NÃO muda (D-07). As sub-tabelas de relatório de MLPedidos (Top Produtos, UF) podem permanecer com `overflow-x-auto` — prioridade é a tabela principal (RESEARCH §Open Questions 3). (b) UX-01 — ligar o glossário aos KPICards (helper `tip(key)` como no plano 02; MLFinanceiro 9 KPIs, MLPedidos 5). (c) UX-02 — migrar `NotConnected()` (MLPedidos L155) e `EmptyReport()` (MLPedidos ~L612) e os estados não-conectado de MLFinanceiro para `<EmptyState>` com ação específica (Plug→/integracoes; EmptyReport icon=ClipboardList sem CTA). (d) UX-04 — substituir as cores hardcoded listadas em PATTERNS por `text-kpi-positive`/`text-kpi-negative`; em `marginColor()` manter `text-amber-600`/`text-orange-500` (warning/borderline, não são positivo/negativo); NÃO alterar fill=/stroke= Recharts (MLFinanceiro L579-584); adicionar `md:grid-cols-4` (ou md:grid-cols-6) ao grid de KPIs do MLFinanceiro que hoje é `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8`.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -iE "MLPedidos|MLFinanceiro" ; test -z "$(npx tsc --noEmit 2>&1 | grep -iE 'MLPedidos|MLFinanceiro')" && grep -q "useIsMobile" src/pages/mercadolivre/MLPedidos.tsx && grep -q "useIsMobile" src/pages/mercadolivre/MLFinanceiro.tsx && grep -q "EmptyState" src/pages/mercadolivre/MLPedidos.tsx && grep -q "text-kpi-positive" src/pages/mercadolivre/MLFinanceiro.tsx && test "$(grep -c 'text-red-600' src/pages/mercadolivre/MLFinanceiro.tsx)" -eq 0 && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Em <768px a tabela principal de /pedidos e /financeiro vira cards empilhados; em ≥768px a tabela permanece inalterada.
    - KPICards de ambas as páginas usam o glossário central via prop tooltip.
    - NotConnected/EmptyReport/não-conectado migrados para `<EmptyState>` com ação específica.
    - `text-emerald-600`/`text-red-600` semânticos viraram `text-kpi-positive`/`text-kpi-negative`; amber/orange de warning preservados; Recharts SVG intocado; grid de KPIs do MLFinanceiro ganhou breakpoint md.
    - `npx tsc --noEmit` limpo para ambos.
  </acceptance_criteria>
  <done>/pedidos e /financeiro: tabelas responsivas em mobile, KPIs com glossário, empty states padronizados e tokens kpi aplicados; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 2: MLAnuncios — tabela→cards mobile, glossário, EmptyState, tokens kpi (UX-03/01/02/04)</name>
  <files>src/pages/mercadolivre/MLAnuncios.tsx</files>
  <read_first>
    - PATTERNS.md §"MLAnuncios.tsx" — empty state atual (L1240-1244) → EmptyState; tabela shadcn `<Table>` em `<div className="max-h-[600px] overflow-auto">` (L1246-1316); padrão de card mobile; cores L392 (text-emerald-700→positive), L517 (text-emerald-600→positive; text-destructive já é token, manter).
    - RESEARCH.md §"Pattern 4" nota de escopo MLAnuncios — exibir só 4-5 colunas prioritárias no card mobile (Anúncio, Preço, Estoque, Margem), não todas as ~10.
    - RESEARCH.md §Open Questions 2 — agente decide as 5 colunas prioritárias; Wesley confirma no checkpoint (plano 04).
    - src/pages/mercadolivre/MLAnuncios.tsx — os 16 KPICards, a tabela, e o empty state filtrado.
  </read_first>
  <action>
    (a) UX-03 — importar `useIsMobile` e envolver a tabela de anúncios (shadcn `<Table>`, ~L1246) com `isMobile ? <cards> : <tabela existente>`. No card mobile exibir SOMENTE 4-5 colunas prioritárias (Anúncio/título, Preço, Estoque, e quando `columnView === "financeiro"` Margem Líquida/Operacional) — não replicar as ~10 colunas (RESEARCH §Pattern 4 nota). A tabela ≥768px não muda (D-07). (b) UX-01 — ligar o glossário aos 16 KPICards via `tip(key)` (margens, receita, custo etc. já têm chaves no glossário: margem_bruta, margem_liquida, margem_operacional, margem_pos_ads, etc.). (c) UX-02 — substituir o empty state inline de filtro vazio (L1240-1244) por `<EmptyState icon={ShoppingBag} size="compact" ...>` com título/descrição condicionais ao filtro ativo, conforme PATTERNS. (d) UX-04 — L392 `text-emerald-700`→`text-kpi-positive`; L517 `text-emerald-600`→`text-kpi-positive` (manter `text-destructive`, já é token). Não tocar cores de status/categoria.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "MLAnuncios" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i MLAnuncios)" && grep -q "useIsMobile" src/pages/mercadolivre/MLAnuncios.tsx && grep -q "EmptyState" src/pages/mercadolivre/MLAnuncios.tsx && grep -q "KPI_GLOSSARY" src/pages/mercadolivre/MLAnuncios.tsx && grep -q "text-kpi-positive" src/pages/mercadolivre/MLAnuncios.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Em <768px a tabela de anúncios vira cards com 4-5 colunas prioritárias; em ≥768px a tabela shadcn permanece.
    - Os 16 KPICards usam o glossário central via prop tooltip.
    - O empty state de filtro vazio usa `<EmptyState>` (size="compact") com texto condicional ao filtro.
    - `text-emerald-600/700` semânticos viraram `text-kpi-positive`; `text-destructive` mantido.
    - `npx tsc --noEmit` limpo para o arquivo.
  </acceptance_criteria>
  <done>/anuncios: tabela responsiva em mobile (colunas prioritárias), KPIs com glossário, empty state padronizado e tokens kpi; tsc limpo.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Render condicional tabela↔cards e troca de classes Tailwind sobre dados já carregados nas páginas. Sem novo fluxo de dados, auth ou input de usuário. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-05 | Tampering (XSS) | Render de campos de pedido/produto (título, SKU) nos cards mobile | mitigate | Valores renderizados como texto puro JSX (`{order.titulo}`), exatamente como na tabela atual; nenhum `dangerouslySetInnerHTML` introduzido. Mesma fonte de dados já confiada pela tabela existente. |
| T-46-06 | (S/R/I/D/E) | — | accept | Sem superfície nova de rede/auth/input; mudanças de apresentação e classes CSS client-side. Risco residual desprezível (RESEARCH §Security Domain). |
</threat_model>

<verification>
- `npx tsc --noEmit` limpo após os 3 arquivos.
- `npm run build` conclui sem erro.
- Grep confirma: `useIsMobile` nas três páginas; `EmptyState` onde havia empty state ad-hoc; `KPI_GLOSSARY`/tooltip nos KPIs; ausência de `text-red-600` em MLFinanceiro; `text-kpi-positive` presente.
- `npm run lint` sem novos erros nos arquivos tocados.
</verification>

<success_criteria>
- /anuncios, /pedidos, /financeiro renderizam cards empilhados sem overflow quebrado em viewport 320–768px e mantêm a tabela ≥768px (UX-03).
- KPICards dessas páginas exibem glossário leiga (UX-01).
- Empty states dessas páginas padronizados com `<EmptyState>` acionável (UX-02).
- Cores semânticas via tokens kpi; Recharts/status preservados; spacing do grid corrigido (UX-04).
- tsc + build limpos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 03)

**Sem novos arquivos.** Consome `KPI_GLOSSARY` e `EmptyState` do plano 01.

**Padrões aplicados:**
- Render condicional `useIsMobile()` tabela↔cards nas 3 páginas (breakpoint 768px).
- Substituição de cores hardcoded por tokens `text-kpi-positive`/`text-kpi-negative` (exceto Recharts/status).
- Helper `tip(key)` ligando KPICards ao glossário central.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-03-SUMMARY.md` when done.
</output>
