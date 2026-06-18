import { TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type CardVariant = "default" | "success" | "warning" | "danger" | "info" | "neutral" | "purple" | "orange" | "minimal";

interface KPICardProps {
  title: string;
  iconClassName?: string;
  refreshing?: boolean;
  value: string;
  rawValue?: number;
  subtitle?: string;
  subtitleNode?: React.ReactNode;
  delta?: number;
  deltaLabel?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
  variant?: CardVariant;
  animateValue?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
  valueDecimals?: number;
  progressValue?: number;
  tooltip?: string;
  size?: "default" | "compact" | "tv";
}

const variantStyles: Record<CardVariant, { icon: string; trend: string; card: string }> = {
  default: { icon: "bg-accent/10 text-accent", trend: "", card: "" },
  success: { icon: "bg-success/10 text-success", trend: "text-success", card: "bg-success/5 border border-success/5" },
  warning: { icon: "bg-warning/10 text-warning", trend: "text-warning", card: "bg-warning/5 border border-warning/5" },
  danger: { icon: "bg-destructive/10 text-destructive", trend: "text-destructive", card: "bg-destructive/5 border border-destructive/5" },
  info: { icon: "bg-primary/10 text-primary", trend: "text-primary", card: "bg-primary/5 border border-primary/5" },
  neutral: { icon: "bg-muted text-muted-foreground", trend: "", card: "" },
  purple: { icon: "bg-[hsl(270,70%,50%)]/10 text-[hsl(270,70%,50%)]", trend: "", card: "bg-[hsl(270,70%,50%)]/5 border border-[hsl(270,70%,50%)]/5" },
  orange: { icon: "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]", trend: "", card: "bg-[hsl(25,95%,53%)]/5 border border-[hsl(25,95%,53%)]/5" },
  minimal: { icon: "bg-muted text-muted-foreground", trend: "", card: "" },
};

export function KPICard({
  title,
  value,
  rawValue,
  subtitle,
  subtitleNode,
  delta,
  deltaLabel,
  icon,
  loading = false,
  refreshing = false,
  className,
  variant = "default",
  animateValue = true,
  valuePrefix = "",
  valueSuffix = "",
  valueDecimals = 0,
  progressValue,
  tooltip,
  iconClassName,
  size = "default",
}: KPICardProps) {
  const displayValue = value;

  const styles = variantStyles[variant];
  const [tooltipOpen, setTooltipOpen] = useState(false);

  if (loading) {
    return (
      <Card className={cn(className)}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 bg-muted rounded w-24 animate-pulse" />
            <div className="w-10 h-10 bg-muted rounded-xl animate-pulse" />
          </div>
          <div className="h-8 bg-muted rounded w-32 animate-pulse" />
          <div className="h-3 bg-muted rounded w-20 animate-pulse mt-2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(styles.card, refreshing && "animate-pulse opacity-60 transition-opacity duration-300", className)}>
      <CardContent className={cn(size === "compact" ? "p-3" : size === "tv" ? "p-5" : "p-4", "flex gap-4")}>
        <div className="flex-1 min-w-0">
          <span className={cn(
            "font-medium text-muted-foreground inline-flex items-center gap-1",
            variant === "minimal" ? (size === "tv" ? "text-xs uppercase tracking-wider" : "text-[11px] uppercase tracking-wider") : size === "compact" ? "text-xs" : "text-sm"
          )}>
            {title}
            {tooltip && (
              <Popover open={tooltipOpen} onOpenChange={setTooltipOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ver definição"
                    className="inline-flex w-3.5 h-3.5 items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors focus:outline-none"
                    onMouseEnter={() => setTooltipOpen(true)}
                    onMouseLeave={() => setTooltipOpen(false)}
                    onClick={(e) => { e.stopPropagation(); setTooltipOpen(v => !v); }}
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
                  {tooltip}
                </PopoverContent>
              </Popover>
            )}
          </span>
          <p className={cn(
            "leading-tight",
            variant === "minimal"
              ? (size === "tv" ? "text-3xl font-bold" : "text-xl font-bold")
              : size === "compact" ? "text-lg font-bold" : "text-[1.65rem] font-bold"
          )}>{displayValue}</p>
          {subtitleNode ? subtitleNode : subtitle ? (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
          {progressValue !== undefined && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    progressValue >= 100 ? "bg-success" : progressValue >= 80 ? "bg-warning" : "bg-destructive"
                  )}
                  style={{ width: `${Math.min(progressValue, 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground font-medium">{progressValue.toFixed(0)}%</span>
            </div>
          )}
        {(delta !== undefined) && (
          <div className={cn("flex items-center gap-1", size === "tv" ? "mt-2 gap-1.5" : "mt-1.5")}>
            {delta !== undefined && (
              <>
                {delta > 0 ? (
                  <TrendingUp className={cn(size === "tv" ? "w-5 h-5" : "w-3 h-3", "text-success")} />
                ) : delta < 0 ? (
                  <TrendingDown className={cn(size === "tv" ? "w-5 h-5" : "w-3 h-3", "text-destructive")} />
                ) : (
                  <Minus className={cn(size === "tv" ? "w-5 h-5" : "w-3 h-3", "text-muted-foreground")} />
                )}
                <span className={cn(
                  "font-medium",
                  size === "tv" ? "text-base" : "text-xs",
                  delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
                )}>
                  {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                </span>
              </>
            )}
          </div>
        )}
        </div>
        {icon && (
          <div className={cn(
            "rounded-xl flex items-center justify-center shrink-0 self-center",
            size === "compact" ? "w-8 h-8" : size === "tv" ? "w-12 h-12" : "w-10 h-10",
            iconClassName || styles.icon
          )}>
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
