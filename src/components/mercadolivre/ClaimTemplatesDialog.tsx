import { useState } from "react";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useClaimTemplates, type ClaimTemplate } from "@/hooks/useClaimTemplates";
import { applyTemplate } from "@/lib/applyTemplate";

const VARIABLES = ["{{nome}}", "{{produto}}", "{{pedido}}"];

interface ClaimVars {
  nome: string;
  produto: string;
  pedido: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimVars: ClaimVars;
}

export function ClaimTemplatesDialog({ open, onOpenChange, claimVars }: Props) {
  const { templates, isLoading, create, update, remove, isMutating } = useClaimTemplates();
  const [editing, setEditing] = useState<ClaimTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ClaimTemplate | null>(null);

  const editorOpen = creating || editing !== null;

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setTitle("");
    setBody("");
  }

  function startEdit(t: ClaimTemplate) {
    setCreating(false);
    setEditing(t);
    setTitle(t.title);
    setBody(t.body);
  }

  function closeEditor() {
    setCreating(false);
    setEditing(null);
    setTitle("");
    setBody("");
  }

  async function handleSave() {
    if (!title.trim() || !body.trim()) return;
    try {
      if (editing) {
        await update(editing.id, title, body);
        toast.success("Modelo atualizado");
      } else {
        await create(title, body);
        toast.success("Modelo criado");
      }
      closeEditor();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar o modelo");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      toast.success("Modelo apagado");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível apagar o modelo");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) closeEditor(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gerenciar modelos</DialogTitle>
            <DialogDescription>
              Modelos de resposta compartilhados por toda a loja. Use as variáveis abaixo — elas são
              preenchidas automaticamente com os dados da reclamação ao usar o modelo.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {VARIABLES.map((v) => (
              <Badge key={v} variant="outline" className="font-mono text-[11px]">{v}</Badge>
            ))}
          </div>

          <Separator />

          {editorOpen ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="template-title">Título</Label>
                <Input
                  id="template-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Pedido de devolução aceito"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-body">Mensagem</Label>
                <Textarea
                  id="template-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Olá {{nome}}, sobre o pedido {{pedido}} do produto {{produto}}…"
                  className="min-h-[100px] text-sm"
                />
              </div>
              {body.trim() && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Prévia com esta reclamação</Label>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                    {applyTemplate(body, claimVars)}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeEditor} disabled={isMutating}>
                  <X className="w-3.5 h-3.5 mr-1.5" />Cancelar
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isMutating || !title.trim() || !body.trim()}>
                  {isMutating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  {editing ? "Salvar alterações" : "Criar modelo"}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={startCreate} className="w-fit">
              <Plus className="w-3.5 h-3.5 mr-1.5" />Novo modelo
            </Button>
          )}

          <Separator />

          <div className="space-y-2">
            {isLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum modelo criado ainda.</p>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.body}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => startEdit(t)} title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(t)}
                    title="Apagar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar modelo "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível e o modelo deixa de estar disponível para toda a loja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isMutating ? "Apagando…" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
