import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProductItem } from "@/contexts/MLInventoryContext";
import type { ProductMarginWithAds } from "@/hooks/useMLMarginWithAds";
import {
  getCommissionRate,
  getListingLabel,
  mlListingUrl,
} from "./listingHelpers";
import { ListingIndicatorsTab } from "./ListingIndicatorsTab";
import { ListingSalesTab } from "./ListingSalesTab";

interface ListingDetailModalProps {
  item: ProductItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  margin?: ProductMarginWithAds | null;
}

// ─── Badge de tipo de anúncio ─────────────────────────────────────────────────

function ListingTypeBadge({ listingTypeId }: { listingTypeId: string | null }) {
  const label = getListingLabel(listingTypeId);
  const rate  = getCommissionRate(listingTypeId);
  const pct   = (rate * 100).toFixed(1);

  if (label === "Premium") {
    return (
      <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100 px-[4px] py-px">
        {label} · {pct}%
      </Badge>
    );
  }
  if (label === "Grátis") {
    return (
      <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100 px-[4px] py-px">
        {label} · {pct}%
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] px-[4px] py-px">
      {label} · {pct}%
    </Badge>
  );
}

// ─── Aba futura desabilitada (disabled + tooltip "em breve") ──────────────────

function DisabledTabTrigger({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span envolvente necessário pois TabsTrigger disabled não propaga eventos de mouse */}
        <span className="inline-flex cursor-not-allowed">
          <TabsTrigger value={value} disabled className="pointer-events-none">
            {label}
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Em breve
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

/**
 * Shell do modal de detalhe do anúncio ML.
 *
 * Estrutura:
 *  - Dialog controlado (open/onOpenChange)
 *  - DialogContent max-w-4xl max-h-[90vh] overflow-y-auto
 *  - DialogHeader: título, MLB id, badge variações, badge tipo, botão "Ver no ML"
 *  - Tabs: "indicadores" (ativa) + vendas/precificacao/avaliacoes/historico (disabled + tooltip)
 *  - TabsContent "indicadores" → <ListingIndicatorsTab>
 *
 * Zero fetch, zero novas dependências.
 */
export function ListingDetailModal({
  item,
  open,
  onOpenChange,
  margin,
}: ListingDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {item && (
          <>
            {/* ── Cabeçalho ─────────────────────────────────────────────── */}
            <DialogHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2 pr-6">
                <DialogTitle className="text-base font-semibold line-clamp-1 flex-1">
                  {item.title}
                </DialogTitle>
                <a
                  href={mlListingUrl(item.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={0}
                  className="flex-shrink-0"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    asChild={false}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Ver no ML
                  </Button>
                </a>
              </div>

              {/* Metadados do anúncio */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">
                  {item.id}
                </span>

                {item.variations.length > 1 && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {item.variations.length} variações
                  </Badge>
                )}

                <ListingTypeBadge listingTypeId={item.listing_type_id} />
              </div>
            </DialogHeader>

            {/* ── Abas ──────────────────────────────────────────────────── */}
            <Tabs defaultValue="indicadores" className="mt-4">
              <TabsList className="flex-wrap h-auto gap-1">
                <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
                <TabsTrigger value="vendas">Vendas</TabsTrigger>
                <DisabledTabTrigger value="precificacao" label="Precificação"  />
                <DisabledTabTrigger value="avaliacoes"   label="Avaliações"   />
                <DisabledTabTrigger value="historico"    label="Histórico"    />
              </TabsList>

              <TabsContent value="indicadores" className="mt-4">
                <ListingIndicatorsTab item={item} margin={margin} />
              </TabsContent>

              <TabsContent value="vendas" className="mt-4">
                <ListingSalesTab item={item} />
              </TabsContent>
              <TabsContent value="precificacao" />
              <TabsContent value="avaliacoes" />
              <TabsContent value="historico" />
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
