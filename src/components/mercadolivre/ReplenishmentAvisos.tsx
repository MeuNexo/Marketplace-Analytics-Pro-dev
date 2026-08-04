import { AlertTriangle, Clock, PackageSearch } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { TinyStockHealth } from "@/hooks/useTinyStockHealth";
import type { ReplenishmentSkuRow } from "@/hooks/useReplenishmentBySku";

interface Props {
  health: TinyStockHealth | null | undefined;
  rows: ReplenishmentSkuRow[];
}

function horasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 3_600_000 : null;
}

function textoIdade(horas: number | null): string {
  if (horas == null) return "nunca";
  if (horas < 1) return "há menos de 1 hora";
  if (horas < 24) return `há ${Math.floor(horas)} h`;
  return `há ${Math.floor(horas / 24)} dia(s)`;
}

/**
 * Avisos da tela de Compras (Fase 214).
 *
 * Três coisas que a tela precisa dizer em voz alta, porque cada uma leva a
 * comprar errado se ficar calada:
 *
 * 1. FRESCOR — sugerir compra sobre estoque velho é pior que não sugerir.
 * 2. ESTOQUE FORA DA CONTA — o depósito `Centro de distribuição` não entra no
 *    cálculo por decisão de negócio (D-5). Se houver saldo relevante lá, a
 *    sugestão manda recomprar o que já existe. O número aparece aqui em vez de
 *    sumir.
 * 3. SEM ANÚNCIO — item sem anúncio ML ativo nunca vira compra (D-1); ele só
 *    sinaliza. Sem dizer isso, a lista parece ter itens "esquecidos".
 */
export function ReplenishmentAvisos({ health, rows }: Props) {
  const totalCentro = rows.reduce((acc, r) => acc + (r.estoque_centro ?? 0), 0);
  const skusCentro  = rows.filter((r) => (r.estoque_centro ?? 0) > 0).length;
  const totalCd     = rows.reduce((acc, r) => acc + (r.estoque_cd ?? 0), 0);
  const semAnuncio  = rows.filter((r) => !r.tem_anuncio_ativo).length;

  const pctFora =
    totalCentro + totalCd > 0
      ? Math.round((100 * totalCentro) / (totalCentro + totalCd))
      : 0;

  const horas = horasDesde(health?.volta_completa ?? null);
  const varreduraEmCurso =
    health != null && health.total_fila > 0 && health.indice < health.total_fila;

  return (
    <div className="space-y-2">
      {/* 1. Frescor do estoque do Tiny */}
      {health != null && health.desatualizado && (
        <Alert variant="destructive">
          <Clock className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Estoque do CD pode estar desatualizado.</strong>{" "}
            {health.volta_completa
              ? `A última varredura completa do Tiny terminou ${textoIdade(horas)}.`
              : "Nenhuma varredura completa do Tiny terminou ainda."}{" "}
            As sugestões abaixo usam esse saldo — confira antes de comprar.
            {varreduraEmCurso && ` Varredura em curso: ${health.pct_volta}%.`}
          </AlertDescription>
        </Alert>
      )}

      {health != null && !health.desatualizado && (
        <p className="text-[11px] text-muted-foreground px-1">
          Estoque do CD sincronizado do Tiny {textoIdade(horas)} ·{" "}
          {health.skus_com_estoque} SKUs
          {health.erros > 0 && ` · ${health.erros} erro(s) na última volta`}
        </p>
      )}

      {/* 2. Estoque que existe mas NÃO entra na conta (D-5) */}
      {totalCentro > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>
              {totalCentro.toLocaleString("pt-BR")} unidades em “Centro de
              distribuição” não entram no cálculo
            </strong>{" "}
            ({skusCentro} SKUs, {pctFora}% do estoque próprio). Por decisão de
            configuração, só o depósito <em>CD Expedição</em> é descontado da
            sugestão de compra. Se esse saldo for estoque vivo, parte do que a
            lista manda comprar já está no armazém.
          </AlertDescription>
        </Alert>
      )}

      {/* 3. Itens que só sinalizam (D-1) */}
      {semAnuncio > 0 && (
        <Alert>
          <PackageSearch className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>{semAnuncio} itens sem anúncio ativo no Mercado Livre.</strong>{" "}
            Eles aparecem para você <em>enxergar</em> o catálogo inteiro, mas
            nunca recebem compra sugerida — inclusive os que pausaram sozinhos
            por ruptura, que costumam ser os que mais precisam de atenção.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
