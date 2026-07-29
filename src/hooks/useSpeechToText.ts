import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useSpeechToText — ditado por voz usando a Web Speech API do navegador.
 *
 * Custo ZERO: reconhecimento nativo do navegador, sem backend e sem chamada de API.
 *
 * Suporte: Chrome/Edge completo; Safari parcial (`webkitSpeechRecognition`); Firefox não
 * tem. Quando não há suporte, `supported` é false e a UI simplesmente não mostra o botão
 * — no celular o usuário já dita pelo microfone do próprio teclado.
 *
 * Preserva o que já estava digitado: ao iniciar, guarda o texto-base e emite
 * `base + trechos finais + trecho parcial`. O ditado nunca apaga o que o usuário escreveu.
 */

type SpeechRecognitionErrorCode =
  | "not-allowed"
  | "service-not-allowed"
  | "no-speech"
  | "audio-capture"
  | "aborted"
  | "network"
  | string;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: SpeechRecognitionErrorCode;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechToTextOptions {
  /** Recebe o texto completo (base + ditado) a cada atualização. */
  onTranscript: (texto: string) => void;
  /** Mensagem de erro pronta para exibir ao usuário. */
  onError?: (mensagem: string) => void;
  lang?: string;
}

export function useSpeechToText({ onTranscript, onError, lang = "pt-BR" }: UseSpeechToTextOptions) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const finaisRef = useRef("");
  // refs para os callbacks: evita recriar o reconhecimento a cada render
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  const supported = getCtor() !== null;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(
    (textoAtual = "") => {
      const Ctor = getCtor();
      if (!Ctor) {
        onErrorRef.current?.("Seu navegador não suporta ditado por voz. Use o Chrome ou o microfone do teclado do celular.");
        return;
      }
      // já ouvindo: não empilha reconhecimentos
      if (recognitionRef.current) return;

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true;     // falar livremente, sem cortar nas pausas
      rec.interimResults = true; // texto aparece enquanto fala

      baseRef.current = textoAtual ? textoAtual.trimEnd() + " " : "";
      finaisRef.current = "";

      rec.onresult = (e) => {
        let parcial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const trecho = e.results[i][0].transcript;
          if (e.results[i].isFinal) finaisRef.current += trecho;
          else parcial += trecho;
        }
        onTranscriptRef.current(baseRef.current + finaisRef.current + parcial);
      };

      rec.onerror = (e) => {
        // silêncio não é erro do usuário — o navegador dispara sozinho em pausas longas
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          onErrorRef.current?.("Preciso de permissão para usar o microfone. Libere no cadeado da barra de endereços e tente de novo.");
        } else if (e.error === "audio-capture") {
          onErrorRef.current?.("Não encontrei um microfone disponível.");
        } else {
          onErrorRef.current?.("Não consegui capturar o áudio agora. Tente novamente.");
        }
        recognitionRef.current = null;
        setListening(false);
      };

      rec.onend = () => {
        recognitionRef.current = null;
        setListening(false);
      };

      recognitionRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        recognitionRef.current = null;
        setListening(false);
        onErrorRef.current?.("Não consegui iniciar o microfone. Tente novamente.");
      }
    },
    [lang],
  );

  const toggle = useCallback(
    (textoAtual = "") => {
      if (listening) stop();
      else start(textoAtual);
    },
    [listening, start, stop],
  );

  // aborta ao desmontar — senão o microfone segue aberto depois de fechar o chat
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, start, stop, toggle };
}
