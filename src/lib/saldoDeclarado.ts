// ============================================================================
// 233-06 — Declarar é ancorar A ABERTURA DECOMPOSTA
//
// 🔴 O QUE MUDOU EM RELAÇÃO AO CABEÇALHO ANTERIOR, e é a coisa inteira: o
// 233-05 escrevia aqui que "declarar é ancorar, o valor atravessa intacto".
// **Isso deixou de ser verdade**, e um comentário que ensina a teoria errada é
// pior que nenhum.
//
// O **D-07** (o valor digitado é a ABERTURA do dia) durou algumas horas. O
// Wesley o derrubou no mesmo 27/08/2026: *"hoje o saldo já considerando a
// liberação já é o que passei, 37430"* — **D-10**. Ele declara olhando o
// EXTRATO, a qualquer hora, então o número que ele dá já inclui tudo que
// liquidou até ali.
//
// 🔴 O ESTRAGO DO D-07, medido: gravado como abertura, o sistema somou o dia por
// cima e contou **R$ 13.157,27 duas vezes** — fechamento previsto R$ 42.457,04
// contra os R$ 38.785,31 corretos.
//
// 🔵 AS TRÊS IDENTIDADES, e elas fecham em produção (27/08, Pé Vermeio):
//
//   abertura    = declarado − entradas_liquidadas + saidas_pagas
//               = 37.430,00 − 13.157,27 + 9.485,54 = 33.758,27
//   saldo_agora = abertura  + entradas_liquidadas − saidas_pagas = 37.430,00
//   fechamento  = abertura  + entradas_do_dia     − saidas_do_dia = 38.785,31
//
// O que sobra — R$ 1.355,31 — é exatamente o `in_mediation`, o que ainda pode
// entrar hoje. Fecha dos dois lados.
//
// 🔴 O QUE ATRAVESSA INTACTO agora é o `saldo_real` da DECLARAÇÃO (o saldo de
// agora, o do extrato), **não** o valor da âncora. `montarDeclaracao` devolve os
// dois, e eles são números diferentes de propósito — trocá-los é o defeito do
// D-07 de volta.
//
// 🔴 A INVERSA DO 233-03 ESTAVA CERTA NA FORMA E ERRADA NA QUANTIDADE. Ela usava
// `entradas_hoje`/`saidas_hoje` INTEIRAS; o certo é só a parte **já liquidada**
// (`approved` + `refunded` nas entradas, `paid` nas saídas). O 233-05 removeu a
// inversa; o 233-06 a traz de volta contra a quantidade certa, com nome próprio
// (`aberturaAncorada`) e um portão que reprova a errada
// (`../pages/mercadolivre/__tests__/saldoAncorado.test.ts`).
//
// 🔴 A CLASSIFICAÇÃO POR ESTADO NÃO MORA AQUI. Ela é do BANCO
// (`get_movimentos_por_liquidacao`), e este módulo apenas CONSOME as parcelas
// prontas. Duas implementações da mesma regra divergem, e a divergência aparece
// como número errado na tela, não como erro.
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
// 🔴 A INVERSA, de volta — contra o LIQUIDADO e só ele
// ---------------------------------------------------------------------------

/**
 * A abertura do dia, decomposta a partir do saldo que o humano leu no extrato.
 *
 *     abertura = declarado − entradasLiquidadas + saidasPagas
 *
 * 🔴 A QUANTIDADE É O PONTO INTEIRO. O 233-03 fez esta mesma conta contra
 * `entradas_hoje`/`saidas_hoje` — os TOTAIS do dia — e a correção não funcionou:
 * o que está em mediação **ainda não entrou no extrato** que o Wesley leu, então
 * descontá-lo tira dinheiro que nunca esteve lá. 59 testes verdes provaram a
 * identidade certa sobre a variável errada, e o defeito só apareceu quando ele
 * leu o número na tela.
 *
 * 🔵 As três propriedades que o teste mede, e que a implementação tem de ter:
 *   (i)   mexer em `entradasPendentes` NÃO move o resultado;
 *   (ii)  mexer em `saidasCanceladas` NÃO move o resultado;
 *   (iii) somar Δ a `entradasLiquidadas` move o resultado em exatamente −Δ.
 *
 * Devolve `null` — nunca `NaN` — quando qualquer parcela está suja.
 */
export function aberturaAncorada(
  saldoDeAgora: unknown,
  mov: MovimentosDoDia | null | undefined,
): number | null {
  if (mov == null) return null;
  const declarado = numeroOuNulo(saldoDeAgora);
  const liquidadas = numeroOuNulo(mov.entradasLiquidadas);
  const pagas = numeroOuNulo(mov.saidasPagas);
  if (declarado == null || liquidadas == null || pagas == null) return null;
  return duasCasas(declarado - liquidadas + pagas);
}

// ---------------------------------------------------------------------------
// O portão do salvamento e a declaração que vai para o banco
// ---------------------------------------------------------------------------

/**
 * Os movimentos do dia, como a tela os conhece no instante da declaração.
 *
 * 🔴 TODOS os campos vêm de `get_daily_balance` — nenhum é derivado no front. A
 * classificação por estado (`approved`/`refunded`/`in_mediation`/`paid`/
 * `pending`/`cancelled`) existe em UM lugar só, e ele é o banco.
 */
export interface MovimentosDoDia {
  /** A ABERTURA de hoje — rolada — como a tela a exibia ANTES da correção. */
  saldoInicial: unknown;
  /** O TOTAL de entradas do dia. Inclui o que ainda pode entrar. */
  entradas: unknown;
  /** O TOTAL de saídas previstas do dia. Já **sem** as canceladas (D-12). */
  saidas: unknown;
  /** 🔵 O que JÁ LIQUIDOU nas entradas: `approved` + `refunded`. */
  entradasLiquidadas: unknown;
  /** 🔵 O que JÁ SAIU do caixa: `paid`. */
  saidasPagas: unknown;
  /** O que ainda pode entrar hoje e ainda não entrou (`in_mediation`). */
  entradasPendentes: unknown;
  /** O que foi cancelado e **não vai sair nunca** (D-12). */
  saidasCanceladas: unknown;
  /** 🔴 O saldo de agora, **vindo do banco**. Nunca composto aqui. */
  saldoAgora: unknown;
}

export interface Veredito {
  pode: boolean;
  /** O motivo, em português, quando `pode` é falso. `null` quando pode. */
  motivo: string | null;
}

/**
 * 🔴 O BLOQUEIO CONTINUA OBRIGATÓRIO, e o motivo dele MUDOU DE NOVO.
 *
 * No 233-03 ele existia porque a inversa (contra o total do dia) dependia dos
 * movimentos. No 233-05 a âncora deixou de depender de movimento nenhum e o
 * motivo passou a ser o **retrato do erro do dia zero**.
 *
 * 🔴 No 233-06 ele volta a ser existencial, e por uma razão pior: sem as
 * parcelas LIQUIDADAS não há decomposição, e o declarado seria gravado como
 * abertura — que é exatamente o defeito do D-07, agora silencioso. Lidas como
 * zero, elas fariam `abertura = declarado`, o sistema somaria o dia por cima e
 * contaria o liquidado duas vezes.
 *
 * Zero legítimo (dia sem movimento liquidado) passa; ausência não passa.
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
  const liq = numeroOuNulo(mov.entradasLiquidadas);
  const pg = numeroOuNulo(mov.saidasPagas);
  if (liq == null || pg == null) {
    return {
      pode: false,
      motivo:
        "Ainda não dá para saber o que já caiu na conta hoje — sem isso o valor digitado " +
        "seria gravado como o saldo de abertura e o dia seria contado duas vezes.",
    };
  }
  return { pode: true, motivo: null };
}

export interface Declaracao {
  organization_id: string;
  data_declarada: string;
  /**
   * 🔴 O SALDO DE AGORA — o valor DIGITADO, o que ele leu no extrato (D-10).
   * **Não** é a abertura: essa está em `abertura_ancorada`.
   */
  saldo_real: number;
  /** O que a tela EXIBIA antes da correção — é ele que mede o erro do dia zero. */
  saldo_exibido: number | null;
  /** A ABERTURA que vigorava antes da correção, pelo mesmo motivo. */
  initial_balance: number | null;
  entradas_do_dia: number;
  saidas_do_dia: number;
  /**
   * 🔵 O RETRATO DA LIQUIDAÇÃO — as quatro colunas do 233-06.
   *
   * Elas existem para que a escolha do comparador da curva de confiança possa
   * ser feita DEPOIS sem perder dado. `get_confianca_do_saldo` hoje confronta
   * `saldo_real` (que, a partir do D-10, é o saldo de MEIO DE DIA) contra o
   * congelado, que é FECHAMENTO — em 27/08 a diferença entre os dois
   * comparadores foi R$ 1.355,31 no D+0. Com as parcelas gravadas, trocar o
   * comparador vira uma DECISÃO, não uma escavação.
   */
  abertura_ancorada: number;
  entradas_liquidadas: number;
  saidas_pagas: number;
  entradas_pendentes: number | null;
}

/**
 * Monta o par (o valor que vai para a ÂNCORA, o que declarar em
 * `saldo_declarado`) a partir do saldo de agora que o humano digitou.
 *
 * 🔴 OS DOIS SÃO NÚMEROS DIFERENTES DE PROPÓSITO, e trocá-los é o defeito do
 * D-07 de volta:
 *
 *   `saldoParaAncora`      = a ABERTURA decomposta (vai para `set_financial_balance`)
 *   `declaracao.saldo_real` = o valor DIGITADO, o saldo de agora (vai para a série)
 *
 * 🔵 A insensibilidade que separa isto do 233-03 continua existindo, só que
 * agora ela é ao NÃO-liquidado: redigitar o mesmo número com os TOTAIS do dia
 * diferentes produz exatamente a mesma âncora, porque só as parcelas liquidadas
 * entram na conta.
 *
 * 🔴 `saldo_exibido` e `initial_balance` guardam o estado ANTES da correção, e
 * não o depois. É essa diferença — exibido menos declarado — que mede o erro do
 * dia zero. Gravar o depois deixaria erro zero em todas as linhas, e a série
 * inteira mediria nada.
 *
 * ⚠️ Na REDECLARAÇÃO do mesmo dia o retrato preservado é o da PRIMEIRA — quem
 * cuida disso é o chamador, que atualiza só o `saldo_real` e as parcelas de
 * liquidação quando já existe linha para a data.
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

  // 🔴 Declarar é ancorar A ABERTURA DECOMPOSTA. O valor digitado é o saldo de
  // AGORA; a âncora recebe o que ele era ANTES do movimento já liquidado de hoje.
  const saldoParaAncora = aberturaAncorada(digitado, mov);
  if (saldoParaAncora == null) return null;

  const aberturaAnterior = numeroOuNulo(mov!.saldoInicial);
  const pendentes = numeroOuNulo(mov!.entradasPendentes);

  return {
    saldoParaAncora,
    declaracao: {
      organization_id: orgId,
      data_declarada: dataDeclarada,
      saldo_real: duasCasas(digitado),
      saldo_exibido:
        aberturaAnterior == null ? null : saldoExibido(aberturaAnterior, entradas, saidas),
      initial_balance: aberturaAnterior == null ? null : duasCasas(aberturaAnterior),
      entradas_do_dia: duasCasas(entradas),
      saidas_do_dia: duasCasas(saidas),
      abertura_ancorada: saldoParaAncora,
      entradas_liquidadas: duasCasas(numeroOuNulo(mov!.entradasLiquidadas) as number),
      saidas_pagas: duasCasas(numeroOuNulo(mov!.saidasPagas) as number),
      entradas_pendentes: pendentes == null ? null : duasCasas(pendentes),
    },
  };
}
