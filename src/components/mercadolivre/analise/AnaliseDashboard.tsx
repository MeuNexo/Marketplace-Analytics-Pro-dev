import { useState, useEffect, useCallback, useMemo } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Search, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLOrdersByItem } from "@/hooks/useMLOrdersByItem";
import { useAnalysisSnapshots, type AnalysisSnapshot, type SnapshotInput } from "@/hooks/useAnalysisSnapshots";
import { useMLPrecosCustos, type MLItemPrice } from "@/hooks/useMLPrecosCustos";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/pricing/calculator";
import { AnalysisProductCard } from "./AnalysisProductCard";
import { AnalisePrecosTable } from "./AnalisePrecosTable";
import CompraRecomendadaPanel from "./CompraRecomendadaPanel";
import { HistoricoSnapshotTable } from "./HistoricoSnapshotTable";
import { HistoricoComparacaoPanel } from "./HistoricoComparacaoPanel";

export function AnaliseDashboard() {
  const { stores, selectedStore } = useMLStore();
  const { currentOrg } = useOrganization();
  const { toast } = useToast();

  const mlUserId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    return stores[0]?.ml_user_id ?? "";
  }, [selectedStore, stores]);

  const orgId = currentOrg?.id ?? "";

  const { fetchOrders, loading: loadingOrders } = useMLOrdersByItem();
  const { saveSnapshot, fetchSnapshots, updateStrategy, deleteSnapshot, saving, loading } = useAnalysisSnapshots();
  const { items, loading: itemsLoading } = useMLPrecosCustos();

  // Period filter — default 30 days, same component used across ML pages
  const filters = useMLFilters(30);
  const { period, customRange, periodLabel, currentFrom, currentTo, setCustomRange, setPeriod } = filters;

  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      setCustomRange({ from: filters.pendingRange.from, to: resolvedTo });
      setPeriod(0);
    } else if (filters.pendingPeriod !== null) {
      setPeriod(filters.pendingPeriod);
      setCustomRange(null);
    }
    filters.setPopoverOpen(false);
  }, [filters, setCustomRange, setPeriod]);

  // State
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([]);
  const [itemId, setItemId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [productThumb, setProductThumb] = useState<string>("");
  const [brand, setBrand] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSnapshots, setSelectedSnapshots] = useState<string[]>([]);

  const running = saving || loadingOrders;

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) =>
      it.item_id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q),
    ).slice(0, 200);
  }, [items, searchQuery]);

  function selectProduct(it: MLItemPrice) {
    setItemId(it.item_id);
    setProductTitle(it.title);
    setProductThumb(it.thumbnail ?? "");
    setBrand(null);
    setSearchOpen(false);
    setSearchQuery("");
    setSelectedSnapshots([]);
  }

  function clearProduct() {
    setItemId("");
    setProductTitle("");
    setProductThumb("");
    setBrand(null);
    setSnapshots([]);
    setSelectedSnapshots([]);
  }

  useEffect(() => {
    if (!itemId || !orgId) return;
    fetchSnapshots(itemId, orgId).then((results) => {
      setSnapshots(results);
    }).catch((err: Error) => {
      toast({ variant: "destructive", title: "Erro ao carregar análises", description: err.message });
    });
  }, [itemId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = useCallback(async () => {
    if (!itemId) return;

    let periodDays: number;
    try {
      periodDays = differenceInCalendarDays(new Date(currentTo), new Date(currentFrom)) + 1;
      if (periodDays <= 0) throw new Error("Período inválido");
    } catch {
      toast({ variant: "destructive", title: "Período inválido", description: "Verifique o período selecionado." });
      return;
    }

    try {
      const orders = await fetchOrders(itemId, orgId, mlUserId, currentFrom, currentTo);

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
        periodStart: currentFrom,
        periodEnd: currentTo,
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
  }, [itemId, orgId, mlUserId, currentFrom, currentTo, productTitle, brand, fetchOrders, saveSnapshot, toast]);

  const handleStrategyChange = useCallback(async (id: string, strategy: 'gmv' | 'neutral' | 'margin') => {
    const previous = snapshots;
    setSnapshots((prev) => prev.map((s) => s.id === id ? { ...s, strategy } : s));
    try {
      await updateStrategy(id, strategy);
    } catch (err) {
      setSnapshots(previous);
      const message = err instanceof Error ? err.message : "Erro ao salvar estratégia";
      toast({ variant: "destructive", title: "Erro ao salvar estratégia", description: message });
    }
  }, [snapshots, updateStrategy, toast]);

  const handleDeleteSnapshot = useCallback(async (id: string) => {
    const previous = snapshots;
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    setSelectedSnapshots((prev) => prev.filter((x) => x !== id));
    try {
      await deleteSnapshot(id);
      toast({ title: "Análise excluída" });
    } catch (err) {
      setSnapshots(previous);
      const message = err instanceof Error ? err.message : "Erro ao excluir análise";
      toast({ variant: "destructive", title: "Erro ao excluir", description: message });
    }
  }, [snapshots, deleteSnapshot, toast]);

  function handleToggleSnapshot(id: string) {
    setSelectedSnapshots((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }

  const comparisonPair = useMemo((): [AnalysisSnapshot, AnalysisSnapshot] | null => {
    if (selectedSnapshots.length !== 2) return null;
    const pair = selectedSnapshots
      .map((id) => snapshots.find((s) => s.id === id))
      .filter((s): s is AnalysisSnapshot => s !== undefined);
    if (pair.length !== 2) return null;
    pair.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    return [pair[0], pair[1]];
  }, [selectedSnapshots, snapshots]);

  return (
    <div className="space-y-4">
      {/* Controls card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm font-medium text-foreground">
              Análise de Elasticidade
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Product chip / search */}
              {itemId ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 pl-2 pr-1 h-8">
                  {productThumb ? (
                    <img src={productThumb} alt="" className="w-5 h-5 rounded object-cover" />
                  ) : (
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <span className="text-xs font-medium truncate max-w-[220px]">{productTitle}</span>
                  <button
                    onClick={clearProduct}
                    className="text-muted-foreground hover:text-foreground px-1 text-sm leading-none"
                    aria-label="Remover produto"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-[320px] justify-start gap-1.5 text-xs font-normal text-muted-foreground"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Buscar produto…
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-0" align="end">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Buscar..."
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

              {/* Period picker */}
              <MLPeriodPicker
                periodLabel={periodLabel}
                popoverOpen={filters.popoverOpen}
                setPopoverOpen={filters.setPopoverOpen}
                pendingRange={filters.pendingRange}
                setPendingRange={filters.setPendingRange}
                pendingPeriod={filters.pendingPeriod}
                setPendingPeriod={filters.setPendingPeriod}
                pendingLabel={filters.pendingLabel}
                canConfirm={filters.canConfirm}
                customRange={customRange}
                period={period}
                onConfirm={handleConfirm}
              />

              <Button
                onClick={handleAnalyze}
                disabled={running || !itemId}
                size="sm"
                className="h-8 text-xs"
              >
                {running ? "Analisando…" : "Analisar"}
              </Button>
            </div>
          </div>
        </CardHeader>
        {!itemId && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Selecione um produto e período acima e clique em "Analisar" para começar.
            </p>
          </CardContent>
        )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnalysisProductCard snapshot={snapshots[0]} />
          </div>

          <Card>
            <CardContent className="p-0">
              <AnalisePrecosTable
                snapshots={snapshots}
                onStrategyChange={handleStrategyChange}
              />
            </CardContent>
          </Card>

          <CompraRecomendadaPanel snapshots={snapshots} />

          {/* Embedded history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-foreground">
                Histórico de análises
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <HistoricoSnapshotTable
                snapshots={snapshots}
                selected={selectedSnapshots}
                onToggle={handleToggleSnapshot}
                onDelete={handleDeleteSnapshot}
              />
            </CardContent>
          </Card>

          {comparisonPair && <HistoricoComparacaoPanel snapshots={comparisonPair} />}
        </div>
      ) : itemId ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          Sem análises para este produto. Clique em "Analisar" para criar a primeira.
        </p>
      ) : null}

      {loading && snapshots.length === 0 && itemId && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </div>
  );
}
