import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HealthStatus, Issue } from "./useMLListingHealth";

interface ListingIssuesProps {
  status: HealthStatus;
  issues: Issue[];
}

/**
 * Subcomponente que renderiza a lista de problemas acionáveis do anúncio.
 *
 * Cobre 6 estados:
 *   idle        → null (não renderiza nada)
 *   loading     → skeletons com aria-label acessível
 *   success + issues > 0 → lista agrupada por categoria com título + ação PT-BR
 *   success + issues = 0 → card "Nenhum problema encontrado"
 *   unavailable → inline "Dados de saúde indisponíveis no momento"
 *   error       → inline "Não foi possível carregar os problemas"
 */
export function ListingIssues({ status, issues }: ListingIssuesProps) {
  // Estado idle: não renderiza nada (não exibir a seção de issues)
  if (status === "idle") return null;

  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Problemas do anúncio
        </p>

        {status === "loading" && (
          <div
            aria-label="Carregando problemas do anúncio"
            className="space-y-2"
          >
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {status === "success" && issues.length === 0 && (
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <p className="text-sm font-medium">Nenhum problema encontrado</p>
          </div>
        )}

        {status === "success" && issues.length > 0 && (
          <IssueList issues={issues} />
        )}

        {status === "unavailable" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">Dados de saúde indisponíveis no momento</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">Não foi possível carregar os problemas</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-componente interno de lista ─────────────────────────────────────────

function IssueList({ issues }: { issues: Issue[] }) {
  // Agrupar por categoria (mantendo a ordem de inserção)
  const grouped = issues.reduce<Map<string, Issue[]>>((map, issue) => {
    const existing = map.get(issue.category) ?? [];
    existing.push(issue);
    map.set(issue.category, existing);
    return map;
  }, new Map());

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            {category}
          </p>
          <div className="space-y-2">
            {items.map((issue) => (
              <div key={issue.id} className="flex flex-col gap-0.5">
                <p className="text-xs font-medium leading-snug">{issue.title}</p>
                <p className="text-[11px] text-muted-foreground">{issue.action_label}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
