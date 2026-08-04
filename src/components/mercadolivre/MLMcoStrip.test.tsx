/**
 * Testes da faixa do MCO (`MLMcoStrip`) — Fase 210, Plano 02, Task 1.
 *
 * O que estes testes protegem: a ORIGEM do gasto de publicidade descontado do
 * MCO precisa chegar à tela (D-04 / T-210-05). Sem isso o número muda de régua
 * — de cache de ads para fatura do Mercado Livre — sem que ninguém perceba, que
 * é exatamente o defeito que esta fase existe para eliminar.
 *
 * A asserção mínima obrigatória é o atributo `data-ads-source` no elemento raiz,
 * verificável por teste e por inspeção do DOM. O texto do popover é conferido
 * por cima disso.
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MLMcoStrip } from "./MLMcoStrip";

// jsdom não implementa ResizeObserver; o Popover do Radix o usa via floating-ui.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — polyfill de teste, jsdom não define este global
global.ResizeObserver = ResizeObserverMock;

/** Raiz renderizada da faixa — é ela que carrega `data-ads-source`. */
const raiz = (container: HTMLElement) =>
  container.querySelector("[data-ads-source]") as HTMLElement | null;

const abrirPopover = () => {
  fireEvent.click(screen.getByLabelText("Ver definição"));
};

describe("MLMcoStrip — origem do gasto de publicidade na tela", () => {
  it("com adsSource='billing', a raiz declara a fatura como origem", () => {
    const { container } = render(
      <MLMcoStrip
        mco={18591.97}
        pct={12.14}
        label="MCO do período"
        adsSource="billing"
        adsTotal={1987.47}
        adsCoverageTo="2026-07-15"
      />,
    );

    expect(raiz(container)).not.toBeNull();
    expect(raiz(container)?.getAttribute("data-ads-source")).toBe("billing");
  });

  it("com adsSource='cache', a raiz declara o cache como origem", () => {
    const { container } = render(
      <MLMcoStrip
        mco={20390.34}
        pct={13.31}
        label="MCO do período"
        adsSource="cache"
        adsTotal={189.1}
        adsCoverageTo={null}
      />,
    );

    expect(raiz(container)?.getAttribute("data-ads-source")).toBe("cache");
  });

  it("sem a prop, a raiz sai como 'unknown' e o componente não quebra", () => {
    const { container } = render(
      <MLMcoStrip mco={1000} pct={10} label="MCO do período" />,
    );

    expect(raiz(container)?.getAttribute("data-ads-source")).toBe("unknown");
    // Os valores do MCO continuam renderizados normalmente
    expect(screen.getByText("MCO do período")).toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
  });

  it("com loading, o esqueleto continua sendo renderizado (regressão)", () => {
    const { container } = render(
      <MLMcoStrip
        mco={0}
        pct={null}
        label="MCO do período"
        loading
        adsSource="billing"
        adsTotal={1987.47}
      />,
    );

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    // Durante o carregamento não se afirma origem nenhuma — o rótulo não pisca
    // entre as duas fontes.
    expect(raiz(container)).toBeNull();
    expect(screen.queryByText("MCO do período")).not.toBeInTheDocument();
  });

  it("o popover diz que o número veio da fatura, com valor e cobertura", () => {
    render(
      <MLMcoStrip
        mco={18591.97}
        pct={12.14}
        label="MCO do período"
        adsSource="billing"
        adsTotal={1987.47}
        adsCoverageTo="2026-07-15"
      />,
    );

    abrirPopover();

    const texto = screen.getByText(/Publicidade descontada/i).textContent ?? "";
    expect(texto).toContain("fatura do Mercado Livre");
    expect(texto.replace(/\u00a0/g, " ")).toContain("R$ 1.987,47");
    expect(texto).toContain("15/07/2026");
  });

  it("o popover diz quando o número ainda vem do cache — ads não fica zerado", () => {
    render(
      <MLMcoStrip
        mco={20390.34}
        pct={13.31}
        label="MCO do período"
        adsSource="cache"
        adsTotal={189.1}
        adsCoverageTo={null}
      />,
    );

    abrirPopover();

    const texto = screen.getByText(/Publicidade descontada/i).textContent ?? "";
    expect(texto).toContain("cache de publicidade");
    expect(texto).toContain("ainda não foi sincronizada");
    expect(texto.replace(/\u00a0/g, " ")).toContain("R$ 189,10");
    expect(texto).not.toContain("fatura do Mercado Livre");
  });
});
