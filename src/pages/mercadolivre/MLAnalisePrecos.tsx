import { useMemo, useCallback } from "react";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLSoldProducts } from "@/hooks/useMLSoldProducts";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { PrecoPraticadoReport } from "@/components/mercadolivre/anuncios/PrecoPraticadoReport";

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Página Análise de Preços — wrapper de PrecoPraticadoReport.
 *
 * Deriva a lista de produtos (com vendas no período) a partir de useMLSoldProducts,
 * deduplica por item_id e ordena por quantidade vendida desc, alimentando o seletor
 * de anúncio do PrecoPraticadoReport.
 *
 * Deep-link ?item=MLB... está DEFERIDO (ver 77-CONTEXT.md Deferred).
 * Quando implementado, derivar request={ itemId, nonce } de useSearchParams().
 */
export default function MLAnalisePrecos() {
  // ── Contextos ─────────────────────────────────────────────────────────────
  const { resolvedMLUserIds } = useMLStore();

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

  // ── Hook de dados (lista de produtos com vendas no período) ───────────────
  const { allRows } = useMLSoldProducts({
    fromDate: currentFrom,
    toDate: currentTo,
    resolvedMLUserIds,
  });

  // Deduplica por item_id, soma qty, ordena por qty desc, mapeia para { id, title }
  const products = useMemo(() => {
    const map = new Map<string, { id: string; title: string; qty: number }>();
    for (const r of allRows) {
      const prev = map.get(r.item_id);
      if (!prev) {
        map.set(r.item_id, {
          id: r.item_id,
          title: r.titulo ?? r.item_id,
          qty: r.quantidade,
        });
      } else {
        prev.qty += r.quantidade;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
  }, [allRows]);

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Análise de Preços" />
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

      {/* ── Relatório de preço praticado ── */}
      <PrecoPraticadoReport
        products={products}
        mlUserIds={resolvedMLUserIds}
        fromDate={currentFrom}
        toDate={currentTo}
        request={null}
      />
    </div>
  );
}
