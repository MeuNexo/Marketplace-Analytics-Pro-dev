# Phase 46: UX para Leigos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 46-UX para Leigos
**Areas discussed:** Glossário KPI, Empty states, Tabelas mobile, Escopo visual

---

## UX-01 — Glossário / tooltip dos KPIs

| Option | Description | Selected |
|--------|-------------|----------|
| Glossário central + ícone '?' clicável | Arquivo único termo→definição, gatilho hover + tap (mobile) | ✓ |
| Glossário central, só hover | Mesma fonte única, mas só hover (ruim no touch) | |
| Texto inline por KPI | Texto direto em cada uso, duplica definições | |

**User's choice:** Glossário central + ícone '?' clicável
**Notes:** KPICard já tem prop `tooltip` + Tooltip shadcn montado — falta fonte de conteúdo e gatilho touch.

---

## UX-02 — Empty states

| Option | Description | Selected |
|--------|-------------|----------|
| Componente `<EmptyState>` reutilizável | Ícone + título + instrução específica + CTA, substitui ad-hoc | ✓ |
| Só adicionar instrução onde falta | Mantém empty states atuais, insere frase de ação | |

**User's choice:** Componente `<EmptyState>` reutilizável
**Notes:** Reaproveitar linguagem de ação do Consultor v1 (Fase 45). Instrução específica por página.

---

## UX-03 — Tabelas mobile (/anuncios, /pedidos, /financeiro)

| Option | Description | Selected |
|--------|-------------|----------|
| Cards empilhados no mobile | <768px tabela vira lista de cards | ✓ |
| Scroll horizontal + coluna fixa | Mantém tabela, scroll-x com 1ª coluna fixa | |
| Esconder colunas secundárias | Mobile mostra só essenciais | |

**User's choice:** Cards empilhados no mobile
**Notes:** Range alvo 320–768px; acima disso mantém tabela.

---

## UX-04 — Revisão de consistência visual / dark mode

| Option | Description | Selected |
|--------|-------------|----------|
| Foco nas 5-6 páginas mais usadas | /anuncios, /pedidos, /financeiro, /estoque, dashboard ML, /precificacao | ✓ |
| Auditoria visual de todas as rotas | Varredura completa ~20 rotas | |

**User's choice:** Foco nas 5-6 páginas mais usadas
**Notes:** Pragmático para não atrasar Fase 47 (go-live). Demais rotas ficam pontuais depois.

## Claude's Discretion

- Implementação do toggle hover/click do tooltip (Radix Popover vs Tooltip controlado).
- Local/estrutura do arquivo de glossário (TS vs JSON), desde que fonte única.
- Redação final das definições leigas (agentes redigem; Wesley revisa no checkpoint visual).

## Deferred Ideas

- Onboarding/tutorial guiado para primeiro acesso — outra fase.
- Auditoria visual das ~14 rotas restantes — pontual após go-live.
