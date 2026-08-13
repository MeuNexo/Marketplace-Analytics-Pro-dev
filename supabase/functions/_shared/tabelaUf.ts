/**
 * tabelaUf.ts — monta `TabelaAliquotasInternas` a partir das linhas cruas de
 * `public.aliquota_interna_vigente(date)` (Fase 222, plano 222-05).
 *
 * Módulo PURO, no mesmo molde de `orderTaxRate.ts` e `flexOrder.ts`: nenhum
 * import remoto nem referência ao runtime das edge functions, zero IO —
 * quem lê o banco (`aliquota_interna_vigente`) é a edge function, UMA vez
 * por rodada (nunca dentro do laço de pedidos); este módulo só transforma o
 * array já em memória, sem saber de onde ele veio.
 *
 * POR QUE ISTO É UM MÓDULO PRÓPRIO, E NÃO CÓDIGO DENTRO DA EDGE FUNCTION: a
 * mesma transformação precisa acontecer identicamente em `sync-ml-orders` e
 * em `recalc-order-costs` (as duas portas de escrita do imposto) — copiar a
 * lógica de montagem para as duas seria reabrir a lição da Fase 220 (três
 * cópias divergentes da mesma fórmula).
 */

import type { TabelaAliquotasInternas } from "./orderTaxRate";

/**
 * Linha crua devolvida por `aliquota_interna_vigente(p_data date)`
 * (assinatura em `222-01-SUMMARY.md`): `uf char(2), aliq_interna numeric,
 * aliq_fcp numeric, confirmado boolean`. Os campos numéricos chegam como
 * `unknown` de propósito — o driver Postgres/PostgREST costuma devolver
 * `numeric` como STRING para não perder precisão, e este módulo não pode
 * depender do chamador já ter convertido.
 */
export interface LinhaAliquotaUf {
  uf: unknown;
  aliq_interna: unknown;
  aliq_fcp?: unknown;
  confirmado?: unknown;
}

function normalizarSigla(uf: unknown): string {
  return String(uf ?? "").trim().toUpperCase();
}

/**
 * Número finito e não negativo, aceitando `number` ou `string` numérica.
 * `null`/`undefined` devolvem `null` (ausência) — quem chama decide se
 * ausência é "vira zero" (FCP) ou "descarta a linha" (aliq_interna).
 * Qualquer outra coisa não conversível (string não numérica, negativo,
 * `NaN`, `Infinity`) também devolve `null`.
 */
function numeroValidoNaoNegativo(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Monta a tabela de alíquota interna de ICMS + FCP por UF a partir das
 * linhas cruas do banco.
 *
 * - `[]`/`null`/`undefined` devolvem `{}` — é o caso "a tabela não
 *   carregou": o consumidor (`resolverDifal`, `orderTaxRate.ts`) trata toda
 *   UF como fora da tabela, e o DIFAL sai ausente, nunca zero.
 * - Chaveia por sigla em CAIXA ALTA, sigla aparada de espaço.
 * - `confirmado` só é `true` quando a linha trouxer `confirmado === true`
 *   literal — `false`, `null`, ausente ou qualquer valor não booleano vira
 *   `false`: linha sem confirmação humana nunca é tratada como confirmada
 *   por omissão.
 * - Duas linhas para a mesma UF (mesma sigla normalizada) fazem a função
 *   LANÇAR ERRO: a unicidade é garantida pelo banco (vigência sem
 *   sobreposição, migration do 222-01), e se chegou duplicado algo quebrou
 *   antes deste módulo — nunca escolher uma das duas em silêncio. A
 *   detecção acontece ANTES de validar os números, para pegar duplicata
 *   mesmo quando uma das duas linhas seria descartada por outro motivo.
 * - `aliq_interna` não numérica, negativa ou não finita descarta A LINHA
 *   INTEIRA (não entra no objeto devolvido) — nunca vira zero silencioso.
 * - `aliq_fcp` ausente (`null`/`undefined`/campo não veio) vira `0` — é o
 *   caso comum e é valor conhecido. `aliq_fcp` presente mas inválido (não
 *   numérico, negativo, não finito) descarta a linha inteira, pelo mesmo
 *   motivo do `aliq_interna`.
 */
export function montarTabelaAliquotas(
  linhas: LinhaAliquotaUf[] | null | undefined,
): TabelaAliquotasInternas {
  const tabela: TabelaAliquotasInternas = {};
  if (!linhas || linhas.length === 0) return tabela;

  const vistos = new Set<string>();
  for (const linha of linhas) {
    const sigla = normalizarSigla(linha.uf);
    if (vistos.has(sigla)) {
      throw new Error(
        `montarTabelaAliquotas: UF duplicada na tabela de alíquotas (${sigla}) — a unicidade deveria ser garantida pelo banco`,
      );
    }
    vistos.add(sigla);

    const aliqInterna = numeroValidoNaoNegativo(linha.aliq_interna);
    if (aliqInterna === null) continue; // descartada, nunca vira zero silencioso

    let aliqFcp = 0;
    if (linha.aliq_fcp != null) {
      const fcpValido = numeroValidoNaoNegativo(linha.aliq_fcp);
      if (fcpValido === null) continue; // FCP inválido descarta a linha inteira
      aliqFcp = fcpValido;
    }

    tabela[sigla] = {
      aliqInterna,
      aliqFcp,
      confirmado: linha.confirmado === true,
    };
  }

  return tabela;
}
