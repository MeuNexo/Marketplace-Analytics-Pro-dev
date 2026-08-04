/**
 * Utilitário puro de agregação pós-ads (MCO) por marca/categoria e por anúncio.
 *
 * Zero dependências de React, Supabase ou rede — 100% testável isoladamente.
 *
 * Fonte dos dados: linhas de `get_margin_with_ads_by_product` (via useMLMarginWithAds),
 * já pós-ads (`lucro_pos_ads` / `lucro_pct_pos_ads`) e com `marca` (Phase 83-01 migration).
 * MCO principal = COM ads, decisão travada (Phase 83 CONTEXT, item "MCO exibido").
 *
 * mcoPct do GRUPO = Σlucro_pos_ads ÷ Σreceita × 100 (pós-ads agregado, decisão LOCKED #6:
 * consistente com o painel direito) — NUNCA a média simples dos mcoPct dos itens.
 *
 * Reusa o mesmo padrão de chave/grupo de soldProductsAgg.ts (marca=row.marca??"";
 * categoria=itemsMap.get(item_id)?.category_id??""; name "Sem marca"/"Sem categoria"
 * quando a chave é vazia).
 *
 * Dados ausentes: NUNCA inventar número quando o custo (has_cmv=false) estiver
 * ausente — health vira 'indefinido' (não zerado). hasMissingCost sinaliza ao
 * grupo que o MCO% agregado inclui anúncios sem custo, para a UI exibir um aviso.
 *
 * Phase: 83-produtos-vendidos-mco-redesign / Plan 01
 *
 * ── Fase 213, Plano 06 ──────────────────────────────────────────────────────
 * O item ganhou três campos de decisão, sem que nada do que a fase 83 travou
 * mudasse:
 *
 *  1. MCO PRÉ-ADS (R$ e %). As duas margens juntas são legítimas e respondem
 *     perguntas diferentes: a pré-ads diz se o PRODUTO é bom, a pós-ads diz se
 *     ele é bom depois do que se gastou para vendê-lo. Vem do `lucro` /
 *     `lucro_pct` da RPC, que são pré-ads por definição e NÃO mudaram com o
 *     rateio da fatura (fase 212 só reescreve `ads_spend` e o pós-ads).
 *
 *  2. BREAKEVEN DE ACOS = a margem operacional pré-ads em percentual. É a mesma
 *     régua do CR-02 já adotada em `/publicidade` (`useMLAdsDerivedMetrics`):
 *     "quanto de margem sobra antes da publicidade" É a definição de breakeven
 *     de ACoS. Não recalculado a partir de preço e CMV — seria uma segunda
 *     implementação do número que o CR-02 acabou de unificar.
 *
 *     Sem CMV o `lucro_pct` da RPC sai inflado (o custo entra como zero); usá-lo
 *     trocaria um número errado por outro, então o pré-ads e o breakeven ficam
 *     INDEFINIDOS — nunca zero. Mesma disciplina do `health`.
 *
 *  3. CURVA ABC do período, vinda do módulo puro `@/lib/curvaAbc` (Plano 04).
 *     A curva é da CARTEIRA INTEIRA, calculada antes de filtrar por grupo: a
 *     posição de um anúncio na concentração de receita da operação não pode
 *     mudar porque o operador trocou o agrupamento de marca para categoria. Se
 *     fosse calculada dentro do grupo, cada marca teria a própria Curva A e a
 *     coluna perderia o sentido.
 */

import { classifyMcoHealth, type McoHealth } from "@/lib/mcoHealth";
import { classificarCurvaAbc, type CurvaAbc } from "@/lib/curvaAbc";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Linha de margem pós-ads por anúncio, vinda de `get_margin_with_ads_by_product`
 * (ProductMarginWithAds em useMLMarginWithAds.ts, após a migration 83-01 que
 * adiciona `marca`). Contém os campos de custo necessários para a quebra de
 * tooltip (cmv/comissao/frete/impostos) — fonte única, sem recálculo na UI.
 */
export interface McoProductRow {
  item_id: string;
  titulo: string | null;
  marca: string | null;
  receita: number;
  unidades: number;
  cmv: number;
  comissao: number;
  frete: number;
  impostos: number;
  ads_spend: number;
  /** Lucro operacional PRÉ-ads (R$) — o `lucro` da RPC, intocado pelo rateio. */
  lucro: number;
  /** Margem operacional PRÉ-ads (%); null quando a receita do período é zero. */
  lucro_pct: number | null;
  lucro_pos_ads: number;
  lucro_pct_pos_ads: number | null;
  has_cmv: boolean;
}

/** Um grupo de vendas por marca ou categoria, com saúde de MCO agregada. */
export interface PvMcoGroup {
  /** Valor da chave (marca ou category_id). String vazia = "sem grupo". */
  key: string;
  /** Rótulo legível para exibição ("Sem marca", "Sem categoria" quando key=""). */
  name: string;
  /** Soma de receita no grupo (R$). */
  revenue: number;
  /** Total de unidades vendidas no grupo. */
  qty: number;
  /** MCO% pós-ads agregado = Σlucro_pos_ads÷Σreceita×100; null quando Σreceita=0. */
  mcoPct: number | null;
  /** Nº de anúncios do grupo cuja saúde é 'vermelho'. */
  redCount: number;
  /** true quando algum anúncio do grupo tem has_cmv=false (custo ausente). */
  hasMissingCost: boolean;
}

/**
 * Um anúncio dentro do grupo selecionado, com MCO/ACoS/saúde e os campos de
 * tooltip (quebra de custos — fonte única para o 83-03, sem recálculo na UI).
 */
export interface PvMcoItem {
  item_id: string;
  /** Título preferindo itemsMap.title, fallback row.titulo, fallback item_id. */
  title: string;
  /** Total de unidades vendidas. */
  qty: number;
  /** Soma de receita (R$). */
  revenue: number;
  /** MCO em R$ pós-ads (= lucro_pos_ads). */
  mcoReais: number;
  /** MCO% pós-ads (= lucro_pct_pos_ads); null quando receita=0. */
  mcoPct: number | null;
  /** MCO em R$ PRÉ-ads (= lucro); null quando não há custo cadastrado. */
  mcoPreAdsReais: number | null;
  /** MCO% PRÉ-ads (= lucro_pct); null sem custo cadastrado ou sem receita. */
  mcoPreAdsPct: number | null;
  /**
   * Breakeven de ACoS (%) — a margem de contribuição pré-ads. Acima dela, a
   * publicidade daquele anúncio come toda a margem. Null sem custo ou sem
   * receita: nunca zero (CR-02).
   */
  breakevenAcosPct: number | null;
  /** Curva ABC do anúncio na receita do período da CARTEIRA INTEIRA (CR-06). */
  curva: CurvaAbc;
  /** % Ads (ACoS) = ads_spend÷receita×100; null quando receita=0. */
  acosPct: number | null;
  /** Se o anúncio tem custo (custo_unit) conhecido no período. */
  hasCmv: boolean;
  /** Saúde do MCO% (semáforo); 'indefinido' quando hasCmv=false. */
  health: McoHealth;
  /** Participação na receita do grupo: revenue / Σreceita do grupo (0–1). */
  shareOfGroup: number;
  /** CMV do anúncio (R$) — quebra de custos do tooltip. */
  cmv: number;
  /** Comissão ML do anúncio (R$) — quebra de custos do tooltip. */
  comissao: number;
  /** Frete do anúncio (R$) — quebra de custos do tooltip. */
  frete: number;
  /** Impostos do anúncio (R$) — quebra de custos do tooltip. */
  impostos: number;
  /** Gasto de ads do anúncio (R$) — quebra de custos do tooltip. */
  adsSpend: number;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Chave de agrupamento de um row, dado o modo de visualização. */
function groupKey(
  row: McoProductRow,
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): string {
  return pvView === "marca" ? (row.marca ?? "") : (itemsMap.get(row.item_id)?.category_id ?? "");
}

/** Saúde do anúncio: 'indefinido' quando has_cmv=false (custo ausente — nunca zerar/inventar). */
function itemHealth(row: McoProductRow): McoHealth {
  return row.has_cmv ? classifyMcoHealth(row.lucro_pct_pos_ads) : "indefinido";
}

/** Duas casas — o mesmo arredondamento do breakeven de `/publicidade` (CR-02). */
const round2 = (v: number) => Math.round(v * 100) / 100;

// ─── Curva ABC da carteira ────────────────────────────────────────────────────

/**
 * Classifica a CARTEIRA INTEIRA em curvas A/B/C pela receita do período e
 * devolve o mapa `item_id → curva`.
 *
 * O conjunto recebido é o mesmo que alimenta a tela ANTES de qualquer filtro de
 * grupo. Produzido uma vez e anexado ao item na montagem: a curva de um anúncio
 * é a posição dele na concentração de receita da operação, não do agrupamento
 * escolhido na hora.
 *
 * Os cortes de 80% e 95% NÃO são reimplementados aqui — vêm de
 * `classificarCurvaAbc` (Plano 04), que é a única fonte deles.
 */
export function curvasDaCarteira(rows: readonly McoProductRow[]): Map<string, CurvaAbc> {
  const { itens } = classificarCurvaAbc(
    rows.map((r) => ({ id: r.item_id, receita: r.receita })),
  );
  return new Map(itens.map((i) => [i.id, i.curva]));
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Agrupa linhas de margem pós-ads por marca ou category_id (cross-ref via itemsMap).
 * Retorna lista ordenada por revenue desc.
 *
 * @param rows      - Linhas de `get_margin_with_ads_by_product`
 * @param pvView    - "marca" | "categoria"
 * @param itemsMap  - Map<item_id, { category_id?, title?, thumbnail? }> (de useMLInventory)
 */
export function aggregateMcoGroups(
  rows: McoProductRow[],
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvMcoGroup[] {
  const map = new Map<
    string,
    { revenue: number; qty: number; lucroPosAdsSum: number; redCount: number; hasMissingCost: boolean }
  >();

  for (const row of rows) {
    const key = groupKey(row, pvView, itemsMap);
    const prev = map.get(key) ?? { revenue: 0, qty: 0, lucroPosAdsSum: 0, redCount: 0, hasMissingCost: false };

    const health = itemHealth(row);

    map.set(key, {
      revenue: prev.revenue + row.receita,
      qty: prev.qty + row.unidades,
      lucroPosAdsSum: prev.lucroPosAdsSum + row.lucro_pos_ads,
      redCount: prev.redCount + (health === "vermelho" ? 1 : 0),
      hasMissingCost: prev.hasMissingCost || !row.has_cmv,
    });
  }

  return Array.from(map.entries())
    .map(([key, d]) => ({
      key,
      name: key || (pvView === "marca" ? "Sem marca" : "Sem categoria"),
      revenue: d.revenue,
      qty: d.qty,
      mcoPct: d.revenue > 0 ? (d.lucroPosAdsSum / d.revenue) * 100 : null,
      redCount: d.redCount,
      hasMissingCost: d.hasMissingCost,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Retorna os anúncios (itens) do grupo selecionado, com MCO/ACoS/saúde e a
 * quebra de custos do tooltip. Ordena por revenue desc.
 *
 * @param rows       - Todas as linhas de `get_margin_with_ads_by_product`
 * @param pvSelected - Chave do grupo selecionado (marca ou category_id; "" para "sem grupo")
 * @param pvView     - "marca" | "categoria"
 * @param itemsMap   - Map<item_id, { category_id?, title?, thumbnail? }> (de useMLInventory)
 */
export function aggregateMcoItems(
  rows: McoProductRow[],
  pvSelected: string,
  pvView: "marca" | "categoria",
  itemsMap: Map<string, { category_id?: string | null; title?: string; thumbnail?: string }>,
): PvMcoItem[] {
  // A curva sai da carteira INTEIRA — antes do filtro de grupo, de propósito.
  const curvas = curvasDaCarteira(rows);

  const filtered = rows.filter((r) => groupKey(r, pvView, itemsMap) === pvSelected);

  const totalRevenue = filtered.reduce((s, r) => s + r.receita, 0);

  return filtered
    .map((row) => {
      const title = itemsMap.get(row.item_id)?.title ?? row.titulo ?? row.item_id;

      // Sem CMV, o pré-ads da RPC está inflado (custo = zero): indefinido, não
      // zero. Sem receita no período, o percentual já vem null da própria RPC.
      const preAdsPct = row.has_cmv && row.lucro_pct != null ? row.lucro_pct : null;

      return {
        item_id: row.item_id,
        title,
        qty: row.unidades,
        revenue: row.receita,
        mcoReais: row.lucro_pos_ads,
        mcoPct: row.lucro_pct_pos_ads,
        mcoPreAdsReais: row.has_cmv ? row.lucro : null,
        mcoPreAdsPct: preAdsPct,
        breakevenAcosPct: preAdsPct != null ? round2(preAdsPct) : null,
        curva: curvas.get(row.item_id) ?? "C",
        acosPct: row.receita > 0 ? (row.ads_spend / row.receita) * 100 : null,
        hasCmv: row.has_cmv,
        health: itemHealth(row),
        shareOfGroup: totalRevenue > 0 ? row.receita / totalRevenue : 0,
        cmv: row.cmv,
        comissao: row.comissao,
        frete: row.frete,
        impostos: row.impostos,
        adsSpend: row.ads_spend,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
