// ============================================================================
// dreInss — Phase 98 Plan 02, Task 1
//
// Módulo separado de `dreRegime.ts` porque resolve a régua M+1 de uma regra de
// FOLHA (encargo trabalhista), não de imposto sobre venda — mesmo padrão de
// competência (a guia de INSS que sai/vence em M+1 é o encargo sobre a folha
// do mês M), mas fonte de dado, categoria e ponto de fusão são diferentes
// (RESEARCH.md Open Question 2). O bloco `pessoal` da cascata (dreCascade.ts)
// hoje soma Salários + INSS sem distinção de régua; este módulo separa os
// dois: Salários fica no mesmo mês (sem deslocamento, fora de escopo desta
// phase), só o INSS desloca.
//
// Régua: previsão NUNCA desloca — só apuração usa M+1, mesmo padrão já
// implementado para ICMS/PIS/COFINS em `dreRegime.ts`/`useImpostoGuiaReal.ts`.
// `'cancelled'` nunca soma (crédito sem guia); `'paid'`/`'pending'` somam
// (régua de competência). Mês 100% crédito (todas canceladas) → 0, não null
// — mesma semântica de `apuracaoImpostoReal` em dreRegime.ts.
//
// `applyInssReal`/`resolveInssForCascade` NUNCA mutam `dreCascade.ts` — só
// consomem seu tipo `DreCascade` já pronto (buildDreCascade continua a fonte
// única de montagem da cascata). Sem import de React/Supabase — módulo puro,
// mesmo padrão de dreCascade.ts/dreRegime.ts/dreCloseGate.ts.
// ============================================================================

import type { DreRegime, GuiaRealCategoryTotal } from "./dreRegime";
import type { DreCascade, DreCascadeBlocoLine, DreOperationalRow } from "./dreCascade";

/** Fonte única da grafia da categoria de INSS de folha — evita divergência
 *  entre o filtro (`filterRawInssRow`) e a RPC (`get_inss_guia_by_competence`). */
export const INSS_FOLHA_CATEGORY = "Pessoal - INSS" as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Soma real do INSS de uma competência, filtrando `cancelled` (crédito, nunca
 * soma). Clone literal da regra `apuracaoImpostoReal` de dreRegime.ts:130-137,
 * mas para 1 categoria só. `null`/vazio → `null`; senão soma (podendo dar `0`
 * quando tudo é cancelado — mês 100% crédito, apuração aconteceu).
 */
export function resolveInssReal(guia: GuiaRealCategoryTotal[] | null): number | null {
  if (!guia || guia.length === 0) return null;
  return round2(
    guia.filter((g) => g.status !== "cancelled").reduce((sum, g) => sum + g.total, 0),
  );
}

/** Remove a linha crua de INSS (categoria INSS_FOLHA_CATEGORY) das linhas da
 *  RPC 87 antes de montar a cascata — o valor real (M+1) a substitui. No-op
 *  se não houver nenhuma linha de INSS. */
export function filterRawInssRow(rows: DreOperationalRow[]): DreOperationalRow[] {
  return rows.filter((r) => r.category !== INSS_FOLHA_CATEGORY);
}

/**
 * Funde o valor real de INSS (já deslocado M+1) no bloco `pessoal` de uma
 * cascata já montada. Curto-circuita em `inssReal == null` (NUNCA `!inssReal`
 * — quebraria o caso `0`, mês 100% crédito). Se o bloco `pessoal` existir,
 * soma ao seu total; se não existir, cria a linha na FRENTE do array (pessoal
 * é o primeiro bloco de OPERACIONAL_BLOCOS). Devolve sempre um novo objeto
 * `DreCascade` (nunca mutação in-place).
 */
export function applyInssReal(cascade: DreCascade, inssReal: number | null): DreCascade {
  if (inssReal == null) return cascade;

  const existingIndex = cascade.operacionalBlocos.findIndex((b) => b.bloco === "pessoal");

  let operacionalBlocos: DreCascadeBlocoLine[];
  if (existingIndex >= 0) {
    operacionalBlocos = cascade.operacionalBlocos.map((b, i) =>
      i === existingIndex ? { ...b, total: round2(b.total + inssReal) } : b,
    );
  } else {
    operacionalBlocos = [
      { bloco: "pessoal", label: "Pessoal", total: round2(inssReal), doubleCountRisk: false },
      ...cascade.operacionalBlocos,
    ];
  }

  const totalOperacionalDeducoes = round2(cascade.totalOperacionalDeducoes + inssReal);
  const resultadoOperacional = round2(cascade.resultadoOperacional - inssReal);
  const resultadoLiquido = round2(cascade.resultadoLiquido - inssReal);

  return {
    ...cascade,
    operacionalBlocos,
    totalOperacionalDeducoes,
    resultadoOperacional,
    resultadoLiquido,
  };
}

/**
 * Portão previsão×apuração: previsão NUNCA desloca (devolve `rows` intactas e
 * `inssReal: null`, mesmo que `guia` tenha dado real presente). Apuração
 * filtra a linha crua e resolve o valor real via `resolveInssReal`.
 */
export function resolveInssForCascade(input: {
  regime: DreRegime;
  rows: DreOperationalRow[];
  guia: GuiaRealCategoryTotal[] | null;
}): { rows: DreOperationalRow[]; inssReal: number | null } {
  const { regime, rows, guia } = input;
  if (regime !== "apuracao") {
    return { rows, inssReal: null };
  }
  return { rows: filterRawInssRow(rows), inssReal: resolveInssReal(guia) };
}
