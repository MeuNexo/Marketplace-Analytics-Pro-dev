// ============================================================================
// TreasuryPanel — 12 KPIs em 3 faixas rotuladas
//   Faixa 1 — Saúde de Caixa: Saldo Atual, Runway, Saldo Mín 30d, Alerta
//   Faixa 2 — Realizado (30d): Entrada Real, Saída Real, Resultado, Burn Rate
//   Faixa 3 — Exposição a Fornecedor: Fornec 30/60/90d, Total Exposição
// TESO-01
// ============================================================================

import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTreasuryPanel } from "@/hooks/useTreasuryPanel";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** ISO date string "YYYY-MM-DD" → "DD/MM/AAAA"; null → "—" */
const dateFmt = (iso: string | null): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ─── KPI mini-card ────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  className?: string;
}

function KpiCard({ label, value, subtitle, className }: KpiCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-3 space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
          {label}
        </p>
        <div className="leading-none">{value}</div>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Band header ──────────────────────────────────────────────────────────────

interface BandHeaderProps {
  label: string;
  colorClass: string;
  lineClass: string;
}

function BandHeader({ label, colorClass, lineClass }: BandHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass}`}>
        {label}
      </span>
      <div className={`flex-1 h-px ${lineClass}`} />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface TreasuryPanelProps {
  /** CASHFIX-06: inclui ordens de compra não faturadas nos indicadores de saldo/projeção
   *  (saldo atual, data de alerta, saldo mínimo, saldo projetado). Default false.
   *  A exposição por fornecedor não é afetada. */
  includePurchaseForecasts?: boolean;
}

export function TreasuryPanel({ includePurchaseForecasts = false }: TreasuryPanelProps = {}) {
  const { data: treasury, isLoading: loadingTreasury } = useTreasuryPanel(includePurchaseForecasts);
  const { data: projected, isLoading: loadingProjected } = useProjectedBalance(90, includePurchaseForecasts);
  const { data: settings } = useFinancialSettings();

  const isLoading = loadingTreasury || loadingProjected;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Faixa 1: Saúde de Caixa ─────────────────────────────────────────────────
  const currentBalance = projected?.current_balance ?? 0;
  const burnRate = treasury?.burn_rate ?? 0;
  const runway = burnRate > 0 ? currentBalance / burnRate : null;
  const minBalance = treasury?.min_balance ?? 0;
  const alertThreshold = settings?.alert_threshold ?? treasury?.alert_threshold ?? 30000;
  const alertDate = treasury?.alert_date ?? null;
  const minBalanceDate = treasury?.min_balance_date ?? null;

  // ── Faixa 2: Realizado ───────────────────────────────────────────────────────
  const entradaReal = treasury?.entrada_real_30d ?? 0;
  const saidaReal = treasury?.saida_real_30d ?? 0;
  const resultado = entradaReal - saidaReal;

  // ── Faixa 3: Exposição a Fornecedor ─────────────────────────────────────────
  const fornec30 = treasury?.fornec_30d ?? 0;
  const fornec60 = treasury?.fornec_60d ?? 0;
  const fornec90 = treasury?.fornec_90d ?? 0;
  const totalExposicao = treasury?.total_exposicao ?? 0;

  return (
    <div className="space-y-4">

      {/* ── Faixa 1: Saúde de Caixa ── */}
      <div className="space-y-2">
        <BandHeader
          label="Saúde de Caixa"
          colorClass="text-amber-600"
          lineClass="bg-amber-200/60"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Saldo Atual */}
          <KpiCard
            label="Saldo Atual"
            value={
              <p className={`text-lg font-bold tabular-nums leading-none ${currentBalance >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}>
                {currFmt(currentBalance)}
              </p>
            }
          />

          {/* Runway (meses) */}
          <KpiCard
            label="Runway (meses)"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-neutral">
                {runway !== null ? `${runway.toFixed(2)} meses` : "—"}
              </p>
            }
          />

          {/* Saldo Mín 30d */}
          <KpiCard
            label="Saldo Mín 30d"
            value={
              <p className={`text-lg font-bold tabular-nums leading-none ${minBalance < alertThreshold ? "text-kpi-negative" : "text-kpi-neutral"}`}>
                {currFmt(minBalance)}
              </p>
            }
            subtitle={dateFmt(minBalanceDate)}
          />

          {/* Alerta */}
          <Card className={alertDate ? "border-destructive/40" : ""}>
            <CardContent className="p-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
                Alerta
              </p>
              {alertDate ? (
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-kpi-negative shrink-0 mt-0.5" />
                  <p className="text-xs font-medium text-kpi-negative leading-tight">
                    Saldo abaixo de {currFmt(alertThreshold)} em {dateFmt(alertDate)}
                  </p>
                </div>
              ) : (
                <p className="text-sm font-semibold text-kpi-positive">Sem alerta</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Faixa 2: Realizado (30d) ── */}
      <div className="space-y-2">
        <BandHeader
          label="Realizado (30d)"
          colorClass="text-blue-600"
          lineClass="bg-blue-200/60"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Entrada Real */}
          <KpiCard
            label="Entrada Real"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-positive">
                {currFmt(entradaReal)}
              </p>
            }
          />

          {/* Saída Real */}
          <KpiCard
            label="Saída Real"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-negative">
                {currFmt(saidaReal)}
              </p>
            }
          />

          {/* Resultado */}
          <KpiCard
            label="Resultado"
            value={
              <p className={`text-lg font-bold tabular-nums leading-none ${resultado >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}>
                {currFmt(resultado)}
              </p>
            }
          />

          {/* Burn Rate */}
          <KpiCard
            label="Burn Rate"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-neutral">
                {currFmt(burnRate)}
              </p>
            }
            subtitle="média mensal (3m)"
          />
        </div>
      </div>

      {/* ── Faixa 3: Exposição a Fornecedor ── */}
      <div className="space-y-2">
        <BandHeader
          label="Exposição a Fornecedor"
          colorClass="text-orange-600"
          lineClass="bg-orange-200/60"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Fornec 30d */}
          <KpiCard
            label="Fornec ≤ 30d"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-negative">
                {currFmt(fornec30)}
              </p>
            }
          />

          {/* Fornec 60d */}
          <KpiCard
            label="Fornec ≤ 60d"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-negative">
                {currFmt(fornec60)}
              </p>
            }
          />

          {/* Fornec 90d */}
          <KpiCard
            label="Fornec ≤ 90d"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-negative">
                {currFmt(fornec90)}
              </p>
            }
          />

          {/* Total Exposição */}
          <KpiCard
            label="Total Exposição"
            value={
              <p className="text-lg font-bold tabular-nums leading-none text-kpi-negative">
                {currFmt(totalExposicao)}
              </p>
            }
          />
        </div>
      </div>

    </div>
  );
}
