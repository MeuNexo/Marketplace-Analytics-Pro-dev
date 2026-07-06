import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebhookEvents } from "@/hooks/useWebhookEvents";

const STATUS_TONE: Record<string, string> = {
  processed: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  received:  "text-amber-600 bg-amber-500/10 border-amber-500/30",
  error:     "text-red-600 bg-red-500/10 border-red-500/30",
  rejected:  "text-muted-foreground bg-muted/40 border-border",
};

const STATUS_LABEL: Record<string, string> = {
  processed: "Processado",
  received:  "Recebido",
  error:     "Erro",
  rejected:  "Rejeitado",
};

export function WebhookEventsPanel() {
  const { data, isLoading } = useWebhookEvents(50);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="w-4 h-4 text-primary" />
          Webhook ML — últimos eventos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Recebido</TableHead>
                  <TableHead>Tópico</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recurso</TableHead>
                  <TableHead className="text-right">Tent.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(parseISO(e.received_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.topic}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[e.status] ?? ""}>
                        {STATUS_LABEL[e.status] ?? e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs" title={e.error_msg ?? e.resource}>
                      {e.error_msg ? `⚠ ${e.error_msg}` : e.resource}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{e.attempts}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
