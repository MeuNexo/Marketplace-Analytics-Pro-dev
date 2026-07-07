/**
 * Testes dos helpers puros de triagem "de quem é a vez" (Phase 90-03):
 *   claimBucket · pendingActionLabel · dueDateLabel
 *
 * Phase: 90-atendimento-de-reclamacoes-triagem-de-pendencias-mensagens-r- / Plan 03
 */

import { describe, it, expect } from "vitest";
import { claimBucket, pendingActionLabel, dueDateLabel } from "./claimStatus";

describe("claimBucket", () => {
  it("classifica como 'pende' quando aberta e seller_action_required=true", () => {
    expect(claimBucket({ status: "opened", seller_action_required: true })).toBe("pende");
  });

  it("classifica como 'pende' quando under_review e seller_action_required=true", () => {
    expect(claimBucket({ status: "under_review", seller_action_required: true })).toBe("pende");
  });

  it("classifica como 'aguardando' quando aberta e seller_action_required=false", () => {
    expect(claimBucket({ status: "opened", seller_action_required: false })).toBe("aguardando");
  });

  it("classifica como 'aguardando' quando aberta e seller_action_required é null", () => {
    expect(claimBucket({ status: "opened", seller_action_required: null })).toBe("aguardando");
  });

  it("classifica como 'aguardando' quando aberta e seller_action_required está ausente", () => {
    expect(claimBucket({ status: "under_review" })).toBe("aguardando");
  });

  it("classifica como 'resolvida' quando status é closed, mesmo com seller_action_required=true", () => {
    expect(claimBucket({ status: "closed", seller_action_required: true })).toBe("resolvida");
  });

  it("classifica como 'resolvida' quando status é closed_with_refund", () => {
    expect(claimBucket({ status: "closed_with_refund", seller_action_required: true })).toBe("resolvida");
  });

  it("classifica como 'resolvida' quando status é desconhecido", () => {
    expect(claimBucket({ status: "algo_novo_do_ml", seller_action_required: true })).toBe("resolvida");
  });

  it("classifica como 'resolvida' quando status é null", () => {
    expect(claimBucket({ status: null, seller_action_required: true })).toBe("resolvida");
  });

  it("só retorna 'pende' quando seller_action_required && aberta (não basta um dos dois)", () => {
    expect(claimBucket({ status: "closed", seller_action_required: true })).not.toBe("pende");
    expect(claimBucket({ status: "opened", seller_action_required: false })).not.toBe("pende");
  });
});

describe("pendingActionLabel", () => {
  it("'reply' → Responder", () => {
    expect(pendingActionLabel("reply")).toBe("Responder");
  });

  it("'return' → Decidir devolução", () => {
    expect(pendingActionLabel("return")).toBe("Decidir devolução");
  });

  it("'refund' → Decidir reembolso", () => {
    expect(pendingActionLabel("refund")).toBe("Decidir reembolso");
  });

  it("'dispute' → Falar com o ML", () => {
    expect(pendingActionLabel("dispute")).toBe("Falar com o ML");
  });

  it("null → null", () => {
    expect(pendingActionLabel(null)).toBeNull();
  });

  it("tipo desconhecido → null", () => {
    expect(pendingActionLabel("algo_novo")).toBeNull();
  });
});

describe("dueDateLabel", () => {
  const now = new Date("2026-07-07T12:00:00Z");

  it("null → null", () => {
    expect(dueDateLabel(null, now)).toBeNull();
  });

  it("data hoje → 'vence hoje'", () => {
    expect(dueDateLabel("2026-07-07T23:00:00Z", now)).toBe("vence hoje");
  });

  it("data no passado → 'atrasada'", () => {
    expect(dueDateLabel("2026-07-05T08:00:00Z", now)).toBe("atrasada");
  });

  it("data no futuro → 'vence em N dias'", () => {
    expect(dueDateLabel("2026-07-10T08:00:00Z", now)).toBe("vence em 3 dias");
  });

  it("data amanhã → 'vence em 1 dias'", () => {
    expect(dueDateLabel("2026-07-08T00:30:00Z", now)).toBe("vence em 1 dias");
  });

  it("string inválida → null", () => {
    expect(dueDateLabel("not-a-date", now)).toBeNull();
  });
});
