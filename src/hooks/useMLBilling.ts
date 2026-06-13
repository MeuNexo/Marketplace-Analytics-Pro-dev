import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

export interface MLBillingData {
  /** Frete Full — substitui total_frete de orders quando disponível */
  cffe: number;
  /** Parcelamento sem juros (CFONPN) */
  cfonpn: number;
  charges: Array<{ type: string; label: string; amount: number }>;
  resumo: { cffe: number; cfonpn: number; total_charges?: number; synced_at?: string };
  /** Janela REAL da fatura ML (ciclo da conta, ex.: 06/mai → 05/jun) — YYYY-MM-DD */
  invoiceFrom: string | null;
  invoiceTo: string | null;
  synced_at: string;
}

export interface BillingGroup {
  key: string;
  label: string;
  amount: number;
}

export interface GroupedBillingResult {
  groups: BillingGroup[];
  totalTarifas: number;
}

/**
 * Mapas de types → grupos (conforme plano 41-04).
 * Todos os types não mapeados caem no bucket "Outras tarifas".
 */
const BILLING_GROUP_MAP: Array<{ key: string; label: string; types: Set<string> }> = [
  {
    key: "tarifas_venda",
    label: "Tarifas de venda",
    types: new Set(["CVVML", "CVVPRC", "CVVFNU"]),
  },
  {
    key: "envios_ml",
    label: "Envios Mercado Livre",
    types: new Set(["CFFE", "CXDE", "CFFI", "CXDED"]),
  },
  {
    key: "parcelamento",
    label: "Taxas de parcelamento",
    types: new Set(["CFONPN"]),
  },
  {
    key: "publicidade",
    label: "Campanhas de publicidade",
    types: new Set(["PADS"]),
  },
  {
    key: "tarifas_full",
    label: "Tarifas Full",
    types: new Set(["CFCBE", "CFBA", "CFPB", "CFWA"]),
  },
  {
    key: "difal",
    label: "Impostos cobrados pelo ML (DIFAL)",
    types: new Set(["CDIFAL"]),
  },
  {
    key: "afiliados",
    label: "Afiliados",
    types: new Set(["CVAF"]),
  },
];

const OUTRAS_KEY = "outras";
const OUTRAS_LABEL = "Outras tarifas";
const CANCELAMENTOS_KEY = "cancelamentos";
const CANCELAMENTOS_LABEL = "Cancelamentos de tarifas";

/**
 * Agrupa cobranças de billing em grupos semânticos conforme plano 41-04.
 * Valores somados com sinal (estornos negativos subtraem).
 * Types B* (bonuses — BVVML, BFONPN, BFFE, BXDED...) são cancelamentos/estornos
 * de tarifas, valores NEGATIVOS, agrupados em "Cancelamentos de tarifas" como
 * última linha (igual à fatura ML). NÃO caem no bucket Outras.
 * Demais types não mapeados caem em "Outras tarifas" — nunca dropados.
 * totalTarifas = soma de TODOS os grupos incluindo cancelamentos (líquido,
 * bate com total_amount oficial da fatura).
 */
export function groupBillingCharges(
  charges: Array<{ type: string; label: string; amount: number }>,
): GroupedBillingResult {
  // Acumula por grupo
  const accumulators: Record<string, number> = {};
  for (const g of BILLING_GROUP_MAP) accumulators[g.key] = 0;
  accumulators[OUTRAS_KEY] = 0;
  accumulators[CANCELAMENTOS_KEY] = 0;

  for (const charge of charges) {
    // Types B* = cancelamentos/estornos (bonuses) — capturados ANTES do fallback Outras
    if (charge.type.startsWith("B")) {
      accumulators[CANCELAMENTOS_KEY] += charge.amount;
      continue;
    }
    const group = BILLING_GROUP_MAP.find((g) => g.types.has(charge.type));
    if (group) {
      accumulators[group.key] += charge.amount;
    } else {
      accumulators[OUTRAS_KEY] += charge.amount;
    }
  }

  // Monta lista de grupos — inclui "Outras" sempre que houver valor ou types sem mapa
  const groups: BillingGroup[] = BILLING_GROUP_MAP.map((g) => ({
    key: g.key,
    label: g.label,
    amount: accumulators[g.key],
  }));

  // "Afiliados / Outras tarifas" — exibe combinado se ambos tiverem valor,
  // ou apenas "Outras tarifas" se afiliados for zero
  const afiliadosIdx = groups.findIndex((g) => g.key === "afiliados");
  if (afiliadosIdx !== -1) {
    const afiliadosAmt = groups[afiliadosIdx].amount;
    const outrasAmt = accumulators[OUTRAS_KEY];
    groups[afiliadosIdx] = {
      key: "afiliados_outras",
      label: afiliadosAmt !== 0 ? "Afiliados / Outras tarifas" : OUTRAS_LABEL,
      amount: afiliadosAmt + outrasAmt,
    };
  } else {
    groups.push({ key: OUTRAS_KEY, label: OUTRAS_LABEL, amount: accumulators[OUTRAS_KEY] });
  }

  // Cancelamentos de tarifas — última linha, igual à fatura ML (valores negativos)
  groups.push({
    key: CANCELAMENTOS_KEY,
    label: CANCELAMENTOS_LABEL,
    amount: accumulators[CANCELAMENTOS_KEY],
  });

  const totalTarifas = groups.reduce((sum, g) => sum + g.amount, 0);

  return { groups, totalTarifas };
}

/**
 * Lê ml_billing_monthly para o período YYYY-MM especificado.
 * Retorna null quando não há dados (conta sem Full ou ainda não sincronizado).
 */
export function useMLBilling(periodMonth: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<MLBillingData | null>({
    queryKey: ["ml", "billing", orgId, resolvedMLUserIds, periodMonth],
    queryFn: async (): Promise<MLBillingData | null> => {
      if (!orgId || resolvedMLUserIds.length === 0) return null;

      const { data, error } = await supabase
        .from("ml_billing_monthly")
        .select("*")
        .eq("organization_id", orgId)
        .in("ml_user_id", resolvedMLUserIds)
        .eq("period_month", periodMonth);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Uma row por loja/mês — escopo "todas as lojas" exige merge: charges
      // concatenados, resumos somados, synced_at = mais antigo (pior caso).
      const charges = data.flatMap(
        (row) => (row.charges as Array<{ type: string; label: string; amount: number }>) ?? [],
      );
      const sumResumo = (key: string) =>
        data.reduce((s, row) => s + Number((row.resumo as Record<string, unknown> | null)?.[key] ?? 0), 0);
      const syncedAts = data.map((row) => row.synced_at).filter(Boolean) as string[];

      // Janela da fatura — multi-loja: união das janelas (min from, max to)
      const strResumo = (key: string) =>
        data
          .map((row) => String((row.resumo as Record<string, unknown> | null)?.[key] ?? ""))
          .filter(Boolean)
          .sort();
      const invoiceFroms = strResumo("invoice_from");
      const invoiceTos   = strResumo("invoice_to");

      return {
        cffe:    sumResumo("cffe"),
        cfonpn:  sumResumo("cfonpn"),
        charges,
        invoiceFrom: invoiceFroms[0] ?? null,
        invoiceTo:   invoiceTos[invoiceTos.length - 1] ?? null,
        resumo: {
          cffe:          sumResumo("cffe"),
          cfonpn:        sumResumo("cfonpn"),
          total_charges: sumResumo("total_charges"),
          synced_at:     syncedAts.length > 0 ? syncedAts.sort()[0] : undefined,
        },
        synced_at: syncedAts.length > 0 ? syncedAts.sort()[0] : new Date().toISOString(),
      };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!periodMonth,
    staleTime: 30 * 60 * 1000, // billing data changes at most once per day
  });
}

/**
 * useMLBilling + sync on-demand: quando o mês navegado não tem dados em
 * ml_billing_monthly, invoca a EF sync-ml-billing (user JWT) uma única vez
 * por período e refaz a query. `syncing` permite feedback visual no card.
 * Períodos sem fatura no ML (resposta billing:null) não são re-tentados.
 */
export function useMLBillingWithSync(periodMonth: string) {
  const query = useMLBilling(periodMonth);
  const { resolvedMLUserIds } = useMLStore();
  const [syncing, setSyncing] = useState(false);
  const attemptedMonths = useRef<Set<string>>(new Set());

  const { data, isLoading, refetch } = query;

  useEffect(() => {
    if (isLoading || data || !periodMonth || resolvedMLUserIds.length === 0) return;
    // Key inclui o escopo de lojas — trocar de loja re-habilita o sync do mês
    const attemptKey = `${[...resolvedMLUserIds].sort().join("|")}::${periodMonth}`;
    if (attemptedMonths.current.has(attemptKey)) return;
    attemptedMonths.current.add(attemptKey);

    let cancelled = false;
    setSyncing(true);
    Promise.allSettled(
      resolvedMLUserIds.map((mlUserId) =>
        supabase.functions.invoke("sync-ml-billing", {
          body: { ml_user_id: mlUserId, period_month: periodMonth },
        }),
      ),
    )
      .then((results) => {
        // Falha de invocação (rede/5xx) ≠ "mês sem fatura": libera retry futuro
        const anyFailure = results.some(
          (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error != null),
        );
        if (anyFailure) attemptedMonths.current.delete(attemptKey);
        if (!cancelled) return refetch();
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, data, periodMonth, resolvedMLUserIds, refetch]);

  return { ...query, syncing };
}

// ── DRE mês-calendário exato (ml_billing_daily) ──────────────────────────────

export interface DailyBillingResult {
  /** Tarifas agregadas por tipo no mês-calendário (01–fim), mesmo shape de charges */
  charges: Array<{ type: string; label: string; amount: number }>;
  /** Último dia com dados no mês — limita comparações ao período coberto */
  coverageTo: string | null;
}

const lastDayOfMonth = (periodMonth: string): string => {
  const [y, m] = periodMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate(); // dia 0 do mês seguinte = último dia
  return `${periodMonth}-${String(d).padStart(2, "0")}`;
};

/**
 * Soma ml_billing_daily por tipo no range 01–fim do mês-calendário (competência
 * = data de lançamento). É a fonte exata do DRE: tarifas dos dias 01–31 do mês,
 * sem o viés do ciclo de fechamento da fatura (06→05). Retorna null sem dados.
 */
export function useMLBillingDaily(periodMonth: string) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<DailyBillingResult | null>({
    queryKey: ["ml", "billing-daily", orgId, resolvedMLUserIds, periodMonth],
    queryFn: async (): Promise<DailyBillingResult | null> => {
      if (!orgId || resolvedMLUserIds.length === 0 || !periodMonth) return null;
      const from = `${periodMonth}-01`;
      const to = lastDayOfMonth(periodMonth);

      // Pagina defensivamente (>1000 linhas em multi-loja) — PostgREST trunca em 1000
      type Row = { charge_type: string; charge_label: string; amount: number; charge_date: string };
      const rows: Row[] = [];
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("ml_billing_daily")
          .select("charge_type, charge_label, amount, charge_date")
          .eq("organization_id", orgId)
          .in("ml_user_id", resolvedMLUserIds)
          .gte("charge_date", from)
          .lte("charge_date", to)
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...(data as Row[]));
        if (data.length < PAGE) break;
      }
      if (rows.length === 0) return null;

      const byType = new Map<string, { type: string; label: string; amount: number }>();
      let coverageTo: string | null = null;
      for (const r of rows) {
        const cur = byType.get(r.charge_type);
        if (cur) cur.amount += Number(r.amount);
        else byType.set(r.charge_type, { type: r.charge_type, label: r.charge_label ?? r.charge_type, amount: Number(r.amount) });
        if (!coverageTo || r.charge_date > coverageTo) coverageTo = r.charge_date;
      }
      const charges = [...byType.values()].map((c) => ({ ...c, amount: Math.round(c.amount * 100) / 100 }));
      return { charges, coverageTo };
    },
    enabled: !!orgId && resolvedMLUserIds.length > 0 && !!periodMonth,
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * useMLBillingDaily + sync on-demand (mode:"daily"): quando o mês não tem dados
 * em ml_billing_daily, invoca a EF para sincronizar as duas faturas que tocam o
 * mês-calendário. Uma tentativa por escopo+período; falha libera retry.
 */
export function useMLBillingDailyWithSync(periodMonth: string) {
  const query = useMLBillingDaily(periodMonth);
  const { resolvedMLUserIds } = useMLStore();
  const [syncing, setSyncing] = useState(false);
  const attempted = useRef<Set<string>>(new Set());
  const { data, isLoading, refetch } = query;

  useEffect(() => {
    if (isLoading || data || !periodMonth || resolvedMLUserIds.length === 0) return;
    const key = `${[...resolvedMLUserIds].sort().join("|")}::${periodMonth}`;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);

    let cancelled = false;
    setSyncing(true);
    Promise.allSettled(
      resolvedMLUserIds.map((mlUserId) =>
        supabase.functions.invoke("sync-ml-billing", {
          body: { ml_user_id: mlUserId, period_month: periodMonth, mode: "daily" },
        }),
      ),
    )
      .then((results) => {
        const anyFailure = results.some(
          (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error != null),
        );
        if (anyFailure) attempted.current.delete(key);
        if (!cancelled) return refetch();
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading, data, periodMonth, resolvedMLUserIds, refetch]);

  return { ...query, syncing };
}
