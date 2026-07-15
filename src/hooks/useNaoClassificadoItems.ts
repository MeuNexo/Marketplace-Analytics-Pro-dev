// ============================================================================
// useNaoClassificadoItems — Phase 96 Plan 04, Task 3 (C8-backend)
//
// Consome a RPC de itens não classificados (migration 20260715120000), que
// lista os lançamentos crus de cash_outflows que caem no bloco
// 'nao_classificado' da competência — os mesmos que a cascata do DRE já exibe
// somados (R$10.809,20 em maio/2026).
//
// Decisão do dono (Wesley, 96-CONTEXT.md §3 [C8]): **só INFORMAR, nunca
// auto-corrigir.** A lista existe para o Wesley recategorizar no Tiny; nada
// aqui move lançamento de bloco nem ajusta valor.
//
// O filtro de "não classificado" vive no BACKEND (helper dre_bloco_for_category,
// cópia literal do CASE da RPC 87, equivalência provada por query). Isso
// respeita a regra explícita de dreCascade.ts: o campo `bloco` é consumido
// DIRETAMENTE e NUNCA re-derivado de `category` no cliente.
//
// Padrão de escopo (só org + mês de competência) clonado de useImpostoGuiaReal.ts.
// Este hook NÃO é consumido ainda — a fiação é do plano 96-06.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/** Lançamento cru de cash_outflows no bloco 'nao_classificado' da competência. */
export interface NaoClassificadoItem {
  /** Data efetiva da saída (pagamento ou vencimento) — "YYYY-MM-DD". */
  outflowDate: string;
  /** Competência efetiva — "YYYY-MM-DD"; COALESCE(competence_date, 1º dia do outflow_date). */
  competenceMonth: string;
  /** Histórico/descrição do Tiny (ex.: "Ref. a NF nº …, parcela x/y"). */
  description: string;
  /** Fornecedor (contato.nome do Tiny), quando houver. */
  supplier: string | null;
  /** Categoria do Tiny que caiu no ELSE do mapa categoria→bloco. */
  category: string;
  /** Valor positivo da saída. */
  amount: number;
  /** numeroDocumento (boleto, NF, etc.), quando houver. */
  documentNumber: string | null;
}

/**
 * Lançamentos do bloco "Não classificado" da competência, ordenados por valor
 * decrescente (os maiores primeiro — é o que o Wesley precisa recategorizar).
 *
 * @param saleMonth DEVE ser "YYYY-MM-01" (primeiro dia do mês), NUNCA "YYYY-MM"
 *        — o cast para `date` do Postgres falha (mesmo footgun documentado em
 *        useDreOperational.ts). É o mês de VENDA (`dreSaleMonth`), não o M+1 da
 *        guia — o shift M+1 é exclusivo do imposto (useImpostoGuiaReal).
 *
 * Ausência de lançamento é um estado válido: devolve `[]`, nunca `null`.
 */
export function useNaoClassificadoItems(saleMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<NaoClassificadoItem[]>({
    queryKey: ["dre", "nao-classificado-items", orgId, saleMonth] as const,
    enabled: !!orgId && !!saleMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<NaoClassificadoItem[]> => {
      if (!orgId || !saleMonth) return [];

      const { data, error } = await supabase.rpc("get_dre_nao_classificado_items", {
        p_org_id: orgId,
        p_month: saleMonth,
      });

      if (error) throw error;

      return (data ?? []).map((r: any) => ({
        outflowDate: String(r.outflow_date ?? ""),
        competenceMonth: String(r.competence_month ?? "").substring(0, 10),
        description: String(r.description ?? ""),
        supplier: r.supplier != null ? String(r.supplier) : null,
        category: String(r.category ?? ""),
        amount: Number(r.amount ?? 0),
        documentNumber: r.document_number != null ? String(r.document_number) : null,
      }));
    },
  });
}
