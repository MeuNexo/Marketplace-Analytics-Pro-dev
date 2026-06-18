import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  /** Ícone lucide-react a exibir no topo (ex: Package, Plug, ClipboardList). */
  icon: LucideIcon;
  /** Título curto descritivo (ex: "Nenhum produto encontrado"). */
  title: string;
  /** Instrução específica de ação — o que o usuário precisa fazer para ter dados aqui (D-04/D-05). */
  description: string;
  /** Texto do botão CTA (opcional — se ausente, nenhum botão é renderizado). */
  actionLabel?: string;
  /** Rota interna react-router para o CTA (usar quando a ação é navegação). */
  actionHref?: string;
  /** Callback alternativo ao href (usar quando a ação é local, ex: abrir dialog). */
  onAction?: () => void;
  /** Controla o padding vertical: "default" = py-16, "compact" = py-10. */
  size?: "default" | "compact";
  className?: string;
}

/**
 * Componente de empty state reutilizável seguindo o padrão shadcn/ui do projeto (D-04).
 *
 * Renderiza: ícone + título + descrição de ação + CTA opcional.
 * Strings são renderizadas como texto puro — sem innerHTML dinâmico (T-46-01).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  size = "default",
  className,
}: EmptyStateProps) {
  const py = size === "compact" ? "py-10" : "py-16";
  const iconSize = size === "compact" ? "w-8 h-8" : "w-12 h-12";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        py,
        className,
      )}
    >
      <Icon className={cn(iconSize, "text-muted-foreground/30")} />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground max-w-[280px]">{description}</p>
      </div>
      {actionLabel && (
        actionHref ? (
          <Button asChild size="sm" variant="default">
            <Link to={actionHref}>{actionLabel}</Link>
          </Button>
        ) : onAction ? (
          <Button size="sm" variant="default" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null
      )}
    </div>
  );
}
