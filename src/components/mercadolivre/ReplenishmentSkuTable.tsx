import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  GroupedReplenishmentRow,
  ReplenishmentSkuRow,
} from "@/hooks/useReplenishmentBySku";

// ── Formatters ────────────────────────────────────────────────────────────────

const currencyFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const numFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

// ── Sub-cells ─────────────────────────────────────────────────────────────────

function CoberturaCell({ row }: { row: ReplenishmentSkuRow }) {
  if (row.sem_giro || row.cobertura_atual == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span>{numFmt(row.cobertura_atual)}d</span>;
}

function ValorEstimadoCell({ row }: { row: ReplenishmentSkuRow }) {
  if (row.custo_ausente) {
    return (
      <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
        custo ausente
      </Badge>
    );
  }
  if (row.valor_estimado == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums font-medium">{currencyFmt(row.valor_estimado)}</span>
  );
}

function FlagsCell({ row }: { row: ReplenishmentSkuRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.sem_giro && (
        <Badge variant="secondary" className="text-[10px]">
          sem giro
        </Badge>
      )}
      {row.custo_ausente && (
        <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
          custo ausente
        </Badge>
      )}
      {!row.sem_giro && !row.custo_ausente && (
        <span className="text-muted-foreground text-[11px]">—</span>
      )}
    </div>
  );
}

function ParamsCell({ row }: { row: ReplenishmentSkuRow }) {
  const origem =
    row.param_origem === "sku" ? (
      <Badge className="text-[10px] bg-primary/10 text-primary border-none">sku</Badge>
    ) : row.param_origem === "marca" ? (
      <Badge variant="outline" className="text-[10px]">marca</Badge>
    ) : (
      <Badge variant="secondary" className="text-[10px]">global</Badge>
    );
  return (
    <div className="text-[11px] text-muted-foreground space-y-0.5 min-w-[120px]">
      <div className="flex items-center gap-1">
        {origem}
        <span>LT {row.param_lead_time}d · Cob {row.param_cobertura}d · Seg {row.param_safety}d</span>
      </div>
      <div>MOQ {row.param_moq} · Pack {row.param_pack}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded" />
      ))}
    </div>
  );
}

// ── Variation row (filha) ─────────────────────────────────────────────────────

function VariationRow({ sku }: { sku: ReplenishmentSkuRow }) {
  return (
    <TableRow className="hover:bg-muted/20 bg-muted/5">
      {/* Indent + SKU code + Cor/Tamanho */}
      <TableCell className="text-xs pl-8">
        <div>
          {sku.attribute_combinations_label ? (
            <span className="text-foreground font-medium">
              {sku.attribute_combinations_label}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {sku.sku_code && (
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {sku.sku_code}
            </p>
          )}
        </div>
      </TableCell>

      {/* Estoque */}
      <TableCell className="text-xs text-right tabular-nums font-medium">
        {sku.sku_stock}
      </TableCell>

      {/* Venda/dia */}
      <TableCell className="text-xs text-right tabular-nums">
        {numFmt(sku.venda_dia)}/d
      </TableCell>

      {/* Cobertura */}
      <TableCell className="text-xs text-right tabular-nums">
        <CoberturaCell row={sku} />
      </TableCell>

      {/* Ponto reposição */}
      <TableCell className="text-xs text-right tabular-nums">
        {sku.ponto_reposicao}
      </TableCell>

      {/* Sugestão */}
      <TableCell className="text-xs text-right tabular-nums">
        {sku.compra_sugerida > 0 ? (
          <span className="font-semibold text-primary">{sku.compra_sugerida}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>

      {/* Valor estimado */}
      <TableCell className="text-xs text-right">
        <ValorEstimadoCell row={sku} />
      </TableCell>

      {/* Flags */}
      <TableCell className="text-xs">
        <FlagsCell row={sku} />
      </TableCell>

      {/* Parâmetros */}
      <TableCell className="text-xs">
        <ParamsCell row={sku} />
      </TableCell>
    </TableRow>
  );
}

// ── Master row (pai) ──────────────────────────────────────────────────────────

interface MasterRowProps {
  group:      GroupedReplenishmentRow;
  expanded:   boolean;
  onToggle:   () => void;
}

function MasterRow({ group, expanded, onToggle }: MasterRowProps) {
  const hasManySkus = group.skus.length > 1;

  return (
    <TableRow
      className={`hover:bg-muted/30 ${group.any_gatilho_ativo ? "bg-primary/5" : ""}`}
    >
      {/* Anuncio + marca + expand */}
      <TableCell className="text-xs">
        <div className="flex items-start gap-1">
          {hasManySkus ? (
            <CollapsibleTrigger asChild>
              <button
                onClick={onToggle}
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={expanded ? "Recolher variações" : "Expandir variações"}
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-3.5 h-3.5 shrink-0 mt-0.5 block" />
          )}
          <div className="min-w-0">
            <p className="font-medium truncate max-w-[220px]" title={group.title ?? group.item_id}>
              {group.title ?? group.item_id}
            </p>
            {group.brand && (
              <p className="text-[11px] text-muted-foreground truncate">{group.brand}</p>
            )}
            {hasManySkus && (
              <p className="text-[10px] text-muted-foreground">
                {group.skus.length} variações
                {group.any_gatilho_ativo && (
                  <span className="ml-1 text-primary font-medium">
                    ({group.skus.filter((s) => s.gatilho_ativo).length} gatilho)
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </TableCell>

      {/* Estoque total */}
      <TableCell className="text-xs text-right tabular-nums font-medium">
        {group.skus.reduce((s, r) => s + r.sku_stock, 0)}
      </TableCell>

      {/* Venda/dia (soma) */}
      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
        {numFmt(group.skus.reduce((s, r) => s + r.venda_dia, 0))}/d
      </TableCell>

      {/* Cobertura — deixar em branco para agrupado */}
      <TableCell />

      {/* Ponto reposição — deixar em branco */}
      <TableCell />

      {/* Compra sugerida total */}
      <TableCell className="text-xs text-right tabular-nums">
        {group.total_compra_sugerida > 0 ? (
          <span className="font-semibold text-primary">{group.total_compra_sugerida}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>

      {/* Valor estimado total */}
      <TableCell className="text-xs text-right">
        {group.any_custo_ausente ? (
          <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
            custo ausente
          </Badge>
        ) : group.total_valor_estimado != null ? (
          <span className="tabular-nums font-medium">
            {currencyFmt(group.total_valor_estimado)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Flags */}
      <TableCell className="text-xs">
        <div className="flex flex-wrap gap-1">
          {group.any_gatilho_ativo && (
            <Badge className="text-[10px] bg-primary/10 text-primary border-none">
              gatilho
            </Badge>
          )}
          {group.any_custo_ausente && (
            <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
              custo ausente
            </Badge>
          )}
          {!group.any_gatilho_ativo && !group.any_custo_ausente && (
            <span className="text-muted-foreground text-[11px]">—</span>
          )}
        </div>
      </TableCell>

      {/* Params — em branco para master row */}
      <TableCell />
    </TableRow>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ReplenishmentSkuTableProps {
  grouped:    GroupedReplenishmentRow[];
  isLoading?: boolean;
  error?:     Error | null;
}

export function ReplenishmentSkuTable({
  grouped,
  isLoading,
  error,
}: ReplenishmentSkuTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggle(itemId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-destructive text-sm">
        <Info className="w-4 h-4 shrink-0" />
        <span>Erro ao carregar dados de reposição. Tente recarregar a página.</span>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
        <Info className="w-6 h-6" />
        <span>Nenhum resultado para os filtros aplicados.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-xs min-w-[220px]">Anúncio / Variação</TableHead>
            <TableHead className="text-xs text-right">Estoque</TableHead>
            <TableHead className="text-xs text-right">Venda/dia</TableHead>
            <TableHead className="text-xs text-right">Cobertura</TableHead>
            <TableHead className="text-xs text-right">Ponto Rep.</TableHead>
            <TableHead className="text-xs text-right">Sugestão</TableHead>
            <TableHead className="text-xs text-right">Valor Est.</TableHead>
            <TableHead className="text-xs">Flags</TableHead>
            <TableHead className="text-xs">Parâmetros</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.map((group) => {
            const isExpanded = expandedIds.has(group.item_id);
            const hasManySkus = group.skus.length > 1;

            // Anúncio sem variação: linha única sem expand
            if (!hasManySkus) {
              const sku = group.skus[0];
              return (
                <TableRow key={group.item_id} className="hover:bg-muted/30">
                  <TableCell className="text-xs">
                    <div className="flex items-start gap-1">
                      <span className="w-3.5 h-3.5 shrink-0 mt-0.5 block" />
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[220px]" title={group.title ?? group.item_id}>
                          {group.title ?? group.item_id}
                        </p>
                        {group.brand && (
                          <p className="text-[11px] text-muted-foreground truncate">{group.brand}</p>
                        )}
                        {sku.sku_code && (
                          <p className="text-[10px] font-mono text-muted-foreground">{sku.sku_code}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">
                    {sku.sku_stock}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {numFmt(sku.venda_dia)}/d
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    <CoberturaCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {sku.ponto_reposicao}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {sku.compra_sugerida > 0 ? (
                      <span className="font-semibold text-primary">{sku.compra_sugerida}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <ValorEstimadoCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <FlagsCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <ParamsCell row={sku} />
                  </TableCell>
                </TableRow>
              );
            }

            // Anúncio COM variações: linha mestre + linhas filha (Collapsible)
            return (
              <Collapsible key={group.item_id} open={isExpanded} asChild>
                <>
                  <MasterRow
                    group={group}
                    expanded={isExpanded}
                    onToggle={() => toggle(group.item_id)}
                  />
                  <CollapsibleContent asChild>
                    <>
                      {group.skus.map((sku) => (
                        <VariationRow
                          key={sku.variation_id ?? sku.item_id}
                          sku={sku}
                        />
                      ))}
                    </>
                  </CollapsibleContent>
                </>
              </Collapsible>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
