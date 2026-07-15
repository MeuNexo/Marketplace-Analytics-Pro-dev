import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { STORE_STROKE_COLORS as STORE_STROKE_COLORS_SHARED } from "@/config/storeColors";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useSeller } from "@/contexts/SellerContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMLAds } from "@/hooks/useMLAds";
import { computeAdsSummary } from "@/hooks/useMLAds";
import { useMLReputation } from "@/hooks/useMLReputation";
import { useMLFilters, getFilterDates, todayUTC, getComparisonRanges } from "@/hooks/useMLFilters";
import { useMLDailyQuery, useMLHourlyQuery, useMLProductsQuery, useMLUserQuery, useMLMonthlyDailyQuery, useInvalidateMLQueries, type DailyBreakdown, type HourlyBreakdown } from "@/hooks/useMLQueries";
import { useMLSync } from "@/hooks/useMLSync";
import { useMLLastSync } from "@/hooks/useMLLastSync";
import { useMLOrders } from "@/hooks/useMLOrders";
import { useMLKPISummary } from "@/hooks/useMLKPISummary";
import { useMLCostWaterfall } from "@/hooks/useMLCostWaterfall";
import { useMLBillingWithSync, useMLBillingDailyWithSync, groupBillingCharges } from "@/hooks/useMLBilling";
import { useAutoRecalc } from "@/hooks/useAutoRecalc";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLOrdersByBrand } from "@/hooks/useMLOrdersByBrand";
import { BrandRevenueChart } from "@/components/mercadolivre/BrandRevenueChart";
import { BrandMarkupChart } from "@/components/mercadolivre/BrandMarkupChart";
import { CustoOperacionalChart } from "@/components/mercadolivre/CustoOperacionalChart";
import { BrandSharePieChart } from "@/components/mercadolivre/BrandSharePieChart";
import { MLKPIGrid } from "@/components/mercadolivre/MLKPIGrid";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { MLRevenueChart } from "@/components/mercadolivre/MLRevenueChart";
import { MLCostCard } from "@/components/mercadolivre/MLCostCard";
import { MLTopProducts } from "@/components/mercadolivre/MLTopProducts";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { GoalsCard } from "@/components/mercadolivre/GoalsCard";
import type { ProductSalesRow } from "@/components/mercadolivre/TopSellingProducts";
import { Plug, Info, Loader2, RefreshCw, Settings2, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { format, parseISO, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MLSalesAnalytics } from "@/components/mercadolivre/MLSalesAnalytics";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { useMLProductMargins } from "@/hooks/useMLProductMargins";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { OnboardingBanner } from "@/components/onboarding/OnboardingBanner";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { ConsultorCard } from "@/components/mercadolivre/ConsultorCard";
import { ConsultorLLMSummary } from "@/components/mercadolivre/ConsultorLLMSummary";
import { useConsultorInsights } from "@/hooks/useConsultorInsights";
import { MLMcoStrip } from "@/components/mercadolivre/MLMcoStrip";
import { computeMco } from "@/lib/mco";
import { useDreOperational } from "@/hooks/useDreOperational";
import { useCancelledRevenue } from "@/hooks/useCancelledRevenue";
import { buildDreCascade } from "@/lib/dreCascade";
import { computeMargemContribuicao } from "@/lib/dreMargem";
import { resolveDreRegime, shouldNudgeClose, monthPlusOne } from "@/lib/dreRegime";
import { useDreMonthClose } from "@/hooks/useDreMonthClose";
import { useImpostoGuiaReal, useImpostoGuiaNudge } from "@/hooks/useImpostoGuiaReal";
import { useCmvCheioGate } from "@/hooks/useCmvCheioGate";
import { useNaoClassificadoItems } from "@/hooks/useNaoClassificadoItems";
import { resolveCloseGate } from "@/lib/dreCloseGate";
import { toast } from "sonner";

const currencyFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function buildHourlyChartData(hourlyRows: HourlyBreakdown[]) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    hour,
    "Receita Total": 0,
    Pedidos: 0,
  }));
  hourlyRows.forEach((row) => {
    const bucket = buckets[row.hour];
    if (!bucket) return;
    bucket["Receita Total"] += row.total;
    bucket.Pedidos += row.qty;
  });
  return buckets;
}

function aggregateDailyRows(rows: DailyBreakdown[]): DailyBreakdown[] {
  const dateMap = new Map<string, DailyBreakdown>();
  for (const d of rows) {
    const existing = dateMap.get(d.date);
    if (existing) {
      existing.total += d.total;
      existing.approved += d.approved;
      existing.qty += d.qty;
      existing.units_sold += d.units_sold;
      existing.cancelled += d.cancelled;
      existing.shipped += d.shipped;
      existing.unique_visits += d.unique_visits;
      existing.unique_buyers += d.unique_buyers;
    } else {
      dateMap.set(d.date, { ...d });
    }
  }
  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export default function MercadoLivre() {
  const { user } = useAuth();
  const { stores, selectedStore, setSalesCache, scopeKey, sellerId, resolvedMLUserIds, hasMLConnection, loading: storeLoading } = useMLStore();
  const { selectedSeller, selectedStoreIds } = useSeller();
  const { currentOrg, orgRole } = useOrganization();

  // ── Dashboard layout personalização ──
  const { widgets, toggleWidget, moveUp, moveDown, resetLayout, isVisible } = useDashboardLayout();
  const [layoutOpen, setLayoutOpen] = useState(false);

  // ── Onboarding (TENANT-04 / D-07) — banner não-bloqueante no topo + wizard ──
  const { isComplete: onboardingComplete } = useOnboardingProgress();
  const [onboardingWizardOpen, setOnboardingWizardOpen] = useState(false);

  // ── Consultor v1 (Phase 45) — card de saúde + top 3 insights ──
  const { insights: consultorInsights, score: consultorScore, scoreDelta: consultorScoreDelta, scoreBand: consultorScoreBand, syncing: consultorSyncing, dismiss: consultorDismiss, explain: consultorExplain, summaryDisabled: consultorLLMDisabled } = useConsultorInsights();

  // ── Filters ──
  const filters = useMLFilters();
  const { period, setPeriod, customRange, setCustomRange, chartMode, isHourlyAvailable, hourlyTargetDate, activeFilterKey, currentFrom, currentTo, prevFrom, prevTo, fetchFrom, fetchTo, adsChartFrom, periodLabel } = filters;

  // ── Effective stores (only ML is supported) ──
  const mlStores = useMemo(() => {
    const allActive = (selectedSeller?.stores ?? []).filter((s) => s.is_active && s.marketplace === "ml");
    const base = selectedStoreIds.length === 0 ? allActive : allActive.filter((s) => selectedStoreIds.includes(s.id));
    return base;
  }, [selectedSeller, selectedStoreIds]);

  const isML = true;
  const isAll = selectedStore === "all" && resolvedMLUserIds.length > 1;
  const useRealData = true;

  // ── React Query data ──
  const { data: allDaily = [], isLoading: dailyLoading } = useMLDailyQuery(fetchFrom, fetchTo);
  const { data: allHourly = [], isLoading: hourlyLoading } = useMLHourlyQuery(isHourlyAvailable, hourlyTargetDate);
  const { data: allProductSales = [], isLoading: productsLoading } = useMLProductsQuery(currentFrom, currentTo);
  const { data: mlUser = null } = useMLUserQuery();
  // Monthly query is independent of the period filter — always fetches month-to-date.
  const { data: allMonthlyDaily = [] } = useMLMonthlyDailyQuery();

  const [productStockMap, setProductStockMap] = useState<Record<string, number>>({});
  const [sellerReputation, setSellerReputation] = useState<any>(null);

  const connected = hasMLConnection && resolvedMLUserIds.length > 0;
  const loading = useRealData && (storeLoading || dailyLoading);

  // ── Sync ──
  const sync = useMLSync({
    customRange, period,
    setSellerReputation,
  });
  const { syncing, lastSyncedAt, syncProgress, syncFromAPI, resetSync } = sync;
  const { data: lastSyncTimestamp } = useMLLastSync();
  const invalidate = useInvalidateMLQueries();

  const { reputation: realReputation } = useMLReputation();
  const { daily: adsDaily } = useMLAds({ dateFrom: adsChartFrom, dateTo: currentTo });
  const adsSummary = useMemo(
    () => computeAdsSummary(adsDaily.filter((d) => d.date >= currentFrom && d.date <= currentTo)),
    [adsDaily, currentFrom, currentTo],
  );

  const { data: ordersSummary } = useMLOrders(currentFrom, currentTo);

  const { data: costWaterfall, isLoading: costWaterfallLoading } = useMLCostWaterfall(currentFrom, currentTo);

  const {
    data: brandData,
    isLoading: brandLoading,
  } = useMLOrdersByBrand(currentFrom, currentTo);
  const { data: marginMap } = useMLProductMargins(currentFrom, currentTo);
  const { data: kpiSummary, isLoading: kpiSummaryLoading } = useMLKPISummary(
    currentFrom,
    currentTo,
    adsSummary.total_spend,
  );

  // Waterfall mensal — sempre mês corrente, independente do filtro de período
  const monthlyFrom = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }, []);
  const monthlyTo = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const monthlyAdsTotal = useMemo(
    () => adsDaily.filter((d) => d.date >= monthlyFrom && d.date <= monthlyTo).reduce((s, d) => s + d.spend, 0),
    [adsDaily, monthlyFrom, monthlyTo],
  );
  const { data: monthlyCostWaterfall } = useMLCostWaterfall(monthlyFrom, monthlyTo);

  // Billing real (CFFE/CFONPN) — mês do filtro, ou mês navegado via ‹ › no card (41-04)
  const filterMonth = useMemo(() => currentFrom.substring(0, 7), [currentFrom]);
  // Override de navegação manual do DRE — null segue o filtro; reset quando o filtro muda
  const [dreMonthOverride, setDreMonthOverride] = useState<string | null>(null);
  useEffect(() => {
    setDreMonthOverride(null);
  }, [filterMonth]);
  const billingMonth = dreMonthOverride ?? filterMonth;
  const { data: billingData, syncing: billingSyncing } = useMLBillingWithSync(billingMonth);
  // Fonte primária do DRE: ml_billing_daily (mês-calendário exato 01–31, sem o
  // viés do ciclo de fechamento da fatura). Cai para billingData (fatura mensal)
  // e depois para estimado de orders quando indisponível.
  const { data: dailyBilling, syncing: dailySyncing } = useMLBillingDailyWithSync(billingMonth);

  // Waterfall do mês do filtro — quando billingMonth ≠ mês corrente precisamos de dados
  // de CMV/impostos/receita para o mês do filtro (não o mês corrente).
  const currentCalendarMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const billingMonthIsCurrentMonth = billingMonth === currentCalendarMonth;

  // Navegação de meses no card DRE (‹ Mês/Ano ›)
  const shiftDreMonth = useCallback(
    (delta: number) => {
      const [y, m] = billingMonth.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      setDreMonthOverride(next === filterMonth ? null : next);
    },
    [billingMonth, filterMonth],
  );
  const dreCanGoNext = billingMonth < currentCalendarMonth;
  const handleDrePrevMonth = useCallback(() => shiftDreMonth(-1), [shiftDreMonth]);
  const handleDreNextMonth = useCallback(() => {
    if (billingMonth < currentCalendarMonth) shiftDreMonth(1);
  }, [billingMonth, currentCalendarMonth, shiftDreMonth]);
  // Primeiros/últimos dias do billingMonth — usados para instanciar waterfall do mês do filtro
  const billingMonthFrom = useMemo(() => `${billingMonth}-01`, [billingMonth]);
  const billingMonthTo = useMemo(() => {
    const [year, month] = billingMonth.split("-").map(Number);
    // Último dia do mês: dia 0 do mês seguinte
    const lastDay = new Date(year, month, 0).getDate();
    return `${billingMonth}-${String(lastDay).padStart(2, "0")}`;
  }, [billingMonth]);
  // Waterfall específico do mês do filtro (ativado somente quando ≠ mês corrente)
  const { data: filterMonthWaterfall, isLoading: filterMonthWaterfallLoading } = useMLCostWaterfall(
    billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom,
    billingMonthIsCurrentMonth ? monthlyTo   : billingMonthTo,
  );

  // DRE — linhas operacionais/financeiro por competência (Phase 88, RPC 87).
  // MESMO eixo de mês do waterfall (paridade de mês-calendário); p_month é
  // sempre primeiro-dia-do-mês ("YYYY-MM-01"), nunca billingMonth cru (Pitfall 3).
  const { data: dreOperationalRows } = useDreOperational(
    billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom,
  );

  // DRE: waterfall autoritativo para o mês exibido no card
  const dreWaterfall = billingMonthIsCurrentMonth ? monthlyCostWaterfall : filterMonthWaterfall;
  // Loading do DRE acompanha o waterfall que alimenta o card — evita flash de
  // receita R$0 com lucro negativo ao navegar entre meses
  const dreWaterfallLoading = filterMonthWaterfallLoading;

  // [C1] Receita cancelada — MESMO eixo de mês do dreWaterfall (mês corrente →
  // monthlyFrom/monthlyTo; mês navegado → billingMonthFrom/billingMonthTo).
  // Um eixo diferente faz bruto e líquido discordarem.
  const { data: cancelledRevenueData } = useCancelledRevenue(
    billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom,
    billingMonthIsCurrentMonth ? monthlyTo : billingMonthTo,
  );
  const cancelamentosVendas = cancelledRevenueData?.cancelledRevenue ?? 0;

  // Grupos de tarifas — fonte primária daily (mês-calendário), senão fatura mensal
  const { groups: gruposTarifas, totalTarifas } = useMemo(
    () => groupBillingCharges(dailyBilling?.charges ?? billingData?.charges ?? []),
    [dailyBilling, billingData],
  );

  // Label do mês em pt-BR — ex.: "Junho/2026"
  const mesLabel = useMemo(() => {
    const [year, month] = billingMonth.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    const monthName = d.toLocaleString("pt-BR", { month: "long" });
    return `${monthName.charAt(0).toUpperCase() + monthName.slice(1)}/${year}`;
  }, [billingMonth]);

  // Receita do mês do filtro
  const receitaMes = dreWaterfall?.paid_revenue ?? 0;
  // [C1] Receita bruta = líquida + cancelada — exclusiva do card do DRE. Os
  // blocos de MCO e meta de lucro deste arquivo preservam a receita paga
  // (líquida), inalterados por esta phase.
  const receitaBrutaMes = receitaMes + cancelamentosVendas;

  // ── Regime PREVISÃO/APURAÇÃO (Phase 94) ──
  // Mesmo eixo de mês do dreWaterfall (mês corrente → monthlyFrom; navegado →
  // billingMonthFrom). dre_month_close usa sempre "YYYY-MM-01" (Pitfall 3).
  const dreSaleMonth = billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom;
  const monthClose = useDreMonthClose(dreSaleMonth);
  const guiaReal = useImpostoGuiaReal(dreSaleMonth);
  const guiaNudge = useImpostoGuiaNudge(dreSaleMonth);

  // [C6] Gate de CMV cheio — MESMO eixo de mês do dreWaterfall (billingMonthIsCurrentMonth
  // decide monthlyFrom/To vs billingMonthFrom/To). Eixo diferente = o gate olha
  // um mês e o CMV outro.
  const cmvGate = useCmvCheioGate(
    billingMonthIsCurrentMonth ? monthlyFrom : billingMonthFrom,
    billingMonthIsCurrentMonth ? monthlyTo : billingMonthTo,
  );

  // [C6/C7] Gate combinado de fechamento. resolveCloseGate trata gaps === null
  // (useQuery ainda carregando) como fail-closed — por isso `cmvGate.data ?? null`,
  // nunca `cmvGate.data` cru (que seria `undefined` durante o loading e
  // desarmaria o fail-closed, já que `undefined !== null`).
  // O gate SÓ vale para FECHAR: um mês já fechado (isClosed) continua
  // reabrível mesmo com gate bloqueado, senão um mês fechado com dado
  // faltando fica preso para sempre (T-96-19).
  const closeGate = resolveCloseGate({
    gaps: cmvGate.data ?? null,
    guia: guiaReal.data ?? null,
  });
  const closeBlocked = !monthClose.isClosed && closeGate.blocked;

  // [C8] Lançamentos do bloco "Não classificado" da competência de VENDA
  // (dreSaleMonth) — não o M+1 da guia (M+1 é exclusivo do imposto).
  const naoClassificadoItemsQuery = useNaoClassificadoItems(dreSaleMonth);

  // CMV e impostos do mês — CONSEQUÊNCIA do regime resolvido acima, nunca um
  // toggle solto (nunca-misturar). Enquanto o mês está aberto (isClosed=false)
  // reproduz byte-a-byte a expressão legada (SC6 — zero regressão Phase 88).
  const regimeResult = resolveDreRegime({
    isClosed: monthClose.isClosed,
    cmvMedio: dreWaterfall?.cmv ?? 0,
    hasCmv: !!dreWaterfall?.has_cmv,
    cmvCheio: dreWaterfall?.cmv_cheio ?? 0,
    hasCmvCheio: !!dreWaterfall?.has_cmv_cheio,
    totalTaxEstimado: dreWaterfall?.total_tax ?? 0,
    hasTaxData: !!dreWaterfall?.has_tax_data,
    guiaReal: guiaReal.data ?? null,
  });
  const cmvMes = regimeResult.cmvMes;
  const impostosMes = regimeResult.impostosMes;

  // Empurrãozinho (dica visual, NUNCA gatilho) + gate owner-only do botão
  // marcar/reabrir (RLS de dre_month_close é a autoridade real — este gate é
  // só UX, igual ao ReplenishmentParamsDialog/ml_tax_config).
  const nudgeClose = shouldNudgeClose({
    rows: guiaNudge.data ?? [],
    targetCompetence: monthPlusOne(dreSaleMonth),
  });
  const canClose = orgRole === "owner";
  const guiaCompetenceLabel = useMemo(() => {
    const [year, month] = monthPlusOne(dreSaleMonth).split("-").map(Number);
    return `${String(month).padStart(2, "0")}/${year}`;
  }, [dreSaleMonth]);

  const handleCloseDreMonth = useCallback(async () => {
    // [C6/C7] Defesa em profundidade: o `disabled` do botão é UX (MLCostCard);
    // esta é a segunda barreira antes de chamar monthClose.close(). A RLS de
    // dre_month_close só checa owner — não conhece o gate (T-96-18, aceito).
    if (closeBlocked) {
      toast.error("Não é possível marcar o mês como apurado", {
        description: closeGate.reasons.join(" · "),
      });
      return;
    }
    try {
      await monthClose.close();
    } catch (err) {
      toast.error("Erro ao marcar mês como apurado", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [monthClose, closeBlocked, closeGate.reasons]);

  const handleReopenDreMonth = useCallback(async () => {
    try {
      await monthClose.reopen();
    } catch (err) {
      toast.error("Erro ao reabrir mês", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [monthClose]);

  // Fallback estimado: ads do mês do filtro somado para linha de publicidade
  const adsSpendMes = useMemo(
    () => adsDaily.filter((d) => d.date >= billingMonthFrom && d.date <= billingMonthTo).reduce((s, d) => s + d.spend, 0),
    [adsDaily, billingMonthFrom, billingMonthTo],
  );

  // fonte: "competencia" = ml_billing_daily (mês-calendário exato); "billing" =
  // fatura mensal (ciclo 06→05); "estimado" = fallback de orders
  const dreFonte: "competencia" | "billing" | "estimado" =
    dailyBilling ? "competencia" : billingData ? "billing" : "estimado";

  // Grupos + total de tarifas — memo ÚNICO (Phase 96 Plan 05: os dois memos
  // separados que existiam antes tinham `totalTarifasEfetivo` RE-SOMANDO o
  // array de grupos, descartando a exclusão do parcelamento (`excluded`) que
  // o hook já aplica em `totalTarifas`. Com billing real, o total que chega
  // à tela e à fórmula é o do hook — nunca uma re-soma local.
  const { groups: gruposTarifasEfetivos, totalTarifas: totalTarifasEfetivo } = useMemo(() => {
    if (dailyBilling || billingData) return { groups: gruposTarifas, totalTarifas };
    // fallback: grupos estimados de orders (comissão=total_comissao, frete, ads)
    // — parcelamento estimado é sempre 0, então a exclusão é inócua aqui, mas
    // o shape do retorno precisa ser o mesmo dos dois ramos.
    const comissao = dreWaterfall?.total_comissao ?? 0;
    const frete    = dreWaterfall?.total_frete    ?? 0;
    const ads      = adsSpendMes;
    const groups = [
      { key: "tarifas_venda", label: "Tarifas de venda",          amount: comissao, excluded: false },
      { key: "envios_ml",     label: "Envios Mercado Livre",       amount: frete,    excluded: false },
      { key: "parcelamento",  label: "Taxas de parcelamento",      amount: 0,        excluded: true  },
      { key: "publicidade",   label: "Campanhas de publicidade",   amount: ads,      excluded: false },
      { key: "tarifas_full",  label: "Tarifas Full",               amount: 0,        excluded: false },
      { key: "difal",         label: "Impostos cobrados pelo ML (DIFAL)", amount: 0, excluded: false },
      { key: "afiliados_outras", label: "Outras tarifas",          amount: 0,        excluded: false },
    ];
    const total = groups.filter((g) => !g.excluded).reduce((s, g) => s + g.amount, 0);
    return { groups, totalTarifas: total };
  }, [dailyBilling, billingData, gruposTarifas, totalTarifas, dreWaterfall, adsSpendMes]);

  // ── DRE: cascata do resultado (Phase 88) ──
  // Margem de contribuição = fonte única (dreMargem.ts, Phase 96 Plan 05).
  // [C1] receitaBrutaMes − cancelamentosVendas === receitaMes (algebricamente
  // idêntico à expressão legada — SC5/SC6, prova em dreMargem.test.ts Test 2).
  // Alimenta buildDreCascade junto com as linhas operacionais/financeiro da
  // RPC 87 → Resultado operacional e Resultado líquido. Guardrail SC-3
  // (impostos_venda/excluido) é do helper buildDreCascade.
  const margemContribuicao = useMemo(
    () =>
      computeMargemContribuicao({
        receitaBruta: receitaBrutaMes,
        cancelamentosVendas,
        totalTarifas: totalTarifasEfetivo,
        cmvMes,
        impostosMes,
      }),
    [receitaBrutaMes, cancelamentosVendas, totalTarifasEfetivo, cmvMes, impostosMes],
  );
  const dreCascade = useMemo(
    () => buildDreCascade(dreOperationalRows ?? [], margemContribuicao),
    [dreOperationalRows, margemContribuicao],
  );

  const currentGrossProfit = useMemo(() => {
    if (!monthlyCostWaterfall) return 0;
    const { paid_revenue, cmv, has_cmv, total_comissao, total_frete, total_tax, has_tax_data } = monthlyCostWaterfall;
    return Math.max(
      0,
      paid_revenue
        - (has_cmv ? cmv : 0)
        - total_comissao
        - total_frete
        - monthlyAdsTotal
        - (has_tax_data ? total_tax : 0),
    );
  }, [monthlyCostWaterfall, monthlyAdsTotal]);

  // ── MCO do período — input montado a partir de valores já derivados (sem novo fetch) ──
  // platformCost = custo_plataforma (frete+comissão, SEM ads — confirmado em useMLKPISummary)
  // ads somado UMA única vez via adsSummary.total_spend (anti-duplicação)
  const mcoInput = useMemo(() => {
    const grossRevenue = kpiSummary?.gross_revenue ?? 0;
    const platformCost = kpiSummary?.custo_plataforma ?? 0; // frete+comissão, exclui ads
    const ads = adsSummary.total_spend; // somado exatamente uma vez

    // CMV: valor real do período quando disponível; fallback por % do waterfall mensal
    const monthlyPaidRevenue = monthlyCostWaterfall?.paid_revenue ?? 0;
    const monthlyCmv = (monthlyCostWaterfall?.has_cmv ? (monthlyCostWaterfall?.cmv ?? 0) : 0);
    const cmvFallback =
      monthlyPaidRevenue > 0 ? grossRevenue * (monthlyCmv / monthlyPaidRevenue) : 0;
    const cmv = kpiSummary?.cmv_has_cost
      ? (kpiSummary?.cmv ?? 0)
      : cmvFallback;

    // Tax: valor real do período quando disponível; fallback por % do waterfall mensal
    const monthlyTax = (monthlyCostWaterfall?.has_tax_data ? (monthlyCostWaterfall?.total_tax ?? 0) : 0);
    const taxFallback =
      monthlyPaidRevenue > 0 ? grossRevenue * (monthlyTax / monthlyPaidRevenue) : 0;
    const tax = kpiSummary?.has_tax_data
      ? (kpiSummary?.total_tax ?? 0)
      : taxFallback;

    return { grossRevenue, cmv, platformCost, ads, tax };
  }, [kpiSummary, adsSummary.total_spend, monthlyCostWaterfall]);

  const { mco: mcoValue, pct: mcoPct } = useMemo(() => computeMco(mcoInput), [mcoInput]);

  // Rótulo dinâmico: "MCO do dia" quando o período selecionado é hoje
  const mcoLabel = useMemo(() => {
    const today = todayUTC();
    const isToday = filters.singleDayRange
      ? filters.singleDayRange === today
      : currentFrom === currentTo && currentTo === today;
    return isToday ? "MCO do dia" : "MCO do período";
  }, [filters.singleDayRange, currentFrom, currentTo]);

  const mcoEmpty = (kpiSummary?.gross_revenue ?? 0) <= 0;

  // Auto-recalc silencioso: se CMV ou impostos ausentes, dispara recalc-order-costs em background.
  // isRecalcing expõe o estado de loading para os cards que dependem de kpiSummary.
  const autoRecalcOrgId = currentOrg?.id ?? null;
  const { isRecalcing } = useAutoRecalc(costWaterfall, autoRecalcOrgId, resolvedMLUserIds, currentFrom, currentTo);
  useAutoRecalc(monthlyCostWaterfall, autoRecalcOrgId, resolvedMLUserIds, monthlyFrom, monthlyTo);

  // ── Sync state to context (debounced) ──
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      setSalesCache(() => ({
        daily: allDaily,
        hourly: allHourly,
        products: allProductSales.map(p => ({ ...p, date: p.date ?? "" })),
        mlUser,
        connected,
        lastSyncedAt,
        accessToken: "server-managed",
        productStockMap,
      }));
    }, 50);
    return () => clearTimeout(syncTimerRef.current);
  }, [allDaily, allHourly, allProductSales, mlUser, connected, lastSyncedAt, productStockMap, setSalesCache]);

  // ── Auto-sync de hoje no mount (1x por sessão, se stale > 10min) ──
  const autoSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!user || storeLoading || !connected || autoSyncDoneRef.current) return;
    autoSyncDoneRef.current = true;
    const lastTs = Number(localStorage.getItem("ml_last_synced_ts") ?? 0);
    if (Date.now() - lastTs > 10 * 60 * 1000) {
      syncFromAPI({ periodDays: 1 });
    }
    const firstStore = stores.find((s) => resolvedMLUserIds.includes(s.ml_user_id));
    if (firstStore) {
      supabase.functions
        .invoke("ml-inventory", { body: { ml_user_id: firstStore.ml_user_id } })
        .then(({ data: invData }) => {
          if (invData?.items) {
            const stockMap: Record<string, number> = {};
            for (const item of invData.items) stockMap[item.id] = item.available_quantity ?? 0;
            setProductStockMap(stockMap);
          }
        })
        .catch(() => {});
    }
  }, [user, storeLoading, connected, stores, resolvedMLUserIds, syncFromAPI]);

  // Reset on scope change
  useEffect(() => {
    autoSyncDoneRef.current = false;
    resetSync();
    setProductStockMap({});
  }, [scopeKey, resetSync]);

  // ── Supabase Realtime: auto-refresh quando cron atualiza ml_daily_cache ──
  const orgId = currentOrg?.id;
  useEffect(() => {
    if (!orgId || resolvedMLUserIds.length === 0) return;
    const channel = supabase
      .channel("ml_daily_cache_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ml_daily_cache",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          invalidate.invalidateAll();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, resolvedMLUserIds, invalidate]);

  // ── Period confirmation ──
  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      const resolvedRange = { from: filters.pendingRange.from, to: resolvedTo };
      setCustomRange(resolvedRange);
      setPeriod(0);
      filters.setPopoverOpen(false);
    } else if (filters.pendingPeriod !== null) {
      setCustomRange(null);
      setPeriod(filters.pendingPeriod);
      filters.setPopoverOpen(false);
    }
  }, [filters, setCustomRange, setPeriod]);

  // ── Filtered data ──
  const isNonZero = (d: DailyBreakdown) => d.total > 0 || d.qty > 0 || d.units_sold > 0;
  const daily = allDaily.filter((d) => d.date >= currentFrom && d.date <= currentTo && isNonZero(d));
  const previousDaily = allDaily.filter((d) => d.date >= prevFrom && d.date <= prevTo && isNonZero(d));
  const hourly = allHourly.filter((d) => {
    if (isHourlyAvailable) {
      if (filters.singleDayRange) return d.date === filters.singleDayRange;
      return d.date === todayUTC();
    }
    if (customRange?.from) {
      const from = format(startOfDay(customRange.from), "yyyy-MM-dd");
      const to = customRange.to ? format(startOfDay(customRange.to), "yyyy-MM-dd") : from;
      return d.date >= from && d.date <= to;
    }
    const cutoff = period === 0 ? todayUTC() : (() => { const dd = new Date(); dd.setDate(dd.getDate() - period); return format(dd, "yyyy-MM-dd"); })();
    return d.date >= cutoff;
  });

  const filteredTopProducts = useMemo(() => {
    // Products already come aggregated from the Edge Function
    return allProductSales
      .map((p) => ({ ...p, available_quantity: productStockMap[p.item_id] }))
      .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
      .slice(0, 10);
  }, [allProductSales, productStockMap]);

  // ── Effective data (Mercado Livre only) ──
  const effectiveDaily = useMemo(() => {
    return aggregateDailyRows(daily);
  }, [daily]);

  const effectiveHourly = useMemo(() => {
    const hourMap = new Map<number, HourlyBreakdown>();
    for (const h of hourly) {
      const existing = hourMap.get(h.hour);
      if (existing) { existing.total += h.total; existing.approved += h.approved; existing.qty += h.qty; }
      else hourMap.set(h.hour, { ...h });
    }
    return Array.from(hourMap.values()).sort((a, b) => a.hour - b.hour);
  }, [hourly]);

  const effectiveProducts = filteredTopProducts;

  // ── Metrics ──
  const effectiveMetrics = useMemo(() => {
    if (effectiveDaily.length === 0) return null;
    const m = {
      total_revenue: effectiveDaily.reduce((s, d) => s + d.total, 0),
      approved_revenue: effectiveDaily.reduce((s, d) => s + d.approved, 0),
      total_orders: effectiveDaily.reduce((s, d) => s + d.qty, 0),
      units_sold: effectiveDaily.reduce((s, d) => s + d.units_sold, 0),
      unique_visits: effectiveDaily.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: effectiveDaily.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    const paidCount = ordersSummary?.paid_orders_count ?? m.total_orders;
    const paidRev   = ordersSummary?.paid_revenue     ?? m.approved_revenue;
    if (paidCount > 0) {
      m.avg_ticket = paidRev / paidCount;
    } else if (m.total_orders > 0) {
      m.avg_ticket = m.total_revenue / m.total_orders; // fallback completo
    }
    if (m.unique_visits > 0) m.conversion_rate = (m.unique_buyers / m.unique_visits) * 100;
    return m;
  }, [effectiveDaily, ordersSummary]);

  // CMV e Impostos para o card: usa dados reais do período quando disponíveis,
  // senão estima via % do waterfall mensal aplicado à receita do dia (ml_daily_cache).
  // Base de estimativa: mês corrente se tiver dados, senão últimos 30 dias
  const dailyRevenue = useMemo(
    () => effectiveDaily.map((d) => ({ date: d.date, revenue: d.approved ?? 0 })),
    [effectiveDaily],
  );

  const effectivePreviousDaily = useMemo(
    () => aggregateDailyRows(previousDaily),
    [previousDaily]
  );

  const previousMetrics = useMemo(() => {
    if (effectivePreviousDaily.length === 0) return null;
    const m = {
      total_revenue: effectivePreviousDaily.reduce((s, d) => s + d.total, 0),
      units_sold: effectivePreviousDaily.reduce((s, d) => s + d.units_sold, 0),
      unique_visits: effectivePreviousDaily.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: effectivePreviousDaily.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      total_orders: effectivePreviousDaily.reduce((s, d) => s + d.qty, 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    if (m.total_orders > 0) m.avg_ticket = m.total_revenue / m.total_orders;
    if (m.unique_visits > 0) m.conversion_rate = (m.unique_buyers / m.unique_visits) * 100;
    return m;
  }, [effectivePreviousDaily]);

  // ── Monthly metrics for GoalsCard ──
  // Uses allMonthlyDaily — always month-to-date, independent of the period filter.
  const monthlyMetrics = useMemo(() => {
    const monthRows = aggregateDailyRows(allMonthlyDaily);
    if (monthRows.length === 0) return null;
    const r = {
      total_revenue: monthRows.reduce((s, d) => s + d.total, 0),
      units_sold: monthRows.reduce((s, d) => s + d.units_sold, 0),
      total_orders: monthRows.reduce((s, d) => s + d.qty, 0),
      unique_visits: monthRows.reduce((s, d) => s + (d.unique_visits || 0), 0),
      unique_buyers: monthRows.reduce((s, d) => s + (d.unique_buyers || 0), 0),
      avg_ticket: 0,
      conversion_rate: 0,
    };
    if (r.total_orders > 0) r.avg_ticket = r.total_revenue / r.total_orders;
    if (r.unique_visits > 0) r.conversion_rate = (r.unique_buyers / r.unique_visits) * 100;
    return r;
  }, [allMonthlyDaily]);

  // ── Per-store hourly data ──
  const perMarketplaceHourly = useMemo(() => {
    if (!isAll || stores.length < 2) return null;
    return stores
      .filter((s) => resolvedMLUserIds.includes(s.ml_user_id))
      .map((store) => ({
        id: store.ml_user_id,
        name: store.displayName,
        data: hourly.filter((h: any) => h.ml_user_id === store.ml_user_id),
        chartData: buildHourlyChartData(hourly.filter((h: any) => h.ml_user_id === store.ml_user_id)),
      }));
  }, [isAll, stores, resolvedMLUserIds, hourly]);

  const overlaidHourlyData = useMemo(() => {
    if (!isAll || !perMarketplaceHourly) return null;
    return Array.from({ length: 24 }, (_, hour) => {
      const row: Record<string, any> = { label: `${String(hour).padStart(2, "0")}h`, hour };
      for (const mp of perMarketplaceHourly) {
        row[mp.name] = mp.data.filter((d) => d.hour === hour).reduce((s, d) => s + d.total, 0);
      }
      return row;
    });
  }, [isAll, perMarketplaceHourly]);

  // ── Not connected state ──
  const onlyMLSelected = mlStores.length > 0;
  if (onlyMLSelected && !loading && !connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">
          {mlStores.length === 1
            ? "Conecte sua conta do Mercado Livre para visualizar os dados desta loja."
            : `Conecte as ${mlStores.length} contas do Mercado Livre para visualizar os dados.`}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => setOnboardingWizardOpen(true)}>Começar configuração</Button>
          <Button variant="outline" asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
        </div>
        <OnboardingWizard open={onboardingWizardOpen} onOpenChange={setOnboardingWizardOpen} />
      </div>
    );
  }

  const effectiveLoading = useRealData ? loading : false;
  const effectiveSyncing = useRealData ? syncing : false;

  const dailyChartData = [...effectiveDaily].map((d) => ({
    label: format(parseISO(d.date), "dd/MM", { locale: ptBR }),
    "Receita Total": d.total,
    "Venda Aprovada": d.approved,
    Pedidos: d.qty,
  }));

  const hourlyChartData = buildHourlyChartData(effectiveHourly);
  const showHourlyChart = (useRealData ? isHourlyAvailable : true) && chartMode === "hourly";
  const chartData = showHourlyChart ? hourlyChartData : dailyChartData;
  const hasData = useRealData ? allDaily.length > 0 || effectiveDaily.length > 0 : effectiveDaily.length > 0;
  const hasHourlyData = effectiveHourly.length > 0;
  const chartTitle = showHourlyChart ? `Receita por Hora — ${periodLabel}` : `Receita Diária — ${periodLabel}`;

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
          <AnimatePresence>
            {syncProgress && (() => {
              const pct = Math.round((syncProgress.current / syncProgress.total) * 100);
              const barColor = pct >= 100 ? "bg-[hsl(142,70%,45%)]" : pct >= 66 ? "bg-[hsl(25,95%,53%)]" : "bg-[hsl(217,70%,45%)]";
              return (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3 px-3 py-1.5 mb-3 rounded-md border border-border/50 bg-muted/30 text-xs text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tabular-nums">{pct}%</span>
                </motion.div>
              );
            })()}
          </AnimatePresence>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
            <MLPageHeader title="Vendas" lastUpdated={lastSyncTimestamp ? new Date(lastSyncTimestamp) : null} />
            <div className="flex items-center gap-2 flex-wrap min-w-0">
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
                customRange={customRange}
                period={period}
                onConfirm={handleConfirm}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncFromAPI()}
                disabled={syncing || !connected}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                aria-label="Atualizar"
                title="Atualizar dados"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{syncing ? "Atualizando..." : "Atualizar"}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLayoutOpen(true)}
                className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-muted-foreground"
                aria-label="Personalizar dashboard"
                title="Personalizar dashboard"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Personalizar</span>
              </Button>
            </div>
          </div>
      </div>

      <div className="space-y-5 animate-fade-in">
          {/* Banner de onboarding não-bloqueante (D-07): aparece quando onboarding
              incompleto OU ML não conectado. Fica acima do conteúdo, sem substituí-lo. */}
          <OnboardingBanner forceShow={!hasMLConnection || !onboardingComplete} />

          {/* Consultor v1 (Phase 45): card de saúde do negócio + top 3 insights.
              Visível quando a conta ML está conectada (pré-requisito real p/ ter
              insights). Gate anterior em onboardingComplete escondia o card em orgs
              já estabelecidas (ex: Pé Vermeio) cujo onboarding_progress persistido
              não marca todos os passos, mesmo com ML/custos/fiscal presentes. */}
          {connected && <ConsultorLLMSummary />}

          {connected && (
            <ConsultorCard
              insights={consultorInsights}
              score={consultorScore}
              scoreDelta={consultorScoreDelta}
              scoreBand={consultorScoreBand}
              syncing={consultorSyncing}
              onDismiss={consultorDismiss}
              onExplain={consultorLLMDisabled ? undefined : consultorExplain}
            />
          )}

          {/* Faixa MCO do período — posicionada entre ConsultorCard e MLKPIGrid.
              Visível apenas quando conectado (mesma condição do restante do conteúdo).
              Mudança 100% aditiva: não altera o MLKPIGrid nem nenhum KPI existente. */}
          {connected && (
            <MLMcoStrip
              mco={mcoValue}
              pct={mcoPct}
              label={mcoLabel}
              loading={kpiSummaryLoading || isRecalcing || effectiveLoading}
              empty={mcoEmpty}
            />
          )}

          {isML && !effectiveLoading && connected && !hasData && (
            <Card className="border-dashed">
              <CardContent className="flex items-center gap-3 py-4">
                <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Nenhum dado no cache. Clique em <strong>Atualizar</strong> ou use <strong>Histórico</strong>.
                </p>
              </CardContent>
            </Card>
          )}

          {widgets.map((widget) => {
            if (!widget.visible) return null;
            if (widget.id === "kpi_grid") return (
              <MLKPIGrid
                key="kpi_grid"
                metrics={effectiveMetrics}
                previousMetrics={previousMetrics}
                loading={effectiveLoading}
                syncing={effectiveSyncing}
                hasSyncProgress={!!syncProgress}
                kpiSummary={kpiSummary}
                kpiSummaryLoading={kpiSummaryLoading || isRecalcing}
                adsTotalForPeriod={adsSummary.total_spend}
              />
            );
            if (widget.id === "revenue_chart") return (
              <div key="revenue_chart" className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
                <MLRevenueChart
                  chartTitle={chartTitle}
                  showHourlyChart={showHourlyChart}
                  hasHourlyData={hasHourlyData}
                  syncing={syncing}
                  chartData={chartData}
                  isAll={isAll}
                  overlaidHourlyData={overlaidHourlyData}
                  perMarketplaceHourly={perMarketplaceHourly}
                />
                <GoalsCard
                  currentRevenue={monthlyMetrics?.total_revenue ?? 0}
                  currentOrders={monthlyMetrics?.units_sold ?? 0}
                  currentTicket={monthlyMetrics?.avg_ticket ?? 0}
                  currentConversion={monthlyMetrics?.conversion_rate ?? 0}
                  currentGrossProfit={currentGrossProfit}
                  grossProfitRevenue={monthlyCostWaterfall?.paid_revenue ?? 0}
                  storeId={selectedStore !== "all" ? String(selectedStore) : (stores[0]?.ml_user_id ?? undefined)}
                />
              </div>
            );
            if (widget.id === "cost_waterfall") return (
              <div key="cost_waterfall" className="grid grid-cols-1 lg:grid-cols-6 gap-3">
                <MLCostCard
                  mesLabel={mesLabel}
                  receitaMes={receitaMes}
                  receitaBruta={receitaBrutaMes}
                  cancelamentosVendas={cancelamentosVendas}
                  margemContribuicao={margemContribuicao}
                  gruposTarifas={gruposTarifasEfetivos}
                  totalTarifas={totalTarifasEfetivo}
                  cmvMes={cmvMes}
                  impostosMes={impostosMes}
                  fonte={dreFonte}
                  loading={dreWaterfallLoading}
                  onPrevMonth={handleDrePrevMonth}
                  onNextMonth={handleDreNextMonth}
                  canGoNext={dreCanGoNext}
                  syncing={billingSyncing || dailySyncing}
                  faturaFrom={billingData?.invoiceFrom}
                  faturaTo={billingData?.invoiceTo}
                  blocosOperacionais={dreCascade.operacionalBlocos}
                  resultadoOperacional={dreCascade.resultadoOperacional}
                  financeiro={dreCascade.financeiro}
                  resultadoLiquido={dreCascade.resultadoLiquido}
                  regime={regimeResult.regime}
                  mesClosed={monthClose.isClosed}
                  guiaCompetenceLabel={guiaCompetenceLabel}
                  canClose={canClose}
                  nudgeClose={nudgeClose}
                  onClose={handleCloseDreMonth}
                  onReopen={handleReopenDreMonth}
                  closeBusy={monthClose.isMutating}
                  closeBlocked={closeBlocked}
                  closeBlockReasons={closeGate.reasons}
                  cmvGaps={cmvGate.data ?? []}
                  naoClassificadoItems={naoClassificadoItemsQuery.data ?? []}
                />
                <MLTopProducts products={effectiveProducts} marginMap={marginMap} />
              </div>
            );
            if (widget.id === "brand_row") return (
              <div key="brand_row" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <BrandRevenueChart
                  data={brandData?.brandRevenueSeries ?? []}
                  topBrands={brandData?.topBrands ?? []}
                  loading={brandLoading}
                />
                <BrandMarkupChart
                  data={brandData?.brandMarkupSeries ?? []}
                  topBrands={brandData?.topBrands ?? []}
                  loading={brandLoading}
                />
                <CustoOperacionalChart
                  custoSeries={brandData?.custoSeries ?? []}
                  adsDaily={adsDaily}
                  dailyRevenue={dailyRevenue}
                  loading={brandLoading}
                />
              </div>
            );
            if (widget.id === "brand_share") return (
              <BrandSharePieChart
                key="brand_share"
                brandAggregates={brandData?.brandAggregates ?? []}
                loading={brandLoading}
              />
            );
            if (widget.id === "analytics") return (
              <MLSalesAnalytics key="analytics" from={currentFrom} to={currentTo} />
            );
            return null;
          })}
      </div>

      {/* ── Sheet de personalização ── */}
      <Sheet open={layoutOpen} onOpenChange={setLayoutOpen}>
        <SheetContent side="right" className="w-[340px] sm:w-[400px]">
          <SheetHeader className="pb-4">
            <SheetTitle>Personalizar Dashboard</SheetTitle>
            <SheetDescription>
              Ative, oculte e reordene as seções da página de Vendas.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2">
            {widgets.map((widget, idx) => (
              <div
                key={widget.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(widget.id)}
                    disabled={idx === 0}
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Mover para cima"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveDown(widget.id)}
                    disabled={idx === widgets.length - 1}
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Mover para baixo"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-none">{widget.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-tight">{widget.description}</p>
                </div>
                <Switch
                  checked={widget.visible}
                  onCheckedChange={() => toggleWidget(widget.id)}
                  aria-label={`${widget.visible ? "Ocultar" : "Mostrar"} ${widget.label}`}
                />
              </div>
            ))}
          </div>
          <div className="pt-4 border-t border-border/40 mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetLayout}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar padrão
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
