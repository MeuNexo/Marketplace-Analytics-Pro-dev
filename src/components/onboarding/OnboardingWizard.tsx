import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Plug, Boxes, DollarSign, Receipt, PartyPopper, ArrowRight, SkipForward } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  useOnboardingProgress,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from "@/hooks/useOnboardingProgress";

// ─── Definicao dos passos (D-08) ────────────────────────────────────────────────
// Ordem: Conectar ML -> Tiny (opcional) -> Custos -> Fiscal -> Pronto.
// Cada passo aponta para a rota existente correspondente.
interface StepDef {
  key: OnboardingStep;
  title: string;
  description: string;
  route: string;
  cta: string;
  optional?: boolean;
  icon: typeof Plug;
}

const STEP_DEFS: StepDef[] = [
  {
    key: "connect_ml",
    title: "Conectar Mercado Livre",
    description: "Autorize sua conta do Mercado Livre para sincronizar vendas, anúncios e reputação.",
    route: "/integracoes",
    cta: "Ir para Integrações",
    icon: Plug,
  },
  {
    key: "tiny",
    title: "Conectar Tiny ERP (opcional)",
    description: "Integre o Tiny para importar custos de produto automaticamente. Você pode pular e cadastrar custos manualmente.",
    route: "/integracoes",
    cta: "Conectar Tiny",
    optional: true,
    icon: Boxes,
  },
  {
    key: "costs",
    title: "Cadastrar custos",
    description: "Informe o custo dos produtos para calcular margem e lucro real por anúncio.",
    route: "/precos-custos",
    cta: "Ir para Preços e Custos",
    icon: DollarSign,
  },
  {
    key: "fiscal",
    title: "Configurar regime fiscal",
    description: "Defina o regime tributário de cada loja para calcular os impostos automaticamente.",
    route: "/precos-custos",
    cta: "Configurar regime fiscal",
    icon: Receipt,
  },
];

interface OnboardingWizardForm {
  /** Passo focado no wizard (controlado por rhf). */
  focusedStep: OnboardingStep;
}

export interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingWizard({ open, onOpenChange }: OnboardingWizardProps) {
  const navigate = useNavigate();
  const { orgRole } = useOrganization();
  const { currentStep, completedSteps, isComplete, completeStep } = useOnboardingProgress();

  // Estado do passo focado via react-hook-form (D-09).
  const form = useForm<OnboardingWizardForm>({
    defaultValues: { focusedStep: currentStep },
  });
  const focusedStep = form.watch("focusedStep");

  // Mantém o passo focado sincronizado com o progresso real ao abrir.
  useEffect(() => {
    if (open) form.setValue("focusedStep", currentStep);
  }, [open, currentStep, form]);

  const completedCount = useMemo(
    () => STEP_DEFS.filter((s) => completedSteps.includes(s.key)).length,
    [completedSteps],
  );
  const totalSteps = STEP_DEFS.length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  // Wizard restrito a owner (config de onboarding — CLAUDE.md / RoleRoute pattern).
  // Para não-owner, não renderiza nada (banner também só aparece para incompleto).
  if (orgRole !== "owner") return null;

  const goToStep = (def: StepDef) => {
    // Não bloqueia navegação — fecha o wizard e leva à rota existente (D-07).
    onOpenChange(false);
    navigate(def.route);
  };

  const handleSkip = async (def: StepDef) => {
    if (def.optional) {
      await completeStep(def.key);
      const idx = ONBOARDING_STEPS.indexOf(def.key);
      const next = STEP_DEFS[idx + 1];
      if (next) form.setValue("focusedStep", next.key);
    }
  };

  const activeDef = STEP_DEFS.find((s) => s.key === focusedStep) ?? STEP_DEFS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              <>
                <PartyPopper className="h-5 w-5 text-[hsl(var(--kpi-positive))]" />
                Tudo pronto!
              </>
            ) : (
              "Configurar sua conta"
            )}
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? "Sua conta está configurada. Os dados reais já aparecem no painel."
              : "Siga os passos para trazer seus dados reais ao painel. Você pode fechar e voltar quando quiser."}
          </DialogDescription>
        </DialogHeader>

        {/* Barra de progresso (shadcn Progress) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{completedCount} de {totalSteps} passos</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>

        {/* Lista de passos */}
        <div className="space-y-2 py-1">
          {STEP_DEFS.map((def) => {
            const done = completedSteps.includes(def.key);
            const isFocused = def.key === focusedStep;
            const Icon = def.icon;
            return (
              <button
                type="button"
                key={def.key}
                onClick={() => form.setValue("focusedStep", def.key)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  isFocused
                    ? "border-primary/50 bg-[hsl(var(--sidebar-accent))] shadow-[var(--shadow-glow)]"
                    : "border-border/50 bg-muted/20 hover:bg-muted/40"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(var(--kpi-positive))]" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                )}
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-none">
                    {def.title}
                    {def.optional && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">(opcional)</span>
                    )}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detalhe do passo focado + CTA para a rota existente */}
        {!isComplete && (
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <p className="text-sm text-muted-foreground">{activeDef.description}</p>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {isComplete ? (
            <Button className="w-full sm:w-auto sm:ml-auto" onClick={() => onOpenChange(false)}>
              Concluir
            </Button>
          ) : (
            <>
              {activeDef.optional && !completedSteps.includes(activeDef.key) && (
                <Button
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => handleSkip(activeDef)}
                >
                  <SkipForward className="h-4 w-4" />
                  Pular este passo
                </Button>
              )}
              <Button className="gap-1.5 sm:ml-auto" onClick={() => goToStep(activeDef)}>
                {activeDef.cta}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
