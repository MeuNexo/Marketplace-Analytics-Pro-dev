// ============================================================================
// 233-07 — Saldo e confiança na mesma linha, D+1 a D+30 (D-13)
//
// 🔴 A DECISÃO QUE FUNDA A TABELA, e ela não é neutra: de D+10 em diante o
// número PRINCIPAL (`saldo_previsto`) é `accumulated_balance_sma` — a linha
// que o gráfico já desenha em âmbar, que preenche com a média de 15 dias a
// partir do 10º dia (Fase 60/224). `saldo_so_agendado` (`accumulated_balance`)
// aparece do lado, e a TELA — não este módulo — decide em que faixa exibi-lo.
//
//   1. Em D+1..D+9 as duas colunas são iguais por construção (`get_cashflow`
//      só injeta média a partir do 10º dia) — a coluna principal atravessa os
//      30 dias sem costura própria; a costura que existe é a da FRONTEIRA.
//   2. A diferença entre as duas colunas na faixa `media` é o tamanho do que
//      a média está inventando.
//   3. Publicar só a confirmada afirmaria a queda inteira como previsão; só a
//      com média esconderia que a agenda não tem nada ali.
//
// 🔴 FONTE — o saldo da linha D+k vem da entrada da SÉRIE cuja DATA é
// `hoje + k`, nunca do índice do array (T-233-07-03). A série chega por
// parâmetro; o módulo não consulta rede.
//
// 🔴 FONTE — `confianca_pct` só sai preenchido quando `estado === "medido"` E
// `n_pares > 0`, inclusive quando a fonte mentir e mandar percentual numa
// linha de ausência (T-233-07-02). `medido` com `n_pares === 0` não existe:
// vira `nao_medido` sem motivo.
//
// 🔴 FRONTEIRA — `faixa` vem de `ultimoDiaDeAgenda`, um PARÂMETRO. Nenhum
// literal de fronteira mora aqui — o módulo não sabe que hoje o valor é 9
// (`ULTIMO_HORIZONTE_COMPARAVEL`, em `useForecastErrorCurve.ts`).
//
// A confiança em si NÃO é recalculada aqui — ela chega pronta de
// `useConfiancaDoSaldo()` (233-04), que já resolve `estado`, `motivo_ausencia`
// e `medivel_em` para os 30 horizontes. Este módulo só CASA a confiança com o
// saldo do mesmo horizonte; reimplementar a regra da confiança seria uma
// segunda implementação que diverge da primeira.
// ============================================================================

import type { EstadoDaConfianca, MotivoAusencia, PontoDeConfianca } from "./confiancaDoSaldo";

/** Uma entrada da série de saldo por dia — o subconjunto de `CashFlowDataPoint`
 *  que este módulo precisa. `useCashFlowData` já devolve algo estruturalmente
 *  compatível; a tabela não faz consulta própria (T-233-07-*, proibição da
 *  fase). */
export interface EntradaDeSaldoDiario {
  /** yyyy-MM-dd (ou prefixo — o módulo usa só os 10 primeiros caracteres). */
  fullDate: string;
  /** O que a agenda SOZINHA diz, sem piso de média. */
  accumulated_balance: number;
  /** O saldo PRINCIPAL da tabela: a linha que o gráfico já desenha em âmbar. */
  accumulated_balance_sma: number;
}

export type FaixaDaAgenda = "agenda" | "media";

export interface LinhaDeSaldoEConfianca {
  /** D+k, de 1 a `horizonteMaximo`. */
  horizonte: number;
  /** A data casada (`hoje + horizonte`), ou `null` se `hoje` não for válido. */
  data: string | null;
  /** O número PRINCIPAL — `accumulated_balance_sma` do dia. `null` se ausente. */
  saldo_previsto: number | null;
  /** O que a agenda sozinha diz (`accumulated_balance`). A TELA decide onde exibir. */
  saldo_so_agendado: number | null;
  /** `"agenda"` até `ultimoDiaDeAgenda`, `"media"` daí em diante. */
  faixa: FaixaDaAgenda;
  /** Só preenchido quando `estado === "medido"`. Nunca 0% por omissão. */
  confianca_pct: number | null;
  n_pares: number;
  estado: EstadoDaConfianca;
  motivo_ausencia: MotivoAusencia | null;
  medivel_em: string | null;
}

export interface ParametrosLinhasDeSaldoEConfianca {
  /** A série de saldo por dia — vem por PROP da mesma `useCashFlowData` do gráfico. */
  serie: EntradaDeSaldoDiario[] | null | undefined;
  /** Os 30 pontos prontos de `useConfiancaDoSaldo()` — não recalculados aqui. */
  pontos: PontoDeConfianca[] | null | undefined;
  /** yyyy-MM-dd. Data-base do casamento; horizonte k casa com `hoje + k`. */
  hoje: string | null | undefined;
  /** A fronteira agenda/média. PARÂMETRO — nenhum literal dentro do módulo. */
  ultimoDiaDeAgenda: number;
  /** Quantas linhas a saída sempre tem, para qualquer entrada. */
  horizonteMaximo: number;
}

const ESTADOS_VALIDOS: readonly EstadoDaConfianca[] = [
  "medido",
  "amostra_insuficiente",
  "serie_curta",
  "sem_declaracao",
  "sem_serie",
  "nao_medido",
];

const MOTIVOS_VALIDOS: readonly MotivoAusencia[] = ["serie_curta", "sem_declaracao", "sem_serie"];

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const estadoValido = (v: unknown): EstadoDaConfianca =>
  typeof v === "string" && (ESTADOS_VALIDOS as readonly string[]).includes(v)
    ? (v as EstadoDaConfianca)
    : "nao_medido";

const motivoValido = (v: unknown): MotivoAusencia | null =>
  typeof v === "string" && (MOTIVOS_VALIDOS as readonly string[]).includes(v)
    ? (v as MotivoAusencia)
    : null;

/** "2026-08-27" + 3 → "2026-08-30". `null` se `iso` não abrir com yyyy-MM-dd. */
function dataApos(iso: string, dias: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m == null) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!Number.isFinite(ano) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null;
  const t = new Date(Date.UTC(ano, mes - 1, dia + dias));
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString().slice(0, 10);
}

/** O que a linha de confiança leva, dado o ponto (ou a ausência de ponto) do
 *  horizonte. Isolado para os quatro ramos ficarem auditáveis: com par
 *  publicado, `medido` sem par (ausência sem nome), ausência nomeada, e
 *  horizonte que a faixa não trouxe. */
function linhaDeConfianca(ponto: PontoDeConfianca | null | undefined): {
  confianca_pct: number | null;
  n_pares: number;
  estado: EstadoDaConfianca;
  motivo_ausencia: MotivoAusencia | null;
  medivel_em: string | null;
} {
  if (ponto == null) {
    return { confianca_pct: null, n_pares: 0, estado: "nao_medido", motivo_ausencia: null, medivel_em: null };
  }

  const n_pares = num(ponto.n_pares) ?? 0;
  const estado = estadoValido(ponto.estado);
  const conf = num(ponto.confianca_pct);

  // 🔴 T-233-07-02 — só publica o percentual quando o estado É `medido` E há
  // par E há número. Ignora `confianca_pct` da fonte em qualquer outro caso,
  // mesmo que ela mande um valor (contrato violado).
  if (estado === "medido" && n_pares > 0 && conf != null) {
    return {
      confianca_pct: Math.max(0, Math.min(100, conf)),
      n_pares,
      estado: "medido",
      motivo_ausencia: null,
      medivel_em: null,
    };
  }

  // 🔴 `medido` com `n_pares === 0` (ou sem número) não existe: vira ausência
  // sem nome, nunca fica com o rótulo de "medido" vazio.
  if (estado === "medido") {
    return { confianca_pct: null, n_pares, estado: "nao_medido", motivo_ausencia: null, medivel_em: null };
  }

  const motivo = motivoValido(ponto.motivo_ausencia);
  return {
    confianca_pct: null,
    n_pares,
    estado,
    motivo_ausencia: motivo,
    // Só `serie_curta` tem data — nas outras, esperar não resolve.
    medivel_em: motivo === "serie_curta" && typeof ponto.medivel_em === "string" ? ponto.medivel_em : null,
  };
}

/**
 * Junta saldo por dia com confiança por horizonte, uma linha por dia, D+1 a
 * `horizonteMaximo` — SEMPRE essa quantidade, para qualquer entrada. Nunca
 * lança: entrada corrompida vira ausência, não exceção.
 */
export function linhasDeSaldoEConfianca(
  params: ParametrosLinhasDeSaldoEConfianca,
): LinhaDeSaldoEConfianca[] {
  const max =
    Number.isFinite(params.horizonteMaximo) && params.horizonteMaximo > 0
      ? Math.floor(params.horizonteMaximo)
      : 30;

  const ultimoDiaDeAgenda = Number.isFinite(params.ultimoDiaDeAgenda) ? params.ultimoDiaDeAgenda : 0;

  const hoje = typeof params.hoje === "string" ? params.hoje : "";

  // Casamento por DATA, nunca por índice (T-233-07-03): a série vira um mapa
  // chaveado pela data, e cada horizonte busca a SUA data nesse mapa.
  const porData = new Map<string, EntradaDeSaldoDiario>();
  for (const e of params.serie ?? []) {
    if (e == null) continue;
    if (typeof e.fullDate !== "string" || e.fullDate.length < 10) continue;
    porData.set(e.fullDate.slice(0, 10), e);
  }

  const porHorizonte = new Map<number, PontoDeConfianca>();
  for (const p of params.pontos ?? []) {
    if (p == null) continue;
    if (typeof p.horizonte !== "number" || !Number.isFinite(p.horizonte)) continue;
    porHorizonte.set(p.horizonte, p);
  }

  const linhas: LinhaDeSaldoEConfianca[] = [];
  for (let h = 1; h <= max; h += 1) {
    const data = dataApos(hoje, h);
    const entrada = data != null ? porData.get(data) ?? null : null;

    linhas.push({
      horizonte: h,
      data,
      saldo_previsto: entrada != null ? num(entrada.accumulated_balance_sma) : null,
      saldo_so_agendado: entrada != null ? num(entrada.accumulated_balance) : null,
      faixa: h <= ultimoDiaDeAgenda ? "agenda" : "media",
      ...linhaDeConfianca(porHorizonte.get(h)),
    });
  }
  return linhas;
}
