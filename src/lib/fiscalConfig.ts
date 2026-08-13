/**
 * fiscalConfig.ts — normalização pura da configuração fiscal de UF/Flex entre
 * a tela e o banco (Fase 222, FISC-04/FISC-07/FLEX-04).
 *
 * POR QUE ESTE MÓDULO EXISTE: o padrão de conversão em uso hoje na tela
 * (`MLFiscal.tsx`, função `pct`, no caminho de gravação do Lucro Real) usa o
 * operador OR lógico para decidir entre o valor digitado e a ausência — e
 * esse operador trata zero como falsy, então qualquer valor que dê zero vira
 * ausência junto com o vazio de verdade. Esta fase inteira nasceu de um
 * zero de frete que virou ausência na ingestão (FLEX-02); este módulo
 * garante que o mesmo erro não se repita aqui, nem para o custo de entrega
 * Flex nem para as listas de UF.
 *
 * SEMÂNTICA DE TRÊS ESTADOS: `difal_ufs_recolhidas` e
 * `difal_ufs_cobradas_pelo_ml` (colunas do 222-01) têm três estados
 * possíveis — ausente (ainda não definido), array vazio (definido: nenhuma
 * UF) e array com siglas (definido: estas UFs). "Ainda não decidi" e
 * "decidi que não há nenhuma" são estados DIFERENTES e precisam continuar
 * diferentes depois de passar pela tela — colapsá-los é o mesmo erro do
 * frete zero virando ausência, agora em forma de array.
 *
 * Módulo PURO: sem React, sem IO, sem chamada de rede — testável por vitest
 * sem montar componente.
 */

import { UF_REGION } from "@/lib/tax/regions";

/**
 * As 27 siglas de UF, derivadas do mapa de regiões já existente no módulo
 * fiscal compartilhado — não é uma segunda lista digitada à mão, que
 * divergiria no dia em que alguém corrigisse uma e não a outra.
 */
export const UFS_BRASIL: readonly string[] = Object.keys(UF_REGION).sort();

export interface NormalizacaoUf {
  /**
   * `null` quando a entrada era `null` (estado "ainda não definido"
   * propagado). Array (possivelmente vazio) quando a entrada era uma
   * lista, já normalizada.
   */
  valor: string[] | null;
  /** Siglas descartadas por não serem UF válida — nunca ignoradas em silêncio. */
  descartadas: string[];
}

/**
 * Normaliza uma lista de siglas de UF: caixa alta, aparada, ordenada e sem
 * repetição. A entrada `null` preserva o estado "ainda não definido" na
 * saída — nunca é convertida em array vazio, que tem outro significado.
 */
export function normalizarListaUf(input: string[] | null): NormalizacaoUf {
  if (input === null) {
    return { valor: null, descartadas: [] };
  }

  const descartadas: string[] = [];
  const validas = new Set<string>();

  for (const raw of input) {
    const sigla = raw.trim().toUpperCase();
    if (sigla === "") continue;
    if ((UFS_BRASIL as string[]).includes(sigla)) {
      validas.add(sigla);
    } else {
      descartadas.push(sigla);
    }
  }

  return { valor: Array.from(validas).sort(), descartadas };
}

/**
 * Converte o estado do formulário (interruptor "já defini" + siglas
 * selecionadas) no valor a gravar no banco. É esta função que garante que
 * os três estados são alcançáveis pela interface:
 *   - `definido = false`               → ausência ("ainda não decidi")
 *   - `definido = true`, nada marcado  → array vazio ("decidi que não há nenhuma")
 *   - `definido = true`, siglas        → as siglas normalizadas
 *
 * Com `definido` falso, o resultado é sempre ausência — independentemente
 * do que estiver selecionado no momento (o interruptor manda).
 */
export function listaUfParaBanco(
  definido: boolean,
  selecionadas: string[]
): string[] | null {
  if (!definido) return null;
  return normalizarListaUf(selecionadas).valor ?? [];
}

/**
 * Normaliza o custo de uma entrega própria de Flex. Campo em branco grava
 * ausência (o custo ainda não foi informado); "0" grava zero (decisão: a
 * entrega não custa nada) — são estados diferentes, e é essa distinção que
 * o padrão de conversão em uso na tela hoje não preserva. Aceita vírgula
 * decimal, que é como se digita em português. Valor negativo ou não
 * numérico é tratado como entrada inválida e devolve ausência, nunca lixo.
 */
export function normalizarCustoEntrega(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const normalizado = trimmed.replace(",", ".");
  const valor = Number(normalizado);

  if (!Number.isFinite(valor) || valor < 0) return null;

  return valor;
}
