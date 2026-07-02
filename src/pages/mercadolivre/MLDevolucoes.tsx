import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  PackageX, AlertCircle, CheckCircle2, Clock, Plug,
  RefreshCw, ShieldAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLClaims, type MLClaimRow } from "@/hooks/useMLClaims";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimStatus = "opened" | "under_review" | "closed_with_refund" | "closed_without_refund" | string;

// ─── Status config (kept from original) ──────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  opened:                { label: "Aberta",              color: "text-red-600",     bg: "bg-red-500/15",     border: "border-red-500/30",     icon: <AlertCircle className="w-3 h-3" />    },
  under_review:          { label: "Em análise",          color: "text-amber-600",   bg: "bg-amber-500/15",   border: "border-amber-500/30",   icon: <Clock className="w-3 h-3" />          },
  closed_with_refund:    { label: "Resolvida c/ reemb.", color: "text-emerald-600", bg: "bg-emerald-500/15", border: "border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" />   },
  closed_without_refund: { label: "Encerrada",           color: "text-gray-500",    bg: "bg-gray-500/15",    border: "border-gray-500/30",    icon: <CheckCircle2 className="w-3 h-3" />   },
};

const STATUS_CONFIG_FALLBACK = {
  label: "Desconhecido", color: "text-gray-500", bg: "bg-gray-500/15",
  border: "border-gray-500/30", icon: <AlertCircle className="w-3 h-3" />,
};

function statusBadge(s: string | null) {
  const cfg = (s && STATUS_CONFIG[s]) ? STATUS_CONFIG[s] : STATUS_CONFIG_FALLBACK;
  return (
    <Badge className={`${cfg.bg} ${cfg.color} ${cfg.border} gap-1 whitespace-nowrap`}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

// Maps ml_claims.tipo column to human-readable label (D-09)
function tipoLabel(tipo: string | null): string {
  if (tipo === "mediations") return "Reclamação";
  if (tipo === "returns") return "Devolução";
  return tipo ?? "—";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NotConnected() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">Conecte sua conta para acessar as devoluções e reclamações.</p>
        <Button asChild><Link to="/integracoes">Conectar conta</Link></Button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MLDevolucoes() {
  const { stores } = useMLStore();
  const { data: claims = [], isLoading, refetch } = useMLClaims();

  const connected = stores.length > 0;

  // ─── D-09 Filters ─────────────────────────────────────────────────────────
  const [tipoFilter, setTipoFilter] = useState<"all" | "mediations" | "returns">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "opened" | "closed">("all");

  const filtered = useMemo(() => claims
    .filter((c) => tipoFilter === "all" || c.tipo === tipoFilter)
    .filter((c) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "opened") return c.status === "opened" || c.status === "under_review";
      if (statusFilter === "closed") return c.status === "closed_with_refund" || c.status === "closed_without_refund";
      return true;
    }),
    [claims, tipoFilter, statusFilter]);

  // ─── Derived KPIs ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const openClaims = claims.filter((c) => c.status === "opened" || c.status === "under_review").length;
    const closedClaims = claims.filter((c) => c.status === "closed_with_refund" || c.status === "closed_without_refund").length;
    const total = claims.length;
    const resolutionRate = total > 0 ? Math.round((closedClaims / total) * 1000) / 10 : 0;
    return { total, open_claims: openClaims, resolved_claims: closedClaims, resolution_rate: resolutionRate };
  }, [claims]);

  if (!connected) return <NotConnected />;

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between flex-wrap gap-2">
        <MLPageHeader title="Devoluções" lastUpdated={null} />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => refetch()}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Reclamações abertas"
          value={String(summary.open_claims)}
          variant="minimal"
          iconClassName={summary.open_claims === 0 ? "bg-success/10 text-success" : summary.open_claims <= 5 ? "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" : "bg-destructive/10 text-destructive"}
          size="compact"
          icon={<AlertCircle className="w-4 h-4" />}
          subtitle={`${summary.total} total na base`}
        />
        <KPICard
          title="Taxa de resolução"
          value={`${summary.resolution_rate.toFixed(1)}%`}
          variant="minimal"
          iconClassName={summary.resolution_rate >= 90 ? "bg-success/10 text-success" : "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"}
          size="compact"
          icon={<CheckCircle2 className="w-4 h-4" />}
          subtitle="Reclamações resolvidas"
        />
        <KPICard
          title="Resolvidas"
          value={String(summary.resolved_claims)}
          variant="minimal"
          iconClassName="bg-success/10 text-success"
          size="compact"
          icon={<PackageX className="w-4 h-4" />}
          subtitle="Com ou sem reembolso"
        />
        <KPICard
          title="Total na base"
          value={String(summary.total)}
          variant="minimal"
          iconClassName="bg-primary/10 text-primary"
          size="compact"
          icon={<ShieldAlert className="w-4 h-4" />}
          subtitle="Reclamações + devoluções"
        />
      </div>

      {/* Claims table with filters (D-09) */}
      <Card>
        <div className="px-4 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium text-foreground">Reclamações e devoluções</span>
          <div className="flex items-center gap-2">
            {/* Tipo filter */}
            <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as typeof tipoFilter)}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="mediations">Reclamações</SelectItem>
                <SelectItem value="returns">Devoluções</SelectItem>
              </SelectContent>
            </Select>
            {/* Status filter */}
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 text-xs w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="opened">Abertas</SelectItem>
                <SelectItem value="closed">Encerradas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-10 h-10 opacity-30 animate-spin" />
              <p className="text-sm">Carregando reclamações...</p>
            </div>
          ) : claims.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Sincronizando reclamações</p>
              <p className="text-xs">Volte em alguns minutos após a primeira sincronização</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <CheckCircle2 className="w-10 h-10 opacity-30" />
              <p className="text-sm">Nenhuma reclamação com esse filtro</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">Data</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Produto</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Tipo</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Motivo</th>
                    <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">Valor</th>
                    <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.slice(0, 50).map((claim) => (
                    <tr key={claim.claim_id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">
                        {claim.data_abertura ? format(parseISO(claim.data_abertura), "dd/MM/yy") : "—"}
                      </td>
                      {/* Item title rendered as plain text — no dangerouslySetInnerHTML (T-42-08) */}
                      <td className="px-3 py-3 max-w-[180px] truncate">{claim.item_title ?? claim.item_id ?? "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                        {tipoLabel(claim.tipo)}
                      </td>
                      <td className="px-3 py-3 max-w-[120px] truncate text-muted-foreground">{claim.motivo ?? claim.descricao ?? "—"}</td>
                      <td className="px-3 py-3 text-right font-mono">
                        {claim.valor != null
                          ? claim.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                          : "—"}
                      </td>
                      <td className="px-6 py-3">{statusBadge(claim.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
