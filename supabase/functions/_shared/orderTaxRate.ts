/**
 * orderTaxRate.ts — fonte única da alíquota de imposto por pedido (Fase 220,
 * TAX-01).
 *
 * Módulo PURO: nenhum import remoto nem referência ao runtime do Deno, para
 * ser importável tanto pelas edge functions Deno (import relativo, extensão
 * `.ts` explícita) quanto pelo vitest (node) e pelo frontend Vite. NÃO faz
 * nenhuma chamada de rede/IO.
 *
 * O BUG QUE ESTE MÓDULO FECHA: até 06/08/2026 existiam TRÊS cópias
 * divergentes desta fórmula (`sync-ml-orders/index.ts`,
 * `recalc-order-costs/index.ts`, `src/lib/tax/perOrder.ts`), e as três
 * colapsavam "destino desconhecido" (`ufDestino == null`) com "destino é a
 * própria UF de origem" no mesmo ramo do switch — o mesmo `if (dest === null
 * || orig === dest)`. Quando a rodada de sync não busca o detalhe de envio
 * de um pedido (sync incremental, pedido já com frete+estado no banco),
 * `estado` chega `null` e a fórmula devolvia a alíquota intraestadual — a
 * MAIS ALTA das três, não uma ausência. Medido em 06/08: 39 dos 45 pedidos
 * do dia, todos com `estado` correto e fora de SP, gravados com a alíquota
 * de SP (25,585% em vez de 20,14%/15,6025%).
 *
 * Destino desconhecido NÃO é "destino é a origem". Este módulo trata os
 * dois casos como ramos diferentes: destino desconhecido devolve
 * `rate: null` (motivo `"destino_desconhecido"`), nunca um número. É essa
 * mudança — no CÁLCULO, não só no upsert — que faz o `COALESCE` já aplicado
 * a `tax_rate`/`tax_amount` em `batch_upsert_orders` ter efeito: antes dele,
 * `EXCLUDED.tax_rate` nunca chegava `null`, então `COALESCE` nunca disparava.
 *
 * O QUE MUDOU NA FASE 222: o imposto deixa de ser uma alíquota efetiva
 * vezes a receita e passa a ser `computeOrderTax`, a soma de componentes
 * com bases distintas — ICMS débito, PIS/COFINS débito (Tema 69), os
 * créditos de PIS/COFINS sobre comissão e frete (D-01, sempre ligados,
 * sem toggle) e o DIFAL por BASE SIMPLES (D-08), cada um com
 * a sua procedência (D-07). `resolveIcmsAliquota` é a resolução de destino
 * extraída de dentro de `computeOrderTaxRate` — a mesma tabela de decisão
 * de sempre, agora chamada por duas funções em vez de copiada para a
 * segunda. `taxAmount` CONTINUA sendo o cenário SEM DIFAL — o cenário com
 * DIFAL é composto por cima em `taxAmountComDifal`, nunca por soma dentro
 * de `taxAmount`, porque é isso que mantém as RPCs que já leem `tax_amount`
 * corretas sem precisar de nenhuma alteração.
 *
 * A BASE DO DIFAL (13/08/2026): existe controvérsia jurídica real — LC
 * 190/2022 e leis estaduais desde 2015 sustentam a base dupla; o Convênio
 * ICMS 236/21 manda base simples para consumidor final NÃO contribuinte, que
 * é ~todo pedido do ML. A contadora da Pé Vermeio NÃO escolheu entre as duas:
 * disse que a fórmula vale onde não há nota, e que onde a NF-e é emitida a
 * margem sai do DOCUMENTO FISCAL. Como a Pé Vermeio emite NF-e em todas as
 * vendas, o que este módulo produz é ESTIMATIVA, nunca apuração (D-12) — a
 * tela precisa dizer isso, e `DifalFonte` já tem o estado `documento_fiscal`
 * reservado para quando a Fase 223 ingerir a nota. A régua implementada é a
 * BASE SIMPLES da planilha de precificação (D-08). Se essa decisão mudar,
 * muda aqui, em um lugar só, e `tax_versao` distingue as linhas antigas.
 */

// ── Regime e regiões ──────────────────────────────────────────────────────────

export type TaxRegime = "simples_nacional" | "lucro_presumido" | "lucro_real";

export type Region = "N" | "NE" | "CO" | "SE" | "S";

export const UF_REGION: Record<string, Region> = {
  // Norte
  AC: "N", AP: "N", AM: "N", PA: "N", RO: "N", RR: "N", TO: "N",
  // Nordeste
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  // Centro-Oeste
  DF: "CO", GO: "CO", MT: "CO", MS: "CO",
  // Sudeste
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  // Sul
  PR: "S", RS: "S", SC: "S",
};

/** Devolve `true` se o destino usa a alíquota interestadual reduzida (7%). */
export function isReducedInterstateDest(uf: string | null | undefined): boolean {
  if (!uf) return false;
  if (uf === "ES") return true;
  const r = UF_REGION[uf];
  return r === "N" || r === "NE" || r === "CO";
}

// ── Config e resultado ────────────────────────────────────────────────────────

export interface OrderTaxConfig {
  regime: TaxRegime;
  uf_origem: string | null;
  // Simples Nacional
  sn_aliquota_efetiva: number | null;
  // Lucro Presumido
  lp_pis: number | null;
  lp_cofins: number | null;
  lp_irpj: number | null;
  lp_csll: number | null;
  // Lucro Real — ICMS por destino
  lr_icms_aliquota_intra: number | null;
  lr_icms_aliquota_inter_sul_sudeste: number | null;
  lr_icms_aliquota_inter_norte_nordeste: number | null;
  /** Fallback caso lr_icms_aliquota_intra esteja vazio (campo legado). */
  lr_icms_debito: number | null;
  // Fase 222 (222-01) — DIFAL e Flex por loja ML. Campos opcionais: config
  // antiga (Fase 220) continua válida para quem só chama computeOrderTaxRate.
  /** UFs em que a organização de fato recolhe o DIFAL calculado (config, nunca regra fixa — D-02). */
  difal_ufs_recolhidas?: string[] | null;
  /** UFs em que o ML já cobra o DIFAL na fatura (dado observável — D-07). */
  difal_ufs_cobradas_pelo_ml?: string[] | null;
  /** Custo de entrega própria do Flex, R$ por entrega (config por org). */
  flex_custo_entrega?: number | null;
}

export type MotivoAliquota =
  | "regime_fixo"
  | "intraestadual"
  | "interestadual"
  | "sem_uf_origem"
  | "destino_desconhecido"
  | "sem_config";

export interface AliquotaPedido {
  rate: number | null;
  motivo: MotivoAliquota;
}

/** Resultado da resolução da alíquota de ICMS para o regime lucro_real. */
export interface IcmsResolvido {
  icmsAliquota: number | null;
  motivo: MotivoAliquota;
}

const c = (v: number | null | undefined): number => v ?? 0;

/**
 * Resolve a alíquota de ICMS aplicável a um pedido do regime `lucro_real`,
 * dado o destino do envio. Extraída de dentro de `computeOrderTaxRate` na
 * Fase 222 (TAX-01 continua intocado): é a MESMA tabela de decisão de
 * antes, agora em função própria para ser chamada tanto por
 * `computeOrderTaxRate` quanto por `computeOrderTax` (Fase 222) — uma
 * resolução de destino, duas consumidoras, nunca duas cópias.
 *
 * A guarda de destino ausente continua sendo a PRIMEIRA verificação, antes
 * de olhar `uf_origem` — inverter essa ordem é o bug que a Fase 220 fechou.
 */
export function resolveIcmsAliquota(
  config: OrderTaxConfig,
  ufDestino: string | null | undefined,
): IcmsResolvido {
  // Normaliza o destino uma vez; string vazia é tratada como ausência.
  const dest = String(ufDestino ?? "").trim().toUpperCase();

  // Primeira guarda, antes de qualquer outra: destino ausente → null.
  // Este é o conserto inteiro do TAX-01 em uma linha.
  if (dest === "") {
    return { icmsAliquota: null, motivo: "destino_desconhecido" };
  }

  const intra      = Number(config.lr_icms_aliquota_intra ?? config.lr_icms_debito ?? 0);
  const interSulSE = Number(config.lr_icms_aliquota_inter_sul_sudeste ?? 12);
  const interNNECO = Number(config.lr_icms_aliquota_inter_norte_nordeste ?? 7);

  const origRaw = config.uf_origem ? String(config.uf_origem).trim().toUpperCase() : "";

  if (origRaw === "") {
    // Sem UF origem na config: alíquota interestadual pela tabela do
    // destino — comportamento idêntico ao de hoje para este caso.
    const icmsAliquota = isReducedInterstateDest(dest) ? interNNECO : interSulSE;
    return { icmsAliquota, motivo: "sem_uf_origem" };
  }

  if (origRaw === dest) {
    // Origem igual ao destino: intraestadual.
    return { icmsAliquota: intra, motivo: "intraestadual" };
  }

  // Interestadual pela tabela do destino.
  const icmsAliquota = isReducedInterstateDest(dest) ? interNNECO : interSulSE;
  return { icmsAliquota, motivo: "interestadual" };
}

/**
 * Soma de PIS + COFINS do regime Lucro Real (9,25% = 1,65% + 7,60%). Mesma
 * soma que já estava embutida na fórmula de `computeOrderTaxRate`; extraída
 * como constante na Fase 222 porque é a base dos créditos de D-01
 * (comissão e frete) que `computeOrderTax` passa a calcular.
 */
export const PIS_COFINS_LUCRO_REAL = 1.65 + 7.60;

/**
 * Calcula a alíquota efetiva (%) de imposto para um pedido, dado o regime
 * tributário da loja e o destino (UF) do pedido.
 *
 * Devolve um objeto (`AliquotaPedido`), nunca um número solto: obriga cada
 * chamador a decidir o que fazer com `rate === null` — nunca herdar um
 * número plausível sem perceber que o destino não era conhecido.
 */
export function computeOrderTaxRate(
  config: OrderTaxConfig | null | undefined,
  ufDestino: string | null | undefined,
): AliquotaPedido {
  // 1. Sem configuração fiscal, não existe alíquota a inventar.
  if (!config) {
    return { rate: null, motivo: "sem_config" };
  }

  switch (config.regime) {
    case "simples_nacional":
      // 2. O destino não entra na conta — é o que torna a conta Junior imune
      //    à mudança desta fase.
      return { rate: Math.max(0, c(config.sn_aliquota_efetiva)), motivo: "regime_fixo" };

    case "lucro_presumido":
      // 3. Soma fixa dos componentes, também sem depender do destino.
      return {
        rate: Math.max(
          0,
          c(config.lp_pis) + c(config.lp_cofins) + c(config.lp_irpj) + c(config.lp_csll),
        ),
        motivo: "regime_fixo",
      };

    case "lucro_real": {
      // 4. A resolução de destino vive só em resolveIcmsAliquota — uma cópia
      //    a menos, não uma a mais.
      const { icmsAliquota, motivo } = resolveIcmsAliquota(config, ufDestino);

      if (icmsAliquota === null) {
        return { rate: null, motivo };
      }

      // 5. Fórmula do Wesley, byte a byte igual às três cópias atuais:
      //    ICMS + (1 - ICMS%) × (PIS 1,65% + COFINS 7,60%).
      const baseFactor = 1 - icmsAliquota / 100;
      const rate = Math.max(0, icmsAliquota + baseFactor * PIS_COFINS_LUCRO_REAL);
      return { rate, motivo };
    }
  }
}

// ── Imposto decomposto (Fase 222, TAX-01 → imposto por componentes) ────────────

/**
 * Linha da tabela de alíquota interna de ICMS + FCP por UF (vem do banco,
 * `public.icms_uf_aliquotas` / `aliquota_interna_vigente`, Fase 222-01). O
 * módulo não faz IO: quem lê o banco é a edge function do 222-05, que monta
 * este mapa a partir das linhas e passa por parâmetro.
 */
/**
 * Procedência da mercadoria (D-11). Importado sai a 4% de alíquota
 * interestadual (Resolução SF 13/2012), não 7%/12%.
 *
 * `aliqInterestadual + pctDifal` dá o MESMO total nas duas procedências — a
 * diferença só aparece quando a UF não recolhe DIFAL, e aí são 8 pp de ICMS.
 */
export type Procedencia = "nacional" | "importado";

/**
 * Tabela de DIFAL vinda de `icms_uf_aliquotas` (222-01-R, régua trocada por
 * D-R2-02/D-R2-03), indexada por UF e procedência.
 *
 * `pctDifal` deixou de ser dado armazenado: a tabela do banco guarda a
 * ALÍQUOTA INTERNA que a planilha oficial entrega, e o percentual sai de
 * `aliq_interna − aliq_interestadual` dentro de `aliquota_interna_vigente`.
 * Aqui ele chega pronto — este módulo não refaz a subtração.
 *
 * `fcp` é parcela PRÓPRIA (D-R2-03), nunca embutida no percentual. O desenho
 * anterior (D-09) presumia 2 pp de FCP no Rio de Janeiro; a planilha oficial
 * diz que a interna do RJ é 20 e não tem coluna de FCP — era presunção errada.
 * Zero é valor conhecido ("não há parcela"), diferente de ausência: linha com
 * FCP inválido não chega aqui, é descartada em `montarTabelaAliquotas`.
 */
export interface TabelaDifal {
  [uf: string]: Partial<
    Record<
      Procedencia,
      { aliqInterestadual: number; pctDifal: number; fcp: number; confirmado: boolean }
    >
  >;
}

/**
 * Procedência do DIFAL de um pedido (D-07, ampliada por D-12) — campo único
 * de cinco estados em vez de vários booleanos: o estado "documento E fórmula
 * ao mesmo tempo" (contagem dupla) fica inexprimível pelo tipo, não apenas
 * proibido por convenção.
 *
 * A ordem de verdade (D-12) é: documento fiscal > cobrado pelo ML > fórmula.
 *
 * - `"documento_fiscal"` — o DIFAL veio da NF-e de venda emitida. É a única
 *   fonte que a contadora reconhece como apuração; todas as outras são
 *   estimativa. **Ninguém escreve neste estado ainda** — o tipo existe para
 *   que a Fase 223 (ingestão da NF-e do Tiny) substitua a estimativa por
 *   pedido sem alterar nenhuma assinatura.
 * - `"cobrado_ml"` — o ML já cobrou o DIFAL na fatura para esta UF; o valor
 *   que vale é o cobrado, `difalAmount` calculado fica como previsão
 *   informativa, não soma no total.
 * - `"calculado"` — a lista de UFs cobradas pelo ML está preenchida
 *   (inclusive vazia) e não contém esta UF: a previsão entra na soma.
 * - `"nao_conciliado"` — a lista é nula: o cruzamento fatura↔pedidos (222-02)
 *   ainda não foi feito para esta loja; a previsão entra na soma, mas o
 *   valor cobrado não pode ser somado por cima em lugar nenhum.
 * - `null` — não há DIFAL a atribuir a este pedido.
 */
export type DifalFonte = "documento_fiscal" | "cobrado_ml" | "calculado" | "nao_conciliado";

/** Entrada de `computeOrderTax`. Nunca recebe custo de produto (D-06). */
export interface OrderTaxInput {
  config: OrderTaxConfig | null | undefined;
  ufDestino: string | null | undefined;
  receitaBruta: number | null | undefined;
  comissao: number | null | undefined;
  frete: number | null | undefined;
  tabelaUf: TabelaDifal | null | undefined;
  // NÃO EXISTE parâmetro `rebate` aqui, e a ausência é deliberada — ver o
  // bloco "Rebate: por que não há parâmetro" no cabeçalho de comissaoLiquida.
  /** Procedência do SKU (D-11). Sem marcação, `"nacional"` — o comportamento de sempre. */
  procedencia?: Procedencia | null | undefined;
}

/**
 * Imposto de um pedido decomposto em componentes com bases distintas
 * (D-04): `taxAmount` é e continua sendo o cenário SEM DIFAL — o cenário
 * com DIFAL é composto por cima, em `taxAmountComDifal`, nunca por
 * subtração de `taxAmount` (é o que mantém as RPCs que já leem `tax_amount`
 * corretas sem alteração).
 */
export interface OrderTaxBreakdown {
  /** Motivo da resolução de ICMS/regime — mesmo vocabulário de `AliquotaPedido`. */
  motivo: MotivoAliquota;
  icmsDebito: number | null;
  /** PIS/COFINS do cenário SEM DIFAL — base `receita − ICMS` (Tema 69). */
  pisCofinsDebito: number | null;
  /**
   * PIS/COFINS do cenário COM DIFAL — base `receita − ICMS − DIFAL` (D-10.1,
   * confirmado pela contadora em 13/08). São duas bases porque são dois
   * cenários; colapsar em uma só faria o cenário sem DIFAL pagar por um DIFAL
   * que ele não tem.
   */
  pisCofinsDebitoComDifal: number | null;
  creditoPcComissao: number | null;
  creditoPcFrete: number | null;
  /**
   * Crédito de ICMS sobre o frete (D-10.2).
   *
   * ⚠️ A base legal é o CTe emitido em nome do vendedor, não `orders.frete`
   * (que é o que o ML descontou). No Flex quem contrata a entrega é o
   * vendedor, então o CTe é de outra transportadora ou nem existe. Usar o
   * frete do pedido e a alíquota da operação é aproximação gerencial
   * declarada — dívida nomeada em D-10.2, resolvida pela Fase 223.
   */
  creditoIcmsFrete: number | null;
  /** Débitos menos créditos — cenário SEM DIFAL. Nunca inclui DIFAL nem FCP. */
  taxAmount: number | null;
  /** Derivado: taxAmount / receitaBruta × 100. Nunca uma alíquota tabelada. */
  taxRate: number | null;
  difalBase: number | null;
  difalAmount: number | null;
  fcpAmount: number | null;
  /** taxAmount + difalAmount + fcpAmount — o total exibido no cenário COM DIFAL. */
  taxAmountComDifal: number | null;
  /** Derivado: taxAmountComDifal / receitaBruta × 100. */
  taxRateComDifal: number | null;
  difalFonte: DifalFonte | null;
  /** Motivo nomeado de ausência de DIFAL — nunca zero por omissão (FISC-05). */
  difalMotivoAusencia: string | null;
}

/** Número finito e não negativo, ou `null` — nunca propaga NaN/Infinity para a soma (T-222-14). */
function numeroValido(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/** taxAmount/receitaBruta × 100, ou null se a receita não for um número válido. */
function taxRateDerivado(taxAmount: number | null, receitaBruta: number | null): number | null {
  if (taxAmount === null || receitaBruta === null || receitaBruta === 0) return null;
  return (taxAmount / receitaBruta) * 100;
}

/** Breakdown inteiramente null — usado por toda guarda de ausência. */
function breakdownNulo(motivo: MotivoAliquota, difalMotivoAusencia: string): OrderTaxBreakdown {
  return {
    motivo,
    icmsDebito: null,
    pisCofinsDebito: null,
    pisCofinsDebitoComDifal: null,
    creditoPcComissao: null,
    creditoPcFrete: null,
    creditoIcmsFrete: null,
    taxAmount: null,
    taxRate: null,
    difalBase: null,
    difalAmount: null,
    fcpAmount: null,
    taxAmountComDifal: null,
    taxRateComDifal: null,
    difalFonte: null,
    difalMotivoAusencia,
  };
}

/** Normaliza sigla de UF: caixa alta, sem espaço em volta. */
function normalizarUf(uf: string): string {
  return uf.trim().toUpperCase();
}

/** `true` se `lista` (já normalizada por item) contém `uf` (comparação insensível a caixa/espaço). */
function listaContemUf(lista: string[], uf: string): boolean {
  const alvo = normalizarUf(uf);
  return lista.some((item) => typeof item === "string" && normalizarUf(item) === alvo);
}

/**
 * Componentes do DIFAL (BASE SIMPLES, D-08) para um pedido já com destino
 * conhecido e interestadual. Devolvido junto do motivo de ausência (`null`
 * quando o DIFAL foi calculado com sucesso).
 */
interface DifalResolvido {
  difalBase: number | null;
  difalAmount: number | null;
  fcpAmount: number | null;
  difalMotivoAusencia: string | null;
}

/**
 * Resolve o DIFAL de um pedido do regime `lucro_real` já com destino
 * interestadual conhecido (`motivoIcms` é `"interestadual"` ou
 * `"sem_uf_origem"` — nunca chamada para `"intraestadual"` nem
 * `"destino_desconhecido"`, que são guardas resolvidas antes de chegar aqui).
 *
 * BASE SIMPLES (D-08): `DIFAL = receita × pct_difal`. Não existe mais o
 * `/(1 − aliqInterna)` da base dupla. A contadora não escolheu entre as duas
 * bases — disse que a fórmula vale onde NÃO há nota, e que onde a NF-e é
 * emitida a margem sai do documento fiscal. O que este módulo produz é, por
 * isso, ESTIMATIVA declarada (D-12).
 *
 * O percentual vem de `tabelaUf`, nunca hardcoded (222-01-R versiona a tabela
 * no banco), e já traz o FCP embutido onde ele existe.
 */
function resolverDifal(
  dest: string,
  receitaBruta: number,
  tabelaUf: TabelaDifal | null | undefined,
  procedencia: Procedencia,
): DifalResolvido {
  const linha = tabelaUf?.[dest]?.[procedencia];

  if (!linha || typeof linha.pctDifal !== "number" || !Number.isFinite(linha.pctDifal)) {
    // Linha ausente: falta cadastro na tabela para esta UF/procedência —
    // distinto de "existe mas não foi conferida" (uf_nao_confirmada). Quem lê
    // a view de saúde do 222-05 precisa saber qual dos dois é o caso.
    return { difalBase: null, difalAmount: null, fcpAmount: null, difalMotivoAusencia: "uf_fora_da_tabela" };
  }

  if (!linha.confirmado) {
    // Linha existe mas nenhuma fonte a confirmou (222-01-R: `confirmado_por`).
    return { difalBase: null, difalAmount: null, fcpAmount: null, difalMotivoAusencia: "uf_nao_confirmada" };
  }

  // Base simples: a própria receita da operação.
  const difalBase = receitaBruta;
  const difalAmount = receitaBruta * (linha.pctDifal / 100);
  // FCP já está embutido em pctDifal (D-09) — este campo fica em zero por
  // compatibilidade com 222-05/222-07, que já o leem. Zero aqui é valor
  // conhecido ("não há parcela separada"), não ausência de dado.
  const fcpAmount = 0;

  return { difalBase, difalAmount, fcpAmount, difalMotivoAusencia: null };
}

/** Procedência do DIFAL (D-07) a partir das duas listas de configuração. */
function resolverDifalFonte(
  dest: string,
  ufsCobradasPeloMl: string[] | null | undefined,
): DifalFonte {
  if (ufsCobradasPeloMl == null) {
    // O cruzamento fatura↔pedidos (222-02) ainda não foi feito para esta loja.
    return "nao_conciliado";
  }
  if (listaContemUf(ufsCobradasPeloMl, dest)) {
    // O ML já cobra o DIFAL desta UF na fatura — o valor que vale é o
    // cobrado (fato); o calculado abaixo fica como previsão informativa.
    return "cobrado_ml";
  }
  // Lista preenchida (mesmo vazia) e não contém a UF: ainda não foi cobrado,
  // a previsão calculada entra na soma.
  return "calculado";
}

/**
 * Transforma a fonte única da alíquota (`orderTaxRate.ts`, Fase 220) na
 * fonte única do imposto DECOMPOSTO: ICMS débito, PIS/COFINS débito, os
 * três créditos de D-01/D-10.2 (sempre ligados, sem toggle), DIFAL por BASE
 * SIMPLES (D-08) e a procedência do DIFAL (D-07/D-12).
 */
export function computeOrderTax(input: OrderTaxInput): OrderTaxBreakdown {
  const { config, ufDestino, tabelaUf } = input;
  const receitaBruta = numeroValido(input.receitaBruta);
  const comissao = numeroValido(input.comissao);
  const frete = numeroValido(input.frete);
  const procedencia: Procedencia = input.procedencia === "importado" ? "importado" : "nacional";

  // 1. Sem configuração fiscal, não existe imposto a inventar.
  if (!config) {
    return breakdownNulo("sem_config", "sem_config");
  }

  // 2. Regimes fixos (Simples Nacional, Lucro Presumido): o destino não
  //    entra na conta, não há crédito de PIS/COFINS (a apuração desses
  //    regimes não funciona por débito/crédito) e o DIFAL não se aplica —
  //    é regime, não ausência de dado.
  if (config.regime === "simples_nacional" || config.regime === "lucro_presumido") {
    const { rate, motivo } = computeOrderTaxRate(config, ufDestino);
    if (rate === null || receitaBruta === null) {
      return breakdownNulo(motivo, "regime_nao_aplicavel");
    }
    const taxAmount = receitaBruta * (rate / 100);
    return {
      motivo,
      icmsDebito: null,
      pisCofinsDebito: null,
      pisCofinsDebitoComDifal: null,
      creditoPcComissao: null,
      creditoPcFrete: null,
      creditoIcmsFrete: null,
      taxAmount,
      taxRate: taxRateDerivado(taxAmount, receitaBruta),
      difalBase: null,
      difalAmount: null,
      fcpAmount: null,
      taxAmountComDifal: null,
      taxRateComDifal: null,
      difalFonte: null,
      difalMotivoAusencia: "regime_nao_aplicavel",
    };
  }

  // 3. Lucro Real — a mesma resolução de destino que computeOrderTaxRate usa.
  const { icmsAliquota, motivo } = resolveIcmsAliquota(config, ufDestino);

  if (icmsAliquota === null || receitaBruta === null) {
    // destino_desconhecido (ou receita ausente): motivo já nomeia a causa.
    return breakdownNulo(motivo, motivo);
  }

  // ICMS "por dentro": já embutido no preço, débito = receita × alíquota (D-03).
  const icmsDebito = receitaBruta * (icmsAliquota / 100);

  // Tema 69 (STF RE 574.706): base do PIS/COFINS é a receita MENOS o ICMS.
  // Esta é a base do cenário SEM DIFAL. A base do cenário COM DIFAL desconta
  // também o DIFAL (D-10.1) e é calculada depois, quando ele existir.
  const pisCofinsDebito = (receitaBruta - icmsDebito) * (PIS_COFINS_LUCRO_REAL / 100);

  // Créditos de D-01: base é o valor do SERVIÇO tomado, não a receita. Entram
  // sempre — não há parâmetro que os desligue.
  // null permanece null (ausência de base ≠ crédito zero conhecido).

  // ── Rebate: por que NÃO há parâmetro (D-10.3, resolvida por medição em 14/08) ──
  //
  // D-10.3 diz que o crédito de PIS/COFINS incide sobre a comissão LÍQUIDA de
  // rebate. Isso está correto — e JÁ É o que acontece, sem nenhum cálculo aqui.
  //
  // `orders.comissao` vem de `item.sale_fee` (sync-ml-orders), que é o valor que
  // o ML EFETIVAMENTE COBROU. Quando uma promoção cofinanciada está ativa, o ML
  // aplica a parte dele abatendo a própria comissão antes de reportar o
  // `sale_fee` — não repassando dinheiro por fora.
  //
  // Medido no anúncio MLB7070651566 (mesmo item, promoção SMART iniciada em
  // 01/08/2026):
  //   08/07  R$ 570,59 → comissão 62,76 = 11,00%   (fora da promoção)
  //   31/07  R$ 369,99 → comissão 40,70 = 11,00%   (fora da promoção)
  //   04/08  R$ 358,89 → comissão 21,90 =  6,10%   (dentro)  ← 9 pedidos iguais
  // E em MLB7168848038: 12,00% fora × 9,40% dentro.
  //
  // 🔴 Por isso subtrair um rebate aqui seria DUPLA CONTAGEM: reduziria a base
  // do crédito por um abatimento que o ML já fez. O parâmetro que existia neste
  // input foi REMOVIDO em 14/08 — parâmetro cujo único valor correto é zero não
  // é parâmetro, é armadilha para quem vier depois e o "preencher".
  //
  // O `meli_percentage` da API de promoções (`/seller-promotions/.../items`) NÃO
  // entra aqui. Ele serve à D-218-03 (break-even de ads com e sem rebate), que é
  // outra pergunta: "o anúncio dá margem por mérito ou só enquanto a promoção
  // durar?". Ali o rebate é informação de decisão, não componente de imposto.
  const creditoPcComissao = comissao === null
    ? null
    : comissao * (PIS_COFINS_LUCRO_REAL / 100);

  // Crédito de ICMS sobre o frete (D-10.2), na alíquota da própria operação.
  // Aproximação declarada: a base legal é o CTe, não o frete do pedido.
  const creditoIcmsFrete = frete === null ? null : frete * (icmsAliquota / 100);
  // PIS/COFINS do frete incide sobre o frete LÍQUIDO de ICMS, não sobre o cheio.
  const freteLiquido = frete === null ? null : frete - (creditoIcmsFrete ?? 0);
  const creditoPcFrete = freteLiquido === null
    ? null
    : freteLiquido * (PIS_COFINS_LUCRO_REAL / 100);

  const creditosTotais = (creditoPcComissao ?? 0) + (creditoPcFrete ?? 0) + (creditoIcmsFrete ?? 0);

  const taxAmount = icmsDebito + pisCofinsDebito - creditosTotais;
  const taxRate = taxRateDerivado(taxAmount, receitaBruta);

  // 4. DIFAL: só se aplica quando o destino é conhecido e interestadual —
  //    derivado do MESMO destino que já resolveu o ICMS acima, nunca uma
  //    quarta cópia da regra de destino.
  if (motivo === "intraestadual") {
    return {
      motivo, icmsDebito, pisCofinsDebito, pisCofinsDebitoComDifal: null,
      creditoPcComissao, creditoPcFrete, creditoIcmsFrete, taxAmount, taxRate,
      difalBase: null, difalAmount: null, fcpAmount: null,
      taxAmountComDifal: null, taxRateComDifal: null, difalFonte: null,
      difalMotivoAusencia: "intraestadual",
    };
  }

  const dest = normalizarUf(String(ufDestino ?? ""));
  const difal = resolverDifal(dest, receitaBruta, tabelaUf, procedencia);

  if (difal.difalAmount === null) {
    // Guarda de tabela (uf_fora_da_tabela ou uf_nao_confirmada) — o imposto
    // base continua calculado normalmente, só o DIFAL fica ausente.
    return {
      motivo, icmsDebito, pisCofinsDebito, pisCofinsDebitoComDifal: null,
      creditoPcComissao, creditoPcFrete, creditoIcmsFrete, taxAmount, taxRate,
      difalBase: null, difalAmount: null, fcpAmount: null,
      taxAmountComDifal: null, taxRateComDifal: null, difalFonte: null,
      difalMotivoAusencia: difal.difalMotivoAusencia,
    };
  }

  // D-10.1: no cenário COM DIFAL a base do PIS/COFINS desconta também o DIFAL.
  // Confirmado pela contadora em 13/08: "tanto difal quanto ICMS são utilizados
  // para exclusão da base de pis e cofins".
  const pisCofinsDebitoComDifal =
    (receitaBruta - icmsDebito - difal.difalAmount) * (PIS_COFINS_LUCRO_REAL / 100);

  // Composto POR CIMA, nunca por subtração de taxAmount — é o que mantém as 9
  // RPCs que já leem tax_amount corretas sem uma linha alterada.
  const taxAmountComDifal =
    icmsDebito + difal.difalAmount + pisCofinsDebitoComDifal + (difal.fcpAmount ?? 0) - creditosTotais;
  const taxRateComDifal = taxRateDerivado(taxAmountComDifal, receitaBruta);
  const difalFonte = resolverDifalFonte(dest, config.difal_ufs_cobradas_pelo_ml);

  return {
    motivo,
    icmsDebito,
    pisCofinsDebito,
    pisCofinsDebitoComDifal,
    creditoPcComissao,
    creditoPcFrete,
    creditoIcmsFrete,
    taxAmount,
    taxRate,
    difalBase: difal.difalBase,
    difalAmount: difal.difalAmount,
    fcpAmount: difal.fcpAmount,
    taxAmountComDifal,
    taxRateComDifal,
    difalFonte,
    difalMotivoAusencia: null,
  };
}
