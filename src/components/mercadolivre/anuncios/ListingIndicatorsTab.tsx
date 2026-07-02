import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import type { ProductMarginWithAds } from "@/hooks/useMLMarginWithAds";
import { currencyFmt } from "./listingHelpers";
import { aggregateLogisticType, logisticTypeLabel } from "./listingIndicators";
import { ListingQualityScore } from "./ListingQualityScore";
import { useMLListingHealth } from "./useMLListingHealth";
import { ListingIssues } from "./ListingIssues";

interface ListingIndicatorsTabProps {
  item: ProductItem;
  margin?: ProductMarginWithAds | null;
}

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
  const marginDisplay = (): React.ReactNode => {
    if (!margin) return <span className="text-muted-foreground">—</span>;
    const pct = margin.lucro_pct_pos_ads ?? margin.lucro_pct;
    if (pct === null) return <span className="text-muted-foreground text-xs">Sem vendas no período</span>;
    const color = pct >= 0 ? "text-emerald-600" : "text-destructive";
    return <span className={color}>{pct.toFixed(1)}%</span>;
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
