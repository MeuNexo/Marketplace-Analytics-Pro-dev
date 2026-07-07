# Phase 93: Enviar anexo na resposta da reclamação (upload) - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Source:** Feedback Wesley ("também poder enviar") + spec autoritativa do MCP oficial do ML (página `gerenciar-mensagem-de-uma-eclamacao`)

<domain>
## Phase Boundary

Na resposta a uma reclamação (`ClaimDetailSheet` em `/devolucoes`), o vendedor hoje só envia TEXTO (`reply-ml-claim` → `POST /actions/send-message` com `{receiver_role, message}`). Esta phase permite **anexar arquivos** (foto/PDF) à mensagem enviada ao cliente. Complementa a Phase 92 (que só EXIBE anexos recebidos).

**Fora de escopo:** anexos em PERGUNTAS (só reclamações); formatos além de JPG/PNG/PDF; edição/remoção de anexo já enviado.
</domain>

<decisions>
## Implementation Decisions

### Fatos da API ML (CONFIRMADOS via MCP oficial — LOCKED)
- **Upload:** `POST https://api.mercadolibre.com/post-purchase/v1/claims/{claim_id}/attachments`, `multipart/form-data` com campo **`file`** = o arquivo. Bearer do vendedor. Resposta: `{ "user_id": <n>, "filename": "fa8d559e-...-_271959653.jpg" }` → usar o **`filename`**.
- **Enviar msg com anexo:** o send-message atual `POST .../actions/send-message` ganha o campo `attachments`: `{ receiver_role, message, attachments: ["<filename>"] }` → 201. Sem anexo: omitir `attachments` (ou `[]`).
- **Limites ML:** formatos JPG, PNG, PDF; ≤ 5 MB; nome do arquivo ≤ 125 chars, só `[a-zA-Z0-9_.-]`.

### Arquitetura (LOCKED)
- **EF nova `ml-claim-attachment-upload`** (`verify_jwt=true`, mesmo gate anti-IDOR das irmãs: JWT→getUser→token por `ml_user_id`→org null→`is_org_member`→403, ANTES de qualquer chamada ML). Recebe o arquivo do front via `FormData` (`supabase.functions.invoke` aceita FormData como body). **Valida no servidor ANTES de subir** (autoridade): content-type ∈ {image/jpeg, image/png, application/pdf}, tamanho ≤ 5 MB, nome ≤ 125 chars saneado. Faz `POST` multipart ao ML (campo `file`) com o token do vendedor; devolve `{ filename }`. `access_token` nunca logado (T-42-04).
- **`reply-ml-claim` (aditivo):** body ganha `attachments?: string[]` (filenames já subidos). Se presente e não-vazio, inclui `attachments` no corpo do send-message ao ML. Ausente/vazio → comportamento atual 100% intacto (não manda o campo). Nada mais muda (o gate, o derive de receiver_role, tudo igual).
- **Frontend `ClaimDetailSheet`:** na caixa de resposta, botão de clipe → `<input type="file" accept="image/jpeg,image/png,application/pdf" multiple?>`. Ao selecionar: valida no cliente (tipo/tamanho/nome — feedback rápido), sobe via a EF de upload, mostra um **chip** por arquivo (nome + estado: enviando/ok/erro + remover). Ao clicar Enviar: manda `text` + os `filenames` dos anexos já subidos ao `reply-ml-claim`. Limpa os chips no sucesso.

### Claude's Discretion
- Um anexo por vez ou múltiplos (preferência: permitir múltiplos, mas simples).
- Onde exatamente o botão de clipe fica na caixa de resposta.
- Se a validação de tipo usa content-type do File + extensão.
- Lib pura testável para a validação de arquivo (tipo/tamanho/nome) — reusável no cliente e espelhada no servidor.
- Como montar o FormData no cliente e re-montar o multipart no EF para o ML (Deno `FormData`).

### Anti-scope-creep
- NÃO mexer no fluxo de exibição da Phase 92 (já em prod).
- NÃO tocar em `ml-claim-attachment` (download) nem em `ml-claim-detail`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### EFs (padrão + ponto de mudança)
- `supabase/functions/reply-ml-claim/index.ts` — gate anti-IDOR + o `POST /actions/send-message` com `{receiver_role, message}` (linha ~103-108). É onde `attachments` entra. Ler `SEND_MESSAGE_ROLE_BY_ACTION` / derive de `receiver_role`.
- `supabase/functions/ml-claim-attachment/index.ts` (Phase 92) — modelo do gate anti-IDOR + validação defensiva + guarda de 5MB + no-log do token. O upload segue o MESMO gate.
- `supabase/functions/_shared/` — helpers.

### Frontend
- `src/components/mercadolivre/ClaimDetailSheet.tsx` — caixa de resposta (o `canMessage`, o textarea, o botão Enviar, o `sendReply`/mutation ~linha 99-141). Ponto de inserção do clipe + chips.
- `src/hooks/useMLClaimMessages.ts` — como o reply é invocado hoje (mutation → `supabase.functions.invoke("reply-ml-claim", {body:{claim_id, ml_user_id, text}})`). Adicionar `attachments`.
- Como `useClaimAttachment` (Phase 92) invoca EF — modelo do novo hook de upload.

### Convenções
- `./CLAUDE.md` — named exports, lib pura em `src/lib/`, hooks `use*`, vitest colocado, shadcn/ui, sem novas deps.

### Deploy
- EF nova + redeploy do `reply-ml-claim` via MCP `deploy_edge_function` (orquestrador; executor não tem token CLI). `verify_jwt=true`.
</canonical_refs>

<specifics>
## Specific Ideas

- Ref spec (MCP oficial ML, ver [[reference_ml_official_mcp_docs]]): upload campo `file` → `{filename}`; send `attachments:[filename]`; limites JPG/PNG/PDF/5MB/125-chars.
- Testes: lib pura de validação (tipo aceito/rejeitado, >5MB rejeitado, nome >125 rejeitado, nome com char inválido rejeitado).
- Anti-IDOR: 403 quando JWT de outra org tenta subir para `ml_user_id` que não é da sua org.
- Verificação alvo: tsc 0, vitest verde, build ok, EF upload ACTIVE verify_jwt=true + smoke 401 sem JWT. E2E real (subir foto e enviar) = checkpoint Wesley.
</specifics>

<deferred>
## Deferred Ideas

- Anexos em perguntas (`/perguntas`).
- Preview do anexo antes de enviar (miniatura local) — nice-to-have; o chip com nome basta no v1.
</deferred>

---

*Phase: 93-enviar-anexo-na-resposta-da-reclama-o-upload*
*Context gathered: 2026-07-07 via MCP oficial ML*
