/**
 * Testes do componente ListingIssues — 6 estados de renderização.
 *
 * Cobre:
 *   1. idle    → não renderiza nada (null)
 *   2. loading → skeleton com aria-label acessível
 *   3. success + issues > 0 → lista com título e ação PT-BR, agrupada por categoria
 *   4. success + issues = 0 → mensagem "Nenhum problema encontrado"
 *   5. unavailable → "Dados de saúde indisponíveis no momento"
 *   6. error   → "Não foi possível carregar os problemas"
 *
 * Phase: 72-quality-score-issues / Plan 02 (TDD RED → GREEN)
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingIssues } from "./ListingIssues";
import type { Issue } from "./useMLListingHealth";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockIssues: Issue[] = [
  {
    id: "free_shipping",
    category: "Condições de venda",
    title: "Ofereça frete grátis para aumentar suas vendas",
    action_label: "Ative frete grátis no seu anúncio",
    progress: 0,
    progress_max: 1,
  },
  {
    id: "video",
    category: "Dados do produto",
    title: "Adicione um vídeo ao seu anúncio",
    action_label: "Vídeos aumentam as conversões",
    progress: 0,
    progress_max: 1,
  },
];

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("ListingIssues", () => {
  it("(idle) não renderiza nada quando status é idle", () => {
    const { container } = render(<ListingIssues status="idle" issues={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("(loading) renderiza skeleton com aria-label acessível", () => {
    render(<ListingIssues status="loading" issues={[]} />);
    expect(
      screen.getByLabelText("Carregando problemas do anúncio"),
    ).toBeInTheDocument();
  });

  it("(success com issues) renderiza título e ação de cada issue em PT-BR", () => {
    render(<ListingIssues status="success" issues={mockIssues} />);
    // Títulos das ações
    expect(
      screen.getByText("Ofereça frete grátis para aumentar suas vendas"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ative frete grátis no seu anúncio")).toBeInTheDocument();
    expect(screen.getByText("Adicione um vídeo ao seu anúncio")).toBeInTheDocument();
    expect(screen.getByText("Vídeos aumentam as conversões")).toBeInTheDocument();
    // Cabeçalhos de categoria (agrupamento)
    expect(screen.getByText("Condições de venda")).toBeInTheDocument();
    expect(screen.getByText("Dados do produto")).toBeInTheDocument();
  });

  it("(success sem issues) exibe mensagem de anúncio saudável", () => {
    render(<ListingIssues status="success" issues={[]} />);
    expect(screen.getByText("Nenhum problema encontrado")).toBeInTheDocument();
  });

  it("(unavailable) exibe mensagem de indisponibilidade", () => {
    render(<ListingIssues status="unavailable" issues={[]} />);
    expect(
      screen.getByText("Dados de saúde indisponíveis no momento"),
    ).toBeInTheDocument();
  });

  it("(error) exibe mensagem de erro", () => {
    render(<ListingIssues status="error" issues={[]} />);
    expect(
      screen.getByText("Não foi possível carregar os problemas"),
    ).toBeInTheDocument();
  });
});
