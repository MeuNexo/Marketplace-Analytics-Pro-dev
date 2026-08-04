/**
 * Testes da nota de origem da publicidade (Fase 212).
 *
 * A régua só é legítima se a tela disser qual régua está valendo. Estes testes
 * provam que a troca fatura ↔ cache nunca acontece escondida e que a parte da
 * fatura sem chave de rateio aparece com valor, em vez de sumir.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdsOrigemNota } from "./AdsOrigemNota";

describe("AdsOrigemNota", () => {
  it("na régua da fatura, diz que a publicidade é rateada por anúncio", () => {
    render(<AdsOrigemNota source="billing-rateio" naoRateado={0} />);

    expect(screen.getByText(/fatura do Mercado Livre/i)).toBeInTheDocument();
    expect(screen.getByText(/rateada por anúncio/i)).toBeInTheDocument();
  });

  it("sem fatura no período, diz que o número veio do relatório de publicidade", () => {
    render(<AdsOrigemNota source="cache" naoRateado={0} />);

    expect(screen.getByText(/relatório de publicidade/i)).toBeInTheDocument();
    expect(screen.getByText(/ainda não foi sincronizada/i)).toBeInTheDocument();
    expect(screen.queryByText(/rateada por anúncio/i)).not.toBeInTheDocument();
  });

  it("declara em reais a parte da fatura que ficou sem chave de rateio", () => {
    render(<AdsOrigemNota source="billing-rateio" naoRateado={250.75} />);

    expect(screen.getByText(/250,75/)).toBeInTheDocument();
    expect(screen.getByText(/sem chave de rateio/i)).toBeInTheDocument();
  });

  it("não polui a tela quando a fatura inteira encontrou dono", () => {
    render(<AdsOrigemNota source="billing-rateio" naoRateado={0} />);

    expect(screen.queryByText(/sem chave de rateio/i)).not.toBeInTheDocument();
  });
});
