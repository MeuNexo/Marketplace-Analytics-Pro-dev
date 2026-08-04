/**
 * Testes do componente AvisoCustoFaltante — Fase 213, Plano 05, Task 1 (AV-03).
 *
 * O componente é PURO de apresentação (molde de `AdsOrigemNota`): recebe a
 * contagem já calculada e decide apenas o que aparece na tela.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AvisoCustoFaltante } from "./AvisoCustoFaltante";
import { contarSemCusto, type LinhaCusto } from "@/lib/custoFaltante";

function linhas(total: number, semCusto: number): LinhaCusto[] {
  return Array.from({ length: total }, (_, i) => ({ temCusto: i >= semCusto }));
}

describe("AvisoCustoFaltante", () => {
  it("com zero faltantes não produz saída visível", () => {
    const { container } = render(<AvisoCustoFaltante contagem={contarSemCusto(linhas(10, 0))} />);
    expect(container.firstChild).toBeNull();
  });

  it("com conjunto vazio não produz saída visível", () => {
    const { container } = render(<AvisoCustoFaltante contagem={contarSemCusto([])} />);
    expect(container.firstChild).toBeNull();
  });

  it("com faltantes mostra a contagem, o total e o percentual", () => {
    const { container } = render(<AvisoCustoFaltante contagem={contarSemCusto(linhas(10, 3))} />);
    const texto = container.textContent ?? "";
    expect(texto).toMatch(/\b3\b/);
    expect(texto).toMatch(/\b10\b/);
    expect(texto).toMatch(/30/);
    expect(texto).toMatch(/indefinida/i);
  });

  it("com faltantes parciais usa o tom de aviso, não o de alarme", () => {
    render(<AvisoCustoFaltante contagem={contarSemCusto(linhas(10, 3))} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("com todos faltantes usa o tom mais forte e diz que nenhuma margem vale", () => {
    render(<AvisoCustoFaltante contagem={contarSemCusto(linhas(52, 52))} />);
    const alerta = screen.getByRole("alert");
    expect(alerta).toBeInTheDocument();
    expect(alerta.textContent ?? "").toMatch(/nenhuma margem/i);
    expect(alerta.textContent ?? "").toMatch(/\b52\b/);
  });

  it("com destino de cadastro oferece o caminho para resolver", () => {
    render(
      <AvisoCustoFaltante
        contagem={contarSemCusto(linhas(10, 3))}
        destinoCadastro="/precificacao"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/precificacao");
  });

  it("sem destino de cadastro não renderiza link algum", () => {
    render(<AvisoCustoFaltante contagem={contarSemCusto(linhas(10, 3))} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
