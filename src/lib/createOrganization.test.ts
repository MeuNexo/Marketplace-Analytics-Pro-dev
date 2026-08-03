import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createOrganization, slugify } from "./createOrganization";

type InsertResult = { error: { message: string } | null };
type Call = { table: string; payload: unknown };

function makeClient(overrides: Partial<Record<string, () => Promise<InsertResult>>> = {}) {
  const calls: Call[] = [];
  const client = {
    from: vi.fn((table: string) => ({
      insert: vi.fn((payload: unknown) => {
        calls.push({ table, payload });
        const override = overrides[table];
        return override ? override() : Promise.resolve({ error: null });
      }),
    })),
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("createOrganization", () => {
  it("insere em organizations, depois organization_members, depois organization_plans, nessa ordem", async () => {
    const { client, calls } = makeClient();
    const result = await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.table)).toEqual(["organizations", "organization_members", "organization_plans"]);
  });

  it("grava plan_tier free e sync_interval_minutes 1440 explicitamente no passo 3", async () => {
    const { client, calls } = makeClient();
    await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    const planCall = calls.find((c) => c.table === "organization_plans");
    expect(planCall?.payload).toMatchObject({ plan_tier: "free", sync_interval_minutes: 1440 });
  });

  it("falha no passo 1 devolve erro nomeando organizations, e os passos 2 e 3 não são tentados", async () => {
    const { client, calls } = makeClient({
      organizations: () => Promise.resolve({ error: { message: "duplicate key" } }),
    });
    const result = await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("organizations");
      expect(result.error.recoverable).toBe(false);
    }
    expect(calls.map((c) => c.table)).toEqual(["organizations"]);
  });

  it("falha no passo 2 devolve erro nomeando organization_members, marcado como recuperável", async () => {
    const { client, calls } = makeClient({
      organization_members: () => Promise.resolve({ error: { message: "rls violation" } }),
    });
    const result = await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("organization_members");
      expect(result.error.recoverable).toBe(true);
    }
    expect(calls.map((c) => c.table)).toEqual(["organizations", "organization_members"]);
  });

  it("falha no passo 3 devolve erro nomeando organization_plans, recuperável e dizendo que a organização já existe", async () => {
    const { client, calls } = makeClient({
      organization_plans: () => Promise.resolve({ error: { message: "insert failed" } }),
    });
    const result = await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.step).toBe("organization_plans");
      expect(result.error.recoverable).toBe(true);
      expect(result.error.message.toLowerCase()).toMatch(/organiza[cç][aã]o/);
    }
    expect(calls.map((c) => c.table)).toEqual(["organizations", "organization_members", "organization_plans"]);
  });

  it("sucesso devolve o identificador da organização criada", async () => {
    const { client } = makeClient();
    const result = await createOrganization(client, { nome: "Loja Teste", userId: "user-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.organizationId).toBe("string");
      expect(result.organizationId.length).toBeGreaterThan(0);
    }
  });

  it("deriva o slug do nome quando não vier: minúsculas, sem acento, hífen no lugar de espaço", () => {
    expect(slugify("Pé Vermeio Calçados")).toBe("pe-vermeio-calcados");
  });

  it("usa o slug derivado quando nenhum slug é informado na chamada", async () => {
    const { client, calls } = makeClient();
    await createOrganization(client, { nome: "Organização Nova", userId: "user-1" });
    const orgCall = calls.find((c) => c.table === "organizations");
    expect((orgCall?.payload as { slug: string }).slug).toBe("organizacao-nova");
  });

  it("colisão de slug volta como o erro do banco, não é silenciada", async () => {
    const { client } = makeClient({
      organizations: () =>
        Promise.resolve({
          error: { message: 'duplicate key value violates unique constraint "organizations_slug_key"' },
        }),
    });
    const result = await createOrganization(client, { nome: "Loja Teste", slug: "ja-existe", userId: "user-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/organizations_slug_key/);
    }
  });
});
