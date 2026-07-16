// ============================================================================
// MLDreCaixa — /dre-caixa (Phase 99 Plan 03, Task 1)
// Página que responde, em destaque, "o que entrou no mês pagou as contas do
// mês?" — apuração em regime de caixa puro (Mercado Pago + Tiny). Layout
// LOCKED do 99-CONTEXT: header+badge → KPI row → cascata com drill-down →
// evolução 12m → histórico → banner dado-velho.
//
// Fontes EXCLUSIVAS: os 4 hooks do 99-02 (useDreCash/useDreCashItems/
// useDreCashHistory/useCashFreshness) + a lib pura dreCashCascade.ts.
// PROIBIDO importar qualquer hook/RPC do Fluxo de Caixa (painel de tesouraria
// ou projeção de saldo) ou da DRE de faturamento — Separações (LOCKED).
// ============================================================================

import { useMemo, useState } from "react";
import { format, startOfMonth, addMonths, subMonths, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { buildDreCashCascade, type DreCashSaidaLine } from "@/lib/dreCashCascade";
import { useDreCash } from "@/hooks/useDreCash";
import { useDreCashItems, type DreCashItem } from "@/hooks/useDreCashItems";
import { useDreCashHistory } from "@/hooks/useDreCashHistory";
import { useCashFreshness } from "@/hooks/useCashFreshness";

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmtBR = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const capitalize = (s: string) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);

/** Janela de "dado velho": 6h desde o último synced_at (lição 2026-07-13). */
const STALE_MS = 6 * 60 * 60 * 1000;

function hoursAgoLabel(iso: string | null): string {
  if (!iso) return "nunca sincronizado";
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "sincronizado há menos de 1h";
  return `sincronizado há ${hours}h`;
}

function isStale(iso: string | null): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > STALE_MS;
}

// ─── Badge-resposta ───────────────────────────────────────────────────────────

function BadgeResposta({
  tone,
  texto,
  isCurrentMonth,
}: {
  tone: "positive" | "negative" | "neutral";
  texto: string;
  isCurrentMonth: boolean;
}) {
  const toneStyles = {
    positive: "bg-kpi-positive/10 border-kpi-positive/30 text-kpi-positive",
    negative: "bg-kpi-negative/10 border-kpi-negative/30 text-kpi-negative",
    neutral: "bg-muted border-border text-muted-foreground",
  }[tone];

  const Icon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : Minus;

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap ${toneStyles}`}>
      <Icon className="w-5 h-5 shrink-0" />
      <span className="font-semibold text-sm sm:text-base">{texto}</span>
      {isCurrentMonth && (
        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/15 text-amber-500 shrink-0">
          mês em andamento
        </span>
      )}
    </div>
  );
}

// ─── Bloco de saída com drill-down ────────────────────────────────────────────

function SaidaBlocoRow({
  bloco,
  expanded,
  onToggle,
  items,
  itemsLoading,
}: {
  bloco: DreCashSaidaLine;
  expanded: boolean;
  onToggle: () => void;
  items: DreCashItem[];
  itemsLoading: boolean;
}) {
  const clickable = bloco.total > 0;

  return (
    <Collapsible open={expanded && clickable}>
      <div className="border-b border-border/40 last:border-b-0">
        <CollapsibleTrigger asChild disabled={!clickable}>
          <button
            type="button"
            onClick={clickable ? onToggle : undefined}
            disabled={!clickable}
            className="w-full flex items-center justify-between text-xs py-2 disabled:cursor-default"
          >
            <span className="text-muted-foreground flex items-center gap-1.5">
              {clickable ? (
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${expanded ? "rotate-0" : "-rotate-90"}`}
                />
              ) : (
                <span className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="text-muted-foreground/50">(−)</span>
              {bloco.label}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{fmtBR(bloco.total)}</span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pl-5 pb-2 space-y-2">
            {/* Categorias — já vêm agregadas localmente pela cascata (sem rede) */}
            {bloco.categorias.length > 0 && (
              <div className="space-y-0.5">
                {bloco.categorias.map((c) => (
                  <div key={c.categoria} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{c.categoria} ({c.n})</span>
                    <span className="tabular-nums text-muted-foreground">{fmtBR(c.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Lançamentos individuais — sob demanda (get_dre_cash_items) */}
            <div className="rounded-md border border-border/50 overflow-hidden">
              {itemsLoading ? (
                <div className="p-2 space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : items.length === 0 ? (
                <p className="text-[11px] text-muted-foreground p-2">Nenhum lançamento.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] h-7">Data</TableHead>
                      <TableHead className="text-[10px] h-7">Fornecedor</TableHead>
                      <TableHead className="text-[10px] h-7">Categoria</TableHead>
                      <TableHead className="text-[10px] h-7">Documento</TableHead>
                      <TableHead className="text-[10px] h-7 text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, i) => (
                      <TableRow key={`${item.outflow_date}-${i}`}>
                        <TableCell className="text-[11px] py-1.5">
                          {format(parseISO(item.outflow_date), "dd/MM")}
                        </TableCell>
                        <TableCell className="text-[11px] py-1.5">{item.supplier ?? "—"}</TableCell>
                        <TableCell className="text-[11px] py-1.5">{item.category ?? "—"}</TableCell>
                        <TableCell className="text-[11px] py-1.5">{item.document_number ?? "—"}</TableCell>
                        <TableCell className="text-[11px] py-1.5 text-right tabular-nums">
                          {fmtBR(item.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Página ────────────────────────────────────────────────────────────────────

export default function MLDreCaixa() {
  // Mês selecionado — sempre o primeiro dia do mês (regra dos hooks: "YYYY-MM-01")
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [expandedBloco, setExpandedBloco] = useState<string | null>(null);

  const pMonth = useMemo(() => format(selectedMonth, "yyyy-MM-dd"), [selectedMonth]);
  const currentMonthStart = useMemo(() => startOfMonth(new Date()), []);
  const isCurrentMonth = format(selectedMonth, "yyyy-MM") === format(currentMonthStart, "yyyy-MM");
  const canGoNext = !isCurrentMonth;

  const handlePrevMonth = () => {
    setExpandedBloco(null);
    setSelectedMonth((prev) => startOfMonth(subMonths(prev, 1)));
  };
  const handleNextMonth = () => {
    if (!canGoNext) return;
    setExpandedBloco(null);
    setSelectedMonth((prev) => startOfMonth(addMonths(prev, 1)));
  };

  const { data: rows, isLoading: rowsLoading, isError: rowsError, refetch: refetchRows } = useDreCash(pMonth);
  const cascade = useMemo(() => buildDreCashCascade(rows ?? []), [rows]);

  const { data: dreItems, isLoading: itemsLoading } = useDreCashItems(pMonth, expandedBloco);
  const { data: history, isLoading: historyLoading } = useDreCashHistory(12);
  const { data: freshness } = useCashFreshness();

  const inflowsStale = isStale(freshness?.inflowsSyncedAt ?? null);
  const outflowsStale = isStale(freshness?.outflowsSyncedAt ?? null);
  const anyStale = inflowsStale || outflowsStale;

  const totalSaidasN = cascade.saidas.reduce((s, b) => s + b.n, 0);

  const handleToggleBloco = (bloco: string) => {
    setExpandedBloco((prev) => (prev === bloco ? null : bloco));
  };

  // ── Loading inicial (sem organização ainda resolvida) ──
  if (rowsLoading && !rows) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MLPageHeader title="DRE Caixa" />

      {/* ── Banner dado-velho (topo) — acusa CADA fonte separadamente ── */}
      {anyStale && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Dados podem estar desatualizados</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-0.5 mt-1">
              <span>
                Entradas MP: {hoursAgoLabel(freshness?.inflowsSyncedAt ?? null)}
                {inflowsStale ? " — acima de 6h" : ""}
              </span>
              <span>
                Contas do Tiny: {hoursAgoLabel(freshness?.outflowsSyncedAt ?? null)}
                {outflowsStale ? " — acima de 6h" : ""}
              </span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {rowsError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erro ao carregar a DRE Caixa</AlertTitle>
          <AlertDescription>
            <button type="button" onClick={() => refetchRows()} className="underline">
              Tentar novamente
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Header: seletor de mês + badge-resposta ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="Mês anterior"
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium tabular-nums min-w-[140px] text-center capitalize">
            {capitalize(format(selectedMonth, "MMMM 'de' yyyy", { locale: ptBR }))}
          </span>
          <button
            type="button"
            onClick={handleNextMonth}
            disabled={!canGoNext}
            aria-label="Mês seguinte"
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <BadgeResposta tone={cascade.badge.tone} texto={cascade.badge.texto} isCurrentMonth={isCurrentMonth} />

        {isCurrentMonth && (
          <p className="text-xs text-muted-foreground -mt-1">
            Entradas contam só até hoje; "a liberar" mostrado à parte. O resultado do mês em andamento não é final.
          </p>
        )}
      </div>

      {/* ── KPI row (4x) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Entradas líquidas MP"
          value={fmtBR(cascade.entradas.liquido)}
          subtitleNode={
            <span className="text-xs text-muted-foreground">
              bruto {fmtBR(cascade.entradas.bruto)} · a liberar {fmtBR(cascade.entradas.aLiberar)}
            </span>
          }
          loading={rowsLoading}
        />
        <KPICard
          title="Saídas pagas"
          value={fmtBR(cascade.saidas.reduce((s, b) => s + b.total, 0) + cascade.financeiro)}
          subtitle={`${totalSaidasN} lançamento${totalSaidasN === 1 ? "" : "s"}`}
          loading={rowsLoading}
        />
        <KPICard
          title="Resultado do mês"
          value={fmtBR(cascade.resultadoCaixa)}
          variant={cascade.resultadoCaixa > 0 ? "success" : cascade.resultadoCaixa < 0 ? "danger" : "neutral"}
          loading={rowsLoading}
        />
        <KPICard
          title="Previsão imposto × guia"
          value={fmtBR(cascade.previsao.impostoGuiaPaga)}
          subtitleNode={
            <span className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
              previsto{" "}
              {cascade.previsao.impostoPrevisto === null ? "—" : fmtBR(cascade.previsao.impostoPrevisto)}
              {cascade.previsao.alert && (
                <span className="text-destructive font-medium inline-flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" />
                  desvio {cascade.previsao.desvioPct}%
                </span>
              )}
            </span>
          }
          loading={rowsLoading}
        />
      </div>

      {/* ── Cascata com drill-down ── */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-3">Cascata do mês</p>

          {/* Entradas — informativas (muted) */}
          <div className="space-y-0.5 opacity-70">
            <div className="flex items-center justify-between text-xs py-0.5">
              <span className="text-muted-foreground">Recebimento bruto MP</span>
              <span className="tabular-nums text-muted-foreground">{fmtBR(cascade.entradas.bruto)}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-0.5">
              <span className="text-muted-foreground">(−) Descontos na fonte</span>
              <span className="tabular-nums text-muted-foreground">{fmtBR(cascade.entradas.descontosFonte)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] py-0.5 pl-3">
              <span className="text-muted-foreground/70">dos quais devoluções</span>
              <span className="tabular-nums text-muted-foreground/70">{fmtBR(cascade.entradas.refunds)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] py-0.5 pl-3">
              <span className="text-muted-foreground/70">ainda a liberar no mês</span>
              <span className="tabular-nums text-muted-foreground/70">{fmtBR(cascade.entradas.aLiberar)}</span>
            </div>
          </div>

          {/* Recebimento líquido — linha forte */}
          <div className="flex items-center justify-between text-sm py-2 mt-1 border-y-2 border-border font-bold">
            <span>= RECEBIMENTO LÍQUIDO MP</span>
            <span className="tabular-nums">{fmtBR(cascade.entradas.liquido)}</span>
          </div>

          {/* Blocos de saída — drill-down */}
          <div className="mt-1">
            {cascade.saidas.map((bloco) => (
              <SaidaBlocoRow
                key={bloco.bloco}
                bloco={bloco}
                expanded={expandedBloco === bloco.bloco}
                onToggle={() => handleToggleBloco(bloco.bloco)}
                items={expandedBloco === bloco.bloco ? dreItems ?? [] : []}
                itemsLoading={expandedBloco === bloco.bloco && itemsLoading}
              />
            ))}
          </div>

          {/* Gate visual — nao_classificado > 0 */}
          {cascade.naoClassificadoTotal > 0 && (
            <Alert variant="destructive" className="mt-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {fmtBR(cascade.naoClassificadoTotal)} em lançamentos não classificados — recategorize no Tiny.
              </AlertDescription>
            </Alert>
          )}

          {/* Subtotal: Resultado operacional de caixa */}
          <div className="flex items-center justify-between text-sm py-2 mt-2 border-t border-border font-semibold">
            <span>= RESULTADO OPERACIONAL DE CAIXA</span>
            <span
              className={`tabular-nums ${cascade.resultadoOperacional >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}
            >
              {fmtBR(cascade.resultadoOperacional)}
            </span>
          </div>

          {/* Financeiro */}
          <div className="flex items-center justify-between text-xs py-1">
            <span className="text-muted-foreground">(−) Financeiro</span>
            <span className="tabular-nums text-foreground">{fmtBR(cascade.financeiro)}</span>
          </div>

          {/* Total: Resultado de caixa do mês */}
          <div className="flex items-center justify-between text-base py-2.5 mt-1 border-t-2 border-border font-bold">
            <span>= RESULTADO DE CAIXA DO MÊS</span>
            <span
              className={`tabular-nums ${cascade.resultadoCaixa >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}
            >
              {fmtBR(cascade.resultadoCaixa)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Evolução 12 meses ── */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-medium">Evolução dos últimos 12 meses</p>
          <p className="text-xs text-muted-foreground mt-0.5">Entradas × saídas × resultado, por mês</p>
        </div>
        <CardContent className="px-4 pb-4 pt-0">
          {historyLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : !history || history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem histórico disponível.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis
                  dataKey="mes"
                  tickFormatter={(v: string) => capitalize(format(parseISO(v), "MMM", { locale: ptBR }))}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtBR(v)}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [
                    fmtBR(value),
                    name === "entradas" ? "Entradas" : name === "saidas" ? "Saídas" : "Resultado",
                  ]}
                  labelFormatter={(v: string) => capitalize(format(parseISO(v), "MMMM 'de' yyyy", { locale: ptBR }))}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.5} />
                <Bar dataKey="entradas" fill="hsl(var(--kpi-positive))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="saidas" fill="hsl(var(--kpi-negative))" radius={[3, 3, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="resultado"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Tabela histórico mensal ── */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm font-medium">Histórico mensal</p>
        </div>
        <CardContent className="px-4 pb-4 pt-0">
          {historyLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !history || history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Sem histórico disponível.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => {
                  const rowIsCurrent = format(parseISO(row.mes), "yyyy-MM") === format(currentMonthStart, "yyyy-MM");
                  return (
                    <TableRow key={row.mes}>
                      <TableCell className="capitalize">
                        {capitalize(format(parseISO(row.mes), "MMMM 'de' yyyy", { locale: ptBR }))}
                        {rowIsCurrent && (
                          <span className="ml-1.5 text-[10px] text-amber-500 font-medium">(mês em andamento)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBR(row.entradas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBR(row.saidas)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${row.resultado >= 0 ? "text-kpi-positive" : "text-kpi-negative"}`}
                      >
                        {fmtBR(row.resultado)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Frescor no rodapé (fora da janela de alerta) ── */}
      {!anyStale && (
        <p className="text-[11px] text-muted-foreground/60 text-center">
          Entradas MP {hoursAgoLabel(freshness?.inflowsSyncedAt ?? null)} · Contas do Tiny{" "}
          {hoursAgoLabel(freshness?.outflowsSyncedAt ?? null)}
        </p>
      )}
    </div>
  );
}
