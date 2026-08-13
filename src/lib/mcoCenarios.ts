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
 * Rótulo curto que TODA tela exibindo o cenário com DIFAL precisa mostrar
 * junto do número (D-12).
 *
 * POR QUE ISTO EXISTE COMO CONSTANTE, E NÃO COMO TEXTO SOLTO EM CADA TELA: a
 * contadora da Pé Vermeio, ao ser consultada em 13/08/2026, NÃO escolheu entre
 * base simples e base dupla. Disse que a fórmula vale onde não há nota, e que
 * onde a NF-e é emitida a margem sai do DOCUMENTO FISCAL. Como a Pé Vermeio
 * emite NF-e em todas as vendas, o DIFAL que esta régua calcula é
 * ESTIMATIVA — nunca a apuração. Uma tela que exiba o número sem essa palavra
 * está afirmando mais do que o dado sustenta, e é o tipo de afirmação que a
 * Fase 220 provou ser cara: régua fiscal errada não grita, produz um número
 * plausível.
 *
 * Quando a Fase 223 ingerir a NF-e de venda, os pedidos com
 * `difal_fonte = 'documento_fiscal'` deixam de ser estimativa e este rótulo
 * passa a valer só para o resto.
 */
export const DIFAL_ESTIMATIVA_LABEL = "estimativa";

/**
 * Frase completa para tooltip/ajuda, onde couber mais que o rótulo curto.
 */
export const DIFAL_ESTIMATIVA_AJUDA =
  "O DIFAL exibido é estimado pela régua fiscal, não apurado pela nota. " +
  "Onde há NF-e emitida, o valor que vale é o do documento fiscal.";

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
  /**
   * Quanto o PIS/COFINS DIMINUI por causa do DIFAL (D-10.1): a base do
   * PIS/COFINS no cenário com DIFAL é `receita − ICMS − DIFAL`, então entrar
   * com o DIFAL não custa o DIFAL cheio — custa o DIFAL **menos** este valor.
   *
   * Sem descontá-lo, a tela superestima o imposto e subestima o MCO. Medido no
   * caso-prova: R$ 3,85 por pedido.
   *
   * Opcional porque a RPC antiga não o devolvia; ausente ⇒ 0, que reproduz o
   * comportamento anterior em vez de quebrar.
   */
  reducao_pc_por_difal?: number | null;
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

  // [D-10.1] O DIFAL entra no imposto pelo seu EFEITO LÍQUIDO: ele soma como
  // débito, mas reduz a base do PIS/COFINS (`receita − ICMS − DIFAL`). Somar o
  // DIFAL cheio ignoraria essa redução e mostraria imposto maior e MCO menor
  // que o que `computeOrderTax` grava por pedido — medido: R$ 3,85 no
  // caso-prova. Ausente ⇒ 0 (RPC antiga), que preserva o comportamento
  // anterior em vez de quebrar.
  const reducaoPc = difal.reducao_pc_por_difal ?? 0;

  if (!difal.regua_cobranca_configurada) {
    // Régua de cobrança não configurada: somar o cobrado aqui seria contar
    // duas vezes o mesmo destino — estado seguro é só o calculado.
    return {
      difalAplicado: difal.difal_calculado - reducaoPc,
      procedencia: "calculado_nao_conciliado",
      pedidosIndefinidos,
    };
  }

  if (!difal.regua_recolhimento_configurada) {
    // Cobrança configurada, recolhimento não: teto conservador — cobrado +
    // TODO o calculado das demais UFs (o `difal_calculado` da RPC já exclui
    // as UFs cobradas pelo ML, então não há dupla contagem aqui).
    return {
      difalAplicado: difal.difal_cobrado_ml + difal.difal_calculado - reducaoPc,
      procedencia: "cobrado_mais_devido_integral",
      pedidosIndefinidos,
    };
  }

  // As duas configuradas: cobrado + só o que a loja declarou recolher.
  // `difal_recolhido_pela_loja` pode ser 0 (loja declarou que não recolhe
  // nada além do que o ML já cobra) — a procedência continua sendo esta,
  // não "só cobrado": a tela precisa poder dizer que a igualdade é
  // decisão da loja, não ausência de DIFAL.
  //
  // [D-10.1] Aqui só uma PARTE do DIFAL calculado entra na conta, então a
  // redução de PIS/COFINS entra rateada na mesma proporção — aplicar a
  // redução inteira sobre um subconjunto do débito daria crédito por um DIFAL
  // que este cenário não somou.
  const proporcaoRecolhida =
    difal.difal_calculado > 0
      ? difal.difal_recolhido_pela_loja / difal.difal_calculado
      : 0;

  return {
    difalAplicado:
      difal.difal_cobrado_ml + difal.difal_recolhido_pela_loja - reducaoPc * proporcaoRecolhida,
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
