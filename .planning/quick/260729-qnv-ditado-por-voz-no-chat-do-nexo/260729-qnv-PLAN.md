---
quick_id: 260729-qnv
slug: ditado-por-voz-no-chat-do-nexo
date: 2026-07-29
mode: quick
---

# Quick 260729-qnv — Ditado por voz no chat do Nexo

## Pedido

Wesley: "clicar em um botão e falar livremente, e a IA pegar o áudio e transcrever"
— **sem custo**.

Escolha travada: **Web Speech API** (`SpeechRecognition`), nativa do navegador.
Zero custo, zero backend, `pt-BR` suportado, transcrição ao vivo enquanto fala.
A rota alternativa (gravar + transcrever numa EF) foi descartada nesta entrega por ter
custo por minuto e exigir backend novo.

**Limitação assumida e explícita:** Chrome/Edge suportam; Safari é parcial; Firefox não
tem. Quando não houver suporte, o botão **não aparece** (nada quebra) — no celular o
usuário já dita pelo microfone do próprio teclado.

## Tarefas

### T1 — Hook `useSpeechToText`
- **files:** `src/hooks/useSpeechToText.ts` (novo)
- `supported` (detecta `SpeechRecognition ?? webkitSpeechRecognition`), `listening`,
  `start(textoAtual)`, `stop()`, `toggle(textoAtual)`.
- `lang: "pt-BR"`, `continuous: true` (falar livremente, sem cortar nas pausas),
  `interimResults: true` (texto aparece enquanto fala).
- Preserva o que já estava digitado: guarda o texto-base ao iniciar e emite
  `base + finais + parcial` a cada evento — nunca sobrescreve o que o usuário escreveu.
- Trata `onerror`: `not-allowed`/`service-not-allowed` → mensagem de permissão;
  `no-speech` → silencioso (não é erro do usuário).
- Cleanup no unmount (aborta o reconhecimento).
- **verify:** vitest com `SpeechRecognition` mockado
- **done:** hook coberto por teste, incluindo navegador sem suporte

### T2 — Botão de microfone no `NexoChatPanel`
- **files:** `src/components/nexo/NexoChatPanel.tsx`
- Botão entre o campo e o Enviar. Só renderiza quando `supported`.
- Gravando: ícone muda (`MicOff`), cor destrutiva + `animate-pulse`, `aria-pressed`,
  rótulo "Parar de gravar".
- Envio para o ditado (não faz sentido continuar ouvindo depois de enviar).
- Erro de permissão → `toast.error` explicando como liberar o microfone.
- **verify:** tsc + build; render com e sem suporte
- **done:** ditado funcionando no Chrome

### T3 — Provas
- `npx vitest run`, `npx tsc --noEmit`, `npx vite build`
- **done:** suíte verde, tsc 0, build ok

## must_haves
- **truths:** custo zero (nenhuma chamada de API); sem suporte → botão some, nada quebra;
  ditado nunca apaga o que já foi digitado
- **artifacts:** `src/hooks/useSpeechToText.ts`, `src/components/nexo/NexoChatPanel.tsx`
- **key_links:** `NexoChatPanel.tsx` (input + botão Enviar já existentes)

## Fora de escopo
- Transcrição via backend (Gemini/Whisper) — tem custo, fica para depois se o suporte
  do navegador incomodar.
- Enviar automaticamente ao parar de falar: o usuário revisa antes de mandar
  (transcrição erra nome de marca e número, e número errado aqui vira decisão errada).
