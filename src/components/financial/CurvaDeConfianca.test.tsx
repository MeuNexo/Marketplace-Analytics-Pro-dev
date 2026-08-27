// ============================================================================
// 233-04 — o portão por FORMA da curva de confiança
//
// 🔴 O DEFEITO QUE ESTE ARQUIVO TRAVA, visto pelo Wesley em 27/08/2026: a tela
// mostrava seis barras, D+1 a D+6, e o resto da faixa sumia SEM PALAVRA. O
// cabeçalho do componente já declarava a intenção certa — lacuna declarada,
// nunca zero — e o código cumpria só metade: não virava barra, mas também não
// era declarada.
//
// 🔴 O PORTÃO VARRE POR PROPRIEDADE, não pelos seis horizontes de hoje. Um
// portão que só conhecesse a amostra atual passaria verde no dia em que a
// amostra mudasse — foi exatamente assim que o 233-03 reprovou: 59 testes verdes
// provaram uma identidade matemática correta sobre a variável errada.
//
// ── 233-07 Task 3 (D-14) ──────────────────────────────────────────────────────
// 🔴 O COMPONENTE MUDOU DE PROPÓSITO, e este arquivo muda junto: as barras por
// horizonte e os parágrafos de lacuna SAÍRAM de `CurvaDeConfianca` — viraram a
// coluna de confiança de `SaldoEConfiancaPorDia`, linha a linha (233-TEXTO.md).
// O portão NÃO foi esvaziado, ele MUDOU DE DONO:
//
//   - "PORTÃO POR FORMA — nenhum horizonte da faixa some sem palavra" (4 testes,
//     varredura por propriedade sobre `blocosDeclarados`/`data-horizontes`) e
//     "as duas escassezes saem separadas por NOME" (3 testes) MIGRARAM para
//     `SaldoEConfiancaPorDia.test.tsx`, describe "🔴 PORTÃO POR FORMA — migrado
//     de CurvaDeConfianca.test.tsx (233-07 Task 3)". A propriedade que eles
//     provam (faixa 1..30 inteira, motivo nomeado em toda ausência, zero
//     percentual sem par) é exatamente a mesma — só o componente sob teste
//     mudou, porque a responsabilidade mudou.
//   - O que fica AQUI (o veredito vem primeiro, as proibições da fase) segue
//     porque é exatamente o que o componente ainda faz: uma frase, o `n`, e o
//     selo de direção do viés.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurvaDeConfiancaView } from "./CurvaDeConfianca";
import { confiancaDoSaldo, preencherFaixa, type PontoDeConfianca } from "@/lib/confiancaDoSaldo";
import type { ConfiancaDoSaldoData } from "@/hooks/useConfiancaDoSaldo";

const MIN = 1;
const MAX = 30;

/** O primeiro snapshot de `saldo_projetado` é de 2026-08-21 (233-MEDICOES). */
const INICIO_DA_SERIE = "2026-08-21";

const somaDias = (iso: string, dias: number): string => {
  const [a, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
};

const medido = (h: number, conf: number, n = 1) => ({
  horizon_days: h, n_pares: n, erro_pct: 100 - conf, confianca_pct: conf,
  primeiro_alvo: "2026-08-27", ultimo_alvo: "2026-08-27",
  motivo_ausencia: null, medivel_em: null,
});

const calendario = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "serie_curta", medivel_em: somaDias(INICIO_DA_SERIE, h),
});

function montar(pontos: PontoDeConfianca[]): ConfiancaDoSaldoData {
  const medidos = pontos.filter((p) => p.estado === "medido");
  const totalPares = medidos.reduce((s, p) => s + p.n_pares, 0);
  return {
    pontos,
    melhor: medidos[0] ?? null,
    pior: medidos[medidos.length - 1] ?? null,
    totalPares,
    diasDeSerie: 1,
    selo: "Amostra provisória: o número real tende a ser PIOR, não melhor.",
  };
}

/** A amostra REAL de 27/08: seis medidos, o resto por calendário. */
const AMOSTRA_DE_HOJE = preencherFaixa(
  confiancaDoSaldo([
    medido(1, 65.9), medido(2, 49.7), medido(3, 78.3),
    medido(4, 92.8), medido(5, 94.8), medido(6, 85.2),
    ...Array.from({ length: 24 }, (_, i) => calendario(i + 7)),
  ]),
  MIN,
  MAX,
);

/** Nada medido, tudo por calendário — usada no teste de "sem nenhum horizonte medido". */
const NADA_MEDIDO = preencherFaixa(
  confiancaDoSaldo(Array.from({ length: MAX }, (_, i) => calendario(i + 1))),
  MIN, MAX,
);

/** Amostra madura — usada no teste de "amostra grande tira a ressalva". */
const TUDO_MEDIDO = preencherFaixa(
  confiancaDoSaldo(Array.from({ length: MAX }, (_, i) => medido(i + 1, 50 + i, 8))),
  MIN, MAX,
);

describe("o veredito vem PRIMEIRO — é ele que responde 'até onde posso confiar'", () => {
  it("diz até que prazo há medição, quanto é, e sobre quantos pares", () => {
    render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    const veredito = screen.getByTestId("veredito-confianca");
    expect(veredito.textContent).toMatch(/D\+6/);
    expect(veredito.textContent).toMatch(/85/);
    expect(veredito.textContent).toMatch(/par|pares|observaç/);
  });

  it("🔴 D4 — com UMA observação por prazo, o bloco diz em palavras que não é tendência", () => {
    render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(screen.getByTestId("veredito-confianca").textContent).toMatch(/não é tendência/i);
  });

  it("com amostra grande a ressalva de tendência sai de cena", () => {
    render(<CurvaDeConfiancaView data={montar(TUDO_MEDIDO)} />);
    expect(screen.getByTestId("veredito-confianca").textContent).not.toMatch(/não é tendência/i);
  });

  it("sem nenhum horizonte medido o veredito diz isso", () => {
    render(<CurvaDeConfiancaView data={montar(NADA_MEDIDO)} />);
    expect(screen.getByTestId("veredito-confianca").textContent).toMatch(/ainda não há|nenhum/i);
  });
});

describe("233-07 Task 3 — o que SAIU da curva não aparece mais aqui", () => {
  it("nenhuma barra por horizonte e nenhum parágrafo de lacuna sobrevive — não há `[data-horizontes]`", () => {
    const { container } = render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(container.querySelectorAll("[data-horizontes]")).toHaveLength(0);
  });

  it("o `n pares · dias de série` continua à vista, junto do rótulo", () => {
    render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(screen.getByText(/pares? ·/)).toBeInTheDocument();
  });
});

describe("as proibições da fase continuam de pé", () => {
  it("o selo de provisório fica, marcado `data-aviso=\"vies-provisorio\"`, e diz a direção do viés", () => {
    const { container } = render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(screen.getByText(/PIOR/)).toBeInTheDocument();
    const aviso = container.querySelector('[data-aviso="vies-provisorio"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toMatch(/PIOR/);
  });

  it("nenhum limiar de tolerância, nenhum semáforo: sem 'confiável' nem cor de veredito", () => {
    const { container } = render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(container.textContent).not.toMatch(/confiável|aceitável|bom|ruim|dentro do limite/i);
    expect(container.innerHTML).not.toMatch(/text-(red|green|emerald)-|bg-(red|green|emerald)-/);
  });

  it("carregando e erro são estados, não tela em branco", () => {
    const { container: c1 } = render(<CurvaDeConfiancaView data={null} isLoading />);
    expect(c1.innerHTML).not.toBe("");
    render(<CurvaDeConfiancaView data={null} error={new Error("estourou")} />);
    expect(screen.getByText(/Não foi possível carregar/)).toBeInTheDocument();
  });

  it("não lança com data nula nem com lista vazia", () => {
    expect(() => render(<CurvaDeConfiancaView data={null} />)).not.toThrow();
    expect(() => render(<CurvaDeConfiancaView data={montar([])} />)).not.toThrow();
  });
});
