---
phase: 46-ux-para-leigos
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/kpi-glossary.ts
  - src/components/dashboard/KPICard.tsx
  - src/components/ui/empty-state.tsx
autonomous: true
requirements: [UX-01, UX-02]
user_setup: []

must_haves:
  truths:
    - "O glossário central existe como fonte única e exporta ~26 termos de KPI tipados (D-01)."
    - "Tocar (tap) no ícone '?' de um KPICard num viewport de 375px abre o popover com a definição leiga (D-02)."
    - "Passar o mouse (hover) sobre o '?' num desktop abre o mesmo popover (D-02)."
    - "O componente <EmptyState> renderiza ícone + título + descrição + CTA opcional e é reutilizável (D-04)."
  artifacts:
    - path: "src/lib/kpi-glossary.ts"
      provides: "Glossário central: tipos GlossaryKey/GlossaryEntry + Record KPI_GLOSSARY"
      exports: ["GlossaryKey", "GlossaryEntry", "KPI_GLOSSARY"]
      min_lines: 90
    - path: "src/components/ui/empty-state.tsx"
      provides: "Componente EmptyState reutilizável (icon/title/description/action)"
      exports: ["EmptyState"]
      min_lines: 30
    - path: "src/components/dashboard/KPICard.tsx"
      provides: "Gatilho '?' híbrido hover+tap via Radix Popover controlado"
      contains: "Popover"
  key_links:
    - from: "src/components/dashboard/KPICard.tsx"
      to: "@/components/ui/popover"
      via: "import Popover/PopoverTrigger/PopoverContent"
      pattern: "from \"@/components/ui/popover\""
    - from: "src/components/ui/empty-state.tsx"
      to: "@/components/ui/button"
      via: "Button asChild + react-router Link para o CTA"
      pattern: "from \"@/components/ui/button\""
---

<objective>
Construir os três primitivos compartilhados que todo o restante da Fase 46 consome: (1) o glossário central de KPIs como fonte única de verdade (D-01), (2) o gatilho "?" híbrido hover+tap no KPICard via Radix Popover controlado (D-02), e (3) o componente `<EmptyState>` reutilizável (D-04).

Esta fase é 100% conteúdo + wiring de UI — nenhum dado novo, nenhuma chamada de rede, nenhuma dependência nova. Todos os primitivos Radix (Popover, Button) já estão instalados no projeto.

Purpose: Sem estes três artefatos, os planos 02 e 03 não podem ligar o glossário aos ~16 sites de KPI nem padronizar os ~8 empty states ad-hoc. Este plano define os contratos (tipos exportados + props) que os consumidores recebem prontos.
Output: `src/lib/kpi-glossary.ts` (novo), `src/components/ui/empty-state.tsx` (novo), `src/components/dashboard/KPICard.tsx` (modificado: Tooltip → Popover híbrido).
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/46-ux-para-leigos/46-CONTEXT.md
@.planning/phases/46-ux-para-leigos/46-RESEARCH.md
@.planning/phases/46-ux-para-leigos/46-PATTERNS.md

# Primitivos reusados (ler antes de implementar)
@src/components/dashboard/KPICard.tsx
@src/components/ui/popover.tsx
@src/components/ui/card.tsx
@src/components/ui/button.tsx
@src/lib/utils.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Criar o glossário central de KPIs (UX-01, D-01/D-03)</name>
  <files>src/lib/kpi-glossary.ts</files>
  <read_first>
    - RESEARCH.md §"Pattern 2: Glossário central" — contém os ~26 rascunhos de definição já redigidos (receita_total, cffe, comissao_ml, cfonpn, cmv, impostos, markup, custo_operacional, ticket_medio, conversao, visitas, compradores, unidades_vendidas, pedidos, receita_bruta, receita_liquida, lucro_bruto, publicidade, roas, acos, tacos, cobertura, ruptura, margem_bruta, margem_liquida, margem_operacional, margem_pos_ads).
    - PATTERNS.md §"src/lib/kpi-glossary.ts" — analog src/lib/utils.ts: named exports, sem default export, tipos no topo.
    - src/lib/utils.ts — padrão de módulo lib do projeto.
  </read_first>
  <action>
    Criar `src/lib/kpi-glossary.ts` como módulo TypeScript puro (named exports, sem default export), per D-01 (fonte única de verdade). Exportar três símbolos: o union type `GlossaryKey` (as ~26 chaves listadas em RESEARCH.md §Pattern 2), a interface `GlossaryEntry` ({ term: string; definition: string; example?: string }), e o `Record<GlossaryKey, GlossaryEntry>` chamado `KPI_GLOSSARY`. Copiar as definições rascunhadas em RESEARCH.md §Pattern 2 como ponto de partida — elas já seguem o tom leigo exigido por D-03 ("CFFE = o frete que o ML te cobra", 1 frase, exemplo quando ajuda). O Record DEVE cobrir todas as chaves do union type (o TypeScript falha se faltar alguma). Não inventar termos fora da lista de RESEARCH; não adicionar lógica de runtime. A redação final será revisada por Wesley no checkpoint do plano 04 (D-03: agentes redigem, Wesley revisa) — entregar o melhor texto leigo possível agora.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "kpi-glossary" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i kpi-glossary)" && grep -q "export const KPI_GLOSSARY" src/lib/kpi-glossary.ts && grep -q "export type GlossaryKey" src/lib/kpi-glossary.ts && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/kpi-glossary.ts` exporta `GlossaryKey`, `GlossaryEntry` e `KPI_GLOSSARY`.
    - O Record cobre TODAS as chaves do union `GlossaryKey` sem erro de tipo (tsc passa).
    - Toda definição está em 1 frase, linguagem de lojista leigo, sem jargão ML não explicado (D-03).
    - Nenhum default export; nenhuma dependência de runtime além de tipos.
  </acceptance_criteria>
  <done>O glossário compila sem erro de tipo e exporta os três símbolos; todas as definições em linguagem leiga.</done>
</task>

<task type="auto">
  <name>Task 2: Trocar o gatilho do KPICard de Tooltip hover-only para Popover híbrido hover+tap (UX-01, D-02)</name>
  <files>src/components/dashboard/KPICard.tsx</files>
  <read_first>
    - src/components/dashboard/KPICard.tsx — bloco atual `tooltip && (<TooltipProvider><Tooltip>...)` (≈ linhas 94-106) e import de Tooltip (linha 5); import de `Info` (linha 1).
    - RESEARCH.md §"Pattern 1: Tooltip hover+tap" + §"Code Examples" — bloco Popover completo já redigido (estado useState, onMouseEnter/onMouseLeave + onClick, PopoverContent com className override).
    - PATTERNS.md §"KPICard.tsx" — instruções cirúrgicas: o que remover/adicionar, e a nota do `w-72` default do PopoverContent.
    - Pitfall 1 (Radix Tooltip não dispara em touch) e Pitfall 4 (PopoverContent w-72) em RESEARCH.md §Common Pitfalls.
  </read_first>
  <action>
    Substituir o bloco `<TooltipProvider><Tooltip>...` (≈ linhas 94-106) por um `<Popover>` controlado via `useState(false)`, conforme RESEARCH.md §Code Examples. O gatilho é um `<button type="button">` com ícone `HelpCircle` (lucide-react) que abre no `onMouseEnter` e fecha no `onMouseLeave` (desktop) E alterna no `onClick` com `e.stopPropagation()` (touch/tap) — isto satisfaz D-02 (hover desktop + tap mobile). Motivo do Popover em vez de Tooltip controlado: Radix Tooltip não dispara em touch (Pitfall 1) — decisão de Claude's Discretion já resolvida na pesquisa a favor de Popover. No `<PopoverContent>` SEMPRE passar `className="w-auto max-w-[240px] px-3 py-2 text-xs"` para sobrescrever o `w-72` default (Pitfall 4), e `onOpenAutoFocus={(e) => e.preventDefault()}` para não roubar foco. Adicionar imports: `useState` (react), `Popover/PopoverContent/PopoverTrigger` (@/components/ui/popover), `HelpCircle` (lucide-react). Remover o import de Tooltip da linha 5. Manter `Info` importado SOMENTE se ainda for usado em outro ponto do arquivo (grep antes de remover); se não for, remover do import. A prop `tooltip?: string` da interface NÃO muda — o KPICard permanece genérico (recebe string pronta; o lookup do glossário fica nos consumidores, conforme RESEARCH §Pattern 2). O `<TooltipProvider>` global em App.tsx não é afetado.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "KPICard" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i KPICard)" && grep -q "Popover" src/components/dashboard/KPICard.tsx && grep -q "HelpCircle" src/components/dashboard/KPICard.tsx && ! grep -q 'from "@/components/ui/tooltip"' src/components/dashboard/KPICard.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - O KPICard usa `<Popover>` controlado; o import de `@/components/ui/tooltip` foi removido.
    - O gatilho "?" abre no hover (onMouseEnter) e alterna no clique/tap (onClick com stopPropagation).
    - `<PopoverContent>` sobrescreve `w-72` com `w-auto max-w-[240px]` e tem `onOpenAutoFocus` prevenido.
    - A prop `tooltip?: string` permanece inalterada (componente genérico).
    - `npx tsc --noEmit` não acusa erro em KPICard.tsx.
  </acceptance_criteria>
  <done>Tooltip do KPICard substituído por Popover híbrido; tsc limpo; tap em mobile abre a definição.</done>
</task>

<task type="auto">
  <name>Task 3: Criar o componente EmptyState reutilizável (UX-02, D-04)</name>
  <files>src/components/ui/empty-state.tsx</files>
  <read_first>
    - RESEARCH.md §"Pattern 3: EmptyState component" — API completa já redigida (props icon/title/description/actionLabel/actionHref/onAction/size, render com Button asChild + Link).
    - PATTERNS.md §"src/components/ui/empty-state.tsx" — analog src/components/ui/card.tsx: padrão shadcn (cn, named export); divergência: props de domínio → function component com interface, como KPICard.
    - src/components/ui/button.tsx — padrão `<Button asChild size="sm"><Link to=...>` para o CTA.
  </read_first>
  <action>
    Criar `src/components/ui/empty-state.tsx` exportando `function EmptyState` (named export, sem default — consistente com todo `src/components/ui/*.tsx`), conforme RESEARCH.md §Pattern 3. Props: `icon: LucideIcon`, `title: string`, `description: string` (instrução de ação específica, D-04/D-05), `actionLabel?: string`, `actionHref?: string` (link interno react-router), `onAction?: () => void` (alternativa a href), `className?: string`, `size?: "default" | "compact"`. Layout: flex coluna centralizado, ícone em `text-muted-foreground/30`, título `text-sm font-medium`, descrição `text-xs text-muted-foreground max-w-[280px]`, e o CTA renderizado SOMENTE quando `actionLabel` existe — usando `<Button asChild><Link to={actionHref}>` quando há `actionHref`, ou `<Button onClick={onAction}>` quando há `onAction`. Usar `cn()` para merge de className e o `size` para alternar paddings (compact `py-10` vs default `py-16`). Não usar `dangerouslySetInnerHTML` — `title`/`description` são strings renderizadas como texto puro (sem superfície XSS, ver threat_model).
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "empty-state" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i empty-state)" && grep -q "export function EmptyState" src/components/ui/empty-state.tsx && ! grep -q "dangerouslySetInnerHTML" src/components/ui/empty-state.tsx && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - `src/components/ui/empty-state.tsx` exporta `EmptyState` (named, sem default).
    - Props icon/title/description/actionLabel/actionHref/onAction/size/className implementadas.
    - CTA renderiza com `<Link>` (actionHref) ou callback (onAction); ausência de actionLabel → sem botão.
    - Nenhum uso de `dangerouslySetInnerHTML`; texto renderizado como string pura.
    - `npx tsc --noEmit` limpo para o arquivo.
  </acceptance_criteria>
  <done>EmptyState compila, segue o padrão shadcn/ui do projeto, e está pronto para consumo pelos planos 02/03.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Este plano não introduz fluxo de dados, autenticação, autorização nem entrada de usuário. Glossário é Record estático; EmptyState e KPICard recebem strings de conteúdo estático da própria aplicação. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-01 | Information Disclosure / Tampering (XSS) | EmptyState / KPICard render de `title`/`description`/`tooltip` | mitigate | Renderizar todas as strings como texto puro JSX (`{value}`); proibido `dangerouslySetInnerHTML`. Verify automatizado em Task 1/3 confirma a ausência. Conteúdo é estático (glossário/empty-state), não input de usuário. |
| T-46-02 | (S/R/D/E) | — | accept | Nenhuma superfície nova de auth, sessão, rede ou input. Componentes puramente de apresentação client-side; risco residual desprezível (RESEARCH §Security Domain). |

Nota honesta: nenhum pacote novo é instalado nesta fase, logo o threat de supply-chain (T-{phase}-SC) não se aplica — sem tasks de `npm/pip/cargo install`.
</threat_model>

<verification>
- `npx tsc --noEmit` limpo (sem novos erros) após os três arquivos.
- `npm run build` conclui sem erro.
- Grep confirma: `KPI_GLOSSARY` exportado, KPICard sem import de tooltip e com Popover, EmptyState named export sem dangerouslySetInnerHTML.
</verification>

<success_criteria>
- Glossário central existe e cobre as ~26 chaves tipadas (fonte única, D-01).
- KPICard abre a definição via hover E via tap (Popover controlado, D-02).
- `<EmptyState>` reutilizável existe e segue o padrão shadcn/ui (D-04).
- `npx tsc --noEmit` e `npm run build` limpos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 01)

**Novos arquivos:**
- `src/lib/kpi-glossary.ts` — exporta `GlossaryKey` (type), `GlossaryEntry` (interface), `KPI_GLOSSARY` (Record).
- `src/components/ui/empty-state.tsx` — exporta `EmptyState` (function component).

**Símbolos consumidos a jusante (planos 02/03):**
- `import { KPI_GLOSSARY } from "@/lib/kpi-glossary"` → lookup `KPI_GLOSSARY[key].definition` (+ `.example`).
- `import { EmptyState } from "@/components/ui/empty-state"` → props icon/title/description/actionLabel/actionHref/onAction/size.

**Modificado:**
- `src/components/dashboard/KPICard.tsx` — gatilho "?" agora hover+tap (Popover); prop `tooltip?: string` inalterada (consumidores fazem o lookup do glossário).
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-01-SUMMARY.md` when done.
</output>
