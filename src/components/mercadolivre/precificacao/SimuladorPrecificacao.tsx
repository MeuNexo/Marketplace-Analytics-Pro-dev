import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, Package, RefreshCw, ChevronDown, ChevronUp,
  Settings2, X, ArrowRight, Info, Wallet, Plug,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  computePricing, reversePrice, marginTier, parseNumber, formatBRL, formatPct,
  type ListingType, type ObjectiveMode, type PricingInput, type ExtraDeduction, type DeductionMode,
} from "@/lib/pricing/calculator";
import { computeOrderTaxRate } from "@/lib/tax/perOrder";
import { calculateEffectiveRate } from "@/lib/tax";
import { UF_LIST } from "@/lib/tax/regions";
import { useMLPrecosCustos, type MLItemPrice } from "@/hooks/useMLPrecosCustos";
import { useMLProductCosts } from "@/hooks/useMLProductCosts";
import { useMLTaxConfig } from "@/hooks/useMLTaxConfig";
import { useMLDifalSummary } from "@/hooks/useMLDifalSummary";
import { McoDoisCenarios } from "@/components/mercadolivre/McoDoisCenarios";
import { resolveLinhaCenarios } from "@/lib/mcoLinhaCenarios";
import { difalPctReferencia, JANELA_DIFAL_REFERENCIA_DIAS } from "@/lib/anuncioMargens";
import { format as formatDate, subDays } from "date-fns";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";

// ── State ─────────────────────────────────────────────────────────────────────

const LOGISTIC_OPTIONS = [
  { value: "drop_off",     label: "Drop Off (ME2)",     shipping_mode: "me2",    estimate: 6.0 },
  { value: "fulfillment",  label: "Full (Fulfillment)", shipping_mode: "me2",    estimate: 8.5 },
  { value: "self_service", label: "Flex (Self Service)",shipping_mode: "me2",    estimate: 5.0 },
  { value: "custom",       label: "Envio próprio",      shipping_mode: "custom", estimate: 0   },
];

const LISTING_LABELS: Record<ListingType, string> = {
  gold_pro: "Premium",
  gold_special: "Clássica",
};

interface State {
  itemId: string | null;
  title: string;
  thumbnail: string;
  categoryId: string;

  cost: string;
  salePrice: string;
  listingType: ListingType;
  logisticType: string;
  shippingCost: string;
  commissionPct: string;

  ufDestino: string;
  taxOverride: boolean;
  manualTaxPct: string;
  difalEnabled: boolean;
  internalAliquot: string; // alíquota interna do destino para DIFAL

  rebate: ExtraDeduction;
  cupom: ExtraDeduction;
  afiliado: ExtraDeduction;
  promo: ExtraDeduction;

  objectiveMode: ObjectiveMode;
  objectiveTarget: string;
}

const emptyExtra: ExtraDeduction = { enabled: false, mode: "percent", value: 0 };

const initialState: State = {
  itemId: null,
  title: "",
  thumbnail: "",
  categoryId: "",
  cost: "",
  salePrice: "",
  listingType: "gold_pro",
  logisticType: "drop_off",
  shippingCost: "",
  commissionPct: "",
  ufDestino: "",
  taxOverride: false,
  manualTaxPct: "",
  difalEnabled: false,
  internalAliquot: "18",
  rebate: { ...emptyExtra },
  cupom: { ...emptyExtra },
  afiliado: { ...emptyExtra },
  promo: { ...emptyExtra },
  objectiveMode: "margin",
  objectiveTarget: "",
};

type Action =
  | { type: "set"; key: keyof State; value: any }
  | { type: "extra"; key: "rebate" | "cupom" | "afiliado" | "promo"; patch: Partial<ExtraDeduction> }
  | { type: "loadProduct"; payload: Partial<State> }
  | { type: "clearProduct" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set": return { ...state, [action.key]: action.value };
    case "extra": return { ...state, [action.key]: { ...state[action.key], ...action.patch } };
    case "loadProduct": return { ...state, ...action.payload };
    case "clearProduct":
      return {
        ...state,
        itemId: null, title: "", thumbnail: "", categoryId: "",
        cost: "", salePrice: "", commissionPct: "",
      };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SimuladorPrecificacao() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { items, connected, loading: itemsLoading, fetchCosts, fetchSalePrice } = useMLPrecosCustos();
  const { costs: productCosts } = useMLProductCosts();
  const { stores, selectedStore } = useMLStore();
  const { currentOrg } = useOrganization();

  const mlUserId = useMemo(() => {
    if (selectedStore !== "all" && selectedStore) return selectedStore;
    return stores[0]?.ml_user_id ?? "";
  }, [selectedStore, stores]);

  const taxConfigQuery = useMLTaxConfig(mlUserId ? [mlUserId] : [], currentOrg?.id ?? "");
  const taxConfig = mlUserId ? taxConfigQuery.data?.get(mlUserId) ?? null : null;

  // ── Live commission/fixed-fee fetch (debounced; only on price/logistic change) ──
  const [liveCommission, setLiveCommission] = useState<{ pct: number; fixed: number } | null>(null);
  const [fetchingFee, setFetchingFee] = useState(false);

  // ── Promo price toggle ────────────────────────────────────────────────────────
  const [usePromoPrice, setUsePromoPrice] = useState(false);
  const [promoFetching, setPromoFetching] = useState(false);
  const [regularSalePrice, setRegularSalePrice] = useState("");

  const handlePromoPriceToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      if (!state.itemId) return;
      setPromoFetching(true);
      try {
        const { price_sale } = await fetchSalePrice(state.itemId);
        if (price_sale != null) {
          setRegularSalePrice(state.salePrice);
          dispatch({ type: "set", key: "salePrice", value: String(price_sale).replace(".", ",") });
          setUsePromoPrice(true);
        }
      } finally {
        setPromoFetching(false);
      }
    } else {
      dispatch({ type: "set", key: "salePrice", value: regularSalePrice });
      setRegularSalePrice("");
      setUsePromoPrice(false);
    }
  }, [state.itemId, state.salePrice, regularSalePrice, fetchSalePrice]);

  useEffect(() => {
    const price = parseNumber(state.salePrice);
    if (!connected || price <= 0) { setLiveCommission(null); return; }
    const opt = LOGISTIC_OPTIONS.find((o) => o.value === state.logisticType);
    setFetchingFee(true);
    const handle = setTimeout(async () => {
      try {
        const costs = await fetchCosts({
          price,
          categoryId: state.categoryId || undefined,
          logisticType: state.logisticType,
          shippingMode: opt?.shipping_mode,
        });
        const match = costs.find((c) => c.listing_type_id === state.listingType);
        if (match) setLiveCommission({ pct: match.percentage_fee, fixed: match.fixed_fee });
      } finally {
        setFetchingFee(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [state.salePrice, state.logisticType, state.listingType, state.categoryId, connected, fetchCosts]);

  // ── Derived: tax rate from config or override ─────────────────────────────────
  // Fase 220 (TAX-01): computeOrderTaxRate devolve rate:null quando o destino
  // não é conhecido (nenhuma UF escolhida no simulador). Simulação PODE
  // assumir um destino de pré-visualização — calculateEffectiveRate é essa
  // alíquota de exibição "sem destino disponível" — mas GRAVAÇÃO no banco
  // (sync-ml-orders/recalc-order-costs) não pode: lá, destino desconhecido
  // preserva o imposto já gravado, nunca inventa um número.
  // ── [222-15-R2] Alíquota de REFERÊNCIA do DIFAL ───────────────────────────
  // Serve ao segundo cenário quando NÃO há UF de destino escolhida: é a razão
  // entre o efeito líquido do DIFAL e a receita base dos pedidos reais da
  // janela declarada. Sem venda medida na janela, a referência é AUSENTE — e a
  // tela diz isso, em vez de exibir 0% (que se leria como "DIFAL não custa").
  const janelaReferencia = useMemo(() => {
    const hoje = new Date();
    return {
      from: formatDate(subDays(hoje, JANELA_DIFAL_REFERENCIA_DIAS - 1), "yyyy-MM-dd"),
      to: formatDate(hoje, "yyyy-MM-dd"),
    };
  }, []);
  const { data: difalResumo } = useMLDifalSummary(janelaReferencia.from, janelaReferencia.to);
  const difalPctRef = useMemo(() => {
    if (!difalResumo) return null;
    const efeitoLiquido =
      difalResumo.difal_calculado - (difalResumo.reducao_pc_por_difal ?? 0);
    return difalPctReferencia(efeitoLiquido, difalResumo.receita_base);
  }, [difalResumo]);

  const autoTaxRate = useMemo(() => {
    if (!taxConfig) return 0;
    const { rate } = computeOrderTaxRate(taxConfig as any, state.ufDestino || null);
    if (rate != null) return rate;
    return calculateEffectiveRate(taxConfig as any);
  }, [taxConfig, state.ufDestino]);

  const taxPct = state.taxOverride
    ? parseNumber(state.manualTaxPct)
    : autoTaxRate;

  // ── Derived: difal automatic estimate ─────────────────────────────────────────
  const difalAutoPct = useMemo(() => {
    // [222-15-R2] O interruptor NÃO decide mais se o DIFAL existe — ele decide
    // se a estimativa vem da UF de destino escolhida. Sem UF escolhida, o
    // segundo cenário cai na alíquota de REFERÊNCIA medida (abaixo).
    if (!state.difalEnabled || !taxConfig || taxConfig.regime !== "lucro_real") return 0;
    const orig = taxConfig.uf_origem?.toUpperCase() ?? null;
    const dest = state.ufDestino?.toUpperCase() ?? null;
    if (!orig || !dest || orig === dest) return 0;
    // Aliquota interestadual de origem → destino
    const interSulSE = taxConfig.lr_icms_aliquota_inter_sul_sudeste ?? 12;
    const interNNECO = taxConfig.lr_icms_aliquota_inter_norte_nordeste ?? 7;
    // Reaproveita a regra do perOrder: destino N/NE/CO/ES → 7%, else 12%
    const reduced = ["AC","AP","AM","PA","RO","RR","TO","AL","BA","CE","MA","PB","PE","PI","RN","SE","DF","GO","MT","MS","ES"].includes(dest);
    const inter = reduced ? interNNECO : interSulSE;
    const intra = parseNumber(state.internalAliquot);
    return Math.max(0, intra - Number(inter));
  }, [state.difalEnabled, state.ufDestino, state.internalAliquot, taxConfig]);

  // ── Build pricing input + result ──────────────────────────────────────────────
  const opt = LOGISTIC_OPTIONS.find((o) => o.value === state.logisticType);
  const shippingCost = state.shippingCost
    ? parseNumber(state.shippingCost)
    : (opt?.estimate ?? 0);

  const defaultCommissionPct = state.listingType === "gold_pro" ? 16 : 12;
  const effectiveCommissionPct = state.commissionPct
    ? parseNumber(state.commissionPct)
    : (liveCommission?.pct ?? defaultCommissionPct);

  // ── [222-15-R2] OS DOIS CENÁRIOS, JUNTOS ──────────────────────────────────
  //
  // Antes, o interruptor de DIFAL escolhia QUAL cenário aparecia: ligado, o
  // primeiro sumia. Isso transformava a comparação em exercício de memória —
  // exatamente o que a conferência pediu para evitar. Agora o cenário SEM
  // DIFAL é sempre o principal (é ele que alimenta o preço reverso, o
  // semáforo e a decomposição), e o cenário COM DIFAL aparece ao lado.
  const pricingInput: PricingInput = {
    cost: parseNumber(state.cost),
    salePrice: parseNumber(state.salePrice),
    commissionPct: effectiveCommissionPct,
    fixedFee: liveCommission?.fixed ?? 6,
    shippingCost,
    taxPct,
    difalEnabled: false,
    difalPct: 0,
    rebate: state.rebate,
    cupom: state.cupom,
    afiliado: state.afiliado,
    promo: state.promo,
  };

  const result = computePricing(pricingInput);

  /**
   * Alíquota do segundo cenário, em pontos percentuais, e de onde ela veio.
   * A UF escolhida manda; sem UF, vale a REFERÊNCIA medida na mistura de
   * estados realmente vendidos nos últimos {JANELA_DIFAL_REFERENCIA_DIAS} dias
   * — e a tela diz qual das duas está valendo.
   */
  const difalPctSegundoCenario = difalAutoPct > 0 ? difalAutoPct : difalPctRef;
  const difalDeReferencia = difalAutoPct <= 0 && difalPctRef != null;

  const resultComDifal =
    taxConfig?.regime === "lucro_real" && difalPctSegundoCenario != null
      ? computePricing({
          ...pricingInput,
          difalEnabled: true,
          difalPct: difalPctSegundoCenario,
        })
      : null;

  // ── Reverse price for objective ───────────────────────────────────────────────
  const target = parseNumber(state.objectiveTarget);
  const reversedPrice = useMemo(() => {
    if (target <= 0) return null;
    const { salePrice, ...rest } = pricingInput;
    // Para markup no formato multiplicador (ex: 1.5), converte para % sobre custo (50)
    const effectiveTarget =
      state.objectiveMode === "markup" ? (target - 1) * 100 : target;
    if (effectiveTarget <= 0) return null;
    return reversePrice(rest, effectiveTarget, state.objectiveMode);
  }, [target, state.objectiveMode, pricingInput]);

  // ── Product search ────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) =>
      it.item_id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q),
    ).slice(0, 50);
  }, [items, searchQuery]);

  function selectProduct(it: MLItemPrice) {
    const cost = productCosts.get(it.item_id);
    dispatch({
      type: "loadProduct",
      payload: {
        itemId: it.item_id,
        title: it.title,
        thumbnail: it.thumbnail,
        categoryId: it.category_id,
        listingType: (it.listing_type_id === "gold_pro" || it.listing_type_id === "gold_special")
          ? (it.listing_type_id as ListingType) : "gold_pro",
        salePrice: it.price_sale ? String(it.price_sale).replace(".", ",") : "",
        cost: cost?.cost != null ? String(cost.cost).replace(".", ",") : "",
      },
    });
    setUsePromoPrice(false);
    setRegularSalePrice("");
    setSearchOpen(false);
    setSearchQuery("");
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  const tier = marginTier(result.margemPct);
  const tierColor = tier === "good" ? "text-kpi-positive" : tier === "warn" ? "text-amber-600" : "text-destructive";
  const tierBg = tier === "good" ? "bg-emerald-500/10 border-emerald-500/30" : tier === "warn" ? "bg-amber-500/10 border-amber-500/30" : "bg-destructive/10 border-destructive/30";

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
        <Plug className="w-12 h-12 text-muted-foreground/40" />
        <h3 className="text-base font-medium">Mercado Livre não conectado</h3>
        <p className="text-xs text-muted-foreground max-w-sm">
          Conecte uma conta para buscar produtos e usar comissões reais.
        </p>
        <Button asChild size="sm">
          <Link to="/integracoes">Conectar conta</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px] gap-3 items-start text-sm">
      {/* ── LEFT: Inputs ─────────────────────────────────────────────────── */}
      <div className="space-y-3 min-w-0 sm:order-2 lg:order-none">
        {/* Search / selected product */}
        <Card>
          <CardHeader className="px-4 pt-3 pb-2 space-y-0.5">
            <CardTitle className="text-sm font-medium text-foreground leading-5">Produto</CardTitle>
            <CardDescription className="text-xs leading-4">
              Busque por MLB ou SKU para preencher dados.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            {state.itemId ? (
              <div className="flex items-center gap-2.5 rounded-md border bg-muted/30 p-2">
                {state.thumbnail ? (
                  <img src={state.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-4">{state.title}</p>
                  <p className="text-[11px] text-muted-foreground font-mono leading-4">{state.itemId}</p>
                </div>
                <Button
                  variant="ghost" size="sm" className="h-7 w-7 p-0"
                  onClick={() => dispatch({ type: "clearProduct" })}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-9 justify-start gap-2 font-normal text-xs text-muted-foreground">
                    <Search className="w-3.5 h-3.5" />
                    Buscar por MLB ou título…
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Digite MLB ou título…"
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {itemsLoading ? "Carregando anúncios…" : "Nenhum anúncio encontrado."}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredItems.map((it) => (
                          <CommandItem
                            key={it.item_id}
                            value={`${it.item_id} ${it.title}`}
                            onSelect={() => selectProduct(it)}
                            className="gap-2 data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                          >
                            {it.thumbnail
                              ? <img src={it.thumbnail} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                              : <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{it.title}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{it.item_id}</p>
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{formatBRL(it.price_sale)}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center">Custo do produto (R$)</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="0,00"
                  value={state.cost}
                  onChange={(e) => dispatch({ type: "set", key: "cost", value: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center">Tipo de anúncio</Label>
                <Select
                  value={state.listingType}
                  onValueChange={(v) => {
                    dispatch({ type: "set", key: "listingType", value: v });
                    // Limpa override para que o default do novo tipo seja aplicado
                    if (!state.commissionPct) return;
                    dispatch({ type: "set", key: "commissionPct", value: "" });
                  }}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold_pro">Premium</SelectItem>
                    <SelectItem value="gold_special">Clássica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center gap-1">
                  Comissão ML (%)
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent>Vazio = taxa real do tipo de anúncio</TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  className="h-8 text-xs"
                  placeholder={`${(liveCommission?.pct ?? defaultCommissionPct).toFixed(1)}`}
                  value={state.commissionPct}
                  onChange={(e) => dispatch({ type: "set", key: "commissionPct", value: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logística */}
        <Card>
          <CardHeader className="px-4 pt-3 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Logística</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center">Modalidade</Label>
                <Select
                  value={state.logisticType}
                  onValueChange={(v) => dispatch({ type: "set", key: "logisticType", value: v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOGISTIC_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center gap-1">
                  Custo de envio (R$)
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent>Vazio = estimativa por modalidade</TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  className="h-8 text-xs"
                  placeholder={`Estimativa: ${formatBRL(opt?.estimate ?? 0)}`}
                  value={state.shippingCost}
                  onChange={(e) => dispatch({ type: "set", key: "shippingCost", value: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tributação */}
        <Card>
          <CardHeader className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-medium text-foreground">Tributação</CardTitle>
                <CardDescription className="text-xs">
                  {taxConfig
                    ? <>Regime: <span className="font-medium text-foreground capitalize">{taxConfig.regime.replace("_", " ")}</span> · {formatPct(autoTaxRate)} efetivo</>
                    : "Configure o regime fiscal da loja para imposto automático."}
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-xs h-7 px-2 gap-1">
                <Link to="/fiscal"><Settings2 className="w-3 h-3" />Editar</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-xs">UF de destino</Label>
                <Select
                  value={state.ufDestino || "__none__"}
                  onValueChange={(v) => dispatch({ type: "set", key: "ufDestino", value: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {UF_LIST.map((uf) => (<SelectItem key={uf} value={uf}>{uf}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center justify-between">
                  <span>Alíquota efetiva (%)</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    Override <Switch checked={state.taxOverride} onCheckedChange={(v) => dispatch({ type: "set", key: "taxOverride", value: v })} />
                  </span>
                </Label>
                <Input
                  className="h-8 text-xs"
                  disabled={!state.taxOverride}
                  placeholder={formatPct(autoTaxRate)}
                  value={state.taxOverride ? state.manualTaxPct : autoTaxRate.toFixed(2)}
                  onChange={(e) => dispatch({ type: "set", key: "manualTaxPct", value: e.target.value })}
                />
              </div>
            </div>

            {taxConfig?.regime === "lucro_real" && (
              <div className="rounded-md border bg-muted/20 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs flex items-center gap-1">
                    DIFAL (consumidor final)
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Diferencial de alíquota cobrado quando UF destino ≠ origem. Estimativa = alíquota interna do destino − interestadual.
                        Este interruptor escolhe a UF da estimativa — ele NÃO esconde o cenário sem DIFAL, que continua sempre visível ao lado.
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Switch checked={state.difalEnabled} onCheckedChange={(v) => dispatch({ type: "set", key: "difalEnabled", value: v })} />
                </div>
                {state.difalEnabled && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Alíq. interna destino (%)</Label>
                      <Input
                        value={state.internalAliquot}
                        onChange={(e) => dispatch({ type: "set", key: "internalAliquot", value: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">DIFAL estimado</Label>
                      <div className="h-8 px-3 rounded-md bg-background border flex items-center text-xs tabular-nums">
                        {formatPct(difalAutoPct)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Descontos extras */}
        <Collapsible>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="px-4 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium text-foreground">Descontos extras</CardTitle>
                    <CardDescription className="text-xs">Rebate, cupom, afiliado, promoção</CardDescription>
                  </div>
                  <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="px-4 pb-3 pt-0 space-y-2">
                <ExtraField
                  label="Rebate Mercado Livre"
                  hint="Abate a comissão do ML, não o preço de venda — diferente do cupom/promoção que o vendedor concede. Medido em 14/08/2026 contra pedidos reais (Fase 222)."
                  value={state.rebate}
                  onChange={(p) => dispatch({ type: "extra", key: "rebate", patch: p })}
                />
                <ExtraField label="Cupom do vendedor"   value={state.cupom}  onChange={(p) => dispatch({ type: "extra", key: "cupom",  patch: p })} />
                <ExtraField label="Comissão de afiliado" value={state.afiliado} onChange={(p) => dispatch({ type: "extra", key: "afiliado", patch: p })} />
                <ExtraField label="Desconto promocional" value={state.promo} onChange={(p) => dispatch({ type: "extra", key: "promo", patch: p })} />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Objetivo */}
        <Card>
          <CardHeader className="px-4 pt-3 pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Objetivo</CardTitle>
            <CardDescription className="text-xs leading-tight">Calcule o preço para atingir uma margem ou markup.</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center">Modo</Label>
                <Select value={state.objectiveMode} onValueChange={(v) => dispatch({ type: "set", key: "objectiveMode", value: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="margin">Margem (% sobre preço)</SelectItem>
                    <SelectItem value="markup">Markup (multiplicador)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center">
                  {state.objectiveMode === "markup" ? "Alvo (×)" : "Alvo (%)"}
                </Label>
                <Input
                  placeholder={state.objectiveMode === "markup" ? "Ex: 1,50" : "Ex: 20"}
                  value={state.objectiveTarget}
                  onChange={(e) => dispatch({ type: "set", key: "objectiveTarget", value: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs h-4 flex items-center text-muted-foreground">Preço sugerido</Label>
                <div className="h-8 px-2 rounded-md border bg-muted/30 flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold tabular-nums">
                    {reversedPrice != null ? formatBRL(reversedPrice) : "—"}
                  </span>
                  {reversedPrice != null && reversedPrice > 0 && (
                    <Button
                      variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] gap-1"
                      onClick={() => dispatch({ type: "set", key: "salePrice", value: reversedPrice.toFixed(2).replace(".", ",") })}
                    >
                      Aplicar <ArrowRight className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {target > 0 && reversedPrice == null && (
              <p className="text-xs text-destructive mt-1.5">Alvo inviável com as taxas atuais.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── RIGHT: Live result ──────────────────────────────────────────── */}
      <div className="sm:order-1 lg:order-none lg:sticky lg:top-14 lg:self-start space-y-2.5">
        <Card>
          <CardHeader className="px-4 pt-3 pb-2 space-y-0.5">
            <CardTitle className="text-sm font-medium text-foreground leading-5">Preço de venda</CardTitle>
            <CardDescription className="text-xs leading-4">
              Recalcula a cada digitação.{" "}
              {fetchingFee && <span className="text-amber-600">Atualizando comissão…</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-3">
            {state.itemId && (
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={usePromoPrice}
                  disabled={promoFetching}
                  onChange={(e) => handlePromoPriceToggle(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground">
                  {promoFetching ? "Buscando preço promocional…" : "Usar preço promocional"}
                </span>
              </label>
            )}
            <Input
              placeholder="0,00"
              value={state.salePrice}
              onChange={(e) => {
                dispatch({ type: "set", key: "salePrice", value: e.target.value });
                if (usePromoPrice) { setUsePromoPrice(false); setRegularSalePrice(""); }
              }}
              className="text-xl h-12 font-semibold tabular-nums"
            />

            <div className={`rounded-lg border p-2.5 ${tierBg}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Lucro</span>
                <span className={`text-xl font-bold tabular-nums ${tierColor}`}>
                  {formatBRL(result.lucro)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-1.5 text-center">
                <Stat label="Margem" value={formatPct(result.margemPct)} color={tierColor} />
                <Stat label="Markup" value={result.markupMultiplier > 0 ? `${result.markupMultiplier.toFixed(2)}×` : "—"} />
                <Stat label="ROI"    value={formatPct(result.roiPct)} />
              </div>

              {/* [222-15-R2] Os DOIS cenários juntos — o interruptor de DIFAL
                  não esconde mais o primeiro. */}
              {taxConfig?.regime === "lucro_real" && (
                <div className="mt-2 pt-2 border-t border-border/40">
                  <McoDoisCenarios
                    cenarios={resolveLinhaCenarios({
                      semDifal: { valor: result.lucro, pct: result.margemPct },
                      comDifal: resultComDifal
                        ? { valor: resultComDifal.lucro, pct: resultComDifal.margemPct }
                        : null,
                      difalEfeito: resultComDifal ? resultComDifal.difal : null,
                      regimeAplicaDifal: true,
                    })}
                    densidade="bloco"
                    rotuloSemDifal="lucro sem DIFAL"
                    rotuloComDifal="lucro com DIFAL"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {resultComDifal == null
                      ? `Sem UF de destino escolhida e sem venda medida nos últimos ${JANELA_DIFAL_REFERENCIA_DIAS} dias — não há referência para estimar o DIFAL.`
                      : difalDeReferencia
                        ? `Sem UF de destino escolhida: o DIFAL usa a alíquota de referência medida na mistura de estados vendidos nos últimos ${JANELA_DIFAL_REFERENCIA_DIAS} dias (${formatPct(difalPctSegundoCenario ?? 0)}).`
                        : `DIFAL estimado pela UF de destino escolhida (${formatPct(difalPctSegundoCenario ?? 0)}).`}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-0.5 text-xs">
              <Row label="Receita bruta" value={formatBRL(result.receitaBruta)} />
              <Row label={`Comissão ML (${formatPct(pricingInput.commissionPct)})`} value={`-${formatBRL(result.comissaoBruta)}`} negative />
              {result.rebateValor > 0 && (
                <Row
                  label="Rebate ML (abate a comissão)"
                  value={`+${formatBRL(result.rebateValor)}`}
                  className="text-kpi-positive"
                />
              )}
              {result.rebateExcedeComissao && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                  <strong>Rebate maior que a comissão:</strong> o Mercado Livre nunca
                  abate mais do que cobra de comissão. O valor foi travado em{" "}
                  {formatBRL(result.comissaoBruta)} (comissão cheia) — provavelmente
                  você digitou o desconto promocional TOTAL, não só a parte que o ML
                  banca. Medido em produção (MLB7070651566): o ML financiou 3,7% do
                  desconto contra 33,4% do vendedor — em geral é uma fatia pequena da
                  comissão, não o valor inteiro.
                </div>
              )}
              <Row label="Taxa fixa" value={`-${formatBRL(result.taxaFixa)}`} negative />
              <Row label="Frete" value={`-${formatBRL(result.frete)}`} negative />
              <Row label={`Imposto (${formatPct(taxPct)})`} value={`-${formatBRL(result.imposto)}`} negative />
              {/* A decomposição é a do cenário SEM DIFAL. O DIFAL entra numa
                  linha própria, marcada como segundo cenário — nunca somado
                  por dentro do imposto acima. */}
              {resultComDifal != null && resultComDifal.difal > 0 && (
                <Row
                  label={`DIFAL (${formatPct(difalPctSegundoCenario ?? 0)}) — 2º cenário`}
                  value={`-${formatBRL(resultComDifal.difal)}`}
                  negative
                />
              )}
              {result.cupomValor > 0 && <Row label="Cupom" value={`-${formatBRL(result.cupomValor)}`} negative />}
              {result.afiliadoValor > 0 && <Row label="Afiliado" value={`-${formatBRL(result.afiliadoValor)}`} negative />}
              {result.promoValor > 0 && <Row label="Promo" value={`-${formatBRL(result.promoValor)}`} negative />}
              <Separator className="my-1" />
              <Row label="Receita líquida" value={formatBRL(result.receitaLiquida)} bold />
              <Row label="Custo do produto" value={`-${formatBRL(result.custo)}`} negative />
              <Separator className="my-1" />
              <Row label="Lucro líquido" value={formatBRL(result.lucro)} bold className={tierColor} />
            </div>

            {result.breakEven > 0 && (
              <div className="flex items-center justify-between text-xs pt-1 border-t">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Ponto de equilíbrio
                </span>
                <span className={`font-semibold tabular-nums ${result.receitaBruta >= result.breakEven ? "text-kpi-positive" : "text-destructive"}`}>
                  {formatBRL(result.breakEven)}
                </span>
              </div>
            )}

            {liveCommission && (
              <Badge variant="outline" className="w-full justify-center text-[10px] gap-1">
                <RefreshCw className="w-3 h-3" /> Comissão real ML para {LISTING_LABELS[state.listingType]}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${color ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, negative, bold, className }: {
  label: string; value: string; negative?: boolean; bold?: boolean; className?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-muted-foreground ${bold ? "font-medium text-foreground" : ""}`}>{label}</span>
      <span className={`tabular-nums ${negative ? "text-destructive" : ""} ${bold ? "font-semibold" : ""} ${className ?? ""}`}>{value}</span>
    </div>
  );
}

function ExtraField({
  label, hint, value, onChange,
}: {
  label: string;
  hint?: string;
  value: ExtraDeduction;
  onChange: (patch: Partial<ExtraDeduction>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
          className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
        />
        <span className={`text-xs flex-1 ${value.enabled ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center gap-2 sm:ml-auto">
        <Select
          value={value.mode}
          onValueChange={(v) => onChange({ mode: v as DeductionMode })}
          disabled={!value.enabled}
        >
          <SelectTrigger className="w-[70px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">%</SelectItem>
            <SelectItem value="amount">R$</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={value.value || ""}
          onChange={(e) => onChange({ value: parseNumber(e.target.value) })}
          disabled={!value.enabled}
          placeholder="0"
          className="w-24 h-8"
        />
      </div>
    </div>
  );
}