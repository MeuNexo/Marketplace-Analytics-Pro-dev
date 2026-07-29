/**
 * useSpeechToText — ditado por voz (Web Speech API, custo zero).
 *
 * Prova: navegador sem suporte não quebra; o ditado PRESERVA o que já estava digitado;
 * parcial é substituído pelo final; permissão negada vira mensagem clara; silêncio
 * (`no-speech`) não é tratado como erro.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeechToText } from "@/hooks/useSpeechToText";

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.started = false; }
  /** helper: simula fala */
  emitir(trechos: Array<{ texto: string; final: boolean }>, resultIndex = 0) {
    const results: Record<number, unknown> & { length: number } = { length: trechos.length };
    trechos.forEach((t, i) => { results[i] = { isFinal: t.final, 0: { transcript: t.texto } }; });
    this.onresult?.({ resultIndex, results });
  }
}

let ultima: FakeRecognition | null = null;

function instalarSuporte() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = function () {
    ultima = new FakeRecognition();
    return ultima;
  };
}
function removerSuporte() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
}

beforeEach(() => { ultima = null; });
afterEach(() => { removerSuporte(); });

describe("useSpeechToText — sem suporte do navegador", () => {
  it("supported=false e nada quebra ao tentar iniciar", () => {
    removerSuporte();
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript: vi.fn(), onError }));
    expect(result.current.supported).toBe(false);
    act(() => { result.current.start("oi"); });
    expect(result.current.listening).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/não suporta ditado/i));
  });
});

describe("useSpeechToText — com suporte", () => {
  it("configura pt-BR, contínuo e resultados parciais", () => {
    instalarSuporte();
    const { result } = renderHook(() => useSpeechToText({ onTranscript: vi.fn() }));
    expect(result.current.supported).toBe(true);
    act(() => { result.current.start(); });
    expect(ultima!.lang).toBe("pt-BR");
    expect(ultima!.continuous).toBe(true);
    expect(ultima!.interimResults).toBe(true);
    expect(result.current.listening).toBe(true);
  });

  it("PRESERVA o texto já digitado e acrescenta o ditado", () => {
    instalarSuporte();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript }));
    act(() => { result.current.start("tenho 47k"); });
    act(() => { ultima!.emitir([{ texto: "de pedido na Pralana", final: true }]); });
    expect(onTranscript).toHaveBeenLastCalledWith("tenho 47k de pedido na Pralana");
  });

  it("parcial vira final sem duplicar o trecho", () => {
    instalarSuporte();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript }));
    act(() => { result.current.start(); });
    act(() => { ultima!.emitir([{ texto: "vale a pena", final: false }]); });
    expect(onTranscript).toHaveBeenLastCalledWith("vale a pena");
    act(() => { ultima!.emitir([{ texto: "vale a pena comprar", final: true }]); });
    expect(onTranscript).toHaveBeenLastCalledWith("vale a pena comprar");
  });

  it("permissão negada → mensagem explicando como liberar", () => {
    instalarSuporte();
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript: vi.fn(), onError }));
    act(() => { result.current.start(); });
    act(() => { ultima!.onerror?.({ error: "not-allowed" }); });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/permissão para usar o microfone/i));
    expect(result.current.listening).toBe(false);
  });

  it("silêncio (no-speech) NÃO vira erro para o usuário", () => {
    instalarSuporte();
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechToText({ onTranscript: vi.fn(), onError }));
    act(() => { result.current.start(); });
    act(() => { ultima!.onerror?.({ error: "no-speech" }); });
    expect(onError).not.toHaveBeenCalled();
  });

  it("toggle liga e desliga", () => {
    instalarSuporte();
    const { result } = renderHook(() => useSpeechToText({ onTranscript: vi.fn() }));
    act(() => { result.current.toggle(); });
    expect(result.current.listening).toBe(true);
    act(() => { result.current.toggle(); });
    expect(result.current.listening).toBe(false);
  });

  it("desmontar aborta o reconhecimento (microfone não fica aberto)", () => {
    instalarSuporte();
    const { result, unmount } = renderHook(() => useSpeechToText({ onTranscript: vi.fn() }));
    act(() => { result.current.start(); });
    const rec = ultima!;
    unmount();
    expect(rec.started).toBe(false);
  });
});
