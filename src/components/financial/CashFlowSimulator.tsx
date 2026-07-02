// ============================================================================
// CashFlowSimulator — aba "Simulador" da página de Fluxo de Caixa ("E se...?")
// Detém o estado de SESSÃO (useState, sem persistência — recarregar volta ao real):
//   - recebExtra (R$/dia), gastoExtra (R$/dia), eventos[] (0 a 2 pontuais).
// Reusa o baseline via useCashFlowData (hoje → hoje+120) + margem via
// useFinancialSettings (safety_margin, default 10000), chama simulateCashflow
// (plano 50-01) e injeta o resultado no CashFlowChart (simulatedSeries) e no
// SimulatorVerdictCard (verdict). Ranges/steps/eventos LOCKED no CONTEXT.md.
// Cores SEMPRE via tokens (hsl(var(--token))). SIM-02 / SIM-03
// ============================================================================

import { useMemo, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Plus, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CashFlowChart } from "@/components/financial/CashFlowChart";
import { SimulatorVerdictCard } from "@/components/financial/SimulatorVerdictCard";
import { useCashFlowData } from "@/hooks/useCashFlowData";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";
import { simulateCashflow } from "@/lib/cashflowSimulation";
import type { SimEvent, SimEventType } from "@/lib/cashflowSimulation";
import { formatCurrency } from "@/lib/formatters";

// ─── Constantes (ranges/steps LOCKED — CONTEXT.md) ─────────────────────────────

const FUTURE_DAYS = 120; // mesmo horizonte da aba Caixa Real

const RECEB_MIN = -5000;
const RECEB_MAX = 5000;
const RECEB_STEP = 100;

const GASTO_MIN = 0;
const GASTO_MAX = 10000;
const GASTO_STEP = 100;

const MAX_EVENTOS = 2;
const DEFAULT_MARGEM = 10000;

// ─── Item de evento pontual (editável na lista) ────────────────────────────────

interface EventoRowProps {
  evento: SimEvent;
  minDate: Date;
  maxDate: Date;
  disabled: boolean;
  onChange: (next: SimEvent) => void;
  onRemove: () => void;
}

/** Formata um fullDate yyyy-MM-dd como dd/MM/yyyy sem deslocamento de fuso. */
function fmtDateLabel(fullDate: string): string {
  if (!fullDate || fullDate.length < 10) return "Escolher data";
  const [y, m, d] = fullDate.substring(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : "Escolher data";
}

function EventoRow({
  evento,
  minDate,
  maxDate,
  disabled,
  onChange,
  onRemove,
}: EventoRowProps) {
  const [open, setOpen] = useState(false);
  const isEntrada = evento.tipo === "entrada";

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
      {/* Linha 1: tipo (toggle) + remover */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={isEntrada}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ ...evento, tipo: (checked ? "entrada" : "saida") as SimEventType })
            }
            aria-label="Alternar entrada/saída"
          />
          <span
            className={`text-xs font-semibold ${
              isEntrada ? "text-kpi-positive" : "text-kpi-negative"
            }`}
          >
            {isEntrada ? "Entrada" : "Saída"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-kpi-negative"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remover evento"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Linha 2: valor + data */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Valor (R$)</Label>
          <Input
            type="number"
            min={0}
            step={100}
            value={evento.valor === 0 ? "" : String(evento.valor)}
            disabled={disabled}
            placeholder="0"
            className="h-9 tabular-nums"
            onChange={(e) => {
              const parsed = parseFloat(e.target.value.replace(",", "."));
              onChange({ ...evento, valor: isNaN(parsed) ? 0 : Math.max(0, parsed) });
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Data</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                className="h-9 w-full justify-start gap-1.5 px-2 text-left font-normal"
              >
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs">{fmtDateLabel(evento.data)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                locale={ptBR}
                selected={evento.data ? parseISO(evento.data) : undefined}
                // Edge §7: limita a [hoje, hoje+120]; datas fora ficam desabilitadas.
                disabled={(date) => date < minDate || date > maxDate}
                defaultMonth={evento.data ? parseISO(evento.data) : minDate}
                onSelect={(date) => {
                  if (date) onChange({ ...evento, data: format(date, "yyyy-MM-dd") });
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export function CashFlowSimulator() {
  // Estado de SESSÃO (sem persistência — decisão LOCKED).
  const [recebExtra, setRecebExtra] = useState(0);
  const [gastoExtra, setGastoExtra] = useState(0);
  const [eventos, setEventos] = useState<SimEvent[]>([]);

  // Período: hoje → hoje + 120 dias (mesmo horizonte da aba Caixa Real).
  const { startDate, endDate, minDate, maxDate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const max = addDays(today, FUTURE_DAYS);
    return {
      startDate: format(today, "yyyy-MM-dd"),
      endDate: format(max, "yyyy-MM-dd"),
      minDate: today,
      maxDate: max,
    };
  }, []);

  const { data: baseline, isLoading: baselineLoading } = useCashFlowData(
    startDate,
    endDate,
  );
  const { data: financialSettings } = useFinancialSettings();
  const margem = financialSettings?.safety_margin ?? DEFAULT_MARGEM;

  // Cálculo memoizado (módulo puro 50-01).
  const { series, verdict } = useMemo(
    () =>
      simulateCashflow(baseline ?? [], {
        recebExtra,
        gastoExtra,
        eventos,
        margem,
      }),
    [baseline, recebExtra, gastoExtra, eventos, margem],
  );

  const hasBaseline = !!baseline && baseline.length > 0;
  const controlsDisabled = baselineLoading || !hasBaseline;

  // Só passa a série simulada ao gráfico quando há simulação ativa (spec §5).
  const simulatedSeries = verdict.ativa ? series : undefined;

  // ── Handlers de eventos ──────────────────────────────────────────────────────

  const addEvento = () => {
    if (eventos.length >= MAX_EVENTOS) return;
    setEventos((prev) => [
      ...prev,
      { valor: 0, data: startDate, tipo: "saida" },
    ]);
  };

  const updateEvento = (idx: number, next: SimEvent) => {
    setEventos((prev) => prev.map((ev, i) => (i === idx ? next : ev)));
  };

  const removeEvento = (idx: number) => {
    setEventos((prev) => prev.filter((_, i) => i !== idx));
  };

  const limpar = () => {
    setRecebExtra(0);
    setGastoExtra(0);
    setEventos([]);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-4 sm:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr]">
      {/* ── Coluna de controles ── */}
      <Card className="h-fit sm:order-2 lg:order-none">
        <CardContent className="space-y-6 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Simular cenário</p>
              <p className="text-xs text-muted-foreground">
                Arraste as médias ou adicione eventos. Nada é salvo.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground"
              disabled={controlsDisabled}
              onClick={limpar}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>

          {baselineLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !hasBaseline ? (
            <p className="text-sm text-muted-foreground">
              Sem dados de caixa para simular. Sincronize Mercado Pago e Tiny ERP
              na aba "Caixa Real".
            </p>
          ) : (
            <>
              {/* Slider: recebimento extra/dia */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Recebimento extra por dia</Label>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      recebExtra > 0
                        ? "text-kpi-positive"
                        : recebExtra < 0
                          ? "text-kpi-negative"
                          : "text-muted-foreground"
                    }`}
                  >
                    {recebExtra > 0 ? "+" : ""}
                    {formatCurrency(recebExtra)}
                  </span>
                </div>
                <Slider
                  value={[recebExtra]}
                  min={RECEB_MIN}
                  max={RECEB_MAX}
                  step={RECEB_STEP}
                  onValueChange={([v]) => setRecebExtra(v)}
                  aria-label="Recebimento extra por dia"
                />
              </div>

              {/* Slider: gasto extra/dia */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Gasto extra por dia</Label>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      gastoExtra > 0 ? "text-kpi-negative" : "text-muted-foreground"
                    }`}
                  >
                    {gastoExtra > 0 ? "+" : ""}
                    {formatCurrency(gastoExtra)}
                  </span>
                </div>
                <Slider
                  value={[gastoExtra]}
                  min={GASTO_MIN}
                  max={GASTO_MAX}
                  step={GASTO_STEP}
                  onValueChange={([v]) => setGastoExtra(v)}
                  aria-label="Gasto extra por dia"
                />
              </div>

              {/* Eventos pontuais (0 a 2) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Eventos pontuais</Label>
                  <span className="text-xs text-muted-foreground">
                    {eventos.length}/{MAX_EVENTOS}
                  </span>
                </div>

                {eventos.map((ev, idx) => (
                  <EventoRow
                    key={idx}
                    evento={ev}
                    minDate={minDate}
                    maxDate={maxDate}
                    disabled={controlsDisabled}
                    onChange={(next) => updateEvento(idx, next)}
                    onRemove={() => removeEvento(idx)}
                  />
                ))}

                {/* "+ Adicionar evento" some ao atingir o máximo (LOCKED) */}
                {eventos.length < MAX_EVENTOS && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 text-xs"
                    disabled={controlsDisabled}
                    onClick={addEvento}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar evento
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Coluna de resultado ── */}
      <div className="space-y-4 sm:order-1 lg:order-none">
        {controlsDisabled ? (
          <>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </>
        ) : (
          <>
            <SimulatorVerdictCard verdict={verdict} />
            <CashFlowChart data={baseline} simulatedSeries={simulatedSeries} />
          </>
        )}
      </div>
    </div>
  );
}
