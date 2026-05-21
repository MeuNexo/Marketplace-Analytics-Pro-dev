import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Save, TrendingUp, ShoppingCart, Receipt, Percent, Store, Calendar, CheckCircle2, DollarSign } from "lucide-react";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useSettings } from "@/contexts/SettingsContext";
import { generateTargetId, generateDefaultPMTDistribution, monthLabels } from "@/types/settings";
import type { MonthlyTarget } from "@/types/settings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const today = new Date();
const currentYear = today.getFullYear();
const currentMonth = today.getMonth() + 1;
const years = [currentYear - 1, currentYear, currentYear + 1];
const months = Array.from({ length: 12 }, (_, i) => i + 1);

const currencyFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function parseCurrency(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10);
}

function parseDecimal(raw: string): number {
  const n = parseFloat(raw.replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function KpiInput({ label, icon, value, onChange, format: fmt, color }: {
  label: string;
  icon: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  format: "currency" | "number" | "percent";
  color: string;
}) {
  const [raw, setRaw] = useState(value > 0 ? String(Math.round(value)) : "");
  const [lastExternal, setLastExternal] = useState(value);

  // Only sync from external when the parent resets (store/month change)
  if (value !== lastExternal) {
    setLastExternal(value);
    setRaw(value > 0 ? String(Math.round(value)) : "");
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^\d.,]/g, "");
    setRaw(v);
    if (fmt === "currency") onChange(parseCurrency(v));
    else onChange(parseDecimal(v));
  };

  return (
    <div className="space-y-1.5">
      <Label className={cn("flex items-center gap-1.5 text-xs font-medium", color)}>
        {icon}{label}
      </Label>
      <div className="relative">
        {fmt === "currency" && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R$</span>
        )}
        <Input
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={handleChange}
          placeholder={fmt === "currency" ? "0" : fmt === "percent" ? "0.0" : "0"}
          className={cn("text-sm font-semibold", fmt === "currency" ? "pl-9" : fmt === "percent" ? "pr-6" : "")}
        />
        {fmt === "percent" && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
        )}
      </div>
    </div>
  );
}

export default function MLMetas() {
  const { toast } = useToast();
  const { stores, resolvedMLUserIds } = useMLStore();
  const { getTarget, saveTarget } = useSettings();

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [kpi, setKpi] = useState({ revenue: 0, orders: 0, ticket: 0, conversion: 0, gross_profit: 0 });

  // Drive store selection from the global header scope.
  // When the header has a single store selected, use it. When "Todas as lojas"
  // is active, fall back to the first available store so the user can still edit.
  const selectedStoreId = useMemo(() => {
    if (resolvedMLUserIds.length === 1) return resolvedMLUserIds[0];
    return stores[0]?.ml_user_id ?? "";
  }, [resolvedMLUserIds, stores]);
  const isAllStoresScope = resolvedMLUserIds.length !== 1 && stores.length > 1;

  useEffect(() => {
    if (!selectedStoreId) return;
    const existing = getTarget(selectedStoreId, "mercado-livre", selectedYear, selectedMonth);
    if (existing?.kpiTargets) {
      setKpi({
        revenue:      existing.kpiTargets.revenue      ?? existing.targetValue ?? 0,
        orders:       existing.kpiTargets.orders       ?? 0,
        ticket:       existing.kpiTargets.ticket       ?? 0,
        conversion:   existing.kpiTargets.conversion   ?? 0,
        gross_profit: existing.kpiTargets.gross_profit ?? 0,
      });
    } else if (existing?.targetValue) {
      setKpi({ revenue: existing.targetValue, orders: 0, ticket: 0, conversion: 0, gross_profit: 0 });
    } else {
      setKpi({ revenue: 0, orders: 0, ticket: 0, conversion: 0, gross_profit: 0 });
    }
  }, [selectedStoreId, selectedYear, selectedMonth, getTarget]);

  const selectedStore = stores.find((s) => s.ml_user_id === selectedStoreId);
  const hasAnyTarget = kpi.revenue > 0 || kpi.orders > 0 || kpi.ticket > 0 || kpi.conversion > 0 || kpi.gross_profit > 0;

  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!selectedStoreId) { toast({ title: "Selecione uma loja", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const id = generateTargetId(selectedStoreId, "mercado-livre", selectedYear, selectedMonth);
      const existing = getTarget(selectedStoreId, "mercado-livre", selectedYear, selectedMonth);
      const target: MonthlyTarget = {
        id, sellerId: selectedStoreId, marketplaceId: "mercado-livre",
        year: selectedYear, month: selectedMonth,
        targetValue: kpi.revenue,
        kpiTargets: { ...kpi },
        pmtDistribution: existing?.pmtDistribution ?? generateDefaultPMTDistribution(selectedYear, selectedMonth),
      };
      await saveTarget(target);
      toast({ title: "Metas salvas", description: selectedStore?.displayName ?? selectedStoreId });
    } catch {
      toast({ title: "Erro ao salvar", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [selectedStoreId, selectedYear, selectedMonth, kpi, getTarget, saveTarget, toast, selectedStore]);

  const savedTargets = useMemo(() => {
    if (!selectedStoreId) return [];
    return months
      .map((m) => ({ month: m, target: getTarget(selectedStoreId, "mercado-livre", selectedYear, m) }))
      .filter((r) => !!r.target && ((r.target.kpiTargets?.revenue ?? r.target.targetValue) > 0));
  }, [selectedStoreId, selectedYear, getTarget]);

  const kpiDefs = [
    { key: "revenue" as const,      label: "Receita Mensal", icon: <TrendingUp className="w-3.5 h-3.5" />,   format: "currency" as const, color: "text-emerald-600" },
    { key: "gross_profit" as const, label: "Lucro Bruto",    icon: <DollarSign className="w-3.5 h-3.5" />,   format: "currency" as const, color: "text-teal-600"   },
    { key: "orders" as const,       label: "Pedidos",        icon: <ShoppingCart className="w-3.5 h-3.5" />,  format: "number"   as const, color: "text-blue-600"   },
    { key: "ticket" as const,       label: "Ticket M\u00e9dio",   icon: <Receipt className="w-3.5 h-3.5" />,       format: "currency" as const, color: "text-orange-600" },
    { key: "conversion" as const,   label: "Convers\u00e3o",      icon: <Percent className="w-3.5 h-3.5" />,       format: "percent"  as const, color: "text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 min-w-0">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Metas</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Acompanhe no dashboard de Vendas
            </p>
          </div>
          <Button onClick={handleSave} disabled={!selectedStoreId || isAllStoresScope || !hasAnyTarget || saving} className="gap-2 w-full sm:w-auto shrink-0">
            <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Store className="w-3.5 h-3.5" /> Loja
              </Label>
              {stores.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nenhuma loja conectada</p>
              ) : (
                <div className="h-10 px-3 rounded-md border border-input bg-muted/40 flex items-center text-sm">
                  {isAllStoresScope ? (
                    <span className="text-muted-foreground italic">
                      Selecione uma loja no cabeçalho
                    </span>
                  ) : (
                    <span className="font-medium truncate">
                      {selectedStore?.displayName ?? "—"}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" /> M&ecirc;s
              </Label>
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => <SelectItem key={m} value={String(m)}>{monthLabels[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" /> Ano
              </Label>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Metas de {monthLabels[selectedMonth]} {selectedYear}
            {selectedStore && (
              <Badge variant="secondary" className="font-normal text-xs">{selectedStore.displayName}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {kpiDefs.map((def) => (
              <KpiInput
                key={def.key} label={def.label} icon={def.icon}
                value={kpi[def.key]}
                onChange={(v) => setKpi((p) => ({ ...p, [def.key]: v }))}
                format={def.format} color={def.color}
              />
            ))}
          </div>
          {hasAnyTarget && (
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10 text-xs">
              <p className="font-medium text-foreground mb-1.5 text-sm">Resumo</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {kpi.revenue > 0 && <span className="text-muted-foreground">Receita: <strong className="text-foreground">{currencyFmt(kpi.revenue)}</strong></span>}
                {kpi.gross_profit > 0 && <span className="text-muted-foreground">Lucro Bruto: <strong className="text-foreground">{currencyFmt(kpi.gross_profit)}</strong></span>}
                {kpi.orders > 0 && <span className="text-muted-foreground">Pedidos: <strong className="text-foreground">{kpi.orders.toLocaleString("pt-BR")}</strong></span>}
                {kpi.ticket > 0 && <span className="text-muted-foreground">Ticket: <strong className="text-foreground">{currencyFmt(kpi.ticket)}</strong></span>}
                {kpi.conversion > 0 && <span className="text-muted-foreground">Convers&atilde;o: <strong className="text-foreground">{kpi.conversion.toFixed(1)}%</strong></span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {savedTargets.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              Metas salvas &mdash; {selectedStore?.displayName ?? selectedStoreId} &mdash; {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {savedTargets.map(({ month, target }) => (
                <button
                  key={month}
                  onClick={() => setSelectedMonth(month)}
                  className={cn(
                    "text-left p-2.5 rounded-lg border text-xs transition-colors hover:bg-muted/50",
                    month === selectedMonth ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{monthLabels[month]}</span>
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  </div>
                  <span className="text-muted-foreground">
                    {currencyFmt(target!.kpiTargets?.revenue ?? target!.targetValue)}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
