// ============================================================================
// PainelConferencia — Fase 230 Plano 04, Task 1 (CX-04)
//
// Os indicadores de tesouraria continuam existindo — só deixam de ABRIR a
// página. O Wesley rejeitou densidade duas vezes em 21/08: o problema nunca
// foi a existência dos KPIs, foi eles competirem com a decisão. Aqui eles
// viram conferência, a um clique.
//
// 🔴 `TreasuryPanel.tsx` NÃO É ALTERADO por este arquivo — nem uma linha. Os
// 12 KPIs continuam byte a byte como estavam, inclusive o Runway, que é uma
// métrica DIFERENTE de "dias de caixa" (o Runway usa o burn líquido; o card
// de dias de caixa supõe ZERO entrada). Nenhuma das duas foi renomeada em
// cima da outra. O que muda é ONDE elas moram.
//
// 🔴 RECOLHER NÃO PODE VIRAR APAGAR (T-230-12). O gatilho nomeia o que há
// dentro — se o rótulo fosse genérico ("mais detalhes"), o recolhido seria na
// prática uma deleção. Por isso o subtítulo lista as três bandas do painel.
//
// Invólucro fino de propósito: nenhuma lógica, nenhuma consulta, nenhuma
// aritmética. Só o recolhido e o repasse da prop.
// ============================================================================

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TreasuryPanel } from "./TreasuryPanel";

export interface PainelConferenciaProps {
  /** Repassada ao painel sem alteração — nenhum contexto React novo (padrão da casa). */
  includePurchaseForecasts?: boolean;
}

export function PainelConferencia({
  includePurchaseForecasts = false,
}: PainelConferenciaProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <div data-painel-conferencia={aberto ? "aberto" : "recolhido"}>
      <Collapsible open={aberto} onOpenChange={setAberto}>
        {/* Linha discreta, não um card: conferência não disputa atenção com decisão. */}
        <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-lg px-1 py-2 text-left text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDown
            className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
          <span className="block space-y-0.5">
            <span className="block text-sm font-medium">
              Conferência — os indicadores de tesouraria
            </span>
            <span className="block text-xs text-muted-foreground">
              Saúde de caixa, realizado dos últimos 30 dias e exposição por fornecedor.
              Nada foi removido: o que não dispara decisão deixou de abrir a página.
            </span>
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          <TreasuryPanel includePurchaseForecasts={includePurchaseForecasts} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
