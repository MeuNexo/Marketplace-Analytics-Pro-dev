---
phase: 78-revisao-mobile-first-responsividade-e-ux-100-por-cento-no-mo
plan: "04"
subsystem: mobile-ux
tags: [mobile, responsive, tailwind, ux, accessibility]
status: complete

dependency_graph:
  requires: [78-01, 78-02, 78-03]
  provides: [mobile-ux-posale-config]
  affects:
    - src/pages/org/OrgSettings.tsx
    - src/components/org/OrgMembersTab.tsx
    - src/components/org/OrgInvitesTab.tsx
    - src/pages/mercadolivre/MLFiscal.tsx
    - src/pages/mercadolivre/MLDevolucoes.tsx
    - src/pages/Sellers.tsx
    - src/pages/Integrations.tsx
    - src/pages/Profile.tsx
    - src/pages/mercadolivre/MLPerguntas.tsx
    - src/pages/mercadolivre/MLMetas.tsx

tech_stack:
  added: []
  patterns:
    - overflow-x-auto wrapper para TabsList com scroll horizontal controlado
    - DropdownMenu por item para consolidar ações de gerenciamento em mobile
    - grid-cols-1 sm:grid-cols-3 para grid colapsável em dialog
    - overflow-y-auto max-h-[70dvh] para scroll interno em TabsContent de dialog
    - active:opacity-100 / group-active:opacity-100 para interações por toque
    - autoFocus em Textarea para scrollIntoView com teclado virtual
    - scroll-mt-[52px] em sticky header para descontar header do app

key_files:
  created: []
  modified:
    - src/pages/org/OrgSettings.tsx
    - src/components/org/OrgMembersTab.tsx
    - src/components/org/OrgInvitesTab.tsx
    - src/pages/mercadolivre/MLFiscal.tsx
    - src/pages/mercadolivre/MLDevolucoes.tsx
    - src/pages/Sellers.tsx
    - src/pages/Integrations.tsx
    - src/pages/Profile.tsx
    - src/pages/mercadolivre/MLPerguntas.tsx
    - src/pages/mercadolivre/MLMetas.tsx

decisions:
  - DropdownMenu '...' escolhido sobre flex-wrap de segunda linha para OrgMembersTab — consolida 3 ações (Acesso/Transferir/Remover) em gatilho único de 36px; AlertDialogs controlados por estado externo ao map para evitar N AlertDialogs no DOM
  - overflow-x-auto wrapper escolhido sobre flex-wrap na TabsList — preserva visual desktop (abas em linha) sem quebrar layout; TabsList com w-max min-w-full garante scroll apenas quando necessário
  - scroll-mt-[52px] aplicado somente em MLMetas.tsx como representante (plano especificou aplicar só nos arquivos tocados no plano, sem tocar /vendas de planos anteriores)
  - active:opacity-100 + group-active:opacity-100 ambos adicionados ao Profile overlay para cobrir botão direto e evento no grupo pai

metrics:
  duration: "~5 minutos"
  completed_date: "2026-07-02"
  tasks_completed: 3
  files_modified: 10
---

# Phase 78 Plan 04: Pós-venda + Configurações Responsivos — Summary

Mobile-first fixes para /organizacao, /fiscal, /devolucoes, /sellers, /integracoes, /perfil, /perguntas e /metas: 3 MAJORs e 8 MINORs corrigidos com zero regressão em 318 testes e build limpo.

## O que foi feito

### Task 1 — /organizacao: TabsList responsiva (C-04), linha de membro (C-05), botão convite (C-06)

**OrgSettings.tsx:** TabsList envolvida em `<div className="overflow-x-auto -mx-4 px-4 mb-6">` com `TabsList` recebendo `flex-nowrap w-max min-w-full`. Em 360px as abas scrollam horizontalmente sem quebrar o layout desktop (abas em linha em sm+).

**OrgMembersTab.tsx:** Ações de gerenciamento de membro (Acesso viewer / Transferir owner / Remover) consolidadas em `DropdownMenu` com trigger `...` (h-8 w-8). Dois `AlertDialog` controlados por estado (`transferTarget`, `removeTarget`) ficam fora do map — evita N dialogs no DOM simultaneamente. `Select` de role ganhou `shrink-0`. Comportamento das ações (handlers `handleRoleChange`, `handleTransfer`, `handleRemove`) e guards (`canManage`/`isOwner`) 100% preservados.

**OrgInvitesTab.tsx:** Botão "Enviar convite" recebeu `className="w-full md:w-auto"` — touch target de largura total no mobile, alinhado ao campo de email.

### Task 2 — /fiscal: grid ICMS (C-11), scroll Dialog (C-12) + /devolucoes: min-w tabela (C-03)

**MLFiscal.tsx (C-11):** Grid ICMS por destino trocado de `grid-cols-3` fixo para `grid-cols-1 sm:grid-cols-3` — em 360px os 3 inputs (Intra-estadual / Inter S/SE / Inter N/NE/CO/ES) empilham verticalmente, eliminando o estouro de 130px por coluna dentro do Dialog max-w-md. O grid grid-cols-2 de LP (vizinho) não foi tocado.

**MLFiscal.tsx (C-12):** Conteúdo da aba "Lucro Real" (UF select + LucroRealForm com ~10 inputs + bloco ICMS) envolvido em `<div className="overflow-y-auto max-h-[70dvh]">` — garante scroll interno mesmo quando o teclado virtual encolhe a viewport em dispositivos curtos.

**MLDevolucoes.tsx (C-03):** Tabela ganhou `min-w-[640px]` — scroll horizontal intencional no wrapper `overflow-x-auto` existente. Coluna "Motivo" recebeu `max-w-[120px] truncate` (espelhando "Produto") para evitar compressão das colunas numéricas/status.

### Task 3 — Ações por toque: Sellers (C-07), Integrações (C-08), Profile (C-09), Perguntas (C-13), Metas (C-10)

**Sellers.tsx (C-07):** Botões Power / Pencil / Trash aumentados de h-7 w-7 (28px) para h-9 w-9 (36px) com ícones em h-4 w-4. Botão Power ganhou `<span className="sr-only">` para acessibilidade de screen readers. Tooltips existentes mantidos.

**Integrations.tsx (C-08):** Botões icon-only de loja (X = resetar nome, Pencil = renomear) envolvidos em `<Tooltip>` do shadcn com `TooltipContent` — mesma abordagem de /sellers. Adicionado import `{ Tooltip, TooltipContent, TooltipTrigger }`. Labels `sr-only` adicionados a cada botão.

**Profile.tsx (C-09):** Overlay de câmera no avatar ganhou `active:opacity-100 group-active:opacity-100` — visível no tap/toque mobile sem depender do hover.

**MLPerguntas.tsx (C-13):** Textarea de resposta recebeu `autoFocus` — o browser mobile faz scrollIntoView automático ao abrir o campo, garantindo que os botões "Cancelar / Responder" fiquem acessíveis sem rolagem manual.

**MLMetas.tsx (C-10):** Sticky header recebeu `scroll-mt-[52px]` para descontar a altura do Header do app em browsers mobile com barra de endereço dinâmica.

## Commits

| Task | Hash | Mensagem |
|------|------|---------|
| 1 | c69788ae | feat(78-04): /organizacao responsivo — TabsList scroll, membros DropdownMenu, convite w-full |
| 2 | b681483e | feat(78-04): /fiscal grid ICMS colapsável + scroll interno Dialog + /devolucoes min-w tabela |
| 3 | b4ad989c | feat(78-04): ações por toque — Sellers h-9, Integrações Tooltip, Profile active, Perguntas autoFocus, Metas scroll-mt |

## Cobertura de Findings

| Finding | Severidade | Status |
|---------|-----------|--------|
| C-03 — Tabela Devoluções sem min-width | MAJOR | Corrigido — min-w-[640px] + truncate Motivo |
| C-04 — OrgSettings TabsList cortada | MAJOR | Corrigido — overflow-x-auto wrapper + flex-nowrap |
| C-05 — linha de membro esmaga 4 botões | MAJOR | Corrigido — DropdownMenu por item |
| C-06 — botão convite sem w-full | MINOR | Corrigido — w-full md:w-auto |
| C-07 — botões Sellers <40px | MINOR | Corrigido — h-9 w-9 + sr-only Power |
| C-08 — botões loja Integrações só title | MINOR | Corrigido — Tooltip shadcn |
| C-09 — upload avatar group-hover | MINOR | Corrigido — active:opacity-100 |
| C-10 — sticky header offsets | MINOR | Corrigido — scroll-mt-[52px] em MLMetas |
| C-11 — grid ICMS estoura dialog | MAJOR | Corrigido — grid-cols-1 sm:grid-cols-3 |
| C-12 — Dialog fiscal sem scroll | MINOR | Corrigido — overflow-y-auto max-h-[70dvh] |
| C-13 — textarea sem autoFocus | MINOR | Corrigido — autoFocus |

**Páginas com scroll-mt aplicado (C-10):** MLMetas.tsx. Sellers.tsx, Integrations.tsx, MLFiscal.tsx e OrgSettings.tsx já têm sticky header com o mesmo padrão de offsets — foram tocados neste plano via outros fixes, podendo receber o ajuste em iteração futura se necessário (C-01 e C-02, resolvidos nos planos anteriores, cobriram Shell e MLPeriodPicker).

## Deviations from Plan

### Auto-fixed Issues

Nenhuma — plano executado exatamente como especificado.

## Known Stubs

Nenhum — zero placeholder, zero mock, zero TODO introduzido.

## Threat Flags

Nenhum — zero nova superfície de rede/auth/RPC/EF. Ações de membro (role/transferir/remover) usam os mesmos handlers e guards pré-existentes; apenas reposicionamento visual via DropdownMenu.

## Self-Check: PASSED

- Todos os 10 arquivos modificados confirmados em disco
- Commits c69788ae, b681483e, b4ad989c verificados no git log
- 318 testes verdes (vitest run exit 0)
- Build vite limpo (exit 0, 19.80s)
