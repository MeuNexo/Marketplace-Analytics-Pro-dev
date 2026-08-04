import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Check, ChevronsUpDown, RefreshCw, Package, BarChart2,
  DollarSign, Percent, AlertTriangle, Target, RotateCcw,
} from "lucide-react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell, LabelList,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { KPICard } from "@/components/dashboard/KPICard";
import { resumoVariacoes, estoqueDaVariacao } from "@/lib/variacoesResumo";
import {
  computePrecoMcoSeries,
  computePreviousWindow,
  computePriceKpis,
  computeWaterfallCard,
  percentDelta,
  pointDelta,
  type McoSeriesPoint,
  type PrecoSeriesRow,
  type PriceKpis,
  type SeriesGranularity,
} from "@/lib/precoMcoSeries";
import {
  computePrecoFaixas,
  computeVeredicto,
  classificarSaude,
  COBERTURA_RISCO_DIAS,
  MIN_DIAS_CONFIANCA,
  type FaixaMode,
  type FaixaPreco,
  type SaudePreco,
} from "@/lib/precoFaixas";
import { computeMcoRecommendation } from "@/lib/pricing/mcoRecommendation";
import { classifyMcoHealth, mcoHealthRole, MCO_SAUDAVEL_PCT } from "@/lib/mcoHealth";
import { useMcoTargets } from "@/hooks/useMcoTargets";
import { useAdsRateioAnuncio } from "@/hooks/useAdsRateioAnuncio";
import { parseNumber } from "@/lib/pricing/calculator";
import {
  computeSimulatedWaterfall,
  type SimulatedInputs,
} from "@/lib/pricing/mcoSimulation";

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

// Identidade estável para o estado de carregamento do ads — um `[]` novo a cada
// render invalidaria todos os useMemo que dependem de `adsDaily`.
const EMPTY_ADS_DAILY: { date: string; spend: number }[] = [];

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

// Semáforo do card de Detalhamento de MCO (D-04) — mesmo role de mcoHealth.ts
// (Phase 83), zero divergência entre páginas. Cor nunca é sinal único (o
// Badge sempre mostra pctFmt ao lado).
const MCO_ROLE_BADGE_CLASS: Record<"critical" | "warning" | "good" | "neutral", string> = {
  critical: "border-transparent bg-destructive/15 text-destructive",
  warning: "border-transparent bg-warning/15 text-warning",
  good: "border-transparent bg-success/15 text-success",
  neutral: "border-transparent bg-muted text-muted-foreground",
};

// Linha genérica label→valor reusada pelo ChartTooltip (Phase 79) e pelo card
// de Detalhamento de MCO (Phase 101) — movida para escopo de módulo para
// evitar duplicação de JSX entre os dois consumidores (D-03: tooltip intacto).
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

// Campo editável do simulador manual de MCO (Phase 102, D-01/D-02/D-04/D-05).
// Sintetiza dois padrões já existentes no codebase: recompute ao vivo a cada
// tecla (SimuladorPrecificacao.tsx) + validação commit-time com toast+revert
// no blur/Enter (Meta MCO% inline-edit, commitMcoTargetEdit acima). Raw
// <input>, não o shadcn Input — mesma convenção do campo Meta MCO%.
function SimField({
  value, min, max, unit, seedKey, onLiveChange, onReject,
}: {
  value: number;
  min: number;
  max?: number;
  unit: "currency" | "percent";
  /** Muda SÓ quando o valor deve ser re-semeado por uma fonte externa
   *  (toggle "Simular" ligado, "Resetar", troca de item/variação) — nunca
   *  a cada tecla. Isso distingue "value mudou porque o próprio SimField
   *  chamou onLiveChange" (não deve resincronizar o draft/lastValid) de
   *  "value mudou porque simDraft inteiro foi re-semeado" (deve). */
  seedKey: number;
  onLiveChange: (v: number) => void;
  /** Chamado no commit inválido com o último valor VÁLIDO conhecido — o
   *  chamador deve restaurar esse número no campo correspondente de
   *  simDraft (não basta reverter só o texto do input; o valor que
   *  alimenta computeSimulatedWaterfall também precisa voltar). */
  onReject: (lastValid: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Último valor conhecido como VÁLIDO (commitado) — onLiveChange roda a cada
  // tecla sem gate (D-04), então `value` (vindo de simDraft) pode transitar
  // por números fora do intervalo enquanto o usuário digita; só o commit
  // (blur/Enter) decide o que é válido, e é esse número que precisa
  // sobreviver a um revert (D-05), não o `value` corrente.
  const lastValidRef = useRef(value);

  // Ressincroniza o draft SÓ quando `seedKey` muda (reseed externo real —
  // Resetar/toggle-on/troca de item), nunca a cada tecla própria (que também
  // altera `value` via onLiveChange, mas não deve reescrever lastValidRef
  // com um número ainda não validado — bug corrigido: ver docblock de
  // `seedKey` acima).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDraft(String(value));
    lastValidRef.current = value;
  }, [seedKey]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    // Live recompute (D-04): parseNumber nunca lança, degrada graciosamente —
    // seguro chamar a cada tecla.
    onLiveChange(parseNumber(raw));
  };

  const handleBlur = () => {
    const parsed = parseNumber(draft);
    const invalid = draft.trim() === "" || parsed < min || (max != null && parsed > max);
    if (invalid) {
      toast.error(
        unit === "percent"
          ? "Valor precisa estar entre 0% e 100%"
          : "Valor precisa ser maior ou igual a zero",
      );
      setDraft(String(lastValidRef.current));
      onReject(lastValidRef.current);
      return;
    }
    lastValidRef.current = parsed;
    setDraft(String(parsed));
  };

  return (
    <span className="inline-flex items-center gap-1">
      {unit === "currency" && <span className="text-[10px] text-muted-foreground">R$</span>}
      <input
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        type="text"
        inputMode="decimal"
        className="w-20 rounded border border-accent/40 bg-background px-1.5 py-0.5 text-right text-xs outline-none ring-1 ring-accent/30 tabular-nums"
      />
      {unit === "percent" && <span className="text-[10px] text-muted-foreground">%</span>}
    </span>
  );
}

// Tooltip com a decomposição por unidade: preço, break-even, MCO R$/un, MCO %
// e cada componente do custo (transparência total — nada escondido).
function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as McoSeriesPoint & { label: string };
  const mcoUnit = d.precoUnit - d.breakevenUnit;
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

// Textos de cobertura/giro reusados pelo rótulo da barra e pelo tooltip da faixa
// (precedência: sem estoque > sem giro > <1 dia > ~N dias). estoqueAtual aqui é o
// valor ÚNICO do anúncio (mesmo em todas as faixas — cenário hipotético por faixa).
function giroTexto(f: FaixaPreco): string {
  return f.giroDia != null
    ? `${f.giroDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/dia`
    : "—";
}
function coberturaTooltipTexto(f: FaixaPreco & { estoqueAtual?: number | null }): string {
  const estoque = f.estoqueAtual ?? null;
  if (estoque == null) return "—";
  if (estoque <= 0) return "sem estoque";
  if (f.giroDia == null) return "sem giro";
  if (f.coberturaDias === 0) return "menos de 1 dia";
  return `~${f.coberturaDias} dia${f.coberturaDias === 1 ? "" : "s"}`;
}
/** Rótulo curto `~Xd` na barra; null quando faixa vazia ou sem cobertura computável. */
function coberturaBarraTexto(f: FaixaPreco & { estoqueAtual?: number | null }): string | null {
  if (f.unidades <= 0 || f.coberturaDias == null) return null;
  const estoque = f.estoqueAtual ?? null;
  const base = f.coberturaDias === 0 && estoque != null && estoque > 0 ? "<1d" : `~${f.coberturaDias}d`;
  return f.baixaConfianca ? `${base}?` : base;
}

// Tooltip do histograma de faixas — preço médio, unidades, margem %, MCO R$, receita,
// giro/cobertura/estoque (Phase 81) e aviso de baixa confiança.
function FaixaTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const f = payload[0].payload as FaixaPreco & { saude: SaudePreco; estoqueAtual?: number | null };
  const margemNegativa = f.mcoPctMedio != null && f.mcoPctMedio < 0;
  const coberturaRisco = f.coberturaDias != null && f.coberturaDias < COBERTURA_RISCO_DIAS;
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
      <div className="mt-1 border-t border-border pt-1">
        <Row k="Giro" v={giroTexto(f)} />
        <Row k="Cobertura" v={coberturaTooltipTexto(f)} danger={coberturaRisco} />
        <Row k="Estoque atual" v={f.estoqueAtual != null ? `${intFmt(f.estoqueAtual)} und` : "—"} />
      </div>
      {f.baixaConfianca && (
        <p className="mt-1 text-[10px] text-warning">
          só {f.diasNaFaixa} dia{f.diasNaFaixa === 1 ? "" : "s"} de dados — estimativa fraca
        </p>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PrecoPraticadoReport({ products, mlUserIds, fromDate, toDate, request }: Props) {
  const { items: inventoryItems } = useMLInventory();
  const [selectedId, setSelectedId] = useState<string | null>(request?.itemId ?? products[0]?.id ?? null);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [incluirAds, setIncluirAds] = useState(true);
  const [rows, setRows] = useState<PrecoSeriesRow[] | null>(null);
  const [dailyRows, setDailyRows] = useState<PrecoSeriesRow[] | null>(null);
  const [prevRows, setPrevRows] = useState<PrecoSeriesRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [faixaMode, setFaixaMode] = useState<FaixaMode>("unidades");
  // Seletor de variação (Phase 82). null = "Todas as variações (anúncio)" —
  // base é sempre o anúncio pai (Phase 81 intacta) até o usuário escolher.
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  // Mantém uma seleção válida quando a lista de produtos muda (troca de período/loja).
  useEffect(() => {
    if (products.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !products.some((p) => p.id === selectedId)) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  // Reset do seletor de variação sempre que o anúncio muda (decisão LOCKED).
  useEffect(() => {
    setSelectedSku(null);
  }, [selectedId]);

  // Anúncio selecionado no MLInventoryContext (fonte de variações/estoque).
  const selectedItem = useMemo(
    () => inventoryItems.find((i) => i.id === selectedId) ?? null,
    [inventoryItems, selectedId],
  );
  // Estoque atual por anúncio (item_id) para enriquecer o seletor — ajuda a
  // distinguir anúncios "modelo novo" onde cada cor/tamanho é um MLB separado
  // (títulos quase idênticos), mostrando o saldo de cada um.
  const estoquePorId = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of inventoryItems) m.set(it.id, it.available_quantity);
    return m;
  }, [inventoryItems]);
  const variacoesInfo = useMemo(
    () => resumoVariacoes(selectedItem?.variations ?? []),
    [selectedItem],
  );
  // Opção da variação selecionada (para o badge "analisando variação: …").
  const selectedVariacaoOption = useMemo(
    () => variacoesInfo.opcoes.find((o) => o.sku === selectedSku) ?? null,
    [variacoesInfo, selectedSku],
  );

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
        _sku: selectedSku,
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
  }, [selectedId, mlUserIds, fromDate, toDate, granularity, selectedSku]);

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
        _sku: selectedSku,
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
  }, [selectedId, mlUserIds, fromDate, toDate, selectedSku]);

  // Publicidade do anúncio — régua da Fase 211 (ADS-06): o total que o Mercado
  // Livre COBROU na fatura, rateado por MLB pela proporção do relatório de
  // publicidade. Quem lê as três séries e faz o rateio é o hook; aqui só se
  // consome o resultado. Antes desta fase o componente lia o cache direto e
  // exibia ~12% do gasto real como se fosse o gasto do anúncio.
  //
  // Não depende da granularidade: a bucketização é feita no util (evita refetch
  // à toa). Serve tanto a série temporal (rows) quanto o histograma (dailyRows).
  const prevWindow = useMemo(
    () => computePreviousWindow(fromDate, toDate),
    [fromDate, toDate],
  );
  const adsRateio = useAdsRateioAnuncio(selectedId, mlUserIds, fromDate, toDate);
  const prevAdsRateio = useAdsRateioAnuncio(
    selectedId,
    mlUserIds,
    prevWindow?.from ?? null,
    prevWindow?.to ?? null,
  );
  // Array vazio como valor de carregamento — mesmo contrato que os utilitários
  // puros já recebiam (`AdsDailyRow[]`), nenhuma fórmula muda.
  const adsDaily = adsRateio.data?.daily ?? EMPTY_ADS_DAILY;
  const prevAdsDaily = prevAdsRateio.data?.daily ?? EMPTY_ADS_DAILY;
  /** De qual das duas réguas veio o número de publicidade da tela. */
  const adsSource = adsRateio.data?.source ?? null;
  /** Parte da fatura do período que nenhum anúncio pôde receber (sem chave de rateio). */
  const adsNaoRateado = adsRateio.data?.naoRateado ?? 0;
  const adsDiasSemChave = adsRateio.data?.diasSemChave.length ?? 0;

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
  // Estoque atual — DB-first via MLInventoryContext (sem fetch novo). Com
  // variação selecionada, o estoque passa a ser o DA VARIAÇÃO (join por SKU,
  // seller_custom_field — Phase 82); senão o do anúncio pai (Phase 81).
  // Ausente do cache => null; a UI/util trata null como "cobertura não
  // computável" (nunca 0).
  const estoqueAtual = useMemo(() => {
    if (selectedSku != null) {
      return estoqueDaVariacao(selectedItem?.variations ?? [], selectedSku);
    }
    return selectedItem ? selectedItem.available_quantity : null;
  }, [selectedItem, selectedSku]);
  const faixasResult = useMemo(
    () => computePrecoFaixas(dailyPoints, { mode: faixaMode, estoqueAtual }),
    [dailyPoints, faixaMode, estoqueAtual],
  );
  const veredicto = useMemo(
    () => computeVeredicto(faixasResult, faixaMode),
    [faixasResult, faixaMode],
  );
  const faixasChartData = useMemo(
    () => faixasResult.faixas.map((f) => ({
      ...f, saude: classificarSaude(f.mcoPctMedio), estoqueAtual: faixasResult.estoqueAtual,
    })),
    [faixasResult],
  );
  // Preço vigente em risco de ruptura (< COBERTURA_RISCO_DIAS) — colore a frase de
  // cobertura no cartão-veredito. Não afeta a cor da barra (saúde de margem).
  const coberturaVigenteRisco = useMemo(() => {
    const atual = faixasResult.faixas.find((f) => f.isPrecoAtual) ?? null;
    return atual?.coberturaDias != null && atual.coberturaDias < COBERTURA_RISCO_DIAS;
  }, [faixasResult]);

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

  // ── Detalhamento de MCO (Phase 101) ──────────────────────────────────────
  // Card fixo, sempre visível, waterfall por unidade + recomendação de
  // margem para o item/variação/período selecionados. Deriva de `rows`, já
  // buscado para a aba "Evolução no tempo" — nenhum refetch novo (D-01/D-02).
  const { targets: mcoTargets, keyOf: mcoKeyOf, upsert: upsertMcoTarget } = useMcoTargets();
  const mcoTargetKey = selectedId ? mcoKeyOf(selectedId, selectedSku) : null;
  const customMcoTarget = mcoTargetKey ? mcoTargets.get(mcoTargetKey) : undefined;
  const targetMcoPct = customMcoTarget ?? MCO_SAUDAVEL_PCT.green;

  const waterfallCard = useMemo(
    () => computeWaterfallCard(rows ?? [], { adsDaily, incluirAds, granularity }),
    [rows, adsDaily, incluirAds, granularity],
  );
  const mcoRecommendation = useMemo(
    () => computeMcoRecommendation(waterfallCard, targetMcoPct),
    [waterfallCard, targetMcoPct],
  );

  // ── Simulador manual de MCO (Phase 102) ──────────────────────────────────
  // "E se" ephemeral, 100% component-local (D-01..D-05). computeMcoRecommendation
  // acima SEMPRE recebe waterfallCard REAL — invariante D-04, nunca simCard.
  const [simulating, setSimulating] = useState(false);
  const [simDraft, setSimDraft] = useState<SimulatedInputs | null>(null);
  // Incrementado SÓ em reseeds externos reais (toggle ON / Resetar) — sinaliza
  // a cada SimField "resincronize seu draft/último-válido a partir de `value`
  // agora", distinto de mudanças de `value` geradas pelo próprio SimField
  // digitando (ver docblock de `seedKey` no componente SimField).
  const [simSeedKey, setSimSeedKey] = useState(0);

  const seedFromReal = useCallback(
    (card: typeof waterfallCard): SimulatedInputs => ({
      precoUnit: card.precoUnit,
      cmvUnit: card.cmvUnit,
      comissaoPct: card.precoUnit > 0 ? (card.comissaoUnit / card.precoUnit) * 100 : 0,
      freteUnit: card.freteUnit,
      impostoPct: card.precoUnit > 0 ? (card.impostoUnit / card.precoUnit) * 100 : 0,
      // Pitfall 4: nunca semear ads quando "incluir publicidade" está desligado.
      adsUnit: incluirAds ? card.adsUnit : 0,
    }),
    [incluirAds],
  );

  const handleToggleSimular = (checked: boolean) => {
    setSimulating(checked);
    // Pitfall 3: sempre reseed do card real ATUAL no momento do clique, nunca
    // um lazy initializer congelado.
    if (checked) {
      setSimDraft(seedFromReal(waterfallCard));
      setSimSeedKey((k) => k + 1);
    }
  };
  const handleResetar = () => {
    setSimDraft(seedFromReal(waterfallCard));
    setSimSeedKey((k) => k + 1);
  };

  // D-03: trocar de item/variação sempre reseta a simulação automaticamente.
  useEffect(() => {
    setSimulating(false);
    setSimDraft(null);
  }, [selectedId, selectedSku]);

  const simCard = useMemo(
    () => (simDraft ? computeSimulatedWaterfall(simDraft) : null),
    [simDraft],
  );

  const activeMcoPct = simulating && simCard ? simCard.mcoPct : waterfallCard.mcoPct;
  const mcoHealthValue = classifyMcoHealth(activeMcoPct);
  const mcoRole = mcoHealthRole(mcoHealthValue);

  // Edição inline da meta (mesmo padrão onBlur/Enter do InlineEditCell em
  // MLAnuncios.tsx — validação client-side espelha o CHECK do banco).
  const [editingMcoTarget, setEditingMcoTarget] = useState(false);
  const [mcoTargetDraft, setMcoTargetDraft] = useState("");
  const mcoTargetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingMcoTarget) mcoTargetInputRef.current?.focus();
  }, [editingMcoTarget]);

  const commitMcoTargetEdit = async () => {
    const raw = mcoTargetDraft.trim().replace(",", ".");
    const parsed = Number(raw);
    if (raw === "" || isNaN(parsed) || parsed <= 0 || parsed > 100) {
      toast.error("Meta precisa ser maior que 0% e até 100%");
      setEditingMcoTarget(false);
      return;
    }
    setEditingMcoTarget(false);
    if (selectedId) await upsertMcoTarget(selectedId, selectedSku, parsed);
  };

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
                  {products.map((p) => {
                    const estoque = estoquePorId.get(p.id);
                    return (
                      <CommandItem
                        key={p.id}
                        value={`${p.title} ${p.id}`}
                        onSelect={() => { setSelectedId(p.id); setPickerOpen(false); }}
                        className="items-start text-xs data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                      >
                        <Check className={cn("mr-2 mt-0.5 h-3.5 w-3.5 shrink-0", selectedId === p.id ? "opacity-100" : "opacity-0")} />
                        {/* título completo (2 linhas) — mostra a cor/tamanho que o truncate escondia */}
                        <span className="line-clamp-2 flex-1 leading-snug">{p.title}</span>
                        <span className="ml-auto shrink-0 pl-2 text-right">
                          {estoque !== undefined && (
                            <span className={cn(
                              "block text-[10px] font-medium tabular-nums",
                              estoque === 0 ? "text-destructive" : "text-muted-foreground",
                            )}>
                              {estoque === 0 ? "sem estoque" : `${estoque} und`}
                            </span>
                          )}
                          <span className="block text-[10px] text-muted-foreground/70">{p.id}</span>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Seletor de variação (Phase 82) — só quando o anúncio tem variações.
            Default fixo "Todas as variações (anúncio)" (value sentinela "__all__"
            porque Select não aceita value=""); troca de anúncio reseta para null. */}
        {selectedItem?.has_variations && (
          <Select
            value={selectedSku ?? "__all__"}
            onValueChange={(v) => setSelectedSku(v === "__all__" ? null : v)}
          >
            <SelectTrigger className="h-8 w-auto min-w-[200px] max-w-[320px] text-xs">
              <SelectValue placeholder="Todas as variações (anúncio)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">
                Todas as variações (anúncio)
              </SelectItem>
              {variacoesInfo.opcoes.map((o) => (
                <SelectItem key={o.sku} value={o.sku} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Badge da variação selecionada — indicador discreto de que os números
            abaixo (faixas, giro, cobertura) já são da variação, não do pai. */}
        {selectedVariacaoOption && (
          <Badge variant="secondary" className="h-6 text-[10px] font-normal">
            Analisando variação: {selectedVariacaoOption.label}
          </Badge>
        )}

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

      {/* Origem do número de publicidade (Fase 211) — a troca de régua nunca
          acontece escondida: a tela diz de onde veio o ads e quanto da fatura
          do período ficou sem chave de rateio (T-211-28). */}
      {incluirAds && adsSource != null && (
        <p className="text-[10px] text-muted-foreground">
          {adsSource === "billing-rateio" ? (
            <>
              Publicidade = fatura do Mercado Livre <strong className="font-medium">rateada por anúncio</strong>{" "}
              pela proporção do relatório de publicidade.
            </>
          ) : (
            <>
              Publicidade = relatório de publicidade — a fatura do período ainda não foi sincronizada.
            </>
          )}
          {adsNaoRateado !== 0 && (
            <span className="text-warning">
              {" "}
              {brl(adsNaoRateado)} da fatura do período ficaram sem chave de rateio em{" "}
              {intFmt(adsDiasSemChave)} dia{adsDiasSemChave === 1 ? "" : "s"} (sem gasto no relatório de
              publicidade naqueles dias) — não entram no MCO deste anúncio.
            </span>
          )}
        </p>
      )}

      {/* Aviso do nível pai (Phase 82) — anúncio com variações e nenhuma
          selecionada: o número de cobertura do pai é uma média que esconde
          rupturas por variação. */}
      {selectedItem?.has_variations && selectedSku == null && variacoesInfo.total > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Anúncio com {variacoesInfo.total} variações ({variacoesInfo.esgotadas} esgotadas) —
          selecione uma variação para cobertura precisa.
        </p>
      )}

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
                {veredicto.coberturaTexto && (
                  <p className={cn("pl-4 text-sm", coberturaVigenteRisco ? "text-destructive" : "text-muted-foreground")}>
                    {veredicto.coberturaTexto}
                  </p>
                )}
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
                        const coberturaTxt = coberturaBarraTexto(f);
                        const coberturaRisco = f.coberturaDias != null && f.coberturaDias < COBERTURA_RISCO_DIAS;
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
                            {/* Rótulo de cobertura (Phase 81) — cor NUNCA é a barra (segue
                                saúde de margem); vermelho aqui é só o texto de risco de ruptura.
                                Baixa confiança = tom esmaecido (opacity), sem esconder o dado. */}
                            {coberturaTxt && (
                              <text
                                x={cx} y={Number(y) + 13} textAnchor="middle" fontSize={9.5} fontWeight={500}
                                fill={coberturaRisco ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
                                opacity={f.baixaConfianca ? 0.6 : 1}
                              >
                                {coberturaTxt}
                              </text>
                            )}
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

              {/* Rodapé de transparência — descreve a nova visão principal + giro/cobertura (Phase 81). */}
              <p className="mt-2 text-[10px] text-muted-foreground text-center">
                Eixo X = faixas de preço · altura = {faixaMode === "unidades" ? "unidades vendidas" : "lucro (MCO R$) total"} na faixa ·
                cor = margem (verde saudável / âmbar apertada / vermelho prejuízo, sempre com % no topo) ·
                faixa vazia = preço não testado no período · barra "+R$X" agrega os preços mais altos (outliers) ·
                Ads = fatura do Mercado Livre rateada por anúncio pela proporção do relatório de publicidade
                (sem fatura sincronizada, o próprio relatório; dia sem chave de rateio fica declarado acima) ·
                imposto pelo regime configurado ·
                giro = unidades ÷ dias-com-venda naquele preço (velocidade real de venda) ·
                cobertura = estoque de hoje do anúncio ÷ giro da faixa — cenário hipotético "a esse preço, quanto dura?" ·
                cobertura em vermelho = risco de ruptura (menos de {COBERTURA_RISCO_DIAS} dias) ·
                "?" e tom esmaecido = faixa com menos de {MIN_DIAS_CONFIANCA} dias de amostra (estimativa fraca)
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detalhamento de MCO + recomendação de margem (Phase 101) — card fixo,
          sempre visível (D-01), não depende de hover; o tooltip do gráfico
          acima (ChartTooltip, Phase 79) permanece intocado (D-03). */}
      <Card className="mt-6">
        <CardContent className="pt-4 pb-4">
          {!selectedId || !hasData ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-1.5">
              <Target className="w-6 h-6 text-muted-foreground opacity-40" />
              <p className="text-sm font-medium text-muted-foreground">Sem vendas no período selecionado</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Escolha um período com vendas ou troque o anúncio/variação no seletor acima para ver o detalhamento de MCO.
              </p>
            </div>
          ) : (
            <>
              {/* 1. Header row (Phase 102: + toggle Simular / badge Simulando / Resetar) */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Target className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold">Detalhamento de MCO</span>
                  <Badge variant="outline" className={cn("text-[10px]", MCO_ROLE_BADGE_CLASS[mcoRole])}>
                    {pctFmt(activeMcoPct)}
                  </Badge>
                  <div className="flex items-center gap-2 ml-2">
                    <Switch
                      id="simular-mco"
                      checked={simulating}
                      onCheckedChange={handleToggleSimular}
                    />
                    <Label htmlFor="simular-mco" className="text-xs text-muted-foreground cursor-pointer">
                      Simular
                    </Label>
                  </div>
                  {simulating && (
                    <>
                      <Badge variant="outline" className="text-[10px] border-transparent bg-accent/15 text-accent">
                        Simulando
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-xs"
                        onClick={handleResetar}
                      >
                        <RotateCcw className="w-3 h-3" />
                        Resetar
                      </Button>
                    </>
                  )}
                </div>
                {fromDate && toDate && (
                  <span className="text-xs text-muted-foreground">
                    {format(parseISO(fromDate), "dd/MM", { locale: ptBR })} – {format(parseISO(toDate), "dd/MM", { locale: ptBR })}
                  </span>
                )}
              </div>

              {/* 2. Waterfall block — ordem fixa da cascata (D-02); Phase 102: campos
                  editáveis dentro de painel tingido quando simulating===true */}
              <div className={cn(
                "space-y-2",
                simulating && "rounded-lg bg-accent/5 border border-accent/20 p-2 -mx-2",
              )}>
                {simulating && simDraft ? (
                  <>
                    <p className="flex justify-between gap-6">
                      <span className="text-muted-foreground">Receita/un</span>
                      <SimField
                        value={simDraft.precoUnit}
                        min={0}
                        unit="currency"
                        seedKey={simSeedKey}
                        onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, precoUnit: v } : d))}
                        onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, precoUnit: lastValid } : d))}
                      />
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-muted-foreground">(−) CMV</span>
                      <SimField
                        value={simDraft.cmvUnit}
                        min={0}
                        unit="currency"
                        seedKey={simSeedKey}
                        onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, cmvUnit: v } : d))}
                        onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, cmvUnit: lastValid } : d))}
                      />
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-muted-foreground">(−) Comissão</span>
                      <SimField
                        value={simDraft.comissaoPct}
                        min={0}
                        max={100}
                        unit="percent"
                        seedKey={simSeedKey}
                        onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, comissaoPct: v } : d))}
                        onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, comissaoPct: lastValid } : d))}
                      />
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-muted-foreground">(−) Frete</span>
                      <SimField
                        value={simDraft.freteUnit}
                        min={0}
                        unit="currency"
                        seedKey={simSeedKey}
                        onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, freteUnit: v } : d))}
                        onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, freteUnit: lastValid } : d))}
                      />
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-muted-foreground">(−) Impostos</span>
                      <SimField
                        value={simDraft.impostoPct}
                        min={0}
                        max={100}
                        unit="percent"
                        seedKey={simSeedKey}
                        onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, impostoPct: v } : d))}
                        onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, impostoPct: lastValid } : d))}
                      />
                    </p>
                    <div className="border-t border-border pt-2">
                      <Row
                        k="= Margem de Contribuição/un"
                        v={simCard ? brl(simCard.mcUnit) : "—"}
                        accent={(simCard?.mcUnit ?? 0) >= 0}
                        danger={(simCard?.mcUnit ?? 0) < 0}
                      />
                    </div>
                    {incluirAds && (
                      <p className="flex justify-between gap-6">
                        <span className="text-muted-foreground">(−) Ads por venda</span>
                        <SimField
                          value={simDraft.adsUnit}
                          min={0}
                          unit="currency"
                          seedKey={simSeedKey}
                          onLiveChange={(v) => setSimDraft((d) => (d ? { ...d, adsUnit: v } : d))}
                          onReject={(lastValid) => setSimDraft((d) => (d ? { ...d, adsUnit: lastValid } : d))}
                        />
                      </p>
                    )}
                    <div className="border-t border-border pt-2">
                      <Row
                        k="= MCO/un"
                        v={`${brl(simCard?.mcoUnit ?? 0)} (${pctFmt(simCard?.mcoPct ?? null)})`}
                        accent={mcoRole === "good"}
                        danger={mcoRole === "critical"}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Row k="Receita/un" v={brl(waterfallCard.precoUnit)} />
                    <Row k="(−) CMV" v={brl(waterfallCard.cmvUnit)} />
                    <Row k="(−) Comissão" v={brl(waterfallCard.comissaoUnit)} />
                    <Row k="(−) Frete" v={brl(waterfallCard.freteUnit)} />
                    <Row k="(−) Impostos" v={brl(waterfallCard.impostoUnit)} />
                    <div className="border-t border-border pt-2">
                      <Row
                        k="= Margem de Contribuição/un"
                        v={brl(waterfallCard.mcUnit)}
                        accent={waterfallCard.mcUnit >= 0}
                        danger={waterfallCard.mcUnit < 0}
                      />
                    </div>
                    {incluirAds && <Row k="(−) Ads por venda" v={brl(waterfallCard.adsUnit)} />}
                    <div className="border-t border-border pt-2">
                      <Row
                        k="= MCO/un"
                        v={`${brl(waterfallCard.mcoUnit)} (${pctFmt(waterfallCard.mcoPct)})`}
                        accent={mcoRole === "good"}
                        danger={mcoRole === "critical"}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Régua da linha de Ads (Fase 211, ADS-07/D-04) — o ML não diz
                  qual venda veio de clique pago, então o custo é distribuído
                  entre TODAS as vendas do anúncio no período (TACoS). */}
              {incluirAds && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Ads por venda = publicidade do anúncio no período ÷ unidades vendidas do anúncio no
                  período{adsSource === "billing-rateio"
                    ? " — publicidade vinda da fatura do Mercado Livre, rateada por anúncio pela proporção do relatório de publicidade."
                    : "."}
                </p>
              )}

              {/* 3. Meta MCO% — inline-edit (D-05), pré-preenche custom se houver */}
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Meta MCO%:</span>
                  {editingMcoTarget ? (
                    <input
                      ref={mcoTargetInputRef}
                      value={mcoTargetDraft}
                      onChange={(e) => setMcoTargetDraft(e.target.value)}
                      onBlur={commitMcoTargetEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitMcoTargetEdit(); }
                        if (e.key === "Escape") setEditingMcoTarget(false);
                      }}
                      className="w-20 rounded border border-accent/40 bg-background px-1.5 py-0.5 text-right text-xs outline-none ring-1 ring-accent/30"
                      type="number"
                      step="0.1"
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-semibold tabular-nums underline decoration-dotted underline-offset-2"
                      onClick={() => {
                        setMcoTargetDraft(String(customMcoTarget ?? targetMcoPct));
                        setEditingMcoTarget(true);
                      }}
                    >
                      {pctFmt(targetMcoPct)}
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {customMcoTarget != null
                    ? "Meta personalizada deste anúncio"
                    : "Usando padrão do semáforo (≥ 9% saudável)"}
                </p>
              </div>

              {/* 4. Recomendação (D-07/D-08) — sempre visível, mesmo com MCO saudável */}
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs text-muted-foreground">Preço mínimo para a meta</p>
                    {mcoRecommendation.metaImpraticavel ? (
                      <p className="text-xs text-destructive">Meta impraticável com os custos atuais deste item</p>
                    ) : (
                      <p className="text-xl font-semibold tabular-nums">{brl(mcoRecommendation.precoMinimo as number)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs text-muted-foreground">ACOS-alvo da campanha (mantendo o preço atual)</p>
                    {mcoRecommendation.acosInatingivel ? (
                      <p className="text-xs text-destructive">Meta inatingível mesmo sem gastar em ads</p>
                    ) : (
                      <p className="text-xl font-semibold tabular-nums">{pctFmt(mcoRecommendation.acosMeta)}</p>
                    )}
                  </div>
                </div>
                {simulating && (
                  <p className="text-[10px] text-muted-foreground">
                    Preço mínimo e ACOS-alvo continuam calculados com os custos e preço reais — não mudam com a simulação
                  </p>
                )}
              </div>

              {/* 5. Warning footer (condicional) — copy verbatim do rodapé existente acima */}
              {(waterfallCard.custoAusente || waterfallCard.impostoAusente) && (
                <div className="mt-3 space-y-0.5">
                  {waterfallCard.custoAusente && (
                    <p className="flex items-center gap-1 text-[10px] text-warning">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      custo ausente em parte das unidades — break-even subestimado
                    </p>
                  )}
                  {waterfallCard.impostoAusente && (
                    <p className="flex items-center gap-1 text-[10px] text-warning">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      regime fiscal não configurado em parte das vendas — imposto pode estar subestimado
                    </p>
                  )}
                </div>
              )}
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
                linha do eixo direito = MCO% ·
                Ads = fatura do Mercado Livre rateada por anúncio pela proporção do relatório de publicidade
                (sem fatura sincronizada, o próprio relatório) ·
                imposto pelo regime configurado · granularidade {GRANULARITY_LABELS[granularity].toLowerCase()}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
