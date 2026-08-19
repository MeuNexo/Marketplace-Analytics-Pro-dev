/**
 * tabelaUf.test.ts — prova sem rede de `montarTabelaAliquotas` (Fase 222,
 * planos 222-01-R/222-05).
 *
 * As linhas de fixture têm o formato de `aliquota_interna_vigente(date)` na
 * régua D-R2-02/D-R2-03: `{ uf, procedencia, aliq_interestadual, aliq_interna,
 * pct_difal, fcp, confirmado }`. `pct_difal` continua chegando como campo — só
 * deixou de ser armazenado: a função o deriva de `interna − interestadual`.
 * Alguns casos usam os numéricos como STRING de propósito — é o formato real
 * que o driver Postgres/PostgREST costuma devolver para `numeric`, e este
 * módulo não pode depender do chamador já ter convertido.
 */
import { describe, it, expect } from "vitest";
import { montarTabelaAliquotas, type LinhaAliquotaUf } from "./tabelaUf";

/** Linha válida mínima, para os casos que só variam um campo. */
const linha = (over: Partial<LinhaAliquotaUf> = {}): LinhaAliquotaUf => ({
  uf: "MG",
  procedencia: "nacional",
  aliq_interestadual: 12,
  aliq_interna: 18,
  pct_difal: 6,
  fcp: 0,
  confirmado: true,
  ...over,
});

describe("montarTabelaAliquotas", () => {
  it("array vazio devolve objeto vazio — a tabela não carregou", () => {
    expect(montarTabelaAliquotas([])).toEqual({});
  });

  it("null/undefined devolvem objeto vazio, nunca lançam", () => {
    expect(montarTabelaAliquotas(null)).toEqual({});
    expect(montarTabelaAliquotas(undefined)).toEqual({});
  });

  it("chaveia por sigla em caixa alta e por procedência", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "sp" })]);
    expect(tabela.SP?.nacional).toBeDefined();
    expect(tabela.sp).toBeUndefined();
  });

  it("apara espaço da sigla", () => {
    expect(montarTabelaAliquotas([linha({ uf: "  MG  " })]).MG?.nacional).toBeDefined();
  });

  it("preserva os três números da linha", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "RJ", aliq_interestadual: 12, aliq_interna: 20, pct_difal: 8, fcp: 0 }),
    ]);
    expect(tabela.RJ?.nacional).toEqual({
      aliqInterestadual: 12,
      pctDifal: 8,
      fcp: 0,
      confirmado: true,
    });
  });

  // ── Procedência (D-11) ──────────────────────────────────────────────────

  it("a mesma UF convive com as duas procedências, cada uma com seus números", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "MG", procedencia: "nacional", aliq_interestadual: 12, pct_difal: 6 }),
      linha({ uf: "MG", procedencia: "importado", aliq_interestadual: 4, pct_difal: 14 }),
    ]);
    expect(tabela.MG?.nacional?.pctDifal).toBe(6);
    expect(tabela.MG?.importado?.pctDifal).toBe(14);
  });

  it("procedência ausente vira nacional — o comportamento conservador", () => {
    const tabela = montarTabelaAliquotas([
      { uf: "BA", aliq_interestadual: 7, pct_difal: 14, confirmado: true } as LinhaAliquotaUf,
    ]);
    expect(tabela.BA?.nacional).toBeDefined();
    expect(tabela.BA?.importado).toBeUndefined();
  });

  it("procedência com lixo vira nacional, nunca importado por engano", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "CE", procedencia: "importada!" })]);
    expect(tabela.CE?.nacional).toBeDefined();
    expect(tabela.CE?.importado).toBeUndefined();
  });

  it("procedência é normalizada (caixa e espaço)", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "PE", procedencia: "  IMPORTADO " })]);
    expect(tabela.PE?.importado).toBeDefined();
  });

  // ── Confirmação ─────────────────────────────────────────────────────────

  it("linha sem confirmação de fonte vira confirmado: false", () => {
    expect(montarTabelaAliquotas([linha({ uf: "RJ", confirmado: false })]).RJ?.nacional?.confirmado)
      .toBe(false);
  });

  it("confirmado ausente (campo não veio) vira false, nunca true por omissão", () => {
    const tabela = montarTabelaAliquotas([
      { uf: "BA", procedencia: "nacional", aliq_interestadual: 7, pct_difal: 14 } as LinhaAliquotaUf,
    ]);
    expect(tabela.BA?.nacional?.confirmado).toBe(false);
  });

  it("confirmado com valor não booleano (string 'true') também vira false", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "GO", confirmado: "true" })]);
    expect(tabela.GO?.nacional?.confirmado).toBe(false);
  });

  // ── Duplicatas ──────────────────────────────────────────────────────────

  it("duas linhas para o mesmo par (UF, procedência) lançam erro", () => {
    expect(() => montarTabelaAliquotas([linha(), linha()])).toThrow();
  });

  it("duplicata é detectada com a sigla normalizada (grafia diferente)", () => {
    expect(() => montarTabelaAliquotas([
      linha({ uf: "sp" }),
      linha({ uf: " SP " }),
    ])).toThrow();
  });

  it("mesma UF em procedências diferentes NÃO é duplicata", () => {
    expect(() => montarTabelaAliquotas([
      linha({ uf: "MG", procedencia: "nacional" }),
      linha({ uf: "MG", procedencia: "importado" }),
    ])).not.toThrow();
  });

  // ── Descarte de linha inválida ──────────────────────────────────────────

  it("pct_difal não numérico descarta a linha inteira, nunca vira zero silencioso", () => {
    expect(montarTabelaAliquotas([linha({ uf: "AC", pct_difal: "não é número" })])).toEqual({});
  });

  it("pct_difal negativo descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([linha({ uf: "AC", pct_difal: -5 })])).toEqual({});
  });

  it("pct_difal não finito (NaN/Infinity) descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([
      linha({ uf: "AC", pct_difal: NaN }),
      linha({ uf: "AP", pct_difal: Infinity }),
    ])).toEqual({});
  });

  it("aliq_interestadual ausente descarta a linha — não existe interestadual zero por omissão", () => {
    expect(montarTabelaAliquotas([linha({ uf: "SC", aliq_interestadual: null })])).toEqual({});
  });

  it("aliq_interestadual inválida descarta a linha inteira, não só o campo", () => {
    expect(montarTabelaAliquotas([linha({ uf: "PR", aliq_interestadual: -1 })])).toEqual({});
    expect(montarTabelaAliquotas([linha({ uf: "PR", aliq_interestadual: "abc" })])).toEqual({});
  });

  it("pct_difal ZERO é valor legítimo e entra na tabela — diferente de ausência", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "SP", aliq_interestadual: 18, pct_difal: 0 })]);
    expect(tabela.SP?.nacional?.pctDifal).toBe(0);
  });

  // ── FCP como parcela própria (D-R2-03) ──────────────────────────────────
  // O FCP deixou de ser presunção embutida no percentual e virou campo próprio.
  // A régua de ausência é a MESMA das outras duas parcelas: FCP que não seja um
  // número válido descarta a linha inteira. Zerar por omissão produziria um
  // imposto plausível e errado — exatamente o defeito que D-R2-03 fecha.

  it("FCP presente é carregado como número na entrada da tabela", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "RJ", fcp: 2 })]);
    expect(tabela.RJ?.nacional?.fcp).toBe(2);
  });

  it("FCP fracionário é preservado sem arredondar", () => {
    expect(montarTabelaAliquotas([linha({ uf: "AL", fcp: 1.5 })]).AL?.nacional?.fcp).toBe(1.5);
  });

  it("FCP como STRING do driver Postgres vira número", () => {
    expect(montarTabelaAliquotas([linha({ uf: "BA", fcp: "2.0000" })]).BA?.nacional?.fcp).toBe(2);
  });

  it("FCP ZERO é valor conhecido — a linha ENTRA na tabela, com fcp 0", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "MG", fcp: 0 })]);
    expect(tabela.MG?.nacional).toBeDefined();
    expect(tabela.MG?.nacional?.fcp).toBe(0);
  });

  it("FCP ausente (campo não veio) descarta a linha inteira, nunca vira zero", () => {
    const semFcp = {
      uf: "PE",
      procedencia: "nacional",
      aliq_interestadual: 7,
      aliq_interna: 20.5,
      pct_difal: 13.5,
      confirmado: true,
    } as LinhaAliquotaUf;
    expect(montarTabelaAliquotas([semFcp])).toEqual({});
  });

  it("FCP nulo descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([linha({ uf: "PE", fcp: null })])).toEqual({});
  });

  it("FCP negativo descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([linha({ uf: "PI", fcp: -2 })])).toEqual({});
  });

  it("FCP não finito (NaN/Infinity) descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([
      linha({ uf: "PR", fcp: NaN }),
      linha({ uf: "RO", fcp: Infinity }),
    ])).toEqual({});
  });

  it("FCP não numérico descarta a linha inteira", () => {
    expect(montarTabelaAliquotas([linha({ uf: "TO", fcp: "dois pontos" })])).toEqual({});
  });

  it("a UF com FCP inválido não ganha entrada nenhuma — cai em ausência nomeada", () => {
    // Sem entrada em (UF, procedência), `resolverDifal` devolve
    // `uf_fora_da_tabela`: ausência com motivo, jamais DIFAL zero silencioso.
    const tabela = montarTabelaAliquotas([
      linha({ uf: "SC", fcp: -1 }),
      linha({ uf: "SC", procedencia: "importado", fcp: 0 }),
    ]);
    expect(tabela.SC?.nacional).toBeUndefined();
    expect(tabela.SC?.importado).toBeDefined();
  });

  it("uma linha com FCP inválido não impede as outras válidas de entrarem", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "MG", fcp: 0 }),
      linha({ uf: "RJ", fcp: "abc" }),
    ]);
    expect(tabela.MG?.nacional).toBeDefined();
    expect(tabela.RJ).toBeUndefined();
  });

  it("duplicata continua sendo detectada ANTES da validação de FCP", () => {
    expect(() => montarTabelaAliquotas([
      linha({ uf: "MG", fcp: -1 }),
      linha({ uf: "MG", fcp: -1 }),
    ])).toThrow(/duplicado/);
  });

  // ── aliq_interna: declarada no tipo, ausente da tabela em memória ────────

  it("aliq_interna vem na linha crua mas NÃO é copiada para a tabela", () => {
    // A rastreabilidade da fonte vive na tabela do banco, que é onde a
    // conferência contra a planilha oficial acontece. Duplicá-la em memória só
    // criaria um segundo lugar para divergir.
    const entrada = montarTabelaAliquotas([linha({ uf: "MG", aliq_interna: 18 })]).MG?.nacional;
    expect(entrada).toBeDefined();
    expect(Object.keys(entrada!).sort()).toEqual(["aliqInterestadual", "confirmado", "fcp", "pctDifal"]);
  });

  it("aliq_interna inválida NÃO descarta a linha — ela não participa de validação", () => {
    const tabela = montarTabelaAliquotas([linha({ uf: "MG", aliq_interna: "lixo" })]);
    expect(tabela.MG?.nacional?.pctDifal).toBe(6);
  });

  // ── Formato do driver ───────────────────────────────────────────────────

  it("aceita os numéricos como STRING — formato real do driver Postgres para numeric", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "SP", aliq_interestadual: "18.00", pct_difal: "0.00", fcp: "0.0000" }),
    ]);
    expect(tabela.SP?.nacional).toEqual({
      aliqInterestadual: 18,
      pctDifal: 0,
      fcp: 0,
      confirmado: true,
    });
  });

  // ── Conjunto ────────────────────────────────────────────────────────────

  it("monta a tabela inteira com múltiplas UFs de uma vez, preservando cada uma", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "SP", aliq_interestadual: 18, pct_difal: 0 }),
      linha({ uf: "MG", confirmado: false }),
      linha({ uf: "AM", aliq_interestadual: 7, pct_difal: 13 }),
    ]);
    expect(Object.keys(tabela).sort()).toEqual(["AM", "MG", "SP"]);
    expect(tabela.AM?.nacional).toEqual({ aliqInterestadual: 7, pctDifal: 13, fcp: 0, confirmado: true });
  });

  it("uma linha descartada não impede as outras válidas de entrarem na tabela", () => {
    const tabela = montarTabelaAliquotas([
      linha({ uf: "SP" }),
      linha({ uf: "AC", pct_difal: -1 }),
    ]);
    expect(tabela.SP?.nacional).toBeDefined();
    expect(tabela.AC).toBeUndefined();
  });
});
