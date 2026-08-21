// ============================================================================
// forecastErrorCurve — Fase 224 Plano 03, Task 2 (ERR-01)
// Função pura que monta a curva de erro da previsão de caixa por horizonte a
// partir das linhas cruas da RPC get_forecast_backtest_curve (migration
// 20260821150000_forecast_backtest_rpcs.sql): WAPE, fator de viés, ME diário,
// MAE, tracking signal, marcação de provisório, a medida do viés que estava
// sendo importado do futuro e o horizonte útil dada uma tolerância.
// Espelho estrutural de src/lib/dreCashForecast.ts (Fase 100).
//
// Guardrail crítico 1 — RAZÃO DE SOMAS, NUNCA MÉDIA DE RAZÕES. O fator de
// viés é `Σ previsto ÷ Σ realizado`. Numa série que faz R$ 50k num sábado e
// R$ 2.400 numa segunda, `avg(previsto/realizado)` é dominada pelos dias
// pequenos: um dia com realizado R$ 200 e previsto R$ 5.000 entra com 25,0 e
// apaga trinta dias normais. É a patologia do MAPE, e é por isso que a RPC
// devolve somas e n, e não indicadores prontos.
//
// Guardrail crítico 2 — NULO É NÃO MEDIDO, ZERO É MEDIDO E IGUAL A ZERO.
// Denominador zero ou soma ausente produz `null`, jamais `0` e jamais
// `Infinity`. Um horizonte sem observação não pode se apresentar como
// horizonte perfeito.
//
// Guardrail crítico 3 — O LIMIAR DE TOLERÂNCIA NÃO MORA AQUI (D-6 do
// 224-CONTEXT). `horizonteUtil` exige a tolerância como argumento
// obrigatório e o módulo não declara nenhum valor padrão para ela: o limiar
// da PV é decisão do Wesley depois de ver a curva, não se herda da Sandrini
// e não se grava em código.
//
// Sem React/Supabase/TanStack/date-fns — módulo 100% puro, testável sem rede.
// Toda a matemática aqui é soma, divisão e valor absoluto; se surgir a
// vontade de instalar uma biblioteca de estatística, é sinal de que o cálculo
// saiu do escopo.
// ============================================================================

/**
 * Linha crua de get_forecast_backtest_curve — 1 por
 * (escopo, corrigido, agregacao, horizon_days).
 *
 * `escopo` é "entradas" ou "saidas"; `agregacao` é "diario" ou "acumulado";
 * `corrigido` diz se o look-ahead do estorno foi des-aplicado (é NULL no
 * escopo de saídas, que não tem estorno a corrigir).
 */
export interface CurvaBacktestRow {
  escopo: string;
  corrigido: boolean | null;
  agregacao: string;
  horizon_days: number;
  n: number | null;
  soma_previsto: number | null;
  soma_realizado: number | null;
  soma_erro_abs: number | null;
  soma_erro_sinal: number | null;
}

/** Recorte de leitura: uma curva é sempre um escopo, uma agregação e um estado de correção. */
export interface FiltroCurva {
  escopo: string;
  agregacao: string;
  corrigido: boolean | null;
}

/** Um ponto da curva — um horizonte, com o n que o sustenta. */
export interface PontoDaCurva {
  /** D+h, em dias. */
  horizonte: number;
  /** Quantos pares (corte, alvo) sustentam este ponto. Zero significa horizonte não observado. */
  n: number;
  /** Σ|erro| ÷ |Σ realizado|. Null quando o realizado é zero ou ausente. */
  wape: number | null;
  /** Σ previsto ÷ Σ realizado — razão de somas. Null quando o realizado é zero ou ausente. */
  fator: number | null;
  /** Σ erro com sinal ÷ n, em reais por dia. Positivo = a agenda prometeu mais do que entrou. */
  meDiario: number | null;
  /** Σ|erro| ÷ n, em reais. */
  mae: number | null;
  /** n × Σ erro com sinal ÷ Σ|erro|. Null quando o erro absoluto é zero (nada a sinalizar). */
  trackingSignal: number | null;
  /** n abaixo de N_MINIMO_PARA_PUBLICAR — o ponto existe mas não sustenta decisão. */
  provisorio: boolean;
}

/** Uma linha da medida do viés importado do futuro: o mesmo horizonte nas duas curvas. */
export interface ViesImportado {
  horizonte: number;
  /** Fator lido da tabela como ela está hoje — com o estorno posterior já aplicado no passado. */
  fatorBruto: number | null;
  /** Fator com o estorno des-aplicado por `refund_date > corte`. */
  fatorCorrigido: number | null;
  /** fatorCorrigido − fatorBruto. Positivo é o esperado; null quando algum dos dois não foi medido. */
  diferenca: number | null;
}

/**
 * Piso de amostra para um ponto deixar de ser provisório.
 *
 * De onde vem: a janela de reconstrução tem ~64 dias de cortes (piso duro de
 * 2026-06-19) e o horizonte vai a 15 dias, então sobram cerca de 44 datas-alvo
 * por horizonte curto — e menos nos longos, porque o par (corte, alvo) precisa
 * caber inteiro dentro da janela. Vinte é o ponto em que o erro-padrão da
 * média ainda diz alguma coisa sobre a operação e abaixo do qual a curva vira
 * anedota. Não é limiar de aprovação de nada — é limiar de publicação.
 */
export const N_MINIMO_PARA_PUBLICAR = 20;

/** Número utilizável (não nulo, não NaN, não infinito) ou null. */
function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v !== "number") return null;
  if (Number.isNaN(v) || !Number.isFinite(v)) return null;
  return v;
}

/** Divisão que devolve null quando o denominador é zero/ausente — nunca Infinity, nunca 0 por omissão. */
function divide(numerador: number | null, denominador: number | null): number | null {
  if (numerador == null || denominador == null) return null;
  if (denominador === 0) return null;
  const r = numerador / denominador;
  return Number.isFinite(r) ? r : null;
}

/**
 * Filtra as linhas cruas por escopo, agregação e estado de correção, e devolve
 * um ponto por horizonte, em ordem crescente.
 *
 * Entrada vazia, nula ou indefinida devolve lista vazia — nunca lança.
 */
export function construirCurva(
  rows: CurvaBacktestRow[],
  filtro: FiltroCurva,
): PontoDaCurva[] {
  if (rows == null || !Array.isArray(rows) || rows.length === 0) return [];
  if (filtro == null) return [];

  const alvoCorrigido = filtro.corrigido === undefined ? null : filtro.corrigido;

  const selecionadas = rows.filter((r) => {
    if (r == null) return false;
    const rCorrigido = r.corrigido === undefined ? null : r.corrigido;
    return (
      r.escopo === filtro.escopo &&
      r.agregacao === filtro.agregacao &&
      rCorrigido === alvoCorrigido
    );
  });

  const pontos = selecionadas.map((r): PontoDaCurva => {
    const n = num(r.n) ?? 0;
    const previsto = num(r.soma_previsto);
    const realizado = num(r.soma_realizado);
    const erroAbs = num(r.soma_erro_abs);
    const erroSinal = num(r.soma_erro_sinal);

    // n = 0 é horizonte não observado: nada foi medido, então nada é indicador.
    const semAmostra = n === 0;
    const denWape = realizado == null ? null : Math.abs(realizado);

    return {
      horizonte: r.horizon_days,
      n,
      wape: semAmostra ? null : divide(erroAbs, denWape),
      fator: semAmostra ? null : divide(previsto, realizado),
      meDiario: semAmostra ? null : divide(erroSinal, n),
      mae: semAmostra ? null : divide(erroAbs, n),
      // Erro absoluto zero: não há dispersão contra a qual medir o viés.
      trackingSignal:
        semAmostra || erroAbs == null || erroAbs === 0 || erroSinal == null
          ? null
          : divide(n * erroSinal, erroAbs),
      provisorio: n < N_MINIMO_PARA_PUBLICAR,
    };
  });

  return pontos.sort((a, b) => a.horizonte - b.horizonte);
}

/**
 * Mede, por horizonte, quanto do fator vinha do estorno importado do futuro:
 * a diferença entre o fator da curva corrigida e o da curva bruta.
 *
 * Horizonte presente numa lista e ausente na outra é ignorado (não há par a
 * comparar), não vira linha com diferença nula. Qualquer dos dois fatores não
 * medido produz diferença nula — a comparação existe, o número não.
 */
export function medirViesImportado(
  bruta: PontoDaCurva[],
  corrigida: PontoDaCurva[],
): ViesImportado[] {
  if (bruta == null || corrigida == null) return [];
  if (!Array.isArray(bruta) || !Array.isArray(corrigida)) return [];

  const porHorizonte = new Map<number, PontoDaCurva>();
  for (const p of corrigida) {
    if (p != null) porHorizonte.set(p.horizonte, p);
  }

  const saida: ViesImportado[] = [];
  for (const b of bruta) {
    if (b == null) continue;
    const c = porHorizonte.get(b.horizonte);
    if (c === undefined) continue;
    const fatorBruto = num(b.fator);
    const fatorCorrigido = num(c.fator);
    saida.push({
      horizonte: b.horizonte,
      fatorBruto,
      fatorCorrigido,
      diferenca:
        fatorBruto == null || fatorCorrigido == null ? null : fatorCorrigido - fatorBruto,
    });
  }

  return saida.sort((a, b) => a.horizonte - b.horizonte);
}

/**
 * O maior horizonte, a partir de D+1 e SEM BURACO, em que o fator fica dentro
 * de ±`toleranciaFator` em torno de 1.
 *
 * A tolerância é argumento obrigatório e não tem valor padrão: a D-6 do
 * 224-CONTEXT reserva o limiar da PV ao Wesley, depois de ele ver a curva.
 *
 * Interrompem a sequência, e portanto limitam a resposta: horizonte ausente,
 * fator não medido e ponto provisório — horizonte sem amostra não se declara
 * útil. Se nem D+1 passar, devolve null.
 */
export function horizonteUtil(
  pontos: PontoDaCurva[],
  toleranciaFator: number,
): number | null {
  if (pontos == null || !Array.isArray(pontos) || pontos.length === 0) return null;
  const tol = num(toleranciaFator);
  if (tol == null) return null;

  const porHorizonte = new Map<number, PontoDaCurva>();
  for (const p of pontos) {
    if (p != null) porHorizonte.set(p.horizonte, p);
  }

  let ultimo: number | null = null;
  for (let h = 1; ; h++) {
    const p = porHorizonte.get(h);
    if (p === undefined) break;
    if (p.provisorio) break;
    const fator = num(p.fator);
    if (fator == null) break;
    if (Math.abs(fator - 1) > tol) break;
    ultimo = h;
  }

  return ultimo;
}

// ============================================================================
// Fase 224 Plano 07, Task 1 (ERR-04) — as BANDAS por faixa de horizonte.
//
// A curva acima responde "de quanto a previsão erra em média". Isso não
// dispara decisão nenhuma. O que dispara é "no pior caso plausível, em 12/09
// o saldo é −R$ 6.800" — e é isso que as funções abaixo calculam.
//
// Guardrail crítico 4 — O PIOR CASO É O QUANTIL SUPERIOR, e inverter isso é
// silencioso. O erro medido pela RPC é `previsto − realizado`. Erro grande e
// POSITIVO significa que a agenda prometeu muito mais do que entrou: é o
// cenário ruim. Logo o pior caso do SALDO é o saldo projetado MENOS o quantil
// superior do erro. Usar o quantil inferior daria o cenário bom com cara de
// cenário ruim, e o card viraria uma máquina de otimismo — sem quebrar teste
// nenhum, porque os dois caminhos devolvem um número plausível. O Test 33
// existe para travar exatamente isto.
//
// Guardrail crítico 5 — O `n` VIAJA JUNTO DO NÚMERO, sempre. Com ~59 dias de
// histórico sobram cerca de 44 datas-alvo por horizonte, e menos nos longos:
// um percentil 5 sobre 44 observações é sustentado por cerca de duas. Por isso
// os horizontes são agrupados em quatro faixas (multiplica por três a amostra)
// e por isso a régua do quantil DEGRADA conforme o `n` encolhe — de p95 para
// p90 e depois para o máximo observado, este último sempre marcado como
// provisório. Quem "simplificar" isso para um percentil fixo publica um número
// sustentado por duas observações, e ele vira número oficial no primeiro print.
//
// Guardrail crítico 6 — FAIXA SEM OBSERVAÇÃO NÃO SOME DA LISTA. Ela aparece
// com `n = 0` e números nulos. Sumir esconderia que aquele horizonte não foi
// medido, e a tela apresentaria só os horizontes convenientes.
// ============================================================================

/**
 * Linha par a par de get_forecast_backtest_errors — 1 por
 * (escopo, corrigido, agregacao, corte, horizon_days).
 *
 * `erro` é `previsto − realizado`. O sinal importa: ver o Guardrail 4.
 */
export interface ErroBacktestRow {
  escopo: string;
  corrigido: boolean | null;
  agregacao: string;
  corte: string;
  horizon_days: number;
  previsto: number | null;
  realizado: number | null;
  erro: number | null;
}

/** Uma faixa de horizontes, fechada nos dois extremos. */
export interface FaixaDeHorizonte {
  inicio: number;
  fim: number;
  rotulo: string;
}

/**
 * As quatro faixas. Os cortes não são arbitrários: D+9/D+10 é a fronteira
 * medida em que a agenda do Mercado Pago deixa de cobrir o dia (224-CURVA.md,
 * C-02: a cobertura cai de 102,4% para 66,8% de uma vez), e é a mesma
 * fronteira em que o deflator de estorno deixa de ajudar (224-PROVA-DEFLATOR,
 * R-01). As três primeiras faixas ficam dentro da região onde a agenda existe;
 * a quarta é a região onde ela ainda não foi preenchida.
 */
export const FAIXAS_DE_HORIZONTE: FaixaDeHorizonte[] = [
  { inicio: 1, fim: 3, rotulo: "D+1 a D+3" },
  { inicio: 4, fim: 6, rotulo: "D+4 a D+6" },
  { inicio: 7, fim: 9, rotulo: "D+7 a D+9" },
  { inicio: 10, fim: 15, rotulo: "D+10 a D+15" },
];

/**
 * A agregação de que a banda é feita, e ela não é escolha de gosto.
 *
 * A decisão real — pago hoje ou prorrogo? — depende do saldo ACUMULADO até a
 * data do pagamento. Se o modelo antecipa R$ 8 mil de sexta para quinta, o
 * erro diário dos dois dias é grande e o acumulado até sexta é zero; para
 * decidir sobre um boleto de sexta, o erro relevante é zero. E o acumulado
 * vem MEDIDO da RPC, com soma corrida — nunca derivado do diário por raiz do
 * horizonte, derivação que subestima a banda porque erros de vários passos
 * são positivamente correlacionados.
 */
export const AGREGACAO_DA_BANDA = "acumulado";

/** Qual régua de quantil a amostra permitiu usar. */
export type ReguaDoQuantil = "p95" | "p90" | "maximo";

/** Piso de amostra para cada régua. Abaixo de `N_MINIMO_PARA_PUBLICAR` a banda é provisória. */
const N_PARA_P95 = 40;

/** A banda de erro de uma faixa, com o `n` e a régua que a sustentam. */
export interface BandaDaFaixa {
  faixa: FaixaDeHorizonte;
  /** Quantos pares (corte, horizonte) sustentam a banda. Erro nulo não conta. */
  n: number;
  /** O quantil SUPERIOR do erro — ver o Guardrail 4. Null = não medido. */
  erroNoPiorCaso: number | null;
  /** O percentil 50 do mesmo conjunto. Null = não medido. */
  erroMediano: number | null;
  /** A régua efetivamente aplicada, dado o `n`. */
  regua: ReguaDoQuantil;
  /** O quantil aplicado (0,95 · 0,90 · 1 para o máximo). Null quando nada foi medido. */
  quantilAplicado: number | null;
  /** `n` abaixo de N_MINIMO_PARA_PUBLICAR — a banda existe mas não sustenta decisão. */
  provisorio: boolean;
}

/** Recorte de leitura da banda: escopo e estado de correção (nulo nas saídas). */
export interface FiltroBanda {
  escopo: string;
  corrigido: boolean | null;
}

/**
 * O quantil empírico de uma lista, por posto inferior.
 *
 * Índice = `floor(p × (tamanho − 1))`: `p = 0` devolve o mínimo e `p = 1`
 * devolve o máximo, sem interpolação. Interpolar inventaria um valor que não
 * foi observado, e com amostra de dezenas isso é precisão de mentira.
 *
 * Valores nulos e não finitos são descartados ANTES de ordenar. Quem conta o
 * `n` é o chamador, sobre a mesma lista já filtrada — não sobre a bruta.
 */
export function quantilEmpirico(valores: number[], p: number): number | null {
  if (valores == null || !Array.isArray(valores)) return null;
  const limpos: number[] = [];
  for (const v of valores) {
    const x = num(v);
    if (x != null) limpos.push(x);
  }
  if (limpos.length === 0) return null;

  const prob = num(p);
  if (prob == null) return null;

  limpos.sort((a, b) => a - b);
  const bruto = Math.floor(prob * (limpos.length - 1));
  const idx = Math.min(limpos.length - 1, Math.max(0, bruto));
  return limpos[idx];
}

/** A faixa que contém o horizonte, ou null fora de D+1 a D+15. */
export function faixaDoHorizonte(h: number): FaixaDeHorizonte | null {
  const x = num(h);
  if (x == null || !Number.isInteger(x)) return null;
  for (const f of FAIXAS_DE_HORIZONTE) {
    if (x >= f.inicio && x <= f.fim) return f;
  }
  return null;
}

/** Monta a banda de uma faixa a partir dos erros já filtrados dela. */
function montarBanda(faixa: FaixaDeHorizonte, erros: number[]): BandaDaFaixa {
  const n = erros.length;

  if (n === 0) {
    return {
      faixa,
      n: 0,
      erroNoPiorCaso: null,
      erroMediano: null,
      regua: "maximo",
      quantilAplicado: null,
      provisorio: true,
    };
  }

  // A régua degrada com a amostra — ver o Guardrail 5.
  let regua: ReguaDoQuantil;
  let p: number;
  if (n >= N_PARA_P95) {
    regua = "p95";
    p = 0.95;
  } else if (n >= N_MINIMO_PARA_PUBLICAR) {
    regua = "p90";
    p = 0.9;
  } else {
    regua = "maximo";
    p = 1;
  }

  return {
    faixa,
    n,
    erroNoPiorCaso: quantilEmpirico(erros, p),
    erroMediano: quantilEmpirico(erros, 0.5),
    regua,
    quantilAplicado: p,
    provisorio: n < N_MINIMO_PARA_PUBLICAR,
  };
}

/** Distribui uma lista de (horizonte, erro) pelas quatro faixas e monta as bandas. */
function bandasDe(pontos: Array<{ h: number; erro: number }>): BandaDaFaixa[] {
  const porFaixa = new Map<FaixaDeHorizonte, number[]>();
  for (const f of FAIXAS_DE_HORIZONTE) porFaixa.set(f, []);

  for (const ponto of pontos) {
    const faixa = faixaDoHorizonte(ponto.h);
    if (faixa == null) continue;
    porFaixa.get(faixa)!.push(ponto.erro);
  }

  return FAIXAS_DE_HORIZONTE.map((f) => montarBanda(f, porFaixa.get(f)!));
}

/**
 * A banda de erro de um escopo (entradas ou saídas), por faixa de horizonte.
 *
 * Filtra as linhas par a par pela agregação ACUMULADA (ver AGREGACAO_DA_BANDA)
 * e pelo escopo, agrupa em faixas e devolve uma banda por faixa — SEMPRE as
 * quatro, mesmo as sem observação.
 *
 * ⚠️ `corrigido` é NULL no escopo de saídas, e isso significa "não se aplica",
 * não "ausência de dado". Filtrar por `corrigido === true` elide o escopo de
 * saídas inteiro, e a tela reportaria que saídas não existem — o defeito está
 * registrado em 224-CURVA.md, C-01, e o Test 43 o trava.
 */
export function bandaPorFaixa(erros: ErroBacktestRow[], filtro: FiltroBanda): BandaDaFaixa[] {
  if (erros == null || !Array.isArray(erros) || filtro == null) return bandasDe([]);

  const alvoCorrigido = filtro.corrigido === undefined ? null : filtro.corrigido;

  const pontos: Array<{ h: number; erro: number }> = [];
  for (const r of erros) {
    if (r == null) continue;
    if (r.agregacao !== AGREGACAO_DA_BANDA) continue;
    if (r.escopo !== filtro.escopo) continue;
    const rCorrigido = r.corrigido === undefined ? null : r.corrigido;
    if (rCorrigido !== alvoCorrigido) continue;
    const erro = num(r.erro);
    if (erro == null) continue; // linha sem erro medido não conta para o n
    pontos.push({ h: r.horizon_days, erro });
  }

  return bandasDe(pontos);
}

/**
 * A banda de erro do SALDO, por faixa de horizonte.
 *
 * Por que ela existe, já que existem as duas bandas separadas: o saldo é
 * entradas menos saídas, então o erro do saldo é
 * `(prev_ent − real_ent) − (prev_sai − real_sai)`, isto é, o erro das entradas
 * MENOS o das saídas — casado par a par por (corte, horizonte), o que preserva
 * a correlação entre os dois lados no mesmo dia. Somar as duas bandas
 * independentes exageraria a banda; usar só a de entradas ignoraria que as
 * saídas erram 2 a 3% em todo o horizonte.
 *
 * 🔴 Isto NÃO é o mesmo que reportar entradas e saídas num número só. O card
 * mostra os dois fatores SEPARADOS de propósito, porque um excesso nas
 * entradas e um excesso nas saídas podem se cancelar e produzir um fator de
 * saldo "quase certo" que está errado dos dois lados. O que se quer aqui é
 * outra coisa: a DISPERSÃO do erro do saldo, que é justamente o que decide se
 * o saldo de uma data pode virar negativo.
 *
 * Par sem os dois lados é descartado: entrada sem a saída do mesmo (corte,
 * horizonte) viraria um erro de saldo com saída zero, que é uma medição que
 * não existe.
 */
export function bandaDoSaldo(erros: ErroBacktestRow[]): BandaDaFaixa[] {
  if (erros == null || !Array.isArray(erros)) return bandasDe([]);

  const chave = (r: ErroBacktestRow) => `${r.corte}|${r.horizon_days}`;
  const entradas = new Map<string, number>();
  const saidas = new Map<string, number>();

  for (const r of erros) {
    if (r == null) continue;
    if (r.agregacao !== AGREGACAO_DA_BANDA) continue;
    const erro = num(r.erro);
    if (erro == null) continue;
    // Entradas: só a variante CORRIGIDA — a bruta ainda traz o estorno
    // importado do futuro e mediria o viés com o próprio viés dentro.
    if (r.escopo === "entradas" && r.corrigido === true) entradas.set(chave(r), erro);
    if (r.escopo === "saidas") saidas.set(chave(r), erro);
  }

  const pontos: Array<{ h: number; erro: number }> = [];
  for (const [k, erroEnt] of entradas) {
    if (!saidas.has(k)) continue;
    const h = Number(k.split("|")[1]);
    pontos.push({ h, erro: erroEnt - saidas.get(k)! });
  }

  return bandasDe(pontos);
}

/**
 * O saldo no pior caso plausível: o saldo projetado MENOS o erro do pior caso.
 *
 * Banda ausente, ou com o pior caso não medido, devolve NULO — nunca o saldo
 * projetado sem aviso, que faria o pior caso parecer idêntico ao caso base e
 * a tela afirmaria uma banda que não existe.
 *
 * Saldo projetado ZERO é medido e vale zero; só nulo é ausência.
 */
export function saldoNoPiorCaso(
  saldoProjetado: number | null,
  banda: BandaDaFaixa | null,
): number | null {
  const saldo = num(saldoProjetado);
  if (saldo == null) return null;
  if (banda == null) return null;
  const pior = num(banda.erroNoPiorCaso);
  if (pior == null) return null;
  return saldo - pior;
}
