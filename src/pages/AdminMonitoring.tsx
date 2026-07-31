import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Database, Users, HardDrive, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface CacheTableStat {
  table_name: string;
  row_count: number;
  total_size: string;
}

interface OrgStat {
  total_orgs: number;
  total_members: number;
}

export default function AdminMonitoring() {
  const { user } = useAuth();
  const [stats, setStats] = useState<CacheTableStat[]>([]);
  const [orgStats, setOrgStats] = useState<OrgStat>({ total_orgs: 0, total_members: 0 });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = async () => {
    setLoading(true);
    try {
      const [cacheRes, orgsRes, membersRes] = await Promise.all([
        supabase.rpc("get_cache_table_stats"),
        supabase.from("organizations" as never).select("id", { count: "exact", head: true }),
        supabase.from("organization_members" as never).select("id", { count: "exact", head: true }),
      ]);

      if (cacheRes.data) {
        setStats(cacheRes.data as CacheTableStat[]);
      }
      setOrgStats({
        total_orgs: (orgsRes as { count: number | null }).count ?? 0,
        total_members: (membersRes as { count: number | null }).count ?? 0,
      });
      setLastRefresh(new Date());
    } catch (e) {
      console.error("AdminMonitoring fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const totalRows = stats.reduce((s, t) => s + t.row_count, 0);

  const formatNumber = (n: number) =>
    new Intl.NumberFormat("pt-BR").format(n);

  const getRowCountBadge = (count: number) => {
    if (count > 100_000) return "destructive" as const;
    if (count > 10_000) return "secondary" as const;
    return "outline" as const;
  };

  return (
    <div className="space-y-6">
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Monitoramento</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Última atualização: {lastRefresh.toLocaleString("pt-BR")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Total de Rows</p>
                <p className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-20" /> : formatNumber(totalRows)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <HardDrive className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Tabelas Cache</p>
                <p className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-12" /> : stats.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Organizações</p>
                <p className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-12" /> : orgStats.total_orgs}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Membros Total</p>
                <p className="text-2xl font-bold">
                  {loading ? <Skeleton className="h-8 w-12" /> : orgStats.total_members}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cache Tables Detail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Estatísticas das Tabelas de Cache
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tabela</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Tamanho</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((t) => (
                  <TableRow key={t.table_name}>
                    <TableCell className="font-mono text-sm">{t.table_name}</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(t.row_count)}</TableCell>
                    <TableCell className="text-right">{t.total_size}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={getRowCountBadge(t.row_count)}>
                        {t.row_count > 100_000 ? "Alto" : t.row_count > 10_000 ? "Médio" : "Normal"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Capacity Planning */}
      <Card>
        <CardHeader>
          <CardTitle>Capacidade Estimada</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="font-semibold">Free Tier</p>
              <p className="text-muted-foreground">500 MB • ~20-30 usuários</p>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min((totalRows / 500_000) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(totalRows)} / 500.000 rows estimado
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="font-semibold">Pro Tier ($25/mês)</p>
              <p className="text-muted-foreground">8 GB • ~200 usuários</p>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min((totalRows / 5_000_000) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(totalRows)} / 5.000.000 rows estimado
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="font-semibold">Pro + Read Replicas</p>
              <p className="text-muted-foreground">Até ~1000 usuários</p>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min((totalRows / 20_000_000) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(totalRows)} / 20.000.000 rows estimado
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
