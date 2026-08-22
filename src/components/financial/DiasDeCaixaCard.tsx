// ============================================================================
// DiasDeCaixaCard — Fase 230 Plano 01 (CX-01, CX-06)
//
// "Quanto tempo aguento sem vender?" — a pergunta que o Wesley fez em 21/08
// e que a tela não respondia. Não é o Runway (mês) que TreasuryPanel já
// mostra: Runway usa o burn LÍQUIDO (já descontando o que entra); este card
// supõe ZERO entrada. As duas metricas coexistem, com nomes que as
// distinguem — nenhuma foi renomeada em cima da outra.
//
// 🔴 UM NÚMERO, NADA ALÉM DISTO. A fase inteira existe porque o Wesley
// rejeitou densidade duas vezes em 21/08 (ver 230-PATTERNS.md, §1). Este
// card não calcula nada: chama resolveDiasDeCaixa/resolveConfiabilidadeSaldo
// e exibe o resultado já decidido — mesma separação de seloPromo.ts/
// SeloPromo.tsx.
//
// 🔴 FAIXA_REFERENCIA_VAREJO NUNCA VIRA COR. Ela é literatura citada no
// rodapé, não limiar de alerta — a leitura de gravidade é do Wesley (D-6 da
// Fase 224).
// ============================================================================

import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";
import { useTreasuryPanel } from "@/hooks/useTreasuryPanel";
import { useFinancialSettings } from "@/hooks/useFinancialSettings";
import {
  FAIXA_REFERENCIA_VAREJO,
  resolveDiasDeCaixa,
} from "@/lib/diasDeCaixa";
import { resolveConfiabilidadeSaldo } from "@/lib/saldoConfiabilidade";

const currFmt = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A frase de leitura, derivada do próprio resultado da régua — nunca redigitada aqui. */
function fraseDeLeitura(dias: number): string {
  if (dias <= 3) {
    return (
      `Com ${dias.toFixed(1)} dias, qualquer interrupção de recebimento (feriado ` +
      `prolongado, bloqueio de conta, incidente no Mercado Livre) consome o caixa inteiro.`
    );
  }
  return (
    `Se nenhuma venda entrar a partir de hoje, o caixa atual sustenta ` +
    `${dias.toFixed(1)} dias de saída.`
  );
}

export interface DiasDeCaixaCardProps {
  /** Propagado às fontes de saldo/burn — nunca cria contexto novo (padrão da casa). */
  includePurchaseForecasts?: boolean;
}

export function DiasDeCaixaCard({ includePurchaseForecasts = false }: DiasDeCaixaCardProps) {
  const { data: saldo, isLoading: loadingSaldo, error: errorSaldo } =
    useProjectedBalance(90, includePurchaseForecasts);
  const { data: tesouraria, isLoading: loadingTesouraria, error: errorTesouraria } =
    useTreasuryPanel(includePurchaseForecasts);
  const { data: settings, isLoading: loadingSettings } = useFinancialSettings();

  const isLoading = loadingSaldo || loadingTesouraria || loadingSettings;
  const error = errorSaldo || errorTesouraria;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Skeleton className="w-8 h-8 rounded-xl shrink-0" />
            <Skeleton className="h-5 w-56" />
          </div>
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-destructive">
            Erro ao carregar os dias de caixa — o saldo ou a saída diária não puderam ser lidos.
          </p>
        </CardContent>
      </Card>
    );
  }

  const resultado = resolveDiasDeCaixa({
    saldo: saldo?.current_balance ?? null,
    burnMensal: tesouraria?.burn_rate ?? null,
  });

  const confiabilidade = resolveConfiabilidadeSaldo({
    updatedAt: settings?.updated_at ?? null,
    createdAt: settings?.created_at ?? null,
    agora: new Date(),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* ── Cabeçalho ── */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Quanto tempo aguento sem vender?
            </p>
            <p className="text-[11px] text-muted-foreground/60">sem nenhuma entrada de caixa</p>
          </div>
        </div>

        {/* ── O número ── */}
        <div className="flex items-baseline gap-3 flex-wrap" title={resultado.titulo}>
          <span className="text-3xl font-semibold tabular-nums">{resultado.texto}</span>
          {resultado.estado === "medido" && resultado.saidaDiaria != null && resultado.saldo != null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {currFmt(resultado.saldo)} ÷ {currFmt(resultado.saidaDiaria)}/dia
            </span>
          )}
        </div>

        {/* ── Frase de leitura ── */}
        {resultado.estado === "medido" && resultado.dias != null ? (
          <p className="text-sm text-muted-foreground">{fraseDeLeitura(resultado.dias)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{resultado.titulo}</p>
        )}

        {/* ── Selo de idade do saldo (CX-06) ── */}
        {confiabilidade.exibir && (
          <p
            data-idade-saldo={confiabilidade.estado}
            title={confiabilidade.titulo}
            className="text-[11px] font-medium text-kpi-negative"
          >
            {confiabilidade.texto}
          </p>
        )}

        {/* ── Rodapé de procedência ── */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed border-t border-border/40 pt-3">
          O divisor é a média das saídas efetivamente pagas dos últimos 90 dias, e o cálculo
          supõe zero entrada no período. Referência de literatura para varejo com estoque:{" "}
          {FAIXA_REFERENCIA_VAREJO.minimo} a {FAIXA_REFERENCIA_VAREJO.maximo} dias — citação, não
          meta nem limiar de alerta.{" "}
          <span className="block mt-1">
            Este número <strong>não é o Runway</strong>: o Runway (meses) usa o burn líquido, já
            descontando o que entra, e continua existindo no painel de conferência.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
