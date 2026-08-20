// ============================================================================
// useMLMarginWithAds — margem por anúncio, com publicidade na régua da fatura
//
// Fase 212: o campo `ads_spend` que sai daqui NÃO é mais o gasto do relatório
// de publicidade (`ml_ads_products_cache`) que a RPC devolve. É o total que o
// Mercado Livre cobrou na fatura (`ml_billing_daily`, PADS+BPAD) rateado entre
// os anúncios pela proporção do cache — a mesma régua da fase 211, aqui
// aplicada à carteira inteira do período (`ratearAdsDaCarteira`).
//
// Por que a troca: o cache subestima o gasto real (Pé Vermeio, 05/07 a 04/08:
// R$ 14.790,21 no cache contra R$ 9.474,36 cobrados — e por anúncio a
// diferença chega a inverter o sinal da decisão). As telas de RESULTADO
// (Produtos Vendidos, Catálogo de Anúncios, Margem) passam a ler o número que
// o ML cobrou; as telas de PERFORMANCE de campanha (Publicidade, ROAS, CTR,
// CPC) continuam no cache, porque a fatura não tem campanha (ADS-05).
//
// `lucro_pos_ads` e `lucro_pct_pos_ads` são recalculados aqui a partir do
// `lucro` da RPC (que é pré-ads e não muda) menos o ads rateado. A fórmula do
// MCO (`src/lib/mco.ts`) não muda — muda apenas quem preenche o campo `ads`.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { aggregateAdsBillingSpend } from "@/lib/adsBillingSpend";
import { ratearAdsDaCarteira, type RateioAnuncioSource } from "@/lib/adsRateio";
import { fetchAdsBillingRows } from "./useMLAdsBillingSpend";

export interface ProductMarginWithAds {
  item_id: string;
  titulo: string;
  sku: string | null;
  listing_type: string | null;
  receita: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  /** Lucro operacional (sem publicidade) */
  lucro: number;
  /** Margem operacional em %, null quando receita = 0 */
  lucro_pct: number | null;
  pedidos: number;
  unidades: number;
  has_cmv: boolean;
  ads_spend: number;
  ads_attributed_orders: number;
  /** Lucro após dedução do gasto de publicidade do produto */
  lucro_pos_ads: number;
  /** Margem pós-ads em %, null quando receita = 0 */
  lucro_pct_pos_ads: number | null;
  /** true quando há gasto de ads mas nenhum pedido atribuído */
  ads_no_sale: boolean;
  /** Marca do anúncio (MAX(o.marca) agregado); null quando ausente. */
  marca: string | null;

  // ── Segundo cenário: com DIFAL (Fase 222, 222-15-R2) ──────────────────────
  //
  // Os quatro números abaixo vêm PRONTOS da mesma RPC, das MESMAS expressões
  // que produziram os quatro de cima, trocando só o termo de imposto. O
  // navegador não faz aritmética de MCO aqui — se fizesse, o mesmo anúncio
  // teria duas réguas.
  //
  // 🔴 `null` quando a RPC ainda não devolve as colunas novas (janela entre
  // publicar o frontend e aplicar a migration). Ausência preservada como
  // ausência: a tela mostra o primeiro cenário e diz que o segundo não
  // carregou, em vez de exibir zero.
  /** Efeito líquido do DIFAL do anúncio no período (R$); null = não apurado. */
  difal_efeito: number | null;
  /** Pedidos do anúncio com destino interestadual e sem DIFAL calculado. */
  pedidos_difal_indefinido: number;
  /** Lucro operacional COM DIFAL (pré-ads); null quando não apurado. */
  lucro_com_difal: number | null;
  /** Margem operacional COM DIFAL em %; null sem receita ou sem apuração. */
  lucro_pct_com_difal: number | null;
  /** Lucro COM DIFAL após a publicidade rateada da fatura. */
  lucro_pos_ads_com_difal: number | null;
  /** Margem pós-ads COM DIFAL em %; null sem receita ou sem apuração. */
  lucro_pct_pos_ads_com_difal: number | null;

  // ── Terceiro cenário: SEM REBATE (Fase 223, 223-05) ───────────────────────
  //
  // O rebate do ML abate a comissão (não é receita extra): `orders.comissao`
  // já vem líquida dele. Este par mostra o que o lucro seria com a tarifa
  // CHEIA — a mesma expressão de `lucro`, trocando só o termo de rebate.
  //
  // 🔴 `null` distingue "não apurado" de "apurado como zero", igual ao par
  // DIFAL: coluna ausente (migration ainda não aplicada), rebate não
  // afirmável em nenhum pedido do período (todos sem captura, não
  // conferidos ou com estorno) e "sem campanha no período" (rebate medido
  // como zero) são três coisas diferentes — as duas contagens abaixo
  // distinguem as duas primeiras, e `rebate_efeito` distingue a terceira.
  /** Soma do rebate afirmável do anúncio, TOTAL em R$ (conferência, não é o que a margem usa); null = nada afirmável. */
  rebate_bruto: number | null;
  /** Soma do efeito líquido do rebate (rebate_efeito_liquido), TOTAL em R$; null = nada afirmável. */
  rebate_efeito: number | null;
  /** Pedidos do anúncio ainda não consultados (sem captura ou captura não final). */
  pedidos_sem_captura_rebate: number;
  /** Pedidos capturados mas não afirmáveis (conferência não fecha ou estorno) — erro nosso. */
  pedidos_rebate_nao_conferido: number;
  /** Lucro operacional na tarifa CHEIA (pré-ads); null quando não apurado. */
  lucro_sem_rebate: number | null;
  /** Margem na tarifa CHEIA em %; null sem receita ou sem apuração. */
  lucro_pct_sem_rebate: number | null;
  /** Lucro na tarifa CHEIA após a publicidade rateada da fatura. */
  lucro_pos_ads_sem_rebate: number | null;
  /** Margem pós-ads na tarifa CHEIA em %; null sem receita ou sem apuração. */
  lucro_pct_pos_ads_sem_rebate: number | null;
}

/**
 * De onde veio a publicidade das linhas, e quanto da fatura ficou sem dono.
 * A tela é obrigada a dizer isso: a troca de régua nunca acontece escondida.
 */
export interface AdsCarteiraMeta {
  /** `billing-rateio` = fatura do ML rateada; `cache` = relatório de publicidade. */
  source: RateioAnuncioSource;
  /** Total de publicidade da fatura no período (0 no ramo de cache). */
  totalFatura: number;
  /** Parte da fatura que nenhum anúncio pôde receber (período sem chave). */
  naoRateado: number;
}

export interface MarginWithAdsResult {
  rows: ProductMarginWithAds[];
  ads: AdsCarteiraMeta;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const SEM_ADS: AdsCarteiraMeta = { source: "cache", totalFatura: 0, naoRateado: 0 };

export function useMLMarginWithAds(dateFrom: string, dateTo: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();

  return useQuery<MarginWithAdsResult>({
    queryKey: ["ml_margin_with_ads", currentOrg?.id, resolvedMLUserIds, dateFrom, dateTo] as const,
    queryFn: async (): Promise<MarginWithAdsResult> => {
      if (!currentOrg?.id || !resolvedMLUserIds.length) return { rows: [], ads: SEM_ADS };

      const from = dateFrom.substring(0, 10);
      const to = dateTo.substring(0, 10);

      // A fatura e a margem são lidas em paralelo — a fatura usa EXATAMENTE a
      // mesma leitura da fase 210/211 (`fetchAdsBillingRows`), nunca uma cópia.
      const [margem, faturaRows] = await Promise.all([
        supabase.rpc("get_margin_with_ads_by_product", {
          p_org_id:   currentOrg.id,
          p_user_ids: resolvedMLUserIds,
          p_from:     from,
          p_to:       to,
        }),
        fetchAdsBillingRows(currentOrg.id, resolvedMLUserIds, from, to),
      ]);

      const { data, error } = margem;
      if (error) throw error;

      const brutas: ProductMarginWithAds[] = (data ?? []).map((r: Record<string, unknown>) => ({
        item_id:               String(r.item_id),
        titulo:                String(r.titulo ?? ""),
        sku:                   r.sku ? String(r.sku) : null,
        listing_type:          r.listing_type ? String(r.listing_type) : null,
        receita:               Number(r.receita),
        cmv:                   Number(r.cmv),
        comissao:              Number(r.comissao),
        frete:                 Number(r.frete),
        impostos:              Number(r.impostos),
        lucro:                 Number(r.lucro),
        lucro_pct:             r.lucro_pct != null ? Number(r.lucro_pct) : null,
        pedidos:               Number(r.pedidos),
        unidades:              Number(r.unidades),
        has_cmv:               Boolean(r.has_cmv),
        ads_spend:             Number(r.ads_spend),
        ads_attributed_orders: Number(r.ads_attributed_orders),
        lucro_pos_ads:         Number(r.lucro_pos_ads),
        lucro_pct_pos_ads:     r.lucro_pct_pos_ads != null ? Number(r.lucro_pct_pos_ads) : null,
        ads_no_sale:           Boolean(r.ads_no_sale),
        marca:                 r.marca ? String(r.marca) : null,
        // Mesma conversão numérica explícita dos demais campos (`numeric` do
        // Postgres chega como string via PostgREST). `!= null` distingue
        // "coluna ausente / não apurado" de "apurado como zero" — zero é um
        // resultado legítimo do DIFAL e não pode virar ausência.
        difal_efeito:                r.difal_efeito != null ? Number(r.difal_efeito) : null,
        pedidos_difal_indefinido:    Number(r.pedidos_difal_indefinido ?? 0),
        lucro_com_difal:             r.lucro_com_difal != null ? Number(r.lucro_com_difal) : null,
        lucro_pct_com_difal:         r.lucro_pct_com_difal != null ? Number(r.lucro_pct_com_difal) : null,
        lucro_pos_ads_com_difal:     r.lucro_pos_ads_com_difal != null ? Number(r.lucro_pos_ads_com_difal) : null,
        lucro_pct_pos_ads_com_difal: r.lucro_pct_pos_ads_com_difal != null ? Number(r.lucro_pct_pos_ads_com_difal) : null,
        // Mesma comparação com nulo dos campos de DIFAL: distingue "coluna
        // ausente / nada afirmável" de "apurado como zero". As duas
        // contagens são inteiros e nunca ficam ausentes — zero pedido sem
        // captura é um resultado legítimo, não uma lacuna de coluna.
        rebate_bruto:                 r.rebate_bruto != null ? Number(r.rebate_bruto) : null,
        rebate_efeito:                r.rebate_efeito != null ? Number(r.rebate_efeito) : null,
        pedidos_sem_captura_rebate:   Number(r.pedidos_sem_captura_rebate ?? 0),
        pedidos_rebate_nao_conferido: Number(r.pedidos_rebate_nao_conferido ?? 0),
        lucro_sem_rebate:             r.lucro_sem_rebate != null ? Number(r.lucro_sem_rebate) : null,
        lucro_pct_sem_rebate:         r.lucro_pct_sem_rebate != null ? Number(r.lucro_pct_sem_rebate) : null,
        lucro_pos_ads_sem_rebate:     r.lucro_pos_ads_sem_rebate != null ? Number(r.lucro_pos_ads_sem_rebate) : null,
        lucro_pct_pos_ads_sem_rebate: r.lucro_pct_pos_ads_sem_rebate != null ? Number(r.lucro_pct_pos_ads_sem_rebate) : null,
      }));

      // O denominador do rateio é a carteira INTEIRA do período — inclusive os
      // anúncios que só tiveram gasto e nenhuma venda. Filtrar antes (como a
      // tela Produtos Vendidos faz depois) inflaria a fatia de quem vendeu.
      const rateio = ratearAdsDaCarteira(
        aggregateAdsBillingSpend(faturaRows),
        brutas.map((r) => ({ itemId: r.item_id, cacheSpend: r.ads_spend })),
      );

      const rows = brutas.map((r) => {
        const ads = rateio.porItem.get(r.item_id) ?? 0;
        const lucroPosAds = r.lucro - ads;
        // [222-15-R2] O pós-ads do SEGUNDO cenário é recalculado exatamente
        // como o do primeiro — o mesmo `ads` rateado da fatura, subtraído do
        // lucro pré-ads correspondente. Ausente continua ausente: sem
        // `lucro_com_difal` não há pós-ads com DIFAL a inventar.
        const lucroPosAdsComDifal =
          r.lucro_com_difal != null ? r.lucro_com_difal - ads : null;
        // [223-05] O pós-ads do TERCEIRO cenário (sem rebate) segue o mesmo
        // molde: o mesmo `ads` rateado da fatura, subtraído do lucro pré-ads
        // correspondente. Ausente continua ausente — sem `lucro_sem_rebate`
        // não há pós-ads sem rebate a inventar.
        const lucroPosAdsSemRebate =
          r.lucro_sem_rebate != null ? r.lucro_sem_rebate - ads : null;
        return {
          ...r,
          ads_spend:         ads,
          lucro_pos_ads:     lucroPosAds,
          lucro_pct_pos_ads: r.receita > 0 ? round2((lucroPosAds / r.receita) * 100) : null,
          ads_no_sale:       ads > 0 && r.ads_attributed_orders === 0,
          lucro_pos_ads_com_difal: lucroPosAdsComDifal,
          lucro_pct_pos_ads_com_difal:
            lucroPosAdsComDifal != null && r.receita > 0
              ? round2((lucroPosAdsComDifal / r.receita) * 100)
              : null,
          lucro_pos_ads_sem_rebate: lucroPosAdsSemRebate,
          lucro_pct_pos_ads_sem_rebate:
            lucroPosAdsSemRebate != null && r.receita > 0
              ? round2((lucroPosAdsSemRebate / r.receita) * 100)
              : null,
        };
      });

      return {
        rows,
        ads: {
          source: rateio.source,
          totalFatura: rateio.totalFatura,
          naoRateado: rateio.naoRateado,
        },
      };
    },
    enabled: !!currentOrg?.id && resolvedMLUserIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}
