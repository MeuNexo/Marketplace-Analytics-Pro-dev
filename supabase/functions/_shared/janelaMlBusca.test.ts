/**
 * janelaMlBusca.test.ts — a régua da busca de pedidos do ML, provada por
 * COMPORTAMENTO (Fase 225, plano 225-10).
 *
 * O portão de forma de `sync-ml-orders` prova que o código tem a FORMA certa:
 * uma régua só, o filtro antes do enriquecimento, a repescagem chegando à porta
 * que cria linha. Ele não prova que a aritmética CALCULA certo — e o desenho
 * inteiro da repescagem repousa em aritmética de data: a janela de 30 dias, o
 * rodízio de blocos, o gatilho em D−3, a virada de mês e de ano.
 *
 * `janelaDataPedido.ts` está nesta pasta justamente porque um erro de fronteira
 * de data passou meses invisível em produção. Este arquivo existe para que o
 * próximo não passe.
 */
import { describe, it, expect } from "vitest";
import {
  janelaBRT,
  deslocarDia,
  diasDaJanela,
  hojeBRT,
  temAssinaturaDaRodadaDiaria,
  blocoDaRepescagem,
  REPESCAGEM_JANELA_DIAS,
  REPESCAGEM_TETO_DIAS,
  REPESCAGEM_DIA_GATILHO,
} from "./janelaMlBusca.ts";

describe("janelaBRT — meia-noite BRT é 03:00Z, e o fim é o último milissegundo", () => {
  it("um dia vai de 03:00Z a 02:59:59.999Z do dia seguinte", () => {
    const { rangeStart, rangeEnd } = janelaBRT("2026-09-01", "2026-09-01");
    expect(rangeStart.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(rangeEnd.toISOString()).toBe("2026-09-02T02:59:59.999Z");
  });

  it("janela longa fecha no fim do último dia, não no começo do seguinte", () => {
    // O ML trata `order.date_created.to` como INCLUSIVO: fechar em
    // `2026-09-01T00:00:00Z` traria o primeiro instante do dia seguinte.
    const { rangeEnd } = janelaBRT("2026-05-01", "2026-08-31");
    expect(rangeEnd.toISOString()).toBe("2026-09-01T02:59:59.999Z");
  });

  it("a janela de um dia e a de uma faixa coincidem na borda", () => {
    const dia    = janelaBRT("2026-08-31", "2026-08-31");
    const faixa  = janelaBRT("2026-05-01", "2026-08-31");
    expect(dia.rangeEnd.toISOString()).toBe(faixa.rangeEnd.toISOString());
  });
});

describe("deslocarDia — virada de mês, de ano e fevereiro saem de graça", () => {
  it.each([
    ["2026-09-04", -3,  "2026-09-01", "dentro do mês"],
    ["2026-09-01", -1,  "2026-08-31", "virada de mês"],
    ["2026-03-01", -1,  "2026-02-28", "virada de fevereiro (2026 não é bissexto)"],
    ["2024-03-01", -1,  "2024-02-29", "virada de fevereiro bissexto"],
    ["2026-01-01", -1,  "2025-12-31", "virada de ano"],
    ["2025-12-31", +1,  "2026-01-01", "virada de ano para a frente"],
    ["2026-09-04", -30, "2026-08-05", "a janela inteira da repescagem"],
    ["2026-09-04",   0, "2026-09-04", "passo zero é identidade"],
  ])("%s %+d = %s (%s)", (dia, passos, esperado) => {
    expect(deslocarDia(dia, passos as number)).toBe(esperado);
  });

  it("ida e volta é identidade em qualquer ponta do ano", () => {
    for (const dia of ["2026-01-01", "2026-02-28", "2026-06-15", "2026-12-31"]) {
      expect(deslocarDia(deslocarDia(dia, -30), 30)).toBe(dia);
    }
  });
});

describe("diasDaJanela — sem furo, sem repetição, sem surpresa na borda", () => {
  it("a janela de 30 dias da repescagem tem 31 dias inclusivos e pontas certas", () => {
    const d = diasDaJanela("2026-08-05", "2026-09-04");
    expect(d).toHaveLength(31);
    expect(d[0]).toBe("2026-08-05");
    expect(d[30]).toBe("2026-09-04");
    expect(new Set(d).size).toBe(31);
  });

  it("os meses que tiveram perda no censo dão 123 dias", () => {
    expect(diasDaJanela("2026-05-01", "2026-08-31")).toHaveLength(123);
  });

  it("janela de um dia dá um dia", () => {
    expect(diasDaJanela("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
  });

  it("janela invertida dá lista VAZIA, sem lançar", () => {
    expect(diasDaJanela("2026-09-05", "2026-09-01")).toEqual([]);
  });

  it("atravessa a virada de ano sem pular nem repetir dia", () => {
    const d = diasDaJanela("2025-12-30", "2026-01-02");
    expect(d).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });
});

describe("hojeBRT — o dia BRT, nunca o UTC", () => {
  it.each([
    ["2026-09-04T09:00:00Z", "2026-09-04", "hora do cron diário, mesmo dia"],
    ["2026-09-05T02:00:00Z", "2026-09-04", "02:00Z ainda é o dia BRT ANTERIOR"],
    ["2026-09-05T02:59:59Z", "2026-09-04", "o último segundo antes da virada"],
    ["2026-09-05T03:00:00Z", "2026-09-05", "03:00Z é exatamente a virada"],
    ["2026-01-01T01:00:00Z", "2025-12-31", "virada de ano em UTC ainda é o ano anterior em BRT"],
  ])("%s = %s (%s)", (instante, esperado) => {
    expect(hojeBRT(new Date(instante))).toBe(esperado);
  });
});

describe("temAssinaturaDaRodadaDiaria — dispara em D−3 e só nele", () => {
  const hoje = "2026-09-04";

  it("o job mais antigo da rodada diária dispara", () => {
    expect(temAssinaturaDaRodadaDiaria("2026-09-01", "2026-09-01", hoje)).toBe(true);
  });

  it.each([
    ["2026-09-02", "D−2, também da rodada diária — não dispara de novo no mesmo dia"],
    ["2026-09-03", "D−1, idem"],
    ["2026-09-04", "o dia corrente, que é o do cron HORÁRIO"],
    ["2026-08-05", "um dia qualquer da janela"],
  ])("%s não dispara (%s)", (dia) => {
    expect(temAssinaturaDaRodadaDiaria(dia, dia, hoje)).toBe(false);
  });

  it("faixa de mais de um dia — a forma que a tela usa — nunca dispara", () => {
    expect(temAssinaturaDaRodadaDiaria("2026-09-01", "2026-09-03", hoje)).toBe(false);
    expect(temAssinaturaDaRodadaDiaria("2026-08-01", "2026-08-31", hoje)).toBe(false);
  });

  it("dispara EXATAMENTE uma vez por dia sobre os três jobs da rodada diária", () => {
    const disparos = [1, 2, 3]
      .map((i) => deslocarDia(hoje, -i))
      .filter((dia) => temAssinaturaDaRodadaDiaria(dia, dia, hoje));
    expect(disparos).toEqual([deslocarDia(hoje, -REPESCAGEM_DIA_GATILHO)]);
  });

  it("continua valendo na virada de mês", () => {
    expect(temAssinaturaDaRodadaDiaria("2026-08-29", "2026-08-29", "2026-09-01")).toBe(true);
  });
});

/**
 * Percorre 400 dias de calendário e, para cada um, registra em que rodadas ele é
 * examinado pelo rodízio. Devolve os três números que descrevem a latência de
 * recuperação — medidos, não supostos.
 */
function medirLatencia() {
  let piorPrimeiraVisita = 0;
  let maiorIntervalo = 0;
  let menosVisitas = Number.POSITIVE_INFINITY;
  const diasNuncaExaminados: string[] = [];

  for (let off = 0; off < 400; off++) {
    const dia = deslocarDia("2026-01-01", off);
    const visitas: number[] = [];
    for (let r = 1; r <= REPESCAGEM_JANELA_DIAS; r++) {
      const { de, ate } = blocoDaRepescagem(deslocarDia(dia, r));
      if (dia >= de && dia <= ate) visitas.push(r);
    }
    if (visitas.length === 0) { diasNuncaExaminados.push(dia); continue; }
    piorPrimeiraVisita = Math.max(piorPrimeiraVisita, visitas[0]);
    menosVisitas = Math.min(menosVisitas, visitas.length);
    for (let i = 1; i < visitas.length; i++) {
      maiorIntervalo = Math.max(maiorIntervalo, visitas[i] - visitas[i - 1]);
    }
  }
  return { piorPrimeiraVisita, maiorIntervalo, menosVisitas, diasNuncaExaminados };
}

describe("blocoDaRepescagem — o rodízio cobre os 30 dias sem furo e sem sobreposição", () => {
  it("os blocos particionam exatamente a janela de 30 dias", () => {
    const blocos = Math.ceil(REPESCAGEM_JANELA_DIAS / REPESCAGEM_TETO_DIAS);
    const cobertos = new Set<number>();
    for (let b = 0; b < blocos; b++) {
      const maisAntigo  = Math.min(REPESCAGEM_JANELA_DIAS, (b + 1) * REPESCAGEM_TETO_DIAS);
      const maisRecente = b * REPESCAGEM_TETO_DIAS + 1;
      for (let d = maisRecente; d <= maisAntigo; d++) {
        expect(cobertos.has(d), `o dia D−${d} cairia em dois blocos`).toBe(false);
        cobertos.add(d);
      }
    }
    expect(cobertos.size).toBe(REPESCAGEM_JANELA_DIAS);
  });

  it("nenhuma invocação examina mais que o teto", () => {
    for (let i = 0; i < 40; i++) {
      const b = blocoDaRepescagem(deslocarDia("2026-09-04", i));
      expect(b.dias).toBeLessThanOrEqual(REPESCAGEM_TETO_DIAS);
      expect(b.dias).toBeGreaterThan(0);
      expect(diasDaJanela(b.de, b.ate)).toHaveLength(b.dias);
    }
  });

  it("dias consecutivos caem em blocos distintos — o rodízio de fato roda", () => {
    const seq = [0, 1, 2].map((i) => blocoDaRepescagem(deslocarDia("2026-09-04", i)).bloco);
    expect(new Set(seq).size).toBe(3);
  });

  /**
   * 🔴 O QUE ESTE BLOCO MEDE, E POR QUE ELE SUBSTITUIU UMA ASSERÇÃO PIOR.
   *
   * A primeira versão afirmava "três rodadas seguidas cobrem os 30 dias" — e é
   * FALSO: como "hoje" anda um dia por rodada, os blocos escorregam junto e a
   * união de três rodadas deixa buracos de até dois dias no miolo. A asserção
   * estava errada, não o código.
   *
   * O que importa de verdade não é a cobertura de uma janela arbitrária de três
   * rodadas; é a LATÊNCIA: quanto tempo um pedido perdido espera até alguém
   * perguntar por ele, e quantas chances ele tem antes de a janela expirar.
   * Então o teste passou a MEDIR isso, dia a dia, sobre 400 dias de calendário.
   *
   * Os três números que ele fixa, todos medidos:
   *   • primeira visita em D+3, no PIOR caso;
   *   • no máximo 4 dias entre duas visitas;
   *   • no mínimo 9 visitas enquanto o dia está dentro da janela de 30.
   *
   * O primeiro é o que fecha o buraco de verdade: a rodada diária cobre D−1..D−3
   * e a repescagem olha o dia pela primeira vez em D+3. **Não sobra lacuna entre
   * as duas coberturas** — que era exatamente o que faltava, e o que fez 26
   * pedidos sumirem.
   */
  it("cada dia é examinado pela primeira vez em D+3 no pior caso — sem lacuna após a janela retroativa do cron", () => {
    const { piorPrimeiraVisita } = medirLatencia();
    expect(
      piorPrimeiraVisita,
      "abriu lacuna entre a cobertura D−1..D−3 do cron diário e a primeira olhada da repescagem",
    ).toBeLessThanOrEqual(REPESCAGEM_DIA_GATILHO);
  });

  it("nenhum dia fica mais de 4 dias sem ser reexaminado", () => {
    expect(medirLatencia().maiorIntervalo).toBeLessThanOrEqual(4);
  });

  it("todo dia tem pelo menos 9 chances antes de a janela de 30 dias expirar", () => {
    // Contra os ~12 dias do pior atraso de fechamento já medido (292h), 9
    // chances espalhadas por 30 dias é folga, não aperto.
    expect(medirLatencia().menosVisitas).toBeGreaterThanOrEqual(9);
  });

  it("nenhum dia do calendário fica órfão do rodízio", () => {
    expect(medirLatencia().diasNuncaExaminados).toEqual([]);
  });

  it("o bloco é determinístico: o mesmo dia dá sempre o mesmo bloco", () => {
    expect(blocoDaRepescagem("2026-09-04")).toEqual(blocoDaRepescagem("2026-09-04"));
  });

  it("a faixa devolvida nunca inclui hoje nem o futuro", () => {
    for (let i = 0; i < 10; i++) {
      const hoje = deslocarDia("2026-09-04", i);
      const b = blocoDaRepescagem(hoje);
      expect(b.ate < hoje, `a faixa ${b.de}..${b.ate} alcança ${hoje}`).toBe(true);
      expect(b.de >= deslocarDia(hoje, -REPESCAGEM_JANELA_DIAS)).toBe(true);
    }
  });
});
