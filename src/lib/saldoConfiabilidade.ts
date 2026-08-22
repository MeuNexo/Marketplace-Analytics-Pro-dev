/**
 * saldoConfiabilidade.ts — a régua de "há quanto tempo o saldo de caixa não é
 * conferido?" (CX-06, Fase 230, plano 01).
 *
 * POR QUE ISTO EXISTE: `financial_settings` não tinha nenhuma trigger de
 * `updated_at` (confirmado em produção: zero triggers não-internos na
 * tabela). O "Ajustar saldo" faz UPDATE, e `DEFAULT now()` só vale no
 * INSERT — então o valor de `updated_at` que a tela lia era a data de
 * CRIAÇÃO da linha, não a do último ajuste. A migration
 * `20260822000000_financial_settings_updated_at.sql` cria a trigger que
 * corrige isso DAQUI PRA FRENTE; este módulo declara o estado
 * `nunca_carimbado` para que um ajuste ANTERIOR a ela nunca se apresente
 * como recente.
 *
 * Molde: `useEstornoDeflator.ts` — "nulo é NÃO MEDIDO, e isso não é bug a
 * consertar"; a coalescência para um valor neutro só pode acontecer dentro
 * de SQL obrigado a devolver número, nunca nesta camada. Mesma disciplina de
 * `fraseMotivoSemRebate` (`rebateLinhaCenarios.ts`): uma frase por motivo,
 * nomeando o motivo real — nunca um traço mudo.
 *
 * Puro: nenhum import de React, de Supabase/rede, ou de date-fns. `agora`
 * entra como argumento obrigatório para o módulo continuar puro e o teste
 * não depender do relógio.
 */

/**
 * Acima de um ciclo de conciliação bancária (mensal), o saldo rolado deixa
 * de ter qualquer conferência externa contra o extrato. É parâmetro
 * declarado, revisável pelo Wesley — não é aprovação de nada.
 */
export const IDADE_SALDO_LIMITE_DIAS = 30;

export type EstadoSaldo = "recente" | "envelhecido" | "nunca_carimbado" | "nao_medido";

export interface ConfiabilidadeSaldo {
  estado: EstadoSaldo;
  /** Idade do ajuste em dias corridos; `null` em todo estado que não seja recente/envelhecido/nunca_carimbado. */
  idadeDias: number | null;
  /** Se o selo deve aparecer na tela — true em tudo que não seja `recente` (critério 5 do ROADMAP). */
  exibir: boolean;
  /** O texto curto do selo. */
  texto: string;
  /** O tooltip — SEMPRE nomeia o motivo real. */
  titulo: string;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function diferencaEmDias(dataIso: string, agora: Date): number {
  return Math.floor((agora.getTime() - new Date(dataIso).getTime()) / MS_POR_DIA);
}

function tituloEnvelhecido(idadeDias: number): string {
  return (
    `O saldo foi ajustado há ${idadeDias} dias — é um valor rolado por esse tempo, sem ` +
    `qualquer conferência externa contra o extrato desde então.`
  );
}

function tituloNuncaCarimbado(): string {
  return (
    "Este saldo nunca teve a data do ajuste registrada — a linha existe, mas nenhum " +
    "ajuste anterior à correção do sistema carimbou a própria data. Não é um saldo " +
    "recente; é um saldo cuja idade real é desconhecida."
  );
}

function tituloNaoMedido(): string {
  return "Não há data de ajuste do saldo para medir — a idade do saldo é desconhecida.";
}

/**
 * Decide a confiabilidade do saldo, na ordem:
 *
 * 1. `updatedAt` ausente: nao_medido, idade null — nunca 0.
 * 2. `updatedAt` no futuro (relógio inconsistente ou dado corrompido):
 *    nao_medido, idade null — "ajuste feito amanhã" não é um fato a exibir.
 * 3. `updatedAt` igual a `createdAt`: nunca_carimbado — a linha nasceu com
 *    essa data (DEFAULT do INSERT) e nenhum UPDATE a atualizou desde então
 *    (era o defeito da tabela antes da migration desta fase). Comparação
 *    exata: qualquer diferença, mesmo de milissegundos, já é sinal de que a
 *    trigger rodou pelo menos uma vez.
 * 4. Idade <= limite: recente, não exibe.
 * 5. Idade > limite: envelhecido, exibe.
 */
export function resolveConfiabilidadeSaldo(entrada: {
  updatedAt: string | null;
  createdAt: string | null;
  agora: Date;
}): ConfiabilidadeSaldo {
  const { updatedAt, createdAt, agora } = entrada;

  // 1. Sem updated_at, não há o que medir.
  if (updatedAt == null) {
    return {
      estado: "nao_medido",
      idadeDias: null,
      exibir: true,
      texto: "idade desconhecida",
      titulo: tituloNaoMedido(),
    };
  }

  const idadeDias = diferencaEmDias(updatedAt, agora);

  // 2. Data no futuro: relógio inconsistente, não "ajuste no futuro".
  if (idadeDias < 0) {
    return {
      estado: "nao_medido",
      idadeDias: null,
      exibir: true,
      texto: "idade desconhecida",
      titulo: tituloNaoMedido(),
    };
  }

  // 3. updated_at === created_at: nunca foi carimbado por um ajuste de verdade.
  if (createdAt != null && updatedAt === createdAt) {
    return {
      estado: "nunca_carimbado",
      idadeDias: null,
      exibir: true,
      texto: "data do ajuste desconhecida",
      titulo: tituloNuncaCarimbado(),
    };
  }

  // 4. Dentro do limite: recente, não exibe.
  if (idadeDias <= IDADE_SALDO_LIMITE_DIAS) {
    return {
      estado: "recente",
      idadeDias,
      exibir: false,
      texto: `ajustado há ${idadeDias} dia${idadeDias === 1 ? "" : "s"}`,
      titulo: `Saldo ajustado há ${idadeDias} dia${idadeDias === 1 ? "" : "s"} — dentro do ciclo de conferência.`,
    };
  }

  // 5. Acima do limite: envelhecido, exibe.
  return {
    estado: "envelhecido",
    idadeDias,
    exibir: true,
    texto: `${idadeDias} dias sem conferência`,
    titulo: tituloEnvelhecido(idadeDias),
  };
}
