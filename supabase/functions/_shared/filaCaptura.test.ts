import { describe, it, expect } from "vitest";
import {
  DIAS_DEFASAGEM_CFFE,
  JANELA_CFFE_DIAS,
  fimDaJanelaCffe,
  motivoNaFila,
  montarFila,
  okPrematuro,
  type CapturaConhecida,
} from "./filaCaptura.ts";

const VENDA = "2026-07-01T10:00:00Z";
/** A janela fecha em 01/07 + 21 = 22/07. */
const DENTRO = Date.parse("2026-07-10T00:00:00Z"); // captura prematura
const FORA = Date.parse("2026-07-30T00:00:00Z"); // captura depois da janela
const AGORA = Date.parse("2026-09-04T12:00:00Z");

const ok = (capturadoEm: number | null): CapturaConhecida => ({
  status: "ok",
  capturado_em: capturadoEm === null ? null : new Date(capturadoEm).toISOString(),
  proxima_tentativa: null,
});

const pedido = { ml_order_id: "p1", data_pedido: VENDA };

describe("240-02 — a janela do CFFE", () => {
  it("o vínculo com a régua da tela está escrito no número", () => {
    expect(DIAS_DEFASAGEM_CFFE).toBe(18);
    expect(JANELA_CFFE_DIAS).toBe(21);
  });

  it("a janela fecha 21 dias depois do DIA da venda, ignorando a hora", () => {
    const fim = fimDaJanelaCffe(VENDA);
    expect(fim?.toISOString()).toBe("2026-07-22T00:00:00.000Z");
    // O carimbo de hora não pode mover a fronteira.
    expect(fimDaJanelaCffe("2026-07-01T23:59:59Z")?.toISOString()).toBe(fim?.toISOString());
  });

  it("data ilegível não vira data — devolve nulo", () => {
    for (const v of [null, "", "   ", "01/07/2026", "sem data"]) {
      expect(fimDaJanelaCffe(v as string | null), String(v)).toBeNull();
    }
  });
});

describe("240-02 — `ok` prematuro volta à fila; `ok` maduro não", () => {
  it("🔴 capturado ANTES do fim da janela: pode faltar o CFFE, reabre", () => {
    expect(okPrematuro(ok(DENTRO), pedido)).toBe(true);
  });

  it("capturado DEPOIS do fim da janela: não reabre", () => {
    expect(okPrematuro(ok(FORA), pedido)).toBe(false);
  });

  it("🔴 `capturado_em` NULO com status ok conta como prematuro — ausência não é 'já capturei'", () => {
    expect(okPrematuro(ok(null), pedido)).toBe(true);
    expect(okPrematuro({ ...ok(null), capturado_em: "nao-e-data" }, pedido)).toBe(true);
  });

  it("sem data de pedido a régua NÃO reabre — senão a fila nunca encolheria", () => {
    expect(okPrematuro(ok(DENTRO), { ml_order_id: "p1", data_pedido: null })).toBe(false);
  });

  it("status diferente de ok não passa por esta régua", () => {
    expect(okPrematuro({ ...ok(DENTRO), status: "sem_linha" }, pedido)).toBe(false);
  });
});

describe("240-02 — a fila inteira, e o caminho de hoje intocado", () => {
  it("pedido nunca capturado entra", () => {
    expect(motivoNaFila(pedido, undefined, AGORA)).toBe("nunca_capturado");
  });

  it("`sem_linha` com retentativa vencida entra (não-regressão)", () => {
    const c: CapturaConhecida = {
      status: "sem_linha",
      capturado_em: null,
      proxima_tentativa: "2026-08-21T00:00:00Z",
    };
    expect(motivoNaFila(pedido, c, AGORA)).toBe("retentativa_vencida");
  });

  it("`sem_linha` com retentativa FUTURA não entra", () => {
    const c: CapturaConhecida = {
      status: "sem_linha",
      capturado_em: null,
      proxima_tentativa: "2026-12-01T00:00:00Z",
    };
    expect(motivoNaFila(pedido, c, AGORA)).toBeNull();
  });

  it("quem desistiu (`proxima_tentativa` nula, status não-ok) não volta", () => {
    const c: CapturaConhecida = { status: "sem_linha", capturado_em: null, proxima_tentativa: null };
    expect(motivoNaFila(pedido, c, AGORA)).toBeNull();
  });

  it("os contadores são separados por motivo, nunca um total só", () => {
    const pedidos = [
      { ml_order_id: "novo", data_pedido: VENDA },
      { ml_order_id: "prematuro", data_pedido: VENDA },
      { ml_order_id: "maduro", data_pedido: VENDA },
      { ml_order_id: "retenta", data_pedido: VENDA },
    ];
    const capturas = new Map<string, CapturaConhecida>([
      ["prematuro", ok(DENTRO)],
      ["maduro", ok(FORA)],
      ["retenta", { status: "erro", capturado_em: null, proxima_tentativa: "2026-08-21T00:00:00Z" }],
    ]);
    const { pendentes, contagem } = montarFila(pedidos, capturas, AGORA);
    expect(pendentes).toEqual(["novo", "prematuro", "retenta"]);
    expect(contagem).toEqual({
      nunca_capturado: 1,
      retentativa_vencida: 1,
      cffe_pode_ter_chegado: 1,
    });
  });

  it("pedido repetido na entrada consome uma vaga só", () => {
    const { pendentes } = montarFila(
      [{ ml_order_id: "p1", data_pedido: VENDA }, { ml_order_id: "p1", data_pedido: VENDA }],
      new Map(),
      AGORA,
    );
    expect(pendentes).toEqual(["p1"]);
  });
});

describe("🔴 240-02 — o teste que prova o FIM do laço", () => {
  it("reabre na 1ª rodada e, depois de recapturar fora da janela, NÃO reabre na 2ª", () => {
    const capturas = new Map<string, CapturaConhecida>([["p1", ok(DENTRO)]]);

    const rodada1 = montarFila([pedido], capturas, AGORA);
    expect(rodada1.pendentes, "rodada 1 tem de reabrir").toEqual(["p1"]);
    expect(rodada1.contagem.cffe_pode_ter_chegado).toBe(1);

    // A EF grava `capturado_em = agora` a cada `ok` — e `agora` (04/09) já é
    // muito depois do fim da janela (22/07).
    capturas.set("p1", ok(AGORA));

    const rodada2 = montarFila([pedido], capturas, AGORA);
    expect(rodada2.pendentes, "a fila tem de encolher, nunca girar").toEqual([]);
    expect(rodada2.contagem.cffe_pode_ter_chegado).toBe(0);
  });

  it("e isso vale mesmo quando a reconsulta não acha CFFE nenhum", () => {
    // O pedido que legitimamente nunca terá frete cobrado é reconsultado UMA
    // vez após a janela; o carimbo novo o tira da fila para sempre.
    const capturas = new Map<string, CapturaConhecida>([["p1", ok(DENTRO)]]);
    expect(montarFila([pedido], capturas, AGORA).pendentes.length).toBe(1);
    capturas.set("p1", ok(AGORA)); // gravou `ok` de novo, sem CFFE
    expect(montarFila([pedido], capturas, AGORA).pendentes.length).toBe(0);
  });
});
