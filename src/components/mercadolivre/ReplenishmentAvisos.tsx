import { Clock, PackageSearch } from "lucide-react";
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
 * Duas coisas que a tela precisa dizer em voz alta, porque cada uma leva a
 * comprar errado se ficar calada. O saldo de "Centro de distribuição" NÃO está
 * entre elas: ficou fora do cálculo por decisão (D-5), então é régua e não
 * anomalia — vive no tooltip da coluna Estoque, sem alarde.
 *
 * 1. FRESCOR — sugerir compra sobre estoque velho é pior que não sugerir.
 * 2. SEM ANÚNCIO — item sem anúncio ML ativo nunca vira compra (D-1); ele só
 *    sinaliza. Sem dizer isso, a lista parece ter itens "esquecidos".
 */
export function ReplenishmentAvisos({ health, rows }: Props) {
  const semAnuncio = rows.filter((r) => !r.tem_anuncio_ativo).length;

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

      {/* 2. "Centro de distribuição" fica FORA da conta por decisão do Wesley
             (D-5, reafirmada em 05/08 com os 794 un medidos na mão). O alarde
             saiu: não é anomalia a ser investigada toda vez que a tela abre, é
             régua escolhida. O número segue visível no tooltip da coluna
             Estoque e na marca "+N*" da linha, para quem quiser conferir. */}

      {/* 2. Itens que só sinalizam (D-1) */}
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
