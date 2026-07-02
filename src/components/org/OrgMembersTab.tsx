import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Trash2, Crown, SlidersHorizontal, RefreshCw, Search, MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { OrgRole } from "@/contexts/OrganizationContext";
import { ViewerPermissionsDialog } from "@/components/org/ViewerPermissionsDialog";

interface Member {
  id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const ROLE_OPTIONS: OrgRole[] = ["admin", "member", "viewer"];

export function OrgMembersTab({ orgId, myRole }: { orgId: string; myRole: OrgRole }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [permsTarget, setPermsTarget] = useState<{ id: string; name: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ userId: string; name: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | OrgRole>("all");

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const load = async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("organization_members")
      .select("id, user_id, role, joined_at")
      .eq("organization_id", orgId);
    if (error) {
      toast({ title: "Erro ao carregar membros", description: error.message, variant: "destructive" });
      setMembers([]);
      setLoading(false);
      return;
    }
    const ids = (rows ?? []).map((r: any) => r.user_id);
    let nameMap = new Map<string, string | null>();
    let avatarMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name ?? null]));
      await Promise.all(
        (profs ?? []).map(async (p: any) => {
          let url: string | null = p.avatar_url ?? null;
          if (url && !url.startsWith("http")) {
            const { data: signed } = await supabase.storage
              .from("avatars")
              .createSignedUrl(url, 3600);
            url = signed?.signedUrl ?? null;
          }
          avatarMap.set(p.id, url);
        })
      );
    }
    const list: Member[] = (rows ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      joined_at: m.joined_at,
      full_name: nameMap.get(m.user_id) ?? null,
      email: null,
      avatar_url: avatarMap.get(m.user_id) ?? null,
    }));
    setMembers(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orgId]);

  const handleRoleChange = async (memberUserId: string, newRole: OrgRole) => {
    setBusyId(memberUserId);
    const { error } = await supabase.functions.invoke("org-member-update-role", {
      body: { organization_id: orgId, user_id: memberUserId, role: newRole },
    });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cargo atualizado" });
      await load();
    }
    setBusyId(null);
  };

  const handleRemove = async (memberUserId: string) => {
    setBusyId(memberUserId);
    const { error } = await supabase.functions.invoke("org-member-remove", {
      body: { organization_id: orgId, user_id: memberUserId },
    });
    if (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Membro removido" });
      await load();
    }
    setBusyId(null);
  };

  const handleTransfer = async (memberUserId: string) => {
    setBusyId(memberUserId);
    const { error } = await supabase.functions.invoke("org-transfer-ownership", {
      body: { organization_id: orgId, new_owner_id: memberUserId },
    });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Propriedade transferida" });
      await load();
    }
    setBusyId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-medium">Membros ({members.length})</CardTitle>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "all" | OrgRole)}>
            <SelectTrigger className="h-9 w-full sm:w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os cargos</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {(() => {
              const q = search.trim().toLowerCase();
              const filtered = members.filter((m) => {
                if (roleFilter !== "all" && m.role !== roleFilter) return false;
                if (!q) return true;
                return (m.full_name ?? "").toLowerCase().includes(q);
              });
              if (filtered.length === 0) {
                return <p className="text-sm text-muted-foreground py-6 text-center">Nenhum membro encontrado.</p>;
              }
              return filtered.map((m) => {
              const isSelf = m.user_id === user?.id;
              const isMemberOwner = m.role === "owner";
              const initials = (m.full_name ?? "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const hasActions = canManage && !isSelf && !isMemberOwner;
              return (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={m.avatar_url ?? undefined} />
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.full_name ?? "Sem nome"} {isSelf && <span className="text-xs text-muted-foreground">(você)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">Membro desde {new Date(m.joined_at).toLocaleDateString("pt-BR")}</p>
                  </div>

                  {isMemberOwner ? (
                    <span className="text-xs font-medium text-primary flex items-center gap-1 shrink-0">
                      <Crown className="w-3.5 h-3.5" /> Owner
                    </span>
                  ) : canManage && !isSelf ? (
                    <Select value={m.role} onValueChange={(v) => handleRoleChange(m.user_id, v as OrgRole)} disabled={busyId === m.user_id}>
                      <SelectTrigger className="h-8 w-28 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground capitalize shrink-0">{m.role}</span>
                  )}

                  {hasActions && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreHorizontal className="w-4 h-4" />
                          <span className="sr-only">Ações do membro</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {m.role === "viewer" && (
                          <DropdownMenuItem
                            onClick={() => setPermsTarget({ id: m.user_id, name: m.full_name ?? "Viewer" })}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 mr-2" /> Acesso
                          </DropdownMenuItem>
                        )}
                        {isOwner && (
                          <>
                            {m.role === "viewer" && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              onClick={() => setTransferTarget({ userId: m.user_id, name: m.full_name ?? "Este membro" })}
                            >
                              <Crown className="w-3.5 h-3.5 mr-2" /> Transferir owner
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setRemoveTarget({ userId: m.user_id, name: m.full_name ?? "Este membro" })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
              });
            })()}
          </div>
        )}
      </CardContent>

      {permsTarget && (
        <ViewerPermissionsDialog
          open={!!permsTarget}
          onOpenChange={(o) => !o && setPermsTarget(null)}
          organizationId={orgId}
          memberUserId={permsTarget.id}
          memberName={permsTarget.name}
        />
      )}

      {/* Transfer ownership dialog */}
      <AlertDialog open={!!transferTarget} onOpenChange={(o) => !o && setTransferTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transferir propriedade?</AlertDialogTitle>
            <AlertDialogDescription>
              Você deixará de ser Owner e passará a ser Admin. {transferTarget?.name ?? "Este membro"} se tornará o novo Owner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (transferTarget) { handleTransfer(transferTarget.userId); setTransferTarget(null); } }}>Transferir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove member dialog */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.name ?? "Este membro"} perderá acesso à organização.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (removeTarget) { handleRemove(removeTarget.userId); setRemoveTarget(null); } }} className="bg-destructive hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}