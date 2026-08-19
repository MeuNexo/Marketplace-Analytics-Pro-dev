// ============================================================================
// anuncioMargens — Fase 213, Plano 03, Task 1 (CR-08, AV-04)
//
// Régua deste módulo, em uma frase: esta é a margem TEÓRICA do catálogo —
// preço de hoje menos custo, comissão e imposto — que responde "se eu vender
// por X, quanto sobra". Ela NÃO é a margem operacional das vendas reais (essa
// vem da RPC `get_margin_with_ads_by_product`, consumida via
// `useMLMarginWithAds` e exposta como Mg. Op. / Mg. Pós-Ads). As duas nunca
// devem ser confundidas nem somadas.
//
// Por que este módulo existe (CR-08): o catálogo de `/anuncios` calculava
// "Mg. Líq." em dois lugares — ramo mobile e ramo desktop — com fórmulas
// DIFERENTES. O desktop usava preço efetivo (com promoção quando pedida),
// comissão real da API de listing costs quando disponível, e imposto pelo
// regime configurado. O mobile sempre usava a tabela estática de comissão,
// sempre o preço cheio, e SEM IMPOSTO NENHUM — cerca de 20 pontos percentuais
// de margem inventados na Pé Vermeio. O mesmo anúncio mostrava números
// diferentes dependendo do tamanho da tela. Existir uma única implementação
// pura, chamada pelos dois ramos, é o que impede essa divergência de voltar
// (ver teste de paridade em `anuncioMargens.test.ts`).
//
// A regra que resolve o CR-08: alíquota ausente torna a margem líquida
// INDEFINIDA, nunca calculada silenciosamente com imposto zero — que é
// precisamente o defeito do ramo mobile. Pelo mesmo motivo, custo ausente
// nunca produz margem zero: produz margem indefinida. Um número que some
// contexto sem avisar é pior do que nenhum número.
//
// AV-04 (`precoPromocionalAplicavel`): o preço promocional é publicado POR
// ANÚNCIO, não por variação. Aplicá-lo a uma variação com preço próprio
// diferente do preço de tabela do pai produziria um desconto fabricado — o ML
// não informa a proporção, e uma regra de três aqui seria um número inventado.
//
// Este módulo é PURO: nenhum import de React, de Supabase ou de rede. Quem
// resolve as fontes (custo por MLB ou por SKU, alíquota da loja, comissão do
// cache da API) é o componente de tela — `MLAnuncios.tsx` — que passa os
// valores JÁ RESOLVIDOS para cá. `getCommissionRate` é reaproveitado de
// `listingHelpers.ts` (mesmo padrão de módulo puro da casa) em vez de
// duplicar a tabela estática de comissão por tipo de anúncio.
// ============================================================================

import { getCommissionRate } from "@/components/mercadolivre/anuncios/listingHelpers";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface EntradaMargemAnuncio {
  /** Preço de tabela (preço "cheio") do anúncio ou da variação. */
  precoTabela: number;
  /** Preço promocional conhecido, quando existe uma promoção ativa no anúncio. */
  precoPromocional?: number | null;
  /** Se o chamador quer que o preço efetivo considere a promoção. */
  usarPromocao: boolean;
  /**
   * Custo do produto, já resolvido pelo chamador (por `item_id` ou por SKU).
   * `null` quando não há custo cadastrado — nunca `0` para representar ausência.
   */
  custo: number | null;
  /**
   * Alíquota efetiva da loja, em pontos percentuais (0–100), já resolvida e
   * clampada pelo chamador (`ml_tax_config.effective_rate`, com o mesmo piso
   * de zero que o resto da tela aplica). `null`/`undefined` quando a loja não
   * tem regime tributário configurado.
   */
  aliquotaEfetivaPct?: number | null;
  /**
   * Percentual de comissão real (0–100), vindo do cache da API de listing
   * costs, quando o cache já respondeu para este item. `null`/`undefined` faz
   * a comissão cair para a tabela estática por tipo de anúncio.
   */
  comissaoRealPct?: number | null;
  /** `listing_type_id` do anúncio — usado apenas para o fallback estático de comissão. */
  tipoAnuncio: string | null;
  /**
   * [222-15-R2] Acréscimo de REFERÊNCIA do DIFAL, em pontos percentuais, para
   * o segundo cenário desta tela.
   *
   * 🔴 POR QUE ELE NÃO É "O DIFAL DESTE ANÚNCIO": a margem teórica não conhece
   * pedido nenhum — ela usa a alíquota INTRAESTADUAL, e operação intraestadual
   * NÃO TEM DIFAL. Não existe destino, logo não existe DIFAL do anúncio. O que
   * este campo carrega é uma alíquota medida na mistura de estados REALMENTE
   * vendidos numa janela declarada (`JANELA_DIFAL_REFERENCIA_DIAS`), que
   * responde "se este anúncio vender na mesma mistura de estados dos últimos
   * 90 dias, quanto sobra".
   *
   * Quem resolve a referência é o CHAMADOR, como já acontece com a alíquota
   * efetiva. Ausente ⇒ o resultado é o de hoje, byte a byte.
   */
  difalPctReferencia?: number | null;
}

export interface ResultadoMargemAnuncio {
  /** Preço realmente usado no cálculo: promocional ou de tabela, conforme a régua abaixo. */
  precoEfetivo: number;
  /** Valor da comissão em reais, sobre o preço efetivo. */
  comissaoValor: number;
  /** Percentual de comissão usado no cálculo (0–100). */
  comissaoPct: number;
  /** `true` quando `comissaoPct` veio do cache real da API; `false` quando é estimativa da tabela estática. */
  comissaoReal: boolean;
  /** Valor do imposto em reais. `null` quando a loja não tem alíquota configurada. */
  impostoValor: number | null;
  /** Margem bruta em pontos percentuais: (preço efetivo − custo) ÷ preço efetivo × 100. `null` sem custo cadastrado. */
  margemBruta: number | null;
  /**
   * Margem líquida em pontos percentuais:
   * (preço efetivo − custo − comissão − imposto) ÷ preço efetivo × 100.
   * `null` sem custo cadastrado OU sem alíquota configurada — nunca calculada
   * silenciosamente tratando um dos dois como zero.
   */
  margemLiquida: number | null;
  /**
   * [222-15-R2] Imposto em R$ no cenário COM DIFAL de referência. `null`
   * quando a referência não foi informada OU quando a alíquota da loja não
   * está configurada — nunca calculado tratando um dos dois como zero.
   */
  impostoValorComDifal: number | null;
  /**
   * [222-15-R2] Margem líquida no cenário COM DIFAL de referência, pela MESMA
   * expressão da margem líquida acima, com a alíquota somada. `null` nas
   * mesmas condições em que `margemLiquida` é nula, mais a ausência de
   * referência.
   */
  margemLiquidaComDifal: number | null;
}

/**
 * Janela em que a alíquota de referência do DIFAL é medida. É constante
 * NOMEADA porque a tela precisa DIZER a janela ao lado do número: sem ela o
 * segundo cenário aparenta uma precisão por anúncio que ele não tem.
 */
export const JANELA_DIFAL_REFERENCIA_DIAS = 90;

/**
 * Alíquota de REFERÊNCIA do DIFAL, em pontos percentuais: a razão entre o
 * efeito líquido do DIFAL e a receita base dos MESMOS pedidos, na janela de
 * `JANELA_DIFAL_REFERENCIA_DIAS`.
 *
 * Devolve `null` (ausência declarada, nunca zero) quando não há receita medida
 * no período — a tela dirá que não houve venda na janela, em vez de exibir uma
 * alíquota de 0% que pareceria "o DIFAL não custa nada".
 *
 * O numerador e o denominador vêm do MESMO resumo agregado (`get_difal_summary`,
 * colunas `difal_calculado`/`reducao_pc_por_difal` e `receita_base`). Buscar o
 * denominador em outra consulta faria a razão sair de dois recortes diferentes.
 */
export function difalPctReferencia(
  efeitoLiquido: number | null | undefined,
  receitaBase: number | null | undefined,
): number | null {
  if (efeitoLiquido == null || receitaBase == null) return null;
  if (!(receitaBase > 0)) return null;
  return (efeitoLiquido / receitaBase) * 100;
}

// ─── calcularMargensDoAnuncio ──────────────────────────────────────────────

/**
 * Fonte única da margem teórica do catálogo. Ver o cabeçalho do arquivo para
 * a régua completa. Determinística e sem efeitos colaterais: a mesma entrada
 * sempre devolve exatamente o mesmo resultado — é essa propriedade que o
 * teste de paridade mobile × desktop explora.
 */
export function calcularMargensDoAnuncio(entrada: EntradaMargemAnuncio): ResultadoMargemAnuncio {
  const {
    precoTabela,
    precoPromocional = null,
    usarPromocao,
    custo,
    aliquotaEfetivaPct = null,
    comissaoRealPct = null,
    tipoAnuncio,
    difalPctReferencia: difalPctRef = null,
  } = entrada;

  // Preço efetivo: promocional só entra quando o chamador pediu E existe
  // promoção estritamente menor que o preço de tabela. Promoção ausente,
  // não pedida, ou maior/igual ao preço de tabela → usa o preço de tabela.
  const precoEfetivo =
    usarPromocao && precoPromocional != null && precoPromocional < precoTabela
      ? precoPromocional
      : precoTabela;

  // Comissão: real do cache quando disponível (inclusive quando o percentual
  // real é 0 — `!= null` distingue "não respondeu ainda" de "respondeu 0%").
  // Cai para a tabela estática por tipo de anúncio quando o cache não respondeu.
  const comissaoReal = comissaoRealPct != null;
  const comissaoPct = comissaoReal ? comissaoRealPct : getCommissionRate(tipoAnuncio) * 100;
  const comissaoValor = precoEfetivo * (comissaoPct / 100);

  // Imposto: indefinido quando a alíquota não está configurada. `0` é uma
  // alíquota válida (loja configurada com alíquota efetiva zero) e não deve
  // ser confundido com ausência — daí o `!= null` em vez de checagem de "truthy".
  const impostoValor = aliquotaEfetivaPct != null ? precoEfetivo * (aliquotaEfetivaPct / 100) : null;

  // Preço efetivo <= 0 nunca gera divisão por zero nem NaN/Infinity — margens
  // caem para indefinido, exatamente como na ausência de custo ou de imposto.
  const precoValido = precoEfetivo > 0;

  const margemBruta =
    custo != null && precoValido ? ((precoEfetivo - custo) / precoEfetivo) * 100 : null;

  const margemLiquida =
    custo != null && impostoValor != null && precoValido
      ? ((precoEfetivo - custo - comissaoValor - impostoValor) / precoEfetivo) * 100
      : null;

  // [222-15-R2] Segundo cenário: a MESMA expressão acima, com a alíquota de
  // referência somada à alíquota efetiva. Sem referência informada, os dois
  // campos saem nulos e o resultado é o de hoje, byte a byte — nenhuma tela
  // que ainda não passe a referência muda de comportamento.
  const impostoValorComDifal =
    aliquotaEfetivaPct != null && difalPctRef != null
      ? precoEfetivo * ((aliquotaEfetivaPct + difalPctRef) / 100)
      : null;

  const margemLiquidaComDifal =
    custo != null && impostoValorComDifal != null && precoValido
      ? ((precoEfetivo - custo - comissaoValor - impostoValorComDifal) / precoEfetivo) * 100
      : null;

  return {
    precoEfetivo,
    comissaoValor,
    comissaoPct,
    comissaoReal,
    impostoValor,
    margemBruta,
    margemLiquida,
    impostoValorComDifal,
    margemLiquidaComDifal,
  };
}

// ─── precoPromocionalAplicavel (AV-04) ─────────────────────────────────────

/**
 * Resolve se o preço promocional do anúncio PAI é legítimo para uma variação
 * específica. O ML publica a promoção por anúncio, não por variação — então
 * aplicá-la só faz sentido quando a variação parte do MESMO preço de tabela
 * do pai. Variação com preço próprio diferente devolve ausência (`null`):
 * nem desconto, nem selo de percentual fabricado por regra de três.
 *
 * @param precoPromoDoPai preço promocional do anúncio pai, ou `null`/`undefined` quando não há promoção ativa
 * @param precoDeTabelaDoPai preço de tabela (cheio) do anúncio pai
 * @param precoDaVariacao preço de tabela (cheio) da variação
 * @returns o preço promocional aplicável à variação, ou `null` quando não é legítimo aplicá-lo
 */
export function precoPromocionalAplicavel(
  precoPromoDoPai: number | null | undefined,
  precoDeTabelaDoPai: number,
  precoDaVariacao: number,
): number | null {
  if (precoPromoDoPai == null) return null;
  if (precoDaVariacao !== precoDeTabelaDoPai) return null;
  return precoPromoDoPai;
}
