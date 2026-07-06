import { useState } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Send, RefreshCw, ShieldAlert, User, Scale, Store, Package, ExternalLink } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMLClaimMessages } from "@/hooks/useMLClaimMessages";
import { htmlToText } from "@/lib/htmlToText";
import { claimStatusConfig, claimTipoLabel, isClaimOpen } from "@/lib/claimStatus";
import type { MLClaimRow } from "@/hooks/useMLClaims";

// Mapeia o papel do remetente da mensagem para rótulo + alinhamento visual.
function roleView(role: string | null): { label: string; side: "left" | "right" | "center"; icon: React.ReactNode; tone: string } {
  if (role === "respondent") return { label: "Você", side: "right", icon: <Store className="w-3 h-3" />, tone: "bg-primary/10 border-primary/20" };
  if (role === "complainant") return { label: "Comprador", side: "left", icon: <User className="w-3 h-3" />, tone: "bg-muted border-border" };
  if (role === "mediator") return { label: "Mediação ML", side: "center", icon: <Scale className="w-3 h-3" />, tone: "bg-amber-500/10 border-amber-500/20" };
  return { label: role ?? "—", side: "left", icon: <User className="w-3 h-3" />, tone: "bg-muted border-border" };
}

interface Props {
  claim: MLClaimRow | null;
  onOpenChange: (open: boolean) => void;
}

export function ClaimDetailSheet({ claim, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const claimId = claim?.claim_id ?? null;
  const mlUserId = claim?.ml_user_id ?? null;
  const { data: messages = [], isLoading, refetch } = useMLClaimMessages(claimId, mlUserId);

  const open = claim !== null;
  const status = claim ? claimStatusConfig(claim.status) : null;
  const canReply = claim ? isClaimOpen(claim.status) : false;

  async function handleSend() {
    if (!claim || !text.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("reply-ml-claim", {
        body: { claim_id: claim.claim_id, ml_user_id: claim.ml_user_id, text: text.trim() },
      });
      if (error || (data && data.error)) {
        throw new Error(data?.error || error?.message || "Falha ao enviar");
      }
      toast.success("Mensagem enviada ao comprador");
      setText("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["atendimento-pendencias"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível enviar a mensagem");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        {claim && status && (
          <>
            {/* Cabeçalho */}
            <SheetHeader className="px-5 pt-5 pb-4 space-y-3 border-b">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <SheetTitle className="text-base">{claimTipoLabel(claim.tipo)}</SheetTitle>
                <Badge variant="outline" className={status.tone}>{status.label}</Badge>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-start gap-2 text-foreground">
                  <Package className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2">{claim.item_title ?? claim.item_id ?? "Produto não identificado"}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {claim.motivo && <span>Motivo: <span className="text-foreground">{claim.motivo}</span></span>}
                  {claim.order_id && <span>Pedido: <span className="text-foreground font-mono">{claim.order_id}</span></span>}
                  {claim.valor != null && <span>Valor: <span className="text-foreground">{claim.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></span>}
                  {claim.data_abertura && <span>Aberta em {format(parseISO(claim.data_abertura), "dd/MM/yy", { locale: ptBR })}</span>}
                </div>
              </div>
            </SheetHeader>

            {/* Thread de mensagens */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin opacity-40" />
                  <p className="text-xs">Carregando conversa…</p>
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">Nenhuma mensagem nesta reclamação ainda.</p>
              ) : (
                messages.map((m, i) => {
                  const rv = roleView(m.sender_role);
                  const when = m.message_date ?? m.date_created;
                  return (
                    <div key={i} className={`flex ${rv.side === "right" ? "justify-end" : rv.side === "center" ? "justify-center" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl border px-3 py-2 ${rv.tone}`}>
                        <div className="flex items-center gap-1.5 mb-1 text-[11px] font-medium text-muted-foreground">
                          {rv.icon}
                          <span>{rv.label}</span>
                          {when && <span className="font-normal">· {formatDistanceToNow(new Date(when), { addSuffix: true, locale: ptBR })}</span>}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words text-foreground">{htmlToText(m.message)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Caixa de resposta */}
            <Separator />
            <div className="px-5 py-4 space-y-2">
              {canReply ? (
                <>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 2000))}
                    placeholder="Escreva sua resposta ao comprador…"
                    className="min-h-[80px] resize-none text-sm"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{text.length}/2000 · a mensagem vai ao comprador no ML</span>
                    <Button size="sm" disabled={!text.trim() || sending} onClick={() => setConfirming(true)}>
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                      {sending ? "Enviando…" : "Enviar resposta"}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Esta reclamação está encerrada — não é possível enviar novas mensagens.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>

      {/* Confirmação (envio é irreversível) */}
      <AlertDialog open={confirming} onOpenChange={(o) => { if (!o) setConfirming(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar resposta?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem será enviada ao comprador (e ao mediador do ML, se houver) e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">{text}</div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSend(); }} disabled={sending}>
              {sending ? "Enviando…" : "Confirmar envio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
