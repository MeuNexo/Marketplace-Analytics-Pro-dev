/**
 * icmsUfSeed.test.ts — auditoria automatizada do seed de alíquotas internas
 * (Fase 222, plano 222-10-R2, FISC-03/FISC-05).
 *
 * POR QUE ESTE TESTE EXISTE: a migration `20260812200000_icms_uf_aliquotas.sql`
 * carrega a régua de DIFAL de TODA a operação interestadual. A versão anterior
 * dela vinha da planilha de precificação ANTIGA e errava a alíquota interna em
 * SETE UFs — em seis delas superestimando o imposto, RJ por 2 pontos inteiros.
 * O erro sobreviveu meses porque ninguém confere 52 linhas de SQL à mão, e
 * porque um DIFAL errado sai PLAUSÍVEL: nenhum teste quebra, nenhuma tela pisca.
 *
 * POR QUE ELE LÊ O ARQUIVO `.sql` EM VEZ DE CONSULTAR O BANCO: as guardas
 * `DO $$ RAISE EXCEPTION` dentro da própria migration só disparam no momento em
 * que ela é APLICADA — e aplicar migration é portão humano nesta fase. Sem esta
 * auditoria, um seed errado só seria pego lá na frente, com o banco já escrito.
 * Aqui ele é pego no commit.
 *
 * POR QUE A FOLHA OFICIAL ESTÁ ESCRITA DE NOVO AQUI: é a SEGUNDA CÓPIA
 * DELIBERADA da fonte (a primeira é a guarda `DO $$` da própria migration).
 * Editar o seed sozinho não passa; editar o seed e o teste juntos é uma decisão
 * consciente, não um deslize. Ver T-222-R2-01 no threat model do plano.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Caminho relativo à RAIZ DO REPOSITÓRIO — `process.cwd()`, não `import.meta.url`:
 * a suíte roda em ambiente jsdom, onde `import.meta.url` é uma URL `http://` do
 * servidor do Vite e `fileURLToPath` recusa ("The URL must be of scheme file").
 * O root do vitest é a raiz do repo (ver `vitest.config.ts`).
 */
const CAMINHO_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260812200000_icms_uf_aliquotas.sql",
);

const SQL = readFileSync(CAMINHO_MIGRATION, "utf8");

/**
 * Folha oficial de alíquotas internas (D-R2-02), validada 27/27 contra
 * `docs.google.com/spreadsheets/d/1hBuMpmTHFl2Y53uAtbGIqjqAsRbI5bU5bqlWzTE_D4g`.
 *
 * SP (18) NÃO entra: origem igual a destino é operação interna, sem DIFAL.
 */
const FOLHA_OFICIAL: Record<string, number> = {
  AC: 19, AL: 20.5, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20,
  ES: 17, GO: 19, MA: 23, MT: 17, MS: 17, MG: 18, PA: 19,
  PB: 20, PR: 19.5, PE: 20.5, PI: 22.5, RJ: 20, RN: 20, RS: 17,
  RO: 19.5, RR: 20, SC: 17, SE: 19, TO: 20,
};

/** Saindo de SP, na procedência nacional, estas cinco pagam 12%; o resto, 7%. */
const DOZE_POR_CENTO = new Set(["MG", "PR", "RJ", "RS", "SC"]);

/** Ordem das colunas do INSERT — a leitura posicional abaixo depende dela. */
const COLUNAS_ESPERADAS = [
  "uf",
  "procedencia",
  "vigencia_inicio",
  "vigencia_fim",
  "aliq_interestadual",
  "aliq_interna",
  "fcp",
  "fonte",
  "observacao",
];

interface LinhaSeed {
  uf: string;
  procedencia: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  aliqInterestadual: number;
  aliqInterna: number;
  fcp: number;
  fonte: string;
}

/**
 * Lê as tuplas do bloco de VALUES. `observacao` é ignorada de propósito: é o
 * único campo com texto livre (vírgulas, acentos, parênteses), e ela não
 * carrega número nenhum que a régua use.
 */
function lerSeed(sql: string): LinhaSeed[] {
  const padrao =
    /^\s*\('([A-Z]{2})',\s*'([a-z]+)',\s*DATE\s+'(\d{4}-\d{2}-\d{2})',\s*(NULL|DATE\s+'\d{4}-\d{2}-\d{2}'),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*'([a-z0-9_]+)'/gm;

  const linhas: LinhaSeed[] = [];
  let m: RegExpExecArray | null;
  while ((m = padrao.exec(sql)) !== null) {
    linhas.push({
      uf: m[1],
      procedencia: m[2],
      vigenciaInicio: m[3],
      vigenciaFim: m[4],
      aliqInterestadual: Number(m[5]),
      aliqInterna: Number(m[6]),
      fcp: Number(m[7]),
      fonte: m[8],
    });
  }
  return linhas;
}

describe("seed de icms_uf_aliquotas — auditoria contra a folha oficial", () => {
  it("o INSERT tem exatamente as colunas que a leitura posicional espera", () => {
    const bloco = SQL.match(/INSERT INTO public\.icms_uf_aliquotas\s*\(([^)]+)\)\s*VALUES/);
    expect(bloco, "bloco INSERT ... VALUES não encontrado na migration").not.toBeNull();

    const colunas = bloco![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(colunas).toEqual(COLUNAS_ESPERADAS);
  });

  // (a) ───────────────────────────────────────────────────────────────────
  it("são 52 linhas: 26 UFs × 2 procedências", () => {
    expect(lerSeed(SQL)).toHaveLength(52);
  });

  // (b) ───────────────────────────────────────────────────────────────────
  it("cobre as 26 UFs da folha oficial, e SP não entra", () => {
    const ufs = [...new Set(lerSeed(SQL).map((l) => l.uf))].sort();
    expect(ufs).toEqual(Object.keys(FOLHA_OFICIAL).sort());
    expect(ufs).not.toContain("SP");
    expect(ufs).toHaveLength(26);
  });

  it("cada UF aparece uma vez em nacional e uma vez em importado", () => {
    for (const uf of Object.keys(FOLHA_OFICIAL)) {
      const daUf = lerSeed(SQL).filter((l) => l.uf === uf);
      expect(daUf.map((l) => l.procedencia).sort(), `procedências de ${uf}`)
        .toEqual(["importado", "nacional"]);
    }
  });

  // (c) ───────────────────────────────────────────────────────────────────
  it("a alíquota interna de cada UF é exatamente a da folha oficial", () => {
    const encontrado: Record<string, number> = {};
    for (const l of lerSeed(SQL)) encontrado[l.uf] = l.aliqInterna;
    expect(encontrado).toEqual(FOLHA_OFICIAL);
  });

  it("nomeia a UF divergente quando a interna sai da folha oficial", () => {
    // As sete que a folha ANTIGA errava — travadas uma a uma, porque foram
    // exatamente elas que motivaram este plano (D-R2-02).
    const seteCorrigidas: Record<string, number> = {
      RJ: 20, BA: 20.5, PE: 20.5, PI: 22.5, PR: 19.5, RO: 19.5, AL: 20.5,
    };
    const seed = lerSeed(SQL);
    for (const [uf, interna] of Object.entries(seteCorrigidas)) {
      const linhas = seed.filter((l) => l.uf === uf);
      expect(linhas.length, `${uf} ausente do seed`).toBe(2);
      for (const l of linhas) {
        expect(l.aliqInterna, `${uf}/${l.procedencia}: interna fora da folha oficial`).toBe(interna);
      }
    }
  });

  // (d) ───────────────────────────────────────────────────────────────────
  it("a interna é a MESMA nas duas procedências — ela é do destino, não da origem", () => {
    for (const uf of Object.keys(FOLHA_OFICIAL)) {
      const internas = [...new Set(lerSeed(SQL).filter((l) => l.uf === uf).map((l) => l.aliqInterna))];
      expect(internas, `${uf} com interna divergente entre procedências`).toHaveLength(1);
    }
  });

  // (e) ───────────────────────────────────────────────────────────────────
  it("a interestadual nacional é 12 só para MG/PR/RJ/RS/SC e 7 nas demais", () => {
    for (const l of lerSeed(SQL).filter((l) => l.procedencia === "nacional")) {
      const esperado = DOZE_POR_CENTO.has(l.uf) ? 12 : 7;
      expect(l.aliqInterestadual, `${l.uf} nacional`).toBe(esperado);
    }
  });

  it("a interestadual importado é 4 em todas as UFs (Resolução SF 13/2012)", () => {
    for (const l of lerSeed(SQL).filter((l) => l.procedencia === "importado")) {
      expect(l.aliqInterestadual, `${l.uf} importado`).toBe(4);
    }
  });

  // (f) ───────────────────────────────────────────────────────────────────
  it("o FCP das 52 linhas é zero — nenhuma fonte confirmou FCP para UF nenhuma", () => {
    for (const l of lerSeed(SQL)) {
      expect(l.fcp, `${l.uf}/${l.procedencia}`).toBe(0);
    }
  });

  // (g) ───────────────────────────────────────────────────────────────────
  it("MG nacional produz exatamente 6% de DIFAL — o caso-prova da fase não se move", () => {
    const mg = lerSeed(SQL).find((l) => l.uf === "MG" && l.procedencia === "nacional");
    expect(mg).toBeDefined();
    expect(mg!.aliqInterna - mg!.aliqInterestadual).toBe(6);
    // E o valor em reais do pedido 2000017711929314 (receita 692,99).
    expect(692.99 * ((mg!.aliqInterna - mg!.aliqInterestadual) / 100)).toBeCloseTo(41.5794, 6);
  });

  it("a derivação nunca produz DIFAL negativo: interna >= interestadual nas 52", () => {
    for (const l of lerSeed(SQL)) {
      expect(l.aliqInterna, `${l.uf}/${l.procedencia}`).toBeGreaterThanOrEqual(l.aliqInterestadual);
    }
  });

  // ── Procedência do número ────────────────────────────────────────────────
  it("as 52 linhas declaram a fonte nova, e a vigência abre em 2026-01-01 sem fim", () => {
    for (const l of lerSeed(SQL)) {
      expect(l.fonte, `${l.uf}/${l.procedencia}`).toBe("planilha_oficial_2026");
      expect(l.vigenciaInicio).toBe("2026-01-01");
      expect(l.vigenciaFim).toBe("NULL");
    }
  });

  it("o percentual de DIFAL não é armazenado: não existe coluna pct_difal na tabela", () => {
    const criacao = SQL.slice(
      SQL.indexOf("CREATE TABLE IF NOT EXISTS public.icms_uf_aliquotas"),
      SQL.indexOf("COMMENT ON COLUMN"),
    );
    expect(criacao).not.toMatch(/^\s*pct_difal\s+numeric/m);
    expect(criacao).toMatch(/^\s*aliq_interna\s+numeric/m);
    expect(criacao).toMatch(/^\s*fcp\s+numeric/m);
  });

  it("a função de leitura deriva pct_difal e continua SECURITY INVOKER", () => {
    expect(SQL).toMatch(/\(t\.aliq_interna\s*-\s*t\.aliq_interestadual\)\s+AS pct_difal/);
    expect(SQL).toMatch(/SECURITY INVOKER/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.aliquota_interna_vigente\(date\) TO authenticated/);
  });

  it("a migration não tem comando destrutivo de objeto de banco", () => {
    expect(SQL).not.toMatch(/^\s*DROP\s+(FUNCTION|TABLE|VIEW|TRIGGER|POLICY)/im);
  });
});
