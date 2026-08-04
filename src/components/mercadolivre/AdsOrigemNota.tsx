// ============================================================================
// AdsOrigemNota — Fase 212
//
// Uma linha de texto que diz de onde veio o número de publicidade da tela.
//
// Existe porque a régua de ads tem DUAS origens possíveis — a fatura do
// Mercado Livre rateada por anúncio (o normal) e o relatório de publicidade
// (o piso, quando a fatura do período ainda não sincronizou). A troca entre
// elas muda o MCO exibido, então ela nunca pode acontecer escondida: é a mesma
// disciplina das fases 210 e 211, agora reusável pelas telas de resultado.
//
// Componente PURO de apresentação: sem hook, sem leitura de banco, sem estado.
// ============================================================================

import type { RateioAnuncioSource } from "@/lib/adsRateio";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export interface AdsOrigemNotaProps {
  /** `billing-rateio` = fatura rateada; `cache` = relatório de publicidade. */
  source: RateioAnuncioSource;
  /** Parte da fatura do período que não encontrou chave de rateio (R$). */
  naoRateado?: number;
  className?: string;
}

export function AdsOrigemNota({ source, naoRateado = 0, className }: AdsOrigemNotaProps) {
  return (
    <p className={["text-[10px] text-muted-foreground", className ?? ""].join(" ").trim()}>
      {source === "billing-rateio" ? (
        <>
          Publicidade = <span>fatura do Mercado Livre</span>{" "}
          <strong className="font-medium">rateada por anúncio</strong> pela proporção do relatório de
          publicidade.
        </>
      ) : (
        <>
          Publicidade = <span>relatório de publicidade</span> — a fatura do período{" "}
          <span>ainda não foi sincronizada</span>.
        </>
      )}
      {naoRateado !== 0 && (
        <span className="text-warning">
          {" "}
          {brl(naoRateado)} da fatura do período ficaram <span>sem chave de rateio</span> (nenhum
          anúncio com gasto no relatório de publicidade) — não entram no MCO destes anúncios.
        </span>
      )}
    </p>
  );
}
