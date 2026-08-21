// ============================================================================
// forecastErrorCurve — Fase 224 Plano 03, Task 2 (ERR-01)
// Função pura que monta a curva de erro da previsão de caixa por horizonte a
// partir das linhas cruas da RPC get_forecast_backtest_curve (migration
// 20260817110000_forecast_backtest_rpcs.sql): WAPE, fator de viés, ME diário,
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
