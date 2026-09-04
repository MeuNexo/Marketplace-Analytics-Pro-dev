import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// 225-05 — o desfecho do caso (D-225-13)
//
// Sem isto, ninguém sabe quanto o Mercado Livre devolveu de fato nem que tipo
// de caso ele aceita — e o monitor vira relatório de lamentações em vez de
// ferramenta de recuperação.
//
// 🔴 TRÊS ESTADOS, E SÓ TRÊS, SÃO DO USUÁRIO: contestado, ganho, negado.
// `resolvido_sozinho` e `expirado` são DERIVADOS pelo sistema e recusados aqui
// antes de tocar o banco. A distinção não é burocracia: "o ML pagou porque eu
// reclamei" e "o repasse ia chegar de qualquer jeito" são conclusões opostas
// sobre a mesma linha, e separá-las é o motivo inteiro de D-225-13 existir.
//
// 🔴 A POLICY DE ESCRITA É `owner`/`admin` (225-02). `podeEscrever` existe para
// a tela não renderizar um botão que o banco vai negar — o usuário veria uma
// mensagem de erro no lugar de uma tela honesta. Botão que não existe é melhor
// que botão que falha. A policy segue sendo o portão real; isto é cortesia.
// ============================================================================

/** Os três estados que o usuário pode registrar. */
export type EstadoDesfecho = "contestado" | "ganho" | "negado";

export const ESTADOS_ACEITOS: readonly EstadoDesfecho[] = [
  "contestado",
  "ganho",
  "negado",
] as const;

/**
 * 🔴 Os dois estados que o sistema deriva e o usuário nunca escolhe.
 * `resolvido_sozinho` = o repasse chegou depois da abertura do caso e antes da
 * contestação. `expirado` = os dias restantes cruzaram zero sem desfecho.
 */
export const ESTADOS_DO_SISTEMA: readonly string[] = ["resolvido_sozinho", "expirado"] as const;

/** Espelho exato da policy `conciliacao_casos_write`. */
export const PAPEIS_DE_ESCRITA: readonly string[] = ["owner", "admin"] as const;

export interface EntradaDesfecho {
  ml_order_id?: string | null;
  /** A chave é pedido MAIS tipo: um pedido pode ter dois casos diferentes. */
  tipo_caso?: string | null;
  estado?: string | null;
  /** Obrigatório em "ganho": ganho sem valor é chute, não recuperação. */
  valor_recuperado?: number | null;
  /** Gravado só na criação da linha, para o caso carregar a grandeza medida. */
  valor_diferenca?: number | null;
  data_evento?: string | null;
  observacao?: string | null;
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
 * ⚠️ Validar no cliente não substitui a validação do banco (o `check` de
 * `estado` e a policy continuam lá). O que ela evita é mandar para o servidor
 * uma escrita que nunca deveria existir — e, principalmente, deixar a tela
 * oferecer uma ação que produziria um dado mentiroso.
 */
export function validarDesfecho(entrada: EntradaDesfecho | null | undefined): string | null {
  const e = entrada ?? {};

  if (!textoUtil(e.ml_order_id)) {
    return "Sem o número do pedido não há caso para registrar.";
  }
  if (!textoUtil(e.tipo_caso)) {
    return "Sem o tipo do caso o desfecho sobrescreveria o caso errado do mesmo pedido.";
  }

  const estado = textoUtil(e.estado);
  if (estado != null && ESTADOS_DO_SISTEMA.includes(estado)) {
    return `"${estado}" é definido pelo sistema, nunca pelo usuário: o sistema detecta o repasse que chegou ou o prazo que venceu.`;
  }
  if (estado == null || !(ESTADOS_ACEITOS as readonly string[]).includes(estado)) {
    return "Estado de desfecho desconhecido — só contestado, ganho e negado podem ser registrados.";
  }

  if (estado === "ganho") {
    const v = e.valor_recuperado;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      return "Informe o valor que o Mercado Livre reembolsou — ganho sem valor não entra no total recuperado.";
    }
  }

  return null;
}

/** `podeEscrever` da tela: o papel decide se o botão sequer é renderizado. */
export function podeEscreverDesfecho(papel: string | null | undefined): boolean {
  return typeof papel === "string" && PAPEIS_DE_ESCRITA.includes(papel);
}

/** Data local em ISO. `toISOString()` desloca o dia em fuso negativo — e o
 *  Brasil é um deles: depois das 21h a data viraria a de amanhã. */
export function hojeISO(agora: Date = new Date()): string {
  const a = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  const d = String(agora.getDate()).padStart(2, "0");
  return `${a}-${m}-${d}`;
}

// ─── Molde de escrita para tabela fora dos tipos gerados ────────────────────
//
// 🔴 `conciliacao_casos` NÃO consta de `src/integrations/supabase/types.ts`
// (a migration da 225-02 é mais nova que a última geração de tipos). Mesmo
// molde já usado em `useConciliacao.ts` para as RPCs: um tipo local para a
// assinatura e um cast, em vez de fingir que o tipo gerado a conhece.
//
// ⚠️ `cliente.from(...)` continua sendo CHAMADA DE MÉTODO no objeto — o `this`
// é preservado. O defeito de 27/08 (233-01) veio de ATRIBUIR `supabase.rpc` a
// uma variável, o que desacopla o método. Aqui nada é atribuído.

interface QueryEscrita
  extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(coluna: string, valor: unknown): QueryEscrita;
  select(colunas?: string): QueryEscrita;
}
interface TabelaEscrita {
  update(valores: Record<string, unknown>): QueryEscrita;
  insert(valores: Record<string, unknown>): QueryEscrita;
}
type ClienteAberto = { from(tabela: string): TabelaEscrita };

const TABELA = "conciliacao_casos";

export interface DesfechoApi {
  marcarDesfecho: (entrada: EntradaDesfecho) => Promise<void>;
  /** A tela consulta isto para decidir se RENDERIZA os botões de escrita. */
  podeEscrever: boolean;
  papel: string | null;
  ocupado: boolean;
  erro: Error | null;
}

export function useCasoDesfecho(): DesfechoApi {
  const { currentOrg, orgRole } = useOrganization();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const orgId = currentOrg?.id ?? null;
  const podeEscrever = useMemo(() => podeEscreverDesfecho(orgRole), [orgRole]);

  const mutation = useMutation<void, Error, EntradaDesfecho>({
    mutationFn: async (entrada: EntradaDesfecho): Promise<void> => {
      if (orgId == null) {
        throw new Error("Nenhuma organização selecionada — não há onde gravar o desfecho.");
      }
      if (!podeEscrever) {
        throw new Error(
          "Seu papel nesta organização não permite registrar desfecho de caso.",
        );
      }

      const impedimento = validarDesfecho(entrada);
      if (impedimento != null) throw new Error(impedimento);

      const pedido = String(textoUtil(entrada.ml_order_id));
      const tipo = String(textoUtil(entrada.tipo_caso));
      const estado = String(textoUtil(entrada.estado)) as EstadoDesfecho;
      const hoje = hojeISO();

      // 🔴 O que muda conforme o desfecho — e o que NÃO pode ser apagado:
      // `contestado_em` é a prova de que houve chamado. É ele que distingue
      // "contestei e ganhei" de "resolveu sozinho". Um upsert cru zeraria essa
      // coluna ao marcar o ganho, destruindo exatamente a distinção que
      // D-225-13 existe para produzir. Por isso a escrita é atualizar-ou-criar,
      // nunca sobrescrever a linha inteira.
      const campos: Record<string, unknown> = {
        estado,
        atualizado_em: new Date().toISOString(),
      };
      const observacao = textoUtil(entrada.observacao);
      if (observacao != null) campos.observacao = observacao;

      if (estado === "contestado") {
        campos.contestado_em = hoje;
      } else {
        campos.desfecho_em = hoje;
        // Negado é uma afirmação: recuperou zero. Ganho carrega o valor que o
        // usuário confirmou ter recebido. Nenhum dos dois é inferido.
        campos.valor_recuperado = estado === "ganho" ? entrada.valor_recuperado : 0;
      }

      const cliente = supabase as unknown as ClienteAberto;

      // 🔴 `organization_id` explícito no FILTRO, mesmo com RLS ligada. Defesa
      // em profundidade: foi assim que `saldo_declarado` ficou de pé.
      const atualizacao = await cliente
        .from(TABELA)
        .update(campos)
        .eq("organization_id", orgId)
        .eq("ml_order_id", pedido)
        .eq("tipo_caso", tipo)
        .select("id");

      if (atualizacao.error != null) throw new Error(atualizacao.error.message);

      const atingidas = Array.isArray(atualizacao.data) ? atualizacao.data.length : 0;
      if (atingidas === 0) {
        // A linha ainda não existe: o caso vinha da RPC como pré-visualização,
        // sem registro persistido. Criar carrega a chave inteira.
        const criacao = await cliente.from(TABELA).insert({
          organization_id: orgId,
          ml_order_id: pedido,
          tipo_caso: tipo,
          valor_diferenca: entrada.valor_diferenca ?? null,
          data_evento: textoUtil(entrada.data_evento),
          // Não-repúdio (T-225-05-06): quem marcou o desfecho fica registrado.
          criado_por: user?.id ?? null,
          ...campos,
        });
        if (criacao.error != null) throw new Error(criacao.error.message);
      }
    },
    onSuccess: () => {
      // 🔴 AS DUAS consultas. O banner de urgência e os KPIs leem o resumo; a
      // fila lê a lista. Invalidar só uma deixa a tela dizendo dois números
      // diferentes sobre o mesmo caso, e quem olha não sabe em qual acreditar.
      queryClient.invalidateQueries({ queryKey: ["conciliacao-casos"] });
      queryClient.invalidateQueries({ queryKey: ["conciliacao-resumo"] });
    },
  });

  const marcarDesfecho = useCallback(
    async (entrada: EntradaDesfecho): Promise<void> => {
      await mutation.mutateAsync(entrada);
    },
    [mutation],
  );

  return {
    marcarDesfecho,
    podeEscrever,
    papel: orgRole ?? null,
    ocupado: mutation.isPending,
    erro: (mutation.error as Error) ?? null,
  };
}
