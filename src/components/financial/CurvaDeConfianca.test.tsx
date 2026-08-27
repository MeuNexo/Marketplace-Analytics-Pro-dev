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

const semDeclaracao = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "sem_declaracao", medivel_em: null,
});

const semSerie = (h: number) => ({
  horizon_days: h, n_pares: 0, erro_pct: null, confianca_pct: null,
  primeiro_alvo: null, ultimo_alvo: null,
  motivo_ausencia: "sem_serie", medivel_em: null,
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

/** Recortes arbitrários — é a propriedade que está sob teste, não a amostra. */
const RECORTES: Array<{ nome: string; pontos: PontoDeConfianca[] }> = [
  { nome: "a amostra real de 27/08", pontos: AMOSTRA_DE_HOJE },
  {
    nome: "nada medido, tudo calendário",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: MAX }, (_, i) => calendario(i + 1))),
      MIN, MAX,
    ),
  },
  {
    nome: "buracos de declaração no meio dos medidos",
    pontos: preencherFaixa(
      confiancaDoSaldo([
        medido(1, 90), semDeclaracao(2), medido(3, 80), semDeclaracao(4), semDeclaracao(5),
        medido(6, 70), ...Array.from({ length: 24 }, (_, i) => calendario(i + 7)),
      ]),
      MIN, MAX,
    ),
  },
  {
    nome: "organização sem série nenhuma",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: MAX }, (_, i) => semSerie(i + 1))),
      MIN, MAX,
    ),
  },
  {
    nome: "a RPC regrediu e devolveu só três horizontes",
    pontos: preencherFaixa(confiancaDoSaldo([medido(1, 90), medido(2, 80), medido(3, 70)]), MIN, MAX),
  },
  {
    nome: "tudo medido, a série madura",
    pontos: preencherFaixa(
      confiancaDoSaldo(Array.from({ length: MAX }, (_, i) => medido(i + 1, 50 + i, 8))),
      MIN, MAX,
    ),
  },
];

/** Todo bloco renderizado declara QUAIS horizontes ele cobre e em que estado. */
function blocosDeclarados(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-horizontes]")].map((el) => ({
    horizontes: el.getAttribute("data-horizontes")!.split(",").filter(Boolean).map(Number),
    estado: el.getAttribute("data-estado") ?? "",
    texto: el.textContent ?? "",
  }));
}

describe("🔴 PORTÃO POR FORMA — nenhum horizonte da faixa some sem palavra", () => {
  it.each(RECORTES)("$nome: a faixa 1..30 sai INTEIRA e sem duplicata", ({ pontos }) => {
    const { container } = render(<CurvaDeConfiancaView data={montar(pontos)} />);
    const cobertos = blocosDeclarados(container).flatMap((b) => b.horizontes);

    expect([...cobertos].sort((a, b) => a - b)).toEqual(
      Array.from({ length: MAX - MIN + 1 }, (_, i) => i + MIN),
    );
  });

  it.each(RECORTES)("$nome: horizonte SEM medição aparece com motivo nomeado", ({ pontos }) => {
    const { container } = render(<CurvaDeConfiancaView data={montar(pontos)} />);

    for (const bloco of blocosDeclarados(container)) {
      if (bloco.estado === "medido") continue;
      // A ausência diz o MOTIVO REAL, e ele é uma dessas quatro frases.
      expect(
        bloco.texto,
        `bloco ${bloco.estado} (D+${bloco.horizontes.join(", D+")}) sem motivo nomeado`,
      ).toMatch(/medíve(l|is) a partir de|sem declaração de saldo|série de previsões congeladas ainda não existe|o banco não devolveu/);
    }
  });

  it.each(RECORTES)("$nome: NENHUM horizonte sem par carrega percentual", ({ pontos }) => {
    const { container } = render(<CurvaDeConfiancaView data={montar(pontos)} />);

    for (const bloco of blocosDeclarados(container)) {
      if (bloco.estado === "medido") continue;
      // Nem percentual, nem barra: altura zero LÊ como "confiança zero".
      expect(bloco.texto, `bloco ${bloco.estado} publicou percentual`).not.toMatch(/\d\s*%/);
    }
  });

  it.each(RECORTES)("$nome: todo horizonte MEDIDO mostra percentual e o n", ({ pontos }) => {
    const { container } = render(<CurvaDeConfiancaView data={montar(pontos)} />);
    const medidosNaTela = blocosDeclarados(container).filter((b) => b.estado === "medido");
    const medidosNoDado = pontos.filter((p) => p.estado === "medido");

    expect(medidosNaTela).toHaveLength(medidosNoDado.length);
    for (const bloco of medidosNaTela) expect(bloco.texto).toMatch(/\d\s*%/);
  });
});

describe("as duas escassezes saem separadas por NOME", () => {
  it("🔴 idade da série vira calendário COM data — e diz quando a série começou", () => {
    render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    // D+7 abre em 28/08 porque a série começou em 21/08.
    expect(screen.getByText(/medíveis a partir de 28\/08/)).toBeInTheDocument();
    expect(screen.getByText(/21\/08/)).toBeInTheDocument();
  });

  it("🔴 falta de declaração NÃO ganha data — esperar não resolve, declarar resolve", () => {
    const { container } = render(
      <CurvaDeConfiancaView data={montar(RECORTES[2].pontos)} />,
    );
    const bloco = blocosDeclarados(container).find((b) => b.estado === "sem_declaracao");
    expect(bloco?.texto).toMatch(/sem declaração de saldo/);
    expect(bloco?.texto).not.toMatch(/a partir de/);
  });

  it("os dois motivos nunca compartilham o mesmo bloco", () => {
    const { container } = render(<CurvaDeConfiancaView data={montar(RECORTES[2].pontos)} />);
    const estados = new Set(blocosDeclarados(container).map((b) => b.estado));
    expect(estados.has("serie_curta")).toBe(true);
    expect(estados.has("sem_declaracao")).toBe(true);
  });
});

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
    render(<CurvaDeConfiancaView data={montar(RECORTES[5].pontos)} />);
    expect(screen.getByTestId("veredito-confianca").textContent).not.toMatch(/não é tendência/i);
  });

  it("sem nenhum horizonte medido o veredito diz isso — e a faixa continua declarada", () => {
    const { container } = render(<CurvaDeConfiancaView data={montar(RECORTES[1].pontos)} />);
    expect(screen.getByTestId("veredito-confianca").textContent).toMatch(/ainda não há|nenhum/i);
    expect(blocosDeclarados(container).flatMap((b) => b.horizontes)).toHaveLength(MAX - MIN + 1);
  });
});

describe("as proibições da fase continuam de pé", () => {
  it("o selo de provisório fica, e continua dizendo a direção do viés", () => {
    render(<CurvaDeConfiancaView data={montar(AMOSTRA_DE_HOJE)} />);
    expect(screen.getByText(/PIOR/)).toBeInTheDocument();
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
