---
phase: 78-revisao-mobile-first-responsividade-e-ux-100-por-cento-no-mo
verified: 2026-07-02T01:30:00Z
status: human_needed
score: 14/14
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /anuncios em viewport 360px, tocar em um card de produto mobile e confirmar que o ListingDetailModal abre corretamente cabendo na tela (w-full em sm: quebra)"
    expected: "Modal ocupa 100% da largura em 360px, conteúdo scrollável, botão de fechar acessível"
    why_human: "B-02 fix é verificável em código (grep sm:max-w-4xl confirmado), mas o comportamento do Dialog em viewport real (sobreposição, scroll, teclado virtual) exige inspeção visual"
  - test: "Abrir /anuncios em 360px e tocar no botão de preço de um anúncio para verificar o PriceDetailSheet (B-01)"
    expected: "Sheet ocupa 100% da largura em 360px, não estoura o viewport"
    why_human: "SheetContent w-full confirmado no código, mas comportamento do vaul drawer em iOS/Android pode diferir"
  - test: "Abrir /organizacao em 360px e verificar que as 4 abas (Geral/Membros/Convites/Audit log) são acessíveis via scroll horizontal"
    expected: "Abas scrollam horizontalmente sem quebrar o layout e sem corte visual"
    why_human: "C-04: overflow-x-auto + w-max min-w-full confirmados em código; aparência e comportamento do scroll nativo variam por OS"
  - test: "Abrir /organizacao > aba Membros em 360px e verificar que o DropdownMenu '...' abre as ações de Acesso/Transferir/Remover (C-05)"
    expected: "O trigger de 3 pontos é visível e acessível por toque; guards canManage/isOwner funcionam corretamente"
    why_human: "Lógica de guards confirmada em código; comportamento do DropdownMenu em touch (posicionamento, fechamento) requer teste real"
  - test: "Abrir /fiscal em 360px, selecionar uma loja e verificar o Dialog de configuração do Lucro Real com o grid ICMS"
    expected: "Grid ICMS exibe 3 inputs em coluna única (grid-cols-1 no mobile); conteúdo do Dialog é scrollável com teclado virtual aberto"
    why_human: "C-11 (sm:grid-cols-3) e C-12 (max-h-[70dvh] overflow-y-auto) confirmados em código; comportamento com teclado virtual real exige dispositivo físico ou emulador"
  - test: "Abrir /perfil em dispositivo touch e tocar na foto de avatar para verificar o overlay de câmera"
    expected: "O ícone de câmera fica visível ao tocar (active:opacity-100 / group-active:opacity-100)"
    why_human: "C-09: active:opacity-100 e group-active:opacity-100 presentes em código; comportamento de active no iOS vs Android difere (iOS suprime :active em alguns contextos)"
---

# Phase 78: Revisão Mobile-First — Verification Report

**Phase Goal:** Dashboard 100% responsivo mobile-first — os 38 findings únicos da auditoria (6 BLOCKER, 16 MAJOR, 17 MINOR) corrigidos; toda função acessível no mobile; zero regressão (testes/build); zero mudança de comportamento de dados.
**Verified:** 2026-07-02T01:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Os 6 BLOCKERs estão corrigidos no código | VERIFIED | Greps confirmados: A-01/C-02 `numberOfMonths={isMobile ? 1 : 2}` + `max-w-[calc(100vw-1rem)]`; A-02 `flex flex-wrap gap-x-4 gap-y-1` (L729); B-01 `w-full sm:max-w-[560px]` (L297); B-02 `w-full sm:max-w-4xl` (L105 ListingDetailModal); C-01 `shrink-0 max-w-[140px] sm:max-w-none` (Header L58) |
| 2 | MLPeriodPicker usa useIsMobile para numberOfMonths condicional e popover limitado ao viewport | VERIFIED | L8 `import { useIsMobile }`, L46 `const isMobile = useIsMobile()`, L102 `numberOfMonths={isMobile ? 1 : 2}`, L74 `max-w-[calc(100vw-1rem)]` |
| 3 | Quick ranges do MLPeriodPicker têm flex-wrap (botões quebram em linha) | VERIFIED | L75 `<div className="flex flex-wrap gap-1 mb-3">` |
| 4 | OrganizationSwitcher acessível no mobile (sem hidden sm:block bloqueando) | VERIFIED | Header.tsx L58: `<div className="shrink-0 max-w-[140px] sm:max-w-none">` — hidden sm:block removido do wrapper |
| 5 | maxDaysBack (Phase 77) preservado no MLPeriodPicker via minDate + disabled callback | VERIFIED | L28 prop `maxDaysBack?`, L47 `const minDate = maxDaysBack ? startOfDay(subDays(...)) : null`, L101 `disabled={(date) => date > new Date() \|\| (minDate !== null && date < minDate)}` |
| 6 | /publicidade: rodapé de campanhas com flex-wrap + tabelas Campanhas/Produtos em dual-layout isMobile | VERIFIED | L729 `flex flex-wrap items-center gap-x-4 gap-y-1` (rodapé); L643 e L779 `{isMobile ? ... : ...}` (dual-layout) |
| 7 | /financeiro: tabelas Marca/Estado com dual-layout + chart Composição margem condicional | VERIFIED | L931 `{isMobile ? <cards> : <table>}` (Marca); L1047 (Estado); L489 `right: isMobile ? 4 : 48` |
| 8 | /anuncios: sticky header empilhado + Calendar 1 mês + tabelas Ranking/Marca/ABC com min-w + PieChart legível + filtros fluidos | VERIFIED | L1075 `flex flex-col gap-3 sm:flex-row`; L1842 `numberOfMonths={isMobile ? 1 : 2}`; L1956 `min-w-[640px]`, L2122 `min-w-[500px]`, L2228 `min-w-[700px]`; L2082 `label={!isMobile ? ...}`; L1136 `flex-1 min-w-[120px]` |
| 9 | /estoque: dual-layout inventário (cards mobile com ExternalLink + expansão de variações) + min-w Reposição Urgente | VERIFIED | L31 import useIsMobile, L830 `const isMobile`, L1207 `isMobile ? <cards> : <table>`, L1240 ExternalLink no card mobile, L1281 toggle expansão variações no card mobile (commit 5193bd9f); L310 `min-w-[500px]` |
| 10 | /pedidos: sticky header empilhado; dual-layout de cards intocado | VERIFIED | L1040 `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`; dual-layout existente não modificado |
| 11 | /organizacao: TabsList com scroll horizontal + OrgMembersTab ações em DropdownMenu com guards preservados + OrgInvitesTab botão w-full | VERIFIED | OrgSettings L38-39 `overflow-x-auto` + `flex-nowrap w-max min-w-full`; OrgMembersTab L221 DropdownMenu, L47-48 `canManage`/`isOwner` guards presentes, L101/115/129 handlers `org-member-*` EF inalterados; OrgInvitesTab L120 `w-full md:w-auto` |
| 12 | /fiscal: grid ICMS colapsável sm:grid-cols-3 + scroll interno Dialog; /devolucoes: tabela min-w-[640px] | VERIFIED | MLFiscal L349 `grid grid-cols-1 sm:grid-cols-3`; L605 `overflow-y-auto max-h-[70dvh]`; MLDevolucoes L206 `min-w-[640px]`, L228 `max-w-[120px] truncate` |
| 13 | Zero regressão: 318 testes verdes + build limpo | VERIFIED | `npx vitest run` → 318/318 passed (22 test files, exit 0); `npx vite build` → exit 0, 19.99s, sem erros TypeScript |
| 14 | Zero mudança de comportamento de dados: diff da phase toca apenas components/pages/planning; hooks/EF/RPC/supabase calls inalterados | VERIFIED | `git diff --name-only` mostra apenas `src/components/`, `src/pages/`, `.planning/`; MLPublicidade não tem chamadas supabase/invoke diretas — usa hooks existentes; OrgMembersTab usa os mesmos handlers `org-member-update-role`/`org-member-remove`/`org-transfer-ownership` sem mudança |

**Score:** 14/14 truths verified (0 present, behavior-unverified)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/mercadolivre/MLPeriodPicker.tsx` | Calendário responsivo + PopoverContent limitado + flex-wrap quick ranges | VERIFIED | L8 import, L46 hook, L74 max-w-[calc(100vw-1rem)], L102 numberOfMonths condicional, L75 flex-wrap |
| `src/components/layout/Header.tsx` | OrganizationSwitcher acessível no mobile | VERIFIED | L58 max-w-[140px] sm:max-w-none (hidden sm:block removido) |
| `src/pages/mercadolivre/MLPublicidade.tsx` | Rodapé flex-wrap + dual-layout Campanhas/Produtos | VERIFIED | L729 flex-wrap, L643 e L779 isMobile ternário |
| `src/pages/mercadolivre/MLFinanceiro.tsx` | Tabelas Marca/Estado dual-layout + chart margem condicional | VERIFIED | L931, L1047 isMobile, L489 right condicional |
| `src/components/mercadolivre/anuncios/ListingDetailModal.tsx` | w-full sm:max-w-4xl | VERIFIED | L105 `w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto` |
| `src/pages/mercadolivre/MLAnuncios.tsx` | PriceDetailSheet w-full + sticky header + Calendar + tabelas min-w + PieChart + filtros | VERIFIED | L297, L1075, L1842, L1956/2122/2228, L2082, L1136 |
| `src/pages/mercadolivre/MLEstoque.tsx` | Dual-layout inventário + min-w Reposição Urgente | VERIFIED | L830 isMobile, L1207 dual-layout, L1240 ExternalLink, L1281 expansão variações, L310 min-w |
| `src/pages/mercadolivre/MLPedidos.tsx` | Sticky header empilhado | VERIFIED | L1040 flex-col gap-3 sm:flex-row |
| `src/pages/org/OrgSettings.tsx` | TabsList com scroll horizontal | VERIFIED | L38-39 overflow-x-auto + flex-nowrap w-max min-w-full |
| `src/components/org/OrgMembersTab.tsx` | DropdownMenu por item com guards canManage/isOwner | VERIFIED | L221 DropdownMenu, L47-48 guards, L101-129 handlers EF inalterados |
| `src/components/org/OrgInvitesTab.tsx` | Botão convite w-full md:w-auto | VERIFIED | L120 |
| `src/pages/mercadolivre/MLFiscal.tsx` | grid-cols-1 sm:grid-cols-3 + max-h-[70dvh] | VERIFIED | L349, L605 |
| `src/pages/mercadolivre/MLDevolucoes.tsx` | min-w-[640px] + truncate Motivo | VERIFIED | L206, L228 |
| `src/pages/Sellers.tsx` | Botões h-9 w-9 + sr-only | VERIFIED | L207, L211, L220, L263 |
| `src/pages/Integrations.tsx` | Tooltip shadcn nos botões icon-only | VERIFIED | L27-29 imports, L986-999 Tooltip wrapper |
| `src/pages/Profile.tsx` | active:opacity-100 + group-active:opacity-100 | VERIFIED | L101 |
| `src/pages/mercadolivre/MLPerguntas.tsx` | Textarea autoFocus | VERIFIED | L328 |
| `src/pages/mercadolivre/MLMetas.tsx` | scroll-mt-[52px] | VERIFIED | L165 |
| `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx` | sm:grid-cols + sm:order + ExtraField flex-col | VERIFIED | L308 grid, L310 sm:order-2, L636 sm:order-1, L757 flex-col |
| `src/components/financial/CashFlowSimulator.tsx` | sm:grid-cols + sm:order | VERIFIED | L240 grid, L242 sm:order-2, L367 sm:order-1 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MLPeriodPicker.tsx` | `src/hooks/use-mobile.tsx` | `useIsMobile()` controla `numberOfMonths` | WIRED | L8 import, L46 chamada, L102 uso |
| `MLFinanceiro.tsx` | `src/hooks/use-mobile.tsx` | `isMobile` controla tabelas Marca/Estado e margem do chart | WIRED | L121 isMobile, 5 usos |
| `MLPublicidade.tsx` | `src/hooks/use-mobile.tsx` | `isMobile` controla dual-layout Campanhas/Produtos | WIRED | L6 import, L75 chamada, L643/L779 usos |
| `MLEstoque.tsx` | `src/hooks/use-mobile.tsx` | `isMobile` controla dual-layout inventário | WIRED | L31 import, L830 chamada, L1207 uso |
| `MLAnuncios.tsx` | `src/hooks/use-mobile.tsx` | `isMobile` controla Calendar, PieChart, filtros | WIRED | Já existia na página; L1842, L2082 usos adicionais |
| `OrgMembersTab.tsx` | `supabase.functions.invoke("org-member-*")` | handlers de ação (role/transfer/remove) preservados | WIRED | L101/115/129 inalterados |

---

### Paridade Dual-Layout (Lição Phase 71)

| Componente | Interação por Item | Desktop | Mobile | Status |
|------------|-------------------|---------|--------|--------|
| MLAnuncios catálogo | Abre ListingDetailModal (`openDetail`) | onClick nas linhas | `onClick={() => openDetail(item)}` no card (L1270) | VERIFICADO |
| MLEstoque inventário | ExternalLink (ver no ML) | Última coluna | `<ExternalLink>` no card (L1240) | VERIFICADO |
| MLEstoque inventário | Expansão de variações | `toggleRow` no ChevronRight | `toggleExpand` + ChevronRight/Down no card (L1281) — fix commit 5193bd9f | VERIFICADO |
| MLPublicidade tabelas | Somente leitura (sem ação por item) | — | — | N/A |
| MLFinanceiro tabelas | Somente leitura (sem ação por item) | — | — | N/A |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 318 testes verdes após todas as mudanças | `npx vitest run` | 318/318 passed (22 test files, exit 0) | PASS |
| Build limpo (TypeScript sem erros) | `npx vite build` | exit 0, 19.99s, 4177 modules | PASS |
| Grep gates Plan 01 (MLPeriodPicker + Header) | numberOfMonths={isMobile ? 1 : 2} + max-w-[calc(100vw + useIsMobile + flex-wrap | Todos presentes | PASS |
| Grep gates Plan 02 (MLPublicidade + MLFinanceiro) | flex-wrap (publicidade) + isMobile ? 4 : 48 + count isMobile ≥ 3 (= 5 em financeiro) | Todos presentes | PASS |
| Grep gates Plan 03 (MLAnuncios + MLEstoque + MLPedidos) | w-full sm:max-w-[560px] + sm:max-w-4xl + flex-col gap-3 sm:flex-row + min-w-[ + isMobile (estoque) | Todos presentes | PASS |
| Grep gates Plan 04 (OrgSettings + OrgMembers + MLFiscal + etc.) | overflow-x-auto (OrgSettings) + DropdownMenu (OrgMembers) + w-full md:w-auto (OrgInvites) + sm:grid-cols-3 (fiscal) + min-w-[640px] (devolucoes) + h-9 w-9 (sellers) + Tooltip (integrations) + active:opacity-100 (profile) + autoFocus (perguntas) + scroll-mt-[ (metas) | Todos presentes | PASS |

---

### Requirements Coverage

| Plano | Finding(s) | Severidade | Status |
|-------|-----------|-----------|--------|
| 01 | A-01/C-02 — MLPeriodPicker calendário duplo | BLOCKER | SATISFIED |
| 01 | C-01 — OrganizationSwitcher invisível no mobile | BLOCKER | SATISFIED |
| 01 | C-14 — quick ranges sem flex-wrap | MINOR | SATISFIED |
| 02 | A-02 — rodapé campanhas gap-8 sem wrap | BLOCKER | SATISFIED |
| 02 | A-07 — tabela Campanhas 10 col. sem mobile | MAJOR | SATISFIED |
| 02 | A-03 — tabela Produtos Patrocinados 15 col. | MAJOR | SATISFIED |
| 02 | A-04 — tabelas Marca/Estado sem mobile | MAJOR | SATISFIED |
| 02 | A-05 — chart Composição margin right:48 | MAJOR | SATISFIED |
| 02 | A-06 — copy "à esquerda" incorreto | MINOR | SATISFIED (L209 "acima") |
| 02 | A-08 — controles Análise de Preços quebra | MINOR | SATISFIED |
| 02 | A-09 — botões Atualizar/Personalizar ícone-only | MINOR | SATISFIED (aria-label + title adicionados) |
| 02 | A-10 — KPI 8-cards trunca valores | MINOR | SATISFIED (grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 já adequado, sem mudança necessária) |
| 03 | B-01 — PriceDetailSheet w-[560px] estoura | BLOCKER | SATISFIED |
| 03 | B-02 — ListingDetailModal max-w-4xl sem override | BLOCKER | SATISFIED |
| 03 | B-03 — sticky header /anuncios não empilha | MAJOR | SATISFIED |
| 03 | B-04 — sticky header /pedidos não empilha | MAJOR | SATISFIED |
| 03 | B-05 — controles Relatórios overflow | MAJOR | SATISFIED |
| 03 | B-06 — tabela catálogo overflow-x ambíguo | MAJOR | SATISFIED (overflow-x-auto overflow-y-auto) |
| 03 | B-07 — tabelas Ranking/Marca/ABC sem min-w | MAJOR | SATISFIED |
| 03 | B-08 — tabela inventário /estoque sem card mobile | MAJOR | SATISFIED |
| 03 | B-09 — Calendar 2 meses não cabe | MAJOR | SATISFIED |
| 03 | B-13 — tabela Reposição Urgente sem min-w | MAJOR | SATISFIED |
| 03 | B-10 — Simulador resultado enterrado | MINOR | SATISFIED (sm:order-1/2) |
| 03 | B-11 — ExtraField estoura linha | MINOR | SATISFIED (flex-col gap-1.5 sm:flex-row) |
| 03 | B-12 — CashFlowSimulator controles antes gráfico | MINOR | SATISFIED (sm:order-1/2) |
| 03 | B-14 — PieChart labels sobrepostos | MINOR | SATISFIED (label={!isMobile ? ...} + Legend) |
| 03 | B-15 — filtros catálogo amontoados | MINOR | SATISFIED (flex-1 min-w-[120px] + w-full sm:w-36) |
| 04 | C-03 — tabela Devoluções sem min-width | MAJOR | SATISFIED |
| 04 | C-04 — OrgSettings TabsList cortada | MAJOR | SATISFIED |
| 04 | C-05 — linha de membro esmaga 4 botões | MAJOR | SATISFIED |
| 04 | C-06 — botão convite sem w-full | MINOR | SATISFIED |
| 04 | C-07 — botões Sellers <40px | MINOR | SATISFIED (h-9 w-9 = 36px + sr-only) |
| 04 | C-08 — botões Integrações só title/hover | MINOR | SATISFIED (Tooltip shadcn) |
| 04 | C-09 — upload avatar group-hover | MINOR | SATISFIED (active:opacity-100) |
| 04 | C-10 — sticky header config offsets | MINOR | SATISFIED (scroll-mt-[52px] em MLMetas) |
| 04 | C-11 — grid ICMS fiscal estoura dialog | MAJOR | SATISFIED |
| 04 | C-12 — Dialog fiscal sem scroll interno | MINOR | SATISFIED |
| 04 | C-13 — textarea Perguntas sem autoFocus | MINOR | SATISFIED |

**Cobertura total:** 38 findings → todos cobertos pelos 4 planos.

---

### Anti-Patterns Found

Nenhum marcador de dívida técnica (TBD/FIXME/XXX) encontrado nos arquivos modificados da phase. Nenhum placeholder introduzido (confirmado pelos SUMMARYs e pela ausência de matches nos greps).

---

### Human Verification Required

Os 14 truths são verificáveis em código (grep/leitura). No entanto, 6 behaviors dependem de viewport real para confirmação plena:

#### 1. ListingDetailModal em 360px (B-02)

**Test:** Abrir `/anuncios` em viewport 360px (DevTools ou dispositivo), tocar em um card de produto e confirmar que o modal abre corretamente
**Expected:** Dialog ocupa 100% da largura, conteúdo é scrollável verticalmente, botão de fechar é acessível com o polegar
**Why human:** Código confirma `w-full sm:max-w-4xl` mas comportamento do `<Dialog>` do Radix com teclado virtual e safe-area do iOS/Android exige teste real

#### 2. PriceDetailSheet em 360px (B-01)

**Test:** Em `/anuncios`, tocar no botão de editar preço de um anúncio
**Expected:** Sheet ocupa 100% da largura sem overflow horizontal; conteúdo interno scrollável
**Why human:** `w-full sm:max-w-[560px]` confirmado; comportamento do vaul Sheet em iOS (bottom sheet) difere de WebView padrão

#### 3. OrgSettings TabsList scroll horizontal (C-04)

**Test:** Abrir `/organizacao` em 360px e tentar navegar entre as 4 abas
**Expected:** Abas scrollam suavemente sem quebra de layout; aba ativa visível
**Why human:** overflow-x-auto + w-max min-w-full confirmados; scroll nativo de abas pode ser invisível sem indicadores visuais (scrollbar oculta no iOS)

#### 4. OrgMembersTab DropdownMenu em 360px (C-05)

**Test:** Abrir `/organizacao` > aba Membros como owner em 360px e tocar no botão "..." de um membro
**Expected:** DropdownMenu abre com as opções Acesso/Transferir/Remover; AlertDialogs de confirmação funcionam corretamente
**Why human:** DropdownMenu e AlertDialogs controlados por estado verificados em código; posicionamento e fechamento por toque variam por implementação Radix/browser

#### 5. MLFiscal Dialog com teclado virtual (C-11 + C-12)

**Test:** Abrir `/fiscal` > selecionar uma loja > abrir o Dialog de Lucro Real em 360px com teclado virtual aberto
**Expected:** Grid ICMS aparece em coluna única; inputs acessíveis sem o Dialog ser cortado pelo teclado
**Why human:** `grid-cols-1` e `max-h-[70dvh]` confirmados; comportamento com `dvh` (dynamic viewport height) no Safari iOS pode diferir

#### 6. Profile overlay câmera em touch (C-09)

**Test:** Abrir `/perfil` em dispositivo touch, tocar na foto de avatar
**Expected:** Overlay de câmera aparece ao tocar (active state), não apenas ao fazer hover
**Why human:** `active:opacity-100` e `group-active:opacity-100` adicionados; iOS suprime `:active` em elementos que não são `<button>` ou `<a>` — o wrapper é um `<button>` (confirmar lendo o contexto exato do clicável)

---

## Resumo

Todos os 14 truths mensuráveis em código estão VERIFICADOS:
- 6 BLOCKERs confirmados por grep direto nos arquivos relevantes
- 8 MAJORs amostrados (B-08, B-03/B-04, A-04, C-05, A-07/A-03, C-11, B-07) confirmados por leitura de código e estrutura dual-layout
- Build e testes verdes (318/318, exit 0)
- Zero mudança de dados (diff toca apenas components/pages/planning; hooks/EF/supabase calls inalterados)
- maxDaysBack (Phase 77) preservado via `minDate` + `disabled` callback
- Paridade dual-layout confirmada: MLAnuncios mobile card tem `openDetail` → `ListingDetailModal`; MLEstoque mobile card tem `ExternalLink` + toggle de variações (fix commit 5193bd9f)

Os 6 itens de verificação humana são todos de natureza visual/comportamental em viewport real — o código está correto mas o comportamento de Dialog/Sheet/ScrollArea/active-state em iOS/Android não é verificável por grep.

---

_Verified: 2026-07-02T01:30:00Z_
_Verifier: Claude (gsd-verifier)_
