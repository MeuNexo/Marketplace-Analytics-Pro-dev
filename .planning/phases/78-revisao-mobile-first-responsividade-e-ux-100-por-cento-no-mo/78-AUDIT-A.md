# Phase 78 — Auditoria Mobile-First: Grupo A

**Data:** 2026-07-01
**Viewport de referência:** 360–430px
**Método:** Análise estática de código (sem dev server rodando)
**Páginas auditadas:** `/` (Vendas), `/consultor`, `/publicidade`, `/financeiro`, `/produtos-vendidos`, `/analise-precos`

---

## Findings

---

### [A-01] MLPeriodPicker: calendário duplo (`numberOfMonths={2}`) estoura o viewport mobile

- **Página:** todas as 6 páginas do Grupo A
- **Arquivo:** `src/components/mercadolivre/MLPeriodPicker.tsx:89` e `:72`
- **Severidade:** BLOCKER (seleção de período inacessível/cortada em 360px)
- **Evidência:**
  ```tsx
  <PopoverContent className="w-auto p-3" align="start">
    ...
    <Calendar ... numberOfMonths={2} ... />
  ```
  `w-auto` não restringe a largura do `PopoverContent`. O `Calendar` do `react-day-picker` com `numberOfMonths={2}` renderiza dois meses lado a lado, com ~280–300px cada = ~580px total. Em viewport 360px o Popover estoura para fora da tela à direita; metade do calendário fica inacessível e o botão "Confirmar" some do viewport.
- **Fix sugerido:** Renderizar `numberOfMonths={1}` em mobile e `{2}` em telas maiores, usando `useIsMobile()` já disponível no projeto:
  ```tsx
  const isMobile = useIsMobile();
  // ...
  <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] p-3" align="start">
    <Calendar ... numberOfMonths={isMobile ? 1 : 2} ... />
  ```

---

### [A-02] `/publicidade` — rodapé da tabela de Campanhas: `flex gap-8` sem wrap causa overflow

- **Página:** `/publicidade`
- **Arquivo:** `src/pages/mercadolivre/MLPublicidade.tsx:702`
- **Severidade:** BLOCKER (dados de resumo da campanha ficam invisíveis em mobile)
- **Evidência:**
  ```tsx
  <div className="border-t border-border/60 bg-muted/20 px-6 py-2.5
                  flex items-center gap-8 text-xs text-muted-foreground">
    <span className="font-semibold text-foreground">{filteredCampaigns.length} campanhas</span>
    <span>Gasto total: <strong ...>{currFmt(...)}</strong></span>
    <span>Impressões: <strong ...>{numFmt(...)}</strong></span>
    <span>Pedidos: <strong ...>{numFmt(...)}</strong></span>
  </div>
  ```
  4 spans com `gap-8` (32px × 3 = 96px em gaps) + `px-6` (48px), sem `flex-wrap`, dentro de um card sem seu próprio `overflow-x-auto`. O div do `overflow-x-auto` (linha 641) só envolve a `<table>`, não o rodapé. Em 360px o conteúdo estoura.
- **Fix sugerido:** Adicionar `flex-wrap` e reduzir o gap no mobile:
  ```tsx
  <div className="... flex flex-wrap items-center gap-x-4 gap-y-1 ...">
  ```

---

### [A-03] `/publicidade` — tabela "Produtos Patrocinados": 15 colunas sem variante mobile

- **Página:** `/publicidade`
- **Arquivo:** `src/pages/mercadolivre/MLPublicidade.tsx:752–879`
- **Severidade:** MAJOR (tabela com 15 colunas requer scroll horizontal extenso em mobile; dados fundamentais como ROAS, ACoS, Estoque ficam atrás de muito scroll)
- **Evidência:**
  ```tsx
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr ...>
          <th>...#...</th><th>...Produto...</th>
          <th>Gasto</th><th>Cliques</th><th>CTR</th>
          <th>Pedidos</th><th>Receita ADS</th><th>ROAS</th>
          <th>CVR</th><th>ACoS</th><th>TACoS</th>
          <th>Margem Líq.</th><th>Share Ads</th><th>ACoS BE</th><th>Estoque</th>
        </tr>
  ```
  15 colunas — cada uma com `px-4 py-2.5 whitespace-nowrap`. Sem variante card mobile. O `overflow-x-auto` previne quebra de layout mas exige scroll lateral extenso para acessar as métricas mais importantes.
- **Fix sugerido:** Criar variante mobile com `isMobile` (padrão do projeto, ver `MLFinanceiro.tsx:751`) mostrando apenas as colunas-chave (Produto, Gasto, ROAS, ACoS, Estoque) em cards compactos. Padrão análogo: `MLFinanceiro.tsx` tabela "Lucro por Produto" (linha 752–775).

---

### [A-04] `/financeiro` — tabelas "Lucro por Marca" (9 colunas) e "Lucro por Estado" sem variante mobile

- **Página:** `/financeiro`
- **Arquivo:** `src/pages/mercadolivre/MLFinanceiro.tsx:923–1089`
- **Severidade:** MAJOR (tabela Marca com 9 colunas exige scroll extenso; sem card mobile ao contrário da tabela de produtos que tem)
- **Evidência:**
  ```tsx
  {/* Lucro por Marca — 9 colunas, overflow-x-auto presente, SEM isMobile check */}
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        {["Marca","Pedidos","Receita","CMV","Comissão","Frete","Impostos","Lucro R$","Lucro %"]}
  ```
  A tabela "Lucro por Produto" (linha 751) usa `isMobile ? <cards> : <table>`. As tabelas de Marca e Estado (linha 922+) não têm a mesma proteção — inconsistência de padrão dentro da mesma página.
- **Fix sugerido:** Aplicar o mesmo padrão `isMobile ? <card variant> : <table>` já usado em linha 751 da mesma página. Para Marca, o card mobile deve mostrar: Marca, Receita, Lucro R$, Lucro %. Para Estado: Estado, Pedidos, Receita, Lucro %.

---

### [A-05] `/financeiro` — gráfico "Composição da Receita" com `margin={{ right: 48 }}` comprime chart em mobile

- **Página:** `/financeiro`
- **Arquivo:** `src/pages/mercadolivre/MLFinanceiro.tsx:489`
- **Severidade:** MAJOR (área útil do gráfico fica com ~130–150px em 360px; barras ficam muito estreitas e ilegíveis)
- **Evidência:**
  ```tsx
  <ComposedChart
    data={chartData}
    margin={{ top: 4, right: 48, left: 0, bottom: 0 }}
  >
    <YAxis yAxisId="brl" ... width={54} />
    <YAxis yAxisId="pct" orientation="right" ... width={40} />
  ```
  Em mobile (360px − 32px padding do card = 328px úteis): eixo esquerdo ocupa 54px + margem direita 48px + eixo direito 40px = 142px consumidos pelas margens/eixos, restando 186px para as barras. Com padding lateral `px-4` do CardContent = 32px adicionais, a área de barras cai para ~154px.
- **Fix sugerido:** Reduzir `right: 48` para `right: 4` em mobile usando `isMobile` (já importado na página), e reduzir `width` dos eixos em mobile:
  ```tsx
  margin={{ top: 4, right: isMobile ? 4 : 48, left: 0, bottom: 0 }}
  ```

---

### [A-06] `/produtos-vendidos` — dual panel: copy "Selecione um grupo **à esquerda**" incorreto em mobile

- **Página:** `/produtos-vendidos`
- **Arquivo:** `src/pages/mercadolivre/MLProdutosVendidos.tsx:209`
- **Severidade:** MINOR (texto confuso em mobile onde o painel esquerdo fica acima, não ao lado)
- **Evidência:**
  ```tsx
  {pvSelected === null
    ? "Selecione um grupo à esquerda"  // ← "à esquerda" só é verdade em lg:
  ```
  O grid usa `grid-cols-1 lg:grid-cols-[320px_1fr]`. Em mobile o card de grupos fica empilhado acima do card de itens. A instrução "à esquerda" é geograficamente incorreta em qualquer viewport abaixo de `lg`.
- **Fix sugerido:**
  ```tsx
  "Selecione um grupo acima"  // ou tornar dinâmico:
  isMobile ? "Selecione um grupo acima" : "Selecione um grupo à esquerda"
  ```

---

### [A-07] `/publicidade` — tabela de Campanhas (10 colunas) exige scroll horizontal extenso em mobile

- **Página:** `/publicidade`
- **Arquivo:** `src/pages/mercadolivre/MLPublicidade.tsx:641–708`
- **Severidade:** MAJOR (10 colunas com `whitespace-nowrap` requerem scroll de ~600–700px para atingir ROAS e ACoS)
- **Evidência:**
  ```tsx
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <!-- Campanha | Status | Orçamento/dia | Gasto | Impressões | Cliques | CTR | Pedidos | ROAS | ACoS -->
  ```
  Sem card mobile variant. O `overflow-x-auto` previne quebra do layout mas o usuário precisa scrollar horizontalmente para ver as métricas de performance (ROAS, ACoS).
- **Fix sugerido:** Criar card mobile mostrando apenas: Nome, Status, Gasto, ROAS. Mesmo padrão de `MLFinanceiro.tsx:751`. Alternativamente, limitar a 4–5 colunas em mobile com uma coluna de "Ver mais" expandível.

---

### [A-08] `/analise-precos` — PopoverContent do seletor de anúncio usa `w-[min(440px,calc(100vw-1.5rem))]`, OK; mas a barra de controles pode empurhar o toggle `ml-auto` para uma linha vazia

- **Página:** `/analise-precos`
- **Arquivo:** `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx:193–253`
- **Severidade:** MINOR (comportamento de layout ligeiramente estranho em 360px; não quebra funcionalidade)
- **Evidência:**
  ```tsx
  <div className="flex flex-wrap items-center gap-2">
    <Popover ...><Button className="... min-w-[220px] max-w-[420px]" ...> </Button></Popover>
    <ToggleGroup ... className="h-8">  {/* Diária/Semanal/Mensal ~120px */}
    <ToggleGroup ... className="h-8 ml-auto">  {/* Qtd/Receita com ml-auto */}
  ```
  Em 360px: Combobox (220px) + gap (8px) + Granularity toggle (~120px) = 348px, excede 360px − 16px padding. Os toggles quebram para a segunda linha. O `ml-auto` no último ToggleGroup no contexto do `flex-wrap` funciona corretamente (empurra ao fim da linha onde estiver), mas pode deixar o toggle de granularidade sozinho em uma linha enquanto o ComboBox fica em outra, gerando aparência desconectada.
- **Fix sugerido:** Agrupar os dois toggles em um único `div` secundário para evitar quebra entre eles:
  ```tsx
  <div className="flex items-center gap-2 ml-auto">
    <ToggleGroup ...> {/* granularity */}
    <ToggleGroup ...> {/* volumeMetric */}
  </div>
  ```

---

### [A-09] `/` (Vendas) — botões "Atualizar" e "Personalizar" perdem label em mobile (`hidden sm:inline`)

- **Página:** `/` (Vendas)
- **Arquivo:** `src/pages/MercadoLivre.tsx:669,679`
- **Severidade:** MINOR (ícones sem label visível; `aria-label` presente, então acessibilidade não é comprometida)
- **Evidência:**
  ```tsx
  <span className="hidden sm:inline">{syncing ? "Atualizando..." : "Atualizar"}</span>
  // e
  <span className="hidden sm:inline">Personalizar</span>
  ```
  Em viewport 360–430px (abaixo de `sm` = 640px) os botões mostram apenas ícone. O `aria-label` existe nos dois botões, então acessibilidade está coberta. A experiência visual porém é de ícone "fantasma" sem contexto visual para usuários novos.
- **Fix sugerido:** Manter o padrão atual (é aceitável — ícone com aria-label é padrão do projeto), mas adicionar `title` como tooltip nativo se a versão desktop já tem o texto: nenhuma mudança obrigatória.

---

### [A-10] `/financeiro` — KPI grid de 8 cards usa `grid-cols-2` em mobile: cards de valor monetário longo truncam

- **Página:** `/financeiro`
- **Arquivo:** `src/pages/mercadolivre/MLFinanceiro.tsx:353`
- **Severidade:** MINOR (valores como "R$ 12.345,67" podem truncar em card de ~160px no grid-cols-2 de 360px)
- **Evidência:**
  ```tsx
  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-3">
  ```
  Em 360px com `gap-3` (12px): cada card = (360 − 16 − 16 − 12) / 2 = ~158px. O `KPICard` com `size="compact"` exibe valores monetários que em valores altos (ex.: "R$ 45.678,90") podem forçar quebra de linha ou truncamento dependendo do `KPICard` interno.
- **Fix sugerido:** Verificar o comportamento de truncamento em `KPICard` com `size="compact"`. Se valores longos quebram, aplicar `text-sm` ou `text-xs` adaptativo, ou usar `grid-cols-1 sm:grid-cols-2` com cards ligeiramente maiores.

---

## Tabela Resumo

| Finding | Página(s) | Severidade |
|---------|-----------|-----------|
| A-01 MLPeriodPicker calendário 2 meses estoura mobile | todas | **BLOCKER** |
| A-02 Campaigns footer `gap-8` sem wrap | /publicidade | **BLOCKER** |
| A-03 Tabela Produtos Patrocinados 15 colunas sem mobile variant | /publicidade | MAJOR |
| A-04 Tabela Lucro por Marca/Estado sem mobile variant | /financeiro | MAJOR |
| A-05 Chart Composição margin `right:48` comprime gráfico | /financeiro | MAJOR |
| A-06 Copy "à esquerda" incorreto em mobile | /produtos-vendidos | MINOR |
| A-07 Tabela Campanhas 10 colunas sem mobile variant | /publicidade | MAJOR |
| A-08 Controles de Análise de Preços quebra estranha no flex-wrap | /analise-precos | MINOR |
| A-09 Botões Atualizar/Personalizar ícone-only em mobile | / (Vendas) | MINOR |
| A-10 KPI 8-cards grid-cols-2 trunca valores longos | /financeiro | MINOR |

---

## Contagem por Severidade

| Severidade | Quantidade |
|-----------|-----------|
| BLOCKER | 2 |
| MAJOR | 4 |
| MINOR | 4 |
| **Total** | **10** |

---

## Notas

- **MLConsultor (`/consultor`):** A spec do audit menciona "abas Insights|Fila|Histórico, ProposeActionDialog, ActionQueue, ActionHistory". Essas features fazem parte da Phase 54 (branch `gsd/phase-54-pipeline-acoes-ui`, PR #19 **não mergeado**). O `MLConsultor.tsx` em produção contém apenas a lista de insights sem abas — sem findings de mobile porque a estrutura atual (cards de insight com `flex-col`, `flex-wrap`) é nativamente responsiva.
- **`/` (Vendas) — Restante da página:** KPI grid (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`) responsivo e adequado. Charts com `ResponsiveContainer` height=220 — aceitável em mobile. Sheet "Personalizar Dashboard" usa `w-[340px] sm:w-[400px]` — em 360px o sheet fica com 340px, que pode cortar ligeiramente em viewports estreitas (340 > 360 − margens). Risco baixo mas observar.
- **Screenshots:** não capturados (sem dev server rodando). Auditoria foi 100% estática.
