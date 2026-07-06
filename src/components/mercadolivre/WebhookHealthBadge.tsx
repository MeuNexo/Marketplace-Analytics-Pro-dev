import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWebhookHealth } from "@/hooks/useWebhookHealth";
import { formatWebhookHealth } from "@/lib/webhookHealth";

/**
 * Sinal discreto de saúde do webhook nas telas de atendimento (/perguntas, /devolucoes).
 * Cor nunca é o único sinal — o rótulo textual sempre acompanha (a11y).
 */
export function WebhookHealthBadge() {
  const { lastEventIso, isLoading } = useWebhookHealth();
  if (isLoading) return null;
  const { state, label } = formatWebhookHealth(lastEventIso, Date.now());
  const tone =
    state === "active"
      ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
      : "text-muted-foreground border-border bg-muted/30";
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 font-normal ${tone}`}
      title="Notificações em tempo real do Mercado Livre"
    >
      <Radio className={`w-3 h-3 ${state === "active" ? "animate-pulse" : ""}`} />
      {label}
    </Badge>
  );
}
