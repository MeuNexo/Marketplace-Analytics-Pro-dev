import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check, ChevronsUpDown, RefreshCw, TrendingUp, Package, BarChart2,
  DollarSign, Gauge, Percent, AlertTriangle,
} from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { KPICard } from "@/components/dashboard/KPICard";
import { computeMco } from "@/lib/mco";
import {
  computePrecoMcoSeries,
  type AdsDailyRow,
  type McoSeriesPoint,
  type PrecoSeriesRow,
  type SeriesGranularity,
} from "@/lib/precoMcoSeries";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PriceReportProduct {
  id: string;
  title: string;
}

type Granularity = SeriesGranularity;

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
const pctFmt = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function bucketLabel(iso: string, g: Granularity): string {
  const d = parseISO(iso);
  if (g === "month") return format(d, "MMM/yy", { locale: ptBR });
  return format(d, "dd/MM", { locale: ptBR });
}

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Diária", week: "Semanal", month: "Mensal",
};

// Tooltip com a decomposição por unidade: preço, break-even, MCO R$/un, MCO %
// e cada componente do custo (transparência total — nada escondido).
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as McoSeriesPoint & { label: string };
  const mcoUnit = d.precoUnit - d.breakevenUnit;
  const Row = ({ k, v, accent, danger, muted }: {
    k: string; v: string; accent?: boolean; danger?: boolean; muted?: boolean;
  }) => (
    <p className={cn("flex justify-between gap-6", muted && "text-[10px]")}>
      <span className="text-muted-foreground">{k}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        accent && "text-success", danger && "text-destructive",
        muted && "font-normal text-muted-foreground",
      )}>{v}</span>
    </p>
  );
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{d.label}</p>
      <Row k="Unidades" v={intFmt(d.qtd)} />
      <Row k="Preço" v={brl(d.precoUnit)} />
      <Row k="Break-even" v={brl(d.breakevenUnit)} />
      <Row k="MCO R$/un" v={brl(mcoUnit)} accent={mcoUnit >= 0} danger={mcoUnit < 0} />
      <Row k="MCO %" v={pctFmt(d.mcoPct)} accent={(d.mcoPct ?? 0) >= 0 && d.mcoPct != null} danger={(d.mcoPct ?? 0) < 0} />
      <div className="mt-1 border-t border-border pt-1">
        <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Por unidade</p>
        <Row k="Custo" v={brl(d.cmvUnit)} muted />
        <Row k="Comissão" v={brl(d.comissaoUnit)} muted />
        <Row k="Frete" v={brl(d.freteUnit)} muted />
        <Row k="Ads" v={brl(d.adsUnit)} muted />
        <Row k="Imposto" v={brl(d.impostoUnit)} muted />
      </div>
      {(d.custoAusente || d.impostoAusente) && (
        <p className="mt-1 text-[10px] text-warning">
          {d.custoAusente && "custo ausente em parte das unidades"}
          {d.custoAusente && d.impostoAusente && " · "}
          {d.impostoAusente && "imposto ausente em parte das unidades"}
        </p>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrecoPraticadoReport({ products, mlUserIds, fromDate, toDate, request }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(request?.itemId ?? products[0]?.id ?? null);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [incluirAds, setIncluirAds] = useState(true);
  const [rows, setRows] = useState<PrecoSeriesRow[] | null>(null);
  const [adsDaily, setAdsDaily] = useState<AdsDailyRow[]>([]);
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

  // Série de preço/custos por bucket (RPC estendida — 13 colunas).
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
            qtd: Number(r.qtd ?? 0),
            total: Number(r.total ?? 0),
            cmv: Number(r.cmv ?? 0),
            comissao: Number(r.comissao ?? 0),
            frete: Number(r.frete ?? 0),
            qtd_sem_custo: Number(r.qtd_sem_custo ?? 0),
            impostos: Number(r.impostos ?? 0),
            qtd_sem_imposto: Number(r.qtd_sem_imposto ?? 0),
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate, granularity]);

  // Spend diário de ads do item (ml_ads_products_cache — RLS org-first isola;
  // cobertura ausente => array vazio => ads=0 silencioso). Não depende da
  // granularidade: a bucketização é feita no util (evita refetch à toa).
  useEffect(() => {
    if (!selectedId) { setAdsDaily([]); return; }
    let cancelled = false;
    (async () => {
      let query = supabase
        .from("ml_ads_products_cache")
        .select("spend, date")
        .eq("item_id", selectedId)
        .range(0, 4999); // PostgREST trunca em 1000 sem range explícito
      if (mlUserIds && mlUserIds.length > 0) query = query.in("ml_user_id", mlUserIds);
      if (fromDate) query = query.gte("date", fromDate);
      if (toDate) query = query.lte("date", toDate);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        console.warn("ml_ads_products_cache:", error.message);
        setAdsDaily([]);
      } else {
        setAdsDaily(
          (data ?? [])
            .filter((r: any) => r.date != null)
            .map((r: any) => ({ date: String(r.date), spend: Number(r.spend ?? 0) })),
        );
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate]);

  // Série de MCO pronta para o gráfico (util puro do 79-01).
  const serie = useMemo(
    () => computePrecoMcoSeries(rows ?? [], { adsDaily, incluirAds, granularity }),
    [rows, adsDaily, incluirAds, granularity],
  );

  const chartData = useMemo(
    () => serie.map((p) => ({ ...p, label: bucketLabel(p.bucket, granularity) })),
    [serie, granularity],
  );

  const kpis = useMemo(() => {
    const rs = rows ?? [];
    const qtd = rs.reduce((s, r) => s + r.qtd, 0);
    const receita = rs.reduce((s, r) => s + r.total, 0);
    const cmv = rs.reduce((s, r) => s + r.cmv, 0);
    const comissao = rs.reduce((s, r) => s + r.comissao, 0);
    const frete = rs.reduce((s, r) => s + r.frete, 0);
    const impostos = rs.reduce((s, r) => s + r.impostos, 0);
    // Ads dos buckets exibidos (já zerado pelo util quando o toggle está OFF) —
    // reconcilia os KPIs com a série do gráfico.
    const adsBucket = serie.reduce((s, p) => s + p.ads, 0);

    const precoMedio = qtd > 0 ? receita / qtd : 0;
    const breakevenMedio = qtd > 0 ? (cmv + comissao + frete + adsBucket + impostos) / qtd : 0;
    const { mco, pct } = computeMco({
      grossRevenue: receita,
      cmv,
      platformCost: comissao + frete,
      ads: adsBucket,
      tax: impostos,
    });

    const qtdSemCusto = rs.reduce((s, r) => s + r.qtd_sem_custo, 0);
    const temImpostoAusente = rs.some((r) => r.qtd_sem_imposto > 0);

    return { qtd, receita, precoMedio, breakevenMedio, mco, mcoPct: pct, qtdSemCusto, temImpostoAusente };
  }, [rows, serie]);

  const hasData = (rows?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Controles (flex-wrap: paridade mobile/desktop — lição Phase 78) */}
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

        {/* Granularidade + toggle de ads agrupados (wrap responsivo) */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
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

          {/* Toggle "incluir ads" (padrão Switch+Label do ReplenishmentPanel) */}
          <div className="flex items-center gap-2">
            <Switch
              id="incluir-ads"
              checked={incluirAds}
              onCheckedChange={setIncluirAds}
            />
            <Label htmlFor="incluir-ads" className="text-xs text-muted-foreground cursor-pointer">
              Incluir publicidade
            </Label>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard title="Preço médio" value={brl(kpis.precoMedio)} icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent" />
        <KPICard title="Break-even médio" value={brl(kpis.breakevenMedio)} icon={<Gauge className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" />
        <KPICard title="MCO (R$)" value={brl(kpis.mco)} icon={<TrendingUp className="w-4 h-4" />} variant="minimal" size="compact" iconClassName={kpis.mco >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"} />
        <KPICard
          title="MCO %"
          value={pctFmt(kpis.mcoPct)}
          icon={<Percent className="w-4 h-4" />}
          variant={kpis.mcoPct != null && kpis.mcoPct >= 0 ? "success" : "danger"}
          size="compact"
        />
        <KPICard title="Qtd vendida" value={intFmt(kpis.qtd)} icon={<Package className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-primary/10 text-primary" />
        <KPICard title="Receita" value={brl(kpis.receita)} icon={<BarChart2 className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-success/10 text-success" />
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
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={chartData} margin={{ left: 4, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                {/* Eixo esquerdo: R$/un (preço, break-even e colchão) */}
                <YAxis
                  yAxisId="preco" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => brlCompact(v)} width={56}
                />
                {/* Eixo direito: MCO % */}
                <YAxis
                  yAxisId="mco" orientation="right" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`}
                  width={44}
                />
                {/* Terceiro eixo OCULTO: escala própria das unidades vendidas
                    (não desenha ticks nem eixo — os dois eixos visíveis ficam limpos) */}
                <YAxis yAxisId="qtd" hide />
                <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }} />
                {/* Legenda com payload explícito: lista só as séries visíveis e
                    representa as 3 Areas técnicas (base/gainBand/lossBand) como
                    um único item "Margem". Wrap responsivo p/ paridade mobile. */}
                <Legend
                  verticalAlign="bottom"
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  payload={[
                    { value: "Preço praticado", type: "line", id: "precoUnit", color: "hsl(var(--accent))" },
                    { value: "Break-even", type: "line", id: "breakevenUnit", color: "hsl(var(--muted-foreground))" },
                    { value: "MCO %", type: "line", id: "mcoPct", color: "hsl(var(--primary))" },
                    { value: "Unidades vendidas", type: "line", id: "qtd", color: "hsl(var(--muted-foreground))" },
                    { value: "Margem (verde=positiva, vermelho=negativa)", type: "rect", id: "band", color: "hsl(var(--success))" },
                  ]}
                />

                {/* Base invisível — empurra as bandas até min(preço, break-even).
                    type="linear" nas bandas e linhas de preço/break-even: evita
                    overshoot cúbico nos cruzamentos (pitfall do research). */}
                <Area
                  yAxisId="preco" type="linear" dataKey="base" stackId="mco"
                  stroke="none" fill="transparent" isAnimationActive={false}
                />
                {/* Colchão verde — preço ≥ break-even */}
                <Area
                  yAxisId="preco" type="linear" dataKey="gainBand" stackId="mco"
                  stroke="none" fill="hsl(var(--success))" fillOpacity={0.25}
                  isAnimationActive={false}
                />
                {/* Colchão vermelho — preço < break-even */}
                <Area
                  yAxisId="preco" type="linear" dataKey="lossBand" stackId="mco"
                  stroke="none" fill="hsl(var(--destructive))" fillOpacity={0.25}
                  isAnimationActive={false}
                />

                <Line
                  yAxisId="preco" type="linear" dataKey="precoUnit" name="precoUnit"
                  stroke="hsl(var(--accent))" strokeWidth={2.2}
                  dot={{ r: 2.5, fill: "hsl(var(--accent))" }} activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="preco" type="linear" dataKey="breakevenUnit" name="breakevenUnit"
                  stroke="hsl(var(--muted-foreground))" strokeWidth={1.5}
                  strokeDasharray="5 4" dot={false}
                />
                <Line
                  yAxisId="mco" type="monotone" dataKey="mcoPct" name="mcoPct"
                  stroke="hsl(var(--primary))" strokeWidth={2} dot={false}
                />
                {/* Linha DISCRETA de unidades vendidas (escala oculta própria).
                    Sem dash para não confundir com o break-even tracejado. */}
                <Line
                  yAxisId="qtd" type="monotone" dataKey="qtd" name="Unidades vendidas"
                  stroke="hsl(var(--muted-foreground))" strokeWidth={1}
                  strokeOpacity={0.5} dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}

          {/* Avisos de dado ausente (nunca inventar número) */}
          {hasData && (kpis.qtdSemCusto > 0 || kpis.temImpostoAusente) && (
            <div className="mt-2 space-y-0.5">
              {kpis.qtdSemCusto > 0 && (
                <p className="flex items-center justify-center gap-1 text-[10px] text-warning">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  custo ausente em {intFmt(kpis.qtdSemCusto)} un — break-even subestimado
                </p>
              )}
              {kpis.temImpostoAusente && (
                <p className="flex items-center justify-center gap-1 text-[10px] text-warning">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  regime fiscal não configurado em parte das vendas — imposto pode estar subestimado
                </p>
              )}
            </div>
          )}

          {/* Rodapé de transparência */}
          {hasData && (
            <p className="mt-2 text-[10px] text-muted-foreground text-center">
              Linha sólida = preço praticado · linha tracejada = break-even · colchão verde/vermelho = MCO por unidade ·
              linha do eixo direito = MCO% · Ads = relatório diário de publicidade (melhor esforço; ausente = 0) ·
              imposto pelo regime configurado · granularidade {GRANULARITY_LABELS[granularity].toLowerCase()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
