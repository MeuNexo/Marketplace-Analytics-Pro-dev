import { Clock, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { OrdersFreshness } from "@/hooks/useOrdersFreshness";

interface Props {
  frescor: OrdersFreshness | null | undefined;
  /** Início do período exibido, em YYYY-MM-DD. */
  dateFrom?: string;
  /** Fim do período exibido, em YYYY-MM-DD. */
  dateTo?: string;
}

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function horaCurta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mesmoDia = d.toDateString() === new Date().toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return mesmoDia ? `hoje ${hora}` : `${d.toLocaleDateString("pt-BR")} ${hora}`;
}

/**
 * Diz até que horas o número da tela vale.
 *
 * Dois avisos, com pesos diferentes:
 *
 * 1. PERÍODO INCLUI O DIA DE HOJE — o dia corrente é parcial por natureza até
 *    ele acabar. Não é falha; é o relógio. Mas precisa estar dito, senão o
 *    número parcial passa por total.
 * 2. SYNC ATRASADO — o último sync tem mais de 2h. Aí é falha, e o número pode
 *    estar atrás mesmo em dias fechados.
 */
export function AvisoFrescorPedidos({ frescor, dateFrom, dateTo }: Props) {
  if (!frescor) return null;

  const hoje = hojeISO();
  const periodoIncluiHoje =
    (dateTo ?? "").substring(0, 10) >= hoje && (dateFrom ?? "").substring(0, 10) <= hoje;

  return (
    <div className="space-y-2">
      {frescor.syncAtrasado && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Pedidos podem estar desatualizados.</strong> A última
            sincronização com o Mercado Livre foi {horaCurta(frescor.ultimoSync)}.
            Os valores abaixo podem subir quando ela rodar de novo.
          </AlertDescription>
        </Alert>
      )}

      {periodoIncluiHoje && !frescor.syncAtrasado && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>O período inclui o dia de hoje, que ainda não fechou.</strong>{" "}
            Pedidos sincronizados até {horaCurta(frescor.ultimoSync)} —{" "}
            {frescor.pedidosHoje} pedido(s) de hoje já contabilizados. O número
            vai subir ao longo do dia.
          </AlertDescription>
        </Alert>
      )}

      {!periodoIncluiHoje && !frescor.syncAtrasado && (
        <p className="text-[11px] text-muted-foreground px-1">
          Pedidos sincronizados até {horaCurta(frescor.ultimoSync)} · período fechado
        </p>
      )}
    </div>
  );
}
