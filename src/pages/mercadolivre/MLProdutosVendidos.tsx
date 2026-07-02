import { useMemo, useState, useCallback } from "react";
import { ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLSoldProducts } from "@/hooks/useMLSoldProducts";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import {
  aggregatePvGroups,
  aggregatePvItems,
} from "@/components/mercadolivre/anuncios/soldProductsAgg";

// ─── Formatters ───────────────────────────────────────────────────────────────

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const intFmt = (v: number) => v.toLocaleString("pt-BR");

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MLProdutosVendidos() {
  // ── Estado local ──────────────────────────────────────────────────────────
  const [pvView, setPvView] = useState<"marca" | "categoria">("marca");
  const [pvSelected, setPvSelected] = useState<string | null>(null);

  // ── Contextos ─────────────────────────────────────────────────────────────
  const { resolvedMLUserIds } = useMLStore();
  const { items: inventoryItems } = useMLInventory();

  // ── Filtro de período ─────────────────────────────────────────────────────
  const filters = useMLFilters(30);
  const { currentFrom, currentTo, periodLabel } = filters;

  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      filters.setCustomRange({ from: filters.pendingRange.from, to: resolvedTo });
      filters.setPeriod(0);
    } else if (filters.pendingPeriod !== null) {
      filters.setPeriod(filters.pendingPeriod);
      filters.setCustomRange(null);
    }
    filters.setPopoverOpen(false);
  }, [filters]);

  // ── Hook de dados ─────────────────────────────────────────────────────────
  const { allRows, isLoading } = useMLSoldProducts({
    fromDate: currentFrom,
    toDate: currentTo,
    resolvedMLUserIds,
  });

  // ── Map item_id → inventory (thumbnail, category_id, title atual, estoque) ──
  const itemsMap = useMemo(() => {
    const m = new Map<
      string,
      {
        category_id?: string | null;
        title?: string;
        thumbnail?: string | null;
        available_quantity?: number;
      }
    >();
    inventoryItems.forEach((i) => {
      if (i.id)
        m.set(i.id, {
          category_id: i.category_id,
          title: i.title,
          thumbnail: i.thumbnail,
          available_quantity: i.available_quantity,
        });
    });
    return m;
  }, [inventoryItems]);

  // ── Grupos e itens derivados client-side ──────────────────────────────────
  const pvGroups = useMemo(
    () => aggregatePvGroups(allRows, pvView, itemsMap),
    [allRows, pvView, itemsMap],
  );

  const pvItems = useMemo(
    () =>
      pvSelected !== null
        ? aggregatePvItems(allRows, pvSelected, pvView, itemsMap)
        : [],
    [allRows, pvSelected, pvView, itemsMap],
  );

  // Ao trocar a view (marca/categoria), limpa a seleção de grupo
  const handleViewChange = (v: string) => {
    if (!v) return;
    setPvView(v as "marca" | "categoria");
    setPvSelected(null);
  };

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Produtos Vendidos" />
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle marca/categoria */}
            <ToggleGroup
              type="single"
              size="sm"
              value={pvView}
              onValueChange={handleViewChange}
              className="h-8"
            >
              <ToggleGroupItem value="marca" className="h-7 px-3 text-xs">
                Marca
              </ToggleGroupItem>
              <ToggleGroupItem value="categoria" className="h-7 px-3 text-xs">
                Categoria
              </ToggleGroupItem>
            </ToggleGroup>
            {/* Seletor de período */}
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
              customRange={filters.customRange}
              period={filters.period}
              onConfirm={handleConfirm}
              maxDaysBack={365}
            />
          </div>
        </div>
      </div>

      {/* ── Estados de carregamento / vazio ── */}
      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Carregando pedidos do período…
        </p>
      )}

      {!isLoading && allRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ShoppingBag className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhum pedido pago encontrado no período.</p>
        </div>
      )}

      {/* ── Painel duplo ── */}
      {!isLoading && allRows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

          {/* ── Coluna esquerda: lista de grupos ── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {pvView === "marca" ? "Marcas" : "Categorias"}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {pvGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-4">Sem dados.</p>
              ) : (
                <ul className="space-y-0.5">
                  {pvGroups.map((g) => (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setPvSelected(pvSelected === g.key ? null : g.key)
                        }
                        className={[
                          "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors",
                          pvSelected === g.key
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted text-foreground",
                        ].join(" ")}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate flex-1">{g.name}</span>
                          <span className="shrink-0 text-right text-xs text-muted-foreground">
                            <span className="block font-medium text-foreground">
                              {brl(g.revenue)}
                            </span>
                            <span>{intFmt(g.qty)} un.</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Coluna direita: anúncios do grupo selecionado ── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {pvSelected === null
                  ? "Selecione um grupo acima"
                  : pvGroups.find((g) => g.key === pvSelected)?.name ?? pvSelected}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {pvSelected === null ? (
                <p className="text-xs text-muted-foreground py-4">
                  Clique em uma {pvView === "marca" ? "marca" : "categoria"} para ver os anúncios.
                </p>
              ) : pvItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4">
                  Nenhum anúncio encontrado neste grupo.
                </p>
              ) : (
                <>
                  {/* ── Desktop: tabela ── */}
                  <div className="hidden lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40 text-xs text-muted-foreground">
                          <th className="py-2 text-left font-medium">Anúncio</th>
                          <th className="py-2 text-right font-medium pr-4">Qtd</th>
                          <th className="py-2 text-right font-medium pr-4">Receita</th>
                          <th className="py-2 text-right font-medium pr-4">Estoque</th>
                          <th className="py-2 text-right font-medium">% Grupo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pvItems.map((item) => {
                          const inv = itemsMap.get(item.item_id);
                          return (
                            <tr
                              key={item.item_id}
                              className="border-b border-border/20 hover:bg-muted/40 transition-colors"
                            >
                              <td className="py-2.5 pr-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  {inv?.thumbnail && (
                                    <img
                                      src={inv.thumbnail}
                                      alt=""
                                      className="w-8 h-8 rounded object-cover shrink-0"
                                    />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium leading-tight">
                                      {item.title}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">{item.item_id}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums">
                                {intFmt(item.qty)}
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums font-medium">
                                {brl(item.revenue)}
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums text-muted-foreground">
                                {inv?.available_quantity !== undefined
                                  ? intFmt(inv.available_quantity)
                                  : "—"}
                              </td>
                              <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {(item.shareOfGroup * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Mobile: cards ── */}
                  <div className="lg:hidden space-y-3">
                    {pvItems.map((item) => {
                      const inv = itemsMap.get(item.item_id);
                      return (
                        <div
                          key={item.item_id}
                          className="rounded-lg border border-border/40 p-3 bg-card"
                        >
                          <div className="flex items-start gap-2 mb-2">
                            {inv?.thumbnail && (
                              <img
                                src={inv.thumbnail}
                                alt=""
                                className="w-10 h-10 rounded object-cover shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium leading-snug line-clamp-2">
                                {item.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{item.item_id}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">Qtd vendida</span>
                              <p className="font-medium tabular-nums">{intFmt(item.qty)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Receita</span>
                              <p className="font-medium tabular-nums">{brl(item.revenue)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Estoque</span>
                              <p className="font-medium tabular-nums">
                                {inv?.available_quantity !== undefined
                                  ? intFmt(inv.available_quantity)
                                  : "—"}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">% do grupo</span>
                              <p className="font-medium tabular-nums">
                                {(item.shareOfGroup * 100).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
