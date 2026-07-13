// ============================================================================
// CashflowHealthBanner — faixa de saúde dos dados de /fluxo-de-caixa
// Consome useCashflowDataHealth; renderiza null quando nenhuma flag stale é
// true. Uma linha acionável por gatilho ativo (Tiny/MP/âncora).
// Molde de Alert: MLPedidos.tsx:1116-1128
// CASH-95-05 / CASH-95-06
// ============================================================================

import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCashflowDataHealth } from "@/hooks/useCashflowDataHealth";

export function CashflowHealthBanner() {
  const { data, isLoading } = useCashflowDataHealth();

  if (isLoading || !data) return null;

  const { tinyStale, tinyHoursAgo, mpStale, mpHoursAgo, anchorStale, anchorDaysAgo } = data;

  if (!tinyStale && !mpStale && !anchorStale) return null;

  return (
    <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <AlertDescription className="text-xs leading-relaxed space-y-1">
        {tinyStale && (
          <p>
            Contas a pagar sem atualizar há {Math.round(tinyHoursAgo)}h — reconecte o Tiny em{" "}
            <Link to="/integracoes" className="underline hover:no-underline">Integrações</Link>.
          </p>
        )}
        {mpStale && (
          <p>Entradas do Mercado Pago sem atualizar há {Math.round(mpHoursAgo)}h.</p>
        )}
        {anchorStale && (
          <p>
            Você não confirma o saldo real há {Math.round(anchorDaysAgo)} dia(s) — atualize para
            a curva não desviar.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
