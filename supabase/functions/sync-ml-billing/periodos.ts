// periodos.ts — seleção PURA da fatura pela janela que ela cobre (BILL-02).
//
// Módulo sem I/O (sem fetch, sem imports Deno/URL): testável no vitest (Node)
// apesar de a EF (`index.ts`) rodar em Deno. Mesmo padrão de `aggregate.ts`.
//
// O DEFEITO QUE ESTE MÓDULO EXISTE PARA CORRIGIR (medido em 2026-08-06):
// a régua antiga derivava a chave da fatura do mês do CALENDÁRIO (consumo N →
// fatura N+1). Isso funciona por acidente quando o ciclo de cobrança da conta
// começa perto do dia 1º, e falha silenciosamente quando não começa.
//
// Medido nas duas contas ativas:
//   - Pé Vermeio (seller 1639558873): ciclo 06→05. Fatura `2026-08-01` cobre
//     06/07–05/08. A régua do mês acertava por sorte.
//   - Junior (seller 2359559427): ciclo **16→15**. Fatura `2026-08-01` cobre
//     16/07–15/08 e `2026-07-01` cobre 16/06–15/07. Com `period_month=2026-07`
//     a régua do mês pedia as faturas `2026-08` e `2026-09` — e **nunca** pedia
//     a `2026-07-01`, a fechada anterior. Resultado: a fatura de 2.086
//     movimentos do Junior nunca entrou no banco, e só entrou em 06/08 porque
//     alguém digitou a chave na mão. O buraco se repetiria todo mês.
//
// A régua nova não adivinha ciclo: pergunta ao ML quais faturas existem e pega
// as que COBREM as datas pedidas (`date_from ≤ data ≤ date_to`). Funciona para
// qualquer ciclo, inclusive um que mude.

export interface Fatura {
  key: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/** Aceita `2026-08-06` ou `2026-08-06T12:34:56.000-04:00` — a API do ML já
 *  devolveu os dois formatos. Comparação de janela é por dia, não por instante. */
function soData(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.length >= 10 ? s.slice(0, 10) : "";
}

const DIA_MS = 86_400_000;

/**
 * Normaliza um período cru do ML em `{key, from, to}`.
 *
 * Regra herdada de `resolveInvoice` (mantida byte-a-byte em intenção): no
 * período ABERTO o `date_from` vem com um placeholder antigo, produzindo uma
 * janela absurda de vários meses. Quando a janela passa de 60 dias, o `from`
 * real é derivado de `date_to − 1 mês + 1 dia`. Sem essa correção, o período
 * aberto "cobriria" qualquer data e engoliria a seleção inteira.
 *
 * Devolve `null` quando não dá para montar uma janela — sem `key`, sem `from`
 * ou sem `to`. Período sem janela não entra na seleção por data; quem chama
 * decide o que fazer (ver o fallback em `index.ts`).
 */
export function normalizarFatura(p: unknown): Fatura | null {
  if (!p || typeof p !== "object") return null;
  const obj = p as Record<string, unknown>;
  const key = String(obj.key ?? "").trim();
  if (!key) return null;

  const periodo = (obj.period ?? {}) as Record<string, unknown>;
  let from = soData(periodo.date_from);
  const to = soData(periodo.date_to);
  if (!from || !to) return null;

  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;

  if (toMs - fromMs > 60 * DIA_MS) {
    const d = new Date(toMs);
    d.setUTCMonth(d.getUTCMonth() - 1);
    d.setUTCDate(d.getUTCDate() + 1);
    from = d.toISOString().slice(0, 10);
  }
  return { key, from, to };
}

/**
 * As faturas que cobrem as datas pedidas, na ordem das datas, sem repetir.
 *
 * Comparação de string em ISO `YYYY-MM-DD` é ordenação cronológica — não
 * precisa de parse para o teste de janela, e não sofre com fuso.
 */
export function faturasQueCobrem(periodos: unknown[], datas: string[]): Fatura[] {
  const normalizadas = (periodos ?? []).map(normalizarFatura).filter((f): f is Fatura => f !== null);
  const vistas = new Set<string>();
  const saida: Fatura[] = [];
  for (const bruta of datas) {
    const data = soData(bruta);
    if (!data) continue;
    const achada = normalizadas.find((f) => f.from <= data && data <= f.to);
    if (achada && !vistas.has(achada.key)) {
      vistas.add(achada.key);
      saida.push(achada);
    }
  }
  return saida;
}

/**
 * As datas que o sync diário precisa cobrir: hoje (fatura aberta) e hoje−30
 * (fatura fechada anterior). Trinta dias garante cair no período anterior em
 * qualquer ciclo mensal, sem depender de saber qual é o dia de virada.
 */
export function datasAlvoDoSyncDiario(hojeISO: string): string[] {
  const hoje = soData(hojeISO);
  const ms = Date.parse(hoje);
  if (!Number.isFinite(ms)) return [];
  return [hoje, new Date(ms - 30 * DIA_MS).toISOString().slice(0, 10)];
}
