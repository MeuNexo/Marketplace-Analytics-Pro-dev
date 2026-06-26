import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilterStatus = "all" | "gatilho" | "sem_giro";
export type FilterCusto  = "all" | "com" | "sem";

export interface ReplenishmentSkuFiltersProps {
  brands:        string[];
  filterBrand:   string;
  filterStatus:  FilterStatus;
  filterCusto:   FilterCusto;
  searchText:    string;
  onBrand:       (v: string)       => void;
  onStatus:      (v: FilterStatus) => void;
  onCusto:       (v: FilterCusto)  => void;
  onSearch:      (v: string)       => void;
  totalRows:     number;
  filteredRows:  number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReplenishmentSkuFilters({
  brands,
  filterBrand,
  filterStatus,
  filterCusto,
  searchText,
  onBrand,
  onStatus,
  onCusto,
  onSearch,
  totalRows,
  filteredRows,
}: ReplenishmentSkuFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap">
      {/* Busca textual */}
      <div className="relative w-52">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Título, SKU ou tamanho…"
          value={searchText}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Filtro de marca */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Marca</Label>
        <Select value={filterBrand} onValueChange={onBrand}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status / Gatilho */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Status</Label>
        <Select value={filterStatus} onValueChange={(v) => onStatus(v as FilterStatus)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="gatilho">Gatilho ativo</SelectItem>
            <SelectItem value="sem_giro">Sem giro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Custo */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Custo</Label>
        <Select value={filterCusto} onValueChange={(v) => onCusto(v as FilterCusto)}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="com">Com custo</SelectItem>
            <SelectItem value="sem">Sem custo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contador */}
      {totalRows > 0 && (
        <span className="ml-auto text-xs text-muted-foreground">
          {filteredRows === totalRows
            ? `${totalRows} SKUs`
            : `${filteredRows} de ${totalRows} SKUs`}
        </span>
      )}
    </div>
  );
}
