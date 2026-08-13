import { UF_REGION } from "@/lib/tax/regions";
import {
  UFS_BRASIL,
  normalizarListaUf,
  listaUfParaBanco,
  normalizarCustoEntrega,
} from "./fiscalConfig";

// ─── UFS_BRASIL ─────────────────────────────────────────────────────────────

describe("UFS_BRASIL", () => {
  it("tem exatamente 27 siglas", () => {
    expect(UFS_BRASIL.length).toBe(27);
  });

  it("é idêntica à lista de siglas do módulo fiscal compartilhado — não é uma segunda lista digitada à mão", () => {
    expect([...UFS_BRASIL]).toEqual(Object.keys(UF_REGION).sort());
  });

  it("está ordenada", () => {
    expect([...UFS_BRASIL]).toEqual([...UFS_BRASIL].sort());
  });
});

// ─── normalizarListaUf ──────────────────────────────────────────────────────

describe("normalizarListaUf", () => {
  it("null devolve valor null (estado 'ainda não definido' preservado)", () => {
    const resultado = normalizarListaUf(null);
    expect(resultado.valor).toBeNull();
    expect(resultado.descartadas).toEqual([]);
  });

  it("array vazio devolve valor array vazio (estado 'definido: nenhuma')", () => {
    const resultado = normalizarListaUf([]);
    expect(resultado.valor).toEqual([]);
    expect(resultado.descartadas).toEqual([]);
  });

  it("normaliza caixa, espaços e ordena", () => {
    const resultado = normalizarListaUf(["sp", " mg "]);
    expect(resultado.valor).toEqual(["MG", "SP"]);
  });

  it("remove repetição, inclusive quando a mesma UF chega em caixas diferentes", () => {
    const resultado = normalizarListaUf(["SP", "sp", "Sp"]);
    expect(resultado.valor).toEqual(["SP"]);
  });

  it("descarta sigla inválida e informa qual foi descartada, sem falhar em silêncio", () => {
    const resultado = normalizarListaUf(["SP", "XX"]);
    expect(resultado.valor).toEqual(["SP"]);
    expect(resultado.descartadas).toEqual(["XX"]);
  });

  it("ignora entradas em branco sem contá-las como descarte", () => {
    const resultado = normalizarListaUf(["", "  ", "SP"]);
    expect(resultado.valor).toEqual(["SP"]);
    expect(resultado.descartadas).toEqual([]);
  });

  it("aceita todas as 27 UFs válidas sem descartar nenhuma", () => {
    const resultado = normalizarListaUf([...UFS_BRASIL]);
    expect(resultado.valor).toEqual([...UFS_BRASIL]);
    expect(resultado.descartadas).toEqual([]);
  });
});

// ─── listaUfParaBanco ───────────────────────────────────────────────────────

describe("listaUfParaBanco", () => {
  it("definido falso devolve null independentemente do que está selecionado", () => {
    expect(listaUfParaBanco(false, ["SP", "MG"])).toBeNull();
    expect(listaUfParaBanco(false, [])).toBeNull();
  });

  it("definido verdadeiro e nada selecionado devolve array vazio", () => {
    expect(listaUfParaBanco(true, [])).toEqual([]);
  });

  it("definido verdadeiro e siglas selecionadas devolve as siglas normalizadas", () => {
    expect(listaUfParaBanco(true, ["sp", "mg", "mg"])).toEqual(["MG", "SP"]);
  });

  it("os três estados produzem três valores gravados diferentes entre si", () => {
    const naoDefinido = listaUfParaBanco(false, []);
    const definidoVazio = listaUfParaBanco(true, []);
    const definidoComSiglas = listaUfParaBanco(true, ["SP"]);

    expect(naoDefinido).not.toEqual(definidoVazio);
    expect(definidoVazio).not.toEqual(definidoComSiglas);
    expect(naoDefinido).toBeNull();
    expect(definidoVazio).toEqual([]);
    expect(definidoComSiglas).toEqual(["SP"]);
  });
});

// ─── Ida e volta: banco → estado do formulário → banco ─────────────────────
//
// Helper local só do teste (não exportado do módulo — não faz parte da API
// pública que o plano exige). Espelha como a tela vai derivar o estado do
// interruptor "já defini" a partir do valor lido do banco.
function bancoParaEstadoDoFormulario(valorNoBanco: string[] | null): {
  definido: boolean;
  selecionadas: string[];
} {
  return { definido: valorNoBanco !== null, selecionadas: valorNoBanco ?? [] };
}

describe("ida e volta — banco → formulário → banco", () => {
  it("banco null vira definido falso, e volta ao banco como null", () => {
    const estado = bancoParaEstadoDoFormulario(null);
    expect(estado.definido).toBe(false);
    expect(estado.selecionadas).toEqual([]);

    const devolta = listaUfParaBanco(estado.definido, estado.selecionadas);
    expect(devolta).toBeNull();
  });

  it("banco array vazio vira definido verdadeiro com nada selecionado, e volta ao banco como array vazio", () => {
    const estado = bancoParaEstadoDoFormulario([]);
    expect(estado.definido).toBe(true);
    expect(estado.selecionadas).toEqual([]);

    const devolta = listaUfParaBanco(estado.definido, estado.selecionadas);
    expect(devolta).toEqual([]);
  });

  it("banco com siglas vira definido verdadeiro com a seleção correspondente, e volta ao banco com as mesmas siglas", () => {
    const original = ["MG", "SP"];
    const estado = bancoParaEstadoDoFormulario(original);
    expect(estado.definido).toBe(true);
    expect(estado.selecionadas).toEqual(original);

    const devolta = listaUfParaBanco(estado.definido, estado.selecionadas);
    expect(devolta).toEqual(original);
  });
});

// ─── normalizarCustoEntrega ─────────────────────────────────────────────────

describe("normalizarCustoEntrega", () => {
  it("campo em branco devolve null (ausência: ainda não informado)", () => {
    expect(normalizarCustoEntrega("")).toBeNull();
  });

  it("campo só com espaço devolve null", () => {
    expect(normalizarCustoEntrega("   ")).toBeNull();
  });

  it("'0' é gravado como zero, NUNCA como null — a regressão que este módulo existe para impedir", () => {
    expect(normalizarCustoEntrega("0")).toBe(0);
    expect(normalizarCustoEntrega("0")).not.toBeNull();
  });

  it("aceita vírgula decimal, como se digita em português", () => {
    expect(normalizarCustoEntrega("4,50")).toBe(4.5);
  });

  it("aceita ponto decimal", () => {
    expect(normalizarCustoEntrega("4.50")).toBe(4.5);
  });

  it("aceita valor inteiro sem casas decimais", () => {
    expect(normalizarCustoEntrega("10")).toBe(10);
  });

  it("valor negativo devolve null", () => {
    expect(normalizarCustoEntrega("-3")).toBeNull();
    expect(normalizarCustoEntrega("-0,01")).toBeNull();
  });

  it("valor não numérico devolve null", () => {
    expect(normalizarCustoEntrega("abc")).toBeNull();
    expect(normalizarCustoEntrega("R$ 10")).toBeNull();
  });
});
