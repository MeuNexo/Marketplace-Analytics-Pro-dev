import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  PackageX, AlertCircle, CheckCircle2, Plug,
  RefreshCw, ShieldAlert, ChevronRight, MessageSquare, Clock,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { ClaimDetailSheet } from "@/components/mercadolivre/ClaimDetailSheet";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLClaims, type MLClaimRow } from "@/hooks/useMLClaims";
import {
  claimStatusConfig, claimTipoLabel,
  claimBucket, pendingActionLabel, dueDateLabel, type ClaimBucket,
} from "@/lib/claimStatus";

function statusBadge(s: string | null) {
  const cfg = claimStatusConfig(s);
  return <Badge variant="outline" className={`${cfg.tone} whitespace-nowrap`}>{cfg.label}</Badge>;
}

function pendencyBadge(claim: MLClaimRow) {
  const label = pendingActionLabel(claim.pending_action_type);
  const due = dueDateLabel(claim.action_due_date);
  const dueTone = due === "atrasada"
    ? "text-destructive"
    : due === "vence hoje"
      ? "text-[hsl(25,95%,53%)]"
      : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <Badge variant="outline" className="text-red-600 bg-red-500/15 border-red-500/30 whitespace-nowrap w-fit">
          {label}
        </Badge>
      ) : statusBadge(claim.status)}
      {due ? (
        <span className={`inline-flex items-center gap-1 text-xs ${dueTone}`}>
          <Clock className="w-3 h-3" />
          {due}
        </span>
      ) : null}
    </div>
  );
}

const BUCKET_META: Record<ClaimBucket, { label: string; emoji: string }> = {
  pende: { label: "Pende você", emoji: "🔴" },
  aguardando: { label: "Aguardando", emoji: "🟡" },
  resolvida: { label: "Resolvida", emoji: "✅" },
};

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
  const [activeBucket, setActiveBucket] = useState<ClaimBucket>("pende");
  const [selectedClaim, setSelectedClaim] = useState<MLClaimRow | null>(null);

  // Contadores por bucket — independentes do filtro de Tipo, para bater com o
  // sininho da navbar (mesmo critério: seller_action_required) e com a aba.
  const summary = useMemo(() => {
    const counts: Record<ClaimBucket, number> = { pende: 0, aguardando: 0, resolvida: 0 };
    for (const c of claims) counts[claimBucket(c)]++;
    const total = claims.length;
    const rate = total > 0 ? Math.round((counts.resolvida / total) * 1000) / 10 : 0;
    return { total, rate, ...counts };
  }, [claims]);

  const filtered = useMemo(() => {
    const rows = claims
      .filter((c) => tipoFilter === "all" || c.tipo === tipoFilter)
      .filter((c) => claimBucket(c) === activeBucket);

    if (activeBucket !== "pende") return rows;

    // Prazo mais curto primeiro; sem prazo vai por último.
    return [...rows].sort((a, b) => {
      if (!a.action_due_date && !b.action_due_date) return 0;
      if (!a.action_due_date) return 1;
      if (!b.action_due_date) return -1;
      return new Date(a.action_due_date).getTime() - new Date(b.action_due_date).getTime();
    });
  }, [claims, tipoFilter, activeBucket]);

  if (!connected) return <NotConnected />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MLPageHeader title="Devoluções" lastUpdated={null} />
        <Button variant="outline" size="sm" disabled={isLoading} onClick={() => refetch()}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pendem você" value={String(summary.pende)} variant="minimal" size="compact"
          iconClassName={summary.pende === 0 ? "bg-success/10 text-success" : summary.pende <= 5 ? "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" : "bg-destructive/10 text-destructive"}
          icon={<AlertCircle className="w-4 h-4" />} subtitle="Pedem sua ação"
        />
        <KPICard
          title="Taxa de resolução" value={`${summary.rate.toFixed(1)}%`} variant="minimal" size="compact"
          iconClassName={summary.rate >= 90 ? "bg-success/10 text-success" : "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"}
          icon={<CheckCircle2 className="w-4 h-4" />} subtitle="Já resolvidas"
        />
        <KPICard
          title="Resolvidas" value={String(summary.resolvida)} variant="minimal" size="compact"
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
          <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as typeof tipoFilter)}>
            <SelectTrigger className="h-8 text-xs w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="mediations">Reclamações</SelectItem>
              <SelectItem value="returns">Devoluções</SelectItem>
            </SelectContent>
          </Select>
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
          ) : (
            <Tabs value={activeBucket} onValueChange={(v) => setActiveBucket(v as ClaimBucket)}>
              <div className="px-6 pt-2 pb-0 border-b border-border">
                <TabsList className="h-9 bg-transparent p-0 gap-4">
                  <TabsTrigger
                    value="pende"
                    className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                  >
                    {BUCKET_META.pende.emoji} {BUCKET_META.pende.label} ({summary.pende})
                  </TabsTrigger>
                  <TabsTrigger
                    value="aguardando"
                    className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                  >
                    {BUCKET_META.aguardando.emoji} {BUCKET_META.aguardando.label} ({summary.aguardando})
                  </TabsTrigger>
                  <TabsTrigger
                    value="resolvida"
                    className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                  >
                    {BUCKET_META.resolvida.emoji} {BUCKET_META.resolvida.label} ({summary.resolvida})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value={activeBucket} className="mt-0">
                {filtered.length === 0 ? (
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
                          <th className="text-left px-6 py-3 text-xs text-muted-foreground font-medium">
                            {activeBucket === "pende" ? "Pendência" : "Status"}
                          </th>
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
                            <td className="px-3 py-3 max-w-[180px] truncate text-muted-foreground" title={claim.motivo_texto ?? undefined}>{claim.motivo_texto ?? claim.descricao ?? "—"}</td>
                            <td className="px-6 py-3">
                              {activeBucket === "pende" ? pendencyBadge(claim) : statusBadge(claim.status)}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                                {activeBucket === "pende" ? <MessageSquare className="w-3.5 h-3.5" /> : null}
                                <span className="hidden sm:inline">{activeBucket === "pende" ? "Responder" : "Ver"}</span>
                                <ChevronRight className="w-4 h-4" />
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      <ClaimDetailSheet claim={selectedClaim} onOpenChange={(o) => { if (!o) setSelectedClaim(null); }} />
    </div>
  );
}
