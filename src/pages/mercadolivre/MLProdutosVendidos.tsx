import { useMemo, useState, useCallback } from "react";
import { ShoppingBag, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useMLMarginWithAds } from "@/hooks/useMLMarginWithAds";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import {
  aggregateMcoGroups,
  aggregateMcoItems,
  type McoProductRow,
  type PvMcoGroup,
  type PvMcoItem,
} from "@/components/mercadolivre/anuncios/soldProductsMcoAgg";
import { classifyMcoHealth, mcoHealthRole, type McoHealth, type McoColorRole } from "@/lib/mcoHealth";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

// ─── Formatters ───────────────────────────────────────────────────────────────

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const intFmt = (v: number) => v.toLocaleString("pt-BR");

const pctFmt = (v: number | null) => (v !== null ? `${v.toFixed(1)}%` : "—");

// ─── Semáforo MCO — role → classes CVD-safe (tokens do projeto) ───────────────

const MCO_ROLE_CLASSES: Record<McoColorRole, { dot: string; text: string }> = {
  good: { dot: "bg-success", text: "text-success" },
  warning: { dot: "bg-warning", text: "text-warning" },
  critical: { dot: "bg-destructive", text: "text-destructive" },
  neutral: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

// ─── Ordenação ────────────────────────────────────────────────────────────────

type SortKey = "qty" | "revenue" | "mcoPct" | "acosPct" | "estoque" | "share";
type SortDir = "asc" | "desc";

const COLUMN_LABEL: Record<SortKey, string> = {
  qty: "Qtd",
  revenue: "Receita",
  mcoPct: "MCO%",
  acosPct: "% Ads",
  estoque: "Estoque",
  share: "% Grupo",
};

function sortValue(item: PvMcoItem, key: SortKey, stock: number | null): number | null {
  switch (key) {
    case "qty":
      return item.qty;
    case "revenue":
      return item.revenue;
    case "mcoPct":
      return item.mcoPct;
    case "acosPct":
      return item.acosPct;
    case "estoque":
      return stock;
    case "share":
      return item.shareOfGroup;
  }
}

// ─── Célula/badge de MCO% (semáforo + rótulo + tooltip de quebra de custos) ───

function McoCell({ item }: { item: PvMcoItem }) {
  const role = mcoHealthRole(item.health);
  const cls = MCO_ROLE_CLASSES[role];
  const label = item.hasCmv ? pctFmt(item.mcoPct) : "—";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 cursor-default">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cls.dot}`} aria-hidden="true" />
          <span className={`text-xs font-medium tabular-nums ${cls.text}`}>{label}</span>
          {!item.hasCmv && (
            <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[240px] space-y-1">
        {!item.hasCmv && (
          <p className="font-medium text-warning">Sem custo cadastrado — MCO indefinido</p>
        )}
        <p>
          MCO {brl(item.mcoReais)} · Ads {brl(item.adsSpend)} · Comissão {brl(item.comissao)} · Frete{" "}
          {brl(item.frete)} · Imposto {brl(item.impostos)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Badge de MCO% do grupo (painel esquerdo + cabeçalho-resumo) ─────────────

function GroupMcoBadge({
  mcoPct,
  hasMissingCost,
  size = "sm",
}: {
  mcoPct: number | null;
  hasMissingCost: boolean;
  size?: "sm" | "md";
}) {
  const health: McoHealth = classifyMcoHealth(mcoPct);
  const role = mcoHealthRole(health);
  const cls = MCO_ROLE_CLASSES[role];
  const textSize = size === "md" ? "text-sm" : "text-[11px]";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-default">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cls.dot}`} aria-hidden="true" />
          <span className={`${textSize} font-medium tabular-nums ${cls.text}`}>{pctFmt(mcoPct)}</span>
          {hasMissingCost && (
            <AlertCircle className="w-2.5 h-2.5 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[220px]">
        {hasMissingCost
          ? "MCO% inclui anúncios sem custo cadastrado — pode estar impreciso."
          : "MCO% médio pós-ads do grupo (Σlucro pós-ads ÷ Σreceita)."}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Header de coluna ordenável (tabela desktop) ─────────────────────────────

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
    );
  }
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-foreground" />
  ) : (
    <ArrowDown className="w-3 h-3 text-foreground" />
  );
}

function SortHead({
  sortKey: key,
  currentKey,
  currentDir,
  onSort,
  tooltip,
}: {
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  tooltip?: string;
}) {
  const isActive = currentKey === key;
  const label = COLUMN_LABEL[key];

  const content = (
    <span
      className="inline-flex items-center gap-1 justify-end cursor-pointer select-none group"
      onClick={() => onSort(key)}
    >
      {label}
      <SortIndicator active={isActive} dir={currentDir} />
    </span>
  );

  return (
    <th className="py-2 text-right font-medium pr-4">
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        content
      )}
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MLProdutosVendidos() {
  // ── Estado local ──────────────────────────────────────────────────────────
  const [pvView, setPvView] = useState<"marca" | "categoria">("marca");
  const [pvSelected, setPvSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Contextos ─────────────────────────────────────────────────────────────
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

  // ── Hook de dados — margem pós-ads por anúncio (fonte única) ───────────────
  // Fase 212: a publicidade destas linhas é a fatura do ML rateada por anúncio,
  // não mais o gasto do relatório de publicidade. `margem.ads` diz a origem.
  const { data: margem, isLoading } = useMLMarginWithAds(currentFrom, currentTo);

  // Produtos VENDIDOS: descarta linhas ads-only (unidades=0, gasto de ads sem venda).
  // O rateio já foi feito no hook sobre a carteira INTEIRA — filtrar aqui não
  // distorce a proporção de quem vendeu.
  const rows: McoProductRow[] = useMemo(
    () => (margem?.rows ?? []).filter((r) => r.unidades > 0),
    [margem],
  );

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

  // ── Grupos e itens derivados client-side (agregação pós-ads, fonte 83-01) ──
  const pvGroups: PvMcoGroup[] = useMemo(
    () => aggregateMcoGroups(rows, pvView, itemsMap),
    [rows, pvView, itemsMap],
  );

  const pvItemsRaw: PvMcoItem[] = useMemo(
    () => (pvSelected !== null ? aggregateMcoItems(rows, pvSelected, pvView, itemsMap) : []),
    [rows, pvSelected, pvView, itemsMap],
  );

  const selectedGroup = useMemo(
    () => (pvSelected !== null ? (pvGroups.find((g) => g.key === pvSelected) ?? null) : null),
    [pvGroups, pvSelected],
  );

  // ── Ordenação estável, nulls (MCO%/ACoS indefinidos) sempre ao fim ─────────
  const pvItems = useMemo(() => {
    const withStock = pvItemsRaw.map((item) => ({
      item,
      stock: itemsMap.get(item.item_id)?.available_quantity ?? null,
    }));

    const dirMul = sortDir === "asc" ? 1 : -1;

    withStock.sort((a, b) => {
      const va = sortValue(a.item, sortKey, a.stock);
      const vb = sortValue(b.item, sortKey, b.stock);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dirMul;
    });

    return withStock;
  }, [pvItemsRaw, itemsMap, sortKey, sortDir]);

  // Clicar no header ativo alterna asc/desc; clicar em outro header troca a coluna
  // (default desc, comportamento de "maior primeiro" ao entrar numa coluna nova).
  const onSortClick = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey],
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

      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ShoppingBag className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhum produto vendido no período.</p>
        </div>
      )}

      {/* ── Painel duplo ── */}
      {!isLoading && rows.length > 0 && (
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
                          <span className="shrink-0 flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {brl(g.revenue)}
                            </span>
                            <GroupMcoBadge mcoPct={g.mcoPct} hasMissingCost={g.hasMissingCost} />
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
                  : (selectedGroup?.name ?? pvSelected)}
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
                  {/* ── Cabeçalho-resumo do grupo selecionado ── */}
                  {selectedGroup && (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/40 bg-muted/30 px-4 py-3 mb-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Receita total
                        </p>
                        <p className="text-sm font-semibold tabular-nums">{brl(selectedGroup.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          MCO% médio
                        </p>
                        <GroupMcoBadge
                          mcoPct={selectedGroup.mcoPct}
                          hasMissingCost={selectedGroup.hasMissingCost}
                          size="md"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Anúncios no vermelho
                        </p>
                        <p
                          className={[
                            "text-sm font-semibold tabular-nums",
                            selectedGroup.redCount > 0 ? "text-destructive" : "text-foreground",
                          ].join(" ")}
                        >
                          {selectedGroup.redCount}
                        </p>
                      </div>
                      {selectedGroup.hasMissingCost && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Alguns anúncios sem custo cadastrado — MCO% pode estar impreciso.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Desktop: tabela ordenável ── */}
                  <div className="hidden lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40 text-xs text-muted-foreground">
                          <th className="py-2 text-left font-medium">Anúncio</th>
                          <SortHead
                            sortKey="qty"
                            currentKey={sortKey}
                            currentDir={sortDir}
                            onSort={onSortClick}
                          />
                          <SortHead
                            sortKey="revenue"
                            currentKey={sortKey}
                            currentDir={sortDir}
                            onSort={onSortClick}
                          />
                          <SortHead
                            sortKey="mcoPct"
                            currentKey={sortKey}
                            currentDir={sortDir}
                            onSort={onSortClick}
                            tooltip={KPI_GLOSSARY.mco.definition}
                          />
                          <SortHead
                            sortKey="acosPct"
                            currentKey={sortKey}
                            currentDir={sortDir}
                            onSort={onSortClick}
                            tooltip={KPI_GLOSSARY.acos.definition}
                          />
                          <SortHead
                            sortKey="estoque"
                            currentKey={sortKey}
                            currentDir={sortDir}
                            onSort={onSortClick}
                          />
                          <th className="py-2 text-right font-medium">
                            <span
                              className="inline-flex items-center gap-1 justify-end cursor-pointer select-none group"
                              onClick={() => onSortClick("share")}
                            >
                              % Grupo
                              <SortIndicator active={sortKey === "share"} dir={sortDir} />
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pvItems.map(({ item, stock }) => {
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
                              <td className="py-2.5 text-right pr-4">
                                <McoCell item={item} />
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums text-muted-foreground">
                                {pctFmt(item.acosPct)}
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums text-muted-foreground">
                                {stock !== null ? intFmt(stock) : "—"}
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
                    {pvItems.map(({ item, stock }) => {
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
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div>
                              <span className="text-muted-foreground">Qtd vendida</span>
                              <p className="font-medium tabular-nums">{intFmt(item.qty)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Receita</span>
                              <p className="font-medium tabular-nums">{brl(item.revenue)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">MCO%</span>
                              <p className="font-medium tabular-nums">
                                <McoCell item={item} />
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">% Ads</span>
                              <p className="font-medium tabular-nums">{pctFmt(item.acosPct)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Estoque</span>
                              <p className="font-medium tabular-nums">
                                {stock !== null ? intFmt(stock) : "—"}
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
