import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronDown, Check, X } from "lucide-react";
import { startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { QUICK_RANGES, type DateRange } from "@/hooks/useMLFilters";

interface MLPeriodPickerProps {
  periodLabel: string;
  popoverOpen: boolean;
  setPopoverOpen: (open: boolean) => void;
  pendingRange: DateRange;
  setPendingRange: (r: DateRange) => void;
  pendingPeriod: number | null;
  setPendingPeriod: (p: number | null) => void;
  pendingLabel: string | null;
  canConfirm: boolean;
  customRange: DateRange;
  period: number;
  onConfirm: () => void;
  /**
   * Limite de retrocesso do calendário em dias (ex.: 90 = só permite datas dos
   * últimos 90 dias). Use em páginas cuja fonte de dados tem histórico limitado
   * (ex.: tabela `orders` — backfill de 90 dias). Omitido = sem limite.
   */
  maxDaysBack?: number;
}

export function MLPeriodPicker({
  periodLabel,
  popoverOpen,
  setPopoverOpen,
  pendingRange,
  setPendingRange,
  pendingPeriod,
  setPendingPeriod,
  pendingLabel,
  canConfirm,
  customRange,
  period,
  onConfirm,
  maxDaysBack,
}: MLPeriodPickerProps) {
  const minDate = maxDaysBack ? startOfDay(subDays(new Date(), maxDaysBack)) : null;
  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => {
        setPopoverOpen(open);
        if (open) {
          setPendingRange(customRange);
          setPendingPeriod(customRange ? null : period);
        } else {
          setPendingRange(null);
          setPendingPeriod(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-lg bg-muted/60 px-3 text-xs font-medium text-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer"
        >
          <span className="hidden sm:inline text-muted-foreground">Período:</span>
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="truncate max-w-[120px] sm:max-w-none">{periodLabel}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex gap-1 mb-3">
          {QUICK_RANGES.map((opt) => (
            <Button
              key={opt.value}
              variant={pendingPeriod === opt.value && pendingRange === null ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => {
                setPendingPeriod(opt.value);
                setPendingRange(null);
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={pendingRange ?? undefined}
          onSelect={(range) => {
            if (!range?.from) { setPendingRange(null); return; }
            const from = startOfDay(range.from);
            const to = range.to ? startOfDay(range.to) : from;
            setPendingRange({ from, to });
            setPendingPeriod(null);
          }}
          disabled={(date) => date > new Date() || (minDate !== null && date < minDate)}
          numberOfMonths={2}
          locale={ptBR}
          className="pointer-events-auto"
        />
        {pendingLabel && (
          <p className="text-xs text-center text-muted-foreground mt-2 mb-1">{pendingLabel}</p>
        )}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => { setPendingRange(null); setPendingPeriod(0); }}
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Limpar
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            Confirmar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
