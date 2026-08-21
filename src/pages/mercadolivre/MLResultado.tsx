// ============================================================================
// MLResultado — "em que eu ganho e em que eu perco dinheiro?" (Fase 213, 06)
//
// Esta tela é a antiga `/produtos-vendidos`, movida (não copiada) para que o
// histórico do arquivo continue rastreável. Ela passa a ser a FONTE ÚNICA de
// qualquer número de margem por produto: o mesmo ranking vivia em quatro
// lugares com três réguas diferentes, e foi assim que a fase 213 nasceu.
//
// O que ela absorve:
//   • `/produtos-vendidos` inteira — painel duplo, semáforo, tooltips;
//   • a Curva ABC, que deixa de ser aba em duas telas e vira uma COLUNA de
//     classificação sobre a receita real do período (CR-06);
//   • o Ranking de giro de `/anuncios` (RE-02): a coluna "Unidades" ordenável
//     É o ranking de giro do período, sem a coluna de receita vitalícia que o
//     CR-06/CR-07 condenaram.
//
// A tela nasce declarando a própria régua: `AdsOrigemNota` (de onde vem a
// publicidade) e `AvisoCustoFaltante` (quantos anúncios estão sem CMV) no topo,
// obrigatórios, sobre o período INTEIRO — não sobre o grupo selecionado, porque
// os dois avisos são sobre a confiabilidade da tela toda.
//
// As colunas novas aparecem nos DOIS layouts (tabela no desktop, cartões no
// celular), inclusive o controle de ordenação: no celular a tabela não tem
// cabeçalho para clicar, e sem o seletor o ranking de giro seria inalcançável
// justamente onde ele já era invisível.
// ============================================================================

import { useMemo, useState, useCallback } from "react";
import { ShoppingBag, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { MLPeriodPicker } from "@/components/mercadolivre/MLPeriodPicker";
import { AdsOrigemNota } from "@/components/mercadolivre/AdsOrigemNota";
import { AvisoCustoFaltante } from "@/components/mercadolivre/AvisoCustoFaltante";
import { contarSemCusto } from "@/lib/custoFaltante";
import { useMLFilters } from "@/hooks/useMLFilters";
import { useOrdersFreshness } from "@/hooks/useOrdersFreshness";
import { AvisoFrescorPedidos } from "@/components/mercadolivre/AvisoFrescorPedidos";
import { useMLMarginWithAds } from "@/hooks/useMLMarginWithAds";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import {
  aggregateMcoGroups,
  aggregateMcoItems,
  type McoProductRow,
  type PvMcoGroup,
  type PvMcoItem,
} from "@/components/mercadolivre/anuncios/soldProductsMcoAgg";
import type { CurvaAbc } from "@/lib/curvaAbc";
import { classifyMcoHealth, mcoHealthRole, type McoHealth, type McoColorRole } from "@/lib/mcoHealth";
// [Quick 260821-nof, D-selo-01/02/03] `McoDoisCenarios`/`RebateDoisCenarios`
// SAÍRAM das três células desta tela (par sempre visível, herdado da Fase
// 222/223) — ver o comentário datado 21/08/2026 em cada ponto de remoção.
// `/resultado` NÃO TEM modal nem gaveta de detalhe (verificado: nenhum
// Dialog/Sheet/Modal no arquivo) — por isso o cenário com DIFAL, o cenário na
// tarifa cheia e a frase de motivo quando ausentes seguem rotulados, mas
// migram para o `title` de cada célula, junto com a média do período.
import {
  DIFAL_ESTIMATIVA_AJUDA,
  DIFAL_ESTIMATIVA_LABEL,
  fraseMotivoSemDifal,
  resolveLinhaCenarios,
  type LinhaCenariosResult,
} from "@/lib/mcoLinhaCenarios";
import { useDifalRegimeAplicavel } from "@/hooks/useDifalRegimeAplicavel";
import {
  fraseMotivoSemRebate,
  REBATE_CENARIO_AJUDA,
  REBATE_CENARIO_LABEL,
  resolveLinhaRebate,
  type LinhaRebateResult,
} from "@/lib/rebateLinhaCenarios";
import { SeloPromo } from "@/components/mercadolivre/SeloPromo";
import {
  janelaEstadoAtual,
  resolveSeloPromo,
  SELO_RECORTE_AJUDA,
  type SeloPromoResult,
} from "@/lib/seloPromo";
import { KPI_GLOSSARY } from "@/lib/kpi-glossary";

// ─── Formatters ───────────────────────────────────────────────────────────────

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const intFmt = (v: number) => v.toLocaleString("pt-BR");

const pctFmt = (v: number | null) => (v !== null ? `${v.toFixed(1)}%` : "—");

// ─── Semáforo MCO — role → classes CVD-safe (tokens do projeto) ───────────────

const MCO_ROLE_CLASSES: Record<McoColorRole, { dot: string; text: string }> = {
  good: { dot: "bg-success", text: "text-success" },
  warning: { dot: "bg-warning", text: "text-warning" },
  critical: { dot: "bg-destructive", text: "text-destructive" },
  neutral: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

// ─── Ordenação ────────────────────────────────────────────────────────────────

type SortKey =
  | "qty"
  | "revenue"
  | "mcoPreAdsPct"
  | "mcoPct"
  | "acosPct"
  | "breakeven"
  | "curva"
  | "estoque"
  | "share";
type SortDir = "asc" | "desc";

const COLUMN_LABEL: Record<SortKey, string> = {
  qty: "Unidades",
  revenue: "Receita",
  mcoPreAdsPct: "MCO pré-ads",
  mcoPct: "MCO pós-ads",
  acosPct: "% Ads",
  breakeven: "Breakeven ACoS",
  curva: "Curva",
  estoque: "Estoque",
  share: "% Grupo",
};

/**
 * Ordem das colunas de decisão, a mesma nos dois layouts. Giro (unidades) e
 * receita primeiro — "quanto vendeu" —, depois as duas margens lado a lado,
 * o custo da publicidade, o teto dela e a posição na carteira.
 */
const DESKTOP_COLUMNS: SortKey[] = [
  "qty",
  "revenue",
  "mcoPreAdsPct",
  "mcoPct",
  "acosPct",
  "breakeven",
  "curva",
  "estoque",
  "share",
];

/** Tooltip de cada coluna — a régua fica ao alcance do cursor, não no manual. */
const COLUMN_TOOLTIP: Partial<Record<SortKey, string>> = {
  qty: "Unidades vendidas no período selecionado. Ordenar por ela é o ranking de giro.",
  revenue: "Receita realizada no período selecionado (nunca receita vitalícia).",
  mcoPreAdsPct: "Margem de contribuição ANTES da publicidade — diz se o produto é bom.",
  mcoPct: KPI_GLOSSARY.mco.definition,
  acosPct: KPI_GLOSSARY.acos.definition,
  breakeven:
    "ACoS máximo antes de a publicidade comer toda a margem: é a própria margem pré-ads. %Ads acima dele derruba o MCO para o vermelho.",
  curva:
    "Concentração de receita do período na CARTEIRA inteira: A até 80% do acumulado, B até 95%, C o resto. Não muda ao trocar marca por categoria.",
};

/**
 * Ordem de importância da curva: A vale mais que C, para que a ordenação
 * padrão (desc, "maior primeiro") traga a Curva A ao topo.
 */
const CURVA_PESO: Record<CurvaAbc, number> = { A: 3, B: 2, C: 1 };

function sortValue(item: PvMcoItem, key: SortKey, stock: number | null): number | null {
  switch (key) {
    case "qty":
      return item.qty;
    case "revenue":
      return item.revenue;
    case "mcoPreAdsPct":
      return item.mcoPreAdsPct;
    case "mcoPct":
      return item.mcoPct;
    case "acosPct":
      return item.acosPct;
    case "breakeven":
      return item.breakevenAcosPct;
    case "curva":
      return CURVA_PESO[item.curva];
    case "estoque":
      return stock;
    case "share":
      return item.shareOfGroup;
  }
}

// ─── Selo da Curva ABC ────────────────────────────────────────────────────────

const CURVA_CLASSES: Record<CurvaAbc, string> = {
  A: "bg-success/10 text-success border-success/30",
  B: "bg-warning/10 text-warning border-warning/30",
  C: "bg-muted text-muted-foreground border-border/60",
};

function CurvaBadge({ curva }: { curva: CurvaAbc }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-semibold ${CURVA_CLASSES[curva]}`}
    >
      {curva}
    </span>
  );
}

// ─── Célula de breakeven de ACoS ─────────────────────────────────────────────
//
// Sem custo cadastrado o breakeven é INDEFINIDO, não zero: mostrar zero
// convidaria a ler "qualquer publicidade já é prejuízo", que é invenção.

function BreakevenCell({ item }: { item: PvMcoItem }) {
  if (item.breakevenAcosPct === null) {
    return <span className="text-xs tabular-nums text-muted-foreground">—</span>;
  }
  // %Ads acima do breakeven = a publicidade daquele anúncio comeu toda a margem.
  const estourou = item.acosPct !== null && item.acosPct > item.breakevenAcosPct;
  return (
    <span
      className={`text-xs tabular-nums ${estourou ? "text-destructive font-semibold" : "text-muted-foreground"}`}
    >
      {item.breakevenAcosPct.toFixed(1)}%
    </span>
  );
}

// ─── Célula/badge de MCO% (semáforo + rótulo + tooltip de quebra de custos) ───

/**
 * [222-15-R2] Os dois cenários da linha, decididos por `resolveLinhaCenarios`.
 *
 * 🔴 Nada é recalculado aqui: os dois pares saem PRONTOS da mesma RPC, das
 * mesmas expressões, com o termo de imposto trocado. Somar DIFAL sobre o MCO
 * já pronto é o atalho que custou R$ 3,85 por pedido no 222-06-R/07-R.
 */
function cenariosPosAds(item: PvMcoItem, regimeAplicaDifal?: boolean): LinhaCenariosResult {
  return resolveLinhaCenarios({
    semDifal: { valor: item.mcoReais, pct: item.mcoPct },
    comDifal:
      item.mcoComDifalReais != null
        ? { valor: item.mcoComDifalReais, pct: item.mcoPctComDifal }
        : null,
    difalEfeito: item.difalEfeito,
    pedidosDifalIndefinido: item.pedidosDifalIndefinido,
    regimeAplicaDifal,
  });
}

function cenariosPreAds(item: PvMcoItem, regimeAplicaDifal?: boolean): LinhaCenariosResult {
  return resolveLinhaCenarios({
    semDifal: { valor: item.mcoPreAdsReais ?? 0, pct: item.mcoPreAdsPct },
    comDifal:
      item.mcoPreAdsComDifalReais != null
        ? { valor: item.mcoPreAdsComDifalReais, pct: item.mcoPreAdsPctComDifal }
        : null,
    difalEfeito: item.difalEfeito,
    pedidosDifalIndefinido: item.pedidosDifalIndefinido,
    regimeAplicaDifal,
  });
}

/**
 * [223-06] Os dois cenários de REBATE do item — régua INDEPENDENTE do DIFAL
 * acima (uma é imposto, a outra é desconto de comissão medido na fatura do
 * ML). Nada é recalculado aqui: os oito campos já vieram prontos da RPC
 * (223-05), a Task 1 só os carregou até o item/grupo sem tocar em nenhum.
 */
function cenariosRebatePosAds(item: PvMcoItem): LinhaRebateResult {
  return resolveLinhaRebate({
    comRebate: { valor: item.mcoReais, pct: item.mcoPct },
    semRebate:
      item.mcoSemRebateReais != null
        ? { valor: item.mcoSemRebateReais, pct: item.mcoPctSemRebate }
        : null,
    rebateEfeito: item.rebateEfeito,
    rebateBruto: item.rebateBruto,
    pedidosSemCaptura: item.pedidosSemCapturaRebate,
    pedidosNaoConferidos: item.pedidosRebateNaoConferido,
  });
}

function cenariosRebatePreAds(item: PvMcoItem): LinhaRebateResult {
  return resolveLinhaRebate({
    comRebate: { valor: item.mcoPreAdsReais ?? 0, pct: item.mcoPreAdsPct },
    semRebate:
      item.mcoPreAdsSemRebateReais != null
        ? { valor: item.mcoPreAdsSemRebateReais, pct: item.mcoPreAdsPctSemRebate }
        : null,
    rebateEfeito: item.rebateEfeito,
    rebateBruto: item.rebateBruto,
    pedidosSemCaptura: item.pedidosSemCapturaRebate,
    pedidosNaoConferidos: item.pedidosRebateNaoConferido,
  });
}

// ─── [Quick 260821-nof] Selo de estado atual + frases rotuladas do detalhe ────
//
// D-selo-01/02: as células passam a mostrar UM número + o selo de estado
// atual. D-selo-03: o cenário com DIFAL, o cenário na tarifa cheia e os
// motivos de ausência não desaparecem — migram para o `title` de cada
// célula, porque `/resultado` NÃO TEM modal nem gaveta de detalhe (verificado:
// nenhum Dialog/Sheet/Modal neste arquivo).

/** A média do período do rebate — reusa `resolveSeloPromo`, não uma segunda conta. */
function pctMedioPeriodoRebate(
  comissao: number,
  rebateBruto: number | null,
  pedidosSemCaptura: number,
  pedidosNaoConferidos: number,
): number | null {
  return resolveSeloPromo({
    comissao,
    rebateBruto,
    pedidosSemCaptura,
    pedidosNaoConferidos,
    semVendaNaJanela: false,
  }).pct;
}

/** O selo do item — estado ATUAL (janela recente), nunca a média do período. */
function seloItem(item: PvMcoItem, recente: McoProductRow | undefined): SeloPromoResult {
  const mediaPeriodoPct = pctMedioPeriodoRebate(
    item.comissao,
    item.rebateBruto,
    item.pedidosSemCapturaRebate,
    item.pedidosRebateNaoConferido,
  );

  if (!recente) {
    return resolveSeloPromo({ comissao: 0, rebateBruto: null, semVendaNaJanela: true, mediaPeriodoPct });
  }

  return resolveSeloPromo({
    comissao: recente.comissao,
    rebateBruto: recente.rebate_bruto ?? null,
    pedidosSemCaptura: recente.pedidos_sem_captura_rebate,
    pedidosNaoConferidos: recente.pedidos_rebate_nao_conferido,
    semVendaNaJanela: false,
    mediaPeriodoPct,
  });
}

/** O selo do grupo — a mesma disciplina do item, sobre os agregados do grupo. */
function seloGrupo(group: PvMcoGroup, recente: PvMcoGroup | undefined): SeloPromoResult {
  const mediaPeriodoPct = pctMedioPeriodoRebate(
    group.comissao,
    group.rebateBruto,
    group.pedidosSemCapturaRebate,
    group.pedidosRebateNaoConferido,
  );

  if (!recente) {
    return resolveSeloPromo({ comissao: 0, rebateBruto: null, semVendaNaJanela: true, mediaPeriodoPct });
  }

  return resolveSeloPromo({
    comissao: recente.comissao,
    rebateBruto: recente.rebateBruto,
    pedidosSemCaptura: recente.pedidosSemCapturaRebate,
    pedidosNaoConferidos: recente.pedidosRebateNaoConferido,
    semVendaNaJanela: false,
    mediaPeriodoPct,
  });
}

/** A frase do cenário DIFAL, rotulada, para o `title` da célula (D-selo-03). */
function fraseDifalTooltip(cenarios: LinhaCenariosResult): string {
  if (cenarios.comDifal) {
    return `Com DIFAL (${DIFAL_ESTIMATIVA_LABEL}): ${brl(cenarios.comDifal.valor)} (${pctFmt(cenarios.comDifal.pct)}) · efeito ${brl(cenarios.difalEfeito ?? 0)}.`;
  }
  return fraseMotivoSemDifal(cenarios.motivo, cenarios.pedidosDifalIndefinido) ?? DIFAL_ESTIMATIVA_AJUDA;
}

/** A frase do cenário de rebate (tarifa cheia), rotulada, com a média do período. */
function fraseRebateTooltip(cenarios: LinhaRebateResult, mediaPeriodoPct: number | null): string {
  const media = mediaPeriodoPct != null ? ` Média do período: ${mediaPeriodoPct.toFixed(1)}%.` : "";
  if (cenarios.semRebate) {
    return `${REBATE_CENARIO_LABEL}: ${brl(cenarios.semRebate.valor)} (${pctFmt(cenarios.semRebate.pct)}) · efeito ${brl(cenarios.rebateEfeito ?? 0)}.${media}`;
  }
  return `${fraseMotivoSemRebate(cenarios.motivo, cenarios.pedidosSemCaptura, cenarios.pedidosNaoConferidos) ?? REBATE_CENARIO_AJUDA}${media}`;
}

function McoCell({
  item,
  regimeAplicaDifal,
  seloRecente,
}: {
  item: PvMcoItem;
  regimeAplicaDifal?: boolean;
  /** Linha da JANELA RECENTE (mesmo item_id) — insumo do selo, D-selo-04. */
  seloRecente: McoProductRow | undefined;
}) {
  // 🔴 O SEMÁFORO CONTINUA LENDO O CENÁRIO SEM DIFAL. Trocar a base de uma cor
  // é decisão de negócio que ninguém tomou — o Wesley pediu para VER os dois
  // cenários, não para realertar por outro.
  const role = mcoHealthRole(item.health);
  const cls = MCO_ROLE_CLASSES[role];

  // 🔴 [21/08/2026, D-selo-02] O par de DIFAL/rebate (`McoDoisCenarios` +
  // `RebateDoisCenarios`) SAIU desta célula — reversão deliberada do
  // critério visual da Fase 222 nas LISTAS, medido na tela real com a 223
  // somando um terceiro e um quarto número. Restaurar aqui NÃO é correção de
  // regressão. Nada foi apagado: os dois cenários e os motivos de ausência
  // seguem no `title` abaixo, rotulados — `/resultado` não tem modal.
  const cenariosDifal = cenariosPosAds(item, regimeAplicaDifal);
  const cenariosRebate = cenariosRebatePosAds(item);
  const selo = seloItem(item, seloRecente);
  const mediaPeriodoPct = pctMedioPeriodoRebate(
    item.comissao,
    item.rebateBruto,
    item.pedidosSemCapturaRebate,
    item.pedidosRebateNaoConferido,
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 cursor-default">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cls.dot}`} aria-hidden="true" />
          {item.hasCmv ? (
            <span className="inline-flex flex-col items-end gap-0.5">
              <span className={`text-xs font-semibold tabular-nums ${cls.text}`}>
                {brl(item.mcoReais)} ({pctFmt(item.mcoPct)})
              </span>
              <SeloPromo selo={selo} densidade="celula" />
            </span>
          ) : (
            <span className={`text-xs font-medium tabular-nums ${cls.text}`}>—</span>
          )}
          {!item.hasCmv && (
            <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[260px] space-y-1">
        {!item.hasCmv && (
          <p className="font-medium text-warning">Sem custo cadastrado — MCO indefinido</p>
        )}
        <p>
          MCO {brl(item.mcoReais)} · Ads {brl(item.adsSpend)} · Comissão {brl(item.comissao)} · Frete{" "}
          {brl(item.frete)} · Imposto {brl(item.impostos)}
        </p>
        <p className="border-t border-border/50 pt-1">{fraseDifalTooltip(cenariosDifal)}</p>
        <p className="border-t border-border/50 pt-1">
          {fraseRebateTooltip(cenariosRebate, mediaPeriodoPct)}
        </p>
        <p className="text-[10px] text-muted-foreground border-t border-border/50 pt-1">
          {SELO_RECORTE_AJUDA}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Célula de MCO% PRÉ-ads ──────────────────────────────────────────────────
//
// Fica ao lado do pós-ads de propósito: as duas juntas são a comparação que
// responde "o produto é bom?" contra "ele é bom depois do que gastei para
// vendê-lo?". A diferença entre as duas É o peso da publicidade.

function PreAdsCell({
  item,
  regimeAplicaDifal,
}: {
  item: PvMcoItem;
  regimeAplicaDifal?: boolean;
}) {
  if (item.mcoPreAdsPct === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs tabular-nums text-muted-foreground cursor-default">—</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          Sem custo cadastrado — margem pré-ads indefinida (não é zero).
        </TooltipContent>
      </Tooltip>
    );
  }

  // 🔴 [21/08/2026, D-selo-01/02] O par de DIFAL/rebate SAIU desta célula —
  // reversão deliberada do critério visual da Fase 222 nas LISTAS. Esta
  // célula NÃO ganha selo próprio: o selo é o mesmo da linha (mora na coluna
  // pós-ads, ao lado) e repeti-lo aqui é a densidade que a D-selo-01 veio
  // remover. Os dois cenários seguem rotulados no `title` — nada foi apagado.
  const cenariosDifal = cenariosPreAds(item, regimeAplicaDifal);
  const cenariosRebate = cenariosRebatePreAds(item);
  const mediaPeriodoPct = pctMedioPeriodoRebate(
    item.comissao,
    item.rebateBruto,
    item.pedidosSemCapturaRebate,
    item.pedidosRebateNaoConferido,
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-xs font-medium tabular-nums">
          {brl(item.mcoPreAdsReais ?? 0)} ({pctFmt(item.mcoPreAdsPct)})
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[260px] space-y-1">
        <p>
          Margem antes da publicidade
          {item.mcoPreAdsReais !== null ? `: ${brl(item.mcoPreAdsReais)}` : ""}. Depois dos{" "}
          {brl(item.adsSpend)} de ads, sobra {pctFmt(item.mcoPct)}.
        </p>
        <p className="border-t border-border/50 pt-1">{fraseDifalTooltip(cenariosDifal)}</p>
        <p className="border-t border-border/50 pt-1">
          {fraseRebateTooltip(cenariosRebate, mediaPeriodoPct)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Badge de MCO% do grupo (painel esquerdo + cabeçalho-resumo) ─────────────

function GroupMcoBadge({
  group,
  size = "sm",
  regimeAplicaDifal,
  seloRecente,
}: {
  group: PvMcoGroup;
  size?: "sm" | "md";
  regimeAplicaDifal?: boolean;
  /** O MESMO grupo (mesma chave), agregado sobre a JANELA RECENTE — D-selo-04. */
  seloRecente: PvMcoGroup | undefined;
}) {
  // Semáforo do grupo continua na régua SEM DIFAL — ver a nota em McoCell.
  const health: McoHealth = classifyMcoHealth(group.mcoPct);
  const role = mcoHealthRole(health);
  const cls = MCO_ROLE_CLASSES[role];

  // [222-15-R2] O par do grupo. O percentual do segundo cenário já veio da
  // agregação como RAZÃO DE SOMAS (Σlucro pós-ads com DIFAL ÷ Σreceita),
  // nunca média dos percentuais dos itens.
  const cenarios = resolveLinhaCenarios({
    semDifal: { valor: group.revenue * ((group.mcoPct ?? 0) / 100), pct: group.mcoPct },
    comDifal:
      group.mcoComDifalReais != null
        ? { valor: group.mcoComDifalReais, pct: group.mcoPctComDifal }
        : null,
    difalEfeito: group.difalEfeito,
    pedidosDifalIndefinido: group.pedidosDifalIndefinido,
    regimeAplicaDifal,
  });

  // [223-06] O par de rebate do grupo — régua independente da fiscal acima.
  // Mesma razão de somas travada na Task 1: nunca média dos percentuais.
  const cenariosRebate = resolveLinhaRebate({
    comRebate: { valor: group.revenue * ((group.mcoPct ?? 0) / 100), pct: group.mcoPct },
    semRebate:
      group.mcoSemRebateReais != null
        ? { valor: group.mcoSemRebateReais, pct: group.mcoPctSemRebate }
        : null,
    rebateEfeito: group.rebateEfeito,
    pedidosSemCaptura: group.pedidosSemCapturaRebate,
    pedidosNaoConferidos: group.pedidosRebateNaoConferido,
  });

  // 🔴 [21/08/2026, D-selo-02] O par de DIFAL/rebate SAIU do badge do grupo —
  // reversão deliberada do critério visual da Fase 222 nas LISTAS. Os dois
  // cenários seguem rotulados no `title` — nada foi apagado, `/resultado`
  // não tem modal.
  const selo = seloGrupo(group, seloRecente);
  const mediaPeriodoPct = pctMedioPeriodoRebate(
    group.comissao,
    group.rebateBruto,
    group.pedidosSemCapturaRebate,
    group.pedidosRebateNaoConferido,
  );
  const valorReal = group.revenue * ((group.mcoPct ?? 0) / 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-default">
          <span className={`w-2 h-2 rounded-full shrink-0 ${cls.dot}`} aria-hidden="true" />
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className={`font-semibold tabular-nums ${size === "md" ? "text-sm" : "text-xs"} ${cls.text}`}>
              {brl(valorReal)} ({pctFmt(group.mcoPct)})
            </span>
            <SeloPromo selo={selo} densidade="celula" />
          </span>
          {group.hasMissingCost && (
            <AlertCircle className="w-2.5 h-2.5 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[240px] space-y-1">
        <p>
          {group.hasMissingCost
            ? "MCO% inclui anúncios sem custo cadastrado — pode estar impreciso."
            : "MCO% médio pós-ads do grupo (Σlucro pós-ads ÷ Σreceita)."}
        </p>
        <p className="border-t border-border/50 pt-1">{fraseDifalTooltip(cenarios)}</p>
        <p className="border-t border-border/50 pt-1">
          {fraseRebateTooltip(cenariosRebate, mediaPeriodoPct)}
        </p>
        <p className="text-[10px] text-muted-foreground border-t border-border/50 pt-1">
          {SELO_RECORTE_AJUDA}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Header de coluna ordenável (tabela desktop) ─────────────────────────────

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
    );
  }
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-foreground" />
  ) : (
    <ArrowDown className="w-3 h-3 text-foreground" />
  );
}

function SortHead({
  sortKey: key,
  currentKey,
  currentDir,
  onSort,
  tooltip,
  comSelo = false,
}: {
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  tooltip?: string;
  /**
   * 🔴 [21/08/2026, D-selo-02] As propriedades `ressalvaDifal`/`ressalvaRebate`
   * (que chamavam `McoDoisCenariosCabecalho`/`RebateDoisCenariosCabecalho`)
   * SAÍRAM — reversão deliberada do critério visual da Fase 222 nas LISTAS.
   * `comSelo` substitui as duas: acrescenta a frase do recorte do selo
   * (`SELO_RECORTE_AJUDA`) ao tooltip que a coluna já tem, em vez de repetir
   * a ressalva do par em cada cabeçalho.
   */
  comSelo?: boolean;
}) {
  const isActive = currentKey === key;
  const label = COLUMN_LABEL[key];
  const hint = tooltip ?? COLUMN_TOOLTIP[key];
  const hintComSelo = comSelo && hint ? `${hint} ${SELO_RECORTE_AJUDA}` : hint;

  const content = (
    <span
      className="inline-flex items-center gap-1 justify-end cursor-pointer select-none group"
      onClick={() => onSort(key)}
    >
      <span className="inline-flex flex-col items-end">{label}</span>
      <SortIndicator active={isActive} dir={currentDir} />
    </span>
  );

  return (
    <th className="py-2 text-right font-medium pr-4">
      {hintComSelo ? (
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[240px]">
            {hintComSelo}
          </TooltipContent>
        </Tooltip>
      ) : (
        content
      )}
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MLResultado() {
  // ── Estado local ──────────────────────────────────────────────────────────
  const [pvView, setPvView] = useState<"marca" | "categoria">("marca");
  const [pvSelected, setPvSelected] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Contextos ─────────────────────────────────────────────────────────────
  const { items: inventoryItems } = useMLInventory();

  // ── Filtro de período ─────────────────────────────────────────────────────
  const filters = useMLFilters(30);
  const { currentFrom, currentTo, periodLabel } = filters;

  const handleConfirm = useCallback(() => {
    if (filters.pendingRange?.from) {
      const resolvedTo = filters.pendingRange.to ?? filters.pendingRange.from;
      filters.setCustomRange({ from: filters.pendingRange.from, to: resolvedTo });
      filters.setPeriod(0);
    } else if (filters.pendingPeriod !== null) {
      filters.setPeriod(filters.pendingPeriod);
      filters.setCustomRange(null);
    }
    filters.setPopoverOpen(false);
  }, [filters]);

  // ── Hook de dados — margem pós-ads por anúncio (fonte única) ───────────────
  // Fase 212: a publicidade destas linhas é a fatura do ML rateada por anúncio,
  // não mais o gasto do relatório de publicidade. `margem.ads` diz a origem.
  const { data: margem, isLoading } = useMLMarginWithAds(currentFrom, currentTo);

  // ── [Quick 260821-nof, D-selo-04] SEGUNDA janela — o insumo do selo ────────
  // Uma consulta A MAIS por tela (nunca por linha), na MESMA RPC, com a
  // MESMA assinatura — só a janela muda, ancorada no FIM do período exibido.
  // `useMLMarginWithAds` não é tocado.
  const janelaRecente = useMemo(
    () => janelaEstadoAtual({ from: currentFrom, to: currentTo }),
    [currentFrom, currentTo],
  );
  const { data: margemRecente } = useMLMarginWithAds(janelaRecente.from, janelaRecente.to);

  // [222-15-R2] O recorte de lojas recolhe DIFAL? `false` só quando TODAS são
  // do Simples Nacional — aí as células dizem "regime não aplicável" em vez de
  // exibir dois números iguais e mudos (foi o caso da conta Junior).
  const regimeAplicaDifal = useDifalRegimeAplicavel();

  // Ate que horas o numero desta tela vale. Em 04/08 a operacao vendeu
  // R$ 19.040 e a tela mostrou R$ 13-14 mil: o calculo estava certo, faltava
  // metade dos pedidos. Dado incompleto sem aviso passa por completo.
  const { data: frescorPedidos } = useOrdersFreshness();

  // Produtos VENDIDOS: descarta linhas ads-only (unidades=0, gasto de ads sem venda).
  // O rateio já foi feito no hook sobre a carteira INTEIRA — filtrar aqui não
  // distorce a proporção de quem vendeu.
  const rows: McoProductRow[] = useMemo(
    () => (margem?.rows ?? []).filter((r) => r.unidades > 0),
    [margem],
  );

  // ── Map item_id → inventory (thumbnail, category_id, title atual, estoque) ──
  const itemsMap = useMemo(() => {
    const m = new Map<
      string,
      {
        category_id?: string | null;
        title?: string;
        thumbnail?: string | null;
        available_quantity?: number;
      }
    >();
    inventoryItems.forEach((i) => {
      if (i.id)
        m.set(i.id, {
          category_id: i.category_id,
          title: i.title,
          thumbnail: i.thumbnail,
          available_quantity: i.available_quantity,
        });
    });
    return m;
  }, [inventoryItems]);

  // ── Grupos e itens derivados client-side (agregação pós-ads, fonte 83-01) ──
  const pvGroups: PvMcoGroup[] = useMemo(
    () => aggregateMcoGroups(rows, pvView, itemsMap),
    [rows, pvView, itemsMap],
  );

  const pvItemsRaw: PvMcoItem[] = useMemo(
    () => (pvSelected !== null ? aggregateMcoItems(rows, pvSelected, pvView, itemsMap) : []),
    [rows, pvSelected, pvView, itemsMap],
  );

  // ── [Quick 260821-nof, D-selo-04] Insumo do selo — a MESMA agregação rodada
  // sobre as linhas da janela recente. A agregação não conhece período: é
  // isso que permite reusá-la aqui sem duplicar nenhuma conta.
  const rowsRecentes: McoProductRow[] = useMemo(
    () => (margemRecente?.rows ?? []).filter((r) => r.unidades > 0),
    [margemRecente],
  );
  const recentePorItemId = useMemo(() => {
    const m = new Map<string, McoProductRow>();
    rowsRecentes.forEach((r) => m.set(r.item_id, r));
    return m;
  }, [rowsRecentes]);
  const pvGroupsRecentes: PvMcoGroup[] = useMemo(
    () => aggregateMcoGroups(rowsRecentes, pvView, itemsMap),
    [rowsRecentes, pvView, itemsMap],
  );
  const recenteGrupoPorChave = useMemo(() => {
    const m = new Map<string, PvMcoGroup>();
    pvGroupsRecentes.forEach((g) => m.set(g.key, g));
    return m;
  }, [pvGroupsRecentes]);

  // ── Custo ausente: contagem sobre o PERÍODO INTEIRO, não sobre o grupo ─────
  // O aviso é sobre a confiabilidade da tela toda: contar só o grupo aberto
  // esconderia que a marca ao lado está 100% sem custo (AV-03).
  const contagemCusto = useMemo(
    () => contarSemCusto(rows.map((r) => ({ temCusto: r.has_cmv }))),
    [rows],
  );

  const selectedGroup = useMemo(
    () => (pvSelected !== null ? (pvGroups.find((g) => g.key === pvSelected) ?? null) : null),
    [pvGroups, pvSelected],
  );

  // ── Ordenação estável, nulls (MCO%/ACoS indefinidos) sempre ao fim ─────────
  const pvItems = useMemo(() => {
    const withStock = pvItemsRaw.map((item) => ({
      item,
      stock: itemsMap.get(item.item_id)?.available_quantity ?? null,
    }));

    const dirMul = sortDir === "asc" ? 1 : -1;

    withStock.sort((a, b) => {
      const va = sortValue(a.item, sortKey, a.stock);
      const vb = sortValue(b.item, sortKey, b.stock);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dirMul;
    });

    return withStock;
  }, [pvItemsRaw, itemsMap, sortKey, sortDir]);

  // Clicar no header ativo alterna asc/desc; clicar em outro header troca a coluna
  // (default desc, comportamento de "maior primeiro" ao entrar numa coluna nova).
  const onSortClick = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey],
  );

  // Ao trocar a view (marca/categoria), limpa a seleção de grupo
  const handleViewChange = (v: string) => {
    if (!v) return;
    setPvView(v as "marca" | "categoria");
    setPvSelected(null);
  };

  return (
    <div className="space-y-5">
      {/* ── Sticky header ── */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Resultado" />
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle marca/categoria */}
            <ToggleGroup
              type="single"
              size="sm"
              value={pvView}
              onValueChange={handleViewChange}
              className="h-8"
            >
              <ToggleGroupItem value="marca" className="h-7 px-3 text-xs">
                Marca
              </ToggleGroupItem>
              <ToggleGroupItem value="categoria" className="h-7 px-3 text-xs">
                Categoria
              </ToggleGroupItem>
            </ToggleGroup>
            {/* Seletor de período */}
            <MLPeriodPicker
              periodLabel={periodLabel}
              popoverOpen={filters.popoverOpen}
              setPopoverOpen={filters.setPopoverOpen}
              pendingRange={filters.pendingRange}
              setPendingRange={filters.setPendingRange}
              pendingPeriod={filters.pendingPeriod}
              setPendingPeriod={filters.setPendingPeriod}
              pendingLabel={filters.pendingLabel}
              canConfirm={filters.canConfirm}
              customRange={filters.customRange}
              period={filters.period}
              onConfirm={handleConfirm}
              maxDaysBack={365}
            />
          </div>
        </div>
      </div>

      {/* ── Frescor: ate que horas este numero vale ── */}
      <AvisoFrescorPedidos
        frescor={frescorPedidos}
        dateFrom={currentFrom}
        dateTo={currentTo}
      />

      {/* ── Estados de carregamento / vazio ── */}
      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Carregando pedidos do período…
        </p>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <ShoppingBag className="w-10 h-10 opacity-30" />
          <p className="text-sm">Nenhum produto vendido no período.</p>
        </div>
      )}

      {/* ── Origem do número de publicidade (Fase 212) ──
          A régua de ads mudou de fonte: a tela é obrigada a dizer qual está
          valendo, e quanto da fatura do período ficou sem chave de rateio. */}
      {!isLoading && rows.length > 0 && margem && (
        <AdsOrigemNota source={margem.ads.source} naoRateado={margem.ads.naoRateado} />
      )}

      {/* ── Ausência de custo (Fase 213-05, AV-03) ──
          Sem CMV não existe margem. A contagem é do período inteiro: é a tela
          toda que fica indefinida, não a célula. */}
      {!isLoading && rows.length > 0 && (
        <AvisoCustoFaltante contagem={contagemCusto} destinoCadastro="/precificacao" />
      )}

      {/* ── Painel duplo ── */}
      {!isLoading && rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

          {/* ── Coluna esquerda: lista de grupos ── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {pvView === "marca" ? "Marcas" : "Categorias"}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              {pvGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-4">Sem dados.</p>
              ) : (
                <ul className="space-y-0.5">
                  {pvGroups.map((g) => (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setPvSelected(pvSelected === g.key ? null : g.key)
                        }
                        className={[
                          "w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors",
                          pvSelected === g.key
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted text-foreground",
                        ].join(" ")}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate flex-1">{g.name}</span>
                          <span className="shrink-0 flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {brl(g.revenue)}
                            </span>
                            <GroupMcoBadge
                              group={g}
                              regimeAplicaDifal={regimeAplicaDifal}
                              seloRecente={recenteGrupoPorChave.get(g.key)}
                            />
                            <span>{intFmt(g.qty)} un.</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Coluna direita: anúncios do grupo selecionado ── */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {pvSelected === null
                  ? "Selecione um grupo acima"
                  : (selectedGroup?.name ?? pvSelected)}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {pvSelected === null ? (
                <p className="text-xs text-muted-foreground py-4">
                  Clique em uma {pvView === "marca" ? "marca" : "categoria"} para ver os anúncios.
                </p>
              ) : pvItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4">
                  Nenhum anúncio encontrado neste grupo.
                </p>
              ) : (
                <>
                  {/* ── Cabeçalho-resumo do grupo selecionado ── */}
                  {selectedGroup && (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/40 bg-muted/30 px-4 py-3 mb-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Receita total
                        </p>
                        <p className="text-sm font-semibold tabular-nums">{brl(selectedGroup.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          MCO% médio
                        </p>
                        <GroupMcoBadge
                          group={selectedGroup}
                          size="md"
                          regimeAplicaDifal={regimeAplicaDifal}
                          seloRecente={recenteGrupoPorChave.get(selectedGroup.key)}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Anúncios no vermelho
                        </p>
                        <p
                          className={[
                            "text-sm font-semibold tabular-nums",
                            selectedGroup.redCount > 0 ? "text-destructive" : "text-foreground",
                          ].join(" ")}
                        >
                          {selectedGroup.redCount}
                        </p>
                      </div>
                      {selectedGroup.hasMissingCost && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Alguns anúncios sem custo cadastrado — MCO% pode estar impreciso.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Desktop: tabela ordenável ── */}
                  <div className="hidden lg:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/40 text-xs text-muted-foreground">
                          <th className="py-2 text-left font-medium">Anúncio</th>
                          {DESKTOP_COLUMNS.map((k) => (
                            <SortHead
                              key={k}
                              sortKey={k}
                              currentKey={sortKey}
                              currentDir={sortDir}
                              onSort={onSortClick}
                              /* 🔴 [21/08/2026, D-selo-02] As ressalvas de par
                                 (McoDoisCenariosCabecalho/RebateDoisCenariosCabecalho)
                                 SAÍRAM dos dois cabeçalhos de MCO — reversão
                                 deliberada do critério visual da Fase 222 nas
                                 LISTAS. `comSelo` acrescenta a frase do
                                 recorte do selo ao tooltip no lugar delas. */
                              comSelo={k === "mcoPct" || k === "mcoPreAdsPct"}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pvItems.map(({ item, stock }) => {
                          const inv = itemsMap.get(item.item_id);
                          return (
                            <tr
                              key={item.item_id}
                              className="border-b border-border/20 hover:bg-muted/40 transition-colors"
                            >
                              <td className="py-2.5 pr-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  {inv?.thumbnail && (
                                    <img
                                      src={inv.thumbnail}
                                      alt=""
                                      className="w-8 h-8 rounded object-cover shrink-0"
                                    />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium leading-tight">
                                      {item.title}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">{item.item_id}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums">
                                {intFmt(item.qty)}
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums font-medium">
                                {brl(item.revenue)}
                              </td>
                              <td className="py-2.5 text-right pr-4">
                                <PreAdsCell item={item} regimeAplicaDifal={regimeAplicaDifal} />
                              </td>
                              <td className="py-2.5 text-right pr-4">
                                <McoCell
                                  item={item}
                                  regimeAplicaDifal={regimeAplicaDifal}
                                  seloRecente={recentePorItemId.get(item.item_id)}
                                />
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums text-muted-foreground">
                                {pctFmt(item.acosPct)}
                              </td>
                              <td className="py-2.5 text-right pr-4">
                                <BreakevenCell item={item} />
                              </td>
                              <td className="py-2.5 text-right pr-4">
                                <CurvaBadge curva={item.curva} />
                              </td>
                              <td className="py-2.5 text-right pr-4 text-xs tabular-nums text-muted-foreground">
                                {stock !== null ? intFmt(stock) : "—"}
                              </td>
                              <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {(item.shareOfGroup * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Mobile: controle de ordenação ──
                      O cartão não tem cabeçalho para clicar. Sem este seletor o
                      ranking de giro (ordenar por Unidades) seria inalcançável
                      justamente no celular, que é onde a tela já era invisível. */}
                  <div className="lg:hidden flex items-center gap-2 mb-3">
                    <span className="text-[11px] text-muted-foreground shrink-0">Ordenar por</span>
                    <Select value={sortKey} onValueChange={(v) => onSortClick(v as SortKey)}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DESKTOP_COLUMNS.map((k) => (
                          <SelectItem key={k} value={k} className="text-xs">
                            {COLUMN_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                      aria-label={sortDir === "desc" ? "Maior primeiro" : "Menor primeiro"}
                      className="h-8 px-2 rounded-md border border-border/60 text-muted-foreground shrink-0"
                    >
                      {sortDir === "desc" ? (
                        <ArrowDown className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* ── Mobile: cards ── */}
                  <div className="lg:hidden space-y-3">
                    {pvItems.map(({ item, stock }) => {
                      const inv = itemsMap.get(item.item_id);
                      return (
                        <div
                          key={item.item_id}
                          className="rounded-lg border border-border/40 p-3 bg-card"
                        >
                          <div className="flex items-start gap-2 mb-2">
                            {inv?.thumbnail && (
                              <img
                                src={inv.thumbnail}
                                alt=""
                                className="w-10 h-10 rounded object-cover shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium leading-snug line-clamp-2">
                                {item.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{item.item_id}</p>
                            </div>
                          </div>
                          {/* As MESMAS colunas do desktop — precedente de layout
                              duplo deste projeto: coluna nova entra nos dois. */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div>
                              <span className="text-muted-foreground">Unidades</span>
                              <p className="font-medium tabular-nums">{intFmt(item.qty)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Receita</span>
                              <p className="font-medium tabular-nums">{brl(item.revenue)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">MCO pré-ads</span>
                              <p className="font-medium tabular-nums">
                                <PreAdsCell item={item} regimeAplicaDifal={regimeAplicaDifal} />
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">MCO pós-ads</span>
                              <p className="font-medium tabular-nums">
                                <McoCell
                                  item={item}
                                  regimeAplicaDifal={regimeAplicaDifal}
                                  seloRecente={recentePorItemId.get(item.item_id)}
                                />
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">% Ads</span>
                              <p className="font-medium tabular-nums">{pctFmt(item.acosPct)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Breakeven ACoS</span>
                              <p className="font-medium tabular-nums">
                                <BreakevenCell item={item} />
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Curva</span>
                              <p className="font-medium tabular-nums">
                                <CurvaBadge curva={item.curva} />
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Estoque</span>
                              <p className="font-medium tabular-nums">
                                {stock !== null ? intFmt(stock) : "—"}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">% do grupo</span>
                              <p className="font-medium tabular-nums">
                                {(item.shareOfGroup * 100).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
