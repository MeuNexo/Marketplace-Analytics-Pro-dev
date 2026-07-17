// ============================================================================
// dreCashForecast — Phase 100 Plan 02, Task 1
// Função pura que monta o painel "Fechar o mês" a partir das linhas cruas da
// RPC get_dre_cash_forecast (Plano 100-01): gap de caixa do mês, meta
// client-side, venda necessária, dia-limite, ritmo real × necessário com
// semáforo, e alertas de recorrência suspeita (guarda anti-fantasma, BEC-04).
// Espelho estrutural de src/lib/dreCashCascade.ts (Phase 99).
//
// Guardrail crítico (100-CONTEXT "Matemática do gap", D-02): GAP = saídas
// previstas − entradas garantidas, SEM projeção de vendas novas. O ritmo real
// (vendas_7d_media_diaria) é só exibido — NUNCA soma no gap. Particionamento
// por secao/categoria acontece na entrada da função, antes de qualquer soma —
// mesmo padrão de buildDreCashCascade.
//
// Sem React/Supabase/TanStack/date-fns — módulo 100% puro, testável sem
// rede. Aritmética de datas com Date nativo (mesmo espírito de round2 em
// dreCashCascade.ts para números).
// ============================================================================

/** Linha crua da RPC get_dre_cash_forecast — 1 por (secao, categoria). */
export interface DreCashForecastRow {
  secao: string;
  categoria: string;
  total: number | null;
  n: number;
}

/**
 * Alerta de recorrência suspeita (D-06/BEC-04): pendente do mês corrente cuja
 * dupla categoria+valor também aparece em >= 2 meses futuros — lição da
 * recorrência acidental de ads/full de 2026-07-17. Exibição NEUTRA/informativa
 * — nunca tratada como erro pelo card consumidor.
 */
export interface ForecastAlertaRecorrencia {
  categoria: string;
  valor: number;
  mesesFuturos: number;
}

/** Composição das saídas previstas do mês (D-02) — 5 componentes + total. */
export interface DreCashForecastSaidasPrevistas {
  pagas: number;
  estornosOcorridos: number;
  pendentes: number;
  estornosPrevistos: number;
  impostoPrevistoRestante: number;
  total: number;
}

/** Composição das entradas garantidas do mês (D-02) — 2 componentes + total. */
export interface DreCashForecastEntradasGarantidas {
  liberadas: number;
  agendadas: number;
  total: number;
}

export type DreCashForecastSemaforo = "verde" | "vermelho" | "neutro";

/** Resultado completo do painel "Fechar o mês" a partir das linhas da RPC. */
export interface DreCashForecast {
  saidasPrevistas: DreCashForecastSaidasPrevistas;
  entradasGarantidas: DreCashForecastEntradasGarantidas;
  /** saidasPrevistas.total − entradasGarantidas.total. NUNCA inclui ritmo/projeção de vendas novas. */
  gap: number;
  /** gap + meta (meta client-side, >= 0, default 0 = zero a zero). */
  gapComMeta: number;
  /** Fração 0-1 medida na RPC; null quando a janela de 90d não tem dado suficiente. */
  taxaVendaParaCaixa: number | null;
  /** Dias entre venda e liberação; fallback 14 quando a RPC não devolve a linha (mesmo fallback documentado no SQL). */
  lagLiberacaoDias: number;
  /** Último dia do mês de `opts.hoje` menos `lagLiberacaoDias` — dia até quando vender ainda vira caixa este mês. */
  diaLimite: Date;
  /** Dias de calendário de hoje até diaLimite, mínimo 0 (dia-calendário local, meia-noite a meia-noite). */
  diasRestantes: number;
  /** true quando diasRestantes é 0 e ainda há gap a cobrir (venda nova não vira mais caixa este mês). */
  prazoEsgotado: boolean;
  /** gapComMeta <= 0 → 0; taxaVendaParaCaixa null/<=0 → null; senão gapComMeta ÷ taxaVendaParaCaixa. */
  vendaNecessaria: number | null;
  /** vendaNecessaria ÷ diasRestantes quando ambos > 0; senão null (sem prazo, não há ritmo "necessário" definido). */
  ritmoNecessario: number | null;
  /** Média diária de vendas brutas dos últimos 7 dias (row vendas_7d_media_diaria; 0 se ausente) — só exibição, nunca soma no gap. */
  ritmoReal7d: number;
  /**
   * "neutro" se gapComMeta <= 0 (mês já fecha na meta); "verde" se
   * ritmoReal7d >= ritmoNecessario (ambos definidos); "vermelho" nos demais
   * casos com gap aberto — inclui prazoEsgotado e ritmoNecessario null
   * (sem prova matemática de que o mês fecha, o semáforo não fica verde por
   * omissão; decisão travada no 100-CONTEXT D-05).
   */
  semaforo: DreCashForecastSemaforo;
  /** 0..N alertas de recorrência suspeita, ordenados por valor desc. */
  alertasRecorrencia: ForecastAlertaRecorrencia[];
  /** false quando a RPC não devolveu nenhuma linha para o mês. */
  hasData: boolean;
}

/** Fallback de lag de liberação quando a RPC não devolve a linha — mesmo valor documentado no SQL da 100-01. */
export const LAG_LIBERACAO_FALLBACK_DIAS = 14;

// Arredondamento a 2 casas — consistente com dreCashCascade.ts (Math.round(x*100)/100).
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---- Helpers de data (dia-calendário local, sem date-fns) -----------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfMonthDate(d: Date): Date {
  // Dia 0 do mês seguinte = último dia do mês de `d`.
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Diferença em dias-calendário entre duas datas já normalizadas para meia-noite local. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Monta o painel "Fechar o mês" a partir das linhas cruas da RPC
 * get_dre_cash_forecast.
 *
 * Guardrail (aplicado ANTES de qualquer soma): particiona `rows` por
 * (secao, categoria) num lookup — categoria ausente vira 0 nos agregados
 * monetários e null nas taxas/lag (null-safe, sem NaN). O gap é calculado
 * exclusivamente a partir de saidasPrevistas/entradasGarantidas — o ritmo
 * real (vendas_7d_media_diaria) nunca entra nessa soma (D-02).
 */
export function buildDreCashForecast(
  rows: DreCashForecastRow[],
  opts: { meta: number; hoje: Date },
): DreCashForecast {
  const safeRows = rows ?? [];
  const meta = Math.max(0, opts.meta ?? 0);

  const findRow = (secao: string, categoria: string): DreCashForecastRow | undefined =>
    safeRows.find((r) => r.secao === secao && r.categoria === categoria);

  /** Valor cru (pode ser null — usado pelas taxas/lag, que são null-safe por natureza). */
  const rawValor = (secao: string, categoria: string): number | null => {
    const r = findRow(secao, categoria);
    if (!r || r.total === null || r.total === undefined) return null;
    return Number(r.total);
  };

  /** Valor monetário — categoria ausente ou null vira 0 (nunca contamina com NaN). */
  const valorOuZero = (secao: string, categoria: string): number => rawValor(secao, categoria) ?? 0;

  // ---- Saídas previstas do mês (D-02) ----
  const pagas = valorOuZero("saida_prevista", "saidas_pagas");
  const estornosOcorridos = valorOuZero("saida_prevista", "estornos_ocorridos");
  const pendentes = valorOuZero("saida_prevista", "saidas_pendentes");
  const estornosPrevistos = valorOuZero("saida_prevista", "estornos_previstos");
  const impostoPrevistoRestante = valorOuZero("saida_prevista", "imposto_previsto_restante");
  const saidasTotal = round2(
    pagas + estornosOcorridos + pendentes + estornosPrevistos + impostoPrevistoRestante,
  );

  const saidasPrevistas: DreCashForecastSaidasPrevistas = {
    pagas: round2(pagas),
    estornosOcorridos: round2(estornosOcorridos),
    pendentes: round2(pendentes),
    estornosPrevistos: round2(estornosPrevistos),
    impostoPrevistoRestante: round2(impostoPrevistoRestante),
    total: saidasTotal,
  };

  // ---- Entradas garantidas do mês (D-02) ----
  const liberadas = valorOuZero("entrada", "entradas_liberadas");
  const agendadas = valorOuZero("entrada", "entradas_agendadas");
  const entradasTotal = round2(liberadas + agendadas);

  const entradasGarantidas: DreCashForecastEntradasGarantidas = {
    liberadas: round2(liberadas),
    agendadas: round2(agendadas),
    total: entradasTotal,
  };

  // ---- Gap (D-02 — projeção de vendas novas NUNCA entra aqui) ----
  const gap = round2(saidasTotal - entradasTotal);
  const gapComMeta = round2(gap + meta);

  // ---- Taxa e dia-limite (D-03) ----
  const taxaVendaParaCaixa = rawValor("taxa", "taxa_venda_para_caixa");
  const lagRaw = rawValor("taxa", "lag_liberacao_dias");
  const lagLiberacaoDias = lagRaw === null ? LAG_LIBERACAO_FALLBACK_DIAS : lagRaw;

  const hoje = startOfDay(opts.hoje);
  const fimDoMes = endOfMonthDate(hoje);
  const diaLimite = addDays(fimDoMes, -lagLiberacaoDias);
  const diasRestantes = Math.max(0, daysBetween(hoje, diaLimite));

  // ---- Venda necessária (D-02/D-03) ----
  const vendaNecessaria =
    gapComMeta <= 0
      ? 0
      : taxaVendaParaCaixa === null || taxaVendaParaCaixa <= 0
        ? null
        : round2(gapComMeta / taxaVendaParaCaixa);

  const prazoEsgotado = diasRestantes === 0 && gapComMeta > 0;

  // ---- Ritmo e semáforo (D-05) ----
  const ritmoNecessario =
    vendaNecessaria !== null && vendaNecessaria > 0 && diasRestantes > 0
      ? round2(vendaNecessaria / diasRestantes)
      : null;

  const ritmoReal7d = round2(valorOuZero("ritmo", "vendas_7d_media_diaria"));

  let semaforo: DreCashForecastSemaforo;
  if (gapComMeta <= 0) {
    semaforo = "neutro";
  } else if (ritmoNecessario !== null && ritmoReal7d >= ritmoNecessario) {
    semaforo = "verde";
  } else {
    semaforo = "vermelho";
  }

  // ---- Alertas de recorrência (D-06/BEC-04) ----
  const alertasRecorrencia: ForecastAlertaRecorrencia[] = safeRows
    .filter((r) => r.secao === "alerta_recorrencia")
    .map((r) => ({
      categoria: r.categoria,
      valor: round2(r.total ?? 0),
      mesesFuturos: r.n,
    }))
    .sort((a, b) => b.valor - a.valor);

  return {
    saidasPrevistas,
    entradasGarantidas,
    gap,
    gapComMeta,
    taxaVendaParaCaixa,
    lagLiberacaoDias,
    diaLimite,
    diasRestantes,
    prazoEsgotado,
    vendaNecessaria,
    ritmoNecessario,
    ritmoReal7d,
    semaforo,
    alertasRecorrencia,
    hasData: safeRows.length > 0,
  };
}
