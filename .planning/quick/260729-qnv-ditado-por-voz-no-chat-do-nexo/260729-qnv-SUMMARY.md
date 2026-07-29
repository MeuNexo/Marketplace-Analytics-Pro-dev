---
quick_id: 260729-qnv
slug: ditado-por-voz-no-chat-do-nexo
date: 2026-07-29
status: complete
---

# Quick 260729-qnv — SUMMARY

## Entregue

- **`src/hooks/useSpeechToText.ts` (novo):** Web Speech API (`SpeechRecognition ??
  webkitSpeechRecognition`), `pt-BR`, `continuous:true` (fala livre, sem cortar nas
  pausas), `interimResults:true` (texto aparece enquanto fala). Guarda o texto-base ao
  iniciar e emite `base + finais + parcial` — **o ditado nunca apaga o que já foi
  digitado**. Erros traduzidos para linguagem de usuário; `no-speech`/`aborted` são
  silenciosos (o navegador dispara sozinho em pausas). Aborta no unmount para o microfone
  não ficar aberto depois de fechar o chat.
- **`NexoChatPanel`:** botão de microfone entre o campo e o Enviar, renderizado **só**
  quando há suporte. Gravando → ícone `MicOff`, variante destrutiva, `animate-pulse`,
  `aria-pressed`, e o placeholder vira "Pode falar — estou ouvindo…". Enviar interrompe
  o ditado. Erro de permissão vira toast explicando o cadeado da barra de endereços.

## Custo

**Zero.** Nenhuma chamada de API, nenhum backend novo, nenhuma EF. O reconhecimento é do
próprio navegador.

## Provas

- **8 testes** no hook: sem suporte não quebra; preserva texto digitado; parcial→final sem
  duplicar; permissão negada com mensagem clara; `no-speech` não vira erro; toggle;
  unmount aborta.
- Suíte completa **750 testes** (era 737), `tsc --noEmit` 0, `vite build` OK.

## Limitação assumida (explícita, não silenciosa)

Chrome/Edge suportam; Safari é parcial; **Firefox não tem**. Onde não há suporte o botão
simplesmente não aparece — nada quebra. No celular o microfone do próprio teclado já cobre
o ditado, sem depender disto.

## Decisão de escopo

**Não** envia automaticamente ao parar de falar: o usuário revisa antes. Transcrição erra
nome de marca e número, e número errado neste contexto vira decisão de compra errada.

Rota alternativa (gravar + transcrever numa EF, cobrindo todos os navegadores) fica para
depois — tem custo por minuto e exige backend.
