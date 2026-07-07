import { useRef, useState } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Send, RefreshCw, ShieldAlert, User, Scale, Store, Package, Banknote, Gavel, PackageCheck, FileText, Settings2, Paperclip, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMLClaimDetail } from "@/hooks/useMLClaimMessages";
import { useClaimTemplates } from "@/hooks/useClaimTemplates";
import { ClaimTemplatesDialog } from "@/components/mercadolivre/ClaimTemplatesDialog";
import { ClaimAttachment } from "@/components/mercadolivre/ClaimAttachment";
import { useClaimAttachmentUpload } from "@/hooks/useClaimAttachmentUpload";
import { applyTemplate } from "@/lib/applyTemplate";
import { htmlToText } from "@/lib/htmlToText";
import { claimStatusConfig, claimTipoLabel, isClaimOpen } from "@/lib/claimStatus";
import type { MLClaimRow } from "@/hooks/useMLClaims";

function roleView(role: string | null): { label: string; side: "left" | "right" | "center"; icon: React.ReactNode; tone: string } {
  if (role === "respondent") return { label: "Você", side: "right", icon: <Store className="w-3 h-3" />, tone: "bg-primary/10 border-primary/20" };
  if (role === "complainant") return { label: "Comprador", side: "left", icon: <User className="w-3 h-3" />, tone: "bg-muted border-border" };
  if (role === "mediator") return { label: "Mediação ML", side: "center", icon: <Scale className="w-3 h-3" />, tone: "bg-amber-500/10 border-amber-500/20" };
  return { label: role ?? "—", side: "left", icon: <User className="w-3 h-3" />, tone: "bg-muted border-border" };
}

// Ações do vendedor: rótulo, ícone, tom e texto de confirmação (consequência).
type ActionKind = "refund" | "open_dispute" | "allow_return";
const ACTION_META: Record<ActionKind, { label: string; icon: React.ReactNode; variant: "destructive" | "outline"; confirmTitle: string; confirmBody: string; success: string }> = {
  refund: {
    label: "Reembolsar comprador", icon: <Banknote className="w-3.5 h-3.5 mr-1.5" />, variant: "destructive",
    confirmTitle: "Reembolsar o comprador?",
    confirmBody: "O valor será devolvido ao comprador e a reclamação será encerrada a favor dele. Esta ação é irreversível.",
    success: "Reembolso solicitado ao Mercado Livre",
  },
  allow_return: {
    label: "Autorizar devolução", icon: <PackageCheck className="w-3.5 h-3.5 mr-1.5" />, variant: "outline",
    confirmTitle: "Autorizar a devolução?",
    confirmBody: "O comprador receberá as instruções para devolver o produto. Após o retorno, o reembolso é processado. Esta ação é irreversível.",
    success: "Devolução autorizada",
  },
  open_dispute: {
    label: "Acionar o Mercado Livre", icon: <Gavel className="w-3.5 h-3.5 mr-1.5" />, variant: "outline",
    confirmTitle: "Abrir disputa no Mercado Livre?",
    confirmBody: "A decisão passa para a mediação do Mercado Livre analisar o caso. Use quando não houver acordo com o comprador. Esta ação é irreversível.",
    success: "Disputa aberta no Mercado Livre",
  },
};

// Anexo em upload na caixa de resposta: um item por arquivo selecionado.
// `filename` é o nome gerado pelo ML (passado ao reply-ml-claim quando "done").
type UploadItem = {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  filename?: string;
  error?: string;
};

interface Props {
  claim: MLClaimRow | null;
  onOpenChange: (open: boolean) => void;
}

export function ClaimDetailSheet({ claim, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [attachments, setAttachments] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useClaimAttachmentUpload();

  // Enviar fica bloqueado enquanto QUALQUER anexo ainda estiver subindo.
  const anyUploading = attachments.some((a) => a.status === "uploading");

  const claimId = claim?.claim_id ?? null;
  const mlUserId = claim?.ml_user_id ?? null;
  const { data: detail, isLoading, refetch } = useMLClaimDetail(claimId, mlUserId);
  const { templates } = useClaimTemplates();

  // Variáveis de substituição ({{nome}}/{{produto}}/{{pedido}}) para o modelo escolhido
  // e para a prévia do dialog "Gerenciar modelos" — sempre os dados da reclamação atual.
  const templateVars = {
    nome: detail?.buyer_first_name ?? "cliente",
    produto: claim?.item_title ?? claim?.item_id ?? "",
    pedido: claim?.order_id ?? "",
  };

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (template) setText(applyTemplate(template.body, templateVars));
  }

  const open = claim !== null;
  const status = claim ? claimStatusConfig(claim.status) : null;

  const actions = detail?.available_actions ?? [];
  const actionsKnown = !isLoading && detail !== undefined;
  const canRefund = actions.includes("refund");
  const canDispute = actions.includes("open_dispute");
  const canAllowReturn = actions.includes("allow_return");
  const hasActions = canRefund || canDispute || canAllowReturn;
  // Mensagem: se o ML lista o envio (ao comprador ou mediador); senão cai pro status.
  const canMessage = actions.includes("send_message_to_complainant")
    || actions.includes("send_message_to_mediator")
    || (actionsKnown && actions.length === 0 && claim ? isClaimOpen(claim.status) : false);

  const motivo = detail?.reason?.detail ?? claim?.motivo_texto ?? null;

  async function afterMutation() {
    await refetch();
    qc.invalidateQueries({ queryKey: ["atendimento-pendencias"] });
    qc.invalidateQueries({ queryKey: ["ml_claims"] });
  }

  // Seleção de arquivos: cada um vira um chip e sobe via a EF de upload.
  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // limpa p/ permitir re-selecionar o mesmo arquivo
    if (!claim || files.length === 0) return;
    for (const file of files) {
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [...prev, { id, name: file.name, status: "uploading" }]);
      try {
        const { filename } = await uploadFile(file, claim.claim_id, claim.ml_user_id);
        setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "done", filename } : a)));
      } catch (err: any) {
        const msg = err?.message ?? "Falha ao enviar o anexo";
        setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "error", error: msg } : a)));
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSend() {
    if (!claim || !text.trim()) return;
    setBusy(true);
    try {
      const filenames = attachments
        .filter((a) => a.status === "done" && a.filename)
        .map((a) => a.filename as string);
      const body: { claim_id: string; ml_user_id: string; text: string; attachments?: string[] } = {
        claim_id: claim.claim_id,
        ml_user_id: claim.ml_user_id,
        text: text.trim(),
      };
      if (filenames.length > 0) body.attachments = filenames;
      const { data, error } = await supabase.functions.invoke("reply-ml-claim", { body });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Falha ao enviar");
      toast.success("Mensagem enviada ao comprador");
      setText("");
      setAttachments([]);
      await afterMutation();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível enviar a mensagem");
    } finally {
      setBusy(false);
      setConfirmingSend(false);
    }
  }

  async function handleAction(action: ActionKind) {
    if (!claim) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ml-claim-action", {
        body: { claim_id: claim.claim_id, ml_user_id: claim.ml_user_id, action },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Falha na ação");
      toast.success(ACTION_META[action].success);
      await afterMutation();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível concluir a ação");
    } finally {
      setBusy(false);
      setPendingAction(null);
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
                {motivo && (
                  <p className="text-xs text-muted-foreground">
                    Motivo: <span className="text-foreground">{motivo}</span>
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {claim.order_id && <span>Pedido: <span className="text-foreground font-mono">{claim.order_id}</span></span>}
                  {claim.valor != null && <span>Valor: <span className="text-foreground">{claim.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span></span>}
                  {claim.data_abertura && <span>Aberta em {format(parseISO(claim.data_abertura), "dd/MM/yy", { locale: ptBR })}</span>}
                </div>
              </div>
            </SheetHeader>

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin opacity-40" />
                  <p className="text-xs">Carregando conversa…</p>
                </div>
              ) : (detail?.messages.length ?? 0) === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">Nenhuma mensagem nesta reclamação ainda.</p>
              ) : (
                detail!.messages.map((m, i) => {
                  const rv = roleView(m.sender_role);
                  const when = m.message_date ?? m.date_created;
                  return (
                    <div key={i} className={`flex ${rv.side === "right" ? "justify-end" : rv.side === "center" ? "justify-center" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl border px-3 py-2 ${rv.tone}`}>
                        <div className="flex items-center gap-1.5 mb-1 text-[11px] font-medium text-muted-foreground">
                          {rv.icon}<span>{rv.label}</span>
                          {when && <span className="font-normal">· {formatDistanceToNow(new Date(when), { addSuffix: true, locale: ptBR })}</span>}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words text-foreground">{htmlToText(m.message)}</p>
                        {/* Anexos da mensagem (Phase 92): imagem→thumb+zoom ATTACH-01 / arquivo→Baixar ATTACH-02 */}
                        {m.attachments?.length ? (
                          <div className="mt-2 space-y-1.5">
                            {m.attachments.map((att) => (
                              <ClaimAttachment
                                key={att.id}
                                attachment={att}
                                claimId={claimId!}
                                mlUserId={mlUserId!}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Ações + resposta */}
            <Separator />
            <div className="px-5 py-4 space-y-3">
              {/* Botões de decisão (só os que o ML permite p/ esta reclamação) */}
              {hasActions && (
                <div className="flex flex-wrap gap-2">
                  {canAllowReturn && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingAction("allow_return")}>
                      {ACTION_META.allow_return.icon}{ACTION_META.allow_return.label}
                    </Button>
                  )}
                  {canRefund && (
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => setPendingAction("refund")}>
                      {ACTION_META.refund.icon}{ACTION_META.refund.label}
                    </Button>
                  )}
                  {canDispute && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingAction("open_dispute")}>
                      {ACTION_META.open_dispute.icon}{ACTION_META.open_dispute.label}
                    </Button>
                  )}
                </div>
              )}

              {/* Caixa de resposta */}
              {canMessage ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedTemplateId}
                      onValueChange={handleTemplateSelect}
                      disabled={templates.length === 0}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <FileText className="w-3.5 h-3.5 mr-1.5 shrink-0 opacity-60" />
                        <SelectValue placeholder={templates.length === 0 ? "Nenhum modelo criado ainda" : "Usar modelo…"} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">{t.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs shrink-0"
                      onClick={() => setTemplatesDialogOpen(true)}
                    >
                      <Settings2 className="w-3.5 h-3.5 mr-1.5" />Gerenciar modelos
                    </Button>
                  </div>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 2000))}
                    placeholder="Escreva sua resposta ao comprador…"
                    className="min-h-[80px] resize-none text-sm"
                  />
                  {/* Chips dos anexos em upload (um por arquivo: enviando/ok/erro + remover) */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs max-w-[200px]"
                          title={att.status === "error" ? att.error : att.name}
                        >
                          {att.status === "uploading" && <Loader2 className="w-3 h-3 shrink-0 animate-spin text-muted-foreground" />}
                          {att.status === "done" && <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-600" />}
                          {att.status === "error" && <AlertCircle className="w-3 h-3 shrink-0 text-destructive" />}
                          <span className={`truncate ${att.status === "error" ? "text-destructive" : "text-foreground"}`}>{att.name}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            aria-label={`Remover ${att.name}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Motivo do erro visível inline (não só no tooltip) — o usuário
                      precisa saber POR QUE o anexo falhou (tipo/tamanho/ML). */}
                  {attachments.some((a) => a.status === "error") && (
                    <p className="text-[11px] leading-snug text-destructive">
                      {attachments
                        .filter((a) => a.status === "error")
                        .map((a) => `${a.name}: ${a.error ?? "falha ao enviar"}`)
                        .join(" · ")}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        multiple
                        className="hidden"
                        onChange={handleFilesSelected}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 shrink-0"
                        disabled={busy}
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Anexar arquivo (JPG, PNG ou PDF)"
                        title="Anexar arquivo (JPG, PNG ou PDF)"
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <span className="text-[11px] text-muted-foreground truncate">{text.length}/2000 · vai ao comprador no ML</span>
                    </div>
                    <Button size="sm" className="shrink-0" disabled={!text.trim() || busy || anyUploading} onClick={() => setConfirmingSend(true)}>
                      <Send className="w-3.5 h-3.5 mr-1.5" />{busy ? "Enviando…" : "Enviar resposta"}
                    </Button>
                  </div>
                </div>
              ) : actionsKnown && !hasActions ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Esta reclamação está encerrada — não há ações disponíveis.
                </p>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>

      {/* Confirmar envio de mensagem */}
      <AlertDialog open={confirmingSend} onOpenChange={(o) => { if (!o) setConfirmingSend(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar resposta?</AlertDialogTitle>
            <AlertDialogDescription>A mensagem será enviada ao comprador (e ao mediador, se houver) e não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto">{text}</div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSend(); }} disabled={busy}>
              {busy ? "Enviando…" : "Confirmar envio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar ação (refund / open_dispute) */}
      <AlertDialog open={pendingAction !== null} onOpenChange={(o) => { if (!o) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction ? ACTION_META[pendingAction].confirmTitle : ""}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction ? ACTION_META[pendingAction].confirmBody : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (pendingAction) handleAction(pendingAction); }}
              disabled={busy}
              className={pendingAction === "refund" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {busy ? "Processando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Gerenciar modelos ("mensagens rápidas") */}
      <ClaimTemplatesDialog
        open={templatesDialogOpen}
        onOpenChange={setTemplatesDialogOpen}
        claimVars={templateVars}
      />
    </Sheet>
  );
}
