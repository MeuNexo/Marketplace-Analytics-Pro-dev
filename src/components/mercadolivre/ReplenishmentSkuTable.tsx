import { useState } from "react";
import { ChevronRight, HelpCircle, Info, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  GroupedReplenishmentRow,
  ReplenishmentSkuRow,
} from "@/hooks/useReplenishmentBySku";
import { isDemandaEstimada } from "@/lib/analysis/replenishmentUtils";

// ── Formatters ────────────────────────────────────────────────────────────────

const currencyFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const numFmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

/** "2026-07-27" → "27/jul" (data curta, sem fuso — usa partes da string) */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[3]}/${meses[Number(m[2]) - 1] ?? ""}`;
}

// ── A caminho cell (qtd em OC aberta + data da próxima chegada) ────────────────

function ACaminhoCell({ qtd, data }: { qtd: number; data: string | null }) {
  if (!qtd || qtd <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="leading-tight">
      <span className="tabular-nums font-medium text-foreground">{qtd} un</span>
      {data && (
        <p className="text-[10px] text-muted-foreground">chega {shortDate(data)}</p>
      )}
    </div>
  );
}

/** Menor data_proxima_chegada (mais próxima) entre as variações de um grupo */
function earliestArrival(skus: ReplenishmentSkuRow[]): string | null {
  const datas = skus.map((s) => s.data_proxima_chegada).filter((d): d is string => !!d);
  if (datas.length === 0) return null;
  return datas.sort()[0];
}

// ── Vende por dia cell (decisão em destaque + os dois indicadores) ────────────

/**
 * Mostra a DECISÃO final (venda_dia) em destaque e, abaixo, os dois indicadores
 * que a originaram: simples (espinha) e inteligente (EWMA×sazonal). Quando a
 * inteligente assumiu (venda_dia_origem ≠ 'simples'), exibe badge "Previsão
 * inteligente ↑"; caso contrário badge "Simples". Phase 68.
 */
function VendaDiaCell({ row }: { row: ReplenishmentSkuRow }) {
  const inteligenteAssumiu = row.venda_dia_origem !== "simples";

  return (
    <div className="leading-tight">
      {/* Decisão final em destaque */}
      <span className="tabular-nums font-medium text-foreground">
        {numFmt(row.venda_dia)}/d
      </span>

      {/* Os dois indicadores, menores e em muted */}
      <p className="text-[10px] text-muted-foreground tabular-nums">
        Simples {numFmt(row.venda_simples)} · Intel{" "}
        {row.venda_inteligente == null ? "—" : numFmt(row.venda_inteligente)}
      </p>

      {/* Badge de origem da decisão */}
      <div className="mt-0.5">
        {inteligenteAssumiu ? (
          <Badge className="text-[9px] bg-green-500/10 text-green-600 border-none">
            Previsão inteligente ↑
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[9px]">
            Simples
          </Badge>
        )}
      </div>
    </div>
  );
}

// ── Header with tooltip helper ────────────────────────────────────────────────

function HeaderWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">
              <HelpCircle className="w-3 h-3 text-muted-foreground/60" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[200px] text-xs text-center">
            {tip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

// ── Acao cell (variacao / SKU unico) ─────────────────────────────────────────

function AcaoCell({ row }: { row: ReplenishmentSkuRow }) {
  // Fase 214 / D-1: item sem anuncio ML ativo NUNCA vira compra. Vem antes de
  // tudo porque a resposta "o que fazer com isto" e outra: nao e comprar, e
  // decidir se o anuncio volta. Inclui os que pausaram sozinhos por ruptura.
  if (!row.tem_anuncio_ativo) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-muted-foreground">👁️ Só sinalizar</span>
        <span className="text-[10px] text-muted-foreground/80">
          sem anúncio ativo no ML
        </span>
      </div>
    );
  }
  // Phase 69 — esgotados são classificados PRIMEIRO (antes da lógica de giro normal)
  if (row.status_esgotado === "descontinuar") {
    return (
      <span className="text-muted-foreground text-[11px]">
        ⚫ Descontinuar?
      </span>
    );
  }
  if (row.status_esgotado === "revisar_esgotado") {
    return (
      <span className="text-[11px] text-warning font-medium">
        ⚠️ Revisar (parado)
      </span>
    );
  }
  if (row.status_esgotado === "repor_esgotado") {
    return (
      <div className="space-y-0.5">
        <span className="text-destructive text-[11px] font-semibold">
          🔴 Repor {row.compra_sugerida}
        </span>
        {isDemandaEstimada(row.venda_dia_origem) && (
          <div>
            <Badge
              variant="outline"
              className="text-[9px] border-amber-500/50 text-amber-600 leading-tight"
            >
              estoque zerado · demanda estimada pelo histórico ({numFmt(row.venda_dia)}/d)
            </Badge>
          </div>
        )}
      </div>
    );
  }
  // com_giro → lógica existente intocada
  if (row.sem_giro) {
    return (
      <span className="text-muted-foreground text-[11px]">
        ⚪ Sem vendas
      </span>
    );
  }
  if (row.gatilho_ativo && row.compra_sugerida > 0) {
    return (
      <span className="text-destructive text-[11px] font-semibold">
        🔴 Comprar {row.compra_sugerida}
      </span>
    );
  }
  if (row.custo_ausente) {
    return (
      <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
        ⚠️ Falta custo
      </Badge>
    );
  }
  return (
    <span className="text-[11px]" style={{ color: "var(--kpi-positive)" }}>
      🟢 Estoque ok
    </span>
  );
}

// ── Acao cell (linha mestre de grupo) ────────────────────────────────────────

function MasterAcaoCell({ group }: { group: GroupedReplenishmentRow }) {
  // Phase 69 — estado agregado esgotados: repor > revisar > descontinuar (antes da lógica de giro)
  const hasReporEsgotado    = group.skus.some((s) => s.status_esgotado === "repor_esgotado");
  const hasRevisarEsgotado  = group.skus.some((s) => s.status_esgotado === "revisar_esgotado");
  const hasDescontinuar     = group.skus.some((s) => s.status_esgotado === "descontinuar");
  const hasEstimadaDemand   = group.skus.some(
    (s) => s.status_esgotado === "repor_esgotado" && isDemandaEstimada(s.venda_dia_origem),
  );

  if (hasReporEsgotado) {
    return (
      <div className="space-y-0.5">
        <span className="text-destructive text-[11px] font-semibold">
          🔴 Repor (esgotado) {group.total_compra_sugerida > 0 ? group.total_compra_sugerida : ""}
        </span>
        {hasEstimadaDemand && (
          <div>
            <Badge
              variant="outline"
              className="text-[9px] border-amber-500/50 text-amber-600 leading-tight"
            >
              demanda estimada pelo histórico
            </Badge>
          </div>
        )}
      </div>
    );
  }
  if (hasRevisarEsgotado) {
    return (
      <span className="text-[11px] text-warning font-medium">
        ⚠️ Revisar (parado)
      </span>
    );
  }
  if (hasDescontinuar) {
    return (
      <span className="text-muted-foreground text-[11px]">
        ⚫ Descontinuar?
      </span>
    );
  }
  // Lógica de giro normal intocada
  if (group.skus.every((s) => s.sem_giro)) {
    return (
      <span className="text-muted-foreground text-[11px]">
        ⚪ Sem vendas
      </span>
    );
  }
  if (group.any_gatilho_ativo) {
    return (
      <span className="text-destructive text-[11px] font-semibold">
        🔴 Comprar {group.total_compra_sugerida}
      </span>
    );
  }
  if (group.any_custo_ausente) {
    return (
      <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
        ⚠️ Falta custo
      </Badge>
    );
  }
  return (
    <span className="text-[11px]" style={{ color: "var(--kpi-positive)" }}>
      🟢 Estoque ok
    </span>
  );
}

// ── Params tooltip (icone discreto por linha) ─────────────────────────────────

function ParamsTooltip({ row }: { row: ReplenishmentSkuRow }) {
  const origemBadge =
    row.param_origem === "sku" ? (
      <Badge className="text-[10px] bg-primary/10 text-primary border-none">sku</Badge>
    ) : row.param_origem === "fornecedor" ? (
      <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600">fornecedor</Badge>
    ) : row.param_origem === "marca" ? (
      <Badge variant="outline" className="text-[10px]">marca</Badge>
    ) : (
      <Badge variant="secondary" className="text-[10px]">global</Badge>
    );

  // Phase 67 D-11 — badges de transparência por dimensão
  const tendenciaBadge = row.tendencia === "↑"
    ? <Badge className="text-[10px] bg-green-500/10 text-green-600 border-none">↑ Alta</Badge>
    : row.tendencia === "↓"
    ? <Badge className="text-[10px] bg-destructive/10 text-destructive border-none">↓ Queda</Badge>
    : <Badge variant="secondary" className="text-[10px]">~ Estável</Badge>;

  const vendaOrigemBadge =
    row.venda_dia_origem === "ewma_sazonal"
      ? <Badge className="text-[10px] bg-primary/10 text-primary border-none">EWMA + saz.</Badge>
      : row.venda_dia_origem === "ewma"
      ? <Badge variant="outline" className="text-[10px]">EWMA</Badge>
      : <Badge variant="secondary" className="text-[10px]">Simples</Badge>;

  const leadTimeBadge =
    row.lead_time_origem === "fornecedor_real" && row.lead_time_real != null
      ? <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-600">Prazo real {row.lead_time_real}d</Badge>
      : <Badge variant="secondary" className="text-[10px]">Prazo fixo {row.param_lead_time}d</Badge>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Ver regras de reposição"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-[11px] space-y-1.5 max-w-[220px]">
          {/* Parâmetros de reposição (existentes) */}
          <div className="flex items-center gap-1">
            {origemBadge}
            <span>Ponto {row.ponto_reposicao}un</span>
          </div>
          <div>
            Cob {row.param_cobertura}d · Folga {row.param_safety}d
          </div>
          <div>
            Min {row.param_moq} · Caixa {row.param_pack}
          </div>
          {/* Phase 67 D-11 — badges de transparência do cálculo esperto */}
          <div className="border-t border-border/40 pt-1 space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              {vendaOrigemBadge}
              {tendenciaBadge}
            </div>
            {row.fator_sazonal != null && (
              <div>
                <Badge variant="outline" className="text-[10px]">
                  Sazonal ×{row.fator_sazonal.toFixed(2)}
                </Badge>
              </div>
            )}
            <div>{leadTimeBadge}</div>
            {row.venda_dia_origem === "simples" && (
              <div className="text-[10px] text-muted-foreground italic">modo simples</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Sub-cells ─────────────────────────────────────────────────────────────────

function CoberturaCell({ row }: { row: ReplenishmentSkuRow }) {
  if (row.sem_giro || row.cobertura_atual == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span>{numFmt(row.cobertura_atual)}d</span>;
}

function ValorEstimadoCell({ row }: { row: ReplenishmentSkuRow }) {
  if (row.custo_ausente) {
    return (
      <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
        custo ausente
      </Badge>
    );
  }
  if (row.valor_estimado == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums font-medium">{currencyFmt(row.valor_estimado)}</span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded" />
      ))}
    </div>
  );
}

// ── Variation row (filha) ─────────────────────────────────────────────────────

function VariationRow({ sku }: { sku: ReplenishmentSkuRow }) {
  return (
    <TableRow className="hover:bg-muted/20 bg-muted/5">
      {/* Indent + SKU code + Cor/Tamanho */}
      <TableCell className="text-xs pl-8">
        <div>
          {sku.attribute_combinations_label ? (
            <span className="text-foreground font-medium">
              {sku.attribute_combinations_label}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {sku.sku_code && (
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              {sku.sku_code}
            </p>
          )}
        </div>
      </TableCell>

      {/* Estoque — Full (ML) + CD (Tiny), com o saldo fora da conta ao lado */}
      <TableCell className="text-xs text-right tabular-nums font-medium">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help border-b border-dotted border-muted-foreground/40">
                {sku.sku_stock}
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              <div>Full (ML): {sku.estoque_full}</div>
              <div>CD Expedição (Tiny): {sku.estoque_cd}</div>
              {sku.estoque_centro > 0 && (
                <div className="mt-1 pt-1 border-t text-amber-600 dark:text-amber-500">
                  Centro de distribuição: {sku.estoque_centro}
                  <div className="opacity-80">fora do cálculo de compra</div>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {sku.estoque_centro > 0 && (
          <span
            className="ml-1 text-[10px] text-amber-600 dark:text-amber-500 font-normal"
            title={`${sku.estoque_centro} un em "Centro de distribuição" — não entram na sugestão`}
          >
            +{sku.estoque_centro}*
          </span>
        )}
      </TableCell>

      {/* A caminho */}
      <TableCell className="text-xs text-right">
        <ACaminhoCell qtd={sku.qtd_a_caminho} data={sku.data_proxima_chegada} />
      </TableCell>

      {/* Vende por dia (decisão + dois indicadores) */}
      <TableCell className="text-xs text-right">
        <div className="flex justify-end">
          <VendaDiaCell row={sku} />
        </div>
      </TableCell>

      {/* Dura quanto */}
      <TableCell className="text-xs text-right tabular-nums">
        <CoberturaCell row={sku} />
      </TableCell>

      {/* Comprar */}
      <TableCell className="text-xs text-right tabular-nums">
        {sku.compra_sugerida > 0 ? (
          <span className="font-semibold text-primary">{sku.compra_sugerida}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>

      {/* Custo estimado */}
      <TableCell className="text-xs text-right">
        <ValorEstimadoCell row={sku} />
      </TableCell>

      {/* O que fazer */}
      <TableCell className="text-xs">
        <AcaoCell row={sku} />
      </TableCell>

      {/* Icone de regras */}
      <TableCell className="text-xs">
        <ParamsTooltip row={sku} />
      </TableCell>
    </TableRow>
  );
}

// ── Master row (pai) ──────────────────────────────────────────────────────────

interface MasterRowProps {
  group:      GroupedReplenishmentRow;
  expanded:   boolean;
  onToggle:   () => void;
}

function MasterRow({ group, expanded, onToggle }: MasterRowProps) {
  const hasManySkus = group.skus.length > 1;

  return (
    <TableRow
      className={`hover:bg-muted/30 ${group.any_gatilho_ativo ? "bg-primary/5" : ""}`}
    >
      {/* Produto + marca + expand */}
      <TableCell className="text-xs">
        <div className="flex items-start gap-1">
          {hasManySkus ? (
            <CollapsibleTrigger asChild>
              <button
                onClick={onToggle}
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={expanded ? "Recolher variações" : "Expandir variações"}
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${
                    expanded ? "rotate-90" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-3.5 h-3.5 shrink-0 mt-0.5 block" />
          )}
          <div className="min-w-0">
            <p className="font-medium truncate max-w-[220px]" title={group.title ?? group.item_id}>
              {group.title ?? group.item_id}
            </p>
            {group.brand && (
              <p className="text-[11px] text-muted-foreground truncate">{group.brand}</p>
            )}
            {hasManySkus && (
              <p className="text-[10px] text-muted-foreground">
                {group.skus.length} variações
                {group.any_gatilho_ativo && (
                  <span className="ml-1 text-primary font-medium">
                    ({group.skus.filter((s) => s.gatilho_ativo).length} gatilho)
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </TableCell>

      {/* Estoque total */}
      <TableCell className="text-xs text-right tabular-nums font-medium">
        {group.skus.reduce((s, r) => s + r.sku_stock, 0)}
      </TableCell>

      {/* A caminho total */}
      <TableCell className="text-xs text-right">
        <ACaminhoCell qtd={group.total_a_caminho} data={earliestArrival(group.skus)} />
      </TableCell>

      {/* Vende por dia (soma) */}
      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
        {numFmt(group.skus.reduce((s, r) => s + r.venda_dia, 0))}/d
      </TableCell>

      {/* Dura quanto — em branco para agrupado */}
      <TableCell />

      {/* Comprar total */}
      <TableCell className="text-xs text-right tabular-nums">
        {group.total_compra_sugerida > 0 ? (
          <span className="font-semibold text-primary">{group.total_compra_sugerida}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>

      {/* Custo estimado total */}
      <TableCell className="text-xs text-right">
        {group.any_custo_ausente ? (
          <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
            custo ausente
          </Badge>
        ) : group.total_valor_estimado != null ? (
          <span className="tabular-nums font-medium">
            {currencyFmt(group.total_valor_estimado)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* O que fazer (estado agregado) */}
      <TableCell className="text-xs">
        <MasterAcaoCell group={group} />
      </TableCell>

      {/* Icone de regras — vazio na linha mestre (detalhes nas variacoes) */}
      <TableCell />
    </TableRow>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ReplenishmentSkuTableProps {
  grouped:    GroupedReplenishmentRow[];
  isLoading?: boolean;
  error?:     Error | null;
}

export function ReplenishmentSkuTable({
  grouped,
  isLoading,
  error,
}: ReplenishmentSkuTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggle(itemId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center gap-2 p-6 text-destructive text-sm">
        <Info className="w-4 h-4 shrink-0" />
        <span>Erro ao carregar dados de reposição. Tente recarregar a página.</span>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
        <Info className="w-6 h-6" />
        <span>Nenhum resultado para os filtros aplicados.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="text-xs min-w-[220px]">
              <HeaderWithTip
                label="Produto"
                tip="Anúncio no ML; clique para ver os tamanhos e cores disponíveis"
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="Estoque"
                tip="Full do Mercado Livre + depósito CD Expedição do Tiny. É esta soma que a sugestão de compra desconta. Passe o mouse no número para ver a composição."
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="A caminho"
                tip="Unidades já compradas em ordens de compra abertas no Tiny, aguardando recebimento. Essa quantidade é descontada da sugestão de compra."
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="Vende por dia"
                tip="Média de unidades vendidas por dia na janela analisada"
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="Dura quanto"
                tip="Quantos dias o estoque atual dura no ritmo de venda"
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="Comprar"
                tip="Quantidade sugerida de compra para atingir o estoque desejado"
              />
            </TableHead>
            <TableHead className="text-xs text-right">
              <HeaderWithTip
                label="Custo estimado"
                tip="Quanto essa compra deve custar (qtd x custo unitário)"
              />
            </TableHead>
            <TableHead className="text-xs">O que fazer</TableHead>
            <TableHead className="text-xs" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.map((group) => {
            const isExpanded = expandedIds.has(group.item_id);
            const hasManySkus = group.skus.length > 1;

            // Anúncio sem variação: linha única sem expand
            if (!hasManySkus) {
              const sku = group.skus[0];
              return (
                <TableRow key={group.item_id} className="hover:bg-muted/30">
                  <TableCell className="text-xs">
                    <div className="flex items-start gap-1">
                      <span className="w-3.5 h-3.5 shrink-0 mt-0.5 block" />
                      <div className="min-w-0">
                        <p className="font-medium truncate max-w-[220px]" title={group.title ?? group.item_id}>
                          {group.title ?? group.item_id}
                        </p>
                        {group.brand && (
                          <p className="text-[11px] text-muted-foreground truncate">{group.brand}</p>
                        )}
                        {sku.sku_code && (
                          <p className="text-[10px] font-mono text-muted-foreground">{sku.sku_code}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">
                    {sku.sku_stock}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <ACaminhoCell qtd={sku.qtd_a_caminho} data={sku.data_proxima_chegada} />
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <div className="flex justify-end">
                      <VendaDiaCell row={sku} />
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    <CoberturaCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {sku.compra_sugerida > 0 ? (
                      <span className="font-semibold text-primary">{sku.compra_sugerida}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    <ValorEstimadoCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <AcaoCell row={sku} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <ParamsTooltip row={sku} />
                  </TableCell>
                </TableRow>
              );
            }

            // Anúncio COM variações: linha mestre + linhas filha (Collapsible)
            return (
              <Collapsible key={group.item_id} open={isExpanded} asChild>
                <>
                  <MasterRow
                    group={group}
                    expanded={isExpanded}
                    onToggle={() => toggle(group.item_id)}
                  />
                  <CollapsibleContent asChild>
                    <>
                      {group.skus.map((sku) => (
                        <VariationRow
                          key={sku.variation_id ?? sku.item_id}
                          sku={sku}
                        />
                      ))}
                    </>
                  </CollapsibleContent>
                </>
              </Collapsible>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
