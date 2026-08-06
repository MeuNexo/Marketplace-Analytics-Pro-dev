import { describe, expect, it } from "vitest";
import { datasAlvoDoSyncDiario, faturasQueCobrem, normalizarFatura } from "./periodos";

// Fixtures com a forma REAL medida em 2026-08-06, não inventada:
//
// Junior (seller 2359559427) — ciclo 16→15. Confirmado pelos charge_date em
// ml_billing_daily: a fatura `2026-08-01` traz lançamentos de 2026-07-16 a
// 2026-08-06, e a `2026-07-01` (531 linhas, R$ 10.616,60) cobre 16/06–15/07.
const PERIODOS_JUNIOR = [
  { key: "2026-08-01", period: { date_from: "2020-01-01", date_to: "2026-08-15" } }, // ABERTA: date_from é placeholder
  { key: "2026-07-01", period: { date_from: "2026-06-16", date_to: "2026-07-15" } },
  { key: "2026-06-01", period: { date_from: "2026-05-16", date_to: "2026-06-15" } },
];

// Pé Vermeio (seller 1639558873) — ciclo 06→05. Confirmado pelos charge_date:
// `2026-08-01` cobre 06/07–05/08 e `2026-09-01` cobre 06/08 em diante.
const PERIODOS_PE_VERMEIO = [
  { key: "2026-09-01", period: { date_from: "2020-01-01", date_to: "2026-09-05" } }, // ABERTA
  { key: "2026-08-01", period: { date_from: "2026-07-06", date_to: "2026-08-05" } },
  { key: "2026-07-01", period: { date_from: "2026-06-06", date_to: "2026-07-05" } },
];

describe("normalizarFatura", () => {
  it("corrige o date_from placeholder do período ABERTO para date_to − 1 mês + 1 dia", () => {
    const f = normalizarFatura(PERIODOS_JUNIOR[0]);
    // Sem a correção, a janela seria 2020-01-01..2026-08-15 e esta fatura
    // "cobriria" qualquer data, engolindo a seleção inteira.
    expect(f).toEqual({ key: "2026-08-01", from: "2026-07-16", to: "2026-08-15" });
  });

  it("preserva a janela de um período FECHADO, que já vem correta", () => {
    expect(normalizarFatura(PERIODOS_JUNIOR[1])).toEqual({
      key: "2026-07-01", from: "2026-06-16", to: "2026-07-15",
    });
  });

  it("aceita data com hora (a API do ML já devolveu os dois formatos)", () => {
    const f = normalizarFatura({
      key: "2026-07-01",
      period: { date_from: "2026-06-16T00:00:00.000-04:00", date_to: "2026-07-15T23:59:59.000-04:00" },
    });
    expect(f).toEqual({ key: "2026-07-01", from: "2026-06-16", to: "2026-07-15" });
  });

  it("devolve null quando não dá para montar janela (sem key, sem from, sem to)", () => {
    expect(normalizarFatura({ period: { date_from: "2026-06-16", date_to: "2026-07-15" } })).toBeNull();
    expect(normalizarFatura({ key: "2026-07-01", period: { date_to: "2026-07-15" } })).toBeNull();
    expect(normalizarFatura({ key: "2026-07-01" })).toBeNull();
    expect(normalizarFatura(null)).toBeNull();
  });
});

describe("faturasQueCobrem — o defeito do BILL-02", () => {
  it("Junior (ciclo 16→15): pega a fatura ABERTA e a FECHADA anterior", () => {
    // ESTE É O TESTE QUE PROVA O BUG. Em 06/08, a régua antiga derivava do mês
    // do calendário: period_month=2026-07 → faturas `2026-08` e `2026-09`.
    // A `2026-07-01` — a fechada anterior, com 2.086 movimentos — NUNCA era
    // pedida, e por isso nunca entrou no banco.
    const datas = datasAlvoDoSyncDiario("2026-08-06");
    const keys = faturasQueCobrem(PERIODOS_JUNIOR, datas).map((f) => f.key);
    expect(keys).toEqual(["2026-08-01", "2026-07-01"]);
    expect(keys).toContain("2026-07-01");
  });

  it("Pé Vermeio (ciclo 06→05): pega a aberta e a fechada anterior", () => {
    const datas = datasAlvoDoSyncDiario("2026-08-06");
    const keys = faturasQueCobrem(PERIODOS_PE_VERMEIO, datas).map((f) => f.key);
    expect(keys).toEqual(["2026-09-01", "2026-08-01"]);
  });

  it("não repete fatura quando as duas datas caem na mesma janela", () => {
    // Duas datas dentro do mesmo ciclo 16→15 do Junior (16/06–15/07).
    // A fatura tem de sair UMA vez, não duas.
    const keys = faturasQueCobrem(PERIODOS_JUNIOR, ["2026-06-20", "2026-07-10"]).map((f) => f.key);
    expect(keys).toEqual(["2026-07-01"]);
  });

  it("a correção de 60 dias é um limite conhecido: janela legitimamente longa é encolhida", () => {
    // Documentado, não desejado. A heurística herdada de `resolveInvoice` não
    // distingue "período aberto com date_from placeholder" de "período
    // genuinamente longo" — encolhe os dois. Como o ciclo de faturamento do ML
    // é mensal, isso não morde hoje. Se algum dia existir fatura com janela
    // maior que 60 dias, ESTE teste é o aviso de que a régua precisa mudar.
    const longa = [{ key: "2026-Q3", period: { date_from: "2026-07-01", date_to: "2026-09-30" } }];
    expect(normalizarFatura(longa[0])).toEqual({ key: "2026-Q3", from: "2026-08-31", to: "2026-09-30" });
    expect(faturasQueCobrem(longa, ["2026-08-06"])).toEqual([]);
  });

  it("devolve vazio quando nenhuma fatura cobre as datas — quem chama cai no fallback", () => {
    expect(faturasQueCobrem(PERIODOS_JUNIOR, ["2019-01-01"])).toEqual([]);
    expect(faturasQueCobrem([], ["2026-08-06"])).toEqual([]);
  });

  it("ignora período sem janela em vez de quebrar a seleção inteira", () => {
    const comLixo = [{ key: "sem-janela" }, ...PERIODOS_JUNIOR];
    const keys = faturasQueCobrem(comLixo, datasAlvoDoSyncDiario("2026-08-06")).map((f) => f.key);
    expect(keys).toEqual(["2026-08-01", "2026-07-01"]);
  });
});

describe("datasAlvoDoSyncDiario", () => {
  it("devolve hoje e hoje−30, para cair na fatura anterior em qualquer ciclo mensal", () => {
    expect(datasAlvoDoSyncDiario("2026-08-06")).toEqual(["2026-08-06", "2026-07-07"]);
  });

  it("atravessa virada de ano sem estragar a data", () => {
    expect(datasAlvoDoSyncDiario("2026-01-10")).toEqual(["2026-01-10", "2025-12-11"]);
  });

  it("devolve vazio para data inválida, em vez de inventar janela", () => {
    expect(datasAlvoDoSyncDiario("nao-e-data")).toEqual([]);
  });
});
