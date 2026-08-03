import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { createOrganization, slugify } from "@/lib/createOrganization";

// Tela de autosserviço que fecha o SEC-09. Molde de AcceptInvite.tsx: usa
// useAuth/useOrganization direto, sem depender do ProtectedRoute (que hoje
// redireciona PARA cá quem está autenticado sem organização — colocar esta
// tela dentro do guarda a tornaria inalcançável para o público que ela
// existe para atender). O único guarda daqui é "existe usuário autenticado?".
export default function CreateOrganization() {
  const { user, loading: authLoading } = useAuth();
  const { refreshOrgs } = useOrganization();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleNomeChange = (value: string) => {
    setNome(value);
    if (!slugEditedManually) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlugEditedManually(true);
    setSlug(value);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);

    const result = await createOrganization(supabase, {
      nome,
      slug,
      userId: user.id,
    });

    if (!result.ok) {
      toast({
        title: `Falha ao criar organização (passo: ${result.error.step})`,
        description: result.error.recoverable
          ? `${result.error.message} Tente novamente — os dados já criados não serão duplicados.`
          : result.error.message,
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    // A navegação só acontece DEPOIS de refreshOrgs() ter atualizado o
    // contexto. Se navegasse antes, o ProtectedRoute veria "autenticado sem
    // organização" na primeira renderização em "/" e mandaria de volta para
    // cá — mesma corrida descrita no comentário de effectiveLoading em
    // OrganizationContext.tsx.
    await refreshOrgs();
    setSubmitting(false);
    navigate("/");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <Building2 className="w-10 h-10 text-primary mx-auto" />
          <h1 className="text-2xl font-semibold tracking-tight">Criar organização</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não pertence a nenhuma organização. Crie a sua para continuar.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-nome">Nome</Label>
          <Input
            id="org-nome"
            value={nome}
            onChange={(e) => handleNomeChange(e.target.value)}
            placeholder="Nome da organização"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-slug">Slug</Label>
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="identificador-da-organizacao"
          />
          <p className="text-xs text-muted-foreground">Identificador único usado em URLs e referências internas.</p>
        </div>

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={submitting || !nome.trim() || !slug.trim()}
        >
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Criar organização
        </Button>
      </div>
    </div>
  );
}
