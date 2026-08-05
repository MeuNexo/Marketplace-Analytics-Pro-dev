// ============================================================================
// Fase 214 — Task 4: cursor retomavel.
//
// ESTE MODULO EXISTE PARA CORRIGIR UM BUG CONHECIDO. O sync equivalente do
// nexo-mcp reseta o cursor quando `snapshot_date !== today`. Como uma volta
// completa leva ~14 minutos e o cron roda de madrugada, toda virada de data
// jogava a varredura de volta ao inicio: o resultado medido foi ~15% de
// cobertura e NENHUMA volta fechada. A regra central testada aqui e:
// a volta so reinicia depois de FECHAR por inteiro, nunca por relogio.
//
// `agora` entra na assinatura justamente para provar que NAO e usado para
// decidir reset — o teste da meia-noite so tem sentido se o parametro existir.
// ============================================================================
import { describe, it, expect } from "vitest";
import { proximaAcao, type EstadoCursor } from "./cursor";

const AGORA = new Date("2026-08-06T03:00:00Z");

function estado(over: Partial<EstadoCursor> = {}): EstadoCursor {
  return {
    fase: "estoque",
    fila: [{ tiny_id: "1", sku: "A" }, { tiny_id: "2", sku: "B" }],
    indice: 0,
    volta_iniciada: "2026-08-05T22:00:00Z",
    volta_completa: null,
    ...over,
  };
}

describe("proximaAcao", () => {
  it("sem estado, inicia uma volta", () => {
    expect(proximaAcao(null, AGORA)).toEqual({ tipo: "iniciar_volta" });
  });

  it("volta em andamento continua do indice", () => {
    expect(proximaAcao(estado({ indice: 1 }), AGORA))
      .toEqual({ tipo: "seguir_estoque", de: 1 });
  });

  // A REGRA QUE CORRIGE O BUG DO nexo-mcp:
  // la, o cursor reseta quando snapshot_date !== today e a volta nunca fecha.
  it("volta aberta que atravessa a meia-noite NAO reinicia", () => {
    const s = estado({ indice: 1, volta_iniciada: "2026-08-05T22:00:00Z" });
    expect(proximaAcao(s, new Date("2026-08-06T09:00:00Z")))
      .toEqual({ tipo: "seguir_estoque", de: 1 });
  });

  it("volta aberta ha varios dias ainda NAO reinicia — so fechar reinicia", () => {
    const s = estado({ indice: 1, volta_iniciada: "2026-07-01T22:00:00Z" });
    expect(proximaAcao(s, new Date("2026-08-06T09:00:00Z")))
      .toEqual({ tipo: "seguir_estoque", de: 1 });
  });

  it("fila esgotada fecha a volta", () => {
    expect(proximaAcao(estado({ indice: 2 }), AGORA)).toEqual({ tipo: "fechar_volta" });
  });

  it("indice alem do fim tambem fecha, nao estoura", () => {
    expect(proximaAcao(estado({ indice: 99 }), AGORA)).toEqual({ tipo: "fechar_volta" });
  });

  it("so reinicia depois que a volta anterior fechou", () => {
    const s = estado({ indice: 2, volta_completa: "2026-08-05T23:00:00Z" });
    expect(proximaAcao(s, AGORA)).toEqual({ tipo: "iniciar_volta" });
  });

  it("volta fechada reinicia mesmo com fila e indice no meio", () => {
    const s = estado({ indice: 1, volta_completa: "2026-08-05T23:00:00Z" });
    expect(proximaAcao(s, AGORA)).toEqual({ tipo: "iniciar_volta" });
  });

  it("fase catalogo sempre inicia volta", () => {
    expect(proximaAcao(estado({ fase: "catalogo", fila: [] }), AGORA))
      .toEqual({ tipo: "iniciar_volta" });
  });

  it("fila vazia com volta aberta fecha em vez de girar em falso", () => {
    expect(proximaAcao(estado({ fase: "estoque", fila: [], indice: 0 }), AGORA))
      .toEqual({ tipo: "fechar_volta" });
  });

  it("indice negativo nao faz a varredura andar para tras", () => {
    expect(proximaAcao(estado({ indice: -5 }), AGORA))
      .toEqual({ tipo: "seguir_estoque", de: 0 });
  });

  it("a decisao nao depende de `agora` — mesma entrada, mesma acao em qualquer data", () => {
    const s = estado({ indice: 1 });
    const datas = [
      new Date("2026-08-05T23:59:59Z"),
      new Date("2026-08-06T00:00:01Z"),
      new Date("2027-01-01T12:00:00Z"),
    ];
    const acoes = datas.map((d) => proximaAcao(s, d));
    expect(acoes).toEqual([
      { tipo: "seguir_estoque", de: 1 },
      { tipo: "seguir_estoque", de: 1 },
      { tipo: "seguir_estoque", de: 1 },
    ]);
  });
});
