# Phase 78 — Auditoria Mobile-First: Grupo B

**Auditado em:** 2026-07-01
**Método:** Code-only audit (sem dev server); viewport de referência 360–430px
**Páginas auditadas:** `/anuncios`, `/estoque`, `/compras`, `/pedidos`, `/precificacao`, `/fluxo-de-caixa`

---

## Findings

---

### [B-01] PriceDetailSheet tem largura fixa 560px — estoura viewport mobile

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:297`
- **Severidade:** BLOCKER (função inacessível no mobile)
- **Evidência:**
  ```tsx
  <SheetContent side="right" className="w-[560px] sm:max-w-[560px] overflow-y-auto p-0">
  ```
  Em um viewport de 360–430px, `w-[560px]` força o Sheet para além da tela. O atributo `sm:max-w-[560px]` só entra em `≥640px`. No mobile o Sheet não tem max-width definida, mas a largura fixa `w-[560px]` sobrepõe a largura de tela — o conteúdo fica cortado e o Sheet não cobre a tela corretamente.
- **Fix sugerido:** Substituir `w-[560px] sm:max-w-[560px]` por `w-full sm:max-w-[560px]` (padrão usado no próprio shadcn/ui SheetContent). A análise de preços competitivos fica plenamente usável no mobile com `w-full`.

---

### [B-02] ListingDetailModal usa `max-w-4xl` sem override mobile — Dialog cruza viewport

- **Página:** `/anuncios`
- **Arquivo:** `src/components/mercadolivre/anuncios/ListingDetailModal.tsx:105`
- **Severidade:** BLOCKER (modal cortado no mobile)
- **Evidência:**
  ```tsx
  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
  ```
  `max-w-4xl` = 56rem (896px). O shadcn DialogContent padrão tem `w-full` no mobile mas sem padding lateral explícito nem `mx-auto` no contexto correto, o diálogo pode encostar nas bordas ou ser cortado. Mais crítico: sem `sm:max-w-4xl`, o `max-w-4xl` aplica-se desde 0px, empurrando o Dialog a ocupar 896px de largura — em 360px resulta em conteúdo horizontalmente cortado. Verificar: o padrão shadcn usa `sm:max-w-lg` etc. para deixar o viewport pequeno com largura 100%.
- **Fix sugerido:** `className="w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto"` — garante 100vw no mobile e o limite de 4xl apenas em `≥640px`.

---

### [B-03] Sticky header de `/anuncios` usa `flex items-center justify-between` sem `flex-col` mobile — conteúdo esmagado

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1075`
- **Severidade:** MAJOR (layout quebra)
- **Evidência:**
  ```tsx
  <div className="flex items-center justify-between gap-4">
    <MLPageHeader title="Anúncios" lastUpdated={lastUpdated} />
    <div className="flex items-center gap-3">
      <TabsList className="h-8"> {/* 3 abas: Anúncios / Relatórios / Custos */}
        ...
      </TabsList>
      <Button ...>Atualizar</Button>
    </div>
  </div>
  ```
  Em 360px, título "Anúncios" + TabsList (3 tabs de ~80px cada) + botão "Atualizar" não cabe em uma linha. Sem `flex-col sm:flex-row` a linha estoura ou o texto é truncado/invisível. Contraste: `/estoque` e `/compras` já usam `flex-col gap-3 lg:flex-row ...`.
- **Fix sugerido:** Trocar para `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`, igual ao padrão de `/estoque:1002`.

---

### [B-04] Sticky header de `/pedidos` não empilha em mobile — mesma falha de B-03

- **Página:** `/pedidos`
- **Arquivo:** `src/pages/mercadolivre/MLPedidos.tsx:1040`
- **Severidade:** MAJOR (layout quebra)
- **Evidência:**
  ```tsx
  <div className="flex items-center justify-between gap-4">
    <MLPageHeader title="Pedidos" lastUpdated={lastSyncedAt} />
    <div className="flex items-center gap-2">
      <MLPeriodPicker ... />
      <TabsList className="h-8"> {/* Pedidos / Relatórios */}
      </TabsList>
      <Button ...> {/* Recalcular */}
      <Button ...> {/* Atualizar */}
    </div>
  </div>
  ```
  5 elementos no `div` direito (MLPeriodPicker + TabsList + 2 botões) mais o título não cabem em 360px na mesma linha. O row overflow esconde itens ou estica o header para fora do viewport.
- **Fix sugerido:** Idêntico ao B-03: `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`.

---

### [B-05] Aba Relatórios de `/anuncios` — controles da sub-aba Ranking estouram em mobile

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1783`
- **Severidade:** MAJOR (overflow horizontal)
- **Evidência:**
  ```tsx
  <div className="flex items-center justify-between gap-3">
    <TabsList className="h-8"> {/* Ranking / Análise por Marca / Curva ABC */}
    </TabsList>
    {(reportTab === "ranking" || reportTab === "marca") && (
      <div className="flex items-center gap-2">
        <Popover ...> {/* seletor de período */}
        {reportTab === "ranking" && (
          <>
            <div/> {/* divider */}
            <Input .../>  {/* search 192px */}
            <Select .../>  {/* filtro marca 176px */}
            <Button .../>  {/* Exportar */}
          </>
        )}
      </div>
    )}
  </div>
  ```
  TabsList (3 tabs) + todos os controles no `flex-row` sem quebra = overflow garantido em 360–430px. Não há `flex-wrap` nem `flex-col` fallback.
- **Fix sugerido:** Converter o container para `flex flex-col gap-3` e posicionar os controles abaixo da TabsList em `<div className="flex items-center gap-2 flex-wrap">`.

---

### [B-06] Tabela do catálogo de `/anuncios` — ramo desktop não tem wrapper `overflow-x-auto`

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1297`
- **Severidade:** MAJOR (overflow horizontal no desktop em viewports intermediários — e se isMobile falhar)
- **Evidência:**
  ```tsx
  <div className="max-h-[600px] overflow-auto">
    <Table>
  ```
  `overflow-auto` (atalho para `overflow: auto` em x e y) cobre o scroll horizontal, mas a semântica no código é ambígua — o objetivo declarado é scroll vertical com sticky header, e o `overflow-auto` inibe o `position: sticky` nos `<TableHeader>` internos (sticky dentro de overflow:auto funciona, mas overflow:hidden quebraria). Tecnicamente está correto para o scroll horizontal, porém é frágil: qualquer alteração para `overflow-y-auto overflow-x-hidden` quebraria o mobile. Documenta como risco menor vs. B-07.
- **Fix sugerido:** Explicitar `overflow-x-auto overflow-y-auto` para clareza e prevenção de futura regressão.

---

### [B-07] Tabelas Ranking/Marca/ABC em `/anuncios` — sem `overflow-x-auto` externo, `overflow-auto` no wrapper

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1955, 2115, 2221`
- **Severidade:** MAJOR (overflow horizontal nas sub-abas de Relatórios no mobile)
- **Evidência:**
  ```tsx
  <div className="max-h-[600px] overflow-auto">
    <Table>  {/* tabela com 8+ colunas sem min-w */}
  ```
  As tabelas Ranking (8 colunas), Marca (6 colunas) e ABC (9 colunas) usam shadcn `<Table>` sem `min-w` explícito. O wrapper `overflow-auto` permite scroll horizontal, mas a tabela tende a comprimir colunas ao invés de permitir scroll porque não há `min-width` na `<table>`. Em 360px, colunas de "Receita", "Vendidos", "% Part." ficam colapsadas ao mínimo ou desaparecem.
- **Fix sugerido:** Adicionar `<Table className="min-w-[600px]">` (ou valor equivalente ao total de `w-*` das colunas) dentro do wrapper `overflow-auto`. Padrão aplicado em `/compras` via `ReplenishmentSkuTable:614` com `min-w-[220px]` por coluna.

---

### [B-08] Tabela de inventário de `/estoque` sem variante mobile card — 11 colunas no mobile

- **Página:** `/estoque`
- **Arquivo:** `src/pages/mercadolivre/MLEstoque.tsx:1206`
- **Severidade:** MAJOR (usabilidade crítica)
- **Evidência:**
  ```tsx
  <div className="max-h-[600px] overflow-auto">
    <Table>
      <TableHeader>
        {/* w-8, w-10, Produto, Preço, Estoque, Vendidos(Xd), Unid/dia, Cobertura, Logística, Frete, Saúde, ação */}
        {/* = 12 colunas */}
  ```
  Sem `isMobile` dual-layout e sem `min-w` na Table, em 360px o overflow ocorre mas o scroll horizontal junto ao scroll vertical `max-h-600px` cria uma UX de tela-dentro-de-tela inaceitável para leigos. Contraste direto: `/pedidos` (1311) e `/anuncios` catálogo (1251) implementaram card mobile. `/estoque` não implementou.
- **Fix sugerido:** Implementar dual-layout igual ao `/pedidos:1311` — card mobile com campos essenciais (Produto, Estoque, Cobertura, Ação) e o tabela completo só em `lg:`. Referência direta: `src/pages/mercadolivre/MLPedidos.tsx:1311–1344`.

---

### [B-09] Calendar de seleção de período (Relatórios) renderiza `numberOfMonths={2}` — não cabe em mobile

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1842`
- **Severidade:** MAJOR (Popover de calendário inacessível no mobile)
- **Evidência:**
  ```tsx
  <Calendar
    mode="range"
    ...
    numberOfMonths={2}
  ```
  O calendário de 2 meses tem largura ~640px. Em um Popover de 360px de viewport, ele fica cortado e não há scroll horizontal no Popover (overflow: hidden por padrão). O usuário não consegue selecionar datas do 2º mês nem fechar facilmente.
- **Fix sugerido:** `numberOfMonths={isMobile ? 1 : 2}` — condicionado ao hook `useIsMobile()` já importado na página (linha 545).

---

### [B-10] `SimuladorPrecificacao` usa `lg:grid-cols-[1fr_340px]` sem fallback — painel "Resultado" aparece abaixo de scroll longo

- **Página:** `/precificacao`
- **Arquivo:** `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx:308`
- **Severidade:** MINOR (UX — resultado enterrado no mobile)
- **Evidência:**
  ```tsx
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 items-start text-sm">
  ```
  Em mobile (`grid-cols-1`) os inputs (7 cards) aparecem antes do painel "Preço de venda". O usuário precisa rolar ~500px de formulário para ver o resultado. O sticky do resultado (`lg:sticky lg:top-14`) só ativa em `lg:`.
- **Fix sugerido:** Reorganizar a ordem DOM no mobile: colocar o card "Preço de venda" primeiro via `order-first sm:order-none` no painel de resultado, ou colocar o resultado acima dos inputs em mobile com CSS grid `order`. Alternativa mais simples: `sm:grid-cols-[1fr_300px]` já em tablet para expor o resultado mais cedo.

---

### [B-11] `ExtraField` em `SimuladorPrecificacao` — linha com Switch + label + Select + Input não cabe em 360px

- **Página:** `/precificacao`
- **Arquivo:** `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx:756–782`
- **Severidade:** MINOR (overflow de linha em tela estreita)
- **Evidência:**
  ```tsx
  <div className="flex items-center gap-2">
    <Switch .../>  {/* ~28px */}
    <span .../>    {/* label variável ex: "Comissão de afiliado" ~170px */}
    <Select .../>  {/* w-[70px] */}
    <Input .../>   {/* w-24 = 96px */}
  </div>
  ```
  Total estimado: 28 + 170 + 70 + 96 + gaps ≈ 380px+ em 360px de viewport. A linha estoura.
- **Fix sugerido:** Envolver em duas linhas: `<div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">`. Label na linha 1, controles (Switch + Select + Input) na linha 2.

---

### [B-12] `CashFlowSimulator` usa `lg:grid-cols-[340px_1fr]` sem fallback legível em mobile

- **Página:** `/fluxo-de-caixa`
- **Arquivo:** `src/components/financial/CashFlowSimulator.tsx:240`
- **Severidade:** MINOR (UX — tela mobile mostra primeiro o painel de controles longo, depois o gráfico)
- **Evidência:**
  ```tsx
  <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
  ```
  Em mobile (`grid-cols-1`) os controles do simulador (sliders + lista de eventos) ficam antes do gráfico. O usuário precisa rolar para ver o resultado da simulação.
- **Fix sugerido:** Adicionar `sm:grid-cols-[300px_1fr]` para já separar em tablet, e/ou reordenar em mobile: gráfico primeiro (via `order-2 lg:order-none` no gráfico), controles segundo.

---

### [B-13] Tabela de sub-aba "Reposição Urgente" em `/estoque` sem `overflow-x-auto`

- **Página:** `/estoque`
- **Arquivo:** `src/pages/mercadolivre/MLEstoque.tsx:308`
- **Severidade:** MAJOR (overflow horizontal)
- **Evidência:**
  ```tsx
  <div className="max-h-80 overflow-auto">
    <table className="w-full text-sm">
  ```
  A tabela de "Reposição Urgente" (SubTabCobertura) tem overflow-auto mas sem `min-w` ou variante mobile. 5+ colunas (Produto, Dias de cobertura, Estoque, Vendidos, etc.) estouram em 360px.
- **Fix sugerido:** Adicionar `<table className="w-full text-sm min-w-[500px]">` dentro do wrapper `overflow-auto`, igual ao fix de B-07.

---

### [B-14] Gráficos de Análise por Marca (PieChart) — `labelLine={false}` mas labels inline podem sobrepor em mobile

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:2082`
- **Severidade:** MINOR (legibilidade — labels do Pie ficam sobrepostos em viewport pequeno)
- **Evidência:**
  ```tsx
  <Pie
    ...
    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
    labelLine={false}
    fontSize={10}
  >
  ```
  Com `ResponsiveContainer width="100%"` em 360px, o PieChart fica com ~340px de largura. Labels em `fontSize=10` com `name` podendo ser longo (ex: "Pralana Bangora") vão sobrepor as fatias ou outras labels.
- **Fix sugerido:** Remover o `label` prop do Pie no mobile (condicionado a `!isMobile`) e usar `<Legend>` abaixo do gráfico, que é a abordagem usada em `/estoque:232–237`.

---

### [B-15] `/anuncios` mobile — filtros da aba Catálogo (`flex-wrap`) com `w-44` no campo de busca não responsivo ao mobile

- **Página:** `/anuncios`
- **Arquivo:** `src/pages/mercadolivre/MLAnuncios.tsx:1134–1217`
- **Severidade:** MINOR (UX — filtros amontoados)
- **Evidência:**
  ```tsx
  <div className="flex items-center gap-1.5 w-full sm:w-auto flex-wrap">
    <div className="relative w-44"> {/* Search */}
    <Select ...className="w-36 ..."> {/* Brand */}
    <Select ...className="w-32 ..."> {/* Logistic */}
    <Checkbox ... /> {/* Ocultar sem estoque */}
    {/* + toggle financeiro/preço */}
  ```
  Em 360px: `w-44` (176px) + `w-36` (144px) + `w-32` (128px) = 448px+ só nos 3 primeiros elementos. O `flex-wrap` quebra as linhas mas resulta em múltiplos rows de filtros de altura variável ocupando espaço valioso antes da tabela/cards.
- **Fix sugerido:** No mobile, agrupar filtros em um Sheet de filtros (padrão comum de dashboards mobile) ou usar `Select` compacto (`w-full sm:w-36`) com busca de largura automática (`flex-1 min-w-[120px]`).

---

## Tabela-Resumo

| # | Finding | Severidade | Página |
|---|---------|-----------|--------|
| B-01 | PriceDetailSheet `w-[560px]` estoura mobile | BLOCKER | `/anuncios` |
| B-02 | ListingDetailModal `max-w-4xl` sem override mobile | BLOCKER | `/anuncios` |
| B-03 | Sticky header `/anuncios` não empilha em mobile | MAJOR | `/anuncios` |
| B-04 | Sticky header `/pedidos` não empilha em mobile | MAJOR | `/pedidos` |
| B-05 | Controles Relatórios overflow no mobile | MAJOR | `/anuncios` |
| B-06 | Tabela catálogo sem `overflow-x-auto` explícito (risco) | MAJOR | `/anuncios` |
| B-07 | Tabelas Ranking/Marca/ABC sem `min-w` — comprimem no mobile | MAJOR | `/anuncios` |
| B-08 | Tabela inventário `/estoque` sem variante card mobile | MAJOR | `/estoque` |
| B-09 | Calendar `numberOfMonths={2}` não cabe em mobile | MAJOR | `/anuncios` |
| B-10 | Simulador `/precificacao` resultado enterrado no mobile | MINOR | `/precificacao` |
| B-11 | `ExtraField` estoura linha em 360px | MINOR | `/precificacao` |
| B-12 | `CashFlowSimulator` controles antes do gráfico no mobile | MINOR | `/fluxo-de-caixa` |
| B-13 | Tabela "Reposição Urgente" sem `min-w` — overflow no mobile | MAJOR | `/estoque` |
| B-14 | PieChart labels sobrepostos em 360px | MINOR | `/anuncios` |
| B-15 | Filtros do catálogo amontoados em mobile | MINOR | `/anuncios` |

## Contagem por Severidade

| Severidade | Quantidade |
|-----------|-----------|
| BLOCKER | 2 |
| MAJOR | 8 |
| MINOR | 5 |
| **Total** | **15** |

---

## Observações gerais por página

### `/anuncios` (MLAnuncios.tsx)
A página mais crítica do grupo. O dual-layout isMobile está corretamente implementado **apenas** na aba Catálogo (cards mobile vs. tabela desktop). As demais seções (Relatórios: Ranking, Marca, ABC) e o `PriceDetailSheet` não têm versão mobile — são BLOCKERs ou MAJORs. O modal `ListingDetailModal` tem problema de `max-w-4xl` sem breakpoint mobile. O sticky header não empilha em telas pequenas.

### `/estoque` (MLEstoque.tsx)
Sticky header está bem resolvido (`flex-col gap-3 lg:flex-row`). Porém a tabela de inventário — a parte mais usada — não tem variante card mobile (ao contrário de `/pedidos` e `/anuncios`/catálogo que implementaram isso). Com 12 colunas e `overflow-auto`, o resultado no mobile é uma tabela com scroll horizontal dentro de scroll vertical — UX confusa para o usuário leigo visado pelo projeto.

### `/compras` (MLCompras.tsx)
A página em si está bem estruturada (`flex-col gap-3 lg:flex-row` no header). O `ReplenishmentSkuTable` tem `overflow-x-auto` mas sem `min-w` definido. Recomenda-se verificar se a tabela tem scroll horizontal funcional no mobile — aparentemente sim dado o `min-w-[220px]` na primeira coluna, mas as demais colunas sem `min-w` podem comprimir.

### `/pedidos` (MLPedidos.tsx)
Tem a melhor implementação de responsividade do grupo — dual-layout com card mobile bem construído. Problema único: o sticky header não empilha (B-04). Todas as tabelas de relatórios dentro de `/pedidos` têm `overflow-x-auto` adequado.

### `/precificacao` (MLPrecificacao.tsx + SimuladorPrecificacao.tsx)
Layout `grid-cols-1 lg:grid-cols-[1fr_340px]` funciona bem no mobile estruturalmente. Problemas são de UX (resultado enterrado) e linha `ExtraField` que estoura — nenhum BLOCKER.

### `/fluxo-de-caixa` (MLFluxoCaixa.tsx)
Sem problemas estruturais graves. Gráficos usam `ResponsiveContainer` adequado. TreasuryPanel usa `grid-cols-2 md:grid-cols-4` — OK no mobile (2 colunas). Problema menor: `CashFlowSimulator` com controles antes do gráfico.

---

*Auditoria realizada via análise estática de código. Screenshots não capturados (dev server não disponível no ambiente de execução). Todos os findings foram verificados por linha de código.*
