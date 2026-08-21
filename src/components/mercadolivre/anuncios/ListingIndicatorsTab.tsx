import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { McoDoisCenarios } from "@/components/mercadolivre/McoDoisCenarios";
import { cenariosMargemReal } from "@/lib/mcoLinhaCenarios";
import { RebateDoisCenarios } from "@/components/mercadolivre/RebateDoisCenarios";
import { cenariosRebateMargemReal } from "@/lib/rebateLinhaCenarios";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import type { ProductMarginWithAds } from "@/hooks/useMLMarginWithAds";
import type { PrecoSeriesRow } from "@/lib/precoMcoSeries";
import { currencyFmt } from "./listingHelpers";
import { aggregateLogisticType, logisticTypeLabel } from "./listingIndicators";
import { ListingQualityScore } from "./ListingQualityScore";
import { useMLListingHealth } from "./useMLListingHealth";
import { ListingIssues } from "./ListingIssues";
// [Quick 260821-nof, D-selo-03/04] O modal é o DETALHE — o par completo
// (McoDoisCenarios/RebateDoisCenarios) continua valendo aqui, mas a margem
// real deixa de ser repetida em cada um dos dois (era o defeito que abriu
// este plano: o mesmo número aparecia duas vezes). `SeloPromo` e a data de
// início vêm de UMA série diária, sob demanda, do MESMO anúncio.
import { SeloPromo } from "@/components/mercadolivre/SeloPromo";
import {
  estadoAtualDaSerie,
  inicioPromocaoVigente,
  janelaEstadoAtual,
  resolveSeloPromo,
  type PontoSerieRebate,
} from "@/lib/seloPromo";

interface ListingIndicatorsTabProps {
  item: ProductItem;
  margin?: ProductMarginWithAds | null;
}

// ─── [Quick 260821-nof] Série diária sob demanda, para o selo e a data ─────────
//
// Janela FIXA de 60 dias terminando hoje — a mesma disciplina de
// `useMLListingHealth` nesta própria aba: busca sob demanda, sem depender do
// período selecionado na lista que abriu o modal (o modal não recebe essa
// data como propriedade). É insumo suficiente para `JANELA_ESTADO_ATUAL_DIAS`
// (7 dias) e para a faixa vigente ter margem de sobra antes de truncar.
const JANELA_SERIE_DIARIA_DIAS = 60;

/** Nomes EXATOS da RPC `orders_price_timeseries` — conferidos contra `precoMcoSeries.ts`. */
function mapRowsOrdersPriceTimeseries(data: unknown): PrecoSeriesRow[] {
  return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    bucket: String(r.bucket),
    qtd: Number(r.qtd ?? 0),
    total: Number(r.total ?? 0),
    cmv: Number(r.cmv ?? 0),
    comissao: Number(r.comissao ?? 0),
    frete: Number(r.frete ?? 0),
    qtd_sem_custo: Number(r.qtd_sem_custo ?? 0),
    impostos: Number(r.impostos ?? 0),
    qtd_sem_imposto: Number(r.qtd_sem_imposto ?? 0),
    rebate_bruto: r.rebate_bruto != null ? Number(r.rebate_bruto) : null,
    rebate_efeito: r.rebate_efeito != null ? Number(r.rebate_efeito) : null,
    pedidos_sem_captura_rebate: Number(r.pedidos_sem_captura_rebate ?? 0),
    pedidos_rebate_nao_conferido: Number(r.pedidos_rebate_nao_conferido ?? 0),
  }));
}

/** `PrecoSeriesRow` (nomes da RPC) → `PontoSerieRebate` (nomes que `seloPromo.ts` consome). */
function paraPontoSerieRebate(rows: PrecoSeriesRow[]): PontoSerieRebate[] {
  return rows.map((r) => ({
    bucket: r.bucket,
    qtd: r.qtd,
    comissao: r.comissao,
    rebateBruto: r.rebate_bruto ?? null,
    pedidosSemCaptura: r.pedidos_sem_captura_rebate ?? null,
    pedidosNaoConferidos: r.pedidos_rebate_nao_conferido ?? null,
  }));
}

/**
 * Hook local — busca sob demanda a série diária de UM anúncio, para o selo
 * do estado atual e a data de início da promoção vigente. `null` enquanto a
 * série não chegou (nunca um estado provisório derivado da linha agregada,
 * que seria a média disfarçada de atual — D-selo-04).
 */
function useSerieDiariaDoAnuncio(
  itemId: string | undefined,
  mlUserId: string | undefined,
  ativo: boolean,
): { serie: PrecoSeriesRow[] | null; janela: { from: string; to: string } } {
  const [serie, setSerie] = useState<PrecoSeriesRow[] | null>(null);
  // A MESMA janela alimenta a busca e o recorte do selo — nunca duas contas
  // de data que possam divergir por um milissegundo entre render e fetch.
  const [janela] = useState(() => ({
    to: format(new Date(), "yyyy-MM-dd"),
    from: format(subDays(new Date(), JANELA_SERIE_DIARIA_DIAS - 1), "yyyy-MM-dd"),
  }));

  useEffect(() => {
    if (!itemId || !ativo) {
      setSerie(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const res = await (supabase.rpc as any)("orders_price_timeseries", {
        _item_id: itemId,
        _ml_user_ids: mlUserId ? [mlUserId] : null,
        _from: janela.from,
        _to: janela.to,
        _granularity: "day",
        _sku: null,
      });
      if (cancelled) return;
      if (res.error) {
        console.warn("orders_price_timeseries (ListingIndicatorsTab):", res.error.message);
        setSerie([]);
        return;
      }
      setSerie(mapRowsOrdersPriceTimeseries(res.data));
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId, mlUserId, ativo, janela.from, janela.to]);

  return { serie, janela };
}

/** A média do período — reusa `resolveSeloPromo`, não uma segunda conta. */
function pctMedioPeriodoRebate(margin: ProductMarginWithAds | null | undefined): number | null {
  if (!margin) return null;
  return resolveSeloPromo({
    comissao: margin.comissao,
    rebateBruto: margin.rebate_bruto,
    pedidosSemCaptura: margin.pedidos_sem_captura_rebate,
    pedidosNaoConferidos: margin.pedidos_rebate_nao_conferido,
    semVendaNaJanela: false,
  }).pct;
}

const formatarDataBR = (iso: string): string => format(parseISO(iso), "dd/MM/yy");

// ─── helpers internos ─────────────────────────────────────────────────────────

function KpiItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":  return "Ativo";
    case "paused":  return "Pausado";
    case "closed":  return "Encerrado";
    default:        return status;
  }
}

// ─── componente principal ─────────────────────────────────────────────────────

/**
 * Conteúdo da aba "Indicadores" do modal de detalhe.
 * Layout: grid md:grid-cols-5 (esq=2 colunas, dir=3 colunas).
 *
 * Não faz fetch nem chama hooks de margem — margem chega por prop.
 */
export function ListingIndicatorsTab({ item, margin }: ListingIndicatorsTabProps) {
  const logisticBuckets = aggregateLogisticType(item);

  // Fetch on-demand de saúde do anúncio (lazy — invocado só quando o modal está aberto)
  // Guard: se item._ml_user_id for undefined → status='idle' (sem erro, seção não aparece)
  const { status: healthStatus, data: healthData } = useMLListingHealth(item);

  // [Quick 260821-nof, D-selo-04] A série só é buscada quando há margem
  // apurada de verdade — margem ausente (sem vendas no período) não
  // consulta série nenhuma: nunca inventar um estado a partir de nada.
  const margemTemPct = margin != null && (margin.lucro_pct_pos_ads != null || margin.lucro_pct != null);
  const { serie: serieDiaria, janela: janelaSerie } = useSerieDiariaDoAnuncio(
    item.id,
    item._ml_user_id,
    margemTemPct,
  );

  // ─── Coluna esquerda ────────────────────────────────────────────────────────

  const leftCol = (
    <div className="flex flex-col gap-4">
      {/* Imagem do produto */}
      <div className="flex justify-center">
        {item.thumbnail ? (
          <img
            src={item.thumbnail.replace("http://", "https://")}
            alt={item.title}
            className="w-32 h-32 rounded-lg object-cover border border-border/50"
            loading="lazy"
          />
        ) : (
          <div className="w-32 h-32 rounded-lg bg-muted flex items-center justify-center border border-border/50">
            <Package className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Variações */}
      {item.variations.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Variações ({item.variations.length})
            </p>
            <div className="space-y-2">
              {item.variations.map((v) => {
                const attrLabel = v.attribute_combinations.length > 0
                  ? v.attribute_combinations.map((a) => `${a.name}: ${a.value}`).join(" · ")
                  : `Var. ${v.variation_id}`;
                return (
                  <div key={v.variation_id} className="text-xs space-y-0.5">
                    <p className="font-medium leading-tight">{attrLabel}</p>
                    <p className="text-muted-foreground">
                      Estoque: <span className="font-mono">{v.available_quantity}</span>
                      {" · "}Vendido: <span className="font-mono">{v.sold_quantity}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Breakdown logístico */}
      <Card>
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Logística
          </p>
          <div className="space-y-1.5">
            {logisticBuckets.map((bucket) => (
              <div key={bucket.type} className="flex items-center justify-between text-xs">
                <span className="text-foreground/80">{logisticTypeLabel(bucket.type)}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">
                  {bucket.stock} un.
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ─── Coluna direita ─────────────────────────────────────────────────────────

  // Margem: usa lucro_pct_pos_ads quando disponível, senão lucro_pct
  //
  // 🔴 [21/08/2026, D-selo-03] REESCRITO: a margem real aparecia DUAS vezes
  // (primeiro cenário de `McoDoisCenarios` E primeiro cenário de
  // `RebateDoisCenarios`, o mesmo número) — era o defeito que abriu este
  // plano. Agora ela renderiza UMA vez, fora dos dois componentes, e os dois
  // recebem `omitirCenarioReal` para pular o cenário que já apareceu.
  const marginDisplay = (): React.ReactNode => {
    if (!margin) return <span className="text-muted-foreground">—</span>;
    const posAds = margin.lucro_pct_pos_ads != null;
    const pct = margin.lucro_pct_pos_ads ?? margin.lucro_pct;
    if (pct === null) return <span className="text-muted-foreground text-xs">Sem vendas no período</span>;

    const valorReal = posAds ? margin.lucro_pos_ads : margin.lucro;
    const role = pct >= 0 ? "good" : "critical";
    const mediaPeriodoPct = pctMedioPeriodoRebate(margin);

    // Enquanto a série não chega, nenhum dos dois (selo/data) aparece — nunca
    // um estado provisório derivado da linha agregada, que seria a média
    // disfarçada de atual (D-selo-04, o único jeito de este plano falhar por
    // dentro parecendo que funcionou).
    const pontos = serieDiaria ? paraPontoSerieRebate(serieDiaria) : null;
    const selo = pontos ? estadoAtualDaSerie(pontos, janelaSerie, mediaPeriodoPct) : null;
    const inicioPromo = pontos ? inicioPromocaoVigente(pontos) : null;

    return (
      <span className="inline-flex flex-col items-end gap-1">
        {/* A margem REAL — rotulada, colorida pelo semáforo, UMA vez. */}
        <span className="inline-flex items-baseline gap-1">
          <span className={`font-semibold tabular-nums text-sm ${role === "good" ? "text-success" : "text-destructive"}`}>
            {currencyFmt(valorReal)} ({pct.toFixed(1)}%)
          </span>
          <span className="text-[10px] text-muted-foreground">margem real</span>
        </span>

        {selo && <SeloPromo selo={selo} densidade="celula" />}

        {/* [223-06]/[222-15-R2] Os dois cenários HIPOTÉTICOS, cada um com
            rótulo em português de negócio, sem repetir o real. */}
        <McoDoisCenarios
          cenarios={cenariosMargemReal(margin, posAds ? "posAds" : "preAds")}
          densidade="celula"
          role={role}
          omitirCenarioReal
          rotuloComDifal="cenário com DIFAL recolhido"
        />
        <RebateDoisCenarios
          cenarios={cenariosRebateMargemReal(margin, posAds ? "posAds" : "preAds")}
          densidade="celula"
          role={role}
          omitirCenarioReal
          rotuloSemRebate="cenário sem a promoção (tarifa cheia)"
        />

        {inicioPromo?.data && (
          <span className="text-[10px] text-muted-foreground">
            {inicioPromo.truncada
              ? `Promoção ativa desde pelo menos ${formatarDataBR(inicioPromo.data)}`
              : `Promoção ativa desde ${formatarDataBR(inicioPromo.data)}`}
          </span>
        )}

        {mediaPeriodoPct != null && (
          <span className="text-[10px] text-muted-foreground">
            Média do período: {mediaPeriodoPct.toFixed(1)}%
          </span>
        )}
      </span>
    );
  };

  const rightCol = (
    <div className="flex flex-col gap-4">
      {/* Scoreboard de qualidade — intocado (item.health do cache, Phase 71) */}
      <ListingQualityScore health={item.health} />

      {/* Problemas acionáveis ao vivo (Phase 72) — isolado abaixo do quality score */}
      <ListingIssues status={healthStatus} issues={healthData?.issues ?? []} />

      {/* KPIs */}
      <Card>
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            KPIs
          </p>
          <div className="grid grid-cols-2 gap-3">
            <KpiItem
              label="Visitas"
              value={item.visits.toLocaleString("pt-BR")}
            />
            <KpiItem
              label="Vendido"
              value={item.sold_quantity.toLocaleString("pt-BR")}
            />
            <KpiItem
              label="Estoque"
              value={item.available_quantity.toLocaleString("pt-BR")}
            />
            <KpiItem
              label="Margem"
              value={marginDisplay()}
            />
          </div>
        </CardContent>
      </Card>

      {/* Informações do anúncio */}
      <Card>
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            Informações
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Marca</span>
              <span className="font-medium">{item.brand || "Sem marca"}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <Badge
                variant={item.status === "active" ? "outline" : "secondary"}
                className={`text-[10px] h-4 px-1 ${item.status === "active" ? "border-emerald-500 text-emerald-600" : ""}`}
              >
                {statusLabel(item.status)}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Frete</span>
              <Badge
                variant="outline"
                className={`text-[10px] h-4 px-1 ${item.free_shipping ? "border-emerald-500 text-emerald-600" : ""}`}
              >
                {item.free_shipping ? "Grátis" : "Pago"}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Preço</span>
              <span className="font-mono font-medium">{currencyFmt(item.price)}</span>
            </div>
            {item.catalog_product_id && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Catálogo</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {item.catalog_product_id}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className="grid md:grid-cols-5 gap-4">
      <div className="md:col-span-2">{leftCol}</div>
      <div className="md:col-span-3">{rightCol}</div>
    </div>
  );
}
