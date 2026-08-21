// ============================================================================
// useEstornoDeflator — Fase 224 Plano 05, Task 3 (ERR-03)
//
// Expõe à tela o deflator de estorno vigente e a amostra que o sustenta. O
// `get_cashflow` já aplica esse mesmo deflator internamente aos dias de D+1 a
// D+9 (migration da Fase 224); este hook existe para a tela poder DIZER de
// quanto está deflacionando e com que amostra, em vez de o número mudar em
// silêncio.
//
// 🔴 O DEFLATOR PODE SER NULO, E ISSO NÃO É UM BUG A CONSERTAR.
// `get_estorno_deflator` devolve NULL quando não há denominador (organização
// nova, janela sem liberação). NULL significa "NÃO MEDIDO" e é diferente de
// 1,00, que significa "medido, e igual a um". A coalescência para 1,00 existe
// EXCLUSIVAMENTE dentro do SQL de `get_cashflow`, porque aquela RPC tem de
// devolver número e o comportamento sem deflator é exatamente o de antes desta
// fase — nenhuma surpresa no cálculo. Aqui, no caminho que vai para a tela, a
// ausência tem de continuar visível: quem coalescer este campo para 1 faz a
// tela afirmar uma medição que não houve.
//
// A série de 180 dias devolve NO MÁXIMO 180 linhas (uma por dia com
// liberação), bem abaixo do teto de 1000 linhas do PostgREST — por isso a
// leitura é feita sem laço de paginação. Quem copiar este padrão para uma
// consulta maior precisa paginar com `.range()`, senão perde linhas em
// silêncio.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

/** As RPCs da Fase 224 ainda não constam dos tipos gerados — assinatura mínima, sem `any`. */
type ChamadaRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Quantos dias de série o hook lê para descrever a amostra. */
const DIAS_DA_SERIE = 180;

export interface EstornoDeflatorInfo {
  /**
   * O deflator vigente, entre 0,80 e 1,00 (o clamp mora dentro de
   * `get_estorno_deflator`). `null` = não medido — ver o cabeçalho.
   */
  deflator: number | null;
  /** Quantos dias com liberação a série de 180 dias tem de fato. */
  diasNaSerie: number;
  valorLiberado: number;
  valorEstornado: number;
  parcelas: number;
}

interface LinhaSerie {
  dia?: unknown;
  valor_liberado?: unknown;
  valor_estornado?: unknown;
  n_parcelas?: unknown;
}

const AMOSTRA_VAZIA: EstornoDeflatorInfo = {
  deflator: null,
  diasNaSerie: 0,
  valorLiberado: 0,
  valorEstornado: 0,
  parcelas: 0,
};

/**
 * Lê o deflator de estorno vigente e a amostra que o sustenta, para a org
 * atual. Nunca coalesce o deflator ausente para 1 — ver o cabeçalho do arquivo.
 */
export function useEstornoDeflator() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<EstornoDeflatorInfo>({
    queryKey: ["estorno-deflator", orgId, DIAS_DA_SERIE] as const,
    enabled: !!orgId,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<EstornoDeflatorInfo> => {
      if (orgId == null) return AMOSTRA_VAZIA;

      const chamar = supabase.rpc as unknown as ChamadaRpc;

      const [deflatorRes, serieRes] = await Promise.all([
        chamar("get_estorno_deflator", { p_org_id: orgId }),
        chamar("get_estorno_serie_diaria", { p_org_id: orgId, p_dias: DIAS_DA_SERIE }),
      ]);

      if (deflatorRes.error != null) throw new Error(deflatorRes.error.message);
      if (serieRes.error != null) throw new Error(serieRes.error.message);

      // NULL do banco chega como null; qualquer outra coisa vira número.
      // `Number(null)` é 0, e 0 aqui seria um deflator absurdo passando por
      // medição — por isso o teste de nulo vem ANTES da coerção.
      const bruto = deflatorRes.data;
      const deflator =
        bruto == null || bruto === "" || Number.isNaN(Number(bruto)) ? null : Number(bruto);

      const linhas: LinhaSerie[] = Array.isArray(serieRes.data) ? (serieRes.data as LinhaSerie[]) : [];

      let valorLiberado = 0;
      let valorEstornado = 0;
      let parcelas = 0;
      for (const linha of linhas) {
        valorLiberado += Number(linha.valor_liberado ?? 0);
        valorEstornado += Number(linha.valor_estornado ?? 0);
        parcelas += Number(linha.n_parcelas ?? 0);
      }

      return {
        deflator,
        diasNaSerie: linhas.length,
        valorLiberado,
        valorEstornado,
        parcelas,
      };
    },
  });
}
