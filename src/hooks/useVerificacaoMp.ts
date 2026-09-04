import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { hojeISO, podeEscreverDesfecho } from "@/hooks/useCasoDesfecho";

// ============================================================================
// 225-07 — a CHAVE do portão que a fase construiu e nunca abriu (G-01)
//
// 🔴 O QUE ISTO EXISTE PARA RESOLVER. A onda 2 criou as três colunas de
// verificação em `conciliacao_casos` como resposta a um achado próprio (C-06:
// os 5 únicos pedidos sem repasse em 75 dias eram 5/5 contestação de cartão do
// comprador, R$ 2.278,22). A cascata de motivo da RPC LÊ essas colunas — é ela
// que separa `ausencia_a_verificar`, que não acusa ninguém, de
// `sem_repasse_confirmado`, que vira chamado. R-09 provou o portão contra
// produção nos DOIS sentidos: com `charged_back` o caso sai da fila, com
// `approved` ele vira acionável.
//
// E nada no produto escrevia essas colunas. O portão estava fechado com a
// chave do lado de fora: o Wesley conferia no painel do Mercado Pago, via que o
// repasse tinha sumido de fato, abria o chamado — e o sistema não registrava
// nem que ele conferiu, nem o desfecho, nem o valor recuperado. D-225-13 existe
// exatamente para responder "quanto o ML devolveu, e que tipo de caso ele
// aceita", e a resposta morria aqui.
//
// 🔴 VERIFICAR É UMA AFIRMAÇÃO DO USUÁRIO SOBRE REALIDADE EXTERNA, e por isso:
//
//   1. exige dizer O QUE foi visto (o status, não um "conferi" solto). Um botão
//      que só marcasse "verificado" registraria a conferência e perderia o
//      conteúdo dela, que é justamente o que decide se o caso acusa ou sai;
//   2. registra QUEM e QUANDO — afirmação anônima não se devolve a ninguém;
//   3. É REVERSÍVEL. Um clique errado não pode acusar o Mercado Livre para
//      sempre. Desfazer apaga as três colunas juntas e devolve o caso para
//      "falta verificar" — nunca deixa a flag em pé com o status órfão.
//
// 🔴 ESTE ARQUIVO NÃO DECIDE O CASO. Ele não escreve `estado`, não escreve
// nenhuma das colunas de desfecho. Verificar e decidir são dois atos: quem
// mistura os dois apaga a distinção entre "contestei e ganhei" e "o dinheiro
// chegou sozinho", que é o motivo inteiro de D-225-13 existir. Quando a
// verificação torna o caso acionável, quem oferece o desfecho é o portão que já
// existe na `CasoConciliacaoSheet` — a chave abre a porta que já estava lá.
// ============================================================================

/**
 * Os quatro status que o banco conhece, espelho literal do
 * `comment on column conciliacao_casos.status_mp_verificado` (225-02).
 */
export const STATUS_MP_ACEITOS = [
  "approved",
  "charged_back",
  "cancelled",
  "refunded",
] as const;

export type StatusMp = (typeof STATUS_MP_ACEITOS)[number];

/**
 * 🔴 Os três que tiram o caso da fila e o mandam para o rodapé — espelho do
 * `CASE` da cascata de motivo. Não é dinheiro retido pelo Mercado Livre: é
 * contestação de cartão, cancelamento ou estorno ao comprador.
 */
export const STATUS_MP_FORA_DO_ESCOPO: readonly string[] = [
  "charged_back",
  "cancelled",
  "refunded",
] as const;

/**
 * 🔴 O único tipo de caso cuja cascata lê a verificação. `repasse_a_menor` é
 * decidido pela régua de calibração (hoje desligada), `frete_a_maior` pela
 * régua do frete e `entrada_sem_origem` não tem pedido para conferir. Oferecer
 * verificação nesses três gravaria uma linha que nenhuma regra lê.
 */
export const TIPO_VERIFICAVEL = "repasse_ausente";

const ROTULOS: Record<string, string> = {
  approved: "pagamento aprovado, repasse não chegou",
  charged_back: "contestação de cartão do comprador",
  cancelled: "pagamento cancelado",
  refunded: "pagamento estornado ao comprador",
};

/** Rótulo em português. Código desconhecido devolve o PRÓPRIO código: status
 *  novo no banco tem que aparecer feio na tela, nunca sumir dela. */
export function rotuloStatusMp(status: string | null | undefined): string {
  if (typeof status !== "string" || status.trim().length === 0) {
    return "status não informado";
  }
  return ROTULOS[status] ?? status;
}

/** Verdadeiro nos três status que tiram o caso da fila. */
export function tiraDoEscopo(status: string | null | undefined): boolean {
  return typeof status === "string" && STATUS_MP_FORA_DO_ESCOPO.includes(status);
}

export interface EntradaVerificacao {
  ml_order_id?: string | null;
  tipo_caso?: string | null;
  /** `true` registra a conferência; `false` a desfaz. */
  verificado?: boolean | null;
  /** Obrigatório ao registrar, proibido ao desfazer. */
  status_mp?: string | null;
  /** Gravados só na criação da linha, para o caso carregar a grandeza medida. */
  valor_diferenca?: number | null;
  data_evento?: string | null;
}

function textoUtil(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * O portão que roda ANTES do banco. Devolve a mensagem do impedimento, ou
 * `null` quando a escrita é legítima.
 *
 * ⚠️ Validar no cliente não substitui RLS nem a policy de owner/admin. O que
 * ela evita é a tela oferecer uma ação que produziria um dado que nenhuma regra
 * do banco lê — verificação em tipo de caso errado é linha morta que mente.
 */
export function validarVerificacao(
  entrada: EntradaVerificacao | null | undefined,
): string | null {
  const e = entrada ?? {};

  if (!textoUtil(e.ml_order_id)) {
    return "Sem o número do pedido não há caso para verificar.";
  }

  const tipo = textoUtil(e.tipo_caso);
  if (tipo == null) {
    return "Sem o tipo do caso a verificação sobrescreveria o caso errado do mesmo pedido.";
  }
  if (tipo !== TIPO_VERIFICAVEL) {
    return "Só a ausência de repasse é decidida por conferência no Mercado Pago — os outros tipos têm régua própria.";
  }

  if (typeof e.verificado !== "boolean") {
    return "Verificação sem resposta: é preciso dizer se a conferência está sendo registrada ou desfeita.";
  }

  const status = textoUtil(e.status_mp);

  if (e.verificado) {
    if (status == null) {
      return "Diga o que o painel do Mercado Pago mostra para este pedido — conferência sem o status não decide nada.";
    }
    if (!(STATUS_MP_ACEITOS as readonly string[]).includes(status)) {
      return "Status desconhecido do Mercado Pago — só os quatro que a régua do banco lê podem ser registrados.";
    }
    return null;
  }

  // Desfazer é APAGAR, nunca afirmar outra coisa. Um "desfazer" que carregasse
  // status deixaria a tela dizer "não verificado" com uma acusação órfã embaixo.
  if (status != null) {
    return "Desfazer a verificação não registra status nenhum — para trocar o que foi visto, desfaça e registre de novo.";
  }
  return null;
}

// ─── Molde de leitura e escrita para tabela fora dos tipos gerados ──────────
//
// 🔴 `conciliacao_casos` NÃO consta de `src/integrations/supabase/types.ts` (a
// migration da 225-02 é mais nova que a última geração de tipos). Mesmo molde
// já em produção em `useCasoDesfecho.ts`: um tipo local para a assinatura e um
// cast, em vez de fingir que o tipo gerado a conhece.
//
// ⚠️ `cliente.from(...)` continua sendo CHAMADA DE MÉTODO no objeto — o `this`
// é preservado. O defeito de 27/08/2026 (233-01) veio de ATRIBUIR `supabase.rpc`
// a uma variável, o que desacopla o método. Aqui nada é atribuído.

interface QueryAberta
  extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(coluna: string, valor: unknown): QueryAberta;
  select(colunas?: string): QueryAberta;
  limit(n: number): QueryAberta;
}
interface TabelaAberta {
  select(colunas?: string): QueryAberta;
  update(valores: Record<string, unknown>): QueryAberta;
  insert(valores: Record<string, unknown>): QueryAberta;
}
type ClienteAberto = { from(tabela: string): TabelaAberta };

const TABELA = "conciliacao_casos";

/** O que o banco guarda sobre a conferência — lido, nunca inferido. */
export interface VerificacaoMp {
  caso_id: string | null;
  verificado_no_mp: boolean;
  status_mp_verificado: string | null;
  verificado_em: string | null;
}

export interface CasoVerificavel {
  ml_order_id?: string | null;
  tipo_caso?: string | null;
}

export interface VerificacaoApi {
  /** `null` enquanto não há linha persistida — que é o estado "nunca conferido". */
  verificacao: VerificacaoMp | null;
  carregando: boolean;
  registrarVerificacao: (entrada: EntradaVerificacao) => Promise<void>;
  /** A tela consulta isto para decidir se RENDERIZA o botão de conferência. */
  podeEscrever: boolean;
  ocupado: boolean;
  erro: Error | null;
}

/**
 * 🔴 O estado da conferência vem do BANCO, nunca do `motivo` da RPC.
 *
 * Daria para inferir: numa linha de `repasse_ausente`, `fora_do_escopo` só pode
 * vir do ramo de chargeback verificado. Mas inferir criaria uma SEGUNDA RÉGUA
 * para o mesmo fato — o padrão que quebrou o saldo na fase 233. A tela lê a
 * coluna que ela mesma escreve, e é por isso que ela pode oferecer o desfazer.
 */
export function useVerificacaoMp(caso: CasoVerificavel | null): VerificacaoApi {
  const { currentOrg, orgRole } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const orgId = currentOrg?.id ?? null;
  const podeEscrever = useMemo(() => podeEscreverDesfecho(orgRole), [orgRole]);

  const pedido = textoUtil(caso?.ml_order_id);
  const tipo = textoUtil(caso?.tipo_caso);
  const verificavel = pedido != null && tipo === TIPO_VERIFICAVEL;

  const consulta = useQuery<VerificacaoMp | null>({
    // A organização entra na chave: sem ela, trocar de conta serve o estado de
    // uma loja na tela da outra (T-224-07-01, já aconteceu nesta base).
    queryKey: ["conciliacao-verificacao", orgId, pedido, tipo] as const,
    enabled: !!orgId && verificavel,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<VerificacaoMp | null> => {
      if (orgId == null || !verificavel) return null;

      const cliente = supabase as unknown as ClienteAberto;
      const { data, error } = await cliente
        .from(TABELA)
        .select("id, verificado_no_mp, status_mp_verificado, verificado_em")
        .eq("organization_id", orgId)
        .eq("ml_order_id", pedido)
        .eq("tipo_caso", tipo)
        .limit(1);

      // Erro vira exceção com a mensagem original. Devolver `null` aqui faria a
      // tela dizer "nunca conferido" quando ela não conseguiu ler nada — a pior
      // das ausências, porque parece a melhor.
      if (error != null) throw new Error(error.message);

      const linhas = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      if (linhas.length === 0) return null;

      const l = linhas[0];
      return {
        caso_id: typeof l.id === "string" ? l.id : null,
        verificado_no_mp: l.verificado_no_mp === true,
        status_mp_verificado:
          typeof l.status_mp_verificado === "string" ? l.status_mp_verificado : null,
        verificado_em: typeof l.verificado_em === "string" ? l.verificado_em : null,
      };
    },
  });

  const mutation = useMutation<void, Error, EntradaVerificacao>({
    mutationFn: async (entrada: EntradaVerificacao): Promise<void> => {
      if (orgId == null) {
        throw new Error("Nenhuma organização selecionada — não há onde gravar a verificação.");
      }
      if (!podeEscrever) {
        throw new Error(
          "Seu papel nesta organização não permite registrar verificação de caso.",
        );
      }

      const impedimento = validarVerificacao(entrada);
      if (impedimento != null) throw new Error(impedimento);

      const alvoPedido = String(textoUtil(entrada.ml_order_id));
      const alvoTipo = String(textoUtil(entrada.tipo_caso));
      const marcado = entrada.verificado === true;
      const status = textoUtil(entrada.status_mp);

      // 🔴 AS TRÊS COLUNAS ANDAM JUNTAS, nos dois sentidos. Desligar a flag e
      // deixar o status para trás faria a tela dizer "não verificado" enquanto
      // o banco guarda uma afirmação órfã sobre o Mercado Pago.
      const campos: Record<string, unknown> = {
        verificado_no_mp: marcado,
        status_mp_verificado: marcado ? status : null,
        verificado_em: marcado ? hojeISO() : null,
        atualizado_em: new Date().toISOString(),
      };

      const cliente = supabase as unknown as ClienteAberto;

      // 🔴 `organization_id` explícito no FILTRO, mesmo com RLS ligada. Defesa
      // em profundidade: foi assim que `saldo_declarado` ficou de pé.
      const atualizacao = await cliente
        .from(TABELA)
        .update(campos)
        .eq("organization_id", orgId)
        .eq("ml_order_id", alvoPedido)
        .eq("tipo_caso", alvoTipo)
        .select("id");

      if (atualizacao.error != null) throw new Error(atualizacao.error.message);

      const atingidas = Array.isArray(atualizacao.data) ? atualizacao.data.length : 0;
      if (atingidas === 0) {
        // A linha ainda não existe: o caso vinha da RPC como pré-visualização.
        // Criar carrega a chave inteira e a grandeza medida, para que o mesmo
        // registro sirva ao desfecho depois — é a MESMA linha, não duas.
        const criacao = await cliente.from(TABELA).insert({
          organization_id: orgId,
          ml_order_id: alvoPedido,
          tipo_caso: alvoTipo,
          valor_diferenca: entrada.valor_diferenca ?? null,
          data_evento: textoUtil(entrada.data_evento),
          criado_por: user?.id ?? null,
          ...campos,
        });
        if (criacao.error != null) throw new Error(criacao.error.message);
      }
    },
    onSuccess: () => {
      // 🔴 AS TRÊS consultas. A verificação muda `motivo` e `acionavel` na RPC:
      // invalidar só a lista deixaria o rodapé do resumo contando um
      // `a_verificar_n` que já não existe, e o painel aberto mostrando o botão
      // que acabou de ser usado.
      queryClient.invalidateQueries({ queryKey: ["conciliacao-casos"] });
      queryClient.invalidateQueries({ queryKey: ["conciliacao-resumo"] });
      queryClient.invalidateQueries({ queryKey: ["conciliacao-verificacao"] });
    },
  });

  const registrarVerificacao = useCallback(
    async (entrada: EntradaVerificacao): Promise<void> => {
      await mutation.mutateAsync(entrada);
    },
    [mutation],
  );

  return {
    verificacao: consulta.data ?? null,
    carregando: consulta.isLoading,
    registrarVerificacao,
    podeEscrever,
    ocupado: mutation.isPending,
    erro: (mutation.error as Error) ?? null,
  };
}
