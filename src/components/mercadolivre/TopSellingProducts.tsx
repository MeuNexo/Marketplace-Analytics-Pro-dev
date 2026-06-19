import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Trophy, ExternalLink, AlertTriangle, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import * as XLSX from "xlsx";
import * as React from "react";

export interface ProductSalesRow {
  item_id: string;
  title: string;
  thumbnail: string | null;
  qty_sold: number;
  revenue: number;
  available_quantity?: number;
  _marketplace?: string;
}

interface Props {
  products: ProductSalesRow[];
  loading?: boolean;
  showOrigin?: boolean;
}

const currencyFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MP_BADGE: Record<string, { label: string; cls: string }> = {
  "mercado-livre": { label: "ML", cls: "border-yellow-500 text-yellow-600" },
  amazon: { label: "Amazon", cls: "border-orange-500 text-orange-600" },
  shopee: { label: "Shopee", cls: "border-red-500 text-red-600" },
};

export function TopSellingProducts({ products, loading, showOrigin }: Props) {
  const visibleProducts = products.slice(0, 10);

  const handleExport = () => {
    if (!products.length) return;
    const rows = products.map((p, i) => ({
      "#": i + 1,
      "Item ID": p.item_id,
      "Título": p.title,
      "Loja": p._marketplace ? (MP_BADGE[p._marketplace]?.label ?? p._marketplace) : "—",
      "Qtd. Vendida": p.qty_sold,
      "Receita (R$)": Number(p.revenue.toFixed(2)),
      "Estoque": p.available_quantity ?? "Sem estoque",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 5 }, { wch: 16 }, { wch: 70 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ranking de anúncios");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `ranking-anuncios-${stamp}.xlsx`);
  };

  if (loading) {
    return (
      <Card className="h-full flex flex-col">
        <div className="px-4 pt-4 pb-2">
          <span className="text-sm font-medium text-foreground">Ranking de anúncios</span>
        </div>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-4 bg-muted rounded animate-pulse" />
                <div className="w-10 h-10 bg-muted rounded-lg animate-pulse" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Ranking de anúncios</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExport}
          disabled={!products.length}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          title="Exportar todos os anúncios para Excel"
        >
          <Download className="w-3.5 h-3.5 mr-1" />
          Exportar
        </Button>
      </div>
      <CardContent className="flex-1 p-0 flex flex-col">
        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nenhum produto encontrado"
            description="Sincronize suas vendas para ver os produtos mais vendidos."
            size="compact"
          />
        ) : (
          <div className="divide-y divide-border flex flex-col flex-1">
            {visibleProducts.map((product, idx) => (
              <div
                key={product.item_id}
                className={`flex items-center gap-3 px-4 flex-1 ${idx === 0 ? "bg-[hsl(45,93%,47%)]/5" : idx === 1 ? "bg-[hsl(0,0%,66%)]/5" : idx === 2 ? "bg-[hsl(25,60%,50%)]/5" : ""}`}
              >
                <span
                  className={`text-sm font-bold w-5 text-center shrink-0 ${idx === 0 ? "text-[hsl(45,93%,47%)]" : idx === 1 ? "text-[hsl(0,0%,66%)]" : idx === 2 ? "text-[hsl(25,60%,50%)]" : "text-muted-foreground"}`}
                >
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
                </span>
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                  {product.thumbnail ? (
                    <img
                      src={product.thumbnail.replace("http://", "https://")}
                      alt={product.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight line-clamp-2">{product.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{product.qty_sold} vendidos</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs font-semibold text-primary">{currencyFmt(product.revenue)}</span>
                    {showOrigin && product._marketplace && MP_BADGE[product._marketplace] && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${MP_BADGE[product._marketplace].cls}`}>
                        {MP_BADGE[product._marketplace].label}
                      </Badge>
                    )}
                  </div>
                </div>
                <a
                  href={`https://produto.mercadolivre.com.br/${product.item_id.replace(/^(MLB)(\d+)$/, "$1-$2")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground/30 hover:text-primary transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-[10px] text-muted-foreground mb-0.5">Estoque</span>
                  {product.available_quantity === undefined ? (
                    <Badge variant="destructive" className="text-xs flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Sem estoque
                    </Badge>
                  ) : (
                    <Badge variant={product.available_quantity <= 5 ? "secondary" : "outline"} className="text-xs">
                      {product.available_quantity} un.
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
