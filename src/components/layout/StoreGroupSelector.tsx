import { useMemo } from "react";
import { Check } from "lucide-react";
import { useSeller } from "@/contexts/SellerContext";
import { useHeaderScopeSafe } from "@/contexts/HeaderScopeContext";
import { getMarketplaceBrand } from "@/config/marketplaceConfig";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function StoreGroupSelector({ className }: Props) {
  const { selectedSeller } = useSeller();
  const scope = useHeaderScopeSafe();

  const activeStores = useMemo(
    () => (selectedSeller?.stores ?? []).filter((s) => s.is_active),
    [selectedSeller]
  );

  // With a single store there's nothing to switch — hide entirely
  if (activeStores.length <= 1 || !scope) return null;

  const { storeId, setStoreId } = scope;

  const chipBase =
    "h-7 px-2.5 text-xs rounded-lg border font-medium transition-colors cursor-pointer select-none inline-flex items-center gap-1.5 whitespace-nowrap";
  const chipActive = "bg-primary/10 text-primary border-primary/30";
  const chipInactive = "border-border/50 text-muted-foreground hover:bg-muted/50";

  return (
    <div className={cn("flex items-center gap-1.5 flex-nowrap min-w-0", className)}>
      {/* "Todas" chip */}
      <button
        onClick={() => setStoreId("all")}
        className={cn(chipBase, storeId === "all" ? chipActive : chipInactive)}
      >
        {storeId === "all" && <Check className="h-3 w-3" />}
        Todas
      </button>

      {activeStores.map((store) => {
        const isActive = storeId === store.id;
        const brand = getMarketplaceBrand(store.marketplace);
        const BrandIcon = brand?.icon;

        return (
          <button
            key={store.id}
            onClick={() => setStoreId(isActive ? "all" : store.id)}
            className={cn(chipBase, isActive ? chipActive : chipInactive)}
          >
            {BrandIcon && (
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded bg-gradient-to-br ${brand.gradient}`}
              >
                <BrandIcon className="h-2.5 w-2.5 text-white" />
              </div>
            )}
            <span>{store.store_name}</span>
          </button>
        );
      })}
    </div>
  );
}
