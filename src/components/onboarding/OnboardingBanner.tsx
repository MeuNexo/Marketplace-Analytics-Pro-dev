import { useState } from "react";
import { Rocket, X, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOnboardingProgress, ONBOARDING_STEPS } from "@/hooks/useOnboardingProgress";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export interface OnboardingBannerProps {
  /** Força a exibição mesmo quando o onboarding parece completo (ex.: !hasMLConnection). */
  forceShow?: boolean;
}

// Banner compacto e NÃO-bloqueante no topo do dashboard (D-07).
// Aparece quando o onboarding está incompleto (ou forceShow). É dispensável
// (botão fechar, por sessão) e nunca trava a navegação — apenas abre o wizard.
export function OnboardingBanner({ forceShow = false }: OnboardingBannerProps) {
  const { orgRole } = useOrganization();
  const { completedSteps, isComplete, loading } = useOnboardingProgress();
  const [dismissed, setDismissed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const totalSteps = ONBOARDING_STEPS.length;
  const completedCount = completedSteps.length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  // Só para owner; só quando incompleto (ou forçado); some quando dispensado.
  const shouldShow = orgRole === "owner" && !loading && !dismissed && (forceShow || !isComplete);
  if (!shouldShow) return null;

  return (
    <>
      <Card className="border-primary/30 bg-[hsl(var(--sidebar-accent))]/40 shadow-[var(--shadow-glow)]">
        <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5">
            <Rocket className="h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold leading-none">Configure sua conta</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {completedCount} de {totalSteps} passos concluídos — conecte o Mercado Livre e cadastre custos para ver dados reais.
              </p>
            </div>
          </div>

          <div className="flex flex-1 items-center gap-3 sm:justify-end">
            <Progress value={progressPct} className="h-2 w-full max-w-[160px]" />
            <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setWizardOpen(true)}>
              Continuar configuração
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDismissed(true)}
              aria-label="Dispensar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <OnboardingWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  );
}
