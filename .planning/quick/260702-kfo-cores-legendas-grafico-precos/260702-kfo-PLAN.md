---
phase: quick-260702-kfo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/index.css
  - src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
autonomous: true
requirements: [KFO-CORES-01]
must_haves:
  truths:
    - "As 3 linhas do gráfico principal (Preço, Break-even, MCO %) têm cores distintas e nítidas em light e dark"
    - "A legenda lista 5 itens separados (3 linhas + 2 bandas) em vez de 1 item verboso"
    - "O tooltip mostra um chip de cor ao lado de Preço, Break-even e MCO % que casa com a cor da linha no gráfico"
    - "Nenhuma lógica de dados muda: vitest continua verde e o build é limpo"
  artifacts:
    - path: "src/index.css"
      provides: "Tokens --chart-price / --chart-breakeven / --chart-mco em :root e .dark"
      contains: "--chart-price"
    - path: "src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx"
      provides: "Linhas, legenda e tooltip recoloridos usando os novos tokens de gráfico"
      contains: "--chart-price"
  key_links:
    - from: "src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx"
      to: "src/index.css"
      via: "hsl(var(--chart-price)) / --chart-breakeven / --chart-mco no stroke das <Line> e no payload da <Legend>"
      pattern: "hsl\\(var\\(--chart-(price|breakeven|mco)\\)\\)"
---

<objective>
Corrigir o problema relatado pelo Wesley na página `/analise-precos` ("coisas com a mesma cor, nada nítido"): as 3 linhas do ComposedChart em `PrecoPraticadoReport.tsx` hoje compartilham o hue 217 (Preço=--accent, Break-even=--muted-foreground que é a própria cor do grid/ticks, MCO%=--primary que é quase preto). Além disso a legenda tem 1 item único verboso para as 2 bandas.

Aplicar a paleta de gráfico já validada (CVD/contraste em light e dark, LOCKED): azul para Preço, laranja para Break-even, violeta para MCO %. Introduzir tokens de tema dedicados, recolorir as linhas, expandir a legenda para 5 itens nítidos e adicionar chips de cor no tooltip para casar com o gráfico.

Purpose: Deixar o gráfico de análise de preços legível — cada série identificável por cor distinta em light e dark, legenda clara e tooltip que casa com as linhas.
Output: `src/index.css` com 3 tokens novos (em `:root` e `.dark`); `PrecoPraticadoReport.tsx` com linhas/legenda/tooltip/eixo recoloridos. Zero mudança de lógica ou dados.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@src/index.css
@src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx

Notas de contexto (já verificadas — não re-investigar):
- Textos de UI em português brasileiro.
- Não trocar de branch (atual: `gsd/phase-79-analise-precos-mco`).
- Tokens de tema no formato HSL sem `hsl(...)` (ex.: `--accent: 217 70% 45%;`), consumidos como `hsl(var(--token))`.
- Em `src/index.css`: `:root` contém `--success: 142 70% 45%;` e `--destructive: 0 72% 51%;`; `.dark` contém `--success: 142 70% 40%;` e `--destructive: 0 62% 40%;`. As bandas do gráfico usam `hsl(var(--success))` (verde) e `hsl(var(--destructive))` (vermelho).
- No componente: a `<Legend>` usa `payload` explícito (~linha 487-496); as 3 `<Line>` estão em ~518-531; o `ChartTooltip` (com o sub-componente `Row`) está em ~78-119; os `<YAxis>` `preco` (esquerdo) e `mco` (direito) estão em ~473-482.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Adicionar tokens de cor de gráfico em src/index.css</name>
  <files>src/index.css</files>
  <action>
  No bloco `:root`, junto aos demais tokens semânticos (perto de `--accent`/`--success`), adicionar três tokens de gráfico com EXATAMENTE estes valores (paleta LOCKED, validada CVD/contraste):
  - `--chart-price: 217 70% 45%;`   (azul — Preço praticado)
  - `--chart-breakeven: 21 90% 48%;`  (laranja — Break-even)
  - `--chart-mco: 262 83% 58%;`   (violeta — MCO %)

  No bloco `.dark`, adicionar os mesmos três tokens com os valores de dark (LOCKED):
  - `--chart-price: 217 65% 54%;`
  - `--chart-breakeven: 21 90% 48%;`
  - `--chart-mco: 260 100% 71%;`

  Manter o mesmo estilo/indentação dos tokens vizinhos. Não alterar nenhum token existente (accent, primary, muted-foreground, success, destructive continuam intactos).
  </action>
  <verify>
    <automated>grep -c -- '--chart-price\|--chart-breakeven\|--chart-mco' src/index.css</automated>
  </verify>
  <done>Os 3 tokens existem tanto em `:root` quanto em `.dark` (6 declarações no total), com os valores LOCKED; nenhum token pré-existente foi modificado.</done>
</task>

<task type="auto">
  <name>Task 2: Recolorir linhas, legenda, tooltip e eixo em PrecoPraticadoReport.tsx</name>
  <files>src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx</files>
  <action>
  Aplicar SOMENTE mudanças de apresentação no gráfico principal (ComposedChart). Não mexer na lógica, nos hooks, nos KPIs, no gráfico de barras B, nem nas bandas/Areas (o conflito de cor com MCO% some ao trocar MCO% para violeta).

  1) Linhas (`<Line>`):
     - "Preço praticado" (`dataKey="precoUnit"`): trocar `stroke="hsl(var(--accent))"` por `stroke="hsl(var(--chart-price))"`, e a cor do `dot` (`fill`) de `hsl(var(--accent))` para `hsl(var(--chart-price))`. Manter `strokeWidth`, `activeDot` e `type` como estão.
     - "Break-even" (`dataKey="breakevenUnit"`): trocar `stroke="hsl(var(--muted-foreground))"` por `stroke="hsl(var(--chart-breakeven))"`; aumentar `strokeWidth` de 1.5 para 2; manter `strokeDasharray="5 4"` e `dot={false}`.
     - "MCO %" (`dataKey="mcoPct"`): trocar `stroke="hsl(var(--primary))"` por `stroke="hsl(var(--chart-mco))"`; manter `strokeWidth={2}` e o resto.

  2) Legenda (`<Legend payload={[...]}>`): substituir o array atual (que tem o item único "Margem (verde=positiva, vermelho=negativa)") por 5 itens nítidos, nesta ordem:
     - `{ value: "Preço praticado", type: "line", id: "precoUnit", color: "hsl(var(--chart-price))" }`
     - `{ value: "Break-even", type: "line", id: "breakevenUnit", color: "hsl(var(--chart-breakeven))" }`
     - `{ value: "MCO %", type: "line", id: "mcoPct", color: "hsl(var(--chart-mco))" }`
     - `{ value: "Margem positiva", type: "rect", id: "gainBand", color: "hsl(var(--success))" }`
     - `{ value: "Margem negativa", type: "rect", id: "lossBand", color: "hsl(var(--destructive))" }`

  3) Tooltip (`ChartTooltip` / sub-componente `Row`): adicionar um chip de cor (um `<span>` redondo pequeno, ex.: classes `inline-block w-2 h-2 rounded-full shrink-0` com `style={{ backgroundColor: <cor> }}`) imediatamente antes do rótulo `k` das 3 séries de linha — as linhas "Preço", "Break-even" e "MCO %". Passar a cor via uma prop opcional nova no `Row` (ex.: `dotColor?: string`) que, quando presente, renderiza o chip dentro do `<span className="text-muted-foreground">` antes do texto. Cores: Preço → `hsl(var(--chart-price))`, Break-even → `hsl(var(--chart-breakeven))`, MCO % → `hsl(var(--chart-mco))`. As linhas de decomposição "Por unidade" (Custo, Comissão, Frete, Ads, Imposto) e "Unidades"/"MCO R$/un" ficam SEM chip (inalteradas).

  4) Eixo direito (`<YAxis yAxisId="mco" ...>`): colorir levemente os ticks com a cor do MCO% — trocar `tick={{ fill: "hsl(var(--muted-foreground))" }}` por `tick={{ fill: "hsl(var(--chart-mco))" }}` APENAS no YAxis `mco` (direito). O YAxis `preco` (esquerdo) e o XAxis mantêm `hsl(var(--muted-foreground))`.

  Português brasileiro em todos os rótulos. Não introduzir novas dependências. Não tocar no `BarTooltip`, no `<Bar>`, nas `<Area>` das bandas nem no rodapé de transparência (o texto do rodapé pode permanecer como está).
  </action>
  <verify>
    <automated>grep -c 'hsl(var(--chart-price))\|hsl(var(--chart-breakeven))\|hsl(var(--chart-mco))' src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx && npx vitest run 2>&1 | tail -5 && npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>As 3 linhas usam os tokens `--chart-*`; a legenda tem 5 itens (Preço praticado, Break-even, MCO %, Margem positiva, Margem negativa); o tooltip mostra chip de cor nas 3 séries de linha; o eixo direito usa a cor do MCO%; `npx vitest run` continua 334/334 e `npm run build` limpo.</done>
</task>

</tasks>

<verification>
- `grep` confirma os 3 tokens em `src/index.css` (6 declarações: 3 em `:root`, 3 em `.dark`).
- `grep` confirma uso de `hsl(var(--chart-price|breakeven|mco))` em `PrecoPraticadoReport.tsx`.
- `npx vitest run` permanece 334/334 (nenhuma mudança de lógica/dados).
- `npm run build` conclui sem erros de TypeScript/Vite.
- Verificação visual (Wesley, no preview): as 3 linhas ficam nitidamente azul/laranja/violeta em light e dark; legenda com 5 itens; tooltip com chips que casam com as linhas.
</verification>

<success_criteria>
- Preço praticado = azul (`--chart-price`), Break-even = laranja tracejado (`--chart-breakeven`, strokeWidth 2), MCO % = violeta (`--chart-mco`) — distintos em light e dark.
- Legenda substituída por 5 itens nítidos; item verboso único removido.
- Tooltip com chip de cor nas 3 séries de linha, casando com o gráfico; eixo direito ancorado na cor do MCO%.
- Nenhuma mudança de dados/lógica; vitest 334/334 e build limpo.
</success_criteria>

<output>
Create `.planning/quick/260702-kfo-cores-legendas-grafico-precos/260702-kfo-SUMMARY.md` when done
</output>
