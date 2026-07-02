import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Check, ChevronsUpDown, RefreshCw, Package, BarChart2,
  DollarSign, Percent, AlertTriangle, Target,
} from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LabelList,
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { KPICard } from "@/components/dashboard/KPICard";
import {
  computePrecoMcoSeries,
  computePreviousWindow,
  computePriceKpis,
  percentDelta,
  pointDelta,
  type AdsDailyRow,
  type McoSeriesPoint,
  type PrecoSeriesRow,
  type PriceKpis,
  type SeriesGranularity,
} from "@/lib/precoMcoSeries";
import {
  computePrecoFaixas,
  computeVeredicto,
  classificarSaude,
  type FaixaMode,
  type FaixaPreco,
  type SaudePreco,
} from "@/lib/precoFaixas";

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
// precoFaixas.ts expressa margem como FRAÇÃO (0-1), diferente de McoSeriesPoint.mcoPct
// (já em escala 0-100 vindo de computeMco). Formatter dedicado evita multiplicar 2x.
const pctFraction = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function bucketLabel(iso: string, g: Granularity): string {
  const d = parseISO(iso);
  if (g === "month") return format(d, "MMM/yy", { locale: ptBR });
  return format(d, "dd/MM", { locale: ptBR });
}

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Diária", week: "Semanal", month: "Mensal",
};

// Cores de margem do histograma (tokens dedicados — CVD/contraste validados na skill
// dataviz, ver src/index.css). Cor NUNCA é o único sinal: toda barra leva rótulo de
// margem % (LabelList), então o WARN de contraste/CVD do validador é aceitável.
const SAUDE_COLOR: Record<SaudePreco, string> = {
  saudavel: "hsl(var(--chart-margin-saudavel))",
  apertada: "hsl(var(--chart-margin-apertada))",
  prejuizo: "hsl(var(--chart-margin-prejuizo))",
  "sem-dados": "hsl(var(--muted-foreground))",
};

const SAUDE_KPI_VARIANT: Record<SaudePreco, "success" | "warning" | "danger" | "neutral"> = {
  saudavel: "success", apertada: "warning", prejuizo: "danger", "sem-dados": "neutral",
};

// Tooltip com a decomposição por unidade: preço, break-even, MCO R$/un, MCO %
// e cada componente do custo (transparência total — nada escondido).
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as McoSeriesPoint & { label: string };
  const mcoUnit = d.precoUnit - d.breakevenUnit;
  const Row = ({ k, v, accent, danger, muted, dotColor }: {
    k: string; v: string; accent?: boolean; danger?: boolean; muted?: boolean; dotColor?: string;
  }) => (
    <p className={cn("flex justify-between gap-6", muted && "text-[10px]")}>
      <span className="text-muted-foreground flex items-center gap-1.5">
        {dotColor && (
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
        )}
        {k}
      </span>
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
      <Row k="Preço" v={brl(d.precoUnit)} dotColor="hsl(var(--chart-price))" />
      <Row k="Break-even" v={brl(d.breakevenUnit)} dotColor="hsl(var(--chart-breakeven))" />
      <Row k="MCO R$/un" v={brl(mcoUnit)} accent={mcoUnit >= 0} danger={mcoUnit < 0} />
      <Row k="MCO %" v={pctFmt(d.mcoPct)} accent={(d.mcoPct ?? 0) >= 0 && d.mcoPct != null} danger={(d.mcoPct ?? 0) < 0} dotColor="hsl(var(--chart-mco))" />
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

// Tooltip simples do gráfico de barras — só unidades vendidas do bucket.
function BarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as McoSeriesPoint & { label: string };
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{d.label}</p>
      <p className="flex justify-between gap-6">
        <span className="text-muted-foreground">Unidades</span>
        <span className="font-semibold tabular-nums">{intFmt(d.qtd)}</span>
      </p>
    </div>
  );
}

// Tooltip do histograma de faixas — preço médio, unidades, margem %, MCO R$, receita.
function FaixaTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const f = payload[0].payload as FaixaPreco & { saude: SaudePreco };
  const margemNegativa = f.mcoPctMedio != null && f.mcoPctMedio < 0;
  const Row = ({ k, v, accent, danger }: { k: string; v: string; accent?: boolean; danger?: boolean }) => (
    <p className="flex justify-between gap-6">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-semibold tabular-nums", accent && "text-success", danger && "text-destructive")}>{v}</span>
    </p>
  );
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">
        {f.label}
        {f.isPrecoAtual && <span className="ml-1 text-[10px] text-muted-foreground">· seu preço recente</span>}
      </p>
      <Row k="Preço médio" v={brl(f.precoMedio)} />
      <Row k="Unidades" v={intFmt(f.unidades)} />
      <Row k="Margem" v={pctFraction(f.mcoPctMedio)} accent={!margemNegativa && f.mcoPctMedio != null} danger={margemNegativa} />
      <Row k="MCO R$" v={brl(f.mcoRsTotal)} accent={f.mcoRsTotal >= 0} danger={f.mcoRsTotal < 0} />
      <Row k="Receita" v={brl(f.receita)} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrecoPraticadoReport({ products, mlUserIds, fromDate, toDate, request }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(request?.itemId ?? products[0]?.id ?? null);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [incluirAds, setIncluirAds] = useState(true);
  const [rows, setRows] = useState<PrecoSeriesRow[] | null>(null);
  const [dailyRows, setDailyRows] = useState<PrecoSeriesRow[] | null>(null);
  const [adsDaily, setAdsDaily] = useState<AdsDailyRow[]>([]);
  const [prevRows, setPrevRows] = useState<PrecoSeriesRow[] | null>(null);
  const [prevAdsDaily, setPrevAdsDaily] = useState<AdsDailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [faixaMode, setFaixaMode] = useState<FaixaMode>("unidades");

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

  // Série de preço/custos por bucket (RPC estendida — 13 colunas). Busca o
  // período atual e o período anterior (mesma duração, imediatamente antes)
  // em paralelo, para o comparativo dos KPIs. Serve SÓ a aba "Evolução no
  // tempo" — a visão principal (histograma) usa o fetch diário dedicado abaixo.
  useEffect(() => {
    if (!selectedId) { setRows(null); setPrevRows(null); return; }
    let cancelled = false;
    const mapRows = (data: any): PrecoSeriesRow[] =>
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
      }));
    const fetchWindow = (_from: string | null, _to: string | null) =>
      // RPC ainda não presente nos tipos gerados — cast como no restante do projeto.
      (supabase.rpc as any)("orders_price_timeseries", {
        _item_id: selectedId,
        _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
        _from,
        _to,
        _granularity: granularity,
      });
    (async () => {
      setLoading(true);
      const prev = computePreviousWindow(fromDate, toDate);
      const [curRes, prevRes] = await Promise.all([
        fetchWindow(fromDate, toDate),
        prev ? fetchWindow(prev.from, prev.to) : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      if (curRes.error) {
        console.warn("orders_price_timeseries:", curRes.error.message);
        setRows([]);
      } else {
        setRows(mapRows(curRes.data));
      }
      if (!prev) {
        setPrevRows(null);
      } else if (prevRes.error) {
        console.warn("orders_price_timeseries (período anterior):", prevRes.error.message);
        setPrevRows([]);
      } else {
        setPrevRows(mapRows(prevRes.data));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate, granularity]);

  // Fetch diário dedicado ao histograma de faixas — SEMPRE granularidade "day",
  // independente do toggle de granularidade (que agora serve só a aba temporal).
  // Reagrupamento por faixa de preço precisa de pontos diários (computePrecoFaixas).
  useEffect(() => {
    if (!selectedId) { setDailyRows(null); return; }
    let cancelled = false;
    const mapRows = (data: any): PrecoSeriesRow[] =>
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
      }));
    (async () => {
      setLoadingDaily(true);
      const res = await (supabase.rpc as any)("orders_price_timeseries", {
        _item_id: selectedId,
        _ml_user_ids: mlUserIds && mlUserIds.length > 0 ? mlUserIds : null,
        _from: fromDate,
        _to: toDate,
        _granularity: "day",
      });
      if (cancelled) return;
      if (res.error) {
        console.warn("orders_price_timeseries (diário/histograma):", res.error.message);
        setDailyRows([]);
      } else {
        setDailyRows(mapRows(res.data));
      }
      setLoadingDaily(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate]);

  // Spend diário de ads do item (ml_ads_products_cache — RLS org-first isola;
  // cobertura ausente => array vazio => ads=0 silencioso). Não depende da
  // granularidade: a bucketização é feita no util (evita refetch à toa).
  // Busca o período atual e o anterior em paralelo (comparativo dos KPIs).
  // Serve tanto a série temporal (rows) quanto o histograma (dailyRows).
  useEffect(() => {
    if (!selectedId) { setAdsDaily([]); setPrevAdsDaily([]); return; }
    let cancelled = false;
    const mapAds = (data: any): AdsDailyRow[] =>
      (data ?? [])
        .filter((r: any) => r.date != null)
        .map((r: any) => ({ date: String(r.date), spend: Number(r.spend ?? 0) }));
    const fetchWindow = (_from: string | null, _to: string | null) => {
      let query = supabase
        .from("ml_ads_products_cache")
        .select("spend, date")
        .eq("item_id", selectedId)
        .range(0, 4999); // PostgREST trunca em 1000 sem range explícito
      if (mlUserIds && mlUserIds.length > 0) query = query.in("ml_user_id", mlUserIds);
      if (_from) query = query.gte("date", _from);
      if (_to) query = query.lte("date", _to);
      return query;
    };
    (async () => {
      const prev = computePreviousWindow(fromDate, toDate);
      const [curRes, prevRes] = await Promise.all([
        fetchWindow(fromDate, toDate),
        prev ? fetchWindow(prev.from, prev.to) : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      if (curRes.error) {
        console.warn("ml_ads_products_cache:", curRes.error.message);
        setAdsDaily([]);
      } else {
        setAdsDaily(mapAds(curRes.data));
      }
      if (!prev) {
        setPrevAdsDaily([]);
      } else if (prevRes.error) {
        console.warn("ml_ads_products_cache (período anterior):", prevRes.error.message);
        setPrevAdsDaily([]);
      } else {
        setPrevAdsDaily(mapAds(prevRes.data));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, mlUserIds, fromDate, toDate]);

  // Série de MCO pronta para o gráfico temporal (util puro do 79-01).
  const serie = useMemo(
    () => computePrecoMcoSeries(rows ?? [], { adsDaily, incluirAds, granularity }),
    [rows, adsDaily, incluirAds, granularity],
  );

  const chartData = useMemo(
    () => serie.map((p) => ({ ...p, label: bucketLabel(p.bucket, granularity) })),
    [serie, granularity],
  );

  // Pontos diários (util do 80-01) → faixas de preço → veredito determinístico.
  const dailyPoints = useMemo(
    () => computePrecoMcoSeries(dailyRows ?? [], { adsDaily, incluirAds, granularity: "day" }),
    [dailyRows, adsDaily, incluirAds],
  );
  const faixasResult = useMemo(
    () => computePrecoFaixas(dailyPoints, { mode: faixaMode }),
    [dailyPoints, faixaMode],
  );
  const veredicto = useMemo(
    () => computeVeredicto(faixasResult, faixaMode),
    [faixasResult, faixaMode],
  );
  const faixasChartData = useMemo(
    () => faixasResult.faixas.map((f) => ({ ...f, saude: classificarSaude(f.mcoPctMedio) })),
    [faixasResult],
  );

  const kpis = useMemo(() => {
    const rs = rows ?? [];
    const base = computePriceKpis(rs, { adsDaily, incluirAds, granularity });

    // Avisos de dado ausente — não fazem parte do util (não entram no comparativo).
    const qtdSemCusto = rs.reduce((s, r) => s + r.qtd_sem_custo, 0);
    const temImpostoAusente = rs.some((r) => r.qtd_sem_imposto > 0);

    return { ...base, qtdSemCusto, temImpostoAusente };
  }, [rows, adsDaily, incluirAds, granularity]);

  // KPIs do período anterior (mesma duração, imediatamente antes) — comparativo.
  const prevKpis = useMemo<PriceKpis | null>(
    () =>
      prevRows && prevRows.length > 0
        ? computePriceKpis(prevRows, { adsDaily: prevAdsDaily, incluirAds, granularity })
        : null,
    [prevRows, prevAdsDaily, incluirAds, granularity],
  );

  // Deltas vs período anterior — % para preço/break-even/MCO R$/qtd/receita,
  // pontos percentuais (p.p.) para MCO %. null quando não há dados anteriores.
  const deltas = useMemo(() => {
    if (!prevKpis) return null;
    return {
      precoMedio: percentDelta(kpis.precoMedio, prevKpis.precoMedio),
      breakevenMedio: percentDelta(kpis.breakevenMedio, prevKpis.breakevenMedio),
      mco: percentDelta(kpis.mco, prevKpis.mco),
      qtd: percentDelta(kpis.qtd, prevKpis.qtd),
      receita: percentDelta(kpis.receita, prevKpis.receita),
      mcoPp: pointDelta(kpis.mcoPct, prevKpis.mcoPct),
    };
  }, [kpis, prevKpis]);

  // Texto secundário do comparativo — "—" sem dados anteriores; senão sinal +
  // valor + unidade (% ou p.p.) colorido conforme direção (neutra quando o
  // sentido "bom/ruim" é ambíguo, ex.: aumento de preço/break-even).
  function comparativoNode(
    delta: number | null,
    unidade: "pct" | "pp",
    cor: "direcional" | "neutra",
  ) {
    if (delta == null) {
      return <span className="text-[10px] text-muted-foreground">— vs período anterior</span>;
    }
    const sign = delta > 0 ? "+" : "";
    const valor = delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    const sufixo = unidade === "pp" ? " p.p." : "%";
    const texto = `${sign}${valor}${sufixo} vs período anterior`;
    const classeCor =
      cor === "neutra"
        ? "text-muted-foreground"
        : delta > 0
          ? "text-success"
          : delta < 0
            ? "text-destructive"
            : "text-muted-foreground";
    return <span className={cn("text-[10px]", classeCor)}>{texto}</span>;
  }

  const hasData = (rows?.length ?? 0) > 0;
  const hasDailyData = (dailyRows?.length ?? 0) > 0;

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

        {/* Toggle "incluir ads" — afeta histograma E aba temporal */}
        <div className="flex items-center gap-2 ml-auto">
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

      {/* KPIs — 4 focados na pergunta "em que preço vendo bem", com comparativo
          vs período anterior onde existe delta (Faixa campeã não tem delta). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Preço recente"
          value={faixasResult.precoRecente != null ? brl(faixasResult.precoRecente) : "—"}
          subtitleNode={comparativoNode(deltas?.precoMedio ?? null, "pct", "neutra")}
          icon={<DollarSign className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-accent/10 text-accent"
        />
        <KPICard
          title="Margem recente %"
          value={pctFraction(faixasResult.margemRecentePct)}
          subtitleNode={comparativoNode(deltas?.mcoPp ?? null, "pp", "direcional")}
          icon={<Percent className="w-4 h-4" />}
          variant={SAUDE_KPI_VARIANT[veredicto.saude]}
          size="compact"
        />
        <KPICard
          title="Faixa campeã"
          value={faixasResult.faixaOtima?.label ?? "—"}
          subtitle={
            faixasResult.faixaOtima
              ? faixaMode === "unidades"
                ? `${intFmt(faixasResult.faixaOtima.unidades)} un`
                : brl(faixasResult.faixaOtima.mcoRsTotal)
              : undefined
          }
          icon={<Target className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]"
        />
        <KPICard
          title="Unidades no período"
          value={intFmt(faixasResult.totalUnidades)}
          subtitleNode={comparativoNode(deltas?.qtd ?? null, "pct", "direcional")}
          icon={<Package className="w-4 h-4" />} variant="minimal" size="compact" iconClassName="bg-primary/10 text-primary"
        />
      </div>

      {/* Histograma de faixas — visão principal: "em que preço eu vendo bem?" */}
      <Card>
        <CardContent className="pt-4 pb-4">
          {loadingDaily ? (
            <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Carregando…
            </div>
          ) : !selectedId ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              <Package className="w-8 h-8 opacity-40" />
              Nenhum anúncio com vendas no período selecionado.
            </div>
          ) : !hasDailyData ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              <BarChart2 className="w-8 h-8 opacity-40" />
              Sem vendas deste anúncio no período.
            </div>
          ) : (
            <>
              {/* Cartão-veredito — leitura de 3 segundos, template determinístico. */}
              <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <p className="flex items-start gap-2 text-sm">
                  <span
                    className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: SAUDE_COLOR[veredicto.saude] }}
                  />
                  <span>{veredicto.saudeTexto}</span>
                </p>
                <p className="pl-4 text-sm text-muted-foreground">{veredicto.otimoTexto}</p>
              </div>

              {/* Toggle Unidades ↔ Lucro R$ — troca a altura das barras e o veredito. */}
              <div className="mb-2 flex items-center justify-end">
                <ToggleGroup
                  type="single" size="sm" value={faixaMode}
                  onValueChange={(v) => v && setFaixaMode(v as FaixaMode)}
                  className="h-8"
                >
                  <ToggleGroupItem value="unidades" className="h-7 px-2.5 text-xs">Unidades</ToggleGroupItem>
                  <ToggleGroupItem value="lucro" className="h-7 px-2.5 text-xs">Lucro R$</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={faixasChartData} margin={{ left: 4, right: 8, top: 24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                  <YAxis
                    fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => (faixaMode === "lucro" ? brlCompact(v) : intFmt(v))}
                    width={56} allowDecimals={false}
                  />
                  <RechartsTooltip content={<FaixaTooltip />} cursor={{ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 }} />
                  <Bar dataKey="altura" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {faixasChartData.map((f, i) => (
                      <Cell
                        key={`${f.label}-${i}`}
                        fill={SAUDE_COLOR[f.saude]}
                        fillOpacity={f.unidades > 0 ? 0.85 : 0.3}
                        stroke={f.isPrecoAtual ? "hsl(var(--foreground))" : "none"}
                        strokeWidth={f.isPrecoAtual ? 2 : 0}
                      />
                    ))}
                    {/* Rótulo de margem % em TODA barra (inclusive outlier e faixas vazias)
                        — cor nunca é o único sinal (acessibilidade, spec §2). Marca "seu
                        preço recente" acima da barra correspondente. */}
                    <LabelList
                      dataKey="altura"
                      content={(props: any) => {
                        const { x, y, width, index } = props;
                        const f = faixasChartData[index];
                        if (!f || x == null || y == null || width == null) return null;
                        const cx = Number(x) + Number(width) / 2;
                        return (
                          <g>
                            {f.isPrecoAtual && (
                              <text x={cx} y={Number(y) - 16} textAnchor="middle" fontSize={9} fontWeight={600} fill="hsl(var(--foreground))">
                                seu preço
                              </text>
                            )}
                            <text x={cx} y={Number(y) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">
                              {pctFraction(f.mcoPctMedio)}
                            </text>
                          </g>
                        );
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Avisos de dado ausente (nunca inventar número) */}
              {(kpis.qtdSemCusto > 0 || kpis.temImpostoAusente) && (
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

              {/* Rodapé de transparência — descreve a nova visão principal. */}
              <p className="mt-2 text-[10px] text-muted-foreground text-center">
                Eixo X = faixas de preço · altura = {faixaMode === "unidades" ? "unidades vendidas" : "lucro (MCO R$) total"} na faixa ·
                cor = margem (verde saudável / âmbar apertada / vermelho prejuízo, sempre com % no topo) ·
                faixa vazia = preço não testado no período · barra "+R$X" agrega os preços mais altos (outliers) ·
                Ads = relatório diário de publicidade (melhor esforço; ausente = 0) · imposto pelo regime configurado
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Aba secundária recolhida — gráfico temporal da Phase 79 preservado
          intacto para quem quiser investigar "minha margem caiu porque o
          custo subiu em maio". Toggle de granularidade e fetch `rows` servem
          SÓ esta aba. */}
      <Accordion type="single" collapsible className="rounded-xl border border-border bg-card">
        <AccordionItem value="evolucao" className="border-none">
          <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline">
            Evolução no tempo
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
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
            </div>

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
                    yAxisId="mco" orientation="right" fontSize={11} tick={{ fill: "hsl(var(--chart-mco))" }}
                    tickFormatter={(v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`}
                    width={44}
                  />
                  <RechartsTooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.3 }} />
                  {/* Legenda com payload explícito: 5 itens nítidos — 3 linhas
                      (cores distintas via tokens --chart-*) + 2 bandas de margem.
                      Wrap responsivo p/ paridade mobile. */}
                  <Legend
                    verticalAlign="bottom"
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    payload={[
                      { value: "Preço praticado", type: "line", id: "precoUnit", color: "hsl(var(--chart-price))" },
                      { value: "Break-even", type: "line", id: "breakevenUnit", color: "hsl(var(--chart-breakeven))" },
                      { value: "MCO %", type: "line", id: "mcoPct", color: "hsl(var(--chart-mco))" },
                      { value: "Margem positiva", type: "rect", id: "gainBand", color: "hsl(var(--success))" },
                      { value: "Margem negativa", type: "rect", id: "lossBand", color: "hsl(var(--destructive))" },
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
                    stroke="hsl(var(--chart-price))" strokeWidth={2.2}
                    dot={{ r: 2.5, fill: "hsl(var(--chart-price))" }} activeDot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="preco" type="linear" dataKey="breakevenUnit" name="breakevenUnit"
                    stroke="hsl(var(--chart-breakeven))" strokeWidth={2}
                    strokeDasharray="5 4" dot={false}
                  />
                  <Line
                    yAxisId="mco" type="monotone" dataKey="mcoPct" name="mcoPct"
                    stroke="hsl(var(--chart-mco))" strokeWidth={2} dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {/* Gráfico de barras — unidades vendidas por bucket, alinhado ao
                gráfico principal (mesmas margens/larguras de eixo). */}
            {hasData && !loading && selectedId && (
              <div className="mt-1">
                <p className="mt-2 mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground text-center">
                  Unidades vendidas por período
                </p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chartData} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                    <YAxis fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} width={56} />
                    {/* Espaçador direito invisível — casa com o eixo MCO% (width 44) do principal */}
                    <YAxis orientation="right" width={44} hide />
                    <RechartsTooltip
                      content={<BarTooltip />}
                      cursor={{ fill: "hsl(var(--muted-foreground))", fillOpacity: 0.08 }}
                    />
                    <Bar dataKey="qtd" name="Unidades vendidas"
                      fill="hsl(var(--primary))" fillOpacity={0.55}
                      radius={[3, 3, 0, 0]} isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {hasData && (
              <p className="mt-2 text-[10px] text-muted-foreground text-center">
                Linha sólida = preço praticado · linha tracejada = break-even · colchão verde/vermelho = MCO por unidade ·
                linha do eixo direito = MCO% · Ads = relatório diário de publicidade (melhor esforço; ausente = 0) ·
                imposto pelo regime configurado · granularidade {GRANULARITY_LABELS[granularity].toLowerCase()}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
