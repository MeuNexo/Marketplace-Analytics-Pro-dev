---
phase: 92-anexos-nas-mensagens-de-reclama-o-exibi-o
verified: 2026-07-07T00:00:00Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
advisory:
  - test: "Abrir /devolucoes → claim com anexo (ex. 5539092161), confirmar miniatura de imagem renderiza, clique dá zoom em Dialog, e arquivo não-imagem baixa"
    expected: "Foto real da claim aparece inline (thumb→zoom); PDF/arquivo baixa com filename correto"
    why_advisory: "Render de imagem real precisa de binário vivo do ML + browser; código-path verificado como íntegro (orchestrator: advisory, não bloqueia)"
---

# Phase 92: Anexos nas mensagens de reclamação (exibição) — Verification Report

**Phase Goal:** No thread de mensagens de uma reclamação (`ClaimDetailSheet` em `/devolucoes`), imagens e arquivos anexados (cliente OU vendedor) aparecem — imagem inline (miniatura→zoom), outros arquivos como download; binário servido por uma EF proxy autenticada nova (anexos ML exigem Bearer do vendedor). Somente exibição.
**Verified:** 2026-07-07
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | EF `ml-claim-attachment` baixa binário com token do vendedor → base64+content-type+filename | ✓ VERIFIED | `index.ts:99-131` — download Bearer+api-version:2, `encodeBase64(buf)`, retorno `{ ok, data_base64, content_type, filename }` |
| 2 | Anti-IDOR 403 cross-org, fail-closed ANTES de qualquer download ML | ✓ VERIFIED | `index.ts:88-97` gate `is_org_member` fail-closed; download só em `:102-103` (depois do gate) |
| 3 | 401 sem JWT válido | ✓ VERIFIED | `index.ts:72` Bearer check + `:76-77` getUser; orchestrator: smoke 401 (no-JWT e garbage-JWT) passou nas duas EFs |
| 4 | `ml-claim-detail` normaliza attachments aditivamente, tolerante string\|objeto | ✓ VERIFIED | `normalizeAttachment` `:46-61`, aplicado `:102-108`; demais campos (reason/available_actions/stage/type/status/buyer_first_name) intactos `:139-148` |
| 5 | `access_token` nunca logado nem retornado (T-42-04) | ✓ VERIFIED | grep sem match em logs/returns; erro ML loga só status/claim_id/ml_user_id (`:106`) |
| 6 | Imagem → miniatura clicável → zoom em Dialog (ATTACH-01) | ✓ VERIFIED | `ClaimAttachment.tsx:63-79` thumb `max-h-40` + `Dialog`/`DialogContent` zoom |
| 7 | Não-imagem → botão Baixar → download por blob (ATTACH-02) | ✓ VERIFIED | `:83-141` refetch→`fetch(dataUri).blob()`→objectURL→`a.download`→revoke |
| 8 | Binário buscado via EF proxy sob demanda, cacheado por `attachment_id` | ✓ VERIFIED | `useClaimAttachment.ts:45-52` queryKey `["ml-claim-attachment", attachmentId]`, `enabled` lazy, invoke com JWT auto |
| 9 | Estado loading/erro por anexo, sem quebrar thread | ✓ VERIFIED | `ClaimAttachment.tsx` estados isLoading/error/tooLarge por componente; `too_large`/413 dedicado |
| 10 | Decisão imagem-vs-arquivo é lib pura testada | ✓ VERIFIED | `claimAttachments.ts` `isImageAttachment`/`normalizeClaimAttachments`; 12 testes verdes |

**Score:** 10/10 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/functions/ml-claim-attachment/index.ts` | Proxy autenticado base64 + anti-IDOR | ✓ VERIFIED | ACTIVE v1 verify_jwt=true (orchestrator) |
| `supabase/functions/ml-claim-detail/index.ts` | Normalização aditiva de attachments | ✓ VERIFIED | ACTIVE v4 verify_jwt=true (orchestrator) |
| `src/lib/claimAttachments.ts` (+`.test.ts`) | normalize + isImage, testado | ✓ VERIFIED | 12 testes; named exports |
| `src/hooks/useClaimAttachment.ts` | hook lazy React Query invoca proxy | ✓ VERIFIED | queryKey por attachment_id, JWT auto |
| `src/components/mercadolivre/ClaimAttachment.tsx` | imagem thumb+zoom / arquivo Baixar | ✓ VERIFIED | ImageAttachment + FileAttachment |
| `src/hooks/useMLClaimMessages.ts` | `attachments` tipado `ClaimAttachmentMeta[]` | ✓ VERIFIED | `:3` import, `:12` tipo aplicado |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `ml-claim-attachment` | `is_org_member` RPC | gate fail-closed 403 antes do download | ✓ WIRED (`:96`) |
| `ml-claim-attachment` | ML `.../attachments/{id}/download` | fetch Bearer seller + api-version:2 | ✓ WIRED (`:102-103`) |
| `ClaimDetailSheet` | `ClaimAttachment` | render por anexo abaixo do texto de cada mensagem | ✓ WIRED (`:203-210`, sem filtro de sender_role → cliente E vendedor) |
| `useClaimAttachment` | `invoke('ml-claim-attachment')` | body `{claim_id, ml_user_id, attachment_id}` JWT auto | ✓ WIRED (`:52`) |

### Security Checks (goal-critical)

- **Anti-IDOR ordem exata:** 401(Bearer)→401(getUser)→400(zod)→404(token)→403(org null)→403(is_org_member), TODOS antes de `fetch` ao ML. ✓
- **attachment_id regex** `^[A-Za-z0-9._-]+$` + refine `!includes("..")` no zod, rejeita `/` e `..` antes de entrar no PATH da URL ML. ✓ (`:48-58`)
- **Size guard** ≤5MB por Content-Length E byteLength → 413 `too_large`, antes de inflar base64. ✓ (`:112-121`)
- **Token nunca vaza** em log/retorno em ambas EFs. ✓

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ATTACH-01 (exibir imagem inline) | ✓ SATISFIED | ImageAttachment thumb+zoom |
| ATTACH-02 (baixar arquivo não-imagem) | ✓ SATISFIED | FileAttachment blob download |
| ATTACH-03 (proxy anti-IDOR por org) | ✓ SATISFIED | is_org_member fail-closed antes de download |

### Gates

- `npx tsc --noEmit` → **0 errors** (exit 0)
- `npx vitest run` → **505 passed / 36 files** (inclui 12 de claimAttachments), exit 0
- Deploy: ambas EFs ACTIVE verify_jwt=true + 401 smoke (no-JWT e garbage-JWT) passou — confirmado pelo orchestrator via MCP

### Anti-Patterns Found

Nenhum. Sem TODO/FIXME/XXX/placeholder nos arquivos da phase. `return null` em `mlGetJson` é tratamento de erro legítimo, não stub.

### Advisory (non-blocking)

- **Live-image E2E:** render de uma foto real de claim no browser (`/devolucoes`, claim 5539092161) precisa de Wesley in-browser — binário vivo do ML + DOM. Código-path verificado íntegro (hook→EF→base64→data URI→`<img>`/blob); marcado como advisory pelo orchestrator, **não bloqueia**.

### Gaps Summary

Nenhum gap. Todos os 10 truths verificados no código + testes; anti-IDOR, size guard e não-vazamento de token confirmados por leitura direta; EFs deployadas ACTIVE com 401 smoke. Nota documental menor: `92-01-SUMMARY.md` ausente (só `92-02-SUMMARY.md` existe) — o Task 3 do Plan 01 é checkpoint:human-verify e o deploy foi feito pelo orchestrator; não afeta entregáveis (as duas EFs existem, corretas e ativas).

---

_Verified: 2026-07-07_
_Verifier: Claude (gsd-verifier)_
