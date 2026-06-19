// ============================================================================
// SimulatorVerdictCard — veredito do Simulador de Cenários ("E se...?")
// Card isolado: selo Saudável/Risco + frase de folga/necessidade + menor saldo
// + data crítica. Consome o tipo SimVerdict do módulo puro (plano 50-01).
// Texto LOCKED no CONTEXT.md. Cores SEMPRE via tokens (hsl(var(--token))). SIM-05
// ============================================================================

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatters";
import type { SimVerdict } from "@/lib/cashflowSimulation";

interface SimulatorVerdictCardProps {
  verdict: SimVerdict;
}

/** Formata um fullDate yyyy-MM-dd como dd/MM sem deslocamento de fuso. */
function toDdMM(fullDate: string): string {
  if (!fullDate || fullDate.length < 10) return "";
  const [, mm, dd] = fullDate.substring(0, 10).split("-");
  return dd && mm ? `${dd}/${mm}` : "";
}

export function SimulatorVerdictCard({ verdict }: SimulatorVerdictCardProps) {
  const isSaudavel = verdict.status === "saudavel";
  const dataCritica = toDdMM(verdict.valeDate);

  // Edge §7: sem simulação ativa, o card reflete o cenário projetado atual
  // (baseline) — não esconder. Apenas adiciona um rótulo neutro.
  const semSimulacao = verdict.ativa === false;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Selo de status */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
              isSaudavel
                ? "bg-kpi-positive/15 text-kpi-positive"
                : "bg-kpi-negative/15 text-kpi-negative"
            }`}
          >
            {isSaudavel ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            {isSaudavel ? "Saudável" : "Risco"}
          </span>
          {semSimulacao && (
            <span className="text-xs text-muted-foreground">
              cenário projetado atual
            </span>
          )}
        </div>

        {/* Frase principal */}
        <p className="text-sm text-foreground">
          {isSaudavel ? (
            <>
              Você ainda pode gastar até{" "}
              <span className="font-semibold text-kpi-positive">
                +{formatCurrency(verdict.folgaGastoDia)}/dia
              </span>{" "}
              mantendo o caixa seguro.
            </>
          ) : (
            <>
              Caixa fica abaixo da margem em{" "}
              <span className="font-semibold text-kpi-negative">{dataCritica}</span>.
              Precisa de{" "}
              <span className="font-semibold text-kpi-negative">
                +{formatCurrency(verdict.necessidadeReceitaDia)}/dia
              </span>{" "}
              de recebimento para equilibrar.
            </>
          )}
        </p>

        {/* Menor saldo + data crítica */}
        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Menor saldo:</span>
            <span
              className={`font-semibold tabular-nums ${
                verdict.menorSaldo < 0 ? "text-kpi-negative" : "text-foreground"
              }`}
            >
              {formatCurrency(verdict.menorSaldo)}
            </span>
          </div>
          {dataCritica && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">em</span>
              <span className="font-medium tabular-nums text-foreground">
                {dataCritica}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
