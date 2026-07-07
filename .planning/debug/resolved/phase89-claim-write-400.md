---
status: resolved
trigger: "Phase 89: responder reclamação e liberar devolução no dashboard dão erro de edge function (HTTP 400). Venda 2000017180084568 → claim_id 5539092161 (mediations, aberta, conta Pé Vermeio 1639558873)."
created: 2026-07-07
updated: 2026-07-07
---

# Debug: phase89-claim-write-400

## Symptoms
- **Expected:** Responder reclamação e clicar "Autorizar devolução" no dashboard executam a ação no Mercado Livre.
- **Actual:** Ambas retornam erro de edge function (HTTP 400).
- **Error:** ML retorna `400 {"error":"bad_request_error","message":"param action is null"}` (reply-ml-claim); `400` em ml-claim-action (allow_return).
- **Timeline:** Desde a entrega da Phase 89 (nunca funcionou em produção; leitura sempre OK).
- **Reproduction:** Abrir devolução da venda 2000017180084568 (claim 5539092161) no /devolucoes → responder OU autorizar devolução.

## Current Focus
- hypothesis: (CONFIRMADO) endpoints/payload de escrita de claims errados nas 2 EFs.
- test: reproduzido contra api.mercadolibre.com com token real (pg_net) + doc oficial via MCP mcp.mercadolibre.com.
- expecting: com receiver_role no body e paths /expected-resolutions/*, ML aceita (201).
- next_action: FIX APLICADO e commitado (54b1f983). Aguardando aprovação de Wesley para deploy via MCP Supabase deploy_edge_function (projeto ckcdevcxgvueywivefgx) — ação outward-facing (afeta claim real 5539092161), requer auditoria antes de sair. Após aprovação: deploy das 2 EFs + Wesley valida no dash (/devolucoes → responder + autorizar devolução na venda 2000017180084568).

### reasoning_checkpoint
```yaml
reasoning_checkpoint:
  hypothesis: "reply-ml-claim envia POST /actions/send-message com body {message} apenas — falta receiver_role, que o ML usa para derivar a action send_message_to_{role} internamente; sem ele, ML rejeita com 400 'param action is null'. ml-claim-action usa o path genérico /actions/{action} para refund/allow_return/open_dispute, mas o path correto (doc oficial) é /expected-resolutions/refund, /expected-resolutions/allow-return e /actions/open-dispute — path errado causa 400."
  confirming_evidence:
    - "Teste direto contra api.mercadolibre.com com token real: POST /claims/5539092161/actions/send-message body {message:'teste'} -> 400 'param action is null'; com receiver_role inválido -> mesmo erro (confirma que ML deriva a action a partir de receiver_role, campo ausente no body atual)."
    - "GET /post-purchase/v1/claims/5539092161 -> 200, players[].role='respondent' com available_actions incluindo send_message_to_complainant (mandatory), refund, open_dispute, allow_return — confirma que EF ml-claim-detail (já em prod) usa exatamente esse schema (detail.players.find(role==='respondent').available_actions[].action), reaproveitável para os dois fixes."
    - "Doc oficial ML via MCP get_documentation_page: send-message exige {receiver_role, message[, attachments]}; refund/allow_return usam /expected-resolutions/{refund|allow-return}, open_dispute usa /actions/open-dispute — não /actions/{action} genérico."
  falsification_test: "Se, mesmo enviando body {receiver_role: 'complainant', message} para send-message, ML continuar retornando 400 'param action is null' -> hipótese refutada, buscar outro campo obrigatório ausente. Não será testado ao vivo (ação irreversível); validação real fica para Wesley pós-deploy."
  fix_rationale: "Fix ataca a causa raiz exata: (1) inclui o campo obrigatório receiver_role derivado dinamicamente das available_actions reais do respondent (não hardcoded), com fail-closed se a mensagem não estiver disponível no estágio atual; (2) corrige os paths de escrita para os documentados oficialmente, mantendo a mesma whitelist de ações e todos os gates de segurança existentes (JWT, token por ml_user_id, anti-IDOR). Não é um workaround (retry, catch genérico) — corrige o contrato real da API ML."
  blind_spots: "Não foi feito nenhum POST real de sucesso (destrutivo/irreversível) contra send-message nem contra expected-resolutions/refund|allow-return|actions/open-dispute — a confirmação de que o body/paths corrigidos retornam 2xx depende de doc oficial + inferência do padrão de erro, não de teste direto ponta-a-ponta. Também não foi verificado se outros estágios/tipos de claim (não post-purchase mediation) têm schema de players diferente."
```

### Fix aplicado (ver Resolution)

## Evidence
- timestamp 2026-07-07: logs edge-function mostram `POST 400 reply-ml-claim` e `POST 400 ml-claim-action` (~2.5s cada = chamada ao ML feita e rejeitada).
- timestamp 2026-07-07: GET /post-purchase/v1/claims/5539092161 → 200; respondent available_actions = [send_message_to_complainant(mandatory), refund, open_dispute, allow_return]; stage=claim, claim_version 2.0. Leitura OK.
- timestamp 2026-07-07: POST /claims/5539092161/actions/send-message body {message:'teste'} → 400 "param action is null". Com {receiver_role:'__invalid__',message:'x'} → mesmo erro → ML deriva a action de receiver_role. Falta receiver_role no body da EF.
- timestamp 2026-07-07: doc oficial ML (MCP get_documentation_page gerenciar-mensagem-de-uma-eclamacao): send-message exige body {receiver_role: complainant|mediator|respondent, message, attachments?} → 201.
- timestamp 2026-07-07: doc oficial (gerenciar-resolucao-de-reclamacoes): refund=POST /expected-resolutions/refund; allow_return=POST /expected-resolutions/allow-return; open_dispute=POST /actions/open-dispute (hífen). NÃO /actions/{action}.

## Eliminated
- hypothesis: token/permissão inválidos — REFUTADO (GET claim 200; token válido).
- hypothesis: bug de validação Zod na EF — REFUTADO (400 leva ~2.5s = veio do ML, não da validação local).
- hypothesis: endpoint /v1/claims/{id}/messages (ref nexo-mcp) — REFUTADO (404; nunca testado real).

## Resolution
- root_cause: (1) reply-ml-claim envia body sem receiver_role; (2) ml-claim-action usa path /actions/{action} em vez de /expected-resolutions/allow-return|refund e /actions/open-dispute.
- fix: reply-ml-claim deriva receiver_role das available_actions do respondent (GET claim, fail-closed) e inclui no body; ml-claim-action mapeia cada action ao path correto e revalida action ∈ available_actions. APLICADO — commit 54b1f983 (main).
- verification:
  - auto: deno check PASS nos 2 arquivos editados; vitest 426/426 passed (sem regressão); contrato do frontend (ClaimDetailSheet.tsx) confirmado inalterado ({claim_id,ml_user_id,text} e {claim_id,ml_user_id,action}).
  - NÃO testado: nenhum POST real contra send-message/expected-resolutions/actions-open-dispute (ações irreversíveis, claim 5539092161 é de cliente real) — deliberadamente evitado.
  - DEPLOYADO 2026-07-07 (Wesley aprovou): reply-ml-claim v2 + ml-claim-action v3, ambas ACTIVE em ckcdevcxgvueywivefgx via MCP deploy_edge_function.
  - pendente: Wesley clica no dash na reclamação 5539092161 (responder + autorizar devolução) para confirmação end-to-end final.
- files_changed: supabase/functions/reply-ml-claim/index.ts, supabase/functions/ml-claim-action/index.ts
