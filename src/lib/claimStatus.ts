// Rótulos e cores de status de reclamação/devolução, robustos ao dado real do ML
// (que usa 'opened' | 'closed' | 'under_review', não os granulares _with_refund).

export interface ClaimStatusConfig {
  label: string;
  tone: string;   // classes de cor (badge)
  isOpen: boolean;
}

const MAP: Record<string, ClaimStatusConfig> = {
  opened:                { label: "Aberta",      tone: "text-red-600 bg-red-500/15 border-red-500/30",         isOpen: true  },
  under_review:          { label: "Em análise",  tone: "text-amber-600 bg-amber-500/15 border-amber-500/30",   isOpen: true  },
  closed:                { label: "Resolvida",   tone: "text-emerald-600 bg-emerald-500/15 border-emerald-500/30", isOpen: false },
  closed_with_refund:    { label: "Resolvida c/ reembolso", tone: "text-emerald-600 bg-emerald-500/15 border-emerald-500/30", isOpen: false },
  closed_without_refund: { label: "Encerrada",   tone: "text-gray-500 bg-gray-500/15 border-gray-500/30",      isOpen: false },
};

const FALLBACK: ClaimStatusConfig = {
  label: "Desconhecido", tone: "text-gray-500 bg-gray-500/15 border-gray-500/30", isOpen: false,
};

export function claimStatusConfig(status: string | null): ClaimStatusConfig {
  if (!status) return FALLBACK;
  return MAP[status] ?? FALLBACK;
}

/** Uma claim está "aberta" (pede ação) se opened/under_review. */
export function isClaimOpen(status: string | null): boolean {
  return claimStatusConfig(status).isOpen;
}

export function claimTipoLabel(tipo: string | null): string {
  if (tipo === "mediations") return "Reclamação";
  if (tipo === "returns") return "Devolução";
  return tipo ?? "—";
}
