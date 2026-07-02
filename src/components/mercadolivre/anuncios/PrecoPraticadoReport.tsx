import { useEffect, useMemo, useState } from "react";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ChevronsUpDown, RefreshCw, TrendingUp, Package, BarChart2, DollarSign, Activity, Gauge } from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KPICard } from "@/components/dashboard/KPICard";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PriceReportProduct {
  id: string;
  title: string;
}

type Granularity = "day" | "week" | "month";
type VolumeMetric = "qtd" | "receita";

interface SeriesRow {
  bucket: string;          // YYYY-MM-DD
  preco_medio: number;
  preco_min: number;
  preco_max: number;
  qtd: number;
  total: number;           // receita
  orders: number;
}

interface Props {
  products: PriceReportProduct[];   // anúncios com vendas no período
  mlUserIds: string[];
  fromDate: string | null;
  toDate: string | null;
  /** Produto a pré-selecionar (atalho vindo da coluna Preços). O nonce permite
   *  re-disparar a seleção mesmo que seja o mesmo item de antes. */
  request?: { itemId: string; nonce: number } | null;
}

// ── Formatters ───────────────────────────────────────────────────────────────

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const brlCompact = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : brl(v);
const intFmt = (v: number) => v.toLocaleString("pt-BR");

function bucketLabel(iso: string, g: Granularity): string {
  const d = parseISO(iso);
  if (g === "month") return format(d, "MMM/yy", { locale: ptBR });
  return format(d, "dd/MM", { locale: ptBR });
}

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Diária", week: "Semanal", month: "Mensal",
};

// Tooltip que mostra sempre os três indicadores do período, independente da
// métrica exibida nas barras.
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as SeriesRow & { label: string };
  const Row = ({ k, v, accent }: { k: string; v: string; accent?: boolean }) => (
    <p className="flex justify-between gap-6">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-semibold tabular-nums", accent && "text-primary")}>{v}</span>
    </p>
  );
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{d.label}</p>
      <Row k="Preço médio" v={brl(d.preco_medio)} />
      <Row k="Qtd vendida" v={intFmt(d.qtd)} />
      <Row k="Receita" v={brl(d.total)} accent />
      {d.preco_min !== d.preco_max && (
        <p className="mt-0.5 flex justify-between gap-6 text-[10px] text-muted-foreground">
          <span>Faixa de preço</span><span>{brl(d.preco_min)} – {brl(d.preco_max)}</span>
        </p>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrecoPraticadoReport({ products, mlUserIds, fromDate, toDate, request }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(request?.itemId ?? products[0]?.id ?? null);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [volumeMetric, setVolumeMetric] = useState<VolumeMetric>("qtd");
  const [rows, setRows] = useState<SeriesRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Mantém uma seleção válida quando a lista de produtos muda (troca de período/loja).
  useEffect(() => {
    if (products.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !products.some((p) => p.id === selectedId)) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  // Atalho vindo da coluna Preços (Produtos Vendidos): pré-seleciona o anúncio.
  useEffect(() => {
    if (request?.itemId) setSelectedId(request.itemId);
  }, [request]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  useEffect(() => {
    if (!selectedId) { setRows(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      // RPC ainda não presente nos tipos gerados — cast como no restante do projeto.
      const { data, error } = await (supabase.rpc as any)("orders_price_timeseries", {
        _item_id: selectedId,
        _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
        _from: fromDate,
        _to: toDate,
        _granularity: granularity,
      });
      if (cancelled) return;
      if (error) {
        console.warn("orders_price_timeseries:", error.message);
        setRows([]);
      } else {
        setRows(
          (data ?? []).map((r: any) => ({
            bucket: String(r.bucket),
            preco_medio: Number(r.preco_medio ?? 0),
            preco_min: Number(r.preco_min ?? 0),
            preco_max: Number(r.preco_max ?? 0),
            qtd: Number(r.qtd ?? 0),
            total: Number(r.total ?? 0),
            orders: Number(r.orders ?? 0),
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate, granularity]);

  const chartData = useMemo(
    () => (rows ?? []).map((r) => ({ ...r, label: bucketLabel(r.bucket, granularity) })),
    [rows, granularity],
  );

  const kpis = useMemo(() => {
    const rs = rows ?? [];
    const qtd = rs.reduce((s, r) => s + r.qtd, 0);
    const receita = rs.reduce((s, r) => s + r.total, 0);
    const precoMedio = qtd > 0 ? receita / qtd : 0;
    const mins = rs.filter((r) => r.preco_min > 0).map((r) => r.preco_min);
    const precoMin = mins.length ? Math.min(...mins) : 0;
    const precoMax = rs.length ? Math.max(...rs.map((r) => r.preco_max)) : 0;
    const variacao = precoMin > 0 ? ((precoMax - precoMin) / precoMin) * 100 : 0;

    // Número de dias do período (para as médias diárias). Usa o intervalo
    // selecionado quando definido; senão, o span das datas com vendas.
    let dias = 1;
    if (fromDate && toDate) {
      dias = Math.max(1, differenceInCalendarDays(parseISO(toDate), parseISO(fromDate)) + 1);
    } else if (rs.length) {
      const buckets = rs.map((r) => r.bucket).sort();
      dias = Math.max(1, differenceInCalendarDays(parseISO(buckets[buckets.length - 1]), parseISO(buckets[0])) + 1);
    }
    const qtdDiaria = qtd / dias;
    const receitaDiaria = receita / dias;

    return { qtd, receita, precoMedio, precoMin, precoMax, variacao, qtdDiaria, receitaDiaria };
  }, [rows, fromDate, toDate]);

  const hasData = (rows?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Seletor de anúncio */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline" role="combobox" size="sm"
              className="h-8 justify-between gap-2 text-xs min-w-[220px] max-w-[420px]"
              disabled={products.length === 0}
            >
              <span className="truncate">
                {selectedProduct ? selectedProduct.title : "Selecione um anúncio"}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(440px,calc(100vw-1.5rem))] p-0">
            <Command>
              <CommandInput placeholder="Buscar anúncio por título ou ID…" className="text-xs" />
              <CommandList>
                <CommandEmpty>Nenhum anúncio com vendas no período.</CommandEmpty>
                <CommandGroup>
                  {products.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.title} ${p.id}`}
                      onSelect={() => { setSelectedId(p.id); setPickerOpen(false); }}
                      className="text-xs data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                    >
                      <Check className={cn("mr-2 h-3.5 w-3.5", selectedId === p.id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{p.title}</span>
                      <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{p.id}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Granularidade + Métrica agrupados (A-08: ficam juntos ao quebrar linha) */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Granularidade */}
          <ToggleGroup
            type="single" size="sm" value={granularity}
            onValueChange={(v) => v && setGranularity(v as Granularity)}
            className="h-8"
          >
            {(["day", "week", "month"] as Granularity[]).map((g) => (
              <ToggleGroupItem key={g} value={g} className="h-7 px-2.5 text-xs">
                {GRANULARITY_LABELS[g]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* Métrica de volume nas barras */}
          <ToggleGroup
            type="single" size="sm" value={volumeMetric}
            onValueChange={(v) => v && setVolumeMetric(v as VolumeMetric)}
            className="h-8"
          >
            <ToggleGroupItem value="qtd" className="h-7 px-2.5 text-xs">Qtd</ToggleGroupItem>
            <ToggleGroupItem value="receita" className="h-7 px-2.5 text-xs">Receita</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard title="Preço médio (período)" value={brl(kpis.precoMedio)} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" />
        <KPICard title="Faixa de preço" value={kpis.precoMin > 0 ? `${brl(kpis.precoMin)} – ${brl(kpis.precoMax)}` : "—"} subtitle={kpis.variacao > 0 ? `variação ${kpis.variacao.toFixed(0)}%` : undefined} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" />
        <KPICard title="Qtd vendida" value={intFmt(kpis.qtd)} icon={<Package className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-primary/10 text-primary" />
        <KPICard title="Média diária (Qtd)" value={kpis.qtdDiaria.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} icon={<Activity className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]" />
        <KPICard title="Receita" value={brl(kpis.receita)} icon={<BarChart2 className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" />
        <KPICard title="Receita média diária" value={brl(kpis.receitaDiaria)} icon={<Gauge className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-sky-500/10 text-sky-500" />
      </div>

      {/* Gráfico */}
      <Card>
        <CardContent className="pt-4 pb-4">
          {loading ? (
            <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando…
            </div>
          ) : !selectedId ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              <Package className="w-8 h-8 opacity-40" />
              Nenhum anúncio com vendas no período selecionado.
            </div>
          ) : !hasData ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              <BarChart2 className="w-8 h-8 opacity-40" />
              Sem vendas deste anúncio no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                {/* Eixo esquerdo: volume (qtd ou receita) */}
                <YAxis
                  yAxisId="vol" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => (volumeMetric === "receita" ? brlCompact(v) : intFmt(v))}
                  width={volumeMetric === "receita" ? 56 : 40}
                />
                {/* Eixo direito: preço médio (R$) */}
                <YAxis
                  yAxisId="preco" orientation="right" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => brlCompact(v)} width={56}
                />
                <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.25 }} />
                <Bar
                  yAxisId="vol"
                  dataKey={volumeMetric === "receita" ? "total" : "qtd"}
                  name={volumeMetric === "receita" ? "total" : "qtd"}
                  fill="hsl(var(--primary))" fillOpacity={0.22} radius={[3, 3, 0, 0]} maxBarSize={48}
                />
                <Line
                  yAxisId="preco" type="monotone" dataKey="preco_medio" name="preco_medio"
                  stroke="hsl(var(--accent))" strokeWidth={2.2}
                  dot={{ r: 2.5, fill: "hsl(var(--accent))" }} activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {hasData && (
            <p className="mt-2 text-[10px] text-muted-foreground text-center">
              Barras = {volumeMetric === "receita" ? "receita" : "quantidade vendida"} · Linha = preço médio praticado ·
              granularidade {GRANULARITY_LABELS[granularity].toLowerCase()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
