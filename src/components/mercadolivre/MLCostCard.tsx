import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ChevronLeft, ChevronRight, HelpCircle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BillingGroup } from "@/hooks/useMLBilling";
import type { DreCascadeBlocoLine, DreFinanceiroLine } from "@/lib/dreCascade";
import type { CmvCheioGap } from "@/lib/dreCloseGate";
import type { NaoClassificadoItem } from "@/hooks/useNaoClassificadoItems";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Formato com centavos — usado nas listas (Popover) do C6/C8, onde o valor
// exato é o que o Wesley precisa conferir contra o Tiny (fmt() acima arredonda
// para inteiro, o que basta para os totais do card mas não para auditoria linha a linha).
const fmtCents = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const pct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : "—";

// "2026-05-06" → "06/05" (sem timezone — corte direto da string ISO)
const fmtDayMonth = (iso: string) => {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
};

// ── [C6] Lista dos SKUs sem custo cheio — Popover tap-friendly (Phase 46:
// Radix Tooltip não dispara no touch; padrão hover+tap clonado de MLMcoStrip). ──
function CmvGapsTrigger({ gaps }: { gaps: CmvCheioGap[] }) {
  const [open, setOpen] = useState(false);
  const totalReceita = gaps.reduce((s, g) => s + g.receita, 0);
  const top = [...gaps].sort((a, b) => b.receita - a.receita).slice(0, 10);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 transition-colors inline-flex items-center gap-1"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <AlertTriangle className="w-3 h-3" />
          {gaps.length} SKUs sem custo cheio
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-[320px] max-h-[360px] overflow-y-auto p-3 text-xs"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="font-medium text-foreground mb-1">
          {fmtCents(totalReceita)} em receita sem custo cheio confirmado
        </p>
        <p className="text-muted-foreground mb-2">
          O gate de apuração bloqueia até esses SKUs terem o custo cheio no Tiny.
        </p>
        <div className="space-y-1.5">
          {top.map((g) => (
            <div
              key={g.sku}
              className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{g.sku}</p>
                <p className="text-muted-foreground">
                  {g.marca ?? "—"} · {g.unidades}un ·{" "}
                  {g.temCustoMedio ? "falta o custo cheio" : "sem custo nenhum — cadastrar no Tiny"}
                </p>
              </div>
              <span className="tabular-nums font-semibold text-foreground shrink-0">
                {fmtCents(g.receita)}
              </span>
            </div>
          ))}
        </div>
        {gaps.length > top.length && (
          <p className="text-muted-foreground mt-2">+{gaps.length - top.length} outros SKUs</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── [C8] Lista dos lançamentos "Não classificado" — Popover tap-friendly,
// mesmo padrão. Sistema SÓ informa: nunca move/corrige lançamento. ──
function NaoClassificadoTrigger({ items, total }: { items: NaoClassificadoItem[]; total: number }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver lançamentos não classificados"
          className="cursor-default inline-flex text-amber-500 hover:text-amber-400 transition-colors"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <AlertTriangle className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[320px] max-h-[360px] overflow-y-auto p-3 text-xs"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="font-medium text-foreground mb-1">{fmtCents(total)} para recategorizar no Tiny</p>
        <p className="text-muted-foreground mb-2">
          O sistema só informa — Wesley recategoriza cada lançamento no Tiny; nada é corrigido
          sozinho.
        </p>
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div
              key={`${it.outflowDate}-${i}`}
              className="flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{it.supplier ?? it.category}</p>
                <p className="text-muted-foreground truncate">
                  {it.description} · {fmtDayMonth(it.outflowDate)}
                </p>
              </div>
              <span className="tabular-nums font-semibold text-foreground shrink-0">
                {fmtCents(it.amount)}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Tipos ──────────────────────────────────────────────────────────────────

interface MLCostCardProps {
  /** Label do mês em pt-BR, ex.: "Junho/2026" */
  mesLabel: string;
  /** Receita LÍQUIDA do mês (pedidos pagos) — base de TODOS os pct() do card, nunca a bruta (SC5). */
  receitaMes: number;
  /** [C1] Receita BRUTA do mês (paid_revenue + cancelledRevenue) — novo destaque do topo. */
  receitaBruta: number;
  /** [C1] (−) Cancelamentos de vendas (cancelled + partially_refunded). 0/ausente = mês sem cancelamento. */
  cancelamentosVendas?: number;
  /** Margem de contribuição já calculada pelo caller via computeMargemContribuicao (fonte única — dreMargem.ts). */
  margemContribuicao: number;
  /** Grupos de tarifas ML agrupados por groupBillingCharges().groups */
  gruposTarifas: BillingGroup[];
  /** Soma total dos grupos de tarifas (já excluindo grupos `excluded`, ex.: parcelamento) */
  totalTarifas: number;
  /** CMV do mês — null = sem custo cadastrado */
  cmvMes: number | null;
  /** Impostos próprios do mês (regime fiscal) — null = sem config fiscal */
  impostosMes: number | null;
  /** "competencia" = ml_billing_daily mês-calendário 01–31 | "billing" = fatura mensal (ciclo 06→05) | "estimado" = fallback de orders */
  fonte: "competencia" | "billing" | "estimado";
  loading?: boolean;
  /** Navega para o mês anterior */
  onPrevMonth?: () => void;
  /** Navega para o mês seguinte (desabilitado além do mês corrente) */
  onNextMonth?: () => void;
  /** false quando o mês exibido é o mês corrente (não navega para frente) */
  canGoNext?: boolean;
  /** true enquanto sync on-demand do billing do mês está em andamento */
  syncing?: boolean;
  /** Janela real da fatura ML (ciclo da conta) — YYYY-MM-DD, exibida quando fonte=billing */
  faturaFrom?: string | null;
  faturaTo?: string | null;
  // ── Cascata do resultado (Phase 88, da RPC 87 via buildDreCascade) ──
  /** Linhas operacionais agregadas por bloco (Pessoal/Estrutura/Serviços/Operacional/Não classificado). */
  blocosOperacionais?: DreCascadeBlocoLine[];
  /** Margem de contribuição − deduções operacionais. */
  resultadoOperacional?: number;
  /** Linha financeira agregada (Empréstimo) ou null se ausente. */
  financeiro?: DreFinanceiroLine | null;
  /** Resultado operacional − financeiro. */
  resultadoLiquido?: number;
  // ── Regime PREVISÃO/APURAÇÃO (Phase 94) ──
  /** "previsao" (mês aberto) | "apuracao" (mês fechado pelo owner). */
  regime?: "previsao" | "apuracao";
  /** Presença de linha em dre_month_close para o mês exibido. */
  mesClosed?: boolean;
  /** "MM/YYYY" da guia real usada (M+1 do mês de venda exibido). */
  guiaCompetenceLabel?: string;
  /** true apenas para orgRole==="owner" — RLS é a autoridade real. */
  canClose?: boolean;
  /** Empurrãozinho: dica visual de que as 3 guias parecem lançadas — NUNCA fecha sozinho. */
  nudgeClose?: boolean;
  /** Marca o mês como apurado (owner-only). */
  onClose?: () => void;
  /** Reabre o mês (volta para previsão). */
  onReopen?: () => void;
  /** true durante a mutação de fechar/reabrir. */
  closeBusy?: boolean;
  // ── [C6/C7] Gate de fechamento (Phase 96 Plan 06 — resolveCloseGate) ──
  /** true quando o gate (CMV cheio + guia real) bloqueia o fechamento. Só se aplica ao caminho de FECHAR — nunca ao de reabrir. */
  closeBlocked?: boolean;
  /** Frases pt-BR curtas explicando o que falta — exibidas no tooltip do botão bloqueado. */
  closeBlockReasons?: string[];
  /** [C6] SKUs vendidos no mês sem custo_unit_cheio — alimenta a lista do gate. */
  cmvGaps?: CmvCheioGap[];
  /** [C8] Lançamentos crus do bloco "Não classificado" da competência — só para informar, nunca corrige sozinho. */
  naoClassificadoItems?: NaoClassificadoItem[];
}

// ── Componente ─────────────────────────────────────────────────────────────

export function MLCostCard({
  mesLabel,
  receitaMes,
  receitaBruta,
  cancelamentosVendas = 0,
  margemContribuicao,
  gruposTarifas,
  totalTarifas,
  cmvMes,
  impostosMes,
  fonte,
  loading,
  onPrevMonth,
  onNextMonth,
  canGoNext = false,
  syncing = false,
  faturaFrom,
  faturaTo,
  blocosOperacionais = [],
  resultadoOperacional,
  financeiro = null,
  resultadoLiquido,
  regime,
  mesClosed = false,
  guiaCompetenceLabel,
  canClose = false,
  nudgeClose = false,
  onClose,
  onReopen,
  closeBusy = false,
  closeBlocked = false,
  closeBlockReasons = [],
  cmvGaps = [],
  naoClassificadoItems = [],
}: MLCostCardProps) {
  // Margem de contribuição: fonte única = computeMargemContribuicao (dreMargem.ts),
  // calculada pelo caller e recebida por prop. Nenhuma aritmética de margem
  // sobrevive neste componente (Phase 96 Plan 05 — elimina a duplicação).
  const margemPositiva = margemContribuicao >= 0;
  const margemPct = receitaMes > 0 ? ((margemContribuicao / receitaMes) * 100).toFixed(1) : "—";

  // ── Cascata do resultado (Phase 88) ──
  // Degradação graciosa: sem linhas operacionais e sem financeiro, o card para
  // na Margem de contribuição (RPC vazia/loading não quebra o layout).
  const temCascata = blocosOperacionais.length > 0 || financeiro != null;
  const resultadoOperacionalVal = resultadoOperacional ?? margemContribuicao;
  const resultadoLiquidoVal = resultadoLiquido ?? resultadoOperacionalVal;
  const operacionalPositivo = resultadoOperacionalVal >= 0;
  const liquidoPositivo = resultadoLiquidoVal >= 0;
  const liquidoPct =
    receitaMes > 0 ? ((resultadoLiquidoVal / receitaMes) * 100).toFixed(1) : "—";

  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="h-full relative overflow-hidden">
        {/* ── Cabeçalho ── */}
        <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">DRE do Mês</span>
          <div className="flex items-center gap-1.5">
            {syncing && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            )}
            <button
              type="button"
              onClick={onPrevMonth}
              disabled={!onPrevMonth || syncing}
              aria-label="Mês anterior"
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium tabular-nums text-foreground min-w-[88px] text-center">
              {mesLabel}
            </span>
            <button
              type="button"
              onClick={onNextMonth}
              disabled={!onNextMonth || !canGoNext || syncing}
              aria-label="Mês seguinte"
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                fonte === "competencia"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : fonte === "billing"
                  ? "bg-blue-500/15 text-blue-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {fonte === "competencia" ? "mês 01–31" : fonte === "billing" ? "fatura ML" : "estimado"}
            </span>
            {regime && (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  regime === "apuracao"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {regime === "apuracao"
                  ? `Apurado — guias de ${guiaCompetenceLabel ?? ""}`
                  : "Previsão"}
              </span>
            )}
          </div>
        </div>

        {/* No modo fatura mensal, o ciclo de cobrança não é o mês-calendário —
            mostra a janela real. No modo competência (mês 01–31) não se aplica. */}
        {fonte === "billing" && faturaFrom && faturaTo && (
          <div className="px-4 pb-1 -mt-1 flex justify-end">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Tarifas da fatura ML: {fmtDayMonth(faturaFrom)} → {fmtDayMonth(faturaTo)}
            </span>
          </div>
        )}

        {/* Regime: empurrãozinho (dica, nunca gatilho) + botão owner-only de
            marcar/reabrir o mês como apurado. RLS de dre_month_close é a
            autoridade real — este gate é só UX (94-CONTEXT.md). */}
        {(canClose || (nudgeClose && !mesClosed) || (!mesClosed && cmvGaps.length > 0)) && (
          <div className="px-4 pb-2 -mt-1 flex items-center justify-end gap-2 flex-wrap">
            {nudgeClose && !mesClosed && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] text-emerald-500 inline-flex items-center gap-1 cursor-default">
                      🟢 Guias parecem lançadas
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px] text-xs text-center">
                    As 3 guias (ICMS/PIS/COFINS) de {guiaCompetenceLabel ?? "M+1"} parecem lançadas —
                    fechar mês?
                    {closeBlocked && (
                      <>
                        <br />
                        Ainda assim, o gate de fechamento está bloqueado — veja o motivo no botão.
                      </>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {/* [C6] Gatilho da lista de SKUs sem custo cheio — "diga exatamente o
                que preencher" do objetivo da phase, não escondido atrás de um
                ícone de 12px. */}
            {!mesClosed && cmvGaps.length > 0 && <CmvGapsTrigger gaps={cmvGaps} />}
            {canClose && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* wrapper span: botão disabled não dispara eventos de ponteiro
                        (disabled:pointer-events-none), então o hover do Tooltip
                        precisa do span ao redor para continuar funcionando. */}
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={mesClosed ? onReopen : onClose}
                        disabled={closeBusy || (mesClosed ? !onReopen : !onClose || closeBlocked)}
                        className="text-[10px] font-medium px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:pointer-events-none transition-colors inline-flex items-center gap-1"
                      >
                        {closeBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        {mesClosed ? "Reabrir mês" : "Marcar mês como apurado"}
                      </button>
                    </span>
                  </TooltipTrigger>
                  {/* Resolve o Pitfall 10: o 🟢 "Guias parecem lançadas" pode
                      estar aceso ao lado de um botão desabilitado — o tooltip
                      explica o porquê em vez de deixar a contradição muda. */}
                  {!mesClosed && closeBlocked && closeBlockReasons.length > 0 && (
                    <TooltipContent className="max-w-[240px] text-xs text-left">
                      <p className="font-medium mb-1 text-center">Falta para apurar:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {closeBlockReasons.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}

        <CardContent className="px-4 pb-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-5 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-0">
              {/* ── Receita bruta do mês [C1] ── */}
              <div className="flex items-end justify-between pb-2 mb-1.5 border-b border-border">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Receita bruta do mês
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground">
                    {fmt(receitaBruta)}
                  </p>
                </div>
              </div>

              {/* ── Cancelamentos de vendas [C1] — venda, não tarifa; fica FORA do
                  .map de gruposTarifas para não contaminar "Total de tarifas ML" ── */}
              {cancelamentosVendas !== 0 && (
                <div className="flex items-center justify-between text-xs py-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <span className="text-muted-foreground/50">(−)</span>
                    Cancelamentos de vendas
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                      {pct(cancelamentosVendas, receitaMes)}
                    </span>
                    <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                      {fmt(cancelamentosVendas)}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Grupos de tarifas ── */}
              <div className="space-y-0">
                {gruposTarifas.map((grupo) => (
                  <div
                    key={grupo.key}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    {grupo.excluded ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground/60 flex items-center gap-1 cursor-default">
                              {grupo.label}
                              <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[220px] text-xs text-center">
                            Taxa paga pelo comprador (acréscimo no preço dele) — não é custo da
                            loja, por isso não entra no Total de tarifas ML.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <span className="text-muted-foreground/50">(−)</span>
                        {grupo.label}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(grupo.amount, receitaMes)}
                      </span>
                      <span
                        className={`font-semibold tabular-nums w-24 text-right ${
                          grupo.excluded ? "text-muted-foreground/60" : "text-foreground"
                        }`}
                      >
                        {fmt(grupo.amount)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Total de tarifas ML */}
                <div className="flex items-center justify-between text-xs pt-1.5 mt-0.5 border-t border-border/60">
                  <span className="flex items-center gap-1 font-semibold text-foreground">
                    <span className="text-muted-foreground/50">=</span>
                    Total de tarifas ML
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                      {pct(totalTarifas, receitaMes)}
                    </span>
                    <span className="font-bold tabular-nums w-24 text-right text-foreground">
                      {fmt(totalTarifas)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── CMV do mês ── */}
              <div className="flex items-center justify-between text-xs py-1 mt-0.5 border-t border-border/40">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="text-muted-foreground/50">(−)</span>
                  CMV do mês
                </span>
                <div className="flex items-center gap-2">
                  {cmvMes != null ? (
                    <>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(cmvMes, receitaMes)}
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                        {fmt(cmvMes)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] italic text-muted-foreground w-24 text-right">
                      s/ custo
                    </span>
                  )}
                </div>
              </div>

              {/* ── Impostos próprios ── */}
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="text-muted-foreground/50">(−)</span>
                  Impostos próprios (regime fiscal)
                </span>
                <div className="flex items-center gap-2">
                  {impostosMes != null ? (
                    <>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(impostosMes, receitaMes)}
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                        {fmt(impostosMes)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] italic text-muted-foreground w-24 text-right">
                      s/ config
                    </span>
                  )}
                </div>
              </div>

              {/* ── Margem de contribuição (subtotal médio) ── */}
              <div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  {margemPositiva ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  )}
                  Margem de contribuição
                  <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                    ({margemPct}%)
                  </span>
                </span>
                <span
                  className={`text-base font-bold tabular-nums w-24 text-right ${
                    margemPositiva ? "text-kpi-positive" : "text-kpi-negative"
                  }`}
                >
                  {fmt(margemContribuicao)}
                </span>
              </div>

              {/* ── Cascata do resultado (custos operacionais + financeiro, RPC 87) ── */}
              {temCascata && (
                <>
                  {/* Linhas dos blocos operacionais */}
                  {blocosOperacionais.map((b) => (
                    <div
                      key={b.bloco}
                      className="flex items-center justify-between text-xs py-1 first:mt-0.5"
                    >
                      <span className="text-muted-foreground flex items-center gap-1">
                        <span className="text-muted-foreground/50">(−)</span>
                        {b.label}
                        {b.doubleCountRisk && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default inline-flex">
                                  <HelpCircle className="w-3 h-3 text-muted-foreground/60" />
                                </span>
                              </TooltipTrigger>
                              {/* [C9] valor da linha no texto — sem número é fácil
                                  de ignorar. A cascata CONTINUA somando o valor
                                  cheio (nada de auto-netting); a flag só sinaliza. */}
                              <TooltipContent className="max-w-[220px] text-xs text-center">
                                Pode conter fatura ML já contabilizada na margem — {fmt(b.total)}{" "}
                                nesta linha em risco de double-count. O valor continua somado; Wesley
                                corrige na fonte (Tiny).
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {/* [C8] lista dos lançamentos crus — só informa, nunca
                            move/corrige. Renderiza junto do bloco não_classificado
                            quando há lançamentos para o Wesley recategorizar. */}
                        {b.bloco === "nao_classificado" && naoClassificadoItems.length > 0 && (
                          <NaoClassificadoTrigger items={naoClassificadoItems} total={b.total} />
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                          {pct(b.total, receitaMes)}
                        </span>
                        <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                          {fmt(b.total)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Subtotal: Resultado operacional */}
                  <div className="flex items-center justify-between text-xs pt-1.5 mt-0.5 border-t border-border/60">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <span className="text-muted-foreground/50">=</span>
                      Resultado operacional
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                        {pct(resultadoOperacionalVal, receitaMes)}
                      </span>
                      <span
                        className={`font-bold tabular-nums w-24 text-right ${
                          operacionalPositivo ? "text-kpi-positive" : "text-kpi-negative"
                        }`}
                      >
                        {fmt(resultadoOperacionalVal)}
                      </span>
                    </div>
                  </div>

                  {/* Linha: Financeiro (Empréstimo) */}
                  {financeiro != null && (
                    <div className="flex items-center justify-between text-xs py-1 mt-0.5 border-t border-border/40">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <span className="text-muted-foreground/50">(−)</span>
                        Financeiro (Empréstimo)
                        {financeiro.doubleCountRisk && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default inline-flex">
                                  <HelpCircle className="w-3 h-3 text-muted-foreground/60" />
                                </span>
                              </TooltipTrigger>
                              {/* [C9] valor da linha — mesma regra: sinaliza, nunca desconta. */}
                              <TooltipContent className="max-w-[220px] text-xs text-center">
                                Pode conter fatura ML já contabilizada na margem — {fmt(financeiro.total)}{" "}
                                nesta linha em risco de double-count. O valor continua somado; Wesley
                                corrige na fonte (Tiny).
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                          {pct(financeiro.total, receitaMes)}
                        </span>
                        <span className="font-semibold tabular-nums w-24 text-right text-foreground">
                          {fmt(financeiro.total)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Subtotal final: Resultado líquido (mais destacado, sinal verde/vermelho) */}
                  <div className="flex items-center justify-between text-xs pt-2.5 mt-1.5 border-t-2 border-border">
                    <span className="flex items-center gap-1.5 font-bold text-foreground">
                      {liquidoPositivo ? (
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-500" />
                      )}
                      Resultado líquido
                      <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                        ({liquidoPct}%)
                      </span>
                    </span>
                    <span
                      className={`text-base font-bold tabular-nums w-24 text-right ${
                        liquidoPositivo ? "text-kpi-positive" : "text-kpi-negative"
                      }`}
                    >
                      {fmt(resultadoLiquidoVal)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
