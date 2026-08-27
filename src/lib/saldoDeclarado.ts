// ============================================================================
// 233-05 — Declarar o saldo é MOVER A ÂNCORA
//
// 🔴 O DEFEITO, medido no BANCO VIVO em 27/08/2026 (não no repositório): o botão
// "corrigir saldo" gravava `financial_settings.initial_balance` por caminho
// direto, e esse caminho **não toca em `balance_anchor_date`**. O número que a
// tela de fluxo de caixa exibe não é o campo cru — é o campo cru na data da
// ÂNCORA, rolado por tudo que entrou e tudo que saiu pago desde então:
//
//   get_rolled_opening_balance = initial_balance    (na âncora)
//                              + entradas           [âncora, hoje)
//                              − saídas pagas       [âncora, hoje)
//
// Na Pé Vermeio a âncora estava em **2026-07-13**, 45 dias atrás:
//
//   initial_balance (o que ele digitou) ....  R$ 37.430,00
//   + entradas âncora→ontem ................  R$ 341.243,31
//   − saídas pagas âncora→ontem ............  R$ 349.371,89
//   = o que a tela exibia ..................  R$  29.301,42
//
// Ele digitou 37.430 e leu 29.301,42. Declarou, sem saber, um saldo de 13 de
// julho.
//
// 🔵 A CORREÇÃO NÃO É INVERTER CONTA NENHUMA. Com `balance_anchor_date = hoje` o
// intervalo semiaberto `[hoje, hoje)` é VAZIO, as duas somas são zero e a função
// devolve o declarado ao centavo. É literalmente para isso que
// `balance_anchor_date` existe, e a RPC que faz isso — `set_financial_balance` —
// já estava em produção, INVOKER, com `EXECUTE` para `authenticated`, e **nunca
// tinha sido chamada** por nenhuma linha do garment.
//
// 🔴 O QUE O 233-03 ERROU, e por que nenhum teste pegou: ele inverteu a conta
// contra `entradas_hoje`/`saidas_hoje`. A identidade matemática estava certa; a
// QUANTIDADE estava errada — o rolado desconta 45 dias de movimento, não o do
// dia. 59 testes verdes provaram uma identidade correta sobre a variável errada,
// e o defeito só apareceu porque o Wesley leu o número na tela.
//
// ⚠️ A AMBIGUIDADE QUE SOBRA É DE DESENHO, e está NOMEADA em vez de resolvida
// (D-07, decisão do Wesley em 27/08): o que ele declara vira a **abertura** do
// dia de hoje. Declarar às 14h olhando o extrato conta parte do movimento do dia
// duas vezes na previsão de fechamento. O erro dura um dia e a declaração
// seguinte o corrige; o caminho sem ambiguidade é declarar de manhã.
//
// Molde: `confiancaDoSaldo.ts` — módulo puro, nunca lança, ausência é `null`.
// ============================================================================

/**
 * Arredonda a duas casas UMA vez, na saída.
 *
 * ⚠️ `Math.round(v * 100) / 100` erra em binários como 1,005 (que vira 1,00).
 * O `+1e-9` sobre o valor absoluto corrige o caso de meio centavo sem introduzir
 * viés de sinal — arredonda o negativo para longe do zero, como o positivo.
 */
function duasCasas(v: number): number {
  const s = v < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(v) * 100 + 1e-9)) / 100;
}

/**
 * 🔴 Converte para número finito ou `null`. NUNCA devolve `NaN`.
 *
 * `NaN` gravado no saldo faz o número sumir da tela **sem erro nenhum** — um
 * estado pior que o defeito, porque é mudo. Devolver `null` força o chamador a
 * decidir (e o chamador, aqui, bloqueia o salvamento).
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
 * A decomposição honesta do que a tela mostra no dia: **abertura + entradas −
 * saídas**.
 *
 * 🔴 O PRIMEIRO ARGUMENTO MUDOU DE SIGNIFICADO na migration
 * `20260827190000_saldo_ancorado_no_dia_declarado.sql`. Antes dela,
 * `get_daily_balance.saldo_inicial` devolvia o `initial_balance` CRU — o saldo
 * da âncora, que na Pé Vermeio era o de 13/07. Depois dela, devolve a **abertura
 * ROLADA**, o mesmo número pelo qual o gráfico de fluxo de caixa abre. A conta
 * aqui é a mesma; o que ela recebe é que passou a ser o número certo.
 */
export function saldoExibido(
  aberturaDoDia: unknown,
  entradasDoDia: unknown,
  saidasDoDia: unknown,
): number | null {
  const ab = numeroOuNulo(aberturaDoDia);
  const e = numeroOuNulo(entradasDoDia);
  const s = numeroOuNulo(saidasDoDia);
  if (ab == null || e == null || s == null) return null;
  return duasCasas(ab + e - s);
}

// ---------------------------------------------------------------------------
// O portão do salvamento e a declaração que vai para o banco
// ---------------------------------------------------------------------------

/** Os movimentos do dia, como a tela os conhece no instante da declaração. */
export interface MovimentosDoDia {
  /** A ABERTURA de hoje — rolada — como a tela a exibia ANTES da correção. */
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
 * 🔴 O BLOQUEIO CONTINUA OBRIGATÓRIO, mas o motivo dele MUDOU.
 *
 * No 233-03 ele existia porque a inversa dependia dos movimentos: entradas e
 * saídas ainda carregando (lidas como zero) gravariam o valor digitado como
 * `initial_balance` cru — o defeito disfarçado de conserto.
 *
 * Depois do 233-05 a âncora não depende de movimento nenhum. O que ainda depende
 * é o **retrato do erro do dia zero**: sem entradas e saídas não há
 * `saldo_exibido` para registrar, e a linha de `saldo_declarado` nasceria sem o
 * que ela existe para medir.
 *
 * Zero legítimo (dia sem movimento) passa; ausência não passa.
 */
export function podeDeclarar(mov: MovimentosDoDia | null | undefined, carregando = false): Veredito {
  if (carregando) {
    return { pode: false, motivo: "Os movimentos de hoje ainda estão carregando." };
  }
  if (mov == null) {
    return {
      pode: false,
      motivo:
        "As entradas e saídas de hoje não foram carregadas — sem elas a declaração fica sem o retrato do erro.",
    };
  }
  const e = numeroOuNulo(mov.entradas);
  const s = numeroOuNulo(mov.saidas);
  if (e == null || s == null) {
    return {
      pode: false,
      motivo:
        "As entradas e saídas de hoje não foram carregadas — sem elas a declaração fica sem o retrato do erro.",
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
  /** A ABERTURA que vigorava antes da correção, pelo mesmo motivo. */
  initial_balance: number | null;
  entradas_do_dia: number;
  saidas_do_dia: number;
}

/**
 * Monta o par (o valor que vai para a âncora, o que declarar em
 * `saldo_declarado`) a partir do saldo que o humano digitou.
 *
 * 🔵 `saldoParaAncora` é o valor digitado, arredondado a duas casas e **nada
 * mais**. Não há conta contra os movimentos do dia, e é essa insensibilidade que
 * separa este módulo do 233-03: redigitar o mesmo número com entradas e saídas
 * diferentes produz exatamente o mesmo valor de âncora.
 *
 * 🔴 `saldo_exibido` e `initial_balance` guardam o estado ANTES da correção, e
 * não o depois. É essa diferença — exibido menos declarado — que mede o erro do
 * dia zero. Gravar o depois deixaria erro zero em todas as linhas, e a série
 * inteira mediria nada.
 *
 * ⚠️ Na REDECLARAÇÃO do mesmo dia o retrato preservado é o da PRIMEIRA — quem
 * cuida disso é o chamador, que atualiza só o `saldo_real` quando já existe
 * linha para a data (comportamento do 233-03, mantido sem mexer).
 *
 * Devolve `null` quando qualquer parcela está suja: o chamador não grava.
 */
export function montarDeclaracao(
  orgId: string | null | undefined,
  dataDeclarada: string | null | undefined,
  saldoDigitado: unknown,
  mov: MovimentosDoDia | null | undefined,
): { saldoParaAncora: number; declaracao: Declaracao } | null {
  if (!orgId || !dataDeclarada) return null;
  if (!podeDeclarar(mov).pode) return null;

  const entradas = numeroOuNulo(mov!.entradas) as number;
  const saidas = numeroOuNulo(mov!.saidas) as number;
  const digitado = numeroOuNulo(saldoDigitado);
  if (digitado == null) return null;

  // 🔵 Declarar é ancorar: o valor atravessa intacto.
  const saldoParaAncora = duasCasas(digitado);

  const aberturaAnterior = numeroOuNulo(mov!.saldoInicial);

  return {
    saldoParaAncora,
    declaracao: {
      organization_id: orgId,
      data_declarada: dataDeclarada,
      saldo_real: saldoParaAncora,
      saldo_exibido:
        aberturaAnterior == null ? null : saldoExibido(aberturaAnterior, entradas, saidas),
      initial_balance: aberturaAnterior == null ? null : duasCasas(aberturaAnterior),
      entradas_do_dia: duasCasas(entradas),
      saidas_do_dia: duasCasas(saidas),
    },
  };
}
