/**
 * tabelaUf.ts — monta `TabelaDifal` a partir das linhas cruas de
 * `public.aliquota_interna_vigente(date)` (Fase 222, planos 222-01-R/222-05).
 *
 * Módulo PURO, no mesmo molde de `orderTaxRate.ts` e `flexOrder.ts`: nenhum
 * import remoto nem referência ao runtime das edge functions, zero IO —
 * quem lê o banco (`aliquota_interna_vigente`) é a edge function, UMA vez
 * por rodada (nunca dentro do laço de pedidos); este módulo só transforma o
 * array já em memória, sem saber de onde ele veio.
 *
 * POR QUE ISTO É UM MÓDULO PRÓPRIO, E NÃO CÓDIGO DENTRO DA EDGE FUNCTION: a
 * mesma transformação precisa acontecer identicamente em `sync-ml-orders` e
 * em `recalc-order-costs` (as duas portas de escrita do imposto) — copiar a
 * lógica de montagem para as duas seria reabrir a lição da Fase 220 (três
 * cópias divergentes da mesma fórmula).
 *
 * ⚠️ RÉGUA D-R2-02/D-R2-03 (revoga D-09): a tabela do banco voltou a guardar a
 * ALÍQUOTA INTERNA — é o número que a planilha oficial entrega — e o percentual
 * de DIFAL passou a ser DERIVADO dentro de `aliquota_interna_vigente`. Para
 * este módulo nada disso muda de forma: `pct_difal` continua chegando pronto na
 * linha, só deixou de ser lido de coluna. A chave do objeto segue em dois
 * níveis (UF, procedência).
 *
 * ⚠️ O FCP virou PARCELA PRÓPRIA (D-R2-03), com padrão zero no banco, em vez de
 * ficar embutido no percentual. O desenho anterior presumia 2 pp de FCP no Rio
 * de Janeiro e por isso tratava 22 como a interna do RJ; a planilha oficial diz
 * 20, sem FCP — era presunção errada. Aqui o FCP entra na MESMA régua de
 * ausência das outras parcelas, e não numa régua própria mais frouxa.
 */

import type { Procedencia, TabelaDifal } from "./orderTaxRate";

/**
 * Linha crua devolvida por `aliquota_interna_vigente(p_data date)`
 * (assinatura na migration 222-10-R2): `uf char(2), procedencia text,
 * aliq_interestadual numeric, aliq_interna numeric, pct_difal numeric,
 * fcp numeric, confirmado boolean`. Os campos numéricos chegam como `unknown`
 * de propósito — o driver Postgres/PostgREST costuma devolver `numeric` como
 * STRING para não perder precisão, e este módulo não pode depender do chamador
 * já ter convertido.
 *
 * `aliq_interna` é declarada porque a função a devolve, e a forma do retorno do
 * banco tem de estar escrita em algum lugar. Ela NÃO é copiada para
 * `TabelaDifal` nem participa de validação nenhuma: a rastreabilidade da fonte
 * vive na tabela do banco, que é onde a conferência contra a planilha oficial
 * acontece. Duplicá-la em memória só criaria um segundo lugar para divergir.
 */
export interface LinhaAliquotaUf {
  uf: unknown;
  procedencia?: unknown;
  aliq_interestadual: unknown;
  aliq_interna?: unknown;
  pct_difal: unknown;
  fcp: unknown;
  confirmado?: unknown;
}

function normalizarSigla(uf: unknown): string {
  return String(uf ?? "").trim().toUpperCase();
}

/**
 * `"importado"` só quando a linha disser exatamente isso (aparada, em caixa
 * baixa). Qualquer outra coisa — inclusive ausente, nulo ou lixo — vira
 * `"nacional"`, que é o comportamento conservador: é a procedência da esmagadora
 * maioria do catálogo, e errar para nacional mantém o cálculo idêntico ao de
 * antes desta fase.
 */
function normalizarProcedencia(v: unknown): Procedencia {
  return String(v ?? "").trim().toLowerCase() === "importado" ? "importado" : "nacional";
}

/**
 * Número finito e não negativo, aceitando `number` ou `string` numérica.
 * `null`/`undefined` devolvem `null` (ausência) — e aqui ausência sempre
 * descarta a linha, nunca vira zero.
 */
function numeroValidoNaoNegativo(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Monta a tabela de DIFAL por (UF, procedência) a partir das linhas cruas do
 * banco.
 *
 * - `[]`/`null`/`undefined` devolvem `{}` — é o caso "a tabela não carregou":
 *   o consumidor (`resolverDifal`, `orderTaxRate.ts`) trata toda UF como fora
 *   da tabela, e o DIFAL sai ausente, nunca zero.
 * - Chaveia por sigla em CAIXA ALTA (aparada) e depois por procedência.
 * - `confirmado` só é `true` quando a linha trouxer `confirmado === true`
 *   literal — `false`, `null`, ausente ou qualquer valor não booleano vira
 *   `false`: linha sem confirmação de fonte nunca é tratada como confirmada
 *   por omissão.
 * - Duas linhas para o mesmo par (UF, procedência) fazem a função LANÇAR
 *   ERRO: a unicidade é garantida pelo banco (vigência sem sobreposição,
 *   migration 222-01-R), e se chegou duplicado algo quebrou antes deste
 *   módulo — nunca escolher uma das duas em silêncio. A detecção acontece
 *   ANTES de validar os números, para pegar duplicata mesmo quando uma das
 *   duas linhas seria descartada por outro motivo.
 * - `pct_difal`, `aliq_interestadual` ou `fcp` não numérica, negativa ou não
 *   finita descarta A LINHA INTEIRA (não entra no objeto devolvido) — nunca
 *   vira zero silencioso. Zero é um valor legítimo e diferente de ausência:
 *   uma UF pode ter DIFAL zero (ou FCP zero, que é o caso das 26 hoje), e isso
 *   não é o mesmo que não saber o número dela. Sem entrada em (UF,
 *   procedência), `resolverDifal` devolve `uf_fora_da_tabela` — ausência com
 *   motivo nomeado.
 * - O FCP entra nessa mesma frase por D-R2-03, que o promoveu a parcela
 *   própria e revogou o desenho de FCP embutido do 222-RETRABALHO. Dar ao FCP
 *   uma régua mais frouxa que a das outras parcelas (zerar quando ausente)
 *   reintroduziria, pela porta dos fundos, a presunção que D-R2-03 derrubou.
 */
export function montarTabelaAliquotas(
  linhas: LinhaAliquotaUf[] | null | undefined,
): TabelaDifal {
  const tabela: TabelaDifal = {};
  if (!linhas || linhas.length === 0) return tabela;

  const vistos = new Set<string>();
  for (const linha of linhas) {
    const sigla = normalizarSigla(linha.uf);
    const procedencia = normalizarProcedencia(linha.procedencia);
    const chave = `${sigla}|${procedencia}`;

    if (vistos.has(chave)) {
      throw new Error(
        `montarTabelaAliquotas: par (UF, procedência) duplicado na tabela de alíquotas (${sigla}, ${procedencia}) — a unicidade deveria ser garantida pelo banco`,
      );
    }
    vistos.add(chave);

    const aliqInterestadual = numeroValidoNaoNegativo(linha.aliq_interestadual);
    if (aliqInterestadual === null) continue; // descartada, nunca vira zero silencioso

    const pctDifal = numeroValidoNaoNegativo(linha.pct_difal);
    if (pctDifal === null) continue;

    const fcp = numeroValidoNaoNegativo(linha.fcp);
    if (fcp === null) continue; // mesma régua das outras duas: ausência descarta

    if (!tabela[sigla]) tabela[sigla] = {};
    tabela[sigla][procedencia] = {
      aliqInterestadual,
      pctDifal,
      fcp,
      confirmado: linha.confirmado === true,
    };
  }

  return tabela;
}
