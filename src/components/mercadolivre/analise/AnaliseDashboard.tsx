import { useState, useEffect, useCallback, useMemo } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Search, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useMLOrdersByItem } from "@/hooks/useMLOrdersByItem";
import { useAnalysisSnapshots, type AnalysisSnapshot, type SnapshotInput } from "@/hooks/useAnalysisSnapshots";
import { useMLPrecosCustos, type MLItemPrice } from "@/hooks/useMLPrecosCustos";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/pricing/calculator";
import { AnalysisProductCard } from "./AnalysisProductCard";
import { AnalisePrecosTable } from "./AnalisePrecosTable";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AnaliseDashboard() {
  // ── Context ────────────────────────────────────────────────────────────────
  const { stores, selectedStore } = useMLStore();
  const { currentOrg } = useOrganization();
  const { toast } = useToast();

  const mlUserId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    return stores[0]?.ml_user_id ?? "";
  }, [selectedStore, stores]);

  const orgId = currentOrg?.id ?? "";

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const { fetchOrders, loading: loadingOrders } = useMLOrdersByItem();
  const { saveSnapshot, fetchSnapshots, updateStrategy, saving, loading } = useAnalysisSnapshots();
  const { items, loading: itemsLoading } = useMLPrecosCustos();

  // ── State ──────────────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([]);
  const [itemId, setItemId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(daysAgoStr(30));
  const [dateTo, setDateTo] = useState<string>(todayStr());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const running = saving || loadingOrders;

  // ── Product search ─────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) =>
      it.item_id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q),
    ).slice(0, 50);
  }, [items, searchQuery]);

  function selectProduct(it: MLItemPrice) {
    setItemId(it.item_id);
    setProductTitle(it.title);
    setBrand(null); // MLItemPrice has no brand field
    setSearchOpen(false);
    setSearchQuery("");
  }

  function clearProduct() {
    setItemId("");
    setProductTitle("");
    setBrand(null);
    setSnapshots([]);
  }

  // ── Auto-fetch snapshots when itemId + orgId are ready ────────────────────
  useEffect(() => {
    if (!itemId || !orgId) return;
    fetchSnapshots(itemId, orgId).then((results) => {
      setSnapshots(results);
    }).catch((err: Error) => {
      toast({ variant: "destructive", title: "Erro ao carregar análises", description: err.message });
    });
  }, [itemId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handleAnalyze ──────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!itemId || !dateFrom || !dateTo) return;

    let periodDays: number;
    try {
      periodDays = differenceInCalendarDays(new Date(dateTo), new Date(dateFrom)) + 1;
      if (periodDays <= 0) throw new Error("Período inválido");
    } catch {
      toast({ variant: "destructive", title: "Período inválido", description: "Verifique as datas selecionadas." });
      return;
    }

    try {
      const orders = await fetchOrders(itemId, orgId, mlUserId, dateFrom, dateTo);

      if (orders.length === 0) {
        toast({
          title: "Sem pedidos",
          description: "Nenhum pedido confirmado encontrado para este produto no período.",
        });
        return;
      }

      const input: SnapshotInput = {
        orders,
        periodDays,
        periodStart: dateFrom,
        periodEnd: dateTo,
        mlUserId,
        organizationId: orgId,
        itemId,
        productTitle: productTitle || (orders[0]?.title ?? itemId),
        brand: brand ?? undefined,
      };

      const snapshot = await saveSnapshot(input);
      setSnapshots((prev) => [snapshot, ...prev.filter((s) => s.id !== snapshot.id)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      toast({ variant: "destructive", title: "Erro na análise", description: message });
    }
  }, [itemId, orgId, mlUserId, dateFrom, dateTo, productTitle, brand, fetchOrders, saveSnapshot, toast]);

  // ── handleStrategyChange ──────────────────────────────────────────────────
  const handleStrategyChange = useCallback(async (id: string, strategy: 'gmv' | 'neutral' | 'margin') => {
    // Optimistic update
    const previous = snapshots;
    setSnapshots((prev) => prev.map((s) => s.id === id ? { ...s, strategy } : s));

    try {
      await updateStrategy(id, strategy);
    } catch (err) {
      // Revert on error
      setSnapshots(previous);
      const message = err instanceof Error ? err.message : "Erro ao salvar estratégia";
      toast({ variant: "destructive", title: "Erro ao salvar estratégia", description: message });
    }
  }, [snapshots, updateStrategy, toast]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Controls card */}
      <Card>
        <CardHeader className="px-4 pt-3 pb-2">
          <CardTitle className="text-sm font-medium">Análise de Elasticidade</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {/* Product selector */}
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
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Digite MLB ou título…"
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {itemsLoading ? "Carregando anúncios…" : "Nenhum anúncio encontrado."}
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
                                <img src={it.thumbnail} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                              ) : (
                                <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{it.title}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{it.item_id}</p>
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

            {/* Date inputs */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">De</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 text-xs w-[140px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Até</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 text-xs w-[140px]"
              />
            </div>
          </div>

          {/* Analyze button */}
          <Button
            onClick={handleAnalyze}
            disabled={running || !itemId}
            size="sm"
          >
            {running ? "Analisando…" : "Analisar"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {running ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : snapshots.length > 0 ? (
        <div className="space-y-4">
          {/* Most recent snapshot card */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnalysisProductCard snapshot={snapshots[0]} />
          </div>

          {/* Full table */}
          <Card>
            <CardContent className="p-0">
              <AnalisePrecosTable
                snapshots={snapshots}
                onStrategyChange={handleStrategyChange}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-8">
          Configure produto e período acima e clique em "Analisar" para começar.
        </p>
      )}

      {/* Loading existing snapshots indicator */}
      {loading && snapshots.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </div>
  );
}
