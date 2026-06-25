import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useReplenishment } from "@/hooks/useReplenishment";
import type { ReplenishmentRow } from "@/hooks/useReplenishment";

// ─── Formatters ──────────────────────────────────────────────────────────────

const currencyFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const numFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

// ─── Sub-components ──────────────────────────────────────────────────────────

function CoberturaCell({ row }: { row: ReplenishmentRow }) {
  if (row.sem_giro || row.cobertura_atual == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span>{numFmt(row.cobertura_atual)}d</span>;
}

function ValorEstimadoCell({ row }: { row: ReplenishmentRow }) {
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
  return <span className="tabular-nums font-medium">{currencyFmt(row.valor_estimado)}</span>;
}

function FlagsCell({ row }: { row: ReplenishmentRow }) {
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

function ParamsCell({ row }: { row: ReplenishmentRow }) {
  const origem =
    row.param_origem === "marca" ? (
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

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReplenishmentPanel() {
  const { data, isLoading, error } = useReplenishment();
  const [apenasAtivos, setApenasAtivos] = useState(true);

  const rows: ReplenishmentRow[] = apenasAtivos
    ? (data ?? []).filter((r) => r.gatilho_ativo)
    : (data ?? []);

  const sorted = [...rows].sort((a, b) => b.compra_sugerida - a.compra_sugerida);

  return (
    <div className="space-y-4">
      {/* ── Aviso REPL-09: v1 não desconta compras a chegar / itens em trânsito ── */}
      <Alert className="border-warning/40 bg-warning/5">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertDescription className="text-sm">
          <strong>Limitação v1:</strong> esta sugestão de compra considera apenas o estoque atual no
          Mercado Livre. Compras a chegar (ordens de compra em trânsito) <strong>não são descontadas</strong>.
          Verifique seu estoque em trânsito antes de confirmar o pedido.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm">
              Compra Recomendada
              {data && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {apenasAtivos
                    ? `${sorted.length} com gatilho ativo de ${data.length} SKUs`
                    : `${data.length} SKUs`}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch
                id="apenas-ativos"
                checked={apenasAtivos}
                onCheckedChange={setApenasAtivos}
              />
              <Label htmlFor="apenas-ativos" className="text-xs text-muted-foreground cursor-pointer">
                Apenas gatilho ativo
              </Label>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSkeleton />
          ) : error ? (
            <div className="flex items-center gap-2 p-6 text-destructive text-sm">
              <Info className="w-4 h-4 shrink-0" />
              <span>Erro ao carregar dados de reposição. Tente recarregar a página.</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
              <Info className="w-6 h-6" />
              <span>
                {apenasAtivos
                  ? "Nenhum item com gatilho ativo no momento."
                  : "Nenhum dado de reposição disponível."}
              </span>
              {apenasAtivos && (
                <button
                  className="text-xs underline underline-offset-2 mt-1"
                  onClick={() => setApenasAtivos(false)}
                >
                  Ver todos os SKUs
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs min-w-[200px]">Produto / Marca</TableHead>
                    <TableHead className="text-xs text-right">Venda/dia</TableHead>
                    <TableHead className="text-xs text-right">Estoque</TableHead>
                    <TableHead className="text-xs text-right">Cobertura</TableHead>
                    <TableHead className="text-xs text-right">Ponto Rep.</TableHead>
                    <TableHead className="text-xs text-right">Sugestão</TableHead>
                    <TableHead className="text-xs text-right">Valor Est.</TableHead>
                    <TableHead className="text-xs">Flags</TableHead>
                    <TableHead className="text-xs">Parâmetros (origem)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => (
                    <TableRow
                      key={row.item_id}
                      className="hover:bg-muted/30"
                    >
                      {/* Produto / Marca */}
                      <TableCell className="text-xs">
                        <div className="max-w-[240px]">
                          <p className="font-medium truncate" title={row.title ?? row.item_id}>
                            {row.title ?? row.item_id}
                          </p>
                          {row.brand && (
                            <p className="text-[11px] text-muted-foreground truncate">{row.brand}</p>
                          )}
                        </div>
                      </TableCell>

                      {/* Venda/dia */}
                      <TableCell className="text-xs text-right tabular-nums">
                        {numFmt(row.venda_dia)}/d
                      </TableCell>

                      {/* Estoque atual */}
                      <TableCell className="text-xs text-right tabular-nums font-medium">
                        {row.estoque_atual}
                      </TableCell>

                      {/* Cobertura atual */}
                      <TableCell className="text-xs text-right tabular-nums">
                        <CoberturaCell row={row} />
                      </TableCell>

                      {/* Ponto de reposição */}
                      <TableCell className="text-xs text-right tabular-nums">
                        {row.ponto_reposicao}
                      </TableCell>

                      {/* Sugestão de compra (MOQ/pack já aplicados pela RPC) */}
                      <TableCell className="text-xs text-right tabular-nums">
                        {row.compra_sugerida > 0 ? (
                          <span className="font-semibold text-primary">{row.compra_sugerida}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>

                      {/* Valor estimado */}
                      <TableCell className="text-xs text-right">
                        <ValorEstimadoCell row={row} />
                      </TableCell>

                      {/* Flags */}
                      <TableCell className="text-xs">
                        <FlagsCell row={row} />
                      </TableCell>

                      {/* Parâmetros com origem */}
                      <TableCell className="text-xs">
                        <ParamsCell row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
