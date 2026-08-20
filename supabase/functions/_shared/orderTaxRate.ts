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
 *
 * O QUE MUDOU NA RODADA R2 (19/08/2026): o Wesley trouxe uma versão do
 * dashboard cuja régua fiscal A CONTADORA APROVOU. Rodando o módulo dela e
 * este no MESMO pedido real (`2000017711929314`), UMA ÚNICA linha divergia — a
 * base do crédito da comissão. As três correções que este módulo passou a
 * adotar (222-CONTEXT-R2.md, decisões fechadas pelo Wesley, não reabríveis):
 *
 * 1. D-R2-01 — o crédito de PIS/COFINS sobre a comissão incide sobre a
 *    comissão LÍQUIDA de um ICMS DE REFERÊNCIA (`comissão × alíquota`), não
 *    sobre a comissão cheia. 🔴 Esse ICMS de referência NÃO é crédito e NÃO
 *    entra no total de créditos: comissão é prestação de serviço e não gera
 *    crédito de ICMS de fato — somá-lo seria INVENTAR crédito. Ele existe só
 *    para reduzir a base do item seguinte. Vale +R$ 0,88 de imposto por pedido
 *    de Lucro Real interestadual.
 *
 * 2. D-R2-03 — o FCP é PARCELA PRÓPRIA, calculada do campo `fcp` da tabela de
 *    UF, e não mais presunção embutida no percentual do DIFAL. Isto REVOGA o
 *    desenho anterior (D-09), que presumia 2 pp de FCP no Rio de Janeiro: a
 *    planilha oficial diz que a interna do RJ é 20, não 22, e não tem coluna
 *    de FCP. Era presunção errada. Enquanto todas as UFs tiverem FCP zero
 *    nenhum número se move — mas o desenho fica certo ANTES de a primeira UF
 *    ganhar FCP.
 *
 * 3. D-R2-04 — o frete pago pelo COMPRADOR no checkout entra em DOIS lugares:
 *    soma na BASE TRIBUTÁVEL (de ICMS, de DIFAL e do PIS/COFINS débito),
 *    porque a NF-e cobre produto + frete cobrado do cliente; e soma ao frete
 *    do vendedor para formar o FRETE TOTAL, base dos dois créditos de frete. O
 *    frete que o VENDEDOR absorve continua fora da base — só gera crédito.
 *    Sem isso, todo pedido em que o comprador paga o envio saía com a base do
 *    ICMS errada.
 *
 * 🔴 A ÂNCORA: `icmsDebito + pisCofinsDebito` do caso-prova continua dando
 * 139,568186 — é o `orders.tax_amount` gravado hoje em produção. Nenhuma das
 * três mudanças acima move a BASE do caso-prova; a primeira mexe só no
 * crédito, a segunda só no cenário COM DIFAL, e a terceira é NEUTRA no cenário
 * sem DIFAL (soma o mesmo valor ao débito e ao crédito).
 *
 * O QUE MUDOU EM 20/08/2026 (Quick 260820-ikj): o imposto por pedido passa a
 * CLAMPAR EM ZERO, exatamente como o arquivo aprovado pela contadora faz
 * (`netAmount = Math.max(0, totalDebits - totalCredits)`). A auditoria
 * independente da fase varreu os 8.544 pedidos da régua nova e achou 7 com
 * imposto NEGATIVO, somando −R$ 9,46 (pior caso −R$ 3,20, pedido
 * `2000017173622482`). A aritmética estava certa — é POSIÇÃO CREDORA: em 5
 * deles o frete que o vendedor absorve supera a própria receita, e os créditos
 * de PIS/COFINS e de ICMS sobre esse frete superam os débitos da venda.
 *
 * Três consequências de desenho, todas deliberadas:
 *
 * a) Clampam os DOIS cenários (`taxAmount` e `taxAmountComDifal`), não só o
 *    primeiro. Pré-clamp vale sempre
 *    `taxAmountComDifal − taxAmount = (difal + fcp) × 0,9075 ≥ 0`: o cenário
 *    com DIFAL nunca é menor que o sem DIFAL. `Math.max` é monotônico, então
 *    clampar os dois preserva essa ordem — clampar um só a INVERTE, e a tela
 *    passaria a mostrar o cenário mais caro como o mais barato nas duas faixas
 *    de MCO que a 222-15 pôs em todas as telas.
 *
 * b) As alíquotas DERIVAM do valor já clampado, e nunca são clampadas
 *    sozinhas. `taxRateDerivado(0, receita)` já devolve 0, então basta a ordem
 *    das operações. 🔴 Um `Math.max` na TAXA produziria `taxAmount = −3,20` com
 *    `taxRate = 0` e quebraria a identidade
 *    `tax_amount = preco_unit × quantidade × tax_rate / 100` que o resto do
 *    aplicativo usa — é por isso que o clamp mora no VALOR, em um lugar só.
 *
 * c) Os COMPONENTES ficam CRUS e o estado ganha NOME (`posicaoCredora`).
 *    Clampar componente inventaria número: se o total zera porque os créditos
 *    superam os débitos, qual crédito seria cortado? Não há resposta fiscal —
 *    qualquer escolha seria arbitrária. O clamp é decisão de LANÇAMENTO sobre
 *    o total, não correção dos fatos. Nesses pedidos a soma das partes
 *    deliberadamente NÃO reconstrói o total, e é `posicaoCredora` (mais o
 *    predicado `ehPosicaoCredora`, que a tela consome) que impede a tela de
 *    mentir por omissão. É a mesma régua de `icmsRefComissao` e de
 *    `difalMotivoAusencia`: componente cru + estado nomeado.
 *
 * O QUE NÃO VEIO DA VERSÃO DELA, deliberadamente: a vigência por competência
 * (`taxConfigVigente.ts`), a procedência nacional × importado (4%, Resolução
 * SF 13/2012) e o `difalFonte` com a régua declarada como ESTIMATIVA. São os
 * três itens que só nós temos, e trazer a régua dela para dentro da nossa
 * (em vez de substituir o módulo) é o que os preserva.
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
  /** Frete que o VENDEDOR absorve (`orders.frete`). Fica FORA da base — só gera crédito. */
  frete: number | null | undefined;
  /**
   * Frete pago pelo COMPRADOR direto no checkout ("Mercado Envios por conta do
   * comprador", `orders.frete_comprador`, vindo de `receiver.cost` de
   * `GET /shipments/{id}/costs` — endpoint que `sync-ml-orders` JÁ chama).
   *
   * D-R2-04: entra em DOIS lugares — soma na base tributável (a NF-e cobre
   * produto + frete cobrado do cliente) E soma ao frete do vendedor para formar
   * o frete total do envio, base dos dois créditos de frete.
   *
   * OPCIONAL por compatibilidade: nenhum chamador antigo quebra por tipo. Os
   * dois chamadores reais passam a informá-lo no 222-13-R2. Ausente NÃO vira
   * zero em silêncio — conta como zero na soma, mas acende `baseIncompleta`.
   */
  freteComprador?: number | null | undefined;
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
  /**
   * ICMS DE REFERÊNCIA da comissão (D-R2-01): `comissão × alíquota de ICMS`.
   *
   * 🔴 NÃO É CRÉDITO e NÃO entra em `creditosTotais`. Comissão é prestação de
   * serviço e não gera crédito de ICMS de fato; somá-lo aos créditos seria
   * inventar crédito (no caso-prova o total iria de 12,679816 para 22,242616).
   * Existe só para reduzir `creditoComissaoBase` — e é devolvido para que a
   * tela mostre a linha da fórmula sem recalcular. O nome tem `Ref`, não
   * `Credito`, exatamente para que ninguém o some por engano.
   */
  icmsRefComissao: number | null;
  /** Base do crédito de PIS/COFINS sobre a comissão: `comissão − icmsRefComissao` (D-R2-01). */
  creditoComissaoBase: number | null;
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
  /**
   * A base tributável foi montada sem um insumo que deveria estar lá (T-222-R2-13).
   *
   * Hoje quem a acende é um só caso: `freteComprador` ausente num pedido de
   * Lucro Real. O número devolvido é o melhor possível (o frete ausente conta
   * como zero), mas ele fica DECLARADO como incompleto em vez de passar por
   * exato — é o que o 222-13-R2 conta na resposta do sync e a view de saúde
   * mede. Falso enquanto nada foi calculado (sem config, destino desconhecido)
   * e nos regimes fixos, cuja base não usa o frete do comprador: marcar ali
   * seria alarme falso.
   */
  baseIncompleta: boolean;
  /**
   * Os créditos superaram os débitos e o total foi LANÇADO COMO ZERO
   * (Quick 260820-ikj). Verdadeiro só no ramo de Lucro Real: é lá que a
   * apuração funciona por débito/crédito.
   *
   * 🔴 Quando é verdadeiro, os componentes devolvidos deliberadamente NÃO
   * reconstroem `taxAmount` — eles ficam CRUS, e o clamp incide só sobre o
   * total. Quem exibe o total tem de DIZER isso; sem o nome, a soma das partes
   * desmente o total em silêncio.
   *
   * Um flag basta, e é demonstrável: como `taxAmountComDifal ≥ taxAmount`
   * sempre (pré-clamp a diferença é `(difal + fcp) × 0,9075 ≥ 0`), um cenário
   * com DIFAL negativo IMPLICA o sem DIFAL negativo. O flag sobre o cenário sem
   * DIFAL é superconjunto do outro — dois flags seriam redundância, não
   * precisão.
   *
   * Falso em `breakdownNulo` (nada foi apurado, não há posição a declarar) e
   * falso nos regimes fixos (Simples Nacional e Lucro Presumido não apuram por
   * débito/crédito — marcar ali seria alarme falso, e a conta do Junior não
   * pode se mover).
   */
  posicaoCredora: boolean;
}

/**
 * Os cinco componentes de que a conta "débitos − créditos" precisa. Estrutural
 * de propósito: `OrderTaxBreakdown` satisfaz o tipo, e a TELA também o satisfaz
 * montando o objeto a partir das colunas gravadas em `orders` — assim as duas
 * chamam a MESMA função em vez de manterem duas cópias da subtração.
 */
export interface ComponentesFiscais {
  icmsDebito: number | null;
  pisCofinsDebito: number | null;
  creditoPcComissao: number | null;
  creditoPcFrete: number | null;
  creditoIcmsFrete: number | null;
}

/**
 * Soma dos créditos que de fato ABATEM o imposto.
 *
 * 🔴 `icmsRefComissao` NÃO entra aqui, e a ausência é a decisão: comissão é
 * prestação de SERVIÇO e não gera crédito de ICMS de fato — somá-lo inventaria
 * crédito que não existe (D-R2-01; no caso-prova o total saltaria de 12,679816
 * para 22,242616). Ele existe só para reduzir a base do crédito de PIS/COFINS
 * sobre a comissão.
 *
 * `null` é ausência de crédito, não crédito negativo: conta como zero na soma,
 * exatamente como a linha `creditosTotais` sempre fez.
 */
export function creditosQueAbatem(c: ComponentesFiscais): number {
  return (c.creditoPcComissao ?? 0) + (c.creditoPcFrete ?? 0) + (c.creditoIcmsFrete ?? 0);
}

/**
 * `débitos − créditos` do cenário SEM DIFAL, **SEM CLAMP** — o dono único
 * dessa conta (Quick 260820-ikj).
 *
 * Foram três cópias divergentes desta fórmula que criaram a Fase 220; esta
 * função existe para que a fórmula, a tela e o teste leiam a MESMA subtração.
 * Ela devolve o número CRU: é `computeOrderTax` que decide o lançamento
 * (`Math.max(0, ...)`), e é este valor que a tela usa para dizer de QUANTO os
 * créditos superaram os débitos.
 *
 * `null` quando os dois débitos são nulos — nada foi apurado, e ausência não
 * vira zero (FISC-05).
 *
 * 🔴 `icmsRefComissao` NÃO participa (ver `creditosQueAbatem`).
 */
export function liquidoSemDifalBruto(c: ComponentesFiscais): number | null {
  if (c.icmsDebito === null && c.pisCofinsDebito === null) return null;
  return (c.icmsDebito ?? 0) + (c.pisCofinsDebito ?? 0) - creditosQueAbatem(c);
}

/**
 * "Os créditos superaram os débitos neste pedido?" — o predicado que a fórmula
 * e a tela compartilham. Ausência de apuração NÃO é posição credora.
 */
export function ehPosicaoCredora(c: ComponentesFiscais): boolean {
  const liquido = liquidoSemDifalBruto(c);
  return liquido !== null && liquido < 0;
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
    icmsRefComissao: null,
    creditoComissaoBase: null,
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
    // Nada foi calculado — não existe base para estar incompleta.
    baseIncompleta: false,
    // Nada foi apurado, logo não há posição credora a declarar.
    posicaoCredora: false,
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
 * BASE SIMPLES (D-08): `DIFAL = base tributável × pct_difal`. Não existe mais
 * o `/(1 − aliqInterna)` da base dupla. A contadora não escolheu entre as duas
 * bases — disse que a fórmula vale onde NÃO há nota, e que onde a NF-e é
 * emitida a margem sai do documento fiscal. O que este módulo produz é, por
 * isso, ESTIMATIVA declarada (D-12).
 *
 * A BASE é a TRIBUTÁVEL (D-R2-04), não a receita bruta: onde o comprador paga
 * o envio, o frete dele está na nota e o DIFAL incide sobre ele também.
 *
 * O percentual vem de `tabelaUf`, nunca hardcoded (222-01-R versiona a tabela
 * no banco). O FCP é PARCELA PRÓPRIA (D-R2-03), calculada do campo `fcp` da
 * mesma linha — o desenho de "FCP embutido no percentual" (D-09) está REVOGADO,
 * porque presumia 2 pp de FCP no RJ que a planilha oficial não confirma.
 *
 * FCP inválido descarta a LINHA INTEIRA, na mesma régua do percentual: FCP
 * ausente nunca vira FCP zero (FISC-05). `montarTabelaAliquotas` já derruba a
 * linha antes (222-10-R2); a guarda aqui é a segunda tranca, para o caso de a
 * tabela chegar montada à mão.
 */
function resolverDifal(
  dest: string,
  baseTributavel: number,
  tabelaUf: TabelaDifal | null | undefined,
  procedencia: Procedencia,
): DifalResolvido {
  const linha = tabelaUf?.[dest]?.[procedencia];

  if (
    !linha ||
    typeof linha.pctDifal !== "number" || !Number.isFinite(linha.pctDifal) ||
    typeof linha.fcp !== "number" || !Number.isFinite(linha.fcp)
  ) {
    // Linha ausente: falta cadastro na tabela para esta UF/procedência —
    // distinto de "existe mas não foi conferida" (uf_nao_confirmada). Quem lê
    // a view de saúde do 222-05 precisa saber qual dos dois é o caso.
    return { difalBase: null, difalAmount: null, fcpAmount: null, difalMotivoAusencia: "uf_fora_da_tabela" };
  }

  if (!linha.confirmado) {
    // Linha existe mas nenhuma fonte a confirmou (222-01-R: `confirmado_por`).
    return { difalBase: null, difalAmount: null, fcpAmount: null, difalMotivoAusencia: "uf_nao_confirmada" };
  }

  // Base simples: a própria base tributável da operação (venda + frete do
  // comprador), nunca a receita do produto sozinha.
  const difalBase = baseTributavel;
  const difalAmount = baseTributavel * (linha.pctDifal / 100);
  // D-R2-03: parcela PRÓPRIA, do campo da tabela. Zero continua sendo valor
  // conhecido ("esta UF não tem FCP"), distinto de ausência — mas agora é zero
  // porque a FONTE diz zero, não porque o código presume.
  const fcpAmount = baseTributavel * (linha.fcp / 100);

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
  // D-R2-04: mesma validação dos demais valores monetários — negativo, não
  // finito e não numérico caem em ausência, nunca são somados à base.
  const freteComprador = numeroValido(input.freteComprador);
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
      icmsRefComissao: null,
      creditoComissaoBase: null,
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
      // A base do regime fixo é a receita bruta e não usa o frete do
      // comprador — ela não fica incompleta por ele faltar. Marcar aqui seria
      // alarme falso, e a conta do Junior não pode se mover (T-222-R2-14).
      baseIncompleta: false,
      // Simples Nacional e Lucro Presumido não apuram por débito/crédito: não
      // existe posição credora possível, e o clamp não alcança este ramo — a
      // conta do Junior não pode se mover (T-ikj-05).
      posicaoCredora: false,
    };
  }

  // 3. Lucro Real — a mesma resolução de destino que computeOrderTaxRate usa.
  const { icmsAliquota, motivo } = resolveIcmsAliquota(config, ufDestino);

  if (icmsAliquota === null || receitaBruta === null) {
    // destino_desconhecido (ou receita ausente): motivo já nomeia a causa.
    return breakdownNulo(motivo, motivo);
  }

  // ── As duas grandezas derivadas de D-R2-04, calculadas UMA vez ───────────
  //
  // A nota fiscal cobre produto + frete cobrado do cliente: o frete que o
  // COMPRADOR paga está dentro da base tributável. O que o VENDEDOR absorve
  // fica fora dela e só aparece do lado do crédito.
  //
  // Ausente conta como zero — é o único valor com que se pode seguir — mas o
  // resultado sai com `baseIncompleta`, para que a ausência seja NOMEADA em
  // vez de silenciosa (FISC-05, T-222-R2-13).
  const baseTributavel = receitaBruta + (freteComprador ?? 0);
  const baseIncompleta = freteComprador === null;

  // Frete TOTAL do envio, base dos dois créditos de frete. Cada parcela
  // ausente conta como zero, mas se AMBAS forem ausentes o frete total é
  // ausente, não zero — os créditos continuam nulos, como sempre foram.
  const freteTotal = frete === null && freteComprador === null
    ? null
    : (frete ?? 0) + (freteComprador ?? 0);

  // ICMS "por dentro": já embutido no preço, débito = base × alíquota (D-03).
  const icmsDebito = baseTributavel * (icmsAliquota / 100);

  // Tema 69 (STF RE 574.706): base do PIS/COFINS é a base tributável MENOS o
  // ICMS. Esta é a base do cenário SEM DIFAL. A do cenário COM DIFAL desconta
  // também o DIFAL e o FCP (D-10.1 + D-R2-03) e é calculada depois.
  const pisCofinsDebito = (baseTributavel - icmsDebito) * (PIS_COFINS_LUCRO_REAL / 100);

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
  //
  // ── D-R2-01: a base do crédito da comissão é LÍQUIDA de um ICMS de
  // referência, a pedido da CONTADORA (é a única linha em que o módulo dela e
  // o nosso divergiam no pedido real medido).
  //
  // 🔴 `icmsRefComissao` NÃO É CRÉDITO. Ele não entra em `creditosTotais`, e
  // isso é a decisão, não um esquecimento: a comissão é prestação de SERVIÇO e
  // não gera crédito de ICMS de fato — somá-lo inventaria crédito que não
  // existe (no caso-prova o total saltaria de 12,679816 para 22,242616, e o
  // imposto cairia R$ 9,56 por pedido sem nenhuma base legal). Ele serve só
  // para reduzir a base do item seguinte.
  const icmsRefComissao = comissao === null ? null : comissao * (icmsAliquota / 100);
  const creditoComissaoBase = comissao === null ? null : comissao - (icmsRefComissao ?? 0);
  const creditoPcComissao = creditoComissaoBase === null
    ? null
    : creditoComissaoBase * (PIS_COFINS_LUCRO_REAL / 100);

  // Crédito de ICMS sobre o frete (D-10.2), na alíquota da própria operação,
  // sobre o frete TOTAL do envio (vendedor + comprador, D-R2-04).
  // Aproximação declarada: a base legal é o CTe, não o frete do pedido.
  const creditoIcmsFrete = freteTotal === null ? null : freteTotal * (icmsAliquota / 100);
  // PIS/COFINS do frete incide sobre o frete LÍQUIDO de ICMS, não sobre o cheio.
  const freteLiquido = freteTotal === null ? null : freteTotal - (creditoIcmsFrete ?? 0);
  const creditoPcFrete = freteLiquido === null
    ? null
    : freteLiquido * (PIS_COFINS_LUCRO_REAL / 100);

  // Os TRÊS créditos que de fato abatem o imposto vêm do DONO ÚNICO da conta
  // (`creditosQueAbatem`), a mesma função que a tela chama — nunca uma segunda
  // expressão somando os três à mão. `icmsRefComissao` está deliberadamente
  // fora dessa soma — ver o bloco acima.
  const componentes: ComponentesFiscais = {
    icmsDebito,
    pisCofinsDebito,
    creditoPcComissao,
    creditoPcFrete,
    creditoIcmsFrete,
  };
  const creditosTotais = creditosQueAbatem(componentes);

  // Neste ramo os dois débitos são sempre números, então o líquido bruto nunca
  // é nulo aqui — a guarda de `null` de `liquidoSemDifalBruto` serve à tela,
  // que pode receber linha sem componente gravado.
  const taxAmountBruto = liquidoSemDifalBruto(componentes) ?? 0;

  // CLAMP EM ZERO (Quick 260820-ikj), no molde exato do arquivo que a contadora
  // aprovou: `netAmount = Math.max(0, totalDebits - totalCredits)`. Quando os
  // créditos superam os débitos o imposto é LANÇADO como zero — os componentes
  // acima seguem CRUS, e `posicaoCredora` declara o estado em vez de deixar a
  // soma das partes desmentir o total em silêncio.
  const taxAmount = Math.max(0, taxAmountBruto);
  const posicaoCredora = ehPosicaoCredora(componentes);

  // A taxa DERIVA do valor já clampado — nunca um `Math.max` na própria taxa,
  // que produziria valor negativo com taxa zero e quebraria a identidade
  // abaixo. `taxRateDerivado(0, receita)` já devolve exatamente 0.
  // O denominador continua sendo a RECEITA BRUTA do produto, nunca a base
  // tributável: é o que preserva a identidade `tax_amount = preco_unit ×
  // quantidade × tax_rate / 100` que o resto do aplicativo usa. O arquivo
  // aprovado faz a mesma escolha, pela mesma razão.
  const taxRate = taxRateDerivado(taxAmount, receitaBruta);

  // 4. DIFAL: só se aplica quando o destino é conhecido e interestadual —
  //    derivado do MESMO destino que já resolveu o ICMS acima, nunca uma
  //    quarta cópia da regra de destino.
  if (motivo === "intraestadual") {
    return {
      motivo, icmsDebito, pisCofinsDebito, pisCofinsDebitoComDifal: null,
      icmsRefComissao, creditoComissaoBase,
      creditoPcComissao, creditoPcFrete, creditoIcmsFrete, taxAmount, taxRate,
      difalBase: null, difalAmount: null, fcpAmount: null,
      taxAmountComDifal: null, taxRateComDifal: null, difalFonte: null,
      difalMotivoAusencia: "intraestadual", baseIncompleta, posicaoCredora,
    };
  }

  const dest = normalizarUf(String(ufDestino ?? ""));
  const difal = resolverDifal(dest, baseTributavel, tabelaUf, procedencia);

  if (difal.difalAmount === null) {
    // Guarda de tabela (uf_fora_da_tabela ou uf_nao_confirmada) — o imposto
    // base continua calculado normalmente, só o DIFAL fica ausente.
    return {
      motivo, icmsDebito, pisCofinsDebito, pisCofinsDebitoComDifal: null,
      icmsRefComissao, creditoComissaoBase,
      creditoPcComissao, creditoPcFrete, creditoIcmsFrete, taxAmount, taxRate,
      difalBase: null, difalAmount: null, fcpAmount: null,
      taxAmountComDifal: null, taxRateComDifal: null, difalFonte: null,
      difalMotivoAusencia: difal.difalMotivoAusencia, baseIncompleta, posicaoCredora,
    };
  }

  // D-10.1: no cenário COM DIFAL a base do PIS/COFINS desconta também o DIFAL.
  // Confirmado pela contadora em 13/08: "tanto difal quanto ICMS são utilizados
  // para exclusão da base de pis e cofins".
  //
  // D-R2-03: o FCP deduz JUNTO com o DIFAL. É o desenho do arquivo aprovado —
  // lá os dois viajam somados dentro de um percentual só. Enquanto todas as
  // UFs tiverem FCP zero isto não move nenhum número; o desenho fica certo
  // ANTES de a primeira UF ganhar FCP, que é o ponto.
  const pisCofinsDebitoComDifal =
    (baseTributavel - icmsDebito - difal.difalAmount - (difal.fcpAmount ?? 0)) *
    (PIS_COFINS_LUCRO_REAL / 100);

  // Composto POR CIMA, nunca por subtração de taxAmount — é o que mantém as 9
  // RPCs que já leem tax_amount corretas sem uma linha alterada.
  //
  // D-ikj-01: o CLAMP vale para os DOIS cenários, não só o primeiro. Pré-clamp,
  // `comDifal − semDifal = (difal + fcp) × 0,9075 ≥ 0` — o cenário com DIFAL
  // nunca é menor que o sem DIFAL. `Math.max` é monotônico, então clampar os
  // dois PRESERVA essa ordem; clampar um só a inverte, e a tela exibiria o
  // cenário mais caro como o mais barato. A composição em si não muda.
  const taxAmountComDifalBruto =
    icmsDebito + difal.difalAmount + pisCofinsDebitoComDifal + (difal.fcpAmount ?? 0) - creditosTotais;
  const taxAmountComDifal = Math.max(0, taxAmountComDifalBruto);
  const taxRateComDifal = taxRateDerivado(taxAmountComDifal, receitaBruta);
  const difalFonte = resolverDifalFonte(dest, config.difal_ufs_cobradas_pelo_ml);

  return {
    motivo,
    icmsDebito,
    pisCofinsDebito,
    pisCofinsDebitoComDifal,
    icmsRefComissao,
    creditoComissaoBase,
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
    baseIncompleta,
    posicaoCredora,
  };
}

// ── Sentinela de intenção do upsert incremental (Quick 260820-3aa) ────────────
//
// O DEFEITO QUE ESTA SEÇÃO FECHA (medido em produção em 20/08/2026): uma
// rodada INCREMENTAL de sync-ml-orders (pedido já completo no banco, detalhe
// do envio não rebuscado) chega aqui com `estado` ausente, `computeOrderTax`
// devolve `motivo: "destino_desconhecido"` e os 11 campos fiscais (10
// componentes + o marcador `tax_versao`) saem todos `null` do breakdown. Até
// aqui, `sync-ml-orders` gravava esses `null` por ATRIBUIÇÃO DIRETA no record
// do upsert — e `batch_upsert_orders` escrevia por cima dos componentes que o
// backfill já tinha calculado. 103 linhas foram marcadas `tax_versao = 2` com
// componente ausente numa única rodada que respondeu 65 pedidos e buscou
// ZERO envios.
//
// A CORREÇÃO é de duas metades. Esta é a metade CLIENTE: em vez de o record
// sempre carregar as 11 chaves (com valor `null` quando não apurou), ele
// passa a carregar as chaves SÓ quando a rodada apurou. A metade SQL mora na
// migration `20260820210000`, no `DO UPDATE SET` de `batch_upsert_orders`:
// chave AUSENTE no payload jsonb devolve `NULL` no operador `->>`, e é essa
// ausência — não o valor — que o SQL lê para decidir entre escrever e
// preservar a linha.

/**
 * Valor do marcador `orders.tax_versao` que sinaliza "esta linha foi gravada
 * pela régua decomposta de `computeOrderTax`" (Fase 222). É o MESMO número
 * que o COMMENT da coluna homônima em `orders` já descreve — as duas portas
 * de escrita (`sync-ml-orders`, `recalc-order-costs`) passam a ler esta
 * constante em vez de repetir o literal `2`.
 */
export const TAX_VERSAO_REGUA_NOVA = 2;

/**
 * "Esta rodada teve insumo para apurar a régua nesta passada?" — o predicado
 * único do qual as duas portas de escrita passam a ler, em vez de cada uma
 * decidir por conta própria. `recalc-order-costs` já aplicava esta mesma
 * condição informalmente (governando a dupla `tax_amount` + `tax_versao`);
 * ganha aqui um dono só.
 *
 * Responde "a régua teve insumo para rodar nesta passada", e **não** "o
 * resultado tem componentes": regime fixo (Simples Nacional, Lucro
 * Presumido) APURA e não tem nenhum dos 10 componentes — `taxAmount` vem
 * preenchido, os componentes vêm `null` por DESENHO do regime, não por falta
 * de insumo. É essa distinção que mantém a conta do Junior parada: o Simples
 * sempre apurou, mesmo com `ufDestino: null` — o destino não entra na conta
 * dele.
 *
 * Toda guarda de ausência da fórmula já converge para `taxAmount === null`,
 * então o predicado cobre destino desconhecido, ausência de vigência,
 * ausência de config e receita ausente sem precisar enumerá-los um a um.
 */
export function reguaApurouNestaRodada(breakdown: OrderTaxBreakdown): boolean {
  return breakdown.taxAmount !== null;
}

/**
 * Molde dos 11 campos fiscais (10 componentes do breakdown decomposto + o
 * marcador `tax_versao`), no formato de COLUNA, pronto para `...spread` num
 * record de upsert ou num patch de update.
 *
 * Quando `reguaApurouNestaRodada(breakdown)` é falso, devolve `{}` — objeto
 * VAZIO, nenhuma das 11 chaves presente. Esta é a metade-CLIENTE da
 * sentinela de intenção: sem a chave marcadora (nem as demais) no payload,
 * `batch_upsert_orders` preserva a linha inteira em vez de gravar ausência
 * por cima de um componente que uma rodada anterior já tinha calculado.
 *
 * Quando o predicado é verdadeiro, devolve as 11 chaves com os valores do
 * breakdown — inclusive quando um componente é legitimamente `null` (regime
 * fixo: componentes ausentes com `tax_amount` presente). Presente-e-nula é
 * diferente de ausente: é o que permite ao backfill (que só escreve campo
 * não nulo) continuar sendo a única porta capaz de LIMPAR um componente
 * não-nulo errado, sem que esta função precise imitar esse comportamento.
 */
export function camposFiscaisParaUpsert(breakdown: OrderTaxBreakdown): Record<string, unknown> {
  if (!reguaApurouNestaRodada(breakdown)) return {};
  return {
    icms_debito: breakdown.icmsDebito,
    pis_cofins_debito: breakdown.pisCofinsDebito,
    credito_pc_comissao: breakdown.creditoPcComissao,
    credito_pc_frete: breakdown.creditoPcFrete,
    credito_icms_frete: breakdown.creditoIcmsFrete,
    pis_cofins_debito_com_difal: breakdown.pisCofinsDebitoComDifal,
    difal_base: breakdown.difalBase,
    difal_amount: breakdown.difalAmount,
    fcp_amount: breakdown.fcpAmount,
    difal_fonte: breakdown.difalFonte,
    tax_versao: TAX_VERSAO_REGUA_NOVA,
  };
}
