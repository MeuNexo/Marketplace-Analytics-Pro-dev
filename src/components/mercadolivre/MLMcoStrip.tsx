import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";
import { cn } from "@/lib/utils";

interface MLMcoStripProps {
  /** MCO em R$ */
  mco: number;
  /** MCO como % da receita; null quando receita = 0 */
  pct: number | null;
  /** "MCO do dia" ou "MCO do período" — decidido pelo pai */
  label: string;
  /** Exibir estado de carregamento (skeleton) */
  loading?: boolean;
  /** Quando true (receita = 0 no período), mostra "—" em vez dos valores */
  empty?: boolean;
}

export function MLMcoStrip({ mco, pct, label, loading = false, empty = false }: MLMcoStripProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  if (loading) {
    return (
      <div className="w-full px-1 py-2">
        <div className="h-6 rounded bg-muted animate-pulse w-72" />
      </div>
    );
  }

  const isEmpty = empty || pct === null;
  const isPositive = mco >= 0;

  const dotClass = isEmpty
    ? "text-muted-foreground"
    : isPositive
    ? "text-kpi-positive"
    : "text-kpi-negative";

  const pctClass = isEmpty
    ? "text-muted-foreground"
    : isPositive
    ? "text-kpi-positive"
    : "text-kpi-negative";

  const formattedBRL = isEmpty
    ? "—"
    : mco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const formattedPct = isEmpty || pct === null ? "—" : `${pct.toFixed(1)}%`;

  const glossaryEntry = KPI_GLOSSARY.mco;

  return (
    <div className="w-full flex items-center gap-2 flex-wrap py-2 px-1 text-sm">
      {/* Marcador colorido por sinal */}
      <span className={cn("font-bold leading-none select-none", dotClass)} aria-hidden="true">
        ●
      </span>

      {/* Rótulo neutro */}
      <span className="font-medium text-foreground">{label}</span>

      <span className="text-muted-foreground" aria-hidden="true">·</span>

      {/* Valor em R$ */}
      <span className="tabular-nums font-semibold text-foreground">{formattedBRL}</span>

      <span className="text-muted-foreground" aria-hidden="true">·</span>

      {/* Percentual colorido por sinal */}
      <span className={cn("tabular-nums font-semibold", pctClass)}>{formattedPct}</span>

      <span className="text-muted-foreground" aria-hidden="true">·</span>

      {/* (i) — Popover de glossário, padrão KPICard (hover + tap) */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Ver definição"
            className="inline-flex w-3.5 h-3.5 items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors focus:outline-none"
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen((v) => !v);
            }}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-auto max-w-[260px] px-3 py-2 text-xs"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <p className="text-foreground">{glossaryEntry.definition}</p>
          {glossaryEntry.example && (
            <p className="mt-1 text-muted-foreground">{glossaryEntry.example}</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
