import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useReplenishmentBySku } from "@/hooks/useReplenishmentBySku";
import type { GroupedReplenishmentRow, ReplenishmentSkuRow } from "@/hooks/useReplenishmentBySku";
import { ReplenishmentSkuFilters } from "@/components/mercadolivre/ReplenishmentSkuFilters";
import type { FilterStatus, FilterCusto } from "@/components/mercadolivre/ReplenishmentSkuFilters";
import { ReplenishmentSkuTable } from "@/components/mercadolivre/ReplenishmentSkuTable";
import { ReplenishmentParamsDialog } from "@/components/mercadolivre/ReplenishmentParamsDialog";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";

// ── Filter logic ──────────────────────────────────────────────────────────────

function applyFilters(
  rows:         ReplenishmentSkuRow[],
  filterBrand:  string,
  filterStatus: FilterStatus,
  filterCusto:  FilterCusto,
  searchText:   string,
): ReplenishmentSkuRow[] {
  let result = rows;

  if (filterBrand !== "all") {
    result = result.filter((r) => r.brand === filterBrand);
  }
  if (filterStatus === "gatilho") {
    result = result.filter((r) => r.gatilho_ativo);
  } else if (filterStatus === "sem_giro") {
    result = result.filter((r) => r.sem_giro);
  }
  if (filterCusto === "com") {
    result = result.filter((r) => !r.custo_ausente);
  } else if (filterCusto === "sem") {
    result = result.filter((r) => r.custo_ausente);
  }
  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();
    result = result.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.sku_code?.toLowerCase().includes(q) ||
        r.attribute_combinations_label.toLowerCase().includes(q),
    );
  }

  return result;
}

/** Re-groups filtered rows by item_id preserving aggregation */
function regroupRows(rows: ReplenishmentSkuRow[]): GroupedReplenishmentRow[] {
  const map = new Map<string, GroupedReplenishmentRow>();

  for (const row of rows) {
    const existing = map.get(row.item_id);
    if (!existing) {
      map.set(row.item_id, {
        item_id:               row.item_id,
        title:                 row.title,
        brand:                 row.brand,
        logistic_type:         row.logistic_type,
        skus:                  [row],
        total_compra_sugerida: row.compra_sugerida,
        total_valor_estimado:  row.valor_estimado,
        any_gatilho_ativo:     row.gatilho_ativo,
        any_custo_ausente:     row.custo_ausente,
      });
    } else {
      existing.skus.push(row);
      existing.total_compra_sugerida += row.compra_sugerida;
      existing.total_valor_estimado =
        existing.total_valor_estimado != null && row.valor_estimado != null
          ? existing.total_valor_estimado + row.valor_estimado
          : null;
      if (row.gatilho_ativo)  existing.any_gatilho_ativo = true;
      if (row.custo_ausente)  existing.any_custo_ausente = true;
    }
  }

  return Array.from(map.values());
}

// ── xlsx export ───────────────────────────────────────────────────────────────

function exportToXlsx(rows: ReplenishmentSkuRow[]) {
  const data = rows.map((r) => ({
    "Item ID":       r.item_id,
    "Anúncio":       r.title ?? "",
    "Marca":         r.brand ?? "",
    "SKU":           r.sku_code ?? "",
    "Cor/Tamanho":   r.attribute_combinations_label,
    "Estoque":       r.sku_stock,
    "Vende por dia":      r.venda_dia,
    "Dura quanto (dias)": r.cobertura_atual ?? "",
    "Ponto de recompra":  r.ponto_reposicao,
    "Comprar (qtd)":      r.compra_sugerida,
    "Custo estimado":     r.valor_estimado ?? "",
    "Custo ausente": r.custo_ausente ? "Sim" : "Não",
    "Sem giro":      r.sem_giro ? "Sim" : "Não",
    "Params":        `LT${r.param_lead_time} Cob${r.param_cobertura} Seg${r.param_safety} MOQ${r.param_moq} Pack${r.param_pack}`,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compras");
  XLSX.writeFile(wb, `compras-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MLCompras() {
  const { data, isLoading, error } = useReplenishmentBySku();

  const [filterBrand,  setFilterBrand]  = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [filterCusto,  setFilterCusto]  = useState<FilterCusto>("all");
  const [searchText,   setSearchText]   = useState<string>("");

  const allRows: ReplenishmentSkuRow[] = data?.rows ?? [];

  /** Distinct brands sorted alphabetically */
  const brands = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((r) => { if (r.brand) set.add(r.brand); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  /** Filtered rows (flat) */
  const filteredRows = useMemo(
    () => applyFilters(allRows, filterBrand, filterStatus, filterCusto, searchText),
    [allRows, filterBrand, filterStatus, filterCusto, searchText],
  );

  /** Re-grouped for the table */
  const filteredGrouped = useMemo(() => regroupRows(filteredRows), [filteredRows]);

  /** Contagem de status para o mini-resumo */
  const statusCounts = useMemo(() => ({
    parComprar: filteredRows.filter((r) => r.gatilho_ativo).length,
    ok:         filteredRows.filter((r) => !r.gatilho_ativo && !r.sem_giro).length,
    semGiro:    filteredRows.filter((r) => r.sem_giro).length,
  }), [filteredRows]);

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Compras" />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={filteredRows.length === 0 || isLoading}
              onClick={() => exportToXlsx(filteredRows)}
            >
              <Download className="w-3.5 h-3.5" />
              Exportar xlsx
            </Button>
            <ReplenishmentParamsDialog />
          </div>
        </div>
      </div>

      {/* ── Aviso REPL-09: v1 não desconta compras a chegar / itens em trânsito ── */}
      <Alert className="border-warning/40 bg-warning/5">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertDescription className="text-sm">
          <strong>Limitação v1:</strong> esta sugestão de compra considera apenas o estoque
          atual no Mercado Livre. Compras a chegar (ordens de compra em trânsito){" "}
          <strong>não são descontadas</strong>. Verifique seu estoque em trânsito antes de
          confirmar o pedido.
        </AlertDescription>
      </Alert>

      {/* ── Tabela principal ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-wrap">
            <CardTitle className="text-sm">
              Compra Recomendada por SKU
              {!isLoading && allRows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {filteredRows.length === allRows.length
                    ? `${allRows.length} SKUs`
                    : `${filteredRows.length} de ${allRows.length} SKUs`}
                </span>
              )}
            </CardTitle>
          </div>

          {!isLoading && allRows.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              <span className={statusCounts.parComprar > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                🔴 {statusCounts.parComprar} para comprar
              </span>
              <span
                className={statusCounts.ok > 0 ? "font-medium" : "text-muted-foreground"}
                style={statusCounts.ok > 0 ? { color: "var(--kpi-positive)" } : undefined}
              >
                🟢 {statusCounts.ok} ok
              </span>
              <span className="text-muted-foreground">
                ⚪ {statusCounts.semGiro} sem giro
              </span>
            </div>
          )}

          <div>
            <ReplenishmentSkuFilters
              brands={brands}
              filterBrand={filterBrand}
              filterStatus={filterStatus}
              filterCusto={filterCusto}
              searchText={searchText}
              onBrand={setFilterBrand}
              onStatus={setFilterStatus}
              onCusto={setFilterCusto}
              onSearch={setSearchText}
              totalRows={allRows.length}
              filteredRows={filteredRows.length}
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ReplenishmentSkuTable
            grouped={filteredGrouped}
            isLoading={isLoading}
            error={error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
