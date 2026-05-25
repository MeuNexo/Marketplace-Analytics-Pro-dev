import { memo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductSalesRow } from "./TopSellingProducts";

interface MLTopProductsProps {
  products: (ProductSalesRow & { _marketplace?: string })[];
  marginMap?: Map<string, number>;
}

function MLTopProductsImpl({ products, marginMap }: MLTopProductsProps) {
  return (
    <motion.div className="lg:col-span-4" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
      <Card className="h-full">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Top Anúncios</span>
          <span className="text-[10px] text-muted-foreground">top {Math.min(products.length, 5)}</span>
        </div>
        <CardContent className="px-4 pb-4">
          {products.length > 0 ? (
            <div className="space-y-0">
              <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <span className="w-5" />
                <span className="w-7" />
                <span className="flex-1">Produto</span>
                <span className="w-14 text-right">Vendidos</span>
                <span className="w-20 text-right">Receita</span>
                <span className="w-12 text-right">% Part.</span>
                <span className="w-16 text-right">Margem (%)</span>
                <span className="w-14 text-right">Estoque</span>
              </div>
              {(() => {
                const top5 = products.slice(0, 5);
                const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
                return top5.map((p, i) => {
                  const medals = ["🥇", "🥈", "🥉"];
                  const medal = i < 3 ? medals[i] : null;
                  const share = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;
                  return (
                    <div key={p.item_id || i} className="flex items-center gap-2 py-1.5 border-b border-border/30 last:border-0">
                      <span className="w-5 text-center text-xs font-semibold text-muted-foreground">
                        {medal ?? `${i + 1}`}
                      </span>
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" loading="lazy" decoding="async" className="w-7 h-7 rounded object-cover flex-shrink-0" />
                      ) : (
                        <span className="w-7 h-7 rounded bg-muted flex-shrink-0" />
                      )}
                      {p.item_id ? (
                        <a
                          href={`https://produto.mercadolivre.com.br/${p.item_id.replace(/^(MLB)(\d+)/, "$1-$2")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-foreground truncate flex-1 leading-tight hover:text-primary hover:underline transition-colors"
                        >
                          {p.title}
                        </a>
                      ) : (
                        <span className="text-xs text-foreground truncate flex-1 leading-tight">{p.title}</span>
                      )}
                      <span className="w-14 text-right text-xs font-semibold tabular-nums text-foreground">
                        {p.qty_sold.toLocaleString("pt-BR")}
                      </span>
                      <span className="w-20 text-right text-xs font-semibold tabular-nums text-foreground">
                        {p.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                        {share.toFixed(1)}%
                      </span>
                      {(() => {
                        const margin = marginMap?.get(p.item_id);
                        if (margin == null) return <span className="w-16 text-right text-[10px] text-muted-foreground">—</span>;
                        const positive = margin >= 0;
                        return (
                          <span className={`w-16 text-right text-xs font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}>
                            {margin.toFixed(1)}%
                          </span>
                        );
                      })()}
                      <span className="w-14 text-right text-[10px] text-muted-foreground whitespace-nowrap">
                        {p.available_quantity != null ? `${p.available_quantity} un` : "—"}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Sem dados</div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export const MLTopProducts = memo(MLTopProductsImpl);
