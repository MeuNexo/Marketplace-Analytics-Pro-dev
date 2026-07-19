# Phase 102: Simulador manual de MCO na página /analise-precos - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

O card "Detalhamento de MCO" entregue na Phase 101 (`PrecoPraticadoReport.tsx`) já mostra o waterfall real por unidade (receita → CMV → comissão → frete → impostos → MC → ads → MCO), o semáforo de saúde (`mcoHealth.ts`) e a recomendação sempre visível (preço mínimo + ACOS-alvo) calculada a partir da Meta MCO% (padrão ou customizada por item, `ml_mco_targets`).

Esta phase adiciona um **modo de simulação manual ("e se")** dentro desse mesmo card: o usuário liga um toggle "Simular", os campos do waterfall passam a ser editáveis (preço, CMV, comissão%, frete, impostos%, ads) e o MC/un, MCO/un e o semáforo recalculam em tempo real com base nos valores digitados — sem nenhuma persistência em banco. É puramente client-side, efêmero, e reseta quando o usuário desliga o toggle, clica em "Resetar" ou troca de anúncio/variação no seletor.

**Fora de escopo:** persistir simulações (não é uma "versão de cenário" salva); mudar a fórmula de MCO (`src/lib/mco.ts` continua a fonte da verdade); recalcular a recomendação (preço mínimo/ACOS-alvo) em cima dos valores simulados — essas duas linhas continuam ancoradas na Meta MCO% e nos custos reais, não no que está sendo simulado; qualquer edição de custo "de verdade" do produto (isso é a página `/precos-custos`, não esta).

</domain>

<decisions>
## Implementation Decisions

### Campos editáveis
- **D-01:** Todos os campos do waterfall são editáveis durante a simulação: preço/un, CMV/un, comissão%, frete/un, impostos%, ads/un (ads só aparece se o toggle "incluir ads" da Phase 79 estiver ligado, mesma regra já usada no card real).

### Onde e como ativar
- **D-02:** O simulador vive **dentro do mesmo card fixo** da Phase 101 (não é uma seção nova nem uma página separada). Um toggle "Simular" liga o modo edição diretamente nos campos do waterfall existente. Desligado = mostra os valores reais (comportamento atual da Phase 101, intocado). Ligado = cada linha do waterfall vira um campo editável.

### Reset
- **D-03:** Existe um botão "Resetar" explícito que volta todos os campos aos valores reais correntes. Além disso, **trocar de item/variação no seletor sempre reseta a simulação automaticamente** (evita o usuário confundir simulação de um anúncio com os valores exibidos de outro).

### Recálculo em cascata
- **D-04:** Com o modo Simular ligado, o **semáforo de saúde e o MC/MCO recalculam com os valores simulados** (o usuário vê o impacto completo, inclusive o semáforo mudando de cor). As **duas linhas de recomendação (preço mínimo e ACOS-alvo) continuam calculadas sobre a Meta MCO% e os custos/preço REAIS** — não fazem sentido recalculadas sobre um preço que já está sendo simulado (seria circular). Ou seja: waterfall + semáforo = dinâmico com a simulação; recomendação = âncora fixa de referência.

### Validação
- **D-05:** Os campos simulados seguem o **mesmo padrão de validação já usado no campo Meta MCO%** da Phase 101 (toast de erro via `sonner`, rejeita valor inválido e mantém o anterior): preço/CMV/frete/ads ≥ 0; comissão%/impostos% entre 0 e 100.

### Claude's Discretion
- Layout exato dos inputs (inline no lugar do valor atual da linha, vs. campo ao lado) — seguir o padrão de edição inline já usado no card (Meta MCO%) e em `MLAnuncios.tsx` (`InlineEditCell`).
- Texto/copy exato do toggle, botão Resetar e labels de campo editável.
- Formato de input (texto formatado em R$/% vs. número puro com máscara) — usar o padrão já validado no campo Meta MCO% da Phase 101.
- Comportamento de foco/teclado (Tab entre campos, Enter confirma) — seguir convenção de formulários já usada no projeto (react-hook-form onde aplicável).
- Indicação visual de "isto é uma simulação" (badge, cor de fundo diferente, ícone) para não confundir com os dados reais — importante para não o usuário achar que gravou algo.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 101 (base direta desta phase)
- `.planning/phases/101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis/101-CONTEXT.md` — decisões da Phase 101 (card fixo, waterfall por unidade, meta customizável, recomendação sempre visível).
- `.planning/phases/101-detalhamento-de-mco-e-recomenda-o-de-margem-na-p-gina-analis/101-01-PLAN.md`, `101-02-PLAN.md`, `101-03-PLAN.md` — como o card foi construído (migration `ml_mco_targets`, `computeWaterfallCard`, `computeMcoRecommendation`, `useMcoTargets`, UI em `PrecoPraticadoReport.tsx`).

### Componente e utils a estender
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente principal; o toggle "Simular" e os inputs entram no card "Detalhamento de MCO" já existente.
- `src/lib/precoMcoSeries.ts` — `WaterfallCard` interface + `computeWaterfallCard()` (Phase 101); a simulação deve reusar essa função recalculando com os inputs simulados como override, não duplicar a lógica de cálculo.
- `src/lib/pricing/mcoRecommendation.ts` — `computeMcoRecommendation()` (Phase 101); permanece calculado sobre os valores REAIS mesmo durante a simulação (D-04).

### MCO — fórmula e faixas (reutilizar, não recriar)
- `src/lib/mco.ts` — `computeMco`, fórmula canônica. Fonte da verdade — a simulação chama a MESMA função, só com inputs diferentes.
- `src/lib/mcoHealth.ts` — `MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole` — reusar para recolorir o semáforo com o MCO simulado.

### Padrão de edição inline a reusar
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — campo "Meta MCO%" (Phase 101, D-06) já implementa click-to-edit + validação + toast de erro; é o modelo mais próximo pro padrão de validação (D-05).
- `src/components/mercadolivre/MLAnuncios.tsx` — `InlineEditCell` — outro padrão de edição inline já existente no projeto (referenciado em `101-RESEARCH.md`).

### Backend
- **Nenhum backend novo.** Toda a simulação é client-side/efêmera — sem tabela, sem RPC, sem persistência. Se o planner identificar necessidade de gravar algo, isso quebra D-01-a-D-05 e deve ser sinalizado para revisão de escopo, não implementado silenciosamente.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeWaterfallCard()` (`src/lib/precoMcoSeries.ts`, Phase 101) — já calcula as 12 linhas do waterfall a partir de `rows` + `opts`; a simulação precisa de uma forma de sobrepor um subconjunto desses inputs (preço/CMV/comissão/frete/impostos/ads) antes de rodar o mesmo cálculo, mantendo `computeMco` como única fonte de verdade.
- `mcoHealth.ts` (`classifyMcoHealth`, `mcoHealthRole`) — já usado para o semáforo real; reusar exatamente para o semáforo simulado.
- Padrão de validação inline com `sonner` toast já implementado no campo Meta MCO% (Phase 101) — replicar para cada campo simulado.

### Established Patterns
- Card é single-item (segue o seletor de anúncio/variação existente) — a simulação também é single-item, sem comparação entre simulações de itens diferentes.
- Toggle "incluir ads" (Phase 79) já existe e é respeitado pelo card de detalhamento — a simulação de ads só faz sentido/aparece quando esse toggle está ligado.

### Integration Points
- O toggle "Simular" e os inputs entram dentro do MESMO componente `PrecoPraticadoReport.tsx`, no mesmo card da Phase 101 — não é um componente novo separado.
- Resetar automaticamente ao trocar `selectedId`/`selectedSku` (mesmo padrão de estado já usado pelo componente para outras interações dependentes do item selecionado).

</code_context>

<specifics>
## Specific Ideas

- "Simular" como um switch/toggle no topo do card de detalhamento, ao lado do título "Detalhamento de MCO".
- Cada linha do waterfall, quando em modo simulação, mostra o valor real riscado/esmaecido ao lado do campo editável (opcional, à discrição do Claude) — ou simplesmente substitui o valor pelo campo editável com um indicador visual claro de que é simulação (badge "Simulando").
- Preço mínimo recomendado e ACOS-alvo continuam fixos como referência — o usuário compara visualmente "estou simulando X, a meta pede Y".

</specifics>

<deferred>
## Deferred Ideas

- Salvar/nomear cenários de simulação (ex: "Cenário A", "Cenário B") para comparar depois — fora de escopo, simulação é sempre efêmera e single-slot nesta phase.
- Comparação lado a lado entre múltiplos itens simulados simultaneamente — mantido fora de escopo (mesma decisão da Phase 101 de página single-item).
- Recalcular a recomendação (preço mínimo/ACOS-alvo) em cima dos valores simulados — decidido explicitamente como fora de escopo (D-04): geraria referência circular/confusa.

### Reviewed Todos (not folded)
None — discussão não cruzou com todos pendentes.

</deferred>

---

*Phase: 102-simulador-manual-de-mco-na-p-gina-analise-precos-permitir-qu*
*Context gathered: 2026-07-19*
