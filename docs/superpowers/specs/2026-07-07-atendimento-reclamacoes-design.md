# Atendimento de Reclamações — Triagem + Mensagens Rápidas

**Data:** 2026-07-07
**Status:** aprovado (brainstorming)
**Contexto:** continuação da Phase 89 (webhook ML + devoluções/perguntas). O envio de mensagem e as ações de reclamação já funcionam em produção (`reply-ml-claim` v2, `ml-claim-action` v3). Este design cobre duas melhorias de atendimento pedidas pelo Wesley.

## Objetivo

1. **Triagem "de quem é a vez":** diferenciar, na página `/devolucoes`, as reclamações que **pendem de ação do vendedor** (responder, decidir devolução/reembolso, falar com o ML) das que estão **aguardando** (comprador/ML) ou já **resolvidas**. Hoje só há filtro por tipo e por status aberto/encerrado — "aberta" não significa "pende de você".
2. **Mensagens rápidas (templates):** modelos de resposta salvos e compartilhados pela loja, com preenchimento automático de `{{nome}}`, `{{produto}}` e `{{pedido}}`, editáveis antes do envio.

## Bloco 1 — Triagem de "de quem é a vez"

### Fonte do dado
A "vez" do vendedor vem das `available_actions` do player `respondent` no detalhe do claim (`GET /post-purchase/v1/claims/{id}`), que **não** está no search resumido usado pelo cron, mas **está** no GET individual que o webhook já faz.

### Migration (`ml_claims`)
Adicionar colunas derivadas:
- `seller_action_required` boolean (default false) — respondent tem alguma ação acionável.
- `pending_action_type` text null — categoria priorizada: `reply` | `return` | `refund` | `dispute`.
- `action_due_date` timestamptz null — due_date da ação obrigatória (quando houver).
- `available_actions` jsonb null — lista crua das ações do respondent (para o sheet e auditoria).
- `stage` text null — estágio do claim (`claim` | `dispute` | …).

### Derivação (função compartilhada nas EFs)
A partir de `players.find(role==='respondent').available_actions` (cada item tem `action`, `mandatory`, `due_date`):
- **[CORRIGIDO 07-07 — alinhado ao ML "Próximas a serem atendidas"]** `seller_action_required` = existe **ao menos uma ação com `mandatory=true`** (o ML está cobrando o vendedor, tipicamente com prazo). Ações **opcionais** (`mandatory=false`) — `refund`, `allow_return`, `open_dispute`, `allow_partial_refund` ou `send_message_to_*` não-obrigatório — ficam quase sempre disponíveis como opção do vendedor e NÃO marcam como pendente (caem em "Aguardando"). *(A versão inicial do design contava ações de decisão opcionais como pendentes — isso inflava a contagem (10 vs 2 reais no ML) e foi corrigido.)*
- `pending_action_type` (prioridade): mensagem obrigatória (`reply`) → decisão de devolução (`return` quando `allow_return`) → reembolso (`refund`/`allow_partial_refund`) → disputa (`dispute`).
- `action_due_date` = `due_date` da ação que definiu o `pending_action_type` (quando presente).

### Onde preencher
- **`ml-webhook`** (tempo real): já busca o claim individual → deriva e grava as novas colunas no upsert (`claimRow`).
- **`sync-ml-claims`** (cron): após o search, faz **GET individual só das reclamações abertas** e enriquece as mesmas colunas. Fechadas não precisam (`seller_action_required=false`).

### UI (`/devolucoes`)
- Substituir o filtro de status por **3 abas/segmentos**: 🔴 **Pende você (N)** · 🟡 **Aguardando** · ✅ **Resolvida**. Default: "Pende você".
  - Pende você = `seller_action_required=true` e claim aberta.
  - Aguardando = claim aberta e `seller_action_required=false`.
  - Resolvida = status encerrado.
- Filtro de **Tipo** (reclamações/devoluções) mantido.
- Cada linha pendente ganha um **selo do tipo de pendência**: "Responder" / "Decidir devolução" / "Decidir reembolso" / "Falar com o ML", + **prazo** quando houver `action_due_date` ("vence em X dias" / "vence hoje" / "atrasada").
- Ordenação em "Pende você": prazo mais curto primeiro (nulos por último).
- KPI "Abertas" → **"Pendem você"** = count de `seller_action_required`.
- O **sininho da navbar** (pendências) passa a contar por `seller_action_required` em vez de "aberta".

### Arquivos (Bloco 1)
- `supabase/migrations/<novo>.sql` — colunas + índice parcial em `(organization_id, ml_user_id) where seller_action_required`.
- `supabase/functions/_shared/claimActions.ts` (novo) — derivação compartilhada.
- `supabase/functions/ml-webhook/index.ts`, `supabase/functions/sync-ml-claims/index.ts` — usam a derivação.
- `src/hooks/useMLClaims.ts` — expõe as novas colunas.
- `src/pages/mercadolivre/MLDevolucoes.tsx` — abas + selos + KPI.
- `src/lib/claimStatus.ts` — helpers de estado/selo/prazo.
- componente do sininho de pendências — novo critério.

## Bloco 2 — Mensagens rápidas (templates)

### Migration (nova tabela `ml_claim_templates`)
Colunas: `id` uuid pk, `organization_id` uuid, `title` text, `body` text, `created_by` uuid, `created_at`, `updated_at`. **RLS org-first** (SELECT/INSERT/UPDATE/DELETE restritos a membros da org via `is_org_member`). CRUD direto pelo Supabase client (sem EF nova).

### Nome do comprador
`ml-claim-detail` passa a incluir `buyer_first_name` na resposta (via `GET /orders/{order_id}` → `buyer.first_name`, capitalizado). Fallback: quando ausente, `{{nome}}` → "cliente".

### UI (dentro do `ClaimDetailSheet`)
- Acima do campo de resposta: seletor **"Usar modelo"** listando os templates da org. Ao escolher, insere o `body` no textarea com substituição de `{{nome}}` (buyer_first_name), `{{produto}}` (item_title), `{{pedido}}` (order_id). Texto fica **editável** antes de enviar.
- Botão **"Gerenciar modelos"** → **dialog** com CRUD (criar/editar/excluir), lista das variáveis disponíveis e preview com dados da reclamação atual.
- Substituição de variáveis: função pura testável (`applyTemplate(body, vars)`), variáveis desconhecidas mantidas literais.

### Arquivos (Bloco 2)
- `supabase/migrations/<novo>.sql` — tabela + RLS.
- `supabase/functions/ml-claim-detail/index.ts` — inclui `buyer_first_name`.
- `src/hooks/useClaimTemplates.ts` (novo) — query + mutations (CRUD).
- `src/lib/applyTemplate.ts` (novo) — substituição de variáveis (+ testes).
- `src/components/mercadolivre/ClaimTemplatesDialog.tsx` (novo) — CRUD.
- `src/components/mercadolivre/ClaimDetailSheet.tsx` — seletor + botão gerenciar.

## Segurança
- Nova tabela com RLS org-first (padrão do projeto; anti-IDOR).
- EFs de escrita já corrigidas mantêm todos os gates (JWT, token por ml_user_id, org membership).
- `buyer_first_name` só exposto dentro do `ml-claim-detail` já autenticado/autorizado.

## Performance
- Triagem: GET individual só das reclamações **abertas** no cron (N pequeno); tempo real via webhook (sem custo extra — o GET já acontece).
- `{{nome}}`: 1 GET de pedido dentro do `ml-claim-detail`, que já roda ao abrir a reclamação.

## Fora de escopo (YAGNI)
- Respostas por IA (Phase D do roadmap 89).
- Reembolso parcial com escolha de percentual (só ações inteiras já expostas).
- Anexos em mensagens.
- Variáveis além de nome/produto/pedido.

## Critérios de sucesso
1. Em `/devolucoes`, a aba "Pende você" mostra exatamente as reclamações com ação do vendedor pendente, com selo do tipo e prazo; contadores e sininho batem.
2. Ao responder uma reclamação, dá pra escolher um modelo e o texto sai com nome/produto/pedido corretos, editável; e dá pra criar/editar/excluir modelos ali mesmo.
3. Sem regressão: envio e ações continuam funcionando; testes passam.

## Decisões registradas
- Triagem: 3 baldes + selo de tipo de pendência.
- Templates: compartilhados na loja; variáveis nome+produto+pedido; geridos por dialog dentro da reclamação.
- Nome real do comprador disponível via `orders.buyer.first_name` (confirmado na venda 2000017180084568 → "ISADELLE").
