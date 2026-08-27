// ============================================================================
// 233-02 — a confiança da previsão de saldo, por horizonte.
//
// ⚠️ `supabase.rpc.bind(supabase)`: o método depende de `this` e atribuí-lo a uma
// variável o desacopla do client — foi o defeito do 233-01. Há portão em
// `src/hooks/__tests__/rpcBind.test.ts` que reprova o padrão sem bind.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  HORIZONTE_MINIMO,
  confiancaDoSaldo,
  preencherFaixa,
  resumoDaConfianca,
  seloDeProvisorio,
  type LinhaRpcConfianca,
  type PontoDeConfianca,
} from "@/lib/confiancaDoSaldo";

export const HORIZONTE_MAXIMO = 30;

export interface ConfiancaDoSaldoData {
  pontos: PontoDeConfianca[];
  melhor: PontoDeConfianca | null;
  pior: PontoDeConfianca | null;
  totalPares: number;
  diasDeSerie: number;
  selo: string | null;
}

const VAZIO: ConfiancaDoSaldoData = {
  pontos: [], melhor: null, pior: null, totalPares: 0, diasDeSerie: 0,
  selo: seloDeProvisorio(0, 0),
};

export function useConfiancaDoSaldo() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<ConfiancaDoSaldoData>({
    // A organização entra na chave: sem ela o número de uma loja apareceria na
    // tela da outra ao trocar de conta (T-224-07-01).
    queryKey: ["confianca-do-saldo", orgId] as const,
    enabled: !!orgId,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ConfiancaDoSaldoData> => {
      if (orgId == null) return VAZIO;

      const chamar = supabase.rpc.bind(supabase) as unknown as (
        fn: string, args: Record<string, unknown>,
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

      const { data, error } = await chamar("get_confianca_do_saldo", {
        p_org_id: orgId,
        p_horizonte_minimo: HORIZONTE_MINIMO,
        p_horizonte_maximo: HORIZONTE_MAXIMO,
      });
      if (error != null) throw new Error(error.message);

      // 🔴 233-04 — `preencherFaixa` é cinto e suspensórios DECLARADOS: a faixa
      // que sai daqui tem sempre o mesmo tamanho da que foi pedida à RPC. Se o
      // banco regredir e voltar a omitir horizonte sem par, o ponto retorna como
      // `nao_medido` e a tela o declara — nunca volta a exibir seis dias como se
      // fossem todos (o defeito que o Wesley viu em 27/08).
      const pontos = preencherFaixa(
        confiancaDoSaldo((Array.isArray(data) ? data : []) as LinhaRpcConfianca[]),
        HORIZONTE_MINIMO,
        HORIZONTE_MAXIMO,
      );
      const resumo = resumoDaConfianca(pontos);

      // Dias distintos de declaração observados na amostra — é a idade da série,
      // e ela decide se o selo de provisório continua no ar.
      const alvos = new Set(
        pontos.flatMap((p) => [p.primeiro_alvo, p.ultimo_alvo].filter(Boolean) as string[]),
      );

      return {
        pontos,
        melhor: resumo.melhor,
        pior: resumo.pior,
        totalPares: resumo.total_pares,
        diasDeSerie: alvos.size,
        selo: seloDeProvisorio(resumo.total_pares, alvos.size),
      };
    },
  });
}
