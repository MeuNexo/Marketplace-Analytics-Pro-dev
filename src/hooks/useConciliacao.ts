import { useQuery } from "@tanstack/react-query";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// 225-03 — os dois hooks do "Protetor do caixa"
//
// Leem as duas RPCs entregues pela onda 2 (225-02), ambas `SECURITY INVOKER`:
//
//   get_casos_conciliacao(p_org_id, p_janela_dias, p_apenas_acionaveis,
//                         p_limite, p_offset)  → 24 colunas, uma por anomalia
//   get_conciliacao_resumo(p_org_id, p_janela_dias) → 26 campos, uma linha
//
// 🔴 NENHUMA RÉGUA MORA AQUI. Piso de materialidade, cortes de dias, início da
// ingestão, janela e o estado de `acusar_valor_a_menor` são ECOADOS pela RPC
// justamente para a tela poder dizer a regra sem repetir o número em código.
// `p_janela_dias` vai NULO de propósito: quem resolve é `conciliacao_config`.
// ============================================================================

// ─── O molde de chamada para RPC fora dos tipos gerados ─────────────────────
//
// 🔴 `cash_inflows`, `conciliacao_casos` e as três RPCs desta fase NÃO constam
// de `src/integrations/supabase/types.ts` (grep = 0 em 03/09/2026). Mesmo
// molde já em produção em `useForecastErrorCurve.ts`: um tipo local para a
// assinatura e um cast, em vez de fingir que o tipo gerado as conhece.

interface ConstrutorRpc
  extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(coluna: string, valor: unknown): ConstrutorRpc;
  range(de: number, ate: number): ConstrutorRpc;
}
type ChamadaRpc = (fn: string, args: Record<string, unknown>) => ConstrutorRpc;

/**
 * 🔴 `.bind(supabase)` NÃO é estilo. `supabase.rpc` é implementado como
 * `return this.rest.rpc(...)`; atribuí-lo a uma variável desacopla o método do
 * objeto e, em ESM strict, o `this` vira `undefined` — a tela mostra
 * `Cannot read properties of undefined (reading 'rest')`, que foi o defeito de
 * 27/08/2026 (233-01). Há portão em `__tests__/rpcBind.test.ts` que reprova o
 * padrão sem bind em qualquer hook novo.
 */
function chamarRpc(): ChamadaRpc {
  return supabase.rpc.bind(supabase) as unknown as ChamadaRpc;
}

// ─── Contrato de linha: as 24 colunas de get_casos_conciliacao ──────────────

export interface CasoConciliacaoRow {
  /** UUID de `conciliacao_casos` — nulo enquanto o caso não foi persistido. */
  caso_id: string | null;
  /** 🔴 Nulo em entrada que não é venda; repete em split payment. Nunca key. */
  ml_order_id: string | null;
  /** `repasse_ausente` | `repasse_a_menor` | `entrada_sem_origem` */
  tipo_caso: string | null;
  /** `ml` | `nosso` | `nenhuma` — a fronteira que protege o próximo chamado. */
  fila: string | null;
  /** ⚠️ Verdadeiro em apenas DOIS motivos, por decisão medida na onda 2. */
  acionavel: boolean | null;
  motivo: string | null;
  estado: string | null;
  titulo: string | null;
  sku: string | null;
  quantidade: number | null;
  /** ML contra ML: soma(gross) − soma(net) de `cash_inflows`. */
  retido_de_fato: number | null;
  /** ML contra ML: soma de `detail_amount`, líquida de estorno. */
  cobranca_declarada: number | null;
  residuo_ml: number | null;
  esperado_nosso: number | null;
  recebido: number | null;
  residuo_nosso: number | null;
  /** A grandeza a exibir — muda de fonte conforme o tipo/motivo (225-02). */
  diferenca: number | null;
  data_pedido: string | null;
  data_evento: string | null;
  /** Já calculado pela RPC. A tela ROTULA, nunca recalcula (fase 233). */
  dias_restantes: number | null;
  n_pagamentos: number | null;
  payment_ids: string[] | null;
  release_date_max: string | null;
  valor_estimado: boolean | null;
}

// ─── Contrato do resumo: os 26 campos de get_conciliacao_resumo ─────────────

export interface ConciliacaoResumoRow {
  casos_urgentes: number | null;
  soma_urgente: number | null;
  proximo_prazo_dias: number | null;
  acionaveis_n: number | null;
  vazamento_total: number | null;
  sub_piso_n: number | null;
  sub_piso_soma: number | null;
  nosso_erro_n: number | null;
  /** 🔴 NULO quando não há valor mensurável. Nunca renderizar como R$ 0,00. */
  nosso_erro_soma: number | null;
  fora_escopo_n: number | null;
  /** 🔴 Também nulável, pelo mesmo motivo. */
  fora_escopo_soma: number | null;
  entradas_sem_origem_n: number | null;
  entradas_sem_origem_soma: number | null;
  a_verificar_n: number | null;
  a_verificar_soma: number | null;
  recuperado_total: number | null;
  /** Flag de capacidade: o banner de limitação some sozinho quando virar true. */
  saidas_auditadas: boolean | null;
  ingestao_inicio: string | null;
  piso_materialidade: number | null;
  /** Desligado por calibração reprovada (55,3% de aderência ao centavo). */
  acusar_valor_a_menor: boolean | null;
  dias_aguardando: number | null;
  dias_ausente: number | null;
  ultima_sync: string | null;
  /** 🔴 Contado SEM teto. Comparar com `teto_da_lista` é obrigação da tela. */
  linhas_total: number | null;
  teto_da_lista: number | null;
  valor_desconhecido_n: number | null;
}

// ─── Paginação: uma ida ao banco para abrir, o resto sob demanda ───────────
//
// 🔴 O PostgREST trunca em 1000 EM SILÊNCIO. Uma tela que mostra 1.000 e deixa
// o usuário achar que são todos reprova D-225-16 ("nenhum caso expira sem eu
// ter olhado") direto: o caso da linha 1.001 nunca é olhado. Por isso o laço
// existe, e por isso ele NÃO vai voltar a truncar.
//
// ⚠️ Mas paginar de 200 em 200 custava caro do jeito errado. Medido em
// produção (04/09/2026): `get_casos_conciliacao` roda em 231 ms como
// `postgres` e em 1.079 ms como `authenticated` — 4,7×, porque a RLS é
// avaliada linha a linha. E CADA chamada reexecuta a função INTEIRA: o
// `p_offset` só corta no fim. Com 2.604 linhas na janela, 200 por página dava
// 14 idas sequenciais × 1.079 ms ≈ 15,1 s para abrir a tela.
//
// Duas mudanças, nenhuma delas "mostrar menos":
//
//   1. a página passa a ser o teto duro do PostgREST (1.000). Mesmo custo por
//      chamada, um quinto das chamadas para o mesmo pedaço de lista;
//   2. a abertura lê só a PRIMEIRA página, e a primeira página é a que decide:
//      a RPC ordena por `dias_restantes asc NULLS LAST` (ordem total desde o
//      225-07), então quem tem prazo correndo vem antes de quem não tem.
//      As 1.241 linhas de frete da janela têm `diferenca` NULA — entram como
//      VOLUME, não como dinheiro apurado. O CEO estava esperando 15 segundos
//      em boa parte por linhas que ainda não dizem nada.
//
// A completude não vira suposição: vira `prazoCoberto`, uma invariante
// conferida a cada leitura. Com nulos no fim, se a ÚLTIMA linha carregada já
// não tem prazo, então toda linha com prazo está carregada — a fronteira dos
// nulos foi cruzada dentro do que se leu. Quando ela é falsa, a tela grita e
// oferece a leitura completa; nunca fica quieta.

/** Teto duro do PostgREST — pedir mais numa chamada não traz mais. */
const PAGINA = 1000;
/** Teto de segurança: 8 × 1.000 = 8.000 linhas. Existe para o laço não girar
 *  para sempre se a RPC passar a devolver página cheia indefinidamente. */
const MAX_PAGINAS = 8;

export interface OpcoesCasos {
  /** `false` traz tudo (D-225-06: mostra tudo, age em alguns). */
  apenasAcionaveis?: boolean;
  /**
   * `false` (padrão) lê só a primeira página — a que tem os casos com prazo.
   * `true` varre a janela inteira; é o que a tela pede quando o usuário clica
   * em carregar o restante.
   */
  completo?: boolean;
}

export interface CasosConciliacao {
  linhas: CasoConciliacaoRow[];
  /** Verdadeiro se o laço bateu no teto de páginas — a tela precisa dizer. */
  truncadoNoTeto: boolean;
  /** Verdadeiro quando a leitura trouxe a janela inteira. */
  completo: boolean;
  /**
   * 🔴 A garantia de D-225-16, conferida e não suposta: verdadeiro quando toda
   * linha COM prazo está carregada. Falso obriga a tela a alertar.
   */
  prazoCoberto: boolean;
  /** Quantas idas ao banco esta leitura custou. A tela não usa; o portão usa. */
  paginasLidas: number;
}

const SEM_LINHAS: CasosConciliacao = {
  linhas: [],
  truncadoNoTeto: false,
  completo: true,
  prazoCoberto: true,
  paginasLidas: 0,
};

/**
 * A fila do monitor. Só dispara com organização resolvida; sem ela devolve
 * lista vazia e não chega a chamar a RPC.
 */
export function useCasosConciliacao(opcoes?: OpcoesCasos) {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const apenasAcionaveis = opcoes?.apenasAcionaveis ?? false;
  const completoPedido = opcoes?.completo ?? false;

  return useQuery<CasosConciliacao>({
    // 🔴 A organização entra na chave: sem ela, trocar de conta serve o número
    // de uma loja na tela da outra (T-224-07-01, já aconteceu nesta base).
    // `resolvedMLUserIds` entra por consistência com o resto do módulo — a RPC
    // resolve pelo RLS, mas se a conta Junior um dia entrar (hoje fora por
    // D-225-14) a chave já está preparada.
    queryKey: [
      "conciliacao-casos",
      orgId,
      resolvedMLUserIds,
      apenasAcionaveis,
      completoPedido,
    ] as const,
    enabled: !!orgId,
    // 🔴 Pedir o restante NÃO pode apagar o que já está na tela: sem isto, a
    // chave muda, o cache vira miss e a lista pisca para vazia enquanto as
    // duas chamadas seguintes correm — o usuário perde o caso que estava
    // olhando bem no momento em que pediu para ver mais.
    placeholderData: (anterior) => anterior,
    staleTime: 2 * 60 * 1000,
    // A tela é o ÚNICO canal (D-225-11). Voltar para a aba é justamente o
    // momento em que o número de agora é o que importa.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CasosConciliacao> => {
      if (orgId == null) return SEM_LINHAS;

      const chamar = chamarRpc();
      const linhas: CasoConciliacaoRow[] = [];
      let truncadoNoTeto = true;
      let completo = false;
      let paginasLidas = 0;

      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const { data, error } = await chamar("get_casos_conciliacao", {
          p_org_id: orgId,
          // Nulo de propósito: a janela é decidida por `conciliacao_config`.
          p_janela_dias: null,
          p_apenas_acionaveis: apenasAcionaveis,
          p_limite: PAGINA,
          p_offset: pagina * PAGINA,
        });
        // Erro vira exceção com a mensagem original. Devolver lista vazia aqui
        // faria a tela dizer "nenhuma divergência" quando ela não conseguiu
        // ler nada — a pior das três ausências, porque parece a melhor.
        if (error != null) throw new Error(error.message);

        const bloco: CasoConciliacaoRow[] = Array.isArray(data)
          ? (data as CasoConciliacaoRow[])
          : [];
        linhas.push(...bloco);
        paginasLidas++;

        // Página incompleta = fim da janela. Não há mais o que buscar.
        if (bloco.length < PAGINA) {
          truncadoNoTeto = false;
          completo = true;
          break;
        }

        // Parada DELIBERADA da abertura. Não é o teto de segurança do laço —
        // confundir as duas faria a tela acusar truncamento numa leitura que
        // ela mesma pediu curta.
        if (!completoPedido) {
          truncadoNoTeto = false;
          completo = false;
          break;
        }
      }

      // 🔴 A invariante de D-225-16. `dias_restantes asc NULLS LAST`: se a
      // última linha lida já não tem prazo, a fronteira dos nulos foi cruzada
      // dentro do que se leu — logo TODA linha com prazo está aqui. É uma
      // conferência sobre o dado devolvido, não uma promessa sobre a RPC.
      const ultima = linhas.length > 0 ? linhas[linhas.length - 1] : null;
      const prazoCoberto = completo || (ultima != null && ultima.dias_restantes == null);

      return { linhas, truncadoNoTeto, completo, prazoCoberto, paginasLidas };
    },
  });
}

/**
 * O resumo — uma linha com os números E a régua que os produziu.
 *
 * ⚠️ Devolve `saidas_auditadas`, `piso_materialidade`, `acusar_valor_a_menor`
 * e `ingestao_inicio` COMO VIERAM. Nenhum valor padrão é embutido aqui: um
 * default no front seria uma segunda régua, e a tela declararia uma regra que
 * o banco não está aplicando.
 */
export function useConciliacaoResumo() {
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<ConciliacaoResumoRow | null>({
    queryKey: ["conciliacao-resumo", orgId, resolvedMLUserIds] as const,
    enabled: !!orgId,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ConciliacaoResumoRow | null> => {
      if (orgId == null) return null;

      const chamar = chamarRpc();
      const { data, error } = await chamar("get_conciliacao_resumo", {
        p_org_id: orgId,
        p_janela_dias: null,
      });
      if (error != null) throw new Error(error.message);

      const linhas = Array.isArray(data) ? (data as ConciliacaoResumoRow[]) : [];
      // Nulo quando a RPC não devolveu linha — a tela distingue isso de
      // "devolveu uma linha com tudo zerado", que é outra coisa.
      return linhas.length > 0 ? linhas[0] : null;
    },
  });
}
