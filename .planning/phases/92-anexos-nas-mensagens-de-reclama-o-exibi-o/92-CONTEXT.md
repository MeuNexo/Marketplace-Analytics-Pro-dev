# Phase 92: Anexos nas mensagens de reclamação (exibição) - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Source:** Feedback direto do Wesley (validação da Phase 90 em prod) + doc oficial ML (WebSearch)

<domain>
## Phase Boundary

No thread de mensagens de uma reclamação (componente `src/components/mercadolivre/ClaimDetailSheet.tsx`, aberto em `/devolucoes`), hoje só o **texto** de cada mensagem é exibido. As **imagens/arquivos anexados** — tanto os que o cliente envia quanto os que o vendedor envia — não aparecem. Esta phase adiciona a **exibição** desses anexos: imagem inline (miniatura → zoom), demais arquivos como botão de download. Tudo dentro do dashboard.

**Fora de escopo (deferido para phase própria):** ENVIAR anexo novo na resposta do vendedor (upload via `POST /post-purchase/v1/claims/{id}/attachments`). Esta phase é só EXIBIÇÃO/leitura.
</domain>

<decisions>
## Implementation Decisions

### Fatos da API do ML (confirmados — WebSearch doc oficial, LOCKED)
- Cada mensagem de `GET /post-purchase/v1/claims/{claim_id}/messages` traz um array `attachments` com identificadores de anexo (ex.: `0f2d81a2-c489-435e-96af-59688ad3d8f4_305860144.jpeg`).
- **Download do binário:** `GET https://api.mercadolibre.com/post-purchase/v1/claims/{claim_id}/attachments/{attachment_id}/download` — header `Authorization: Bearer {access_token do vendedor}`. NÃO é URL pública.
- **Metadata do anexo:** `GET .../attachments/{attachment_id}` → `{ filename, original_filename, size, date_created, type }`.
- Header `api-version: 2` como nas outras chamadas ML do projeto.
- ⚠️ O shape EXATO do item dentro de `message.attachments` (string pura vs objeto `{id/filename/type}`) deve ser CONFIRMADO contra uma claim viva no primeiro passo da execução — normalizar de forma robusta (tolerar ambos).

### Arquitetura (LOCKED)
- **Nova EF `ml-claim-attachment`** (proxy autenticado, `verify_jwt=true`). Segue EXATAMENTE o gate anti-IDOR das EFs irmãs (`ml-claim-detail`, `reply-ml-claim`): 1) JWT do usuário (`supabase.auth.getUser`), 2) validação de body (zod), 3) token por `ml_user_id` em `ml_tokens` (+ `organization_id`), 4) `supabase.rpc("is_org_member", {_user_id, _org_id})` — fail closed (403). Recebe `{ claim_id, ml_user_id, attachment_id }`, baixa o binário do ML com o token do vendedor e devolve **`{ data_base64, content_type, filename }`** (data URI montada no front). `access_token` NUNCA logado nem retornado (T-42-04).
  - Racional base64 (não URL assinada): fotos de claim são pequenas; um `<img src>` direto não pode mandar o header Authorization, e a URL do ML exige Bearer. base64 via `supabase.functions.invoke` (que já manda o JWT) casa com o padrão de invocação existente e é o caminho mais simples e seguro.
- **EF `ml-claim-detail` (aditivo):** normaliza `message.attachments` → array de `{ id, filename, type }` estável (tolerando item string OU objeto). Resto do retorno intocado.
- **Frontend:**
  - Hook lazy `useClaimAttachment(claimId, mlUserId, attachmentId)` — invoca a EF proxy sob demanda, cacheia por `attachment_id` (React Query), retorna data URI + tipo.
  - Componente `ClaimAttachment` — decide imagem vs arquivo pelo `type`/extensão. Imagem → miniatura clicável (zoom em `Dialog` shadcn); não-imagem → botão "Baixar" (invoke → blob → download programático). Estados loading/erro por anexo.
  - `ClaimDetailSheet` — abaixo do `<p>` do texto de cada mensagem, se houver anexos, renderiza `ClaimAttachment` para cada um.
- Tipo `MLClaimMessage.attachments?: unknown[]` (já existe em `useMLClaimMessages.ts`) passa a ser tipado como `ClaimAttachmentMeta[]`.

### Claude's Discretion
- Nome exato da EF/hook/componente e assinatura.
- Heurística imagem vs arquivo (checar `type` startsWith `image/`, fallback por extensão do filename).
- Se busca imagens eager (ao abrir) ou lazy (ao clicar) — preferência: eager só p/ imagens pequenas, arquivos sempre sob demanda.
- Lib pura testável para a normalização de attachments + a decisão imagem/arquivo.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### EFs (padrão de auth/anti-IDOR a replicar — CRÍTICO)
- `supabase/functions/ml-claim-detail/index.ts` — gate JWT→getUser→token por ml_user_id→is_org_member; `mlGetJson` com Bearer + api-version:2. É onde `messages` é montado (normalizar attachments aqui).
- `supabase/functions/reply-ml-claim/index.ts` — mesmo gate anti-IDOR (fail closed antes de ação irreversível); referência do POST ao ML.
- `supabase/functions/_shared/` — helpers compartilhados (ex. `capitalizeName`); ver se há util de resposta/cors reusável.

### Frontend
- `src/components/mercadolivre/ClaimDetailSheet.tsx` — render do thread (linha ~188 `messages.map`, `htmlToText(m.message)`); ponto de inserção dos anexos.
- `src/hooks/useMLClaimMessages.ts` — `MLClaimMessage` (tem `attachments?: unknown[]`), `useMLClaimDetail` (invoca `ml-claim-detail` via `supabase.functions.invoke`).
- Padrão de `supabase.functions.invoke` com JWT (ver como `useMLClaimDetail` chama) — o hook de anexo deve usar o mesmo.

### Convenções
- `./CLAUDE.md` — named exports, libs puras em `src/lib/`, hooks `use*`, vitest colocado, shadcn/ui (Dialog p/ zoom), sem novas deps.

### Deploy
- EF nova é deployada via MCP `deploy_edge_function` no projeto `ckcdevcxgvueywivefgx` (não há token CLI). `verify_jwt=true`.
</canonical_refs>

<specifics>
## Specific Ideas

- Claim real para inspecionar shape/dev: `5539092161` (ml_user_id `1639558873`, Pé Vermeio) — Wesley disse ter mensagens com anexo.
- Testes: normalização de `attachments` (string→{id}, objeto→{id,filename,type}, vazio/ausente→[]); decisão imagem-vs-arquivo por type/extensão.
- Anti-IDOR: provar 403 quando JWT de outra org tenta baixar anexo de `ml_user_id` que não é da sua org (mesmo teste conceitual das EFs irmãs).
- Verificação alvo: tsc 0, vitest verde (novos testes), build ok, EF `ml-claim-attachment` ACTIVE com verify_jwt=true + smoke 401 sem JWT.
</specifics>

<deferred>
## Deferred Ideas

- **Enviar anexo** na resposta do vendedor (upload `POST /post-purchase/v1/claims/{id}/attachments` + referenciar na mensagem) — phase própria (send), maior escopo (input de arquivo, upload, limites de tamanho/tipo do ML).
- Cache/persistência dos binários (hoje só cache em memória via React Query) — desnecessário agora.
</deferred>

---

*Phase: 92-anexos-nas-mensagens-de-reclama-o-exibi-o*
*Context gathered: 2026-07-07 via feedback Wesley + doc oficial ML*
