// ============================================================================
// Fase 214 — Task 4: cursor retomavel da varredura do Tiny.
//
// Modulo PURO: decide a proxima acao a partir do estado persistido. Nao lê
// banco, nao chama rede, nao tem relogio proprio.
// ============================================================================

export interface ItemFila {
  tiny_id: string;
  sku: string;
}

export interface EstadoCursor {
  fase: "catalogo" | "estoque";
  fila: ItemFila[];
  indice: number;
  volta_iniciada: string | null;
  volta_completa: string | null;
}

export type Acao =
  | { tipo: "iniciar_volta" }
  | { tipo: "seguir_estoque"; de: number }
  | { tipo: "fechar_volta" };

/**
 * Decide o que a Edge Function faz nesta invocacao.
 *
 * REGRA CENTRAL: a volta so reinicia depois de FECHAR por inteiro. Nunca por
 * virada de data. O sync equivalente do nexo-mcp reseta com
 * `snapshot_date !== today` e por isso cobre ~15% do catalogo e nunca fecha uma
 * volta: como uma volta leva ~14 minutos e o cron roda de madrugada, a virada
 * do dia empurrava a varredura de volta ao inicio, para sempre.
 *
 * `agora` entra na assinatura para que essa regra seja TESTAVEL — para que
 * exista um teste que passa duas datas diferentes e exige a mesma acao. Nao e
 * usado para decidir reset, e nao deve passar a ser.
 */
export function proximaAcao(estado: EstadoCursor | null, _agora: Date): Acao {
  // Sem estado: primeira execucao desta organizacao.
  if (!estado) return { tipo: "iniciar_volta" };

  // Fase `catalogo` significa que a fila ainda nao foi montada.
  if (estado.fase === "catalogo") return { tipo: "iniciar_volta" };

  // A volta anterior FECHOU: e so aqui que uma nova comeca.
  if (estado.volta_completa !== null) return { tipo: "iniciar_volta" };

  // Fila esgotada (ou vazia) com a volta aberta: fecha em vez de girar em falso.
  if (estado.indice >= estado.fila.length) return { tipo: "fechar_volta" };

  // Volta em andamento: retoma exatamente de onde parou. Indice negativo nunca
  // faz a varredura andar para tras.
  return { tipo: "seguir_estoque", de: Math.max(0, estado.indice) };
}
