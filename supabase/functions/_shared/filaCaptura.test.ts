import { describe, it, expect } from "vitest";
import {
  DIAS_DEFASAGEM_CFFE,
  JANELA_CFFE_DIAS,
  fimDaJanelaCffe,
  motivoNaFila,
  montarFila,
  okPrematuro,
  capturaTruncadaAntesDaCorrecao,
  CORTE_TRUNCAMENTO_CORRIGIDO_MS,
  type CapturaConhecida,
} from "./filaCaptura.ts";

// 🔴 As datas ficam TODAS depois do corte do truncamento (21/08) de propósito:
// senão `captura_truncada` — que vem primeiro na cascata — engoliria os casos
// e estes testes provariam a régua errada. Ver o bloco 240-03 no fim, que usa
// datas anteriores ao corte justamente para exercitar a outra régua.
const VENDA = "2026-08-25T10:00:00Z";
/** A janela fecha em 25/08 + 21 = 15/09. */
const DENTRO = Date.parse("2026-08-26T00:00:00Z"); // captura prematura, pós-corte
const FORA = Date.parse("2026-09-20T00:00:00Z"); // captura depois da janela
const AGORA = Date.parse("2026-09-25T12:00:00Z"); // a janela já fechou

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
    expect(fim?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    // O carimbo de hora não pode mover a fronteira.
    expect(fimDaJanelaCffe("2026-08-25T23:59:59Z")?.toISOString()).toBe(fim?.toISOString());
  });

  it("data ilegível não vira data — devolve nulo", () => {
    for (const v of [null, "", "   ", "01/07/2026", "sem data"]) {
      expect(fimDaJanelaCffe(v as string | null), String(v)).toBeNull();
    }
  });
});

describe("240-02 — `ok` prematuro volta à fila; `ok` maduro não", () => {
  it("🔴 capturado ANTES do fim da janela: pode faltar o CFFE, reabre", () => {
    expect(okPrematuro(ok(DENTRO), pedido, AGORA)).toBe(true);
  });

  it("capturado DEPOIS do fim da janela: não reabre", () => {
    expect(okPrematuro(ok(FORA), pedido, AGORA)).toBe(false);
  });

  it("🔴 `capturado_em` NULO com status ok conta como prematuro — ausência não é 'já capturei'", () => {
    expect(okPrematuro(ok(null), pedido, AGORA)).toBe(true);
    expect(okPrematuro({ ...ok(null), capturado_em: "nao-e-data" }, pedido, AGORA)).toBe(true);
  });

  it("sem data de pedido a régua NÃO reabre — senão a fila nunca encolheria", () => {
    expect(okPrematuro(ok(DENTRO), { ml_order_id: "p1", data_pedido: null }, AGORA)).toBe(false);
  });

  it("status diferente de ok não passa por esta régua", () => {
    expect(okPrematuro({ ...ok(DENTRO), status: "sem_linha" }, pedido, AGORA)).toBe(false);
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
      proxima_tentativa: "2026-08-28T00:00:00Z",
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
      ["retenta", { status: "erro", capturado_em: null, proxima_tentativa: "2026-08-28T00:00:00Z" }],
    ]);
    const { pendentes, contagem } = montarFila(pedidos, capturas, AGORA);
    expect(pendentes).toEqual(["novo", "prematuro", "retenta"]);
    expect(contagem).toEqual({
      nunca_capturado: 1,
      retentativa_vencida: 1,
      cffe_pode_ter_chegado: 1,
      captura_truncada: 0,
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

describe("🔴 240-02 — a janela VIVA não reabre: espera ela fechar", () => {
  // Venda de ontem, capturada hoje. A tarifa nem foi emitida — reconsultar
  // agora releria o mesmo número, todo dia, por três semanas.
  const ontem = "2026-09-24T10:00:00Z";
  const recente = { ml_order_id: "novo", data_pedido: ontem };

  it("pedido dentro da janela NÃO volta à fila", () => {
    expect(okPrematuro(ok(AGORA - 1000), recente, AGORA)).toBe(false);
  });

  it("e volta no dia em que a janela fecha", () => {
    const fim = Date.parse("2026-10-15T00:00:00Z"); // 24/09 + 21
    expect(okPrematuro(ok(Date.parse(ontem)), recente, fim)).toBe(true);
    expect(okPrematuro(ok(Date.parse(ontem)), recente, fim - 1)).toBe(false);
  });

  it("uma reconsulta por pedido: a do dia do fechamento", () => {
    const capturas = new Map([["novo", ok(Date.parse(ontem))]]);
    const fim = Date.parse("2026-10-15T00:00:00Z");
    expect(montarFila([recente], capturas, fim).pendentes).toEqual(["novo"]);
    capturas.set("novo", ok(fim));
    expect(montarFila([recente], capturas, fim).pendentes).toEqual([]);
  });
});


describe("🔴 240-03 — a SEGUNDA causa: capturado antes de o truncamento ser tratado", () => {
  const ANTES = Date.parse("2026-08-20T15:00:00Z");
  const DEPOIS = Date.parse("2026-08-21T09:00:00Z");
  // Venda de janeiro: a janela do CFFE fechou em fevereiro, muito antes da
  // captura de agosto — `okPrematuro` NÃO alcança este pedido.
  const antigo = { ml_order_id: "jan", data_pedido: "2026-01-15T10:00:00Z" };

  it("o corte é a virada de 20 para 21/08", () => {
    expect(new Date(CORTE_TRUNCAMENTO_CORRIGIDO_MS).toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("capturado em 20/08 reabre; em 21/08 não", () => {
    expect(capturaTruncadaAntesDaCorrecao(ok(ANTES))).toBe(true);
    expect(capturaTruncadaAntesDaCorrecao(ok(DEPOIS))).toBe(false);
  });

  it("🔴 e é a régua que alcança o que `okPrematuro` não alcança", () => {
    // A prova de que as duas réguas são diferentes, e não uma redundância.
    expect(okPrematuro(ok(ANTES), antigo, AGORA)).toBe(false);
    expect(motivoNaFila(antigo, ok(ANTES), AGORA)).toBe("captura_truncada");
  });

  it("`capturado_em` nulo ou ilegível conta como anterior — ausência não absolve", () => {
    expect(capturaTruncadaAntesDaCorrecao(ok(null))).toBe(true);
    expect(capturaTruncadaAntesDaCorrecao({ ...ok(null), capturado_em: "xx" })).toBe(true);
  });

  it("status diferente de ok não passa por esta régua", () => {
    expect(capturaTruncadaAntesDaCorrecao({ ...ok(ANTES), status: "erro" })).toBe(false);
  });

  it("quando as duas valem, o motivo nomeia o truncamento — o defeito maior", () => {
    // Venda de agosto capturada em 20/08: prematura E truncada.
    // Venda 05/08 (janela fecha 26/08), capturada em 20/08: prematura E
    // truncada — o caso real dos pedidos de agosto no backfill inicial.
    const agosto = { ml_order_id: "ago", data_pedido: "2026-08-05T10:00:00Z" };
    expect(okPrematuro(ok(ANTES), agosto, AGORA)).toBe(true);
    expect(motivoNaFila(agosto, ok(ANTES), AGORA)).toBe("captura_truncada");
  });

  it("também encolhe sozinha: recapturar avança o carimbo para depois do corte", () => {
    const capturas = new Map([["jan", ok(ANTES)]]);
    expect(montarFila([antigo], capturas, AGORA).pendentes).toEqual(["jan"]);
    capturas.set("jan", ok(AGORA));
    expect(montarFila([antigo], capturas, AGORA).pendentes).toEqual([]);
  });
});


describe("240-03 — `so_cobranca` é captura FECHADA, e passa pelas duas réguas", () => {
  const soCobranca = (capturadoEm: number): CapturaConhecida => ({
    status: "so_cobranca",
    capturado_em: new Date(capturadoEm).toISOString(),
    proxima_tentativa: null,
  });

  it("capturado antes do corte do truncamento: reabre, como o `ok`", () => {
    expect(capturaTruncadaAntesDaCorrecao(soCobranca(Date.parse("2026-08-20T12:00:00Z")))).toBe(true);
    expect(motivoNaFila(pedido, soCobranca(Date.parse("2026-08-20T12:00:00Z")), AGORA))
      .toBe("captura_truncada");
  });

  it("capturado dentro da janela do CFFE: reabre pela outra régua", () => {
    expect(motivoNaFila(pedido, soCobranca(DENTRO), AGORA)).toBe("cffe_pode_ter_chegado");
  });

  it("🔴 maduro e pós-corte: NÃO reabre — senão giraria para sempre", () => {
    expect(motivoNaFila(pedido, soCobranca(FORA), AGORA)).toBeNull();
  });
});
