# Phase 90 — Contexto

Design **já validado via brainstorming** (Wesley aprovou 2026-07-07). Fonte de verdade completa:

**`docs/superpowers/specs/2026-07-07-atendimento-reclamacoes-design.md`** — ler ANTES de planejar.

## Resumo executivo
Continuação da Phase 89. Duas melhorias no `/devolucoes`:

**Bloco 1 — Triagem "de quem é a vez":** 3 baldes (🔴 Pende você / 🟡 Aguardando / ✅ Resolvida) + selo do tipo de pendência (Responder / Decidir devolução / Decidir reembolso / Falar com o ML) + prazo. Dado = `available_actions` do player `respondent`, gravado pelo `ml-webhook` (tempo real, já faz o GET) e enriquecido no `sync-ml-claims` (cron, só abertas). Migration adiciona `seller_action_required`, `pending_action_type`, `action_due_date`, `available_actions`, `stage` em `ml_claims`.

**Bloco 2 — Mensagens rápidas:** templates compartilhados na loja (tabela `ml_claim_templates`, RLS org-first) com variáveis `{{nome}}`/`{{produto}}`/`{{pedido}}` preenchidas automáticas e editáveis; geridos por dialog dentro da reclamação. `ml-claim-detail` passa a devolver `buyer_first_name`.

## Restrições / decisões travadas
- Projeto Supabase = `ckcdevcxgvueywivefgx` (NÃO o do CLAUDE.md). Deploy EF só via MCP `deploy_edge_function`.
- Só backend Supabase (EFs Deno + migrations) + frontend React/TS. Sem novas deps.
- "Pende você" = ação `send_message_to_*` mandatory OU decisão (refund/allow_return/open_dispute/partial). Mensagem opcional sozinha = "Aguardando".
- Nome real do comprador vem de `orders.buyer.first_name` (confirmado: venda 2000017180084568 → "ISADELLE").
- Padrões de segurança da Phase 89 mantidos (JWT, token por ml_user_id, anti-IDOR, access_token nunca logado).
- Fora de escopo: IA (Phase D), reembolso parcial com %, anexos, variáveis além de nome/produto/pedido.
