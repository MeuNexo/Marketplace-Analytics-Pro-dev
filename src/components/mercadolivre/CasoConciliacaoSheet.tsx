import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Gavel,
  ShieldAlert,
  ThumbsDown,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { CasoConciliacaoRow } from "@/hooks/useConciliacao";
import { useCasoDesfecho, type EstadoDesfecho } from "@/hooks/useCasoDesfecho";
import {
  rotuloEstado,
  rotuloMotivo,
  rotuloTipoCaso,
  rotuloUrgencia,
  valorEmReais,
} from "@/lib/casoUrgencia";
import {
  AVISO_CONTESTACAO_CARTAO,
  EXPLICACAO_FATURA_ML,
  EXPLICACAO_MERCADO_PAGO,
  FONTE_FATURA_ML,
  FONTE_MERCADO_PAGO,
  LINHA_PROCEDENCIA_ESPERADO,
  dataEmBR,
  montarDossie,
  textoOuAusente,
} from "@/lib/dossieConciliacao";

// ============================================================================
// 225-05 — O DOSSIÊ da fila "A cobrar do ML" (D-225-12 + D-225-13)
//
// 🔴 O que sai daqui vai para dentro de um chamado do Mercado Livre. Três
// regras governam cada decisão deste arquivo:
//
//   1. CADA NÚMERO DIZ DE ONDE VEIO. A acusação é ML contra ML — o que o
//      Mercado Pago reteve de fato contra o que a fatura do próprio ML declara
//      ter cobrado. As duas fontes aparecem NOMEADAS, lado a lado. Número sem
//      procedência num chamado é número que o suporte devolve.
//
//   2. NENHUMA AÇÃO DE CHAMADO EM CASO NÃO ACIONÁVEL. `acionavel` vem falso da
//      RPC em quase tudo hoje: a régua de valor a menor está desligada por
//      calibração reprovada (55,3% de aderência ao centavo) e a ausência de
//      repasse nasce a verificar — os 5 únicos candidatos em 75 dias eram 5/5
//      contestação de cartão. Quando é falso, os botões de desfecho NÃO são
//      renderizados e a tela nomeia o motivo. D-225-07: o custo de uma
//      acusação falsa não é o valor do caso, é o próximo chamado.
//
//   3. "RESOLVIDO SOZINHO" NUNCA É BOTÃO. É o sistema detectando o repasse que
//      chegou. Se fosse clicável, "o ML pagou porque eu reclamei" e "ia chegar
//      de qualquer jeito" viravam a mesma linha — e essa distinção é a única
//      resposta que D-225-13 produz.
//
// ⚠️ Cor é do PRAZO nesta tela. A diferença em reais é destacada por PESO
// (`text-lg font-bold`), nunca por cor: duas escalas de cor competindo apagam
// o sinal de prazo, que é o propósito do monitor inteiro.
// ============================================================================

const CLASSE_TOM: Record<string, string> = {
  neutro: "text-muted-foreground border-border",
  warning: "text-warning bg-warning/10 border-warning/30",
  success: "text-success bg-success/10 border-success/30",
  destructive: "text-destructive bg-destructive/10 border-destructive/30",
  // Dessaturado e com ícone próprio: "ainda dá tempo" e "não deu mais" não
  // podem parecer a mesma coisa.
  expirado: "text-destructive/70 border-destructive/20 bg-transparent",
};

// ─── Ações do desfecho, no molde `ACTION_META` do `ClaimDetailSheet` ─────────
//
// Os três textos de confirmação são LITERAIS do Copywriting Contract do
// `225-UI-SPEC.md`. Reescrevê-los aqui abriria espaço para a tela prometer uma
// consequência diferente da que o botão executa.

type AcaoDesfecho = "contestar" | "marcar_ganho" | "marcar_negado";

const ACTION_META: Record<
  AcaoDesfecho,
  {
    label: string;
    estado: EstadoDesfecho;
    icon: JSX.Element;
    variant: "destructive" | "outline" | "default";
    confirmTitle: string;
    confirmBody: string;
    success: string;
    exigeValor: boolean;
  }
> = {
  contestar: {
    label: "Marcar como contestado",
    estado: "contestado",
    icon: <Gavel className="w-3.5 h-3.5 mr-1.5" />,
    variant: "outline",
    confirmTitle: "Marcar como contestado?",
    confirmBody:
      "Registra que você abriu o chamado no ML hoje. O prazo de resposta do ML passa a ser acompanhado aqui — não pode ser desfeito.",
    success: "Caso marcado como contestado",
    exigeValor: false,
  },
  marcar_ganho: {
    label: "Marcar como ganho",
    estado: "ganho",
    icon: <Trophy className="w-3.5 h-3.5 mr-1.5" />,
    variant: "outline",
    confirmTitle: "Marcar este caso como ganho?",
    confirmBody:
      "Registra que o ML reembolsou o valor. Confirme o valor recebido antes de continuar — não pode ser desfeito.",
    success: "Caso marcado como ganho",
    exigeValor: true,
  },
  marcar_negado: {
    label: "Marcar como negado",
    estado: "negado",
    icon: <ThumbsDown className="w-3.5 h-3.5 mr-1.5" />,
    variant: "destructive",
    confirmTitle: "Marcar este caso como negado?",
    confirmBody:
      "O ML recusou o reembolso. Isso encerra o caso sem recuperação — não pode ser desfeito.",
    success: "Caso marcado como negado",
    exigeValor: false,
  },
};

/** Estados em que o caso já acabou — nenhuma ação faz sentido. */
const ESTADOS_ENCERRADOS = ["ganho", "negado", "resolvido_sozinho", "expirado"];

async function copiar(texto: string, oQue: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oQue} copiado`);
  } catch {
    // Sem área de transferência (contexto não seguro, permissão negada) a tela
    // DIZ que não copiou. Um toast de sucesso mentiroso faria o usuário colar
    // o conteúdo antigo dentro de um chamado.
    toast.error("Não foi possível copiar — copie manualmente pelo texto na tela.");
  }
}

/**
 * 🔴 Ícone de copiar com rótulo acessível NOMEANDO o campo.
 *
 * Comportamento por breakpoint, direto do UI-SPEC: abaixo de `sm` ele fica
 * SEMPRE visível — hover não existe no celular, e o celular é o dispositivo
 * principal do usuário desta tela. Alvo de toque de 24×24px mesmo com glifo de
 * 12px. Acima de `sm` ele é discreto e aparece no hover ou no foco da linha.
 */
export function BotaoCopiar({ campo, valor }: { campo: string; valor: string }) {
  const copiavel = typeof valor === "string" && valor.trim().length > 0;
  if (!copiavel) return null;
  return (
    <button
      type="button"
      aria-label={`Copiar ${campo}`}
      title={`Copiar ${campo}`}
      onClick={() => copiar(valor, campo)}
      className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-visible:opacity-100"
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

/** Linha de metadado: rótulo, valor monoespaçado e o botão de copiar. */
export function LinhaMeta({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className="group flex items-center justify-between gap-2 py-1"
    >
      <span className="text-xs text-muted-foreground shrink-0">{rotulo}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-xs">{valor}</span>
        <BotaoCopiar campo={rotulo.toLowerCase()} valor={valor} />
      </span>
    </div>
  );
}

/** Uma das duas fontes, nomeada e com o valor copiável isoladamente. */
function ColunaFonte({
  nome,
  explicacao,
  valor,
}: {
  nome: string;
  explicacao: string;
  valor: string;
}) {
  return (
    <div role="group" aria-label={nome} className="group rounded-lg border border-border p-3">
      <p className="text-xs font-semibold text-muted-foreground">{nome}</p>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-base font-semibold">{valor}</span>
        <BotaoCopiar campo={nome} valor={valor} />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{explicacao}</p>
    </div>
  );
}

interface Props {
  caso: CasoConciliacaoRow | null;
  ingestaoInicio: string | null;
  onOpenChange: (aberto: boolean) => void;
}

export function CasoConciliacaoSheet({ caso, ingestaoInicio, onOpenChange }: Props) {
  const { marcarDesfecho, podeEscrever, ocupado } = useCasoDesfecho();
  const [acaoPendente, setAcaoPendente] = useState<AcaoDesfecho | null>(null);
  const [valorRecuperado, setValorRecuperado] = useState("");

  const estado = caso?.estado ?? "aberto";
  const acionavel = caso?.acionavel === true;
  const encerrado = ESTADOS_ENCERRADOS.includes(estado);
  const prazo = rotuloUrgencia(caso?.dias_restantes);
  const tomEstado = rotuloEstado(estado);

  const dossie = useMemo(
    () => (caso ? montarDossie(caso, { ingestaoInicio }) : ""),
    [caso, ingestaoInicio],
  );

  // 🔴 As três condições que fazem um botão de desfecho existir. Faltando
  // qualquer uma, ele NÃO é renderizado — nunca desabilitado, nunca escondido
  // atrás de um erro. Botão que não existe é melhor que botão que falha.
  const acoesDisponiveis: AcaoDesfecho[] = useMemo(() => {
    if (!caso || !acionavel || !podeEscrever || encerrado) return [];
    if (estado === "contestado") return ["marcar_ganho", "marcar_negado"];
    return ["contestar"];
  }, [caso, acionavel, podeEscrever, encerrado, estado]);

  const meta = acaoPendente ? ACTION_META[acaoPendente] : null;

  async function executar(acao: AcaoDesfecho): Promise<void> {
    if (!caso) return;
    const m = ACTION_META[acao];
    try {
      await marcarDesfecho({
        ml_order_id: caso.ml_order_id,
        tipo_caso: caso.tipo_caso,
        estado: m.estado,
        valor_recuperado: m.exigeValor ? emNumero(valorRecuperado) : null,
        valor_diferenca: caso.diferenca,
        data_evento: caso.data_evento,
      });
      toast.success(m.success);
      setAcaoPendente(null);
      setValorRecuperado("");
    } catch (e) {
      // A mensagem original do banco sobe para a tela. Um "algo deu errado"
      // genérico esconderia justamente a policy que recusou a escrita.
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o desfecho.");
    }
  }

  return (
    <Sheet open={caso != null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {caso == null ? null : (
          <>
            {/* ── 1. Cabeçalho fixo ─────────────────────────────────────── */}
            <SheetHeader className="space-y-2 border-b border-border px-5 py-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {rotuloTipoCaso(caso.tipo_caso)}
                </Badge>
                <Badge variant="outline" className={`text-xs ${CLASSE_TOM[tomEstado.tom]}`}>
                  {estado === "expirado" ? (
                    <XCircle className="mr-1 h-3 w-3" />
                  ) : estado === "resolvido_sozinho" || estado === "ganho" ? (
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                  ) : null}
                  {tomEstado.texto}
                </Badge>
              </div>
              <SheetTitle className="text-base font-semibold">
                {textoOuAusente(caso.titulo, "Produto não informado")}
              </SheetTitle>
              {/* Nome acessível do painel: sem ele o Radix abre um diálogo sem
                  descrição e o leitor de tela anuncia só o título do produto. */}
              <SheetDescription className="sr-only">
                Dossiê de conciliação do pedido{" "}
                {textoOuAusente(caso.ml_order_id, "não informado")}: as duas fontes lado a lado,
                os metadados do evento e o registro de desfecho.
              </SheetDescription>
              <div className="group flex items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">
                  {textoOuAusente(caso.ml_order_id, "pedido não informado")}
                </span>
                <BotaoCopiar
                  campo="número do pedido"
                  valor={caso.ml_order_id ?? ""}
                />
              </div>
              {/* O prazo em tamanho grande: é o único número que decide o dia. */}
              <div>
                <Badge
                  variant="outline"
                  className={`gap-1 text-sm ${CLASSE_TOM[prazo.tom]} ${prazo.forte ? "font-bold" : ""}`}
                >
                  {prazo.tom === "expirado" ? (
                    <XCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" />
                  )}
                  {prazo.texto}
                </Badge>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* ── 2. As duas fontes, lado a lado ─────────────────────── */}
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">As duas fontes, lado a lado</h3>
                  <p className="text-xs text-muted-foreground">
                    As duas leituras abaixo são do próprio Mercado Livre. É essa comparação que
                    o chamado precisa mostrar.
                  </p>
                </div>

                {/* 🔴 Empilha abaixo de `sm`: duas colunas de valor em reais não
                    cabem em 375px sem truncar, e valor truncado num dossiê é
                    valor questionável. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColunaFonte
                    nome={FONTE_MERCADO_PAGO}
                    explicacao={EXPLICACAO_MERCADO_PAGO}
                    valor={valorEmReais(caso.retido_de_fato)}
                  />
                  <ColunaFonte
                    nome={FONTE_FATURA_ML}
                    explicacao={EXPLICACAO_FATURA_ML}
                    valor={valorEmReais(caso.cobranca_declarada)}
                  />
                </div>

                {/* Diferença: destaque por PESO, nunca por cor. */}
                <div
                  role="group"
                  aria-label="Diferença apontada"
                  className="group rounded-lg bg-muted/60 p-3"
                >
                  <p className="text-xs font-semibold text-muted-foreground">
                    Diferença apontada
                  </p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="text-lg font-bold">{valorEmReais(caso.diferenca)}</span>
                    <BotaoCopiar campo="diferença" valor={valorEmReais(caso.diferenca)} />
                  </div>
                  {caso.valor_estimado === true ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Valor apresentado como estimativa — a apuração ao centavo ainda não fechou.
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Diferença entre as duas fontes acima: {valorEmReais(caso.residuo_ml)}.
                  </p>
                </div>
              </section>

              <Separator className="my-4" />

              {/* ── A leitura da nossa base, NOMEADA como nossa ────────── */}
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Leitura da nossa base</h3>
                <p className="text-xs text-muted-foreground">
                  Contexto para conferência — a comparação acima não depende dela.
                </p>
                <div className="mt-2">
                  <LinhaMeta rotulo="Esperado" valor={valorEmReais(caso.esperado_nosso)} />
                  <LinhaMeta rotulo="Recebido" valor={valorEmReais(caso.recebido)} />
                  <LinhaMeta
                    rotulo="Diferença contra a nossa base"
                    valor={valorEmReais(caso.residuo_nosso)}
                  />
                </div>
                <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
                  {LINHA_PROCEDENCIA_ESPERADO}
                </p>
              </section>

              <Separator className="my-4" />

              {/* ── 3. Metadados do evento ─────────────────────────────── */}
              <section className="space-y-1">
                <h3 className="text-sm font-semibold">Metadados do evento</h3>
                <div className="mt-2">
                  <LinhaMeta rotulo="SKU" valor={textoOuAusente(caso.sku)} />
                  <LinhaMeta rotulo="Data da venda" valor={dataEmBR(caso.data_pedido)} />
                  <LinhaMeta rotulo="Data do evento" valor={dataEmBR(caso.data_evento)} />
                  <LinhaMeta
                    rotulo="Liberação prevista até"
                    valor={dataEmBR(caso.release_date_max)}
                  />
                </div>

                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">
                    {contarPagamentos(caso.payment_ids, caso.n_pagamentos)}
                  </p>
                  <div className="mt-1">
                    {(caso.payment_ids ?? [])
                      .filter((p) => typeof p === "string" && p.trim().length > 0)
                      .map((p) => (
                        // 🔴 A key é o identificador de pagamento, nunca
                        // `ml_order_id` cru: ele é nulo em entrada que não é
                        // venda e repete em pagamento dividido.
                        <LinhaMeta key={`pgto-${p}`} rotulo="Pagamento" valor={p} />
                      ))}
                  </div>
                </div>
              </section>

              {/* ── O aviso que impede a acusação falsa ────────────────── */}
              {caso.tipo_caso === "repasse_ausente" ? (
                <Alert className="mt-4">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle className="text-sm">Confira no Mercado Pago antes</AlertTitle>
                  <AlertDescription className="text-xs leading-snug">
                    {AVISO_CONTESTACAO_CARTAO}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>

            {/* ── 4. Rodapé de ações ─────────────────────────────────── */}
            <div className="space-y-3 border-t border-border px-5 py-4">
              {/* O caso não acionável NÃO ganha caminho para virar chamado —
                  ganha o motivo, com todas as letras. */}
              {!acionavel && !encerrado ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Este caso ainda não é acionável</AlertTitle>
                  <AlertDescription className="text-xs leading-snug">
                    {rotuloMotivo(caso.motivo, { ingestaoInicio })}
                  </AlertDescription>
                </Alert>
              ) : null}

              {estado === "resolvido_sozinho" ? (
                <p className="py-1 text-center text-xs text-muted-foreground">
                  O ML repassou este valor em {dataEmBR(caso.data_evento)}, sem chamado aberto. O
                  caso foi fechado automaticamente.
                </p>
              ) : null}

              {estado === "expirado" ? (
                <p className="flex items-center justify-center gap-1.5 py-1 text-center text-xs text-destructive/70">
                  <XCircle className="h-3.5 w-3.5" />
                  A janela de ressarcimento deste caso fechou — não há mais o que contestar.
                </p>
              ) : null}

              {estado === "ganho" || estado === "negado" ? (
                <p className="py-1 text-center text-xs text-muted-foreground">
                  Este caso está encerrado — não há ações disponíveis.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {/* Copiar não escreve nada: existe para todo papel. */}
                <Button
                  size="sm"
                  variant={acionavel ? "default" : "outline"}
                  onClick={() => copiar(dossie, "Dossiê")}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copiar dossiê
                </Button>

                {acoesDisponiveis.map((acao) => (
                  <Button
                    key={`acao-${acao}`}
                    size="sm"
                    variant={ACTION_META[acao].variant}
                    disabled={ocupado}
                    onClick={() => setAcaoPendente(acao)}
                  >
                    {ACTION_META[acao].icon}
                    {ACTION_META[acao].label}
                  </Button>
                ))}
              </div>

              {acionavel && !podeEscrever && !encerrado ? (
                <p className="text-[11px] text-muted-foreground">
                  Seu papel nesta organização não registra desfecho de caso. O dossiê continua
                  disponível para cópia.
                </p>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>

      {/* Confirmação de toda transição — todas irreversíveis. */}
      <AlertDialog
        open={acaoPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setAcaoPendente(null);
            setValorRecuperado("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{meta ? meta.confirmTitle : ""}</AlertDialogTitle>
            <AlertDialogDescription>{meta ? meta.confirmBody : ""}</AlertDialogDescription>
          </AlertDialogHeader>

          {meta && meta.exigeValor ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="valor-recuperado">
                Valor que o Mercado Livre reembolsou
              </label>
              <Input
                id="valor-recuperado"
                inputMode="decimal"
                placeholder="0,00"
                value={valorRecuperado}
                onChange={(e) => setValorRecuperado(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Sem este valor não existe resposta para “quanto o ML devolveu de fato”.
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (acaoPendente) executar(acaoPendente);
              }}
              disabled={
                ocupado || (meta != null && meta.exigeValor && !(emNumero(valorRecuperado) > 0))
              }
              className={
                acaoPendente === "marcar_negado"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {ocupado ? "Registrando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/** "1.234,56" ou "1234.56" → número. Devolve NaN quando não dá para ler. */
function emNumero(texto: string): number {
  const limpo = String(texto ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
}

/** Plural certo, e a ausência com todas as letras. */
function contarPagamentos(ids: string[] | null, declarado: number | null): string {
  const lista = Array.isArray(ids)
    ? ids.filter((p) => typeof p === "string" && p.trim().length > 0)
    : [];
  const n = Math.max(
    typeof declarado === "number" && Number.isFinite(declarado) ? Math.trunc(declarado) : 0,
    lista.length,
  );
  if (n <= 0 || lista.length === 0) return "Nenhum pagamento identificado para este pedido.";
  if (n === 1) return "1 pagamento no Mercado Pago:";
  return `${n} pagamentos no Mercado Pago (pagamento dividido):`;
}
