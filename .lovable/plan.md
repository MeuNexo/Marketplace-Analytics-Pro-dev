## Objetivo

Unificar a aba **Histórico** dentro de **Análise** e alinhar todo o módulo de Precificação (Simulador / Análise) ao padrão visual usado nas outras páginas ML (Anúncios, Fiscal, Estoque): seletor de abas igual ao restante, cards com `CardHeader` padrão (`text-sm font-medium text-foreground`, sem ícones), filtros de período com `MLPeriodPicker`, busca de produto compacta, badges e tabela seguindo `bg-muted` hovers + cores semânticas.

## Mudanças

### 1. Tabs do Simulador/Análise/Histórico → Simulador/Análise
- `src/pages/mercadolivre/MLPrecificacao.tsx`: remover a tab `historico` (e a `lazy` de `HistoricoComparativo`). Ficam apenas `Simulador` e `Análise`.
- Manter o seletor de tabs em pill (já é o padrão usado em Vendas/Relatórios), só revisando classes para casar exatamente com o de `MLAnuncios` (mesma altura `h-8`, mesmo `rounded-md bg-muted p-1`).

### 2. AnaliseDashboard absorve Histórico
- `AnaliseDashboard.tsx` passa a renderizar, abaixo dos resultados, um bloco "Histórico do produto" usando o conteúdo que vinha de `HistoricoComparativo`:
  - Reusa a tabela `HistoricoSnapshotTable` com seleção de até 2 snapshots.
  - Mostra `HistoricoComparacaoPanel` quando 2 estão marcados.
  - Como o produto já está selecionado no topo da página, o seletor duplicado de produto do antigo `HistoricoComparativo` é removido — a tabela usa o mesmo `itemId` da Análise.
- Arquivo `HistoricoComparativo.tsx` é removido (seu seletor de produto duplicado some). Os componentes filhos (`HistoricoSnapshotTable`, `HistoricoComparacaoPanel`) continuam.

### 3. Datas → `MLPeriodPicker`
Substituir os dois `<Input type="date">` por um único `MLPeriodPicker` integrado com `useMLFilters`, igual ao padrão de `MLAnuncios` / `MLEstoque`:
- Default 30 dias.
- `periodLabel` mostra "Últimos 30 dias", "Hoje", custom range etc.
- Botão "Analisar" passa a usar `currentFrom` / `currentTo` do hook.

### 4. Busca de produto compacta
Padrão atual (Popover + Command full-width altura `h-10`, label "Produto" em cima) substituído por trigger compacto `h-8` no mesmo nível dos demais controles do header do card, igual aos selectores em `MLAnuncios`:
- Trigger: `<Button variant="outline" size="sm" className="h-8 ...">` com ícone `Search` 3.5×3.5 e placeholder "Buscar produto…".
- Quando há produto, mostra chip compacto com thumb + título truncado + `×`, altura `h-8`.

### 5. Card header padrão
Todos os cards de Análise (`Análise de Elasticidade`, `Recomendações de Compra`, `Comparação`, tabela `AnalisePrecosTable`) recebem:
```tsx
<CardHeader className="pb-3">
  <CardTitle className="text-sm font-medium text-foreground">Título</CardTitle>
</CardHeader>
```
- Remove `px-4 pt-3 pb-2` ad-hoc; usa o default do design system (memória `card-headers-standardization`).
- Sem ícones em títulos de cards (memória core).
- Os controles que hoje vivem no `CardContent` (datas, multiplicador) movem para o lado direito do `CardHeader` com `flex items-center justify-between`.

### 6. AnalysisProductCard — alinhar com KPI/info-card pattern
- Substitui as faixas `border-l-4 border-l-emerald-500` por tokens semânticos (`bg-emerald-500/10 border-emerald-500/20`) e tipografia consistente: rótulo `text-[11px] uppercase tracking-wide text-muted-foreground`, valor `text-base font-semibold tabular-nums text-foreground` (a cor segue o badge, não o texto inteiro — fica mais sóbrio).
- Badge de elasticidade já usa `ELASTICITY_BADGE` (ok), mantém.

### 7. AnalisePrecosTable
- Header da tabela com `bg-muted/40` (padrão das outras tabelas).
- `TableRow` com hover `bg-muted/50`.
- Select de estratégia: `h-8 w-[120px] text-xs` (igual aos selects de outras tabelas).
- Mantém destaque colorido da célula da estratégia escolhida.

### 8. CompraRecomendadaPanel
- Header padronizado (item 5), com o `Select` de multiplicador no canto direito do header.
- Linha de produto: trocar grid 12-col arbitrário por `flex flex-wrap items-end gap-3` para casar com o estilo dos filtros do app.
- Labels `text-xs text-muted-foreground`, inputs `h-8 text-xs w-[110px]`.
- Outputs com badge colorido em vez de texto colorido solto.

### 9. HistoricoComparacaoPanel
- Header padronizado.
- Grid de comparação mantém estrutura, apenas substitui `text-emerald-600`/`text-red-600` por tokens (`text-success` / `text-destructive` se existirem; senão mantém — já são padrão do app conforme memória).

## Fora de escopo
- Lógica de cálculo (`engine.ts`, `calculator.ts`) intocada.
- Schema / hooks de dados intocados.
- Simulador (`SimuladorPrecificacao.tsx`) intocado — já segue o padrão.

## Arquivos tocados
- `src/pages/mercadolivre/MLPrecificacao.tsx` (remove tab histórico)
- `src/components/mercadolivre/analise/AnaliseDashboard.tsx` (período, busca, header, embute histórico)
- `src/components/mercadolivre/analise/AnalysisProductCard.tsx` (padrão visual)
- `src/components/mercadolivre/analise/AnalisePrecosTable.tsx` (header/hover)
- `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx` (header + filtros)
- `src/components/mercadolivre/analise/HistoricoComparacaoPanel.tsx` (header)
- `src/components/mercadolivre/analise/HistoricoSnapshotTable.tsx` (hover/header)
- **Deletado**: `src/components/mercadolivre/analise/HistoricoComparativo.tsx`
