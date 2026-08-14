/**
 * taxConfigVigente.test.ts — prova sem rede de `resolverConfigVigente`
 * (Fase 222, plano 222-05-R).
 *
 * O caso que este módulo existe para impedir está em cada teste de borda: a
 * config do Junior (loja 2359559427) mudou de 6% para 4% em 11/08/2026 e 352
 * pedidos de 01 a 10/08 foram REGRAVADOS com 4%, porque quem recalculava lia
 * "a config que está gravada agora" em vez de "a config que valia na data do
 * pedido". Por isso os testes de borda usam 2026-06-30 / 2026-07-01: é a
 * fronteira real das duas vigências daquela loja.
 *
 * Fixture no molde de `tabelaUf.test.ts`: builder com spread, um campo variando
 * por caso.
 */
import { describe, it, expect } from "vitest";
import { resolverConfigVigente, type LinhaTaxConfigVigencia } from "./taxConfigVigente";

/** Linha válida mínima, vigência aberta desde sempre. */
const cfg = (over: Partial<LinhaTaxConfigVigencia> = {}): LinhaTaxConfigVigencia => ({
  ml_user_id: "2359559427",
  regime: "simples_nacional",
  uf_origem: "SP",
  sn_aliquota_efetiva: 4,
  lp_pis: null,
  lp_cofins: null,
  lp_irpj: null,
  lp_csll: null,
  lr_icms_aliquota_intra: null,
  lr_icms_aliquota_inter_sul_sudeste: null,
  lr_icms_aliquota_inter_norte_nordeste: null,
  lr_icms_debito: null,
  vigencia_inicio: "2020-01-01",
  vigencia_fim: null,
  ...over,
});

/** As duas vigências reais do Junior, confirmadas pelo Wesley em 14/08/2026. */
const VIGENCIA_6 = cfg({
  sn_aliquota_efetiva: 6,
  vigencia_inicio: "2020-01-01",
  vigencia_fim: "2026-06-30",
});
const VIGENCIA_4 = cfg({
  sn_aliquota_efetiva: 4,
  vigencia_inicio: "2026-07-01",
  vigencia_fim: null,
});

describe("resolverConfigVigente", () => {
  // ── Ausência ────────────────────────────────────────────────────────────

  it("lista vazia devolve null — a loja não tem config nenhuma", () => {
    expect(resolverConfigVigente([], "2026-08-01")).toBeNull();
  });

  it("null/undefined devolvem null, nunca lançam", () => {
    expect(resolverConfigVigente(null, "2026-08-01")).toBeNull();
    expect(resolverConfigVigente(undefined, "2026-08-01")).toBeNull();
  });

  it("data ausente devolve null — nunca a vigência aberta por omissão", () => {
    expect(resolverConfigVigente([VIGENCIA_4], null)).toBeNull();
    expect(resolverConfigVigente([VIGENCIA_4], undefined)).toBeNull();
  });

  it("data que não tem a forma ano-mês-dia devolve null, nunca chute", () => {
    expect(resolverConfigVigente([VIGENCIA_4], "01/07/2026")).toBeNull();
    expect(resolverConfigVigente([VIGENCIA_4], "ontem")).toBeNull();
    expect(resolverConfigVigente([VIGENCIA_4], "")).toBeNull();
  });

  // ── Seleção ─────────────────────────────────────────────────────────────

  it("data dentro de uma vigência fechada devolve aquela linha", () => {
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-05-15")).toBe(VIGENCIA_6);
  });

  it("data dentro da vigência aberta (fim ausente) devolve aquela linha", () => {
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-08-10")).toBe(VIGENCIA_4);
  });

  it("duas vigências não sobrepostas: cada data cai na sua — a prova do Junior", () => {
    const lista = [VIGENCIA_6, VIGENCIA_4];
    expect(resolverConfigVigente(lista, "2026-05-31")?.sn_aliquota_efetiva).toBe(6);
    expect(resolverConfigVigente(lista, "2026-06-15")?.sn_aliquota_efetiva).toBe(6);
    expect(resolverConfigVigente(lista, "2026-07-15")?.sn_aliquota_efetiva).toBe(4);
    expect(resolverConfigVigente(lista, "2026-08-14")?.sn_aliquota_efetiva).toBe(4);
  });

  it("data anterior a toda vigência devolve null — jamais a mais antiga por aproximação", () => {
    const lista = [
      cfg({ vigencia_inicio: "2026-01-01", vigencia_fim: "2026-06-30" }),
      cfg({ vigencia_inicio: "2026-07-01", vigencia_fim: null }),
    ];
    expect(resolverConfigVigente(lista, "2025-12-31")).toBeNull();
  });

  it("data posterior a toda vigência fechada devolve null — nenhuma linha cobre", () => {
    const lista = [cfg({ vigencia_inicio: "2020-01-01", vigencia_fim: "2026-06-30" })];
    expect(resolverConfigVigente(lista, "2026-07-01")).toBeNull();
  });

  // ── Bordas ──────────────────────────────────────────────────────────────

  it("borda inicial é inclusiva: pedido no dia do início pertence à vigência", () => {
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-07-01")).toBe(VIGENCIA_4);
  });

  it("borda final é inclusiva: pedido no dia do fim pertence à vigência", () => {
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-06-30")).toBe(VIGENCIA_6);
  });

  // ── Formato da data ─────────────────────────────────────────────────────

  it("data com carimbo de hora é aceita pelos 10 primeiros caracteres", () => {
    // `orders.data_pedido` é TEXT e parte do histórico traz carimbo de hora.
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-06-30T22:00:00Z")).toBe(
      VIGENCIA_6,
    );
    expect(resolverConfigVigente([VIGENCIA_6, VIGENCIA_4], "2026-07-01 03:00:00")).toBe(
      VIGENCIA_4,
    );
  });

  // ── Compatibilidade com o banco ainda não migrado ────────────────────────

  it("linha sem campo de início é vigência aberta desde sempre (banco pré-migration)", () => {
    const semVigencia = { ...cfg() } as LinhaTaxConfigVigencia;
    delete semVigencia.vigencia_inicio;
    delete semVigencia.vigencia_fim;
    expect(resolverConfigVigente([semVigencia], "2019-01-01")).toBe(semVigencia);
    expect(resolverConfigVigente([semVigencia], "2026-08-14")).toBe(semVigencia);
  });

  it("linha com limite ilegível é DESCARTADA, nunca promovida a aberta desde sempre", () => {
    const lixo = cfg({ vigencia_inicio: "01/07/2026" });
    expect(resolverConfigVigente([lixo], "2026-08-14")).toBeNull();
  });

  // ── Sobreposição ────────────────────────────────────────────────────────

  it("duas vigências cobrindo a mesma data lançam erro nomeando loja e data", () => {
    const lista = [
      cfg({ vigencia_inicio: "2020-01-01", vigencia_fim: "2026-07-31" }),
      cfg({ vigencia_inicio: "2026-07-01", vigencia_fim: null }),
    ];
    expect(() => resolverConfigVigente(lista, "2026-07-15")).toThrow(/2359559427/);
    expect(() => resolverConfigVigente(lista, "2026-07-15")).toThrow(/2026-07-15/);
  });

  it("sobreposição fora da data consultada não atrapalha a resolução", () => {
    const lista = [
      cfg({ sn_aliquota_efetiva: 6, vigencia_inicio: "2020-01-01", vigencia_fim: "2026-07-31" }),
      cfg({ sn_aliquota_efetiva: 4, vigencia_inicio: "2026-07-01", vigencia_fim: null }),
    ];
    expect(resolverConfigVigente(lista, "2026-05-01")?.sn_aliquota_efetiva).toBe(6);
  });

  // ── Pureza ──────────────────────────────────────────────────────────────

  it("devolve a MESMA linha recebida, sem cópia e sem coagir número nenhum", () => {
    const linha = cfg({ sn_aliquota_efetiva: 4 });
    const resolvida = resolverConfigVigente([linha], "2026-08-14");
    expect(resolvida).toBe(linha);
  });
});
