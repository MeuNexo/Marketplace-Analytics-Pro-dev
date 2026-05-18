## Problema

Quando várias variações são selecionadas, os chips se acumulam ao lado do seletor de período e do botão Analisar, embaralhando os controles e quebrando o cabeçalho do card em várias linhas.

## Solução

Separar **controles** (busca, período, analisar) dos **itens selecionados** (chips), em duas linhas independentes e enxutas.

### Layout proposto

```text
┌─ Card ──────────────────────────────────────────────────────────────┐
│  Análise de Elasticidade     [+ Adicionar produto] [Período] [Analisar] │
│  ──────────────────────────────────────────────────────────────────  │
│  3 variações  •  [chip 1 ×] [chip 2 ×] [chip 3 ×]          Limpar    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Linha 1 (header)**: título à esquerda; controles à direita — botão "Adicionar produto" (largura fixa pequena quando há seleção, larga `w-[320px]` quando vazio), seletor de período, botão Analisar. Sem chips aqui.
- **Linha 2 (faixa de seleção)**: aparece só quando há produtos selecionados. Contador discreto à esquerda (`text-xs text-muted-foreground` — ex.: "3 variações selecionadas"), chips em `flex-wrap` com `gap-1.5`, botão "Limpar" alinhado à direita.
- Separador sutil (`border-t border-border/60`) entre as duas linhas.

### Refinamento dos chips

- Tamanho menor: `h-7` (em vez de `h-8`), `text-[11px]`, thumb `w-4 h-4`, título truncado em `max-w-[140px]`.
- Hover discreto no botão `×` (`hover:bg-muted`).
- Entrada animada com `animate-fade-in` (utilitário já disponível em `tailwind.config.ts`); saída instantânea para evitar reflow brusco.

### Estado vazio

- Mantém o `CardContent` atual com a frase de ajuda; sem faixa de chips.

## Mudanças no código

Apenas em `src/components/mercadolivre/analise/AnaliseDashboard.tsx`:

1. Remover os chips de dentro da `div` de controles (linha 1).
2. Substituir o botão `Limpar` da linha 1 — ele migra para a linha 2.
3. Logo após `</CardHeader>`, antes do bloco `!hasSelection`, inserir um novo bloco condicional `hasSelection && (...)`:
   - `<div className="px-6 py-2.5 border-t border-border/60 flex items-center gap-3 flex-wrap">`
   - contador + chips (`flex-wrap gap-1.5`) + botão `Limpar` à direita.
4. Aplicar `animate-fade-in` aos chips.

Sem mudanças em hooks, dados, schema ou outros componentes.
