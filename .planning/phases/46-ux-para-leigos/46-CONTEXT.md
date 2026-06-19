# Phase 46: UX para Leigos - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Tornar o dashboard compreensível para um lojista sem experiência técnica: cada KPI explica-se em linguagem leiga, cada página sem dados orienta a próxima ação, e as tabelas principais funcionam em mobile (320–768px). Inclui uma revisão de consistência visual (tokens KPI, espaçamentos, dark mode) nas páginas mais usadas.

**Não inclui:** novas páginas, novos KPIs, novas integrações, ou onboarding/tutorial guiado (isso seria outra fase). Apenas clareza e responsividade do que já existe.

</domain>

<decisions>
## Implementation Decisions

### UX-01 — Glossário / tooltip dos KPIs
- **D-01:** Criar um **glossário central** (arquivo único mapeando termo → definição leiga, ex.: `"CFFE" → "o frete que o ML te cobra"`) reutilizado por todos os ~16 pontos que renderizam KPI. Fonte única de verdade, fácil de manter e revisar.
- **D-02:** O gatilho é um **ícone "?" clicável** que funciona tanto em hover (desktop) quanto em clique/tap (mobile/touch). O `KPICard` já possui prop `tooltip` + shadcn Tooltip montado — a tarefa é (a) montar o glossário, (b) adaptar o gatilho para também abrir no clique (touch), (c) ligar o glossário a todos os KPIs.
- **D-03:** As definições devem ser escritas em linguagem de lojista leigo (sem jargão de e-commerce/ML), curtas (1 frase), com exemplo quando ajudar.

### UX-02 — Empty states
- **D-04:** Criar um **componente `<EmptyState>` reutilizável** (ícone + título + instrução de ação específica + botão CTA, ex.: "Conectar Tiny") e substituir os empty states ad-hoc espalhados pelas páginas principais.
- **D-05:** A instrução deve ser **específica por página** ("o que fazer para ter dados aqui", ex.: "Vá em Integrações → conectar Tiny para ver os custos"), não genérica. Reaproveitar a linguagem de ação já produzida pelo Consultor v1 (Fase 45) onde fizer sentido.

### UX-03 — Tabelas em mobile (/anuncios, /pedidos, /financeiro)
- **D-06:** Abaixo de ~768px, as tabelas dessas três páginas viram **lista de cards empilhados** (1 registro = 1 card com pares label:valor). Prioriza legibilidade no celular em vez de scroll horizontal.
- **D-07:** Acima de 768px, mantém o layout de tabela atual. O breakpoint de corte segue o range do critério (320–768px).

### UX-04 — Revisão de consistência visual / dark mode
- **D-08:** Escopo **focado nas 5–6 páginas mais usadas**: /anuncios, /pedidos, /financeiro, /estoque, dashboard ML (vendas) e /precificacao. Auditar e corrigir uso dos tokens `kpi.positive/negative/neutral`, espaçamentos e dark mode sem elementos quebrados. Decisão pragmática para não atrasar a Fase 47 (go-live).
- **D-09:** As demais rotas (~14) ficam fora desta auditoria visual nesta fase — varredura total seria longa demais e pode ser feita pontualmente depois.

### Claude's Discretion
- Implementação concreta do toggle hover/click do tooltip (Radix Popover vs Tooltip controlado) fica a critério do planner/research.
- Estrutura de dados/local do arquivo de glossário (ex.: `src/lib/kpi-glossary.ts` vs JSON) fica a critério da implementação, desde que seja fonte única.
- Redação final das definições leigas de cada KPI — os agentes redigem; Wesley revisa no checkpoint visual.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos e roadmap
- `.planning/REQUIREMENTS.md` — UX-01, UX-02, UX-03, UX-04 (definições e status)
- `.planning/ROADMAP.md` §"Phase 46: UX para Leigos" — goal + 4 success criteria

### Componentes e tokens existentes (reuso obrigatório)
- `src/components/dashboard/KPICard.tsx` — já tem prop `tooltip` + shadcn Tooltip; base para UX-01
- `src/components/ui/tooltip.tsx` — primitivo shadcn/Radix usado hoje (só hover)
- `src/index.css` §`--kpi-positive/negative/neutral` (linhas ~69-71 light, ~131-133 dark) + classes `.kpi-card/.kpi-value/.kpi-label` — tokens para UX-04
- `src/components/mercadolivre/MLKPIGrid.tsx` — grid de KPIs do dashboard ML (um dos principais consumidores do glossário)

### Páginas-alvo (tabelas UX-03 e auditoria UX-04)
- `src/pages/mercadolivre/MLAnuncios.tsx` — /anuncios
- páginas /pedidos e /financeiro (localizar em `src/pages/`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KPICard` com prop `tooltip` e Tooltip shadcn já montado → UX-01 é conteúdo + gatilho touch + wiring, não construção de componente do zero.
- Tokens `--kpi-positive/negative/neutral` já definidos com variantes dark mode → UX-04 é auditoria/aplicação consistente, não criação de tokens.
- Consultor v1 (Fase 45) já gera linguagem de ação acionável → pode alimentar o texto dos empty states (UX-02).

### Established Patterns
- ~16 arquivos renderizam KPIs (KPICard/MLKPIGrid) → o glossário central precisa cobrir todos para consistência.
- Empty states hoje são ad-hoc, espalhados em ≥8 componentes (MLTopProducts, HourlySalesTable, MLSalesAnalytics, etc.) → padronizar com `<EmptyState>`.

### Integration Points
- Glossário liga-se ao KPICard via a prop `tooltip` (string ou key→lookup).
- `<EmptyState>` substitui blocos condicionais "sem dados" existentes nas páginas principais.

</code_context>

<specifics>
## Specific Ideas

- Exemplo de definição leiga citado no próprio critério: `"CFFE = o frete que o ML te cobra"` — esse é o tom desejado para todo o glossário.
- Breakpoint mobile alvo explícito: 320–768px.

</specifics>

<deferred>
## Deferred Ideas

- Onboarding/tutorial guiado para primeiro acesso — fora do escopo desta fase (clareza de UI ≠ tour guiado).
- Auditoria visual das ~14 rotas restantes — pode virar tarefa pontual após go-live.

None bloqueante — discussão permaneceu dentro do escopo da fase.

</deferred>

---

*Phase: 46-UX para Leigos*
*Context gathered: 2026-06-17*
