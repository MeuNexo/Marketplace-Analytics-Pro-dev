---
phase: 92-anexos-nas-mensagens-de-reclama-o-exibi-o
plan: 02
subsystem: mercadolivre/atendimento
tags: [frontend, anexos, reclamacoes, react-query, shadcn-dialog]
requires: ["92-01"]
provides:
  - "src/lib/claimAttachments.ts (normalizeClaimAttachments, isImageAttachment, ClaimAttachmentMeta)"
  - "src/hooks/useClaimAttachment.ts (hook lazy proxy ml-claim-attachment)"
  - "src/components/mercadolivre/ClaimAttachment.tsx (imagem thumb+zoom / arquivo Baixar)"
affects:
  - "src/components/mercadolivre/ClaimDetailSheet.tsx (render de anexos no thread)"
  - "src/hooks/useMLClaimMessages.ts (MLClaimMessage.attachments tipado)"
tech-stack:
  added: []
  patterns:
    - "lib pura testada em src/lib/ + .test.ts colocado (padrão claimStatus)"
    - "React Query lazy (enabled=false → refetch no clique) cacheado por attachment_id"
    - "supabase.functions.invoke com JWT automático (padrão useMLClaimDetail)"
    - "data URI base64 → Blob → objectURL → a.download → revoke"
    - "shadcn Dialog para zoom de imagem"
key-files:
  created:
    - src/lib/claimAttachments.ts
    - src/lib/claimAttachments.test.ts
    - src/hooks/useClaimAttachment.ts
    - src/components/mercadolivre/ClaimAttachment.tsx
  modified:
    - src/hooks/useMLClaimMessages.ts
    - src/components/mercadolivre/ClaimDetailSheet.tsx
decisions:
  - "isImageAttachment por MIME image/* com fallback por extensão (jpg/jpeg/png/gif/webp/heic)"
  - "Imagens buscam eager (ao montar); arquivos só sob demanda (enabled=false + refetch no clique)"
  - "too_large/413 tratado como estado dedicado (tooLarge), não erro cru — sem retry"
  - "normalizeClaimAttachments é belt-and-suspenders sobre o retorno já normalizado da EF (tolera string OU objeto)"
metrics:
  duration: "~10min"
  completed: "2026-07-07"
  tasks: 3
  files: 6
status: complete
---

# Phase 92 Plan 02: Anexos nas mensagens de reclamação (frontend) Summary

Camada de frontend da exibição de anexos de reclamação: lib pura testada para normalizar/tipar attachments e decidir imagem-vs-arquivo, hook lazy que busca o binário via a EF proxy `ml-claim-attachment` (cache por `attachment_id`), componente `ClaimAttachment` (imagem → miniatura clicável + zoom em Dialog / não-imagem → botão Baixar com download por blob) e a fiação no `ClaimDetailSheet` abaixo do texto de cada mensagem.

## What Was Built

- **Task 1 (TDD):** `src/lib/claimAttachments.ts` — `normalizeClaimAttachments(raw): ClaimAttachmentMeta[]` (tolerante a item string/objeto, descarta sem id resolvível), `isImageAttachment(att)` (MIME `image/*` + fallback por extensão), tipo `ClaimAttachmentMeta = { id; filename; type }`. Teste colocado `claimAttachments.test.ts` (12 casos, RED→GREEN). `MLClaimMessage.attachments` tipado como `ClaimAttachmentMeta[]`.
- **Task 2:** `src/hooks/useClaimAttachment.ts` — React Query lazy, `queryKey: ["ml-claim-attachment", attachmentId]`, staleTime 5min, `retry:false`, invoca `ml-claim-attachment` com `{ claim_id, ml_user_id, attachment_id }` (JWT auto), monta `dataUri = data:{content_type};base64,{data_base64}`, trata `too_large`/413 via `error.context.json()` → `tooLarge:true`. Componente `src/components/mercadolivre/ClaimAttachment.tsx` — imagem: fetch eager, thumbnail (`max-h-40`) clicável → Dialog zoom; não-imagem: botão Baixar (Download+filename), clique → refetch → Blob (`fetch(dataUri)`) → objectURL → `a.download` → revoke; loading/erro/too-large por anexo.
- **Task 3:** `ClaimDetailSheet.tsx` — abaixo do `<p>` de cada mensagem, se `m.attachments?.length`, container `mt-2 space-y-1.5` com um `ClaimAttachment` por anexo (`key={att.id}`, `claimId!`/`mlUserId!`). UI de ações/resposta e layout das bolhas intactos.

## Verification Results

- `npx vitest run src/lib/claimAttachments.test.ts` → 12 passed
- `npx tsc --noEmit` → 0 errors
- `npm run build` → built in ~23s (exit 0)
- `npx vitest run` (full) → 505 passed / 36 files (sem regressões)

## Deviations from Plan

None - plan executed exactly as written.

## Notes

- O hook detecta `too_large` lendo o corpo da resposta de erro via `FunctionsHttpError.context` (Response) — supabase-js retorna `error` para status não-2xx, então o 413 do EF é parseado ali.
- Download de blob feito via `fetch(dataUri).blob()` (sem decode manual de base64) — suportado nativamente no browser.

## Self-Check: PASSED

All 4 created files present; all 4 task commits (ad123efd, 79781f9e, 6a53e7b5, c58ea616) exist in git history.
