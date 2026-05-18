import type { ElasticityClass } from './types';

export const ELASTICITY_BADGE: Record<ElasticityClass, { label: string; className: string }> = {
  baixa:   { label: "Baixa",   className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  media:   { label: "Média",   className: "bg-blue-500/15    text-blue-700    border-blue-500/30"    },
  alta:    { label: "Alta",    className: "bg-amber-500/15   text-amber-700   border-amber-500/30"   },
  extrema: { label: "Extrema", className: "bg-red-500/15     text-red-700     border-red-500/30"     },
};
