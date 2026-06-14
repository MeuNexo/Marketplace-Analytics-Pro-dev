import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { validatePassword } from "@/utils/passwordValidation";
import { PasswordStrengthIndicator } from "@/components/auth/PasswordStrengthIndicator";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading: authLoading } = useAuth();
  const { refreshOrgs } = useOrganization();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<"loading" | "needs-password" | "needs-login" | "ready" | "wrong-user" | "done" | "error">("loading");
  const [invite, setInvite] = useState<{ email: string; orgName: string; role: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setErrorMsg("Token de convite ausente.");
      setStep("error");
      return;
    }
    if (authLoading) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke("org-invite-accept", {
        body: { token, mode: "preview" },
      });
      if (error || !data?.ok) {
        setErrorMsg(data?.error ?? error?.message ?? "Convite inválido ou expirado.");
        setStep("error");
        return;
      }
      setInvite({ email: data.email, orgName: data.organization_name, role: data.role });
      if (!user) {
        setStep(data.user_exists ? "needs-login" : "needs-password");
      } else if (user.email?.toLowerCase() !== data.email.toLowerCase()) {
        setStep("wrong-user");
      } else {
        setStep("ready");
      }
    })();
  }, [token, authLoading, user]);

  const handleSwitchAccount = async () => {
    await supabase.auth.signOut();
    // After sign-out the effect re-runs; user becomes null and we re-enter needs-password / needs-login.
  };

  const handleAccept = async () => {
    setSubmitting(true);
    const body: any = { token, mode: "accept" };
    if (step === "needs-password") {
      const v = validatePassword(password);
      if (!v.isValid) {
        toast({ title: "Senha inválida", description: v.errors[0], variant: "destructive" });
        setSubmitting(false);
        return;
      }
      body.password = password;
    }
    const { data, error } = await supabase.functions.invoke("org-invite-accept", { body });
    if (error || !data?.ok) {
      toast({
        title: "Não foi possível aceitar o convite",
        description: data?.error ?? error?.message ?? "Tente novamente.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }
    if (data.session) {
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
    await refreshOrgs();
    setStep("done");
    setSubmitting(false);
    // TENANT-04 / D-07: owner novo é levado ao dashboard "/", onde o
    // OnboardingBanner não-bloqueante aparece automaticamente quando o
    // onboarding está incompleto (sem ML conectado). Nenhum route-guard
    // bloqueante é criado — a navegação permanece livre.
    setTimeout(() => navigate("/"), 1500);
  };

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-semibold">Convite aceito!</h1>
          <p className="text-sm text-muted-foreground">Redirecionando…</p>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Convite inválido</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
          <Button variant="outline" onClick={() => navigate("/login")}>Voltar ao login</Button>
        </div>
      </div>
    );
  }

  if (step === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (step === "needs-login") {
    // Redirect to login carrying the token forward
    return <Navigate to={`/login?invite=${encodeURIComponent(token)}`} replace />;
  }

  if (step === "wrong-user") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-semibold">Conta diferente</h1>
          <p className="text-sm text-muted-foreground">
            Este convite é para <span className="font-medium text-foreground">{invite?.email}</span>, mas você está logado como <span className="font-medium text-foreground">{user?.email}</span>.
          </p>
          <p className="text-xs text-muted-foreground">Saia da conta atual para criar uma nova ou entrar com o email convidado.</p>
          <Button className="w-full" onClick={handleSwitchAccount}>Sair e continuar</Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <Mail className="w-10 h-10 text-primary mx-auto" />
          <h1 className="text-2xl font-semibold tracking-tight">Aceitar convite</h1>
          <p className="text-sm text-muted-foreground">
            Você foi convidado(a) para <span className="font-medium text-foreground">{invite?.orgName}</span> como{" "}
            <span className="font-medium text-foreground capitalize">{invite?.role}</span>.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={invite?.email ?? ""} disabled />
        </div>

        {step === "needs-password" && (
          <div className="space-y-2">
            <Label htmlFor="password">Crie uma senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <PasswordStrengthIndicator password={password} />
          </div>
        )}

        <Button className="w-full" onClick={handleAccept} disabled={submitting}>
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {step === "needs-password" ? "Criar conta e entrar" : "Aceitar convite"}
        </Button>
      </div>
    </div>
  );
}