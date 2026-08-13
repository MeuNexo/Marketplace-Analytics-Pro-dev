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
export interface TabelaAliquotasInternas {
  [uf: string]: { aliqInterna: number; aliqFcp: number; confirmado: boolean };
}

/**
 * Procedência do DIFAL de um pedido (D-07) — campo único de quatro estados
 * em vez de dois booleanos: o estado "cobrado e calculado ao mesmo tempo"
 * (contagem dupla) fica inexprimível pelo tipo, não apenas proibido por
 * convenção.
 *
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
export type DifalFonte = "cobrado_ml" | "calculado" | "nao_conciliado";

/** Entrada de `computeOrderTax`. Nunca recebe custo de produto (D-06). */
export interface OrderTaxInput {
  config: OrderTaxConfig | null | undefined;
  ufDestino: string | null | undefined;
  receitaBruta: number | null | undefined;
  comissao: number | null | undefined;
  frete: number | null | undefined;
  tabelaUf: TabelaAliquotasInternas | null | undefined;
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
  pisCofinsDebito: number | null;
  creditoPcComissao: number | null;
  creditoPcFrete: number | null;
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
    creditoPcComissao: null,
    creditoPcFrete: null,
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

/**
 * Transforma a fonte única da alíquota (`orderTaxRate.ts`, Fase 220) na
 * fonte única do imposto DECOMPOSTO: ICMS débito, PIS/COFINS débito, os
 * dois créditos de D-01 (sempre ligados, sem toggle), e — a partir da
 * Task 3 deste plano — DIFAL por base dupla, FCP e a procedência do DIFAL.
 *
 * Nesta task (Task 2), `difalBase`/`difalAmount`/`fcpAmount`/`difalFonte`
 * ainda saem `null` com `difalMotivoAusencia: "nao_calculado_ainda"` — a
 * Task 3 é quem liga o DIFAL, reaproveitando o mesmo destino já resolvido
 * aqui por `resolveIcmsAliquota`.
 */
export function computeOrderTax(input: OrderTaxInput): OrderTaxBreakdown {
  const { config, ufDestino, tabelaUf } = input;
  const receitaBruta = numeroValido(input.receitaBruta);
  const comissao = numeroValido(input.comissao);
  const frete = numeroValido(input.frete);
  void tabelaUf; // consumido pela Task 3

  // 1. Sem configuração fiscal, não existe imposto a inventar.
  if (!config) {
    return breakdownNulo("sem_config", "nao_calculado_ainda");
  }

  // 2. Regimes fixos (Simples Nacional, Lucro Presumido): o destino não
  //    entra na conta, não há crédito de PIS/COFINS (a apuração desses
  //    regimes não funciona por débito/crédito) e o DIFAL não se aplica.
  if (config.regime === "simples_nacional" || config.regime === "lucro_presumido") {
    const { rate, motivo } = computeOrderTaxRate(config, ufDestino);
    if (rate === null || receitaBruta === null) {
      return breakdownNulo(motivo, "nao_calculado_ainda");
    }
    const taxAmount = receitaBruta * (rate / 100);
    return {
      motivo,
      icmsDebito: null,
      pisCofinsDebito: null,
      creditoPcComissao: null,
      creditoPcFrete: null,
      taxAmount,
      taxRate: taxRateDerivado(taxAmount, receitaBruta),
      difalBase: null,
      difalAmount: null,
      fcpAmount: null,
      taxAmountComDifal: null,
      taxRateComDifal: null,
      difalFonte: null,
      difalMotivoAusencia: "nao_calculado_ainda",
    };
  }

  // 3. Lucro Real — a mesma resolução de destino que computeOrderTaxRate usa.
  const { icmsAliquota, motivo } = resolveIcmsAliquota(config, ufDestino);

  if (icmsAliquota === null || receitaBruta === null) {
    return breakdownNulo(motivo, "nao_calculado_ainda");
  }

  // ICMS "por dentro": já embutido no preço, débito = receita × alíquota (D-03).
  const icmsDebito = receitaBruta * (icmsAliquota / 100);

  // Tema 69 (STF RE 574.706): base do PIS/COFINS é a receita MENOS o ICMS.
  const pisCofinsDebito = (receitaBruta - icmsDebito) * (PIS_COFINS_LUCRO_REAL / 100);

  // Créditos de D-01: base é o valor do SERVIÇO tomado (comissão, frete),
  // não a receita. Entram sempre — não há parâmetro que os desligue.
  // null permanece null (ausência de base ≠ crédito zero conhecido).
  const creditoPcComissao = comissao === null ? null : comissao * (PIS_COFINS_LUCRO_REAL / 100);
  const creditoPcFrete = frete === null ? null : frete * (PIS_COFINS_LUCRO_REAL / 100);

  const taxAmount = icmsDebito + pisCofinsDebito - (creditoPcComissao ?? 0) - (creditoPcFrete ?? 0);
  const taxRate = taxRateDerivado(taxAmount, receitaBruta);

  return {
    motivo,
    icmsDebito,
    pisCofinsDebito,
    creditoPcComissao,
    creditoPcFrete,
    taxAmount,
    taxRate,
    // DIFAL: campos ainda desligados nesta task — a Task 3 substitui este
    // bloco pela aritmética de base dupla, FCP e procedência (D-07).
    difalBase: null,
    difalAmount: null,
    fcpAmount: null,
    taxAmountComDifal: null,
    taxRateComDifal: null,
    difalFonte: null,
    difalMotivoAusencia: "nao_calculado_ainda",
  };
}
