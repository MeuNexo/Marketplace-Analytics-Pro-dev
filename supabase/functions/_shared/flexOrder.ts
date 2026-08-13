/**
 * flexOrder.ts — a aritmética do Flex isolada do runtime das edge functions
 * (Fase 222, plano 222-04, FLEX-01/02/03).
 *
 * Módulo PURO, no mesmo molde de `orderTaxRate.ts`: nenhum import remoto nem
 * referência ao runtime das edge functions, zero IO — importável tanto pela
 * função de sincronização quanto pelo vitest (node) e pelo frontend Vite.
 *
 * POR QUE FRETE, BÔNUS E CUSTO DE ENTREGA SÃO TRÊS CAMPOS SEPARADOS, E NÃO
 * UM NÚMERO LÍQUIDO: somar o bônus dentro de `frete` faria a coluna de
 * frete deixar de significar frete — e as telas de caixa e de tarifas leem
 * essa coluna hoje, sem saber que parte dela seria, na verdade, receita de
 * bonificação. Mantendo os três separados (D-05, 222-CONTEXT.md), cada tela
 * decide o que somar sem herdar uma decisão de composição que não é dela.
 *
 * O que este módulo NÃO resolve: o frete de hoje é replicado por linha de
 * item (uma linha por item, valor do envio inteiro copiado em cada uma) —
 * é dívida conhecida, anterior a esta fase, e os campos novos (`bonusEnvio`,
 * `custoEntrega`) deliberadamente não a herdam: por isso existe
 * `ratearPorReceita`, que divide a grandeza do ENVIO entre as linhas de
 * ITEM proporcionalmente à receita, fechando ao centavo.
 */

// ── Tipo logístico ──────────────────────────────────────────────────────────

/**
 * Lê o tipo logístico do envio NA RAIZ do objeto (contrato medido em
 * 222-ML-API.md: `GET /shipments/{id}` → `logistic_type`, zero requisição
 * nova). Normaliza para caixa baixa e apara espaço. `null` quando o objeto é
 * `null`/`undefined`, quando o campo está ausente, ou quando vem vazio.
 *
 * NÃO usar o cabeçalho `x-format-new`: com ele o campo volta `null` na
 * própria API (item 5 do Veredito, 222-ML-API.md) — a armadilha vive na
 * chamada, não neste extrator.
 */
export function extrairLogisticType(
  envio: { logistic_type?: unknown } | null | undefined,
): string | null {
  if (envio == null) return null;
  const raw = envio.logistic_type;
  if (raw == null) return null;
  const normalizado = String(raw).trim().toLowerCase();
  return normalizado === "" ? null : normalizado;
}

/**
 * Verdadeiro só para Mercado Envios Flex (`self_service`). Todo o resto —
 * inclusive `xd_drop_off`, que tem frete subsidiado pelo ML e `gross_amount`
 * não-zero — é falso. Esta guarda é CORREÇÃO, não otimização de rate limit:
 * `frete IS NULL` no banco não é sinônimo de Flex (222-ML-API.md, achado do
 * item "🔴 frete IS NULL no nosso banco NÃO é sinônimo de Flex"). Ler o
 * bônus de um envio que não é `self_service` inventaria receita que o
 * vendedor nunca recebeu.
 */
export function ehFlex(logisticType: string | null | undefined): boolean {
  return logisticType === "self_service";
}

// ── Bônus de envio ───────────────────────────────────────────────────────────

/**
 * Lê o bônus de envio do valor BRUTO de `GET /shipments/{id}/costs` →
 * `gross_amount` (contrato medido em 222-ML-API.md). Devolve `null` — nunca
 * `0` — quando o recurso não veio, quando o campo não existe, ou quando o
 * valor não é número finito. Com o valor `0` presente, devolve `0`: zero
 * capturado é diferente de não capturado (D-05).
 *
 * NÃO lê o campo de "compensacao do remetente" dentro de `senders[]`: ele
 * existe na resposta real, mas foi medido `0` em 100% dos envios
 * amostrados, inclusive entregues há um mês (item 3 do Veredito,
 * 222-ML-API.md) — é assumption refutada, não fonte do bônus.
 */
export function extrairBonusEnvio(
  custos: { gross_amount?: unknown } | null | undefined,
): number | null {
  if (custos == null) return null;
  const raw = custos.gross_amount;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// ── Rateio por receita ───────────────────────────────────────────────────────

const arredondaCentavos = (v: number): number => Math.round(v * 100) / 100;

/**
 * Divide um valor do ENVIO (bônus ou custo de entrega) entre as linhas de
 * ITEM de um pedido, em proporção à receita bruta de cada linha, fechando
 * ao centavo por maior resto — nenhum centavo criado nem perdido.
 *
 * - `valorDoEnvio` null devolve null em todas as posições (ausência não
 *   pode virar zero pelo caminho do rateio).
 * - Pedido de um item devolve o valor inteiro, sem passar pelo rateio.
 * - Receita total zero (todas as linhas com receita 0) divide igualmente
 *   entre as linhas, para o rateio não indeterminar (divisão por zero).
 */
export function ratearPorReceita(
  valorDoEnvio: number | null,
  receitasPorItem: number[],
): Array<number | null> {
  const n = receitasPorItem.length;
  if (n === 0) return [];
  if (valorDoEnvio == null) return receitasPorItem.map(() => null);
  if (n === 1) return [arredondaCentavos(valorDoEnvio)];

  const totalReceita = receitasPorItem.reduce((soma, r) => soma + r, 0);
  const pesos =
    totalReceita === 0
      ? receitasPorItem.map(() => 1 / n)
      : receitasPorItem.map((r) => r / totalReceita);

  // Trabalha em centavos inteiros: fechamento exato via maior resto.
  const valorCentavos = Math.round(valorDoEnvio * 100);
  const brutos = pesos.map((p) => valorCentavos * p);
  const bases = brutos.map((b) => Math.floor(b));
  let restante = valorCentavos - bases.reduce((soma, v) => soma + v, 0);

  const ordemPorResto = brutos
    .map((b, i) => ({ i, resto: b - Math.floor(b) }))
    .sort((a, b) => b.resto - a.resto);

  const resultadoCentavos = [...bases];
  for (let k = 0; k < ordemPorResto.length && restante > 0; k++) {
    resultadoCentavos[ordemPorResto[k].i] += 1;
    restante--;
  }

  return resultadoCentavos.map((c) => c / 100);
}

// ── Receita líquida ───────────────────────────────────────────────────────────

export interface ReceitaLiquidaInput {
  receitaBruta: number | null;
  comissao: number | null;
  frete: number | null;
  bonusEnvio: number | null;
  custoEntrega: number | null;
  taxAmount: number | null;
  /** Guarda da Fase 220: destino desconhecido não pode inflar a receita. */
  impostoDesconhecido: boolean;
}

export interface ReceitaLiquidaResultado {
  receitaLiquida: number | null;
  /**
   * Verdadeiro quando o pedido tem bônus de envio (é Flex) mas o custo de
   * entrega própria ainda não foi informado pela loja — a margem exibida
   * está declaradamente inflada por esse valor ausente. Par valor+motivo,
   * mesmo desenho que a Fase 220 adotou para `motivo` em `AliquotaPedido`:
   * nomear na saída por que o número pode estar errado, em vez de inventar
   * um número bonito e silenciosamente incompleto.
   */
  custoEntregaAusente: boolean;
}

/**
 * Receita líquida do pedido, com os componentes do Flex somados na ordem
 * certa (D-05, sem atalho): o bônus SOMA como receita própria, o custo de
 * entrega SUBTRAI como custo próprio, e o frete continua subtraindo pelo
 * seu valor (que para Flex é zero — a correção do FLEX-02, não desta
 * função). Em nenhum ponto o bônus é escrito como frete de sinal invertido.
 *
 * Pedido comum (bônus e custo de entrega `null`): o resultado é idêntico,
 * ao centavo, à fórmula de hoje — `null` não vira zero por acidente na
 * soma, mas a AUSÊNCIA de bônus/custo de entrega contribui zero ao total,
 * exatamente como a fórmula de hoje nunca os conheceu.
 *
 * `impostoDesconhecido` verdadeiro devolve `receitaLiquida: null` — a
 * guarda da Fase 220, preservada palavra por palavra: com o imposto `null`,
 * a receita líquida sairia inflada pelo valor inteiro do imposto.
 */
export function computeReceitaLiquida(
  input: ReceitaLiquidaInput,
): ReceitaLiquidaResultado {
  const {
    receitaBruta,
    comissao,
    frete,
    bonusEnvio,
    custoEntrega,
    taxAmount,
    impostoDesconhecido,
  } = input;

  // Só é "custo de entrega ausente" quando o pedido TEM bônus (é Flex) e o
  // custo ainda não foi informado. Pedido comum, sem bônus, não tem custo
  // de entrega a informar — a pergunta não se aplica a ele.
  const custoEntregaAusente = bonusEnvio != null && custoEntrega == null;

  if (receitaBruta == null || impostoDesconhecido) {
    return { receitaLiquida: null, custoEntregaAusente };
  }

  const receitaLiquida =
    receitaBruta
    - (comissao ?? 0)
    - (frete ?? 0)
    + (bonusEnvio ?? 0)
    - (custoEntrega ?? 0)
    - (taxAmount ?? 0);

  return { receitaLiquida, custoEntregaAusente };
}
