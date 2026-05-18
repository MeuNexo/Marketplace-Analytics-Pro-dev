import { useState, useEffect, useMemo } from "react";
import { Search, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAnalysisSnapshots, type AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";
import { useMLPrecosCustos, type MLItemPrice } from "@/hooks/useMLPrecosCustos";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/pricing/calculator";
import { HistoricoSnapshotTable } from "./HistoricoSnapshotTable";
import { HistoricoComparacaoPanel } from "./HistoricoComparacaoPanel";

// ── Component ─────────────────────────────────────────────────────────────────

export function HistoricoComparativo() {
  // ── Context (same pattern as AnaliseDashboard) ─────────────────────────────
  const { stores, selectedStore } = useMLStore();
  const { currentOrg } = useOrganization();
  const { toast } = useToast();

  const mlUserId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    return stores[0]?.ml_user_id ?? "";
  }, [selectedStore, stores]);

  const orgId = currentOrg?.id ?? "";

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const { fetchSnapshots, loading } = useAnalysisSnapshots();
  const { items, loading: itemsLoading } = useMLPrecosCustos();

  // ── State ──────────────────────────────────────────────────────────────────
  const [itemId, setItemId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Product search ─────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter(
        (it) =>
          it.item_id.toLowerCase().includes(q) ||
          it.title.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [items, searchQuery]);

  function selectProduct(it: MLItemPrice) {
    setItemId(it.item_id);
    setProductTitle(it.title);
    setSearchOpen(false);
    setSearchQuery("");
  }

  function clearProduct() {
    setItemId("");
    setProductTitle("");
    setSnapshots([]);
    setSelected([]);
  }

  // ── Fetch snapshots when itemId changes ───────────────────────────────────
  useEffect(() => {
    if (!itemId || !orgId) return;
    setSelected([]);
    fetchSnapshots(itemId, orgId)
      .then((results) => {
        setSnapshots(results);
      })
      .catch((err: Error) => {
        toast({
          variant: "destructive",
          title: "Erro ao carregar histórico",
          description: err.message,
        });
      });
  }, [itemId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle selection (max 2) ───────────────────────────────────────────────
  function handleToggle(id: string) {
    if (selected.includes(id)) {
      setSelected((prev) => prev.filter((x) => x !== id));
    } else if (selected.length < 2) {
      setSelected((prev) => [...prev, id]);
    }
    // else: no-op — child disables the checkbox
  }

  // ── Build sorted comparison tuple ─────────────────────────────────────────
  const comparisonPair = useMemo((): [AnalysisSnapshot, AnalysisSnapshot] | null => {
    if (selected.length !== 2) return null;
    const pair = selected
      .map((id) => snapshots.find((s) => s.id === id))
      .filter((s): s is AnalysisSnapshot => s !== undefined);
    if (pair.length !== 2) return null;
    // Sort ASC by createdAt so index 0 = older (A), index 1 = newer (B)
    pair.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    return [pair[0], pair[1]];
  }, [selected, snapshots]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Product selector card */}
      <Card>
        <CardHeader className="px-4 pt-3 pb-2">
          <CardTitle className="text-sm font-medium">Histórico de Análises</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="text-xs text-muted-foreground">Produto</label>
              {itemId ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 h-10">
                  <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{productTitle}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{itemId}</p>
                  </div>
                  <button
                    onClick={clearProduct}
                    className="text-xs text-muted-foreground hover:text-foreground ml-1"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full h-10 justify-start gap-2 font-normal text-xs text-muted-foreground"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Buscar produto…
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[--radix-popover-trigger-width] p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Digite MLB ou título…"
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {itemsLoading
                            ? "Carregando anúncios…"
                            : "Nenhum anúncio encontrado."}
                        </CommandEmpty>
                        <CommandGroup>
                          {filteredItems.map((it) => (
                            <CommandItem
                              key={it.item_id}
                              value={`${it.item_id} ${it.title}`}
                              onSelect={() => selectProduct(it)}
                              className="gap-2 data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                            >
                              {it.thumbnail ? (
                                <img
                                  src={it.thumbnail}
                                  alt=""
                                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                                />
                              ) : (
                                <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{it.title}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  {it.item_id}
                                </p>
                              </div>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {formatBRL(it.price_sale)}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Snapshot list */}
      {itemId && (
        <>
          {loading ? (
            <p className="text-sm text-muted-foreground py-4">Carregando histórico…</p>
          ) : (
            <Card>
              <CardContent className="p-0">
                <HistoricoSnapshotTable
                  snapshots={snapshots}
                  selected={selected}
                  onToggle={handleToggle}
                />
              </CardContent>
            </Card>
          )}

          {/* Comparison panel */}
          {comparisonPair && (
            <HistoricoComparacaoPanel snapshots={comparisonPair} />
          )}
        </>
      )}

      {/* Empty state when no product selected */}
      {!itemId && (
        <p className="text-sm text-muted-foreground py-4">
          Selecione um produto para ver o histórico de análises.
        </p>
      )}
    </div>
  );
}
