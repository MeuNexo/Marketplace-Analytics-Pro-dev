import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, HelpCircle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type { BillingGroup } from "@/hooks/useMLBilling";
import { computeResultadoLiquido, type DreOperationalBlocks } from "@/lib/dreOperational";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const pct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : "—";

// "2026-05-06" → "06/05" (sem timezone — corte direto da string ISO)
const fmtDayMonth = (iso: string) => {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
};

// ── Tipos ──────────────────────────────────────────────────────────────────

interface MLCostCardProps {
  /** Label do mês em pt-BR, ex.: "Junho/2026" */
  mesLabel: string;
  /** Receita do mês (pedidos pagos) */
  receitaMes: number;
  /** Grupos de tarifas ML agrupados por groupBillingCharges().groups */
  gruposTarifas: BillingGroup[];
  /** Soma total dos grupos de tarifas */
  totalTarifas: number;
  /** CMV do mês — null = sem custo cadastrado */
  cmvMes: number | null;
  /** Impostos próprios do mês (regime fiscal) — null = sem config fiscal */
  impostosMes: number | null;
  /** "competencia" = ml_billing_daily mês-calendário 01–31 | "billing" = fatura mensal (ciclo 06→05) | "estimado" = fallback de orders */
  fonte: "competencia" | "billing" | "estimado";
  loading?: boolean;
  /** Navega para o mês anterior */
  onPrevMonth?: () => void;
  /** Navega para o mês seguinte (desabilitado além do mês corrente) */
  onNextMonth?: () => void;
  /** false quando o mês exibido é o mês corrente (não navega para frente) */
  canGoNext?: boolean;
  /** true enquanto sync on-demand do billing do mês está em andamento */
  syncing?: boolean;
  /** Janela real da fatura ML (ciclo da conta) — YYYY-MM-DD, exibida quando fonte=billing */
  faturaFrom?: string | null;
  faturaTo?: string | null;
  /** Custos operacionais (Pessoal/Estrutura/Serviços/Outros/Financeiro) do mesmo mês — Phase 88 */
  dreOperational?: DreOperationalBlocks | null;
  /** true enquanto useDreOperational ainda está buscando o mês exibido */
  dreOperationalLoading?: boolean;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function MLCostCard({
  mesLabel,
  receitaMes,
  gruposTarifas,
  totalTarifas,
  cmvMes,
  impostosMes,
  fonte,
  loading,
  onPrevMonth,
  onNextMonth,
  canGoNext = false,
  syncing = false,
  faturaFrom,
  faturaTo,
  dreOperational = null,
  dreOperationalLoading = false,
}: MLCostCardProps) {
  // Lucro do mês = receita − total tarifas − CMV − impostos
  const lucro =
    receitaMes
    - totalTarifas
    - (cmvMes ?? 0)
    - (impostosMes ?? 0);
  const lucroPositivo = lucro >= 0;
  const margemPct = receitaMes > 0 ? ((lucro / receitaMes) * 100).toFixed(1) : "—";

  // Resultado operacional / Resultado líquido — reusa `lucro` já calculado acima
  // (não re-deriva a margem); só ANEXA os blocos operacionais (Phase 88).
  const { resultadoOperacional, resultadoLiquido } = dreOperational
    ? computeResultadoLiquido(lucro, dreOperational)
    : { resultadoOperacional: 0, resultadoLiquido: 0 };
  const resultadoLiquidoPositivo = resultadoLiquido >= 0;
  const resultadoLiquidoPct = receitaMes > 0 ? ((resultadoLiquido / receitaMes) * 100).toFixed(1) : "—";

  const [financeiroTooltipOpen, setFinanceiroTooltipOpen] = useState(false);

  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="h-full relative overflow-hidden">
        {/* ── Cabeçalho ── */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">DRE do Mês</span>
          <div className="flex items-center gap-1.5">
            {syncing && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            )}
            <button
              type="button"
              onClick={onPrevMonth}
              disabled={!onPrevMonth || syncing}
              aria-label="Mês anterior"
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium tabular-nums text-foreground min-w-[88px] text-center">
              {mesLabel}
            </span>
            <button
              type="button"
              onClick={onNextMonth}
              disabled={!onNextMonth || !canGoNext || syncing}
              aria-label="Mês seguinte"
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                fonte === "competencia"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : fonte === "billing"
                  ? "bg-blue-500/15 text-blue-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {fonte === "competencia" ? "mês 01–31" : fonte === "billing" ? "fatura ML" : "estimado"}
            </span>
          </div>
        </div>

        {/* No modo fatura mensal, o ciclo de cobrança não é o mês-calendário —
            mostra a janela real. No modo competência (mês 01–31) não se aplica. */}
        {fonte === "billing" && faturaFrom && faturaTo && (
          <div className="px-4 pb-1 -mt-1 flex justify-end">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Tarifas da fatura ML: {fmtDayMonth(faturaFrom)} → {fmtDayMonth(faturaTo)}
            </span>
          </div>
        )}

        <CardContent className="px-4 pb-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-5 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-0">
              {/* ── Receita do mês ── */}
              <div className="flex items-end justify-between pb-2 mb-1.5 border-b border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Receita do mês (vendas pagas)
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {fmt(receitaMes)}
                  </p>
                </div>
              </div>

              {/* ── Grupos de tarifas ── */}
              <div className="space-y-0">
                {gruposTarifas.map((grupo) => (
                  <div
                    key={grupo.key}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <span className="text-muted-foreground flex items-center gap-1">
                      <span className="text-muted-foreground/50">(−)</span>
                      {grupo.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(grupo.amount, receitaMes)}
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                        {fmt(grupo.amount)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Total de tarifas ML */}
                <div className="flex items-center justify-between text-xs pt-1.5 mt-0.5 border-t border-border/60">
                  <span className="flex items-center gap-1 font-semibold text-foreground">
                    <span className="text-muted-foreground/50">=</span>
                    Total de tarifas ML
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                      {pct(totalTarifas, receitaMes)}
                    </span>
                    <span className="font-bold tabular-nums w-24 text-right text-foreground">
                      {fmt(totalTarifas)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── CMV do mês ── */}
              <div className="flex items-center justify-between text-xs py-1 mt-0.5 border-t border-border/40">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="text-muted-foreground/50">(−)</span>
                  CMV do mês
                </span>
                <div className="flex items-center gap-2">
                  {cmvMes != null ? (
                    <>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(cmvMes, receitaMes)}
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                        {fmt(cmvMes)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] italic text-muted-foreground w-24 text-right">
                      s/ custo
                    </span>
                  )}
                </div>
              </div>

              {/* ── Impostos próprios ── */}
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="text-muted-foreground/50">(−)</span>
                  Impostos próprios (regime fiscal)
                </span>
                <div className="flex items-center gap-2">
                  {impostosMes != null ? (
                    <>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(impostosMes, receitaMes)}
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                        {fmt(impostosMes)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] italic text-muted-foreground w-24 text-right">
                      s/ config
                    </span>
                  )}
                </div>
              </div>

              {/* ── Lucro do mês ── */}
              <div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  {lucroPositivo ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  )}
                  Lucro do mês
                  <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                    ({margemPct}%)
                  </span>
                </span>
                <span
                  className={`text-base font-bold tabular-nums w-24 text-right ${
                    lucroPositivo ? "text-kpi-positive" : "text-kpi-negative"
                  }`}
                >
                  {fmt(lucro)}
                </span>
              </div>

              {/* ── Custos operacionais → Resultado líquido (Phase 88) ── */}
              {(dreOperational || dreOperationalLoading) && (
                <div className="space-y-0">
                  {!dreOperational && dreOperationalLoading ? (
                    <div className="space-y-2 pt-2.5 mt-1.5 border-t border-border/40">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-4 bg-muted/30 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : dreOperational ? (
                    <>
                      {/* Pessoal */}
                      <div className="flex items-center justify-between text-xs py-1 mt-0.5 border-t border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/50">(−)</span>
                          Pessoal
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(dreOperational.pessoal, receitaMes)}
                          </span>
                          <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                            {fmt(dreOperational.pessoal)}
                          </span>
                        </div>
                      </div>

                      {/* Estrutura */}
                      <div className="flex items-center justify-between text-xs py-1">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/50">(−)</span>
                          Estrutura
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(dreOperational.estrutura, receitaMes)}
                          </span>
                          <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                            {fmt(dreOperational.estrutura)}
                          </span>
                        </div>
                      </div>

                      {/* Serviços */}
                      <div className="flex items-center justify-between text-xs py-1">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/50">(−)</span>
                          Serviços
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(dreOperational.servicos, receitaMes)}
                          </span>
                          <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                            {fmt(dreOperational.servicos)}
                          </span>
                        </div>
                      </div>

                      {/* Outros */}
                      <div className="flex items-center justify-between text-xs py-1">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/50">(−)</span>
                          Outros
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(dreOperational.outros_operacionais, receitaMes)}
                          </span>
                          <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                            {fmt(dreOperational.outros_operacionais)}
                          </span>
                        </div>
                      </div>

                      {/* = Resultado operacional */}
                      <div className="flex items-center justify-between text-xs pt-1.5 mt-0.5 border-t border-border/60">
                        <span className="flex items-center gap-1 font-semibold text-foreground">
                          <span className="text-muted-foreground/50">=</span>
                          Resultado operacional
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(resultadoOperacional, receitaMes)}
                          </span>
                          <span className="font-bold tabular-nums w-24 text-right text-foreground">
                            {fmt(resultadoOperacional)}
                          </span>
                        </div>
                      </div>

                      {/* Financeiro */}
                      <div className="flex items-center justify-between text-xs py-1 mt-0.5 border-t border-border/40">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <span className="text-muted-foreground/50">(−)</span>
                          Financeiro
                          {dreOperational.financeiro_is_approximate && (
                            <>
                              <span className="text-[9px] italic text-muted-foreground/80">
                                (aproximado)
                              </span>
                              <Popover open={financeiroTooltipOpen} onOpenChange={setFinanceiroTooltipOpen}>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Ver definição de aproximado"
                                    className="inline-flex w-3.5 h-3.5 items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors focus:outline-none"
                                    onMouseEnter={() => setFinanceiroTooltipOpen(true)}
                                    onMouseLeave={() => setFinanceiroTooltipOpen(false)}
                                    onClick={(e) => { e.stopPropagation(); setFinanceiroTooltipOpen((v) => !v); }}
                                  >
                                    <HelpCircle className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  side="top"
                                  align="start"
                                  sideOffset={6}
                                  className="w-auto max-w-[240px] px-3 py-2 text-xs"
                                  onOpenAutoFocus={(e) => e.preventDefault()}
                                >
                                  Valor aproximado — juros ainda não estão separados do principal
                                  nos empréstimos (pendente detalhamento da tabela do banco).
                                </PopoverContent>
                              </Popover>
                            </>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                            {pct(dreOperational.financeiro, receitaMes)}
                          </span>
                          <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                            {fmt(dreOperational.financeiro)}
                          </span>
                        </div>
                      </div>

                      {/* = Resultado líquido */}
                      <div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
                        <span className="flex items-center gap-1.5 font-semibold text-foreground">
                          {resultadoLiquidoPositivo ? (
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                          )}
                          Resultado líquido
                          <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                            ({resultadoLiquidoPct}%)
                          </span>
                        </span>
                        <span
                          className={`text-base font-bold tabular-nums w-24 text-right ${
                            resultadoLiquidoPositivo ? "text-kpi-positive" : "text-kpi-negative"
                          }`}
                        >
                          {fmt(resultadoLiquido)}
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
