import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ============================================================================
// O aviso da fila desligada — e, agora, o que a ligaria
//
// O CEO em 04/09/2026, depois de usar a tela em produção:
//   "na página fala sobre a fila de repasse menor estar desligada… mas n vejo
//    onde ligar"
//
// A versão anterior declarava o estado e parava. Quem lia ficava sabendo que
// existe um interruptor e sem saber onde. Este bloco responde as três coisas
// que faltavam — POR QUE está desligada, O QUE FALTA para ligar, e QUEM LIGA —
// no padrão de disclosure já usado nesta tela (`BlocoRecolhido`): o estado fica
// visível, a procedência fica a um clique.
//
// 🔴 NÃO existe interruptor aqui, e a ausência é deliberada.
// `acusar_valor_a_menor` é um PORTÃO DE EVIDÊNCIA: ele separa "medi uma
// diferença" de "acuso o Mercado Livre por ela". Com 55,3% de aderência ao
// centavo, quase metade dos casos acusaria o ML de uma diferença que
// provavelmente é nossa — e cada acusação errada custa a credibilidade do
// PRÓXIMO chamado, que é o ativo que esta fase inteira existe para proteger.
// Um switch nesta tela transformaria uma decisão que precisa de prova numa que
// precisa de um clique. A tela EXPLICA; não oferece.
// ============================================================================

/**
 * ⚠️ Os três números abaixo são a MEDIÇÃO DA CALIBRAÇÃO (C-03), não o estado
 * de hoje: eles descrevem por que o portão está fechado, e por isso não vêm da
 * RPC. Os números vivos da janela estão nos cartões e no rodapé. Misturar as
 * duas coisas criaria uma segunda régua para o mesmo fato — o padrão que já
 * quebrou o saldo na fase 233.
 */
const CALIBRACAO = {
  aderenciaAoCentavo: "55,3%",
  vazamentoLiquido: "−R$ 14.221,84",
  ladoQueAcusa: "+R$ 3.752,44",
} as const;

export function FilaDesligadaAviso({
  acusarValorAMenor,
}: {
  /** Como veio da RPC. 🔴 Nulo é "não sei", nunca "desligada". */
  acusarValorAMenor: boolean | null;
}) {
  if (acusarValorAMenor !== false) return null;

  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">A fila de “repasse a menor” está desligada</AlertTitle>
      <AlertDescription className="text-sm space-y-2">
        <p>
          As diferenças continuam sendo medidas e somadas no vazamento total, mas nenhuma vira
          chamado. Elas estão listadas abaixo, no bloco recolhido.
        </p>

        <Collapsible>
          <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground text-left underline underline-offset-2">
            Por que está desligada, o que falta para ligar e quem liga
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs text-muted-foreground space-y-2 mt-2 max-w-2xl">
              <p>
                <strong className="text-foreground">Por que está desligada.</strong> A régua
                reconcilia hoje {CALIBRACAO.aderenciaAoCentavo} dos pedidos ao centavo. Abaixo
                disso, um caso acusaria o Mercado Livre de uma diferença que provavelmente é
                nossa — e cada acusação errada gasta a credibilidade do próximo chamado.
              </p>
              <p>
                <strong className="text-foreground">O que falta: a conta pende para o lado
                contrário.</strong> Na janela viva o vazamento líquido é{" "}
                {CALIBRACAO.vazamentoLiquido}, enquanto o lado que acusa mostraria{" "}
                {CALIBRACAO.ladoQueAcusa}. Ligada agora, a fila exibiria crédito a cobrar num
                período que, no total, foi de perda. O que destrava é a medição de aderência
                subir — não o tempo passar.
              </p>
              <p>
                <strong className="text-foreground">Quem liga, e por que não é um botão aqui.</strong>{" "}
                Ligar é alterar a linha de <code className="font-mono">conciliacao_config</code> —
                o campo <code className="font-mono">acusar_valor_a_menor</code> — no banco, por
                quem administra a base, e só depois de refazer a calibração. É um portão de
                evidência, não uma preferência: um interruptor nesta tela faria a decisão depender
                de um clique em vez de uma prova.
              </p>
              <p>
                Os três números acima são a medição da calibração que reprovou o portão, não o
                estado de hoje — os números vivos da janela estão nos cartões e no rodapé.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}
