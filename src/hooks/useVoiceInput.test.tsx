/**
 * useVoiceInput — ditado com transcrição no backend (quick 260729-r44).
 *
 * Prova: grava → para → transcreve → ACRESCENTA ao texto existente; erros de microfone
 * têm mensagem específica; áudio inaudível avisa em vez de apagar o campo; desmontar
 * fecha o microfone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

import { useVoiceInput, escolherMimeType, blobParaBase64 } from "@/hooks/useVoiceInput";

// ── stubs de MediaRecorder / getUserMedia ────────────────────────────────────
class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    ultimo = this;
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-falso"], { type: this.mimeType }) });
    this.onstop?.();
  }
  static isTypeSupported(m: string) { return m === "audio/webm;codecs=opus"; }
}
let ultimo: FakeRecorder | null = null;
const tracksParados: number[] = [];

function instalarAmbiente(erroMic?: string) {
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true, writable: true,
    value: {
      getUserMedia: erroMic
        ? vi.fn(async () => { const e = new Error("x"); e.name = erroMic; throw e; })
        : vi.fn(async () => ({ getTracks: () => [{ stop: () => tracksParados.push(1) }] })),
    },
  });
}

beforeEach(() => {
  ultimo = null;
  tracksParados.length = 0;
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { text: "vale a pena o pedido da Pralana" }, error: null });
  instalarAmbiente();
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).MediaRecorder;
});

describe("escolherMimeType", () => {
  it("prefere webm/opus quando suportado", () => {
    expect(escolherMimeType((m) => m === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
  });
  it("cai para mp4 no Safari (que não grava webm)", () => {
    expect(escolherMimeType((m) => m === "audio/mp4")).toBe("audio/mp4");
  });
  it("nenhum suportado → string vazia (deixa o navegador escolher)", () => {
    expect(escolherMimeType(() => false)).toBe("");
  });
});

describe("blobParaBase64", () => {
  it("remove o prefixo data: e devolve só o base64", async () => {
    const b64 = await blobParaBase64(new Blob(["oi"], { type: "audio/webm" }));
    expect(b64).not.toMatch(/^data:/);
    expect(b64.length).toBeGreaterThan(0);
  });
});

describe("useVoiceInput — ciclo completo", () => {
  it("grava, para, transcreve e ACRESCENTA ao texto existente", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript }));

    await act(async () => { await result.current.start("tenho 47k"); });
    expect(result.current.recording).toBe(true);

    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(onTranscript).toHaveBeenCalled());

    expect(onTranscript).toHaveBeenCalledWith("tenho 47k vale a pena o pedido da Pralana");
    // a EF recebe org_id + base64 + mime
    const body = (invokeMock.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(invokeMock.mock.calls[0][0]).toBe("transcribe-audio");
    expect(body.org_id).toBe("org-1");
    expect(typeof body.audio_base64).toBe("string");
    expect(String(body.mime_type)).toMatch(/audio\//);
  });

  it("campo vazio: usa só a transcrição, sem espaço à toa", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript }));
    await act(async () => { await result.current.start(""); });
    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("vale a pena o pedido da Pralana"));
  });

  it("áudio inaudível: avisa e NÃO mexe no campo", async () => {
    invokeMock.mockResolvedValue({ data: { text: "   " }, error: null });
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript, onError }));
    await act(async () => { await result.current.start("texto que estava lá"); });
    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/não entendi o áudio/i)));
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("EF falhando: mensagem clara e campo intacto", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript, onError }));
    await act(async () => { await result.current.start(); });
    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/não consegui transcrever/i)));
    expect(onTranscript).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("status passa por recording → transcribing → idle", async () => {
    let liberar: (v: unknown) => void = () => {};
    invokeMock.mockImplementation(() => new Promise((res) => { liberar = res; }));
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript: vi.fn() }));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe("recording");

    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(result.current.status).toBe("transcribing"));

    await act(async () => { liberar({ data: { text: "ok" }, error: null }); });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("fecha o microfone ao parar (track parada)", async () => {
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript: vi.fn() }));
    await act(async () => { await result.current.start(); });
    await act(async () => { ultimo!.stop(); });
    await waitFor(() => expect(tracksParados.length).toBeGreaterThan(0));
  });
});

describe("useVoiceInput — erros de microfone", () => {
  const casos: Array<[string, RegExp]> = [
    ["NotAllowedError", /permissão para usar o microfone/i],
    ["NotFoundError", /não encontrei nenhum microfone/i],
    ["NotReadableError", /ocupado por outro programa/i],
  ];
  for (const [nome, regex] of casos) {
    it(`${nome} → mensagem específica e não grava`, async () => {
      instalarAmbiente(nome);
      const onError = vi.fn();
      const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript: vi.fn(), onError }));
      await act(async () => { await result.current.start(); });
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(regex));
      expect(result.current.recording).toBe(false);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  }

  it("erro desconhecido inclui o nome na mensagem", async () => {
    instalarAmbiente("AlgoEstranhoError");
    const onError = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ orgId: "org-1", onTranscript: vi.fn(), onError }));
    await act(async () => { await result.current.start(); });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("AlgoEstranhoError"));
  });
});
