/**
 * SeloPromo — o selo compacto de UMA linha que substitui o par de cenários de
 * rebate nas listas (Quick task 260821-nof, D-selo-01/D-selo-04).
 *
 * QUAL É O IRMÃO DELE: `RebateDoisCenarios` continua existindo e continua
 * mostrando o par completo — mas agora só no DETALHE (modal do anúncio,
 * `/analise-precos`, e as outras superfícies que já usavam o componente antes
 * deste plano). `SeloPromo` é o que aparece nas LISTAS (`/resultado`,
 * `/anuncios`, `/publicidade`): um número — a margem real, renderizada fora
 * deste componente — mais este selo de RISCO ao lado, quando parte dessa
 * margem depende de uma promoção comercial do Mercado Livre continuar.
 *
 * Apresentação PURA: não decide estado (isso é `resolveSeloPromo` /
 * `estadoAtualDaSerie`, em `seloPromo.ts`), recebe o resultado já pronto.
 * Mesmo precedente de `data-rebate-regua`/`data-difal-regua`/`data-ads-source`:
 * número que muda de régua não pode mudar em silêncio — `data-selo-promo` no
 * elemento raiz é o mesmo tipo de prova para captura de tela.
 */

import { cn } from "@/lib/utils";
import type { EstadoSelo, SeloPromoResult } from "@/lib/seloPromo";

export interface SeloPromoProps {
  /** Saída de `resolveSeloPromo`/`estadoAtualDaSerie` — já decidida, nunca recomputada aqui. */
  selo: SeloPromoResult;
  /** `bloco` para faixas e detalhe; `celula` para tabelas densas. */
  densidade?: "bloco" | "celula";
  className?: string;
}

/**
 * Cor por estado. É um selo de RISCO, não de saúde: promoção ativa entra em
 * tom de alerta suave (essa margem depende de a campanha continuar), a
 * conferência que não fecha em tom destrutivo (erro nosso, acionável), os
 * demais em tom apagado. Sem ícone e sem emoji.
 */
const ESTADO_CLASSES: Record<EstadoSelo, string> = {
  com_promo: "text-warning",
  com_promo_parcial: "text-warning",
  conferencia_nao_fecha: "text-destructive",
  nao_capturado: "text-muted-foreground",
  indisponivel: "text-muted-foreground",
  sem_promo: "text-muted-foreground",
  sem_venda_recente: "text-muted-foreground",
};

export function SeloPromo({ selo, densidade = "bloco", className }: SeloPromoProps) {
  const compacto = densidade === "celula";

  return (
    <span
      data-selo-promo={selo.estado}
      title={selo.titulo}
      className={cn(
        "inline-flex items-center whitespace-nowrap font-medium tabular-nums",
        ESTADO_CLASSES[selo.estado],
        compacto ? "text-[10px]" : "text-xs",
        className,
      )}
    >
      {selo.texto}
    </span>
  );
}
