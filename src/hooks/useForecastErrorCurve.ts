// ============================================================================
// useForecastErrorCurve — Fase 224 Plano 07, Task 2 (ERR-04)
//
// Lê as duas RPCs do backtest de previsão de caixa (migration
// 20260821150000_forecast_backtest_rpcs) e devolve, para a tela: a curva de
// erro por horizonte e as bandas de pior caso por faixa. Nenhuma aritmética
// mora aqui — tudo vem de `src/lib/forecastErrorCurve.ts`, que é puro e
// testado.
//
// 🔴 POR QUE A SEGUNDA CONSULTA PAGINA E A PRIMEIRA NÃO.
// `get_forecast_backtest_curve` já vem agregada: 2 escopos × 3 variantes de
// correção × 2 agregações × 15 horizontes = NO MÁXIMO 90 linhas. Uma
// requisição basta, e o número está escrito aqui para ninguém copiar o padrão
// sem laço para a outra.
// `get_forecast_backtest_errors` devolve o backtest par a par: ~64 cortes ×
// 15 horizontes × 6 variantes ≈ 5.700 linhas. O PostgREST TRUNCA em 1000 e
// não devolve erro nenhum. Sem o laço de `.range()`, a banda sairia calculada
// sobre um quinto da amostra, com um `n` errado impresso ao lado do número na
// tela — dano silencioso, exatamente o que já aconteceu em outro lugar:
// `useMLAdsBillingSpend.ts:19` registra que "sem o laço de `.range()`, o
// gasto de ads sairia SUBESTIMADO sem nenhum sinal".
//
// 🔴 POR QUE O DEFLATOR ENTRA NA CHAMADA (`p_deflator_span`).
// Desde o 224-05 o `get_cashflow` de produção JÁ deflaciona os dias D+1 a D+9
// pelo deflator de estorno (span 30). A banda desta tela é aplicada ao saldo
// que sai daquela RPC. Se ela fosse medida sobre o backtest SEM deflator, ela
// carregaria o viés de +32,6% que a produção já corrigiu — a correção entraria
// duas vezes e o pior caso sairia absurdamente pessimista. Medir com o mesmo
// deflator é a única forma de a banda descrever o erro do número que está na
// tela, e não o de um modelo que não roda mais.
//
// ⚠️ E ONDE ISSO DEIXA DE VALER: de D+10 em diante a produção NÃO deflaciona e
// injeta a média de 15 dias como PISO (`GREATEST(d.inc, v_sma)`), e o escopo
// `entradas` do backtest modela só a agenda, sem piso nenhum
// (224-PROVA-DEFLATOR.md, M-01). Nesses horizontes a curva descreve a agenda,
// não a projeção da tela. Quem consome estas bandas é responsável por dizer
// isso — `CashGapTable` diz.
//
// ⚠️ Custo: a RPC par a par reconstrói o histórico inteiro e chama o deflator
// uma vez por corte. É a consulta mais cara desta fase. Por isso o cache é
// longo (30 min) e não há refetch ao focar a janela.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  construirCurva,
  bandaPorFaixa,
  bandaDoSaldo,
  AGREGACAO_DA_BANDA,
  type CurvaBacktestRow,
  type ErroBacktestRow,
  type PontoDaCurva,
  type BandaDaFaixa,
} from "@/lib/forecastErrorCurve";

/**
 * A janela do deflator de estorno, em dias. É o mesmo valor que o
 * `get_cashflow` aplica em produção desde o 224-05 (medido no Q3: CV real
 * 0,642, erro-padrão de 1,17 pp em 30 dias). Não é limiar de tolerância —
 * é o parâmetro da medição.
 */
export const DEFLATOR_SPAN_DIAS = 30;

/** Horizonte máximo que o backtest mede. */
export const HORIZONTE_MAXIMO = 15;

/**
 * O último horizonte em que a banda descreve a projeção da tela.
 *
 * De D+10 em diante a projeção passa a usar a média de 15 dias como piso, e o
 * backtest não modela o piso — a fronteira é medida, não escolhida
 * (224-CURVA.md C-02: a cobertura da agenda cai de 102,4% para 66,8% entre
 * D+9 e D+10; 224-PROVA-DEFLATOR R-01: o WAPE melhora com deflator em D+1..D+9
 * e piora em D+10..D+15, sem exceção nos dois lados).
 */
export const ULTIMO_HORIZONTE_COMPARAVEL = 9;

/** Página da leitura par a par. O PostgREST trunca aqui, em silêncio. */
const PAGINA = 1000;

export interface ForecastErrorCurveData {
  /** Curva de entradas: acumulada, variante corrigida (look-ahead des-aplicado). */
  curvaEntradas: PontoDaCurva[];
  /** Curva de saídas: acumulada. `corrigido` é NULL lá — não se aplica. */
  curvaSaidas: PontoDaCurva[];
  bandasEntradas: BandaDaFaixa[];
  bandasSaidas: BandaDaFaixa[];
  /** A banda do SALDO — entradas menos saídas, casadas par a par. É ela que a tabela usa. */
  bandasSaldo: BandaDaFaixa[];
  /** Quantas linhas par a par foram efetivamente lidas. Serve para conferir a paginação. */
  paresLidos: number;
}

/**
 * As RPCs da Fase 224 ainda não constam dos tipos gerados do Supabase.
 * Assinatura mínima do construtor de consulta, sem `any`: o suficiente para
 * filtrar e paginar.
 */
interface ConstrutorRpc extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(coluna: string, valor: unknown): ConstrutorRpc;
  range(de: number, ate: number): ConstrutorRpc;
}
type ChamadaRpc = (fn: string, args: Record<string, unknown>) => ConstrutorRpc;

const ARGS_BACKTEST = (orgId: string) => ({
  p_org_id: orgId,
  p_h_max: HORIZONTE_MAXIMO,
  p_deflator_span: DEFLATOR_SPAN_DIAS,
});

const VAZIO: ForecastErrorCurveData = {
  curvaEntradas: [],
  curvaSaidas: [],
  bandasEntradas: bandaPorFaixa([], { escopo: "entradas", corrigido: true }),
  bandasSaidas: bandaPorFaixa([], { escopo: "saidas", corrigido: null }),
  bandasSaldo: bandaDoSaldo([]),
  paresLidos: 0,
};

export function useForecastErrorCurve() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<ForecastErrorCurveData>({
    // A organização entra na chave: sem ela, o número de uma loja apareceria
    // na tela da outra ao trocar de conta (T-224-07-01).
    queryKey: ["forecast-error-curve", orgId, DEFLATOR_SPAN_DIAS, HORIZONTE_MAXIMO] as const,
    enabled: !!orgId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ForecastErrorCurveData> => {
      if (orgId == null) return VAZIO;

      // 🔴 `.bind(supabase)` NÃO é estilo: `supabase.rpc` é implementado como
      // `return this.rest.rpc(...)`, e atribuí-lo a uma variável desacopla o
      // método do objeto — em ESM strict o `this` vira undefined e a tela
      // mostra `Cannot read properties of undefined (reading 'rest')`.
      // Foi o defeito de 27/08/2026 (233-01). Há portão em
      // `src/hooks/__tests__/rpcBind.test.ts` que reprova o padrão sem bind.
      const chamar = supabase.rpc.bind(supabase) as unknown as ChamadaRpc;

      // ── 1/2 — a curva agregada: até 90 linhas, UMA requisição, sem laço.
      const curvaRes = await chamar("get_forecast_backtest_curve", ARGS_BACKTEST(orgId));
      if (curvaRes.error != null) throw new Error(curvaRes.error.message);
      const linhasCurva: CurvaBacktestRow[] = Array.isArray(curvaRes.data)
        ? (curvaRes.data as CurvaBacktestRow[])
        : [];

      // ── 2/2 — o backtest par a par: ~5.700 linhas, LAÇO OBRIGATÓRIO.
      // O filtro por agregação corta o transporte a um terço; ele NÃO
      // substitui a paginação — mesmo só o acumulado passa de 1000 linhas.
      const pares: ErroBacktestRow[] = [];
      for (let offset = 0; ; offset += PAGINA) {
        const { data, error } = await chamar("get_forecast_backtest_errors", ARGS_BACKTEST(orgId))
          .eq("agregacao", AGREGACAO_DA_BANDA)
          .range(offset, offset + PAGINA - 1);
        if (error != null) throw new Error(error.message);
        const pagina: ErroBacktestRow[] = Array.isArray(data) ? (data as ErroBacktestRow[]) : [];
        if (pagina.length === 0) break;
        pares.push(...pagina);
        if (pagina.length < PAGINA) break;
      }

      return {
        curvaEntradas: construirCurva(linhasCurva, {
          escopo: "entradas",
          agregacao: AGREGACAO_DA_BANDA,
          corrigido: true,
        }),
        // ⚠️ `corrigido: null` e não `true`: nas saídas a coluna vem NULL do
        // SQL, e filtrar por verdadeiro elide o escopo de saídas INTEIRO —
        // a tela reportaria que saídas não existem (224-CURVA.md, C-01).
        curvaSaidas: construirCurva(linhasCurva, {
          escopo: "saidas",
          agregacao: AGREGACAO_DA_BANDA,
          corrigido: null,
        }),
        bandasEntradas: bandaPorFaixa(pares, { escopo: "entradas", corrigido: true }),
        bandasSaidas: bandaPorFaixa(pares, { escopo: "saidas", corrigido: null }),
        bandasSaldo: bandaDoSaldo(pares),
        paresLidos: pares.length,
      };
    },
  });
}
