# Phase 42: Zero Mock - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-13
**Phase:** 42-zero-mock
**Areas discussed:** Estratégia de sync, UX de resposta a pergunta, Reputação (gráfico+feedbacks), /devolucoes (claims vs devoluções), Escopo multi-loja

---

## Estratégia de sync (questions/claims)

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand ao abrir página | Padrão Phase 41 (useMLBillingWithSync), user JWT, sem cron | |
| pg_cron periódico | EF roda em background, dado pronto ao abrir, custo de API constante | ✓ |
| Ambos (cron base + refresh on-demand) | Cron + botão refresh manual | |

**User's choice:** pg_cron periódico
**Notes:** Frequência definida em follow-up — perguntas ~15min / claims ~30min.

### Frequência do cron

| Option | Description | Selected |
|--------|-------------|----------|
| Perguntas ~15min / Claims ~30min | Perguntas mais frescas (resposta rápida importa); claims espaçado | ✓ |
| Ambos a cada 30min | Um schedule só, mais simples | |
| Ambos a cada 60min | Menor custo de API, pode ser lento p/ perguntas | |

**User's choice:** Perguntas ~15min / Claims ~30min

---

## UX de responder pergunta (MOCK-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline + confirmação | Linha expande com textarea + confirmação antes de enviar + optimistic update | ✓ |
| Modal dedicado | Modal com pergunta + campo + preview | |
| Inline sem confirmação | Envio direto ao clicar | |

**User's choice:** Inline + confirmação
**Notes:** Resposta ML é irreversível (limite 2000 chars) — confirmação obrigatória + contador.

---

## Reputação: gráfico diário + feedbacks (MOCK-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Remover gráfico, manter resumo + entries reais | Zero mock, tira o gráfico sem dado real | |
| Derivar gráfico das datas dos feedbacks reais | Agrupa por dia os feedbacks reais; série curta/esparsa | ✓ |
| Manter só se EF conseguir histórico | Adia decisão para a pesquisa | |

**User's choice:** Derivar gráfico das datas dos feedbacks reais

---

## /devolucoes: claims vs devoluções (MOCK-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Lista unificada + coluna tipo + filtro status | Uma tabela ml_claims, read-only | ✓ |
| Abas separadas (Reclamações \| Devoluções) | Duas listas separadas | |
| Unificada + ação de responder reclamação | Lista + reply_to_claim (escopo extra) | |

**User's choice:** Lista unificada + coluna tipo + filtro status (read-only)

---

## Escopo multi-loja

| Option | Description | Selected |
|--------|-------------|----------|
| Respeita filtro do header, sync por ml_user_id | Igual outras páginas; merge no "todas" (CR-01) | ✓ |
| Sempre agrega todas as lojas da org | Ignora filtro de loja | |
| Só loja principal | Apenas conta ML principal | |

**User's choice:** Respeita filtro de loja do header, sync por ml_user_id

---

## Claude's Discretion

- TV (MOCK-05): sellers por organization_id (só ML conectado), logo/iniciais da tabela com fallback ML, ciclagem alfabética — não levado à discussão por escolha do usuário.
- Empty state antes do 1º cron (estado "sincronizando").
- Janela exata de backfill (perguntas não-respondidas + recentes; claims 90 dias).
- Estrutura de tabelas ml_questions/ml_claims (colunas/índices/RLS) seguindo padrão do projeto + Nexo MCP.
- Paginação/ordenação default das listas.

## Deferred Ideas

- Responder/mediar reclamação em /devolucoes (reply_to_claim do Nexo) — fase futura.
- Badge de contagem de pendências na sidebar — fase própria.
- Notificação push/Telegram de nova pergunta/claim — fora de escopo.
