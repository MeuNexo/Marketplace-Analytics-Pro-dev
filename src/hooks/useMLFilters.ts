import { useState, useMemo, useEffect, useCallback } from "react";
import { format, startOfDay, differenceInCalendarDays, parseISO, subDays } from "date-fns";

export type DateRange = { from: Date; to?: Date } | null;
export type ChartMode = "daily" | "hourly";

export const QUICK_RANGES = [
  { label: "Hoje", value: 0 },
  { label: "7 dias", value: 7 },
  { label: "15 dias", value: 15 },
  { label: "30 dias", value: 30 },
] as const;

export function todayUTC() {
  return format(new Date(), "yyyy-MM-dd");
}

export function cutoffDateStr(daysBack: number) {
  if (daysBack === 0) return todayUTC();
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return format(d, "yyyy-MM-dd");
}

export function getFilterDates(customRange: DateRange, period: number): { fromDate: string; toDate: string } {
  if (customRange?.from) {
    const fromDate = format(startOfDay(customRange.from), "yyyy-MM-dd");
    const toDate = customRange.to ? format(startOfDay(customRange.to), "yyyy-MM-dd") : fromDate;
    return { fromDate, toDate };
  }
  return { fromDate: cutoffDateStr(period), toDate: todayUTC() };
}

export function getComparisonRanges(customRange: DateRange, period: number) {
  if (customRange?.from) {
    const from = format(startOfDay(customRange.from), "yyyy-MM-dd");
    const to = format(startOfDay(customRange.to ?? customRange.from), "yyyy-MM-dd");
    const diffMs = startOfDay(customRange.to ?? customRange.from).getTime() - startOfDay(customRange.from).getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
    const pTo = new Date(startOfDay(customRange.from));
    pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo);
    pFrom.setDate(pFrom.getDate() - diffDays + 1);
    return {
      currentFrom: from,
      currentTo: to,
      prevFrom: format(pFrom, "yyyy-MM-dd"),
      prevTo: format(pTo, "yyyy-MM-dd"),
      fetchFrom: format(pFrom, "yyyy-MM-dd"),
      fetchTo: to,
    };
  }

  const today = todayUTC();
  if (period === 0) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = format(yesterday, "yyyy-MM-dd");
    return {
      currentFrom: today,
      currentTo: today,
      prevFrom: yesterdayStr,
      prevTo: yesterdayStr,
      fetchFrom: yesterdayStr,
      fetchTo: today,
    };
  }

  const currentFrom = cutoffDateStr(period);
  const prevCutoffTo = new Date();
  prevCutoffTo.setDate(prevCutoffTo.getDate() - period - 1);
  const prevCutoffFrom = new Date();
  prevCutoffFrom.setDate(prevCutoffFrom.getDate() - period * 2 - 1);
  const prevFrom = format(prevCutoffFrom, "yyyy-MM-dd");
  const prevTo = format(prevCutoffTo, "yyyy-MM-dd");

  return {
    currentFrom,
    currentTo: today,
    prevFrom,
    prevTo,
    fetchFrom: prevFrom,
    fetchTo: today,
  };
}

export function useMLFilters(initialPeriod = 0) {
  const [period, setPeriod] = useState(initialPeriod);
  const [customRange, setCustomRange] = useState<DateRange>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("hourly");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRange>(null);
  const [pendingPeriod, setPendingPeriod] = useState<number | null>(null);

  const singleDayRange =
    customRange?.from && customRange?.to
      ? format(startOfDay(customRange.from), "yyyy-MM-dd") === format(startOfDay(customRange.to), "yyyy-MM-dd")
        ? format(startOfDay(customRange.from), "yyyy-MM-dd")
        : null
      : null;

  const isHourlyAvailable = (period === 0 && !customRange) || !!singleDayRange;
  const hourlyTargetDate = singleDayRange ?? (period === 0 ? todayUTC() : null);

  const activeFilterKey = customRange?.from
    ? `${format(startOfDay(customRange.from), "yyyy-MM-dd")}:${format(startOfDay(customRange.to ?? customRange.from), "yyyy-MM-dd")}`
    : `period:${period}`;

  useEffect(() => {
    setChartMode(isHourlyAvailable ? "hourly" : "daily");
  }, [activeFilterKey, isHourlyAvailable]);

  const { currentFrom, currentTo, prevFrom, prevTo, fetchFrom, fetchTo } = useMemo(
    () => getComparisonRanges(customRange, period),
    [customRange, period],
  );

  const adsChartFrom = useMemo(() => {
    const diffDays = differenceInCalendarDays(parseISO(currentTo), parseISO(currentFrom));
    if (diffDays < 6) return format(subDays(parseISO(currentTo), 6), "yyyy-MM-dd");
    return currentFrom;
  }, [currentFrom, currentTo]);

  const periodLabel = customRange?.from
    ? customRange.to && format(startOfDay(customRange.from), "yyyy-MM-dd") !== format(startOfDay(customRange.to), "yyyy-MM-dd")
      ? `${format(customRange.from, "dd/MM")} – ${format(customRange.to, "dd/MM")}`
      : format(customRange.from, "dd/MM")
    : period === 0
      ? `Hoje — ${format(new Date(), "dd/MM")}`
      : (() => {
          const to = new Date();
          const from = new Date();
          from.setDate(to.getDate() - period);
          return `${period}d — ${format(from, "dd/MM")} a ${format(to, "dd/MM")}`;
        })();

  const pendingLabel = (() => {
    if (pendingRange?.from) {
      const from = format(pendingRange.from, "dd/MM/yyyy");
      const to = pendingRange.to ? format(pendingRange.to, "dd/MM/yyyy") : from;
      return from === to ? `${from} (1 dia)` : `${from} – ${to}`;
    }
    if (pendingPeriod !== null) return pendingPeriod === 0 ? "Hoje" : `Últimos ${pendingPeriod} dias`;
    return null;
  })();

  const canConfirm = pendingRange !== null || pendingPeriod !== null;
  const deltaLabel = period === 0 ? "vs ontem" : customRange ? "vs período anterior" : `vs ${period}d anteriores`;

  return {
    period, setPeriod,
    customRange, setCustomRange,
    chartMode, setChartMode,
    popoverOpen, setPopoverOpen,
    pendingRange, setPendingRange,
    pendingPeriod, setPendingPeriod,
    singleDayRange,
    isHourlyAvailable,
    hourlyTargetDate,
    activeFilterKey,
    currentFrom, currentTo, prevFrom, prevTo, fetchFrom, fetchTo,
    adsChartFrom,
    periodLabel, pendingLabel, canConfirm, deltaLabel,
  };
}
