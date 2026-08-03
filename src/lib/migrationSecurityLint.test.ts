// ============================================================================
// migrationSecurityLint.test.ts — Fase 209 Plano 03, Task 1 (TDD)
// Regressão estática do critério 5: pega a PRÓXIMA migration que criar tabela
// sem RLS ou função SECURITY DEFINER sem REVOKE, sem credencial nenhuma. Os
// dez comportamentos abaixo usam pares de SQL sintéticos escritos aqui — quem
// lê o disco é este teste, não `lintMigrations`, que é pura. O caso final lê
// o histórico real de `supabase/migrations/` e é o que fica vermelho no dia
// em que uma migration nova entrar sem disciplina.
// ============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { lintMigrations, type ArquivoMigration, type BaselineEntry } from "./migrationSecurityLint";
import { migrationSecurityBaseline } from "./migrationSecurityLint.baseline";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arquivo(nome: string, sql: string): ArquivoMigration {
  return { nome, sql };
}

describe("lintMigrations — tabela_sem_rls", () => {
  it("Test 1: tabela criada e RLS ligada no MESMO arquivo — sem achado", () => {
    const arquivos = [
      arquivo(
        "0001_orders.sql",
        `CREATE TABLE public.orders (id uuid PRIMARY KEY);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;`,
      ),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([]);
  });

  it("Test 2: tabela criada num arquivo, RLS ligada em arquivo POSTERIOR — sem achado", () => {
    const arquivos = [
      arquivo("0001_orders.sql", `CREATE TABLE public.orders (id uuid PRIMARY KEY);`),
      arquivo("0002_orders_rls.sql", `ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;`),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([]);
  });

  it("Test 3: tabela criada e RLS NUNCA ligada — achado tabela_sem_rls", () => {
    const arquivos = [arquivo("0001_leak.sql", `CREATE TABLE public.orders_status_reconciliation (id uuid PRIMARY KEY);`)];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([{ classe: "tabela_sem_rls", objeto: "orders_status_reconciliation" }]);
  });

  it("Test 4: RLS ligada e depois DISABLE, nunca religada — achado (estado final, não existência em algum lugar)", () => {
    const arquivos = [
      arquivo(
        "0001_orders.sql",
        `CREATE TABLE public.orders (id uuid PRIMARY KEY);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;`,
      ),
      arquivo("0002_oops.sql", `ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;`),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([{ classe: "tabela_sem_rls", objeto: "orders" }]);
  });
});

describe("lintMigrations — definer_sem_revoke", () => {
  it("Test 5: função SECURITY DEFINER criada com REVOKE depois, em qualquer arquivo — sem achado", () => {
    const arquivos = [
      arquivo(
        "0001_fn.sql",
        `CREATE OR REPLACE FUNCTION public.check_quota(_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true
$$;`,
      ),
      arquivo(
        "0002_revoke.sql",
        `REVOKE EXECUTE ON FUNCTION public.check_quota(uuid) FROM PUBLIC, anon, authenticated;`,
      ),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([]);
  });

  it("Test 6: função SECURITY DEFINER criada e NUNCA revogada — achado definer_sem_revoke", () => {
    const arquivos = [
      arquivo(
        "0001_fn.sql",
        `CREATE OR REPLACE FUNCTION public.can_member_access_route(_user_id uuid, _org_id uuid, _route text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true
$$;`,
      ),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([{ classe: "definer_sem_revoke", objeto: "can_member_access_route" }]);
  });

  it("Test 7: função SEM SECURITY DEFINER e sem REVOKE — sem achado (a classe é DEFINER, não toda função)", () => {
    const arquivos = [
      arquivo(
        "0001_fn.sql",
        `CREATE OR REPLACE FUNCTION public.calculate_effective_rate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;`,
      ),
    ];
    const { achados } = lintMigrations(arquivos, []);
    expect(achados).toEqual([]);
  });
});

describe("lintMigrations — linha de base", () => {
  it("Test 8: achado que consta da linha de base não aparece no resultado; achado igual FORA da linha de base aparece", () => {
    const arquivos = [
      arquivo("0001_a.sql", `CREATE TABLE public.legado_sem_rls (id uuid PRIMARY KEY);`),
      arquivo("0002_b.sql", `CREATE TABLE public.novo_sem_rls (id uuid PRIMARY KEY);`),
    ];
    const baseline: BaselineEntry[] = [
      { classe: "tabela_sem_rls", objeto: "legado_sem_rls", motivo: "herdado, ver DEBT-08" },
    ];
    const { achados } = lintMigrations(arquivos, baseline);
    expect(achados).toEqual([{ classe: "tabela_sem_rls", objeto: "novo_sem_rls" }]);
  });

  it("Test 9: entrada da linha de base sem achado correspondente — reportada como obsoleta", () => {
    const arquivos = [
      arquivo(
        "0001_a.sql",
        `CREATE TABLE public.ja_consertada (id uuid PRIMARY KEY);
ALTER TABLE public.ja_consertada ENABLE ROW LEVEL SECURITY;`,
      ),
    ];
    const baseline: BaselineEntry[] = [
      { classe: "tabela_sem_rls", objeto: "ja_consertada", motivo: "herdado, ver DEBT-08" },
    ];
    const { achados, baselineObsoleta } = lintMigrations(arquivos, baseline);
    expect(achados).toEqual([]);
    expect(baselineObsoleta).toEqual(baseline);
  });
});

describe("lintMigrations — comentários não contam como código", () => {
  it("Test 10: linha começando por -- que menciona tabela/REVOKE não cria nem conserta nada", () => {
    const arquivos = [
      arquivo(
        "0001_a.sql",
        `-- CREATE TABLE public.fantasma (id uuid PRIMARY KEY);
-- ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- REVOKE EXECUTE ON FUNCTION public.check_quota(uuid) FROM PUBLIC;
CREATE TABLE public.orders (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.check_quota(_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true
$$;`,
      ),
    ];
    const { achados } = lintMigrations(arquivos, []);
    // "fantasma" nunca foi criada de verdade (só em comentário) — não aparece.
    // "orders" foi criada de verdade e não tem RLS de verdade (o ENABLE estava só em comentário).
    // "check_quota" foi criada de verdade e não tem REVOKE de verdade (o REVOKE estava só em comentário).
    expect(achados).toEqual(
      expect.arrayContaining([
        { classe: "tabela_sem_rls", objeto: "orders" },
        { classe: "definer_sem_revoke", objeto: "check_quota" },
      ]),
    );
    expect(achados).toHaveLength(2);
    expect(achados.some((a) => a.objeto === "fantasma")).toBe(false);
  });
});

describe("lintMigrations — histórico real de supabase/migrations", () => {
  it("Test 11: o histórico real, com a linha de base do repo, devolve achados vazio e baselineObsoleta vazia", () => {
    const migrationsDir = resolve(__dirname, "../../supabase/migrations");
    const nomes = readdirSync(migrationsDir)
      .filter((n) => n.endsWith(".sql"))
      .sort();
    const arquivos: ArquivoMigration[] = nomes.map((nome) => ({
      nome,
      sql: readFileSync(resolve(migrationsDir, nome), "utf-8"),
    }));

    const { achados, baselineObsoleta } = lintMigrations(arquivos, migrationSecurityBaseline);

    expect(achados).toEqual([]);
    expect(baselineObsoleta).toEqual([]);
  });

  it("Test 12: a linha de base não pode listar check_quota nem can_member_access_route — foram consertados no 209-01, não são exceção aceita", () => {
    const objetosNaBaseline = migrationSecurityBaseline.map((b) => b.objeto);
    expect(objetosNaBaseline).not.toContain("check_quota");
    expect(objetosNaBaseline).not.toContain("can_member_access_route");
  });

  it("Test 13: is_org_member e get_org_role constam da linha de base com motivo de PROIBIÇÃO de revogar", () => {
    const isOrgMember = migrationSecurityBaseline.find((b) => b.objeto === "is_org_member");
    const getOrgRole = migrationSecurityBaseline.find((b) => b.objeto === "get_org_role");
    expect(isOrgMember).toBeDefined();
    expect(getOrgRole).toBeDefined();
    expect(isOrgMember!.motivo.toLowerCase()).toMatch(/proibid/);
    expect(getOrgRole!.motivo.toLowerCase()).toMatch(/proibid/);
  });
});
