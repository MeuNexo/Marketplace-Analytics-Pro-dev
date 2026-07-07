---
phase: 93-enviar-anexo-na-resposta-da-reclama-o-upload
plan: 02
subsystem: mercadolivre-atendimento
tags: [frontend, claims, upload, attachments, react, hooks]
requires:
  - ml-claim-attachment-upload (EF, Plano 01, ACTIVE v1, verify_jwt=true)
  - reply-ml-claim (EF v3, aceita attachments?: string[])
provides:
  - validateUploadFile (lib pura de validação de arquivo)
  - useClaimAttachmentUpload (hook de upload via FormData)
  - ClaimDetailSheet com clipe + chips + reply com attachments
affects:
  - src/components/mercadolivre/ClaimDetailSheet.tsx
tech-stack:
  added: []
  patterns:
    - lib pura + vitest colocado (espelho de constantes do servidor)
    - hook use* que invoca EF via supabase.functions.invoke com FormData
    - orquestração de upload por-arquivo com estado de chip no componente
key-files:
  created:
    - src/lib/attachmentUploadValidation.ts
    - src/lib/attachmentUploadValidation.test.ts
    - src/hooks/useClaimAttachmentUpload.ts
  modified:
    - src/components/mercadolivre/ClaimDetailSheet.tsx
decisions:
  - "Texto SEMPRE obrigatório (LOCKED): anexos são adicionais, nunca liberam envio de texto vazio; alinhado ao schema text.min(1) do reply-ml-claim"
  - "Send desabilitado enquanto houver anexo em status uploading"
  - "formData.append de 3 argumentos preserva o nome real do arquivo; sem Content-Type manual"
  - "Validação no cliente é só UX (feedback rápido); a autoridade é a EF (T-93-07)"
metrics:
  duration: ~15min
  completed: 2026-07-07
  tasks: 3
  files: 4
status: complete
---

# Phase 93 Plan 02: Frontend do envio de anexo na resposta da reclamação — Summary

Caixa de resposta do `ClaimDetailSheet` ganhou upload de anexos (JPG/PNG/PDF ≤5MB): lib pura de validação espelhando a EF, hook de upload via FormData, e UI com botão de clipe → chips por arquivo (enviando/ok/erro/remover) → envio de `text` + `attachments` ao `reply-ml-claim`.

## What Was Built

### Task 1 — Lib pura `attachmentUploadValidation` (TDD)
- `validateUploadFile(file)` → `{ ok: true } | { ok: false, error }` valida, nesta ordem: nome não-vazio, nome ≤125 chars + regex `[a-zA-Z0-9_.-]`, tipo ∈ `ALLOWED_UPLOAD_TYPES`, size ≤ `MAX_UPLOAD_BYTES`.
- Constantes exportadas espelham a EF exatamente: `ALLOWED_UPLOAD_TYPES = ["image/jpeg","image/png","application/pdf"]`, `MAX_UPLOAD_BYTES = 5*1024*1024`, `FILENAME_MAX_CHARS = 125`.
- vitest colocado com 15 casos (aceito jpg/png/pdf; rejeitado gif/txt/>5MB/nome-longo/espaço/acento/barra/vazio; fronteira exata de 5MB). RED→GREEN.

### Task 2 — Hook `useClaimAttachmentUpload`
- `uploadFile(file, claimId, mlUserId): Promise<{ filename }>` valida no cliente (via Task 1) antes de subir; monta `FormData` com `formData.append("file", file, file.name)` (3-arg) + `claim_id` + `ml_user_id`; invoca `ml-claim-attachment-upload`. Sem Content-Type manual.
- Erro da EF extraído do corpo da Response (padrão `parseFunctionErrorBody` de `useClaimAttachment`). Lança se `filename` ausente.

### Task 3 — `ClaimDetailSheet` clipe + chips + reply com attachments
- Botão Paperclip (ghost) → `<input type="file" hidden accept="image/jpeg,image/png,application/pdf" multiple>`; value limpo após seleção (re-seleção do mesmo arquivo).
- Estado `attachments: UploadItem[]`; cada arquivo vira chip com status (spinner/check/alerta) + botão X para remover.
- `handleSend` reúne filenames "done" e os passa como `attachments` (chave omitida quando vazio); limpa texto + chips no sucesso.
- **Texto sempre obrigatório:** Send `disabled={!text.trim() || busy || anyUploading}`. Guarda `if (!claim || !text.trim()) return;` (linha ~113) INALTERADA. Fluxo de exibição da Phase 92 e botões de ação intactos.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- `npx vitest run src/lib/attachmentUploadValidation.test.ts` → 15/15 verde
- `npx tsc --noEmit` → 0 erros
- `npm run build` → ✓ built in 29.35s
- `npx vitest run` (suite inteira) → 520/520 verde, 37 arquivos
- Grep: ClaimDetailSheet referencia `useClaimAttachmentUpload` + `attachments` + `Paperclip` ✓

Confirmações da decisão travada: texto sempre obrigatório (Send disabled sem texto e durante upload); `formData.append` de 3 argumentos; sem Content-Type manual.

## Not Done (fora da execução autônoma)

- E2E real (subir foto + enviar de fato ao ML) = validação do Wesley em preview/prod, pós-deploy.

## Self-Check: PASSED
- FOUND: src/lib/attachmentUploadValidation.ts
- FOUND: src/lib/attachmentUploadValidation.test.ts
- FOUND: src/hooks/useClaimAttachmentUpload.ts
- FOUND: src/components/mercadolivre/ClaimDetailSheet.tsx (modified)
- Commits: e97d1b20 (test), c71fd6d2 (lib), 74c6ed17 (hook), f5626a7a (component)
