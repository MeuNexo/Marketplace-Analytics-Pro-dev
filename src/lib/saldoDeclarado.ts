// ============================================================================
// 233-03 — O saldo DECLARADO e a conta inversa
//
// 🔴 O DEFEITO, medido em 27/08/2026: o botão diz "corrigir saldo" mas grava
// `financial_settings.initial_balance`, que é o saldo ANTES dos movimentos do
// dia. A conta do banco (`20260660000200_cashflow_saldo_indicators_forecasts.sql`,
// linhas 44-49) é:
//
//   saldo_de_hoje = initial_balance
//                 + entradas com release_date = HOJE
//                 − saídas  com outflow_date  = HOJE
//
// Então:
//
//   initial_balance (digitado) ...  R$ 46.000,00
//   + entradas de hoje ..........   R$ 14.790,16
//   − saídas de hoje ............   R$  9.485,54
//   = saldo exibido .............   R$ 51.304,62
//   saldo REAL (Wesley) .........   R$ 37.430,00
//
// O Wesley digita o valor que quer ver, os movimentos entram por cima e movem o
// alvo. Palavras dele: *"coloco o valor correto de hoje, ele não considera o
// valor que eu coloquei lá, não sei que conta ele faz... tenho que ficar
// inserindo valores e atualizando até o saldo do dia chegar no real que temos"*.
//
// 🔵 A CORREÇÃO É A CONTA INVERSA, e ela NÃO TOCA NO `get_cashflow`. A conta do
// banco está certa; o que está errado é a tela pedir a PARCELA e chamá-la de
// TOTAL. O usuário informa o saldo que QUER VER, e a tela grava:
//
//   initial_balance = saldo_desejado − entradas_de_hoje + saídas_de_hoje
//
// Uma passada, sem tentativa e erro.
//
// 🔴 ESTE MÓDULO NÃO EXPLICA A DIFERENÇA DE R$ 13.874,62 entre o exibido e o
// real. Ele conserta a USABILIDADE. Por que o sistema chegou a R$ 51.304,62
// quando o real era R$ 37.430 tem causa própria — entrada contabilizada que não
// caiu, saída não lançada, `release_date` remanejado pelo MP — e investigar isso
// é fase própria (`<deferred>` do 233-03-PLAN).
//
// Molde: `confiancaDoSaldo.ts` — módulo puro, nunca lança, ausência é `null`.
// ============================================================================

/**
 * Arredonda a duas casas UMA vez, na saída.
 *
 * ⚠️ `Math.round(v * 100) / 100` erra em binários como 1,005 (que vira 1,00).
 * O `+1e-9` sobre o valor absoluto corrige o caso de meio centavo sem introduzir
 * viés de sinal — arredondar o negativo para longe do zero, como o positivo.
 */
function duasCasas(v: number): number {
  const s = v < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(v) * 100 + 1e-9)) / 100;
}

/**
 * 🔴 Converte para número finito ou `null`. NUNCA devolve `NaN`.
 *
 * `NaN` gravado no `initial_balance` faz o saldo sumir da tela **sem erro
 * nenhum** — um estado pior que o defeito atual, porque é mudo. Devolver `null`
 * força o chamador a decidir (e o chamador, aqui, bloqueia o salvamento).
 *
 * Aceita a vírgula decimal porque é como um campo brasileiro devolve o valor.
 */
export function numeroOuNulo(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const limpo = v.trim();
    if (limpo === "") return null;
    // Só a vírgula vira ponto. Não removemos separador de milhar: "1.234,56" e
    // "1234.56" são ambíguos, e adivinhar aqui gera erro silencioso de 100×.
    const n = Number(limpo.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A conta DIRETA — a mesma que o `get_cashflow` faz no banco.
 *
 * Existe aqui para a tela poder mostrar a decomposição e para o teste de ida e
 * volta provar a identidade contra a inversa.
 */
export function saldoExibido(
  initialBalance: unknown,
  entradasDoDia: unknown,
  saidasDoDia: unknown,
): number | null {
  const ib = numeroOuNulo(initialBalance);
  const e = numeroOuNulo(entradasDoDia);
  const s = numeroOuNulo(saidasDoDia);
  if (ib == null || e == null || s == null) return null;
  return duasCasas(ib + e - s);
}

/**
 * 🔵 A INVERSA: dado o saldo que o humano QUER VER hoje, devolve o
 * `initial_balance` a gravar para que a tela exiba exatamente esse número.
 *
 *   initial_balance = desejado − entradas + saídas
 *
 * Ida e volta é identidade:
 * `saldoExibido(initialBalanceParaSaldo(X, e, s), e, s) === X`.
 *
 * ⚠️ Devolve `null` para qualquer entrada suja. O chamador NÃO pode tratar
 * `null` como zero: entradas/saídas ainda carregando valem zero na aritmética e
 * fariam `initial_balance = desejado` — que é exatamente o defeito de hoje,
 * agora silencioso e com cara de conserto.
 */
export function initialBalanceParaSaldo(
  saldoDesejado: unknown,
  entradasDoDia: unknown,
  saidasDoDia: unknown,
): number | null {
  const d = numeroOuNulo(saldoDesejado);
  const e = numeroOuNulo(entradasDoDia);
  const s = numeroOuNulo(saidasDoDia);
  if (d == null || e == null || s == null) return null;
  // Arredondamento UMA vez, na saída — arredondar as parcelas antes de somar
  // perde centavos que a soma teria conservado.
  return duasCasas(d - e + s);
}

// ---------------------------------------------------------------------------
// O portão do salvamento e a declaração que vai para o banco
// ---------------------------------------------------------------------------

/** Os movimentos do dia, como a tela os conhece no instante da declaração. */
export interface MovimentosDoDia {
  /** `financial_settings.initial_balance` ANTES da correção. */
  saldoInicial: unknown;
  entradas: unknown;
  saidas: unknown;
}

export interface Veredito {
  pode: boolean;
  /** O motivo, em português, quando `pode` é falso. `null` quando pode. */
  motivo: string | null;
}

/**
 * 🔴 O BLOQUEIO É OBRIGATÓRIO, e não é zelo.
 *
 * Se entradas e saídas vierem como zero por ainda estarem carregando, a inversa
 * grava `initial_balance = desejado` — que é EXATAMENTE o defeito de hoje, agora
 * silencioso e com cara de conserto. Zero legítimo (dia sem movimento) passa;
 * ausência não passa.
 */
export function podeDeclarar(mov: MovimentosDoDia | null | undefined, carregando = false): Veredito {
  if (carregando) {
    return { pode: false, motivo: "Os movimentos de hoje ainda estão carregando." };
  }
  if (mov == null) {
    return {
      pode: false,
      motivo: "As entradas e saídas de hoje não foram carregadas — sem elas o valor gravado ficaria errado.",
    };
  }
  const e = numeroOuNulo(mov.entradas);
  const s = numeroOuNulo(mov.saidas);
  if (e == null || s == null) {
    return {
      pode: false,
      motivo: "As entradas e saídas de hoje não foram carregadas — sem elas o valor gravado ficaria errado.",
    };
  }
  return { pode: true, motivo: null };
}

export interface Declaracao {
  organization_id: string;
  data_declarada: string;
  saldo_real: number;
  /** O que a tela EXIBIA antes da correção — é ele que mede o erro do dia zero. */
  saldo_exibido: number | null;
  /** O `initial_balance` que VIGORAVA antes da correção, pelo mesmo motivo. */
  initial_balance: number | null;
  entradas_do_dia: number;
  saidas_do_dia: number;
}

/**
 * Monta o par (o que gravar em `financial_settings`, o que declarar em
 * `saldo_declarado`) a partir do saldo que o humano quer ver.
 *
 * 🔴 `saldo_exibido` e `initial_balance` guardam o estado ANTES da correção, e
 * não o depois. É essa diferença — exibido menos declarado — que mede o erro do
 * dia zero (R$ 13.874,62 em 27/08). Gravar o depois deixaria erro zero em todas
 * as linhas, e a série inteira mediria nada.
 *
 * Devolve `null` quando qualquer parcela está suja: o chamador não grava.
 */
export function montarDeclaracao(
  orgId: string | null | undefined,
  dataDeclarada: string | null | undefined,
  saldoDesejado: unknown,
  mov: MovimentosDoDia | null | undefined,
): { initialBalanceAGravar: number; declaracao: Declaracao } | null {
  if (!orgId || !dataDeclarada) return null;
  if (!podeDeclarar(mov).pode) return null;

  const entradas = numeroOuNulo(mov!.entradas) as number;
  const saidas = numeroOuNulo(mov!.saidas) as number;
  const desejado = numeroOuNulo(saldoDesejado);
  if (desejado == null) return null;

  const novoIb = initialBalanceParaSaldo(desejado, entradas, saidas);
  if (novoIb == null) return null;

  const ibAnterior = numeroOuNulo(mov!.saldoInicial);

  return {
    initialBalanceAGravar: novoIb,
    declaracao: {
      organization_id: orgId,
      data_declarada: dataDeclarada,
      saldo_real: duasCasas(desejado),
      saldo_exibido: ibAnterior == null ? null : saldoExibido(ibAnterior, entradas, saidas),
      initial_balance: ibAnterior == null ? null : duasCasas(ibAnterior),
      entradas_do_dia: duasCasas(entradas),
      saidas_do_dia: duasCasas(saidas),
    },
  };
}
