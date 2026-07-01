# Phase 78: Revisão Mobile-First — Context

**Gathered:** 2026-07-01
**Status:** Ready for audit/planning
**Source:** Pedido direto do Wesley (sessão 2026-07-01, noite)

<domain>
## Phase Boundary

Revisão geral do dashboard para **mobile-first**: 100% responsivo, com TODAS as funções e UX funcionando no mobile sem nenhum bug. Fluxo: auditoria página a página → consolidação de findings → plano de correções → execução → verificação.

**Escopo (páginas do app principal):**
- Dashboard: `/` (Vendas), `/consultor`, `/publicidade`, `/financeiro` (Margem), `/produtos-vendidos`, `/analise-precos` (novas da Phase 77)
- Operações: `/anuncios` (inclui o modal de detalhe das Phases 71–73), `/estoque`, `/compras`, `/pedidos`, `/precificacao`, `/fluxo-de-caixa`
- Pós-venda: `/reputacao`, `/devolucoes`, `/perguntas`
- Configurações: `/metas`, `/sellers`, `/integracoes`, `/fiscal`, `/organizacao`, `/perfil`
- Shell: sidebar (comportamento mobile), Header, OrganizationSwitcher, StoreGroupSelector, SellerMarketplaceBar

**FORA do escopo:** `/tv` (modo TV, desktop por definição), painel super-admin (`/admin/*`), páginas públicas de policy.
</domain>

<decisions>
## Implementation Decisions

### Diretriz do Wesley (LOCKED)
- Mobile-first: toda função disponível no desktop precisa funcionar no mobile — nada de recurso "desktop-only" silencioso.
- UX simples para leigos (princípio permanente do Wesley).
- Sem bugs: interações, filtros, modais, gráficos e tabelas usáveis em viewport pequeno (360–430px de largura como referência).

### Lições conhecidas a aplicar (memória do projeto)
- **Dual-layout (Phase 71):** páginas com ramos `hidden lg:block` (desktop) + `lg:hidden` (mobile) precisam de TODA interação por item nos DOIS ramos — bug clássico: gatilho só no ramo desktop.
- Charts recharts precisam de `ResponsiveContainer` + alturas adequadas; eixos/labels legíveis no mobile (pendência histórica: "UX mobile charts /sales").
- Tabelas largas: variante mobile (cards) ou scroll horizontal INTENCIONAL (`overflow-x-auto` com min-width na tabela, nunca estourando o viewport da página).

### Claude's Discretion
- Priorização das correções (bugs funcionais > overflow/layout > polish).
- Padrão técnico de cada fix (cards mobile vs scroll horizontal, quando cabível seguir o padrão já usado na página análoga mais próxima).
- Divisão dos planos/waves.
</decisions>

<specifics>
## Checklist de auditoria (por página)

1. Overflow horizontal do viewport (larguras fixas, `min-w` sem wrapper `overflow-x-auto`, grids sem colapso `sm:`).
2. Tabelas sem variante mobile nem scroll intencional.
3. Paridade dual-layout: interações por item presentes nos dois ramos (botões, menus, modais, links).
4. Dialogs/Sheets/Popovers: cabem na tela pequena (`max-w`, `max-h`, scroll interno), fecháveis, inputs acessíveis com teclado virtual.
5. Charts: ResponsiveContainer, altura, ticks/legendas no mobile.
6. Touch targets pequenos demais (< ~40px) em ações principais.
7. Sticky headers/filters: sobreposição ou consumo excessivo de altura no mobile.
8. Filtros/ações de página acessíveis no mobile (não escondidos atrás de hover).
9. Estados vazios/loading que quebram layout pequeno.
10. `npx vitest run` + build continuam verdes após cada fix.
</specifics>

<deferred>
## Deferred Ideas

- Testes automatizados de viewport (Playwright) — fora do escopo desta phase.
- PWA/gestos nativos — não pedido.
</deferred>

---

*Phase: 78-revisao-mobile-first*
*Context gathered: 2026-07-01 via pedido direto do Wesley*
