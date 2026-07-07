import { Bell, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAtendimentoPendencias, type PendenciaItem } from "@/hooks/useAtendimentoPendencias";
import { useBellSeen } from "@/hooks/useBellSeen";

function tempoRelativo(iso: string | null): string {
  if (!iso) return "";
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "";
  }
}

function PendenciaRow({ item, onNavigate }: { item: PendenciaItem; onNavigate: (href: string) => void }) {
  const isQuestion = item.tipo === "question";
  const Icon = isQuestion ? MessageCircleQuestion : ShieldAlert;
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.href)}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isQuestion ? "text-primary" : "text-amber-600"}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{item.titulo}</p>
        <p className="text-[11px] text-muted-foreground">
          {isQuestion ? "Pergunta" : "Reclamações"} · {tempoRelativo(item.data)}
        </p>
      </div>
    </button>
  );
}

export function AtendimentoBell() {
  const { items, count, isLoading, isReady } = useAtendimentoPendencias();
  const { unreadCount, markAllSeen } = useBellSeen(items, isReady);
  const navigate = useNavigate();

  const ariaLabel =
    unreadCount > 0
      ? `${unreadCount} novas notificações de atendimento`
      : count > 0
        ? `${count} pendências de atendimento`
        : "Atendimento";

  return (
    <Popover onOpenChange={(open) => { if (open) markAllSeen(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-xl hover:bg-secondary/50"
          aria-label={ariaLabel}
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Atendimento pendente</p>
          {count > 0 && <span className="text-xs text-muted-foreground">{count} item(s)</span>}
        </div>

        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Tudo em dia ✅</p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="p-1.5">
              {items.slice(0, 30).map((item) => (
                <PendenciaRow key={item.key} item={item} onNavigate={navigate} />
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
