/**
 * Helper puro dos dois cenários de MCO — com e sem DIFAL (Fase 222, D-02/D-07).
 *
 * Mesmo padrão das Fases 210 e 219: `src/lib/mco.ts` continua intocado, e a
 * fonte do número muda por CIMA dele. `computeMcoCenarios` chama
 * `computeMco` duas vezes — zero aritmética de MCO nova aqui.
 */

import { computeMco, type McoInput, type McoResult } from "./mco";

/**
 * Procedência do cenário "com DIFAL", uma de quatro estados (nunca dois ao
 * mesmo tempo — mesmo padrão de `DifalFonte` em `orderTaxRate.ts`):
 *
 * - `"calculado_nao_conciliado"` — a lista de UFs cobradas pelo ML
 *   (`ml_tax_config.difal_ufs_cobradas_pelo_ml`) ainda não foi configurada
 *   para nenhuma das lojas do filtro. Somar o valor da fatura aqui seria
 *   contar o mesmo DIFAL duas vezes — por isso só o calculado entra.
 * - `"cobrado_mais_devido_integral"` — a lista de cobrança está configurada,
 *   mas a de recolhimento (`difal_ufs_recolhidas`) não. Teto conservador:
 *   cobrado pelo ML + TODO o calculado das demais UFs.
 * - `"cobrado_mais_recolhido"` — as duas listas estão configuradas: cobrado
 *   pelo ML + só o calculado das UFs que a loja declarou recolher.
 * - `"indisponivel"` — o resumo de DIFAL não carregou (RPC falhou ou ainda
 *   não respondeu). Nunca cai para zero, que exibiria o cenário sem DIFAL
 *   com cara de cenário completo.
 */
export type DifalProcedencia =
  | "calculado_nao_conciliado"
  | "cobrado_mais_devido_integral"
  | "cobrado_mais_recolhido"
  | "indisponivel";

/**
 * Formato de entrada — os campos de `get_difal_summary` (222-07) que este
 * módulo efetivamente usa. Deliberadamente NÃO inclui
 * `difal_previsto_nas_ufs_cobradas`: esse campo é informativo (calibra a
 * fórmula contra a fatura), e a ausência dele na assinatura torna impossível
 * somá-lo por engano em qualquer cenário.
 */
export interface DifalSummaryInput {
  difal_calculado: number;
  difal_recolhido_pela_loja: number;
  difal_cobrado_ml: number;
  pedidos_difal_indefinido: number;
  regua_recolhimento_configurada: boolean;
  regua_cobranca_configurada: boolean;
}

export interface McoCenariosInput {
  /** Entrada de MCO de hoje — `tax` já é o cenário SEM DIFAL. */
  base: McoInput;
  /** Resumo vindo de `get_difal_summary`; `null`/`undefined` = indisponível. */
  difal: DifalSummaryInput | null | undefined;
}

export interface McoCenariosResult {
  /** Idêntico, ao centavo, a `computeMco(base)` — nunca recalculado aqui. */
  semDifal: McoResult;
  /** `null` só quando `procedencia` é `"indisponivel"` — nunca zero. */
  comDifal: McoResult | null;
  /** Valor de DIFAL somado ao imposto no cenário com DIFAL; `null` = indisponível. */
  difalAplicado: number | null;
  procedencia: DifalProcedencia;
  /** Contagem de pedidos fora da conta por UF não confirmada — sempre exibida. */
  pedidosIndefinidos: number;
}

/**
 * Decide o valor de DIFAL a somar e a procedência, a partir do resumo da
 * RPC. Não chama `computeMco` — é a metade "decisão de régua" da conta,
 * reutilizável por qualquer tela que precise só do valor (ex.: o KPI de
 * Impostos do Financeiro, que não precisa montar um `McoInput` inteiro).
 */
export function resolveDifalCenario(
  difal: DifalSummaryInput | null | undefined,
): {
  difalAplicado: number | null;
  procedencia: DifalProcedencia;
  pedidosIndefinidos: number;
} {
  if (!difal) {
    return { difalAplicado: null, procedencia: "indisponivel", pedidosIndefinidos: 0 };
  }

  const pedidosIndefinidos = difal.pedidos_difal_indefinido ?? 0;

  if (!difal.regua_cobranca_configurada) {
    // Régua de cobrança não configurada: somar o cobrado aqui seria contar
    // duas vezes o mesmo destino — estado seguro é só o calculado.
    return {
      difalAplicado: difal.difal_calculado,
      procedencia: "calculado_nao_conciliado",
      pedidosIndefinidos,
    };
  }

  if (!difal.regua_recolhimento_configurada) {
    // Cobrança configurada, recolhimento não: teto conservador — cobrado +
    // TODO o calculado das demais UFs (o `difal_calculado` da RPC já exclui
    // as UFs cobradas pelo ML, então não há dupla contagem aqui).
    return {
      difalAplicado: difal.difal_cobrado_ml + difal.difal_calculado,
      procedencia: "cobrado_mais_devido_integral",
      pedidosIndefinidos,
    };
  }

  // As duas configuradas: cobrado + só o que a loja declarou recolher.
  // `difal_recolhido_pela_loja` pode ser 0 (loja declarou que não recolhe
  // nada além do que o ML já cobra) — a procedência continua sendo esta,
  // não "só cobrado": a tela precisa poder dizer que a igualdade é
  // decisão da loja, não ausência de DIFAL.
  return {
    difalAplicado: difal.difal_cobrado_ml + difal.difal_recolhido_pela_loja,
    procedencia: "cobrado_mais_recolhido",
    pedidosIndefinidos,
  };
}

/**
 * `computeMcoCenarios({ base, difal })` — o MCO em dois números.
 *
 * `computeMco` é chamado exatamente duas vezes: uma para `semDifal` (o
 * cenário de hoje, sem alteração), uma para `comDifal` (o mesmo `base` com
 * `difalAplicado` somado ao imposto). Nenhuma fórmula de MCO é reimplementada
 * aqui.
 */
export function computeMcoCenarios({ base, difal }: McoCenariosInput): McoCenariosResult {
  const semDifal = computeMco(base);
  const { difalAplicado, procedencia, pedidosIndefinidos } = resolveDifalCenario(difal);

  const comDifal =
    difalAplicado === null
      ? null
      : computeMco({ ...base, tax: base.tax + difalAplicado });

  return { semDifal, comDifal, difalAplicado, procedencia, pedidosIndefinidos };
}
