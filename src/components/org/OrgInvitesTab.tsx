import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Mail, Trash2, Copy, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { OrgRole } from "@/contexts/OrganizationContext";

interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function OrgInvitesTab({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("organization_invites")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    setInvites((data as Invite[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orgId]);

  const handleCreate = async () => {
    if (!email.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("org-invite-create", {
      body: { organization_id: orgId, email: email.trim().toLowerCase(), role },
    });
    if (error || !data?.ok) {
      toast({ title: "Erro", description: data?.error ?? error?.message ?? "", variant: "destructive" });
    } else {
      toast({
        title: "Convite criado",
        description: "Compartilhe o link gerado abaixo com o convidado.",
      });
      setEmail("");
      if (data.invite_url) {
        await navigator.clipboard.writeText(data.invite_url);
      }
      await load();
    }
    setCreating(false);
  };

  const handleRevoke = async (id: string) => {
    const { error } = await supabase
      .from("organization_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Convite revogado" }); await load(); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("organization_invites")
      .delete()
      .eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Convite apagado" }); await load(); }
  };

  const statusOf = (inv: Invite) => {
    if (inv.accepted_at) return { label: "Aceito", className: "text-emerald-500" };
    if (inv.revoked_at) return { label: "Revogado", className: "text-muted-foreground" };
    if (new Date(inv.expires_at) < new Date()) return { label: "Expirado", className: "text-destructive" };
    return { label: "Pendente", className: "text-amber-500" };
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Convidar novo membro</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-3 items-end">
            <div className="flex-1 space-y-2 w-full">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" placeholder="pessoa@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2 w-full md:w-40">
              <Label>Cargo</Label>
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreate} disabled={creating || !email.trim()} className="w-full md:w-auto">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
              Enviar convite
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Um link de convite será copiado para sua área de transferência. Convites expiram em 7 dias.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Convites ({invites.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum convite emitido.</p>
          ) : (
            <div className="space-y-2">
              {invites.map((inv) => {
                const status = statusOf(inv);
                const isPending = !inv.accepted_at && !inv.revoked_at && new Date(inv.expires_at) >= new Date();
                return (
                  <div key={inv.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{inv.email}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {inv.role} · expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <span className={`text-xs font-medium ${status.className}`}>{status.label}</span>
                    {isPending && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={async () => {
                            const url = `${window.location.origin}/aceitar-convite?token=${inv.id}`;
                            await navigator.clipboard.writeText(url);
                            setCopiedId(inv.id);
                            setTimeout(() => setCopiedId(null), 2000);
                          }}
                          title="Copiar link parcial (token completo só na criação)"
                        >
                          {copiedId === inv.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-muted"
                          onClick={() => handleRevoke(inv.id)}
                          title="Revogar convite"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Apagar convite"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Apagar convite permanentemente?</AlertDialogTitle>
                          <AlertDialogDescription asChild>
                            <div className="space-y-3">
                              <p>
                                Esta ação é <span className="font-semibold text-destructive">irreversível</span>.
                                O convite enviado para{" "}
                                <span className="font-medium text-foreground">{inv.email}</span> será apagado do
                                histórico desta organização.
                              </p>
                              <ul className="text-xs space-y-1 list-disc pl-4 text-muted-foreground">
                                <li>O registro deste convite some da lista — não fica como "Revogado".</li>
                                {isPending && <li>O link já compartilhado deixará de funcionar imediatamente.</li>}
                                <li>Para conceder acesso novamente será necessário emitir um novo convite.</li>
                              </ul>
                              <p className="text-xs text-muted-foreground">
                                Se você só quer impedir o uso do link mantendo o histórico, prefira{" "}
                                <span className="font-medium">Revogar</span>.
                              </p>
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(inv.id)} className="bg-destructive hover:bg-destructive/90">
                            Apagar permanentemente
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}