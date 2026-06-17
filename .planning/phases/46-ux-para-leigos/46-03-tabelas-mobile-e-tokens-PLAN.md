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
    - "Em viewport <768px, a tabela PRINCIPAL de /anuncios, /pedidos e /financeiro renderiza como lista de cards empilhados (1 registro = 1 card) sem overflow horizontal quebrado (D-06)."
    - "Em viewport ≥768px, as três páginas mantêm o layout de tabela atual inalterado (D-07)."
    - "TODAS as tabelas candidatas de MLPedidos (principal + Top Produtos + UF) e MLFinanceiro (produto + marca + SKU) foram avaliadas para mobile: a principal convertida; sub-tabelas mantidas como scroll-x têm justificativa registrada."
    - "Os KPICards dessas três páginas exibem definição leiga vinda do glossário central (D-01)."
    - "Os empty states dessas páginas (NotConnected, EmptyReport, filtro vazio) usam <EmptyState> com ação específica (D-04/D-05)."
    - "TODAS as cores semânticas hardcoded das três páginas (MLPedidos L113-116/282/538/1371; MLFinanceiro L808/816/818/951/959/961/1023/1031; MLAnuncios L392/517) usam tokens text-kpi-positive/text-kpi-negative; Recharts SVG (fill=/stroke=) e cores de status permanecem (D-08)."
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
Tratar as três páginas-tabela como uma unidade de ownership exclusivo (sem sobreposição com os planos 02 e 05 → roda em paralelo na Wave 2), aplicando os quatro entregáveis da fase nelas:

1. UX-03 (D-06/D-07): abaixo de 768px, a tabela PRINCIPAL de cada página vira lista de cards empilhados via `useIsMobile()`; acima de 768px o layout de tabela atual permanece intacto. TODAS as tabelas candidatas (MLPedidos: principal + Top Produtos + UF; MLFinanceiro: produto + marca + SKU) são avaliadas — a principal é convertida e qualquer sub-tabela mantida como scroll-x recebe justificativa explícita.
2. UX-01 (D-01): ligar o glossário aos KPICards dessas páginas (MLFinanceiro tem 9, MLPedidos 5, MLAnuncios 16).
3. UX-02 (D-04/D-05): migrar os empty states locais (NotConnected, EmptyReport, filtro vazio) para `<EmptyState>`.
4. UX-04 (D-08): substituir TODAS as cores semânticas hardcoded por tokens kpi e corrigir o spacing do grid de KPIs do MLFinanceiro; preservar cores de Recharts SVG e de status.

Nota de escopo: a 6ª página da auditoria visual de D-08 (/precificacao) e os demais sites de KPICard fora do radar são cobertos pelo plano 05 (Wave 2, ownership disjunto). Este plano cobre exatamente /anuncios, /pedidos, /financeiro.

Purpose: Concentrar todo o trabalho dos três arquivos de maior risco de conflito garante ownership exclusivo e permite paralelizar com os planos 02 e 05. Cada página recebe os 4 cuidados de UX, com Task 1a/1b separando MLPedidos e MLFinanceiro para reduzir densidade (cada um tem 3 tabelas candidatas).
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
  <name>Task 1a: MLPedidos — tabela→cards mobile (todas as 3 tabelas avaliadas), glossário, EmptyState, tokens kpi (UX-03/01/02/04)</name>
  <files>src/pages/mercadolivre/MLPedidos.tsx</files>
  <read_first>
    - RESEARCH.md §"Pattern 4" tabela de escopo — MLPedidos tem 3 tabelas: lista principal (~L1294), SubTabTopProdutos (~L241), SubTabUF (~L406).
    - RESEARCH.md §"Code Examples" (card mobile MLPedidos) — padrão `const isMobile = useIsMobile()` + render condicional.
    - PATTERNS.md §"MLPedidos.tsx" — estrutura de row, padrão de card mobile, cores a substituir (marginColor() L113-116, L282, L538, L1371) e empty states (NotConnected L155, EmptyReport ~L612).
    - src/hooks/use-mobile.tsx — `useIsMobile()`, breakpoint 768px.
  </read_first>
  <action>
    (a) UX-03 — importar `useIsMobile` de `@/hooks/use-mobile`. AVALIAR as 3 tabelas de MLPedidos: converter a tabela PRINCIPAL de pedidos (~L1294) para cards mobile (`isMobile ? <cards> : <tabela existente>`, padrão de PATTERNS: container `space-y-2 p-2`, card `rounded-lg border border-border bg-card p-3`, grid de pares label:valor; colunas Data, Bruto, Comissão, Frete, Líquido, Margem + status). Para as sub-tabelas de relatório SubTabTopProdutos (~L241) e SubTabUF (~L406): se mantidas com `overflow-x-auto` (são relatórios secundários, menor uso — RESEARCH §Open Questions 3), registrar a justificativa explícita no SUMMARY ("SubTabTopProdutos/SubTabUF: mantidas scroll-x — relatórios secundários, baixa frequência mobile"); se forem simples o suficiente, convertê-las também. A tabela ≥768px não muda (D-07). (b) UX-01 — ligar o glossário aos 5 KPICards via helper `tip(key)` (igual ao plano 02). (c) UX-02 — migrar `NotConnected()` (L155, Plug→/integracoes) e `EmptyReport()` (~L612, icon=ClipboardList sem CTA) para `<EmptyState>`. (d) UX-04 — substituir TODAS as 4 ocorrências: `marginColor()` L113-116 (emerald→kpi-positive, red→kpi-negative; MANTER amber/orange de warning), L282, L538, L1371 (red→kpi-negative). Verificar `grep -c 'text-red-600'` = 0 ao final.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "MLPedidos" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i MLPedidos)" && grep -q "useIsMobile" src/pages/mercadolivre/MLPedidos.tsx && grep -q "EmptyState" src/pages/mercadolivre/MLPedidos.tsx && grep -q "KPI_GLOSSARY" src/pages/mercadolivre/MLPedidos.tsx && grep -q "text-kpi-positive" src/pages/mercadolivre/MLPedidos.tsx && test "$(grep -c 'text-red-600' src/pages/mercadolivre/MLPedidos.tsx)" -eq 0 && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - As 3 tabelas de MLPedidos (principal, Top Produtos, UF) foram AVALIADAS: a principal vira cards em <768px; sub-tabelas mantidas como scroll-x têm justificativa registrada no SUMMARY.
    - Em ≥768px a tabela principal permanece inalterada (D-07).
    - Os 5 KPICards usam o glossário central via prop tooltip.
    - NotConnected e EmptyReport migrados para `<EmptyState>` com ação específica.
    - TODAS as 4 ocorrências de cor semântica (L113-116/282/538/1371) viraram tokens kpi; amber/orange de warning preservados; `grep -c 'text-red-600'` = 0.
    - `npx tsc --noEmit` limpo.
  </acceptance_criteria>
  <done>/pedidos: tabela principal responsiva (3 tabelas avaliadas), 5 KPIs com glossário, empty states padronizados, todos os tokens aplicados; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 1b: MLFinanceiro — tabela→cards mobile (todas as 3 tabelas avaliadas), glossário, tokens kpi, spacing fix (UX-03/01/04)</name>
  <files>src/pages/mercadolivre/MLFinanceiro.tsx</files>
  <read_first>
    - RESEARCH.md §"Pattern 4" tabela de escopo — MLFinanceiro tem 3 tabelas: por produto (~L739), por marca (~L888), por SKU (~L982).
    - PATTERNS.md §"MLFinanceiro.tsx" — estrutura de row, padrão de card mobile, cores a substituir (L808/816/818/951/959/961/1023/1031). NÃO tocar fill=/stroke= Recharts (L579-584).
    - RESEARCH.md §"Visual Consistency Audit Findings" — regra token vs Recharts vs status; spacing fix do grid de KPIs (`grid-cols-2 sm:grid-cols-4 lg:grid-cols-8` → adicionar `md:grid-cols-4` ou `md:grid-cols-6`).
    - src/hooks/use-mobile.tsx — `useIsMobile()`, breakpoint 768px.
  </read_first>
  <action>
    (a) UX-03 — importar `useIsMobile`. AVALIAR as 3 tabelas de MLFinanceiro: converter a tabela por PRODUTO (~L739, a mais usada) para cards mobile (padrão PATTERNS; colunas Receita, Comissão, Frete, Lucro R$, Lucro %, com Lucro em token kpi conforme sinal). As tabelas por marca (~L888) e por SKU (~L982): se mantidas como `overflow-x-auto`, registrar justificativa no SUMMARY ("tabelas por marca/SKU: mantidas scroll-x — vistas secundárias do mesmo dado"); se simples, convertê-las também com o mesmo padrão de card. A tabela ≥768px não muda (D-07). (b) UX-01 — ligar o glossário aos 9 KPICards via `tip(key)`. (c) UX-04 — substituir TODAS as 8 ocorrências listadas em PATTERNS (L808/816/818/951/959/961/1023/1031): emerald→kpi-positive, red→kpi-negative; NÃO alterar fill=/stroke= Recharts (L579-584); adicionar `md:grid-cols-4` (ou md:grid-cols-6) ao grid de KPIs. Verificar `grep -c 'text-red-600'` = 0 ao final.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "MLFinanceiro" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i MLFinanceiro)" && grep -q "useIsMobile" src/pages/mercadolivre/MLFinanceiro.tsx && grep -q "KPI_GLOSSARY" src/pages/mercadolivre/MLFinanceiro.tsx && grep -q "text-kpi-positive" src/pages/mercadolivre/MLFinanceiro.tsx && test "$(grep -c 'text-red-600' src/pages/mercadolivre/MLFinanceiro.tsx)" -eq 0 && grep -qE "md:grid-cols-(4|6)" src/pages/mercadolivre/MLFinanceiro.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - As 3 tabelas de MLFinanceiro (produto, marca, SKU) foram AVALIADAS: a de produto vira cards em <768px; as demais mantidas como scroll-x têm justificativa registrada no SUMMARY.
    - Em ≥768px a tabela de produto permanece inalterada (D-07).
    - Os 9 KPICards usam o glossário central via prop tooltip.
    - TODAS as 8 ocorrências de cor semântica viraram tokens kpi; Recharts SVG (L579-584) intocado; `grep -c 'text-red-600'` = 0.
    - Grid de KPIs ganhou breakpoint `md:grid-cols-4|6`.
    - `npx tsc --noEmit` limpo.
  </acceptance_criteria>
  <done>/financeiro: tabela de produto responsiva (3 tabelas avaliadas), 9 KPIs com glossário, todos os 8 tokens aplicados, spacing corrigido; tsc limpo.</done>
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
- Grep confirma: `useIsMobile` nas três páginas; `EmptyState` onde havia empty state ad-hoc; `KPI_GLOSSARY`/tooltip nos KPIs; ausência de `text-red-600` em MLPedidos e MLFinanceiro; `text-kpi-positive` presente; `md:grid-cols-4|6` em MLFinanceiro.
- `npm run lint` sem novos erros nos arquivos tocados.
</verification>

<success_criteria>
- /anuncios, /pedidos, /financeiro renderizam cards empilhados sem overflow quebrado em viewport 320–768px e mantêm a tabela ≥768px (UX-03); todas as tabelas candidatas avaliadas.
- KPICards dessas páginas exibem glossário leiga (UX-01).
- Empty states dessas páginas padronizados com `<EmptyState>` acionável (UX-02).
- TODAS as cores semânticas via tokens kpi; Recharts/status preservados; spacing do grid corrigido (UX-04).
- tsc + build limpos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 03)

**Sem novos arquivos.** Consome `KPI_GLOSSARY` e `EmptyState` do plano 01.

**Padrões aplicados:**
- Render condicional `useIsMobile()` tabela↔cards nas 3 páginas (breakpoint 768px), com todas as tabelas candidatas avaliadas.
- Substituição de TODAS as cores hardcoded semânticas por tokens `text-kpi-positive`/`text-kpi-negative` (exceto Recharts/status).
- Helper `tip(key)` ligando KPICards ao glossário central.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-03-SUMMARY.md` when done.
</output>
