/**
 * Testes do selo compacto de estado atual do rebate (Quick task 260821-nof).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeloPromo } from "./SeloPromo";
import { resolveSeloPromo } from "@/lib/seloPromo";
import type { SeloPromoResult } from "@/lib/seloPromo";

const SETE_ESTADOS: SeloPromoResult[] = [
  resolveSeloPromo({ comissao: 515.48, rebateBruto: 562.1, semVendaNaJanela: false }), // com_promo
  resolveSeloPromo({
    comissao: 90,
    rebateBruto: 10,
    pedidosSemCaptura: 3,
    semVendaNaJanela: false,
  }), // com_promo_parcial
  resolveSeloPromo({ comissao: 100, rebateBruto: 0, semVendaNaJanela: false }), // sem_promo
  resolveSeloPromo({
    comissao: 0,
    rebateBruto: null,
    semVendaNaJanela: true,
    mediaPeriodoPct: 19.2,
  }), // sem_venda_recente
  resolveSeloPromo({
    comissao: 100,
    rebateBruto: null,
    pedidosNaoConferidos: 3,
    semVendaNaJanela: false,
  }), // conferencia_nao_fecha
  resolveSeloPromo({
    comissao: 100,
    rebateBruto: null,
    pedidosSemCaptura: 4,
    semVendaNaJanela: false,
  }), // nao_capturado
  resolveSeloPromo({ comissao: 100, rebateBruto: null, semVendaNaJanela: false }), // indisponivel
];

describe("SeloPromo — os sete estados", () => {
  it("os sete estados rendem sete textos distintos", () => {
    const textos = new Set(SETE_ESTADOS.map((s) => s.texto));
    expect(textos.size).toBe(7);
  });

  it.each(SETE_ESTADOS)(
    "estado $estado: carrega data-selo-promo e title não vazio",
    (selo) => {
      const { container } = render(<SeloPromo selo={selo} />);
      const raiz = container.querySelector("[data-selo-promo]");

      expect(raiz).not.toBeNull();
      expect(raiz?.getAttribute("data-selo-promo")).toBe(selo.estado);
      expect(raiz?.getAttribute("title")).toBeTruthy();
      expect(raiz?.getAttribute("title")?.length).toBeGreaterThan(0);
    },
  );

  it("renderiza o texto do selo dentro do elemento", () => {
    const selo = SETE_ESTADOS[0];
    render(<SeloPromo selo={selo} />);
    expect(screen.getByText(selo.texto)).toBeInTheDocument();
  });
});

describe("SeloPromo — densidades", () => {
  it("densidade de célula e de bloco rendem o MESMO texto, classes diferentes", () => {
    const selo = SETE_ESTADOS[0];
    const { container: bloco } = render(<SeloPromo selo={selo} densidade="bloco" />);
    const { container: celula } = render(<SeloPromo selo={selo} densidade="celula" />);

    expect(bloco.textContent).toBe(celula.textContent);

    const rootBloco = bloco.querySelector("[data-selo-promo]");
    const rootCelula = celula.querySelector("[data-selo-promo]");
    expect(rootBloco?.className).not.toBe(rootCelula?.className);
  });
});
