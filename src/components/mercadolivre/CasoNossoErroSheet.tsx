import { Wrench } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { CasoConciliacaoRow } from "@/hooks/useConciliacao";
import { rotuloMotivo, rotuloTipoCaso, valorEmReais } from "@/lib/casoUrgencia";
import { dataEmBR, textoOuAusente } from "@/lib/dossieConciliacao";
import { BotaoCopiar, LinhaMeta } from "@/components/mercadolivre/CasoConciliacaoSheet";

// ============================================================================
// 225-05 — a fila "Nosso erro", DELIBERADAMENTE MAIS POBRE
//
// 🔴 Este componente é mais pobre de propósito. A fila de erro nosso não vai a
// lugar nenhum: é correção de cadastro ou de ingestão, aqui dentro. Um caminho
// para virar chamado nesta fila seria o começo exato da acusação falsa que
// D-225-07 existe para impedir — e o custo dela não é o valor do caso, é a
// credibilidade do PRÓXIMO chamado.
//
// Por isso, e sem exceção:
//   · nenhum botão de montar chamado;
//   · nenhum botão de desfecho — não há desfecho a rastrear contra terceiro;
//   · nenhum selo de prazo: não existe janela de ressarcimento para corrigir a
//     nossa própria base, e um relógio aqui criaria urgência inventada.
//
// ⚠️ FRONTEIRA DE LINGUAGEM: a palavra que acusa o Mercado Livre não aparece
// neste arquivo. O que se afirma aqui é sobre a nossa base — cadastro,
// ingestão, agrupamento de carrinho. É essa separação que protege a autoridade
// do que se afirma na outra fila.
//
// ⚠️ Não existe "Marcar como corrigido": o `check` de `estado` em
// `conciliacao_casos` aceita seis valores e nenhum deles significa isso. Criar
// um exigiria migration, e este plano é só front. Registrado como pendência,
// não improvisado com um estado de significado torcido.
// ============================================================================

interface Props {
  caso: CasoConciliacaoRow | null;
  ingestaoInicio: string | null;
  onOpenChange: (aberto: boolean) => void;
}

export function CasoNossoErroSheet({ caso, ingestaoInicio, onOpenChange }: Props) {
  return (
    <Sheet open={caso != null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {caso == null ? null : (
          <>
            <SheetHeader className="space-y-2 border-b border-border px-5 py-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {rotuloTipoCaso(caso.tipo_caso)}
                </Badge>
                {/* Sem selo de prazo: aqui não corre relógio de ressarcimento. */}
              </div>
              <SheetTitle className="text-base font-semibold">
                {textoOuAusente(caso.titulo, "Produto não informado")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Divergência da nossa própria base no pedido{" "}
                {textoOuAusente(caso.ml_order_id, "não informado")}: item de correção interna,
                sem prazo e sem chamado.
              </SheetDescription>
              <div className="group flex items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">
                  {textoOuAusente(caso.ml_order_id, "pedido não informado")}
                </span>
                <BotaoCopiar campo="número do pedido" valor={caso.ml_order_id ?? ""} />
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <Alert>
                <Wrench className="h-4 w-4" />
                <AlertTitle className="text-sm">Correção interna</AlertTitle>
                <AlertDescription className="text-xs leading-snug">
                  {rotuloMotivo(caso.motivo, { ingestaoInicio })}
                </AlertDescription>
              </Alert>

              <Separator className="my-4" />

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">As duas leituras</h3>
                <p className="text-xs text-muted-foreground">
                  Os números que a divergência produziu. Servem para achar o cadastro ou a
                  ingestão que precisa de conserto.
                </p>
                <div className="mt-2">
                  <LinhaMeta rotulo="Esperado pela nossa base" valor={valorEmReais(caso.esperado_nosso)} />
                  <LinhaMeta rotulo="Recebido" valor={valorEmReais(caso.recebido)} />
                  <LinhaMeta rotulo="Diferença" valor={valorEmReais(caso.diferenca)} />
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Dados do pedido</h3>
                <div className="mt-2">
                  <LinhaMeta rotulo="SKU" valor={textoOuAusente(caso.sku)} />
                  <LinhaMeta rotulo="Data da venda" valor={dataEmBR(caso.data_pedido)} />
                  <LinhaMeta rotulo="Data do evento" valor={dataEmBR(caso.data_evento)} />
                  <div className="mt-1">
                    {(caso.payment_ids ?? [])
                      .filter((p) => typeof p === "string" && p.trim().length > 0)
                      .map((p) => (
                        <LinhaMeta key={`pgto-${p}`} rotulo="Pagamento" valor={p} />
                      ))}
                  </div>
                </div>
              </section>
            </div>

            <div className="border-t border-border px-5 py-4">
              {/* 🔴 Nenhuma ação. Este rodapé existe para DIZER que não há. */}
              <p className="text-center text-xs text-muted-foreground">
                Nada aqui é enviado para fora. É item de correção da nossa base — sem prazo, sem
                chamado e sem desfecho a registrar.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
