import { describe, it, expect } from "vitest";
import { formatWebhookHealth } from "./webhookHealth";

const NOW = new Date("2026-07-06T12:00:00Z").getTime();

describe("formatWebhookHealth", () => {
  it("nunca recebeu evento → waiting", () => {
    expect(formatWebhookHealth(null, NOW)).toEqual({ state: "waiting", label: "Aguardando eventos" });
  });
  it("evento há 30s → active em segundos", () => {
    const r = formatWebhookHealth("2026-07-06T11:59:30Z", NOW);
    expect(r.state).toBe("active");
    expect(r.label).toBe("Tempo real ativo · há 30s");
  });
  it("evento há 5min → active em minutos", () => {
    const r = formatWebhookHealth("2026-07-06T11:55:00Z", NOW);
    expect(r.state).toBe("active");
    expect(r.label).toBe("Tempo real ativo · há 5min");
  });
  it("evento há 2h → active em horas", () => {
    const r = formatWebhookHealth("2026-07-06T10:00:00Z", NOW);
    expect(r.label).toBe("Tempo real ativo · há 2h");
  });
  it("evento há >24h → idle", () => {
    const r = formatWebhookHealth("2026-07-04T12:00:00Z", NOW);
    expect(r.state).toBe("idle");
    expect(r.label).toBe("Sem eventos recentes");
  });
});
