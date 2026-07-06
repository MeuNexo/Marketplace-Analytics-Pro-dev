import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  PackageX, AlertCircle, CheckCircle2, Plug,
  RefreshCw, ShieldAlert, ChevronRight, MessageSquare,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { WebhookHealthBadge } from "@/components/mercadolivre/WebhookHealthBadge";
import { ClaimDetailSheet } from "@/components/mercadolivre/ClaimDetailSheet";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLClaims, type MLClaimRow } from "@/hooks/useMLClaims";
import { claimStatusConfig, claimTipoLabel, isClaimOpen } from "@/lib/claimStatus";

function statusBadge(s: string | null) {
  const cfg = claimStatusConfig(s);
  return <Badge variant="outline" className={`${cfg.tone} whitespace-nowrap`}>{cfg.label}</Badge>;
}

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

export default function MLDevolucoes() {
  const { stores } = useMLStore();
  const { data: claims = [], isLoading, refetch } = useMLClaims();
  const connected = stores.length > 0;

  const [tipoFilter, setTipoFilter] = useState<"all" | "mediations" | "returns">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "opened" | "closed">("all");
  const [selectedClaim, setSelectedClaim] = useState<MLClaimRow | null>(null);

  const filtered = useMemo(() => claims
    .filter((c) => tipoFilter === "all" || c.tipo === tipoFilter)
    .filter((c) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "opened") return isClaimOpen(c.status);
      if (statusFilter === "closed") return !!c.status && !isClaimOpen(c.status);
      return true;
    }),
    [claims, tipoFilter, statusFilter]);

  const summary = useMemo(() => {
    const open = claims.filter((c) => isClaimOpen(c.status)).length;
    const closed = claims.filter((c) => !!c.status && !isClaimOpen(c.status)).length;
    const total = claims.length;
    const rate = total > 0 ? Math.round((closed / total) * 1000) / 10 : 0;
    return { total, open, closed, rate };
  }, [claims]);

  if (!connected) return <NotConnected />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MLPageHeader title="Devoluções" lastUpdated={null}>
          <WebhookHealthBadge />
        </MLPageHeader>
        <Button variant="outline" size="sm" disabled={isLoading} onClick={() => refetch()}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Abertas" value={String(summary.open)} variant="minimal" size="compact"
          iconClassName={summary.open === 0 ? "bg-success/10 text-success" : summary.open <= 5 ? "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" : "bg-destructive/10 text-destructive"}
          icon={<AlertCircle className="w-4 h-4" />} subtitle="Pedem sua ação"
        />
        <KPICard
          title="Taxa de resolução" value={`${summary.rate.toFixed(1)}%`} variant="minimal" size="compact"
          iconClassName={summary.rate >= 90 ? "bg-success/10 text-success" : "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"}
          icon={<CheckCircle2 className="w-4 h-4" />} subtitle="Já resolvidas"
        />
        <KPICard
          title="Resolvidas" value={String(summary.closed)} variant="minimal" size="compact"
          iconClassName="bg-success/10 text-success" icon={<PackageX className="w-4 h-4" />} subtitle="Encerradas"
        />
        <KPICard
          title="Total na base" value={String(summary.total)} variant="minimal" size="compact"
          iconClassName="bg-primary/10 text-primary" icon={<ShieldAlert className="w-4 h-4" />} subtitle="Reclamações + devoluções"
        />
      </div>

      {/* Lista */}
      <Card>
        <div className="px-4 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium text-foreground">Reclamações e devoluções</span>
          <div className="flex items-center gap-2">
            <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as typeof tipoFilter)}>
              <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="mediations">Reclamações</SelectItem>
                <SelectItem value="returns">Devoluções</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 text-xs w-32"><SelectValue placeholder="Status" /></SelectTrigger>
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
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">Data</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Produto</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Tipo</th>
                    <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Motivo</th>
                    <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.slice(0, 50).map((claim) => (
                    <tr
                      key={claim.claim_id}
                      onClick={() => setSelectedClaim(claim)}
                      className="hover:bg-muted/40 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">
                        {claim.data_abertura ? format(parseISO(claim.data_abertura), "dd/MM/yy") : "—"}
                      </td>
                      <td className="px-3 py-3 max-w-[200px] truncate">{claim.item_title ?? claim.item_id ?? "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{claimTipoLabel(claim.tipo)}</td>
                      <td className="px-3 py-3 max-w-[140px] truncate text-muted-foreground">{claim.motivo ?? claim.descricao ?? "—"}</td>
                      <td className="px-6 py-3">{statusBadge(claim.status)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                          {isClaimOpen(claim.status) ? <MessageSquare className="w-3.5 h-3.5" /> : null}
                          <span className="hidden sm:inline">{isClaimOpen(claim.status) ? "Responder" : "Ver"}</span>
                          <ChevronRight className="w-4 h-4" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ClaimDetailSheet claim={selectedClaim} onOpenChange={(o) => { if (!o) setSelectedClaim(null); }} />
    </div>
  );
}
