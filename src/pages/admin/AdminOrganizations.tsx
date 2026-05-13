import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Copy, Check, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/formatters";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  owner_email: string | null;
  member_count: number;
  created_at: string;
}

export default function AdminOrganizations() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createOwnerEmail, setCreateOwnerEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Edit dialog
  const [editTarget, setEditTarget] = useState<OrgRow | null>(null);
  const [editName, setEditName] = useState("");
  const [updating, setUpdating] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<OrgRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("super-admin-orgs", {
      body: { action: "list" },
    });
    if (error) {
      toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
      setOrgs([]);
    } else {
      setOrgs(data?.orgs ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) =>
      o.name.toLowerCase().includes(q) ||
      o.slug.toLowerCase().includes(q) ||
      (o.owner_email ?? "").toLowerCase().includes(q),
    );
  }, [orgs, search]);

  async function handleCreate() {
    if (!createName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("super-admin-orgs", {
      body: {
        action: "create",
        name: createName.trim(),
        owner_email: createOwnerEmail.trim() || undefined,
      },
    });
    setCreating(false);
    if (error || data?.error) {
      toast({ title: "Erro ao criar", description: data?.error ?? error?.message, variant: "destructive" });
      return;
    }
    setCreatedInviteUrl(data?.invite_url ?? null);
    load();
  }

  function handleCloseCreate() {
    setCreateOpen(false);
    setCreatedInviteUrl(null);
    setCopiedInvite(false);
    setCreateName("");
    setCreateOwnerEmail("");
  }

  async function handleCopyInvite() {
    if (!createdInviteUrl) return;
    await navigator.clipboard.writeText(createdInviteUrl);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  }

  async function handleUpdate() {
    if (!editTarget || !editName.trim()) return;
    setUpdating(true);
    const { error } = await supabase.functions.invoke("super-admin-orgs", {
      body: { action: "update", org_id: editTarget.id, name: editName.trim() },
    });
    setUpdating(false);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Organização atualizada" });
    setEditTarget(null);
    load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.functions.invoke("super-admin-orgs", {
      body: { action: "delete", org_id: deleteTarget.id },
    });
    setDeleting(false);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Organização excluída" });
    setDeleteTarget(null);
    load();
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie todas as organizações do sistema.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> Nova organização
        </Button>
      </header>

      <div className="relative mb-4 max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b border-border">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Nome</th>
              <th className="px-4 py-2.5 font-medium">Slug</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
              <th className="px-4 py-2.5 font-medium">Membros</th>
              <th className="px-4 py-2.5 font-medium">Criada em</th>
              <th className="px-4 py-2.5 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-3" colSpan={6}><Skeleton className="h-5 w-full" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma organização encontrada.</td></tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{o.slug}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.owner_email ?? <span className="italic">—</span>}</td>
                  <td className="px-4 py-3"><Badge variant="secondary">{o.member_count}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditTarget(o); setEditName(o.name); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(o)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) handleCloseCreate(); }}>
        <DialogContent>
          {!createdInviteUrl ? (
            <>
              <DialogHeader>
                <DialogTitle>Nova organização</DialogTitle>
                <DialogDescription>
                  O slug é gerado automaticamente. Informe o email do owner para gerar um link de acesso.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="create-name">Nome</Label>
                  <Input id="create-name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Acme Comércio" />
                </div>
                <div>
                  <Label htmlFor="create-owner">Email do owner (opcional)</Label>
                  <Input id="create-owner" type="email" value={createOwnerEmail} onChange={(e) => setCreateOwnerEmail(e.target.value)} placeholder="owner@empresa.com" />
                  <p className="text-[11px] text-muted-foreground mt-1">Um link de convite será gerado para você compartilhar. Expira em 30 dias.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreate} disabled={creating}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                  {creating ? "Criando..." : "Criar"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Organização criada</DialogTitle>
                <DialogDescription>
                  Compartilhe o link abaixo com o owner. Ele poderá criar sua senha e acessar a organização.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm font-mono text-foreground">{createdInviteUrl}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={handleCopyInvite}
                  >
                    {copiedInvite
                      ? <Check className="h-4 w-4 text-emerald-500" />
                      : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Este link expira em 30 dias. Você pode revogar o convite a qualquer momento na aba de membros da organização.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={handleCloseCreate}>Fechar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="edit-name">Nome</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={updating}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updating || !editName.trim()}>
              {updating ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir organização?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá permanentemente <strong>{deleteTarget?.name}</strong> e todos os dados vinculados (membros, sellers, integrações, caches). Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}