// ============================================================================
// CicloCaixaCard — Fase 230, Plano 03, Task 3 (CX-02)
//
// Responde "onde meu dinheiro está preso?". A história que os números contam:
// o ciclo está saudável (36,3 dias, dentro da referência de 30 a 60) e o
// colchão é que não existe — R$ 189.277 de estoque contra R$ 14.650 em conta.
// O dinheiro existe; está em mercadoria.
//
// 🔴 O CICLO APARECE DECOMPOSTO, em TRÊS LINHAS — não em três cards. Um número
// único não dispara ação: dos três componentes, só os dias de estoque estão sob
// controle direto da Pé Vermeio (o prazo de recebimento é a agenda do Mercado
// Pago, o prazo de pagamento é o fornecedor). Decomposto, o ciclo aponta a
// compra. Grade densa de KPI foi rejeitada duas vezes em 21/08 — três linhas.
//
// Este componente NÃO calcula. Ele chama `resolveCicloCaixa` e
// `resolveDinheiroPreso` e exibe o resultado já decidido, como `SeloPromo.tsx`
// faz com `resolveSeloPromo`.
// ============================================================================

import { useState } from "react";
import { Boxes, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCashCycle } from "@/hooks/useCashCycle";
import { useProjectedBalance } from "@/hooks/useProjectedBalance";
import {
  resolveCicloCaixa,
  resolveDinheiroPreso,
  type EstadoComponente,
} from "@/lib/cicloCaixa";

const currFmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Dias com uma casa só quando ela diz alguma coisa — "7 dias", não "7,0 dias". */
const diasFmt = (v: number) =>
  Number.isInteger(v)
    ? v.toLocaleString("pt-BR")
    : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Aviso curto ao lado do número, por estado. Estado `medido` não recebe aviso —
 * um selo em tudo não distingue nada. Cor por estado nomeado, nunca por valor.
 */
const AVISO_POR_ESTADO: Record<EstadoComponente, string | null> = {
  medido: null,
  no_limite: "no limite da conta, não medido",
  provisorio: "provisório, amostra pequena",
  nao_medido: "não medido",
};

const CLASSE_POR_ESTADO: Record<EstadoComponente, string> = {
  medido: "text-muted-foreground",
  no_limite: "text-kpi-negative",
  provisorio: "text-kpi-negative",
  nao_medido: "text-muted-foreground",
};

interface CicloCaixaCardProps {
  /** (CASHFIX-06) Propagado ao saldo — nunca um contexto React novo. */
  includePurchaseForecasts?: boolean;
}

export function CicloCaixaCard({ includePurchaseForecasts = false }: CicloCaixaCardProps) {
  const [saibaMaisAberto, setSaibaMaisAberto] = useState(false);
  const { data: insumos, isLoading: carregandoCiclo, error: erroCiclo } = useCashCycle();
  const {
    data: saldo,
    isLoading: carregandoSaldo,
    error: erroSaldo,
  } = useProjectedBalance(90, includePurchaseForecasts);

  if (carregandoCiclo || carregandoSaldo) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (erroCiclo || !insumos) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-destructive">
            Erro ao carregar o ciclo de caixa — os dias de estoque, de recebimento e de prazo do
            fornecedor não puderam ser lidos.
          </p>
        </CardContent>
      </Card>
    );
  }

  const ciclo = resolveCicloCaixa(insumos);
  const caixa = erroSaldo ? null : (saldo?.current_balance ?? null);
  const preso = resolveDinheiroPreso({ valorEstoque: insumos.valorEstoque, caixa });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* ── Cabeçalho: a pergunta, em texto ── */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
            <Boxes className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground leading-tight">
              Onde meu dinheiro está preso?
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Ciclo de conversão de caixa · últimos {insumos.janelaDias ?? "?"} dias
            </p>
          </div>
        </div>

        {/* ── A leitura, em UMA frase ── */}
        <p className="text-sm" title={ciclo.titulo} data-ciclo-estado={ciclo.estado}>
          {ciclo.texto}
        </p>

        {/* ── A decomposição: três LINHAS, uma por componente ── */}
        <div className="rounded-lg border border-border/60 divide-y divide-border/40">
          {ciclo.componentes.map((c) => {
            const aviso = AVISO_POR_ESTADO[c.estado];
            return (
              <div
                key={c.chave}
                data-ciclo-componente={c.chave}
                data-ciclo-estado={c.estado}
                title={c.titulo}
                className="flex items-baseline justify-between gap-3 px-3 py-2"
              >
                <span className="text-xs text-muted-foreground">{c.rotulo}</span>
                <span className="flex items-baseline gap-2 shrink-0">
                  {aviso && (
                    <span className={`text-[11px] ${CLASSE_POR_ESTADO[c.estado]}`}>{aviso}</span>
                  )}
                  <span className="text-sm font-semibold tabular-nums">
                    {c.dias != null ? `${diasFmt(c.dias)} dias` : "—"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {/* ── O par que conta a história: estoque contra caixa ── */}
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">estoque a custo</span>
            <span className="text-sm font-semibold tabular-nums">
              {insumos.valorEstoque != null ? currFmt(insumos.valorEstoque) : "—"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">caixa em conta</span>
            <span className="text-sm font-semibold tabular-nums">
              {caixa != null ? currFmt(caixa) : "—"}
            </span>
          </div>
          <p className="text-xs pt-1" title={preso.titulo}>
            {preso.texto}
          </p>
        </div>

        {/* ── 233-07 (D-14) — a procedência (230-03) é EXPLICAÇÃO: de onde
            vem cada número e até onde ele vale, não proteção de leitura de
            um número à vista. Vai para o "saiba mais" — nenhuma frase foi
            apagada (233-TEXTO.md). ── */}
        <Collapsible open={saibaMaisAberto} onOpenChange={setSaibaMaisAberto}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/40 pt-3 w-full">
            <ChevronDown
              className={`w-3 h-3 transition-transform ${saibaMaisAberto ? "rotate-180" : ""}`}
            />
            Saiba mais
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-1 text-[11px] text-muted-foreground/70 leading-relaxed">
            {ciclo.frasesDeRessalva.map((frase) => (
              <p key={frase}>{frase}</p>
            ))}
            <p>
              O estoque é o físico do Tiny — os três depósitos somados, anunciado ou não —, porque
              o dinheiro foi gasto em toda a mercadoria. Não vem do cache de anúncios do Mercado
              Livre: ele enxerga só o que está anunciado e ativo (1.434 das 2.995 unidades, medido
              em 22/08) e ainda carrega 9 anúncios fechados no ML que seguem ativos ali, com 94
              unidades que não existem.
            </p>
            <p>
              O caixa em conta descende de um ajuste manual de saldo; a idade desse ajuste está
              declarada no bloco de dias de caixa.
            </p>
          </CollapsibleContent>
        </Collapsible>

        {/* 🔴 NÃO é procedência — é a ausência NOMEANDO o motivo real de a
            comparação acima faltar agora (regra da casa, 21/08). Erro de
            leitura fica À VISTA, mesmo padrão de todo outro card da aba. */}
        {erroSaldo && (
          <p className="text-[11px] text-destructive">
            O saldo em conta não pôde ser lido agora — a comparação com o estoque está ausente
            por falha de leitura, não por falta de medição.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
