import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useVoiceInput — ditado por voz com transcrição no backend (quick 260729-r44).
 *
 * Substitui a Web Speech API, que falhou nas duas pontas do ambiente do usuário:
 * no desktop com erro `network` (o serviço de voz do Google está bloqueado na rede) e
 * no celular abrindo a sessão sem nunca devolver texto.
 *
 * Aqui o áudio é gravado com MediaRecorder e transcrito pela EF `transcribe-audio`
 * (Gemini). Não depende de servidor de voz do Google nem do suporte irregular de cada
 * navegador — funciona em qualquer lugar que grave áudio.
 *
 * O texto transcrito é ACRESCENTADO ao que já estava escrito: ditar nunca apaga.
 */

/** Corta a gravação sozinha — evita mandar áudio gigante (e caro) por engano. */
export const MAX_DURACAO_MS = 120_000;

export type VoiceStatus = "idle" | "recording" | "transcribing";

/** Escolhe um container que o navegador realmente saiba gravar (Safari não faz webm). */
export function escolherMimeType(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): string {
  const candidatos = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidatos) {
    try {
      if (isSupported(m)) return m;
    } catch {
      /* isTypeSupported pode lançar em navegador antigo */
    }
  }
  return "";
}

/** Blob → base64 puro (sem o prefixo data:), que é o que a EF espera. */
export function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onloadend = () => {
      const r = String(reader.result ?? "");
      const virgula = r.indexOf(",");
      resolve(virgula >= 0 ? r.slice(virgula + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

export interface UseVoiceInputOptions {
  orgId: string | null;
  /** Recebe o texto final (o que já havia + transcrição). */
  onTranscript: (texto: string) => void;
  onError?: (mensagem: string) => void;
}

export function useVoiceInput({ orgId, onTranscript, onError }: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const limpar = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop()); // fecha o microfone
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const transcrever = useCallback(async (blob: Blob, mime: string) => {
    if (!blob.size) { setStatus("idle"); return; }
    setStatus("transcribing");
    try {
      const audio_base64 = await blobParaBase64(blob);
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { org_id: orgId, audio_base64, mime_type: mime },
      });
      if (error) throw error;
      const texto = String((data as { text?: string })?.text ?? "").trim();
      if (!texto) {
        onErrorRef.current?.("Não entendi o áudio. Fale um pouco mais perto do microfone e tente de novo.");
      } else {
        const base = baseRef.current;
        onTranscriptRef.current(base ? `${base.trimEnd()} ${texto}` : texto);
      }
    } catch {
      onErrorRef.current?.("Não consegui transcrever o áudio agora. Tente novamente.");
    } finally {
      setStatus("idle");
    }
  }, [orgId]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback(async (textoAtual = "") => {
    if (!supported) {
      onErrorRef.current?.("Este navegador não consegue gravar áudio. Use o Chrome ou o microfone do teclado do celular.");
      return;
    }
    if (recorderRef.current) return; // já gravando

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const nome = (err as DOMException)?.name ?? "";
      if (nome === "NotAllowedError" || nome === "SecurityError") {
        onErrorRef.current?.("Preciso de permissão para usar o microfone. Libere no cadeado da barra de endereços e tente de novo.");
      } else if (nome === "NotFoundError" || nome === "DevicesNotFoundError") {
        onErrorRef.current?.("Não encontrei nenhum microfone neste aparelho.");
      } else if (nome === "NotReadableError") {
        onErrorRef.current?.("O microfone está ocupado por outro programa. Feche o outro app e tente de novo.");
      } else {
        onErrorRef.current?.(`Não consegui acessar o microfone (${nome || "erro desconhecido"}).`);
      }
      return;
    }

    const mime = escolherMimeType();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      onErrorRef.current?.("Este navegador não conseguiu iniciar a gravação.");
      return;
    }

    baseRef.current = textoAtual;
    chunksRef.current = [];
    streamRef.current = stream;
    recorderRef.current = rec;

    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const tipo = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: tipo });
      chunksRef.current = [];
      limpar();
      void transcrever(blob, tipo);
    };

    rec.start();
    setStatus("recording");
    // teto de duração: protege contra gravação esquecida aberta
    timerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, MAX_DURACAO_MS);
  }, [supported, limpar, transcrever]);

  const toggle = useCallback((textoAtual = "") => {
    if (status === "recording") stop();
    else if (status === "idle") void start(textoAtual);
    // durante "transcribing" o clique é ignorado de propósito
  }, [status, start, stop]);

  // fechar o chat não pode deixar o microfone aberto
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      limpar();
    };
  }, [limpar]);

  return {
    supported,
    status,
    recording: status === "recording",
    transcribing: status === "transcribing",
    start,
    stop,
    toggle,
  };
}
