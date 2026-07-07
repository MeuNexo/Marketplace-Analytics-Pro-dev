---
phase: 93-enviar-anexo-na-resposta-da-reclama-o-upload
verified: 2026-07-07T19:05:00Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
advisory:
  - test: "E2E real — anexar uma foto/PDF na resposta de uma reclamação aberta e enviar de fato ao ML (upload retorna filename, send-message 201, anexo aparece p/ o comprador)"
    expected: "Chip enviando→ok; mensagem enviada; anexo visível na thread do ML"
    why_advisory: "Requer conta ML real + reclamação aberta + Wesley no navegador; código-caminho verificado como sólido e EFs ACTIVE com smoke 401 OK. Checkpoint Wesley previsto no plano, não é gap."
---

# Phase 93: Enviar anexo na resposta da reclamação (upload) — Verification Report

**Phase Goal:** No `ClaimDetailSheet` (/devolucoes), o vendedor pode anexar JPG/PNG/PDF (≤5MB) à resposta de uma reclamação. Uma EF nova autenticada sobe o arquivo ao ML (multipart `file`) → filename; `reply-ml-claim` envia aditivamente `attachments:[filename]` no send-message. Texto sempre obrigatório.
**Verified:** 2026-07-07T19:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | EF `ml-claim-attachment-upload` recebe arquivo via FormData, valida server-side, só então sobe ao ML | ✓ VERIFIED | `req.formData()` L74-78; validação L100-115; upload ML L126 — validação ANTES do fetch |
| 2 | Anti-IDOR fail-closed ANTES de qualquer chamada ML (JWT→getUser→multipart→token→org null→is_org_member→403) | ✓ VERIFIED | Gate na ordem exata L64-95; `is_org_member` L94; primeiro fetch ML só em L126. Cross-org→403 L95 |
| 3 | `reply-ml-claim` aceita `attachments?: string[]`; inclui no send-message quando não-vazio | ✓ VERIFIED | Schema L62-69; body condicional L132-136 |
| 4 | Sem attachments, corpo enviado ao ML é byte-idêntico (campo omitido, nunca `[]`) | ✓ VERIFIED | `messageBody` = `{receiver_role, message}`; `attachments` só setado se `length>0` (L132-136) |
| 5 | `access_token` nunca logado nem retornado por nenhuma das EFs | ✓ VERIFIED | grep de console.* c/ access_token = 0; logs só status/claim_id/ml_user_id (upload L133/140/146; reply L145/149) |
| 6 | Lib pura valida arquivo (tipo/tamanho/nome) coberta por vitest aceito/rejeitado | ✓ VERIFIED | `attachmentUploadValidation.ts` + 15 testes verdes (jpg/png/pdf, gif/txt, >5MB, nome longo, espaço/acento/barra, vazio, fronteira 5MB) |
| 7 | Hook `useClaimAttachmentUpload` invoca a EF com FormData e devolve filename | ✓ VERIFIED | `uploadFile` L39-82: valida cliente→FormData 3-arg→invoke `ml-claim-attachment-upload`→retorna `{filename}` |
| 8 | Botão de clipe abre seletor JPG/PNG/PDF; cada arquivo vira chip com estado + remover | ✓ VERIFIED | Paperclip L371; input `accept=image/jpeg,image/png,application/pdf multiple` L354-361; chips c/ spinner/check/alerta + X L328-351 |
| 9 | Ao Enviar, filenames "done" passam ao `reply-ml-claim`; chips limpos no sucesso | ✓ VERIFIED | `handleSend` reúne filenames done L157-159; `attachments` no body só se >0 L165; `setAttachments([])` no sucesso L170 |
| 10 | Texto SEMPRE obrigatório (envio texto-vazio rejeitado) | ✓ VERIFIED | Send `disabled={!text.trim()||busy||anyUploading}` L375; guarda L154 inalterada; backend `text.min(1)` L64 |

**Score:** 10/10 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/functions/ml-claim-attachment-upload/index.ts` | EF upload anti-IDOR + validação + POST multipart | ✓ VERIFIED | 149 linhas; gate + validação + upload; ACTIVE v1 verify_jwt=true (orquestrador) |
| `supabase/functions/reply-ml-claim/index.ts` | send-message aditivo attachments | ✓ VERIFIED | `attachments` optional + condicional; ACTIVE v3 verify_jwt=true |
| `src/lib/attachmentUploadValidation.ts` (+ .test.ts) | validação pura + 3 constantes | ✓ VERIFIED | Exports `validateUploadFile`, `ALLOWED_UPLOAD_TYPES`, `MAX_UPLOAD_BYTES`, `FILENAME_MAX_CHARS`; 15 testes verdes |
| `src/hooks/useClaimAttachmentUpload.ts` | hook upload FormData | ✓ VERIFIED | invoca EF, parseFunctionErrorBody, retorna filename |
| `src/components/mercadolivre/ClaimDetailSheet.tsx` | clipe + chips + reply c/ attachments | ✓ VERIFIED | Wiring completo; Phase 92 (ClaimAttachment) e botões de ação intactos |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| upload EF | ml_tokens (is_org_member) | gate anti-IDOR fail-closed | ✓ WIRED (L86-95) |
| upload EF | ML /post-purchase/v1/claims/{id}/attachments | POST multipart campo `file` (3-arg append, sem Content-Type manual) | ✓ WIRED (L122-130) |
| reply-ml-claim | ML /actions/send-message | attachments no body quando presente | ✓ WIRED (L132-141) |
| ClaimDetailSheet | useClaimAttachmentUpload | upload por arquivo | ✓ WIRED (L83,140) |
| useClaimAttachmentUpload | ml-claim-attachment-upload | invoke FormData | ✓ WIRED (L57) |
| ClaimDetailSheet | reply-ml-claim | attachments: filenames no body | ✓ WIRED (L165-166) |

### Behavioral Spot-Checks / Gates

| Gate | Command | Result | Status |
|------|---------|--------|--------|
| TypeScript | `npx tsc --noEmit` | 0 erros | ✓ PASS |
| Vitest (suite) | `npx vitest run` | 520/520, 37 arquivos | ✓ PASS |
| Vitest (lib nova) | `npx vitest run attachmentUploadValidation.test.ts` | 15/15 | ✓ PASS |
| No-log token | grep console.* c/ access_token | 0 ocorrências | ✓ PASS |
| Smoke 401 (orquestrador) | POST sem/garbage JWT em ambas EFs | 401 | ✓ PASS |

### Security Verification (threat model)

- **T-93-01 (EoP):** gate anti-IDOR na ordem exata das irmãs, fail-closed, ANTES do 1º fetch ML — ✓
- **T-93-02 (Tampering):** validação server-side autoridade (tipo/size/nome) antes do upload — ✓
- **T-93-03 (Info Disclosure):** access_token nunca logado/retornado — ✓ (grep 0)
- **T-93-05 (Path injection):** `claim_id` validado por `CLAIM_ID_RE` + `.includes("..")` antes de entrar na URL — ✓ (L83)
- **T-93-06 (Defense-in-depth):** reply-ml-claim revalida cada filename (≤125, safe chars) — ✓ (L95-100)

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SEND-ATT-01 | upload valida tipo/tamanho/nome + anti-IDOR | ✓ SATISFIED | EF validação L100-115 + gate L64-95; lib+testes espelho |
| SEND-ATT-02 | reply-ml-claim inclui attachments | ✓ SATISFIED | schema + body condicional aditivo |
| SEND-ATT-03 | UI anexar/remover/enviar com chips | ✓ SATISFIED | clipe + chips + handleSend |

### Anti-Patterns Found

Nenhum. Sem TODO/FIXME/XXX nos arquivos da phase; sem stubs; sem retornos vazios hardcoded; sem Content-Type manual no multipart (boundary preservado nos dois lados).

### Advisory — Human Verification (não-bloqueante)

**E2E real:** anexar uma foto/PDF a uma reclamação ABERTA no ML e enviar de fato — confirmar que o upload devolve `filename`, o send-message retorna 201, e o anexo aparece para o comprador na thread. Requer conta ML real + reclamação aberta + Wesley no navegador. Este é o checkpoint Wesley já previsto no plano; o código-caminho está verificado como sólido e as EFs estão ACTIVE com smoke 401 OK — portanto **advisory, não gap/blocker**.

### Gaps Summary

Nenhum gap. Os 10 must-haves (5 backend + 5 frontend) estão verificados contra o código real, todos os gates passam (tsc 0, vitest 520/520), deploy confirmado (upload ACTIVE v1, reply v3, ambas verify_jwt=true, smoke 401). A única pendência é a validação E2E manual do Wesley — não-bloqueante por design.

---

_Verified: 2026-07-07T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
