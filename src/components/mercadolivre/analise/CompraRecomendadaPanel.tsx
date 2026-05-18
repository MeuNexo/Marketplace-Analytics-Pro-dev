import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  calcularCompra,
  type StockInputs,
  type Multiplicador,
} from "@/lib/analysis/compraUtils";
import type { AnalysisSnapshot } from "@/hooks/useAnalysisSnapshots";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompraRecomendadaPanelProps {
  snapshots: AnalysisSnapshot[];
}

// ── Default stock inputs ──────────────────────────────────────────────────────

const DEFAULT_INPUTS: StockInputs = {
  diasCobertura: 30,
  estoqueTotal: 0,
  estoqueFull: 0,
  estoqueCasa: 0,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CompraRecomendadaPanel({ snapshots }: CompraRecomendadaPanelProps) {
  const [multiplicador, setMultiplicador] = useState<Multiplicador>(1.0);
  const [stockInputs, setStockInputs] = useState<Record<string, StockInputs>>({});

  // Helper: returns stored inputs merged with defaults (never mutates state until user types)
  const getInputs = useCallback(
    (id: string): StockInputs => ({
      ...DEFAULT_INPUTS,
      ...(stockInputs[id] ?? {}),
    }),
    [stockInputs],
  );

  // Derived: recalculate on snapshots, stockInputs, or multiplicador change
  const results = useMemo(() => {
    const map: Record<string, ReturnType<typeof calcularCompra>> = {};
    for (const snapshot of snapshots) {
      map[snapshot.id] = calcularCompra(snapshot, getInputs(snapshot.id), multiplicador);
    }
    return map;
  }, [snapshots, stockInputs, multiplicador]); // eslint-disable-line react-hooks/exhaustive-deps

  // Input update handler — preserves other fields via spread
  function updateStock(snapshotId: string, field: keyof StockInputs, rawValue: string) {
    const parsed = Number(rawValue);
    const value = isNaN(parsed) || rawValue === "" ? 0 : parsed;
    setStockInputs((prev) => ({
      ...prev,
      [snapshotId]: {
        ...DEFAULT_INPUTS,
        ...(prev[snapshotId] ?? {}),
        [field]: value,
      },
    }));
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-medium whitespace-nowrap">
            Recomendações de Compra
          </CardTitle>
          <Select
            value={String(multiplicador)}
            onValueChange={(v) => setMultiplicador(Number(v) as Multiplicador)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Normal ×1,0</SelectItem>
              <SelectItem value="1.2">Campanha leve ×1,2</SelectItem>
              <SelectItem value="1.5">Data forte ×1,5</SelectItem>
              <SelectItem value="2">Live–oferta ×2,0</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {snapshots.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">Sem produtos analisados.</div>
        ) : (
          <div className="space-y-4">
            {snapshots.map((snapshot) => {
              const inputs = getInputs(snapshot.id);
              const result = results[snapshot.id];

              return (
                <div
                  key={snapshot.id}
                  className="grid grid-cols-12 gap-2 items-end"
                >
                  {/* Col 1-3: Product name + brand badge */}
                  <div className="col-span-3 space-y-1">
                    <p className="text-xs font-medium truncate" title={snapshot.productTitle}>
                      {snapshot.productTitle}
                    </p>
                    {snapshot.brand && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        {snapshot.brand}
                      </Badge>
                    )}
                  </div>

                  {/* Col 4: Cobertura (dias) */}
                  <div className="col-span-2 space-y-1">
                    <label className="block text-xs text-muted-foreground">
                      Cobertura (dias)
                    </label>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-xs"
                      value={inputs.diasCobertura}
                      onChange={(e) => updateStock(snapshot.id, "diasCobertura", e.target.value)}
                    />
                  </div>

                  {/* Col 6: Est. Total */}
                  <div className="col-span-2 space-y-1">
                    <label className="block text-xs text-muted-foreground">
                      Est. Total
                    </label>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-xs"
                      value={inputs.estoqueTotal}
                      onChange={(e) => updateStock(snapshot.id, "estoqueTotal", e.target.value)}
                    />
                  </div>

                  {/* Col 8: Est. FULL */}
                  <div className="col-span-2 space-y-1">
                    <label className="block text-xs text-muted-foreground">
                      Est. FULL
                    </label>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-xs"
                      value={inputs.estoqueFull}
                      onChange={(e) => updateStock(snapshot.id, "estoqueFull", e.target.value)}
                    />
                  </div>

                  {/* Col 10: Est. Casa/CD */}
                  <div className="col-span-1 space-y-1">
                    <label className="block text-xs text-muted-foreground">
                      Est. Casa/CD
                    </label>
                    <Input
                      type="number"
                      min="0"
                      className="h-8 text-xs"
                      value={inputs.estoqueCasa}
                      onChange={(e) => updateStock(snapshot.id, "estoqueCasa", e.target.value)}
                    />
                  </div>

                  {/* Col 11-12: Read-only outputs */}
                  {result && (
                    <div className="col-span-2 space-y-0.5 pb-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span
                          className={
                            result.compraRecomendada > 0
                              ? "text-xs text-emerald-600 font-semibold"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          Compra: {result.compraRecomendada} unid.
                        </span>
                        {result.fallbackUsed && (
                          <span className="text-xs text-muted-foreground">(usando GMV)</span>
                        )}
                      </div>
                      <div className="text-xs text-blue-600">
                        FULL: {result.sugestaoFull} unid.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CompraRecomendadaPanel;
