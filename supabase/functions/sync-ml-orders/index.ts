/**
 * sync-ml-orders — captura de pedidos do ML e escrita em `orders`.
 *
 * INTERRUPTORES DE BACKFILL (variaveis de ambiente da edge function).
 * Os dois seguem a MESMA regra: DESLIGADOS por padrao — ausencia da variavel e
 * falso, nunca verdadeiro — e ligados so durante o backfill, porque cada um
 * alarga o predicado de "pedido ja completo" e faz o historico voltar a ser
 * buscado no ML. Manter qualquer um deles ligado depois do backfill faria toda
 * rodada horaria pagar por um dado que ja esta no banco.
 *
 *   BACKFILL_LOGISTIC_TYPE=true   → exige `logistic_type` preenchido (Fase 222,
 *                                    FLEX-01). Desligar ao fim do backfill
 *                                    (222-PROVA.md, Passo 8).
 *   BACKFILL_FRETE_COMPRADOR=true → exige `frete_comprador` preenchido (Fase
 *                                    222, D-R2-04 / 222-13-R2). Desligar ao fim
 *                                    do backfill, pelo mesmo motivo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA FUNÇÃO TEM UMA SEGUNDA PASSADA (Fase 225, plano 225-10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O NÚMERO. A ingestão perdeu **26 pedidos reais de 2026 — 0,29% do volume,
 * R$ 5.172,15 de receita paga que não existia no banco** (`225-CENSO-PEDIDOS.md`).
 * A medição foi diferença de CONJUNTO de identificadores contra a API: 28 ids no
 * ML e não em `orders`, **zero** em `orders` e não no ML, e 2 dos 28 eram apenas
 * pendentes do próprio dia da medição.
 *
 * O MECANISMO, PROVADO E DIFERENTE DO QUE ESTE ARQUIVO SUGERIA:
 * **`/orders/search` só indexa pedido FECHADO.** Nos 9.097 pedidos do censo,
 * `date_closed` está preenchido em 9.097 — 100%. Zero `confirmed`,
 * `payment_required` ou `payment_in_process`. E a prova pelo contra-exemplo:
 * dois pedidos da Pé Vermeio com `date_closed` nulo existem no ML e **não
 * aparecem em janela nenhuma da busca**, nem com filtro de cancelado; foram
 * achados por fonte independente (`cash_inflows`).
 *
 * A CONSEQUÊNCIA, EM UMA FRASE: o sistema procura pedido por *quando foi criado*
 * e só até D+3 — o corpo VIVO de `dispatch_orders_jobs` tem `v_dias_retro := 3`,
 * que a migration do repositório nem mostra — mas o ML só devolve o pedido
 * *quando ele fecha*. Quem fecha depois da última varredura da própria janela
 * some, e some **para sempre**, porque `reconcileCancelled` — a única passada
 * posterior sobre janela antiga — só faz `update` de status e **NUNCA INSERT**.
 *
 * A EVIDÊNCIA QUANTITATIVA: dos 35 pedidos de 2026 com `date_closed` mais de 24h
 * depois de `date_created`, **12 estão ausentes (34%)**; dos 22 com mais de 48h,
 * **10 ausentes (45%)**. Contra uma taxa de base de 0,29% — enriquecimento de
 * **110×**. O maior atraso de fechamento observado em 2026 foi de **292 horas**
 * (~12 dias).
 *
 * O QUE ESTE ARQUIVO PASSOU A TER:
 *   • modo de CONFERÊNCIA (`audit_only`) — leitura pura, colhe os ids do ML dia
 *     a dia e compara CONJUNTOS contra `orders`, nos dois sentidos;
 *   • modo de RECAPTURA (`only_missing` + `order_ids`) — busca por id
 *     (`GET /orders/{id}`), o caminho barato e determinístico, e descarta o que
 *     já existe ANTES de qualquer chamada de enriquecimento;
 *   • REPESCAGEM de 30 dias pendurada na rodada diária, que rejanela por
 *     `date_created` e recupera o que fechou tarde.
 *
 * 🔴 `paging.total` NÃO É CONTAGEM. O censo mediu 9.307 declarados contra 9.097
 * ids únicos (+2,3%), com o total excedendo os ids únicos em 143 dos 247 dias —
 * inclusive em dias de uma única página. Ele continua servindo de critério de
 * parada de paginação em `fetchOrdersPage`/`reconcileCancelled`, e de nada mais.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  computeOrderTax,
  camposFiscaisParaUpsert,
  type TabelaDifal,
} from "../_shared/orderTaxRate.ts";
import { montarTabelaAliquotas } from "../_shared/tabelaUf.ts";
import {
  resolverConfigVigente,
  type LinhaTaxConfigVigencia,
} from "../_shared/taxConfigVigente.ts";
import {
  extrairLogisticType,
  ehFlex,
  extrairBonusEnvio,
  extrairFreteComprador,
  ratearPorReceita,
  computeReceitaLiquida,
} from "../_shared/flexOrder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Normalise ML listing_type_id → "classic" | "premium" | "free"
// Current Brazil tiers (2024):
//   gold_special  → Clássico  ~11%
//   gold_pro      → Premium   ~16%
//   gold_premium  → Premium   ~16%  (legacy name)
//   gold          → Clássico  (legacy tier)
//   gold_extra_full → Premium (some categories)
//   silver / bronze / free → Grátis ~0%
const LISTING_TYPE_MAP: Record<string, string> = {
  gold_special:      "classic",
  gold_pro:          "premium",
  gold_premium:      "premium",
  gold_extra_full:   "premium",
  gold:              "classic",
  silver:            "free",
  bronze:            "free",
  free:              "free",
  gold_extra:        "classic",
};

// ── ML fetch helper (same pattern as mercado-libre-integration) ───────────────

// 2026-08-06 (fix frete mudo): mesmo buraco corrigido em sync-ml-billing
// (fetchPage, commit 80ad218b) — AbortSignal.timeout lanca excecao, nao
// devolve status, entao escapava direto do `if (res.status === 429 ...)`
// que existia antes e nunca fazia uma segunda tentativa. Agora o fetch fica
// dentro de try/catch proprio, com ate 5 tentativas e backoff crescente
// (1_500 * (tentativa + 1)) tanto na excecao quanto em 429/5xx. Erro de
// cliente (4xx que nao seja 429, ou JSON invalido) lanca direto — nao se
// resolve tentando de novo.
async function mlFetch(path: string, accessToken: string, timeoutMs = 15_000) {
  let ultimoErro = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${ML_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
      console.warn(`mlFetch ${path}: ${ultimoErro} (tentativa ${attempt + 1}/5)`);
      await sleep(1_500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      ultimoErro = `status ${res.status}`;
      console.warn(`mlFetch ${path}: ${ultimoErro} (tentativa ${attempt + 1}/5)`);
      await sleep(1_500 * (attempt + 1));
      continue;
    }
    const data = await res.json();
    if (!res.ok) {
      console.error(`ML API error [${path}]:`, data);
      throw new Error(data.message || `ML API error: ${res.status}`);
    }
    return data;
  }
  throw new Error(`mlFetch ${path}: falhou apos 5 tentativas (ultimo erro: ${ultimoErro})`);
}

// ── A ÚNICA régua de janela BRT deste arquivo ────────────────────────────────
// Meia-noite BRT = 03:00Z. Esta função é a única que conhece esse número, e é de
// propósito: a captura e a conferência precisam montar EXATAMENTE a mesma
// janela, senão o diff de conjuntos acusa como ausente um pedido que só caiu do
// outro lado da borda. Duas noções da mesma janela divergindo em silêncio é a
// classe de defeito que derrubou o saldo na Fase 233 — por isso o portão de
// forma exige que o literal apareça uma vez só, e aqui dentro.
function janelaBRT(dateFrom: string, dateTo: string): { rangeStart: Date; rangeEnd: Date } {
  const rangeStart   = new Date(`${dateFrom}T03:00:00.000Z`);
  const rangeEndBase = new Date(`${dateTo}T03:00:00.000Z`);
  rangeEndBase.setUTCDate(rangeEndBase.getUTCDate() + 1);
  return { rangeStart, rangeEnd: new Date(rangeEndBase.getTime() - 1) };
}

// Desloca um dia do calendário (YYYY-MM-DD) por N passos. Ancorado ao meio-dia
// UTC de propósito: qualquer aritmética de dia ancorada na meia-noite passa a
// depender do fuso do runtime, e é assim que se produz o defeito dos 111 pedidos
// gravados um dia antes (225-CENSO-PEDIDOS.md, seção 5).
function deslocarDia(dia: string, passos: number): string {
  const d = new Date(`${dia}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + passos);
  return d.toISOString().substring(0, 10);
}

function diasDaJanela(dateFrom: string, dateTo: string): string[] {
  const dias: string[] = [];
  let atual = dateFrom;
  // Teto de segurança: janela maior que um ano é erro de chamada, não pedido.
  for (let i = 0; i < 400 && atual <= dateTo; i++) {
    dias.push(atual);
    atual = deslocarDia(atual, 1);
  }
  return dias;
}

// ── Paginated order fetch with auto-split when total > 950 ────────────────────

async function fetchOrdersPage(
  mlNumericId: number,
  dateFrom: string,
  dateTo: string,
  accessToken: string,
): Promise<any[]> {
  const PAGE_SIZE = 50;
  const MAX_OFFSET = 1000;
  let allOrders: any[] = [];
  let offset = 0;
  let apiTotal = 0;

  while (offset < MAX_OFFSET) {
    const url =
      `/orders/search?seller=${mlNumericId}` +
      `&order.date_created.from=${encodeURIComponent(dateFrom)}` +
      `&order.date_created.to=${encodeURIComponent(dateTo)}` +
      `&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`;

    const data = await mlFetch(url, accessToken);
    const results: any[] = data.results || [];
    allOrders = allOrders.concat(results);
    apiTotal = data.paging?.total || 0;
    offset += results.length;
    if (results.length < PAGE_SIZE || offset >= apiTotal) break;
  }

  // NOTA: esta busca janela por `order.date_created`. Cancelamentos que
  // acontecem depois da captura NÃO chegam por aqui — ver reconcileCancelled().

  // Se batemos no teto de offset, divide a janela em duas e recursa
  if (apiTotal > MAX_OFFSET - 50) {
    const fromMs = new Date(dateFrom).getTime();
    const toMs   = new Date(dateTo).getTime();
    const diffMs = toMs - fromMs;

    if (diffMs > 60 * 60 * 1000) {
      const midMs     = fromMs + Math.floor(diffMs / 2);
      const midIso    = new Date(midMs).toISOString();
      const midEndIso = new Date(midMs - 1).toISOString();

      console.log(
        `⚠️ Splitting: ${apiTotal} orders in ${dateFrom} → ${dateTo}`,
      );

      const [half1, half2] = await Promise.all([
        fetchOrdersPage(mlNumericId, dateFrom, midEndIso, accessToken),
        fetchOrdersPage(mlNumericId, midIso, dateTo, accessToken),
      ]);
      return [...half1, ...half2];
    }

    console.warn(
      `⚠️ TRUNCATION: ${apiTotal} orders in <1h window; some orders may be missing`,
    );
  }

  return allOrders;
}

// ── Reconciliação de cancelamentos tardios ───────────────────────────────────
// Pergunta ao ML quais pedidos da janela estão cancelados e corrige no banco os
// que ainda constam com outro status. Necessário porque fetchOrdersPage janela
// por `date_created`: um pedido cancelado depois da captura inicial nunca
// reaparece e o status congela.
//
// Busca com `order.status=cancelled` em vez de varrer por `last_updated` — o
// conjunto de cancelados é uma fração pequena do total, então isso custa poucas
// páginas em vez de reprocessar milhares de pedidos inalterados.
async function reconcileCancelled(
  mlNumericId: number,
  rangeStart: Date,
  rangeEnd: Date,
  accessToken: string,
  supabaseAdmin: any,
  organizationId: string | null,
): Promise<number> {
  if (!organizationId) return 0;

  const PAGE_SIZE = 50;
  const MAX_OFFSET = 1000;
  const ids: string[] = [];
  let offset = 0;

  try {
    while (offset < MAX_OFFSET) {
      const url =
        `/orders/search?seller=${mlNumericId}` +
        `&order.date_created.from=${encodeURIComponent(rangeStart.toISOString())}` +
        `&order.date_created.to=${encodeURIComponent(rangeEnd.toISOString())}` +
        `&order.status=cancelled&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`;

      const data = await mlFetch(url, accessToken);
      const results: any[] = data.results || [];
      for (const o of results) ids.push(String(o.id));

      const apiTotal = data.paging?.total || 0;
      offset += results.length;
      if (results.length < PAGE_SIZE || offset >= apiTotal) break;
    }
  } catch (err) {
    // Reconciliação é complementar: se falhar, o sync principal já gravou os
    // pedidos. Registra e segue — não derruba o job inteiro por causa dela.
    console.error("reconcileCancelled: falha ao buscar cancelados no ML:", err);
    return 0;
  }

  if (ids.length === 0) return 0;

  // Corrige em lotes; só toca em quem está com status diferente, para que
  // `updated` reflita cancelamentos que o sync tinha perdido de verdade.
  let corrigidos = 0;
  const LOTE = 200;
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("organization_id", organizationId)
      .in("ml_order_id", lote)
      .neq("status", "cancelled")
      .select("ml_order_id");

    if (error) {
      console.error("reconcileCancelled: falha ao atualizar lote:", error.message);
      continue;
    }
    corrigidos += (data ?? []).length;
  }

  return corrigidos;
}

// ═══════════════════════════════════════════════════════════════════════════
// 225-10 — A SEGUNDA PASSADA: conferir por conjunto de ids, recapturar por id
// ═══════════════════════════════════════════════════════════════════════════

interface ResultadoConferencia {
  dias_examinados: number;
  dias_com_divergencia: number;
  dias_nao_medidos: number;
  dias_nao_medidos_lista: string[];
  bordas_nao_medidas: number;
  ids_ml_unicos: number;
  ids_banco_na_janela: number;
  ausentes_no_banco: string[];
  ausentes_no_ml: string[];
  maior_atraso_horas: number | null;
  atraso_denominador: number;
  sem_data_de_fechamento: number;
}

/**
 * Lê os identificadores de pedido de `orders` numa faixa de `data_pedido`.
 *
 * 🔴 Faixa EXPLÍCITA e contagem no servidor, sempre: o PostgREST trunca em 1.000
 * linhas **em silêncio**, e `orders` tem uma linha por ITEM — um mês passa de
 * 1.000 com folga. Truncar aqui não devolve menos dado, devolve um diff que
 * INVENTA ausências. Por isso a divergência entre o total declarado e o
 * recebido é exceção, e nunca um número menor devolvido calado.
 */
async function lerIdsDoBanco(
  supabaseAdmin: any,
  organizationId: string,
  dataDe: string,
  dataAte: string,
): Promise<Set<string>> {
  const PAGINA = 1000;
  const ids = new Set<string>();
  let recebidas = 0;
  let totalDeclarado: number | null = null;

  for (let pagina = 0; pagina < 200; pagina++) {
    const { data, error, count } = await supabaseAdmin
      .from("orders")
      .select("ml_order_id", { count: "exact" })
      .eq("organization_id", organizationId)
      .gte("data_pedido", dataDe)
      .lte("data_pedido", dataAte)
      .order("id", { ascending: true })
      .range(recebidas, recebidas + PAGINA - 1);

    if (error) throw new Error(`lerIdsDoBanco: leitura de orders falhou (${error.message})`);
    if (totalDeclarado === null) totalDeclarado = typeof count === "number" ? count : null;

    const linhas = (data ?? []) as any[];
    for (const l of linhas) ids.add(String(l.ml_order_id));
    recebidas += linhas.length;
    if (linhas.length < PAGINA) break;
  }

  if (totalDeclarado !== null && recebidas !== totalDeclarado) {
    throw new Error(
      `lerIdsDoBanco: leitura truncada — servidor declarou ${totalDeclarado} linhas e recebi ${recebidas}`,
    );
  }
  return ids;
}

/**
 * Separa, de uma lista de identificadores, os que NÃO existem em `orders` para
 * esta organização.
 *
 * 🔴 PREDICADO PRÓPRIO, e nunca o de `jaCompletos`. Aquele serve a outro
 * propósito — decidir quem precisa de nova consulta de envio — e é ALARGADO
 * pelos interruptores de backfill. Reaproveitá-lo faria a recaptura reprocessar
 * pedido antigo no dia em que alguém ligasse um interruptor, e reescrever pedido
 * preexistente é regressão cara e silenciosa: os campos fiscais de `orders`
 * foram validados pela contadora na Fase 222.
 *
 * Aqui a pergunta é uma só: existe em `orders` para esta organização? Então não
 * entra.
 *
 * Falha de leitura LANÇA. Degradar para "a lista veio vazia, logo nenhum existe"
 * inverteria exatamente a garantia que esta função existe para dar.
 */
async function filtrarIdentificadoresAusentes(
  supabaseAdmin: any,
  organizationId: string,
  identificadores: string[],
): Promise<{ ausentes: string[]; descartados: string[] }> {
  const LOTE = 100;
  const presentes = new Set<string>();

  for (let i = 0; i < identificadores.length; i += LOTE) {
    const lote = identificadores.slice(i, i + LOTE);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("ml_order_id")
      .eq("organization_id", organizationId)
      .in("ml_order_id", lote);

    if (error) {
      throw new Error(`filtrarIdentificadoresAusentes: leitura de orders falhou (${error.message})`);
    }
    const linhas = (data ?? []) as any[];
    if (linhas.length >= 1000) {
      throw new Error(
        "filtrarIdentificadoresAusentes: lote devolveu 1.000 linhas — teto do PostgREST atingido, reduza o lote",
      );
    }
    for (const r of linhas) presentes.add(String(r.ml_order_id));
  }

  return {
    ausentes:    identificadores.filter((id) => !presentes.has(id)),
    descartados: identificadores.filter((id) =>  presentes.has(id)),
  };
}

/**
 * Colhe pedidos um a um por `GET /orders/{id}`.
 *
 * É o caminho barato e determinístico para os já perdidos, e o único que os
 * alcança: a busca retroativa não devolve o que não está indexado, e varrer por
 * `date_last_updated` no passado acha 3 de 12 (medido, 225-CENSO-PEDIDOS.md §3).
 *
 * Recusa do ML é CONTADA com o motivo, nunca engolida — 26 menos um sem
 * explicação é pior que 25 com motivo.
 */
async function buscarPedidosPorId(
  identificadores: string[],
  accessToken: string,
): Promise<{ pedidos: any[]; recusados: { id: string; motivo: string }[] }> {
  const pedidos: any[] = [];
  const recusados: { id: string; motivo: string }[] = [];

  for (const id of identificadores) {
    try {
      const pedido = await mlFetch(`/orders/${id}`, accessToken);
      if (pedido?.id == null) {
        recusados.push({ id, motivo: "resposta do ML sem id de pedido" });
        continue;
      }
      pedidos.push(pedido);
    } catch (err) {
      recusados.push({ id, motivo: err instanceof Error ? err.message : String(err) });
    }
  }

  return { pedidos, recusados };
}

/**
 * MODO DE CONFERÊNCIA — leitura pura. Nenhuma porta de escrita, por contrato e
 * por portão de forma.
 *
 * 🔴 COMPARA CONJUNTOS DE IDENTIFICADORES SOBRE A JANELA INTEIRA, nunca
 * contagens por dia. É isso que a torna imune ao defeito lateral dos 111 pedidos
 * gravados no dia anterior ao correto (225-CENSO-PEDIDOS.md §5): eles estão no
 * banco, apenas na data errada, e uma comparação por balde de dia os reportaria
 * como ausentes de um dia e sobrando em outro.
 *
 * OS DOIS SENTIDOS DO DIFF, e por que cada um usa uma régua diferente:
 *   • ML \ banco  — pergunta a `orders` pelos ids colhidos, sem tocar em data
 *     nenhuma. Imune à régua de `data_pedido` por construção.
 *   • banco \ ML  — precisa de uma faixa de `data_pedido`, então é aqui que o
 *     deslocamento de um dia poderia mentir. Neutralizado colhendo também o dia
 *     ANTERIOR e o SEGUINTE da janela e usando esse conjunto alargado só neste
 *     sentido. Se uma borda não puder ser medida, o número sai marcado.
 *
 * Dia com falha de rede sai como NÃO MEDIDO. Contar zero diferença num dia que
 * não foi perguntado é a mentira mais fácil de contar aqui.
 */
async function conferirJanela(
  mlNumericId: number,
  dateFrom: string,
  dateTo: string,
  accessToken: string,
  supabaseAdmin: any,
  organizationId: string,
): Promise<ResultadoConferencia> {
  const dias = diasDaJanela(dateFrom, dateTo);
  const idsPorDia = new Map<string, string[]>();
  const naoMedidos: string[] = [];
  const vistos = new Set<string>();

  // O vigia da folga sai de graça: `date_closed` já vem no payload da busca que
  // esta função lê de qualquer forma. Zero chamada extra, zero endpoint novo.
  let maiorAtrasoMs = -1;
  let atrasoDenominador = 0;
  let semDataDeFechamento = 0;

  for (const dia of dias) {
    try {
      const { rangeStart, rangeEnd } = janelaBRT(dia, dia);
      const brutos = await fetchOrdersPage(
        mlNumericId,
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
        accessToken,
      );

      const doDia = new Set<string>();
      for (const o of brutos) {
        const id = String(o.id);
        if (doDia.has(id)) continue;
        doDia.add(id);
        if (vistos.has(id)) continue;
        vistos.add(id);

        const criado  = o.date_created ? Date.parse(o.date_created) : NaN;
        const fechado = o.date_closed  ? Date.parse(o.date_closed)  : NaN;
        if (!Number.isFinite(fechado)) {
          // Pedido sem data de fechamento não tem ATRASO, tem AUSÊNCIA — e o
          // censo já mostrou que essa é a classe cega da busca. Contado à parte.
          semDataDeFechamento++;
        } else if (Number.isFinite(criado)) {
          atrasoDenominador++;
          if (fechado - criado > maiorAtrasoMs) maiorAtrasoMs = fechado - criado;
        }
      }
      idsPorDia.set(dia, Array.from(doDia));
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      naoMedidos.push(dia);
      console.warn(`conferirJanela: dia ${dia} NAO MEDIDO (${motivo})`);
    }
  }

  // Bordas: só alimentam o sentido banco \ ML, para o deslocamento de um dia
  // não virar falso fantasma.
  const idsDeBorda = new Set<string>();
  let bordasNaoMedidas = 0;
  for (const borda of [deslocarDia(dateFrom, -1), deslocarDia(dateTo, 1)]) {
    try {
      const { rangeStart, rangeEnd } = janelaBRT(borda, borda);
      const brutos = await fetchOrdersPage(
        mlNumericId,
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
        accessToken,
      );
      for (const o of brutos) idsDeBorda.add(String(o.id));
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      bordasNaoMedidas++;
      console.warn(`conferirJanela: borda ${borda} NAO MEDIDA (${motivo})`);
    }
  }

  const idsML = Array.from(vistos);
  const { ausentes } = await filtrarIdentificadoresAusentes(supabaseAdmin, organizationId, idsML);

  const idsBanco = await lerIdsDoBanco(supabaseAdmin, organizationId, dateFrom, dateTo);
  const alargado = new Set<string>(idsML);
  for (const id of idsDeBorda) alargado.add(id);
  const ausentesNoMl = Array.from(idsBanco).filter((id) => !alargado.has(id));

  const conjuntoAusentes = new Set(ausentes);
  let diasComDivergencia = 0;
  for (const idsDoDia of idsPorDia.values()) {
    if (idsDoDia.some((id) => conjuntoAusentes.has(id))) diasComDivergencia++;
  }

  return {
    dias_examinados:        idsPorDia.size,
    dias_com_divergencia:   diasComDivergencia,
    dias_nao_medidos:       naoMedidos.length,
    dias_nao_medidos_lista: naoMedidos,
    bordas_nao_medidas:     bordasNaoMedidas,
    ids_ml_unicos:          idsML.length,
    ids_banco_na_janela:    idsBanco.size,
    ausentes_no_banco:      ausentes,
    ausentes_no_ml:         ausentesNoMl,
    maior_atraso_horas:     maiorAtrasoMs >= 0 ? Math.round((maiorAtrasoMs / 3_600_000) * 100) / 100 : null,
    atraso_denominador:     atrasoDenominador,
    sem_data_de_fechamento: semDataDeFechamento,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 225-10 — A REPESCAGEM: rejanelar por data de CRIAÇÃO, sem cron novo
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 POR QUE REJANELAR POR DATA DE CRIAÇÃO E NÃO VARRER POR DATA DE ATUALIZAÇÃO.
// Esta é a decisão de desenho mais fácil de reverter por engano daqui a seis
// meses, então o motivo fica aqui com os dois números que o censo mediu:
//
//   • A varredura por `date_last_updated` alcança 28/28 PROSPECTIVAMENTE, mas
//     NÃO funciona em retrospectiva: o filtro casa com o valor ATUAL, que já
//     andou por eventos de entrega. No teste retroativo o censo achou
//     **3 de 12**.
//   • A rejanela por `date_created` funciona NOS DOIS SENTIDOS, e o censo
//     provou isso sem querer: repetindo o algoritmo do sync sobre os cinco dias
//     afetados, **"hoje o ML devolve todos os 28"**. O pedido entra no índice
//     quando FECHA, e a data de criação dele continua sendo a mesma.
//   • Uma passada só, retro-capaz, é melhor que duas passadas em que a de trás
//     é cega. Duas réguas para o mesmo fato divergindo em silêncio é o padrão
//     que quebrou o saldo na Fase 233.
//
// ⚠️ O LIMITE RESIDUAL, ESCRITO EM VEZ DE ESCONDIDO: um pedido que feche mais de
// 30 dias depois de criado escaparia desta janela. O maior atraso observado em
// 2026 foi de 292 horas (~12 dias), então há folga de 2,5×, e ZERO ocorrências
// medidas acima de 30 dias. Se algum dia aparecer uma, a resposta é ALARGAR a
// janela, ou acrescentar a varredura prospectiva por data de atualização como
// SEGUNDA rede — nunca trocar uma pela outra.
//
// POR QUE A ASSINATURA DA RODADA DIÁRIA SERVE DE TRAVA, SEM TABELA NOVA: o cron
// insere jobs de um dia só, e a sincronização manual da tela usa faixa
// arbitrária. Se por acaso uma manual coincidir, a repescagem roda duas vezes no
// mesmo dia — e rodar duas vezes é inofensivo, porque ela só INSERE o que falta.
// **A trava protege contra custo, não contra correção.**

const REPESCAGEM_JANELA_DIAS = 30;
// Teto de dias examinados por invocação. O bloqueio por excesso do ML é por
// ENDEREÇO DE ORIGEM e derrubaria as outras sincronizações junto: recuar é
// obrigatório, insistir não. Os 30 dias são cobertos em rodízio de blocos, sem
// estado novo em tabela — o bloco sai do próprio dia do calendário.
const REPESCAGEM_TETO_DIAS = 10;
// Teto de pedidos recuperados por invocação. O resto é contado e volta na
// rodada seguinte, porque o dia dele continua dentro da janela de 30.
const REPESCAGEM_TETO_PEDIDOS = 50;
// Profundidade da janela retroativa do corpo VIVO de `dispatch_orders_jobs`
// (`v_dias_retro := 3`). A rodada diária despacha D−1, D−2 e D−3 como jobs de um
// dia; a repescagem pega carona na mais antiga das três, que ocorre uma vez por
// dia. O cron horário varre sempre o dia CORRENTE, então nunca casa com isto.
const REPESCAGEM_DIA_GATILHO = 3;

/** O dia do calendário BRT de um instante. Meia-noite BRT = 03:00Z. */
function hojeBRT(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().substring(0, 10);
}

function temAssinaturaDaRodadaDiaria(dateFrom: string, dateTo: string, hoje: string): boolean {
  if (dateFrom !== dateTo) return false;
  return dateFrom === deslocarDia(hoje, -REPESCAGEM_DIA_GATILHO);
}

interface ResultadoRepescagem {
  rodou: boolean;
  motivo: string;
  janela_dias: number;
  teto_dias: number;
  bloco: number;
  faixa: string | null;
  dias_examinados: number;
  dias_nao_examinados: number;
  dias_com_divergencia: number;
  dias_nao_medidos: number;
  dias_nao_medidos_lista: string[];
  bordas_nao_medidas: number;
  ausentes_encontrados: number;
  descartados_por_ja_existirem: number;
  recuperados: number;
  recuperacao_adiada: number;
  recusados: { id: string; motivo: string }[];
  maior_atraso_horas: number | null;
  atraso_denominador: number;
  sem_data_de_fechamento: number;
  folga_estourada: boolean;
  pedidos: any[];
}

function repescagemNaoRodou(motivo: string): ResultadoRepescagem {
  return {
    rodou: false, motivo,
    janela_dias: REPESCAGEM_JANELA_DIAS, teto_dias: REPESCAGEM_TETO_DIAS,
    bloco: -1, faixa: null,
    dias_examinados: 0, dias_nao_examinados: 0, dias_com_divergencia: 0,
    dias_nao_medidos: 0, dias_nao_medidos_lista: [], bordas_nao_medidas: 0,
    ausentes_encontrados: 0, descartados_por_ja_existirem: 0,
    recuperados: 0, recuperacao_adiada: 0, recusados: [],
    maior_atraso_horas: null, atraso_denominador: 0, sem_data_de_fechamento: 0,
    folga_estourada: false, pedidos: [],
  };
}

/**
 * A segunda passada. Ela COLHE — quem escreve é o pipeline do handler, uma porta
 * só. Não tem porta de escrita própria por desenho, e o portão de forma afirma
 * isso: um segundo caminho de escrita seria uma segunda régua para o mesmo fato.
 *
 * 🔴 O CONTRASTE QUE JUSTIFICA ESTA FUNÇÃO EXISTIR: `reconcileCancelled` também
 * é uma passada posterior sobre janela antiga, roda todo dia, e em meses NUNCA
 * inseriu uma linha — ela só faz `update` de status. Um pedido que nunca entrou
 * continuava sem entrar, para sempre. É essa diferença, INSERIR contra
 * ATUALIZAR, que fecha o buraco de 26 pedidos.
 */
async function executarRepescagem(args: {
  mlNumericId: number;
  accessToken: string;
  supabaseAdmin: any;
  organizationId: string | null;
  dateFrom: string;
  dateTo: string;
  forcada?: boolean;
  modoRecaptura: boolean;
}): Promise<ResultadoRepescagem> {
  const { mlNumericId, accessToken, supabaseAdmin, organizationId, dateFrom, dateTo, forcada, modoRecaptura } = args;

  if (modoRecaptura) return repescagemNaoRodou("rodada de recaptura nao dispara repescagem");
  if (!organizationId) return repescagemNaoRodou("token sem organizacao");

  const hoje = hojeBRT();
  const assinatura = temAssinaturaDaRodadaDiaria(dateFrom, dateTo, hoje);
  const deveRodar = forcada === true || (forcada !== false && assinatura);
  if (!deveRodar) {
    return repescagemNaoRodou(
      `janela ${dateFrom}..${dateTo} nao tem a assinatura da rodada diaria (esperado dia unico D-${REPESCAGEM_DIA_GATILHO} = ${deslocarDia(hoje, -REPESCAGEM_DIA_GATILHO)})`,
    );
  }

  // Rodízio de blocos: sem estado novo em tabela, o bloco sai do próprio dia do
  // calendário. Cada dia da janela de 30 é reexaminado a cada 3 rodadas, o que é
  // folga larga contra os ~12 dias do pior atraso já medido.
  const blocos = Math.ceil(REPESCAGEM_JANELA_DIAS / REPESCAGEM_TETO_DIAS);
  const diasDesdeEpoca = Math.floor(Date.parse(`${hoje}T12:00:00.000Z`) / 86_400_000);
  const bloco = ((diasDesdeEpoca % blocos) + blocos) % blocos;

  const maisAntigo  = Math.min(REPESCAGEM_JANELA_DIAS, (bloco + 1) * REPESCAGEM_TETO_DIAS);
  const maisRecente = bloco * REPESCAGEM_TETO_DIAS + 1;
  const de  = deslocarDia(hoje, -maisAntigo);
  const ate = deslocarDia(hoje, -maisRecente);
  const diasDoBloco = maisAntigo - maisRecente + 1;

  console.log(`sync-ml-orders: REPESCAGEM bloco ${bloco + 1}/${blocos} — ${de} → ${ate}`);

  const conferencia = await conferirJanela(mlNumericId, de, ate, accessToken, supabaseAdmin, organizationId);

  // Segundo filtro, de propósito: a conferência já descartou o que existe, mas
  // entre uma coisa e outra a captura desta mesma rodada pode ter gravado. O
  // filtro é barato e é ele que torna a garantia INCONDICIONAL — nenhum pedido
  // preexistente é buscado, muito menos reescrito.
  const { ausentes, descartados } = await filtrarIdentificadoresAusentes(
    supabaseAdmin, organizationId, conferencia.ausentes_no_banco,
  );

  const aBuscar = ausentes.slice(0, REPESCAGEM_TETO_PEDIDOS);
  const adiados = ausentes.length - aBuscar.length;
  const colhido = await buscarPedidosPorId(aBuscar, accessToken);

  // O vigia da folga: dois terços de 30 dias = 480 horas. Guardar um número que
  // ninguém lê é a mesma classe de defeito do portão ancorado em versão
  // superada — o pressuposto que ninguém remede passa a valer para sempre.
  const limiteDaFolga = (REPESCAGEM_JANELA_DIAS * 24 * 2) / 3;
  const folga_estourada =
    conferencia.maior_atraso_horas !== null && conferencia.maior_atraso_horas > limiteDaFolga;
  if (folga_estourada) {
    console.warn(
      `🔴 sync-ml-orders: FOLGA DA JANELA ESTOURADA — maior atraso ${conferencia.maior_atraso_horas}h ` +
      `sobre ${conferencia.atraso_denominador} pedidos, acima de dois tercos da janela de ${REPESCAGEM_JANELA_DIAS} dias ` +
      `(${limiteDaFolga}h). A acao e ALARGAR a janela, nao trocar a regua.`,
    );
  }

  if (colhido.pedidos.length > 0 || conferencia.dias_nao_medidos > 0) {
    console.log(
      `sync-ml-orders: repescagem colheu ${colhido.pedidos.length} pedidos ausentes, ` +
      `${descartados.length} descartados por ja existirem, ${adiados} adiados por teto, ` +
      `${conferencia.dias_nao_medidos} dias NAO MEDIDOS`,
    );
  }

  return {
    rodou: true,
    motivo: forcada === true ? "pedida explicitamente" : "assinatura da rodada diaria",
    janela_dias: REPESCAGEM_JANELA_DIAS,
    teto_dias: REPESCAGEM_TETO_DIAS,
    bloco,
    faixa: `${de}..${ate}`,
    dias_examinados: conferencia.dias_examinados,
    dias_nao_examinados: REPESCAGEM_JANELA_DIAS - diasDoBloco,
    dias_com_divergencia: conferencia.dias_com_divergencia,
    dias_nao_medidos: conferencia.dias_nao_medidos,
    dias_nao_medidos_lista: conferencia.dias_nao_medidos_lista,
    bordas_nao_medidas: conferencia.bordas_nao_medidas,
    ausentes_encontrados: conferencia.ausentes_no_banco.length,
    descartados_por_ja_existirem: descartados.length,
    recuperados: colhido.pedidos.length,
    recuperacao_adiada: adiados,
    recusados: colhido.recusados,
    maior_atraso_horas: conferencia.maior_atraso_horas,
    atraso_denominador: conferencia.atraso_denominador,
    sem_data_de_fechamento: conferencia.sem_data_de_fechamento,
    folga_estourada,
    pedidos: colhido.pedidos,
  };
}

/**
 * Grava o vigia da folga na linha da PRÓPRIA rodada em `sync_jobs`.
 *
 * Colunas próprias e nuláveis, nunca o campo de mensagem de falha: aquele é lido
 * como "este job quebrou", e gravar métrica de saúde ali arrebentaria qualquer
 * consulta de job com erro. Vazio aqui significa "esta rodada não mediu", e não
 * "o atraso foi zero".
 *
 * Há uma linha de `sync_jobs` por rodada diária, então o número vira SÉRIE
 * consultável por SQL — não instantâneo.
 */
async function gravarVigiaDaFolga(
  supabaseAdmin: any,
  syncJobId: string | number,
  maiorAtrasoHoras: number | null,
  denominador: number,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("sync_jobs")
    .update({
      repescagem_maior_atraso_horas: maiorAtrasoHoras,
      repescagem_atraso_denominador: denominador,
    })
    .eq("id", syncJobId);

  if (error) {
    // Falhar aqui não pode derrubar a rodada: o vigia é medição de saúde, não a
    // captura. Mas também não pode ficar mudo — sem este aviso a série
    // simplesmente para de crescer e ninguém sabe.
    console.warn(`gravarVigiaDaFolga: nao consegui gravar o vigia da folga (${error.message})`);
    return false;
  }
  return true;
}

// ── Batch-fetch shipment details from /shipments/{id} ────────────────────────
// Fetches ALL unique shipment IDs (not just frete grátis) to get:
//   • base_cost  → seller-absorbed shipping cost (frete grátis / Full)
//   • receiver_address → estado (UF) + cidade
// /orders/search does NOT return receiver_address; it is only in /shipments/{id}.

interface ShipmentDetail {
  cost:         number | null;
  estado:       string | null;
  cidade:       string | null;
  // Flex (Fase 222, FLEX-01/03): tipo logistico na raiz do MESMO payload
  // (zero requisicao nova) e bonus de envio, que exige 1 requisicao a mais
  // por envio self_service — nunca para os outros tipos (guarda ehFlex).
  logisticType: string | null;
  bonusEnvio:   number | null;
  // D-R2-04 (222-13-R2): frete pago pelo COMPRADOR no checkout, lido de
  // `receiver.cost` da MESMA resposta de custos de onde sai o bonus. `null`
  // aqui significa que a chamada de custos falhou — nunca "o comprador nao
  // pagou", que e `0`.
  freteComprador: number | null;
}

async function fetchShipmentDetails(
  orders: any[],
  accessToken: string,
  maxShipments = 500,
  // Pedidos que JA tem frete e endereco no banco. Sincronizacao incremental:
  // o cron do dia corrente roda de hora em hora, e sem isto cada rodada
  // rebuscava o detalhe de TODOS os pedidos do dia — as 22h, um dia com 100
  // pedidos custava 100 chamadas, sendo que 95 nao mudaram desde as 8h.
  //
  // Seguro porque frete e endereco de envio sao definidos na criacao do envio e
  // nao mudam depois. Se um dia mudarem, o pedido volta a ser buscado assim que
  // o backfill limpar o campo — a regra e "ja tenho o dado", nao "ja vi este id".
  jaCompletos: Set<string> = new Set(),
): Promise<{
  detailMap: Map<number, ShipmentDetail>;
  attempted: number;
  failed: number;
  // Flex (Fase 222): silencio foi o que deixou o imposto errado viver quatro
  // meses (Fase 220) — os tres contadores viajam ate a resposta do sync.
  flexSelfService:   number;
  flexBonusResolved: number;
  flexBonusFailed:   number;
  // D-R2-04: os tres particionam o conjunto de envios buscados —
  // capturado + zero + ausente = envios resolvidos. Zero e ausencia ficam
  // SEPARADOS de proposito: zero e valor conhecido (o comprador nao pagou
  // frete), ausencia e a chamada de custos que falhou. Colapsar os dois e o
  // defeito consertado em 11/08 no frete.
  freteCompradorCapturado: number;
  freteCompradorZero:      number;
  freteCompradorAusente:   number;
}> {
  const detailMap = new Map<number, ShipmentDetail>();

  // Collect ALL unique shipment IDs
  const seen = new Set<number>();
  const ids: number[] = [];
  let pulados = 0;
  for (const order of orders) {
    if (jaCompletos.has(String(order.id))) { pulados++; continue; }
    const shipId = order.shipping?.id ? Number(order.shipping.id) : null;
    if (shipId && !seen.has(shipId)) {
      seen.add(shipId);
      ids.push(shipId);
      if (ids.length >= maxShipments) break;
    }
  }
  if (pulados > 0) {
    console.log(`fetchShipmentDetails: ${pulados} pedido(s) pulado(s) — frete e endereco ja no banco`);
  }

  if (!ids.length) {
    return {
      detailMap, attempted: 0, failed: 0,
      flexSelfService: 0, flexBonusResolved: 0, flexBonusFailed: 0,
      freteCompradorCapturado: 0, freteCompradorZero: 0, freteCompradorAusente: 0,
    };
  }
  console.log(`Fetching ${ids.length} shipments for cost + address…`);

  // 2026-08-06 (fix frete mudo, T-219-09): rejeicao de `Promise.allSettled`
  // antes era descartada em silencio — nenhum log, nenhum contador. Agora
  // toda rejeicao vira console.warn com o id do envio, e a funcao devolve
  // quantos envios foram tentados e quantos falharam, para o chamador
  // repassar na resposta do sync (shipments_total/shipments_failed).
  let failed = 0;
  let flexSelfService = 0;
  let flexBonusResolved = 0;
  let flexBonusFailed = 0;
  let freteCompradorCapturado = 0;
  let freteCompradorZero = 0;
  let freteCompradorAusente = 0;
  const CONCURRENCY = 10;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        // NAO usar o cabecalho de formato novo aqui: com ele logistic_type/
        // mode/shipping_option voltam null (item 5 do Veredito,
        // 222-ML-API.md) — armadilha medida, nunca "otimizar" isto.
        const s = await mlFetch(`/shipments/${id}`, accessToken, 8_000);

        // Seller-absorbed shipping cost — usa list_cost (mesmo que nexo-mcp)
        const cost = s.shipping_option?.list_cost ?? s.base_cost ?? null;

        // Receiver address → UF + cidade
        const addr     = s.receiver_address ?? {};
        const stateObj = addr.state ?? {};
        const estadoRaw =
          typeof stateObj === "string"
            ? stateObj
            : (stateObj?.id ?? stateObj?.name ?? null);
        let estado = estadoRaw ? String(estadoRaw).trim() || null : null;
        if (estado?.includes("-")) {
          estado = estado.split("-")[1]?.trim()?.toUpperCase()?.slice(0, 2) ?? estado;
        }
        const cityObj = addr.city ?? addr.city_name ?? null;
        const cidade  = cityObj
          ? (typeof cityObj === "object" ? (cityObj?.name ?? null) : String(cityObj).trim() || null)
          : null;

        // Flex (FLEX-01/03): logistic_type ja veio no MESMO payload acima —
        // zero requisicao nova.
        const logisticType = extrairLogisticType(s);

        // ── UMA chamada de custos por envio, servindo DUAS grandezas ────────
        // [222-13-R2, D-R2-04] Ate aqui esta requisicao vivia atras da guarda
        // ehFlex (2,6% dos envios na Pe Vermeio, 19,8% no Junior). O frete
        // pago pelo COMPRADOR sai do mesmo recurso e existe em QUALQUER envio,
        // nao so no Flex — entao a REQUISICAO saiu de tras da guarda. A
        // LEITURA DO BONUS nao saiu, e essa distincao e o ponto todo (ver o
        // bloco logo abaixo).
        //
        // Custo medido: cada envio NOVO passa de ~1,03 para 2 chamadas. A
        // sincronizacao e incremental (envio que ja tem frete e endereco no
        // banco nem chega aqui), entao quem paga sao os pedidos novos da
        // rodada — dezenas por loja —, nunca os milhares do historico. Fazer
        // duas requisicoes separadas ao MESMO endpoint (uma para o bonus,
        // outra para o frete do comprador) seria pior: uma so resposta serve
        // as duas leituras.
        let custos:
          | { gross_amount?: unknown; receiver?: { cost?: unknown } | null }
          | null = null;
        let custosFalhou = false;
        try {
          custos = await mlFetch(`/shipments/${id}/costs`, accessToken, 8_000);
        } catch (err) {
          // Falha na chamada de custos NAO derruba o envio: tipo logistico,
          // custo e endereco continuam sendo gravados. As DUAS grandezas
          // ficam null — nunca zero por falha de rede (DM-2: resposta sem o
          // campo e zero conhecido; chamada que falhou e ausencia).
          const motivo = err instanceof Error ? err.message : String(err);
          console.warn(`fetchShipmentDetails: /shipments/${id}/costs falhou — ${motivo}`);
          custosFalhou = true;
        }

        // Frete do comprador: SEMPRE, fora da guarda de Flex. `custos` vale
        // null quando a requisicao falhou, e o extrator devolve null nesse
        // caso — a ausencia viaja declarada ate a coluna e a view de saude.
        const freteComprador = extrairFreteComprador(custos);

        // Bonus de envio: SO atras da guarda ehFlex, e isto NAO mudou.
        // `frete IS NULL` NAO e sinonimo de Flex: ler o bonus de um envio que
        // nao e self_service inventaria receita que o vendedor nunca recebeu
        // (achado medido, 222-ML-API.md — xd_drop_off tem gross_amount nao
        // zero e frete subsidiado pelo ML). A requisicao saiu de tras da
        // guarda; a leitura do bonus, nao.
        let bonusEnvio: number | null = null;
        let bonusStatus: "nao_flex" | "resolvido" | "falho" = "nao_flex";
        if (ehFlex(logisticType)) {
          if (custosFalhou) {
            bonusStatus = "falho";
          } else {
            bonusEnvio = extrairBonusEnvio(custos);
            bonusStatus = "resolvido";
          }
        }

        return {
          id,
          cost: cost != null ? Number(cost) : null,
          estado,
          cidade,
          logisticType,
          bonusEnvio,
          bonusStatus,
          freteComprador,
        };
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        if (r.value.bonusStatus !== "nao_flex") flexSelfService++;
        if (r.value.bonusStatus === "resolvido") flexBonusResolved++;
        if (r.value.bonusStatus === "falho") flexBonusFailed++;

        // D-R2-04: particao exaustiva dos envios resolvidos. Silencio foi o
        // que deixou o imposto errado viver quatro meses (Fase 220) — os tres
        // numeros viajam ate a resposta do sync.
        if (r.value.freteComprador == null) freteCompradorAusente++;
        else if (r.value.freteComprador === 0) freteCompradorZero++;
        else freteCompradorCapturado++;

        detailMap.set(r.value.id, {
          // 2026-08-11: o `> 0` daqui transformava frete ZERO em null e era a
          // causa dos pedidos "sem frete". Envio self_service (Mercado Envios
          // Flex) devolve base_cost/list_cost = 0 — o vendedor nao paga frete
          // ao ML —, e zero e um valor CONHECIDO, nao ausencia. Virar null
          // apagava essa informacao: na conta Junior eram 13,2% dos pedidos
          // abaixo de R$ 79 (medido 11/08). Prova de que era determinístico e
          // nao falha de rede: reprocessar o dia nao recuperava nenhum, e o
          // banco inteiro — 3 contas, centenas de milhares de pedidos — nao
          // tinha UM unico frete = 0. A Pe Vermeio era imune por ser toda
          // fulfillment, onde o custo e sempre positivo.
          // `r.value.cost` ja e null quando o campo vem ausente da API.
          cost:         r.value.cost,
          estado:       r.value.estado,
          cidade:       r.value.cidade,
          logisticType: r.value.logisticType,
          bonusEnvio:   r.value.bonusEnvio,
          freteComprador: r.value.freteComprador,
        });
      } else if (r.status === "rejected") {
        failed++;
        const shipId = batch[j];
        const motivo = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`fetchShipmentDetails: envio ${shipId} rejeitado — ${motivo}`);
      }
    }
  }

  console.log(
    `Shipment details resolved: ${detailMap.size} / ${ids.length} (falhas: ${failed}); ` +
    `Flex self_service: ${flexSelfService} (bonus resolvido: ${flexBonusResolved}, falho: ${flexBonusFailed}); ` +
    `frete do comprador: ${freteCompradorCapturado} capturado(s), ${freteCompradorZero} zero, ${freteCompradorAusente} ausente(s)`,
  );
  return {
    detailMap, attempted: ids.length, failed,
    flexSelfService, flexBonusResolved, flexBonusFailed,
    freteCompradorCapturado, freteCompradorZero, freteCompradorAusente,
  };
}

// ── Batch-fetch brand names from /items?ids=... ───────────────────────────────
// ML API allows up to 20 IDs per request.
// Returns Map<item_id, marca_name | null>

async function fetchItemBrands(
  itemIds: string[],
  accessToken: string,
): Promise<Map<string, string | null>> {
  const brandMap = new Map<string, string | null>();
  if (itemIds.length === 0) return brandMap;

  const BATCH_SIZE = 20;
  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    try {
      const items = await mlFetch(
        `/items?ids=${batch.join(",")}`,
        accessToken,
        15_000,
      );
      const results: any[] = Array.isArray(items) ? items : [];
      for (const entry of results) {
        const item = entry.body ?? entry;
        if (!item?.id) continue;
        const itemId = String(item.id);
        const brandAttr = (item.attributes ?? []).find(
          (a: any) => a.id === "BRAND",
        );
        brandMap.set(itemId, brandAttr?.value_name ?? null);
      }
    } catch (err) {
      console.warn(`fetchItemBrands batch ${i}-${i + BATCH_SIZE} failed:`, err);
      for (const id of batch) {
        if (!brandMap.has(id)) brandMap.set(id, null);
      }
    }
  }

  return brandMap;
}

// ── Expand one ML order object into one row per order_item ────────────────────

function safeStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function expandOrder(
  order:          any,
  mlUserId:       string,
  sellerId:       string | null,
  userId:         string,
  organizationId: string | null,
  syncAt:         string,
  shipmentMap:    Map<number, ShipmentDetail>,
  costMap:        Map<string, number>,
  // [222-05-R] LISTA de vigências da loja, não mais uma config única. O nome
  // do parâmetro mudou junto com o tipo de propósito: nenhuma chamada antiga
  // pode continuar compilando por acidente e passando uma config só.
  taxConfigs:     LinhaTaxConfigVigencia[],
  brandMap:       Map<string, string | null>,
  skuCostMap:     Map<string, number>,
  skuCostFullMap: Map<string, number>,
  // Régua fiscal decomposta (Fase 222, TAX-01/02): tabela de alíquota
  // interna + FCP por UF, carregada UMA vez por rodada pelo chamador —
  // nunca uma chamada por pedido dentro deste laço.
  tabelaUf:       TabelaDifal,
  // [222-05-R] Contador da rodada: quantos pedidos têm loja COM config mas
  // NENHUMA vigência cobrindo a data deles. Silêncio aqui é o que deixou o
  // imposto errado viver quatro meses na Fase 220.
  contadores:     { pedidosSemVigencia: number },
): Array<Record<string, unknown>> {
  // Converter para BRT (UTC-3) antes de extrair a data: o range de sync usa meia-noite BRT,
  // e o cliente filtra por data BRT — armazenar em UTC causava desvio de um dia nas bordas.
  const toBRT = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const brtMs = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
    return new Date(brtMs).toISOString().substring(0, 10);
  };
  const datePedido    = toBRT(order.date_created);
  const dataPagamento = toBRT(order.date_approved);

  // ── Régua fiscal POR COMPETÊNCIA (Fase 222, 222-05-R) ──────────────────────
  // `datePedido` já está em BRT e no formato ano-mês-dia. A config do pedido é
  // resolvida AQUI, por pedido — nunca "a config da rodada": a janela de um
  // sync cruza meses, e usar o fim do lote como referência é o bug que
  // regravou 352 pedidos do Junior de 01–10/08 com a alíquota de 11/08.
  const temAlgumaConfig = Array.isArray(taxConfigs) && taxConfigs.length > 0;
  const taxConfig       = resolverConfigVigente(taxConfigs, datePedido);
  // Duas ausências DIFERENTES, que antes colapsavam numa só:
  //  · loja sem config nenhuma  → motivo "sem_config", carve-out deliberado da
  //    Fase 220: `receita_liquida` continua sendo calculada, para não regredir
  //    org que nunca cadastrou regime;
  //  · loja COM config, mas nenhuma vigência cobrindo esta data → o imposto é
  //    desconhecido de verdade, e `receita_liquida` NÃO pode ser calculada
  //    como se o imposto fosse zero (sairia inflada pelo valor inteiro dele —
  //    pior que o bug original).
  const semVigenciaCobrindo = temAlgumaConfig && taxConfig === null;
  if (semVigenciaCobrindo) contadores.pedidosSemVigencia++;

  const comprador = safeStr(
    order.buyer?.nickname ?? order.buyer?.first_name ?? null,
  );

  // Address comes from the shipment detail (receiver_address).
  // /orders/search does NOT include receiver_address; it is only in /shipments/{id}.
  const shipId  = order.shipping?.id ? Number(order.shipping.id) : null;
  const detail  = shipId ? shipmentMap.get(shipId) : undefined;
  const estado  = detail?.estado ?? null;
  const cidade  = detail?.cidade ?? null;

  // Flex (Fase 222, FLEX-01/03): logistic_type e bonus_envio sao grandezas
  // do ENVIO (uma resposta por pedido), nao do item. custo_entrega e
  // parametro por LOJA (ml_tax_config.flex_custo_entrega), so aplicavel
  // quando o envio e Flex — se a loja ainda nao informou o valor, fica null
  // e o Flex segue com margem declaradamente inflada (nomeado, nao
  // inventado — 222-CONTEXT.md, Deferred Ideas).
  const logisticType   = detail?.logisticType ?? null;
  const bonusEnvioPedido = detail?.bonusEnvio ?? null;
  // D-R2-04: frete pago pelo COMPRADOR, tambem grandeza do ENVIO. `null` aqui
  // e ausencia (a chamada de custos falhou, ou o envio nem foi buscado nesta
  // rodada), `0` e valor conhecido — a regua fiscal trata os dois diferente.
  const freteCompradorPedido = detail?.freteComprador ?? null;
  const custoEntregaPedido =
    ehFlex(logisticType) && taxConfig?.flex_custo_entrega != null
      ? Number(taxConfig.flex_custo_entrega)
      : null;

  const items = order.order_items || [];

  // orders tem uma linha por ITEM; bonus e custo de entrega sao do ENVIO
  // inteiro — ratearPorReceita divide entre as linhas na proporcao da
  // receita bruta de cada uma, fechando ao centavo. (Dívida conhecida e
  // anterior a esta fase: `frete`, alguns paragrafos abaixo, continua
  // replicado por linha, sem rateio — os campos novos nao a herdam.)
  const receitasPorItem = items.map((item: any) => {
    const precoUnit  = item.unit_price != null ? Number(item.unit_price) : null;
    const quantidade = Number(item.quantity || 0);
    return precoUnit != null ? precoUnit * quantidade : 0;
  });
  const bonusRateado        = ratearPorReceita(bonusEnvioPedido, receitasPorItem);
  const custoEntregaRateado = ratearPorReceita(custoEntregaPedido, receitasPorItem);
  // D-R2-04: o frete do comprador e do ENVIO, nao do item — rateado pela
  // MESMA funcao do bonus e do custo de entrega, e pelo mesmo motivo (fecha ao
  // centavo e nao herda a divida do frete replicado por linha).
  //
  // ⚠️ BASE MISTA, registrada de proposito: `frete` (do vendedor) continua
  // REPLICADO por linha, sem rateio — divida anterior a esta fase, ja nomeada
  // no cabecalho de flexOrder.ts —, e o frete do comprador entra RATEADO. Em
  // pedido de item unico, que e a esmagadora maioria, os dois coincidem; em
  // pedido de varios itens o `freteTotal` da regua (frete + freteComprador,
  // base dos dois creditos de frete) mistura as duas bases. A divida e
  // REGISTRADA no 222-14-R2, nao corrigida aqui.
  const freteCompradorRateado = ratearPorReceita(freteCompradorPedido, receitasPorItem);

  return items.map((item: any, idx: number) => {
    const prod           = item.item ?? {};
    // listing_type_id lives at the order_item level, NOT inside item.item
    const listingTypeRaw = item.listing_type_id ?? prod.listing_type_id ?? prod.listing_type ?? "";
    const listing_type   = LISTING_TYPE_MAP[listingTypeRaw] ?? listingTypeRaw ?? null;

    // Shipping cost resolution:
    //  1. order.shipping.cost → buyer-paid (non-zero for paid shipping)
    //  2. detail.cost         → seller-absorbed base_cost from /shipments/{id}
    //     (covers frete grátis / Mercado Envios Full orders)
    const buyerCost = order.shipping?.cost != null ? Number(order.shipping.cost) : null;
    const frete     = (buyerCost != null && buyerCost > 0)
      ? buyerCost
      : (detail?.cost ?? null);

    const itemId      = String(prod.id || "");
    const itemSku     = prod.seller_custom_field ?? prod.seller_sku ?? null;
    const quantidade  = Number(item.quantity || 0);
    const precoUnit   = item.unit_price != null ? Number(item.unit_price) : null;
    const custoUnit   = (itemSku ? skuCostMap.get(itemSku) : null) ?? costMap.get(itemId) ?? null;
    // Fase 96-07 (Trava C): o cheio é lido da MESMA fonte do médio
    // (ml_product_costs), num campo separado (cost_full ← precoCusto do Tiny).
    // NUNCA derivado de custoUnit — derivar o cheio do médio reintroduziria o C6
    // disfarçado. Sem cost_full cadastrado → null (o pedido entra sem cheio e o
    // gate do C6 o lista para o Wesley cadastrar no Tiny).
    const custoUnitCheio = (itemSku ? skuCostFullMap.get(itemSku) : null) ?? null;

    // Comissão e receita bruta precisam estar resolvidas ANTES da chamada de
    // imposto: os créditos de D-01 (222) usam comissão e frete como base, e
    // constante usada antes da inicialização aqui é erro de execução, não
    // de tipo (222-05, ponto de atenção de ordem).
    const comissao    = item.sale_fee != null ? Number(item.sale_fee) : null;
    const receitaBruta = precoUnit != null ? precoUnit * quantidade : null;
    // D-R2-04: parcela do frete do comprador desta linha. Resolvida ANTES da
    // chamada da regua pelo mesmo motivo de comissao/receita bruta acima — a
    // regua a usa em dois lugares (base tributavel e frete total do credito).
    const freteCompradorItem = freteCompradorRateado[idx] ?? null;

    // Fase 222 (TAX-01/02): imposto decomposto por componentes (ICMS
    // débito, PIS/COFINS débito, créditos de PIS/COFINS sobre comissão e
    // frete, DIFAL por base dupla, FCP) em vez de uma alíquota única —
    // computeOrderTax é a ÚNICA função que faz esta conta, chamada aqui e
    // em recalc-order-costs (a segunda porta de escrita), nunca copiada.
    const breakdown   = computeOrderTax({
      config:       taxConfig,
      ufDestino:    estado,
      receitaBruta,
      comissao,
      frete,
      freteComprador: freteCompradorItem,
      tabelaUf,
    });
    const taxRate     = breakdown.taxRate;
    const taxAmount   = breakdown.taxAmount;
    const ufOrigem    = taxConfig?.uf_origem ?? null;
    // receita_liquida precisa da mesma proteção que tax_rate/tax_amount: ela é
    // recalculada como número real a cada rodada (preço×qtd−comissão−frete−
    // imposto), e já tem COALESCE no upsert desde 12/06 — mas COALESCE não
    // protege contra número errado, só contra ausência. Se o imposto virar
    // null e receita_liquida continuasse sendo calculada com imposto valendo
    // zero, ela seria gravada INFLADA pelo valor inteiro do imposto — um bug
    // pior que o original. Quando NÃO existe config fiscal nenhuma (motivo
    // "sem_config"), receita_liquida continua calculada como hoje: orgs sem
    // regime cadastrado não podem regredir por causa desta fase.
    // [222-05-R] `semVigenciaCobrindo` entra JUNTO com destino desconhecido, e
    // não no carve-out de "sem_config": a loja TEM regime cadastrado, só não
    // temos a régua daquela competência. Deixar cair no carve-out gravaria
    // `receita_liquida` inflada pelo imposto inteiro.
    const impostoDesconhecido =
      breakdown.motivo === "destino_desconhecido" || semVigenciaCobrindo;

    // Flex: bônus e custo de entrega já rateados por linha de item (fora
    // deste map). computeReceitaLiquida soma o bônus como receita própria e
    // subtrai o custo de entrega como custo próprio — nunca o bônus como
    // frete de sinal invertido (D-05).
    const bonusEnvioItem   = bonusRateado[idx] ?? null;
    const custoEntregaItem = custoEntregaRateado[idx] ?? null;
    const { receitaLiquida } = computeReceitaLiquida({
      receitaBruta,
      comissao,
      frete,
      bonusEnvio: bonusEnvioItem,
      custoEntrega: custoEntregaItem,
      taxAmount,
      impostoDesconhecido,
    });

    return {
      ml_order_id:     String(order.id),
      ml_user_id:      mlUserId,
      seller_id:       sellerId,
      user_id:         userId,
      organization_id: organizationId,
      item_id:         itemId,
      variation_id:    prod.variation_id ? String(prod.variation_id) : "",
      sku:             prod.seller_custom_field ?? prod.seller_sku ?? null,
      titulo:          prod.title ?? null,
      listing_type,
      quantidade,
      preco_unit:      precoUnit,
      comissao,
      frete,
      status:          order.status ?? null,
      data_pedido:     datePedido,
      data_pagamento:  dataPagamento,
      estado,
      cidade,
      comprador,
      synced_at:       syncAt,
      custo_unit:      custoUnit,
      custo_unit_cheio: custoUnitCheio,
      tax_rate:        taxRate,
      tax_amount:      taxAmount,
      uf_origem:       ufOrigem,
      receita_bruta:   receitaBruta,
      receita_liquida: receitaLiquida,
      marca:           brandMap.get(itemId) ?? null,
      logistic_type:   logisticType,
      bonus_envio:     bonusEnvioItem,
      custo_entrega:   custoEntregaItem,
      // D-R2-04: dinheiro do COMPRADOR. Existe so para a regua fiscal — nao
      // entra em receita_liquida, em margem nem no MCO (por isso nao aparece
      // na chamada de computeReceitaLiquida acima).
      frete_comprador: freteCompradorItem,
      // Fase 222 (TAX-01/02) + Quick 260820-3aa: os 11 campos fiscais (10
      // componentes do breakdown decomposto + o marcador tax_versao) viajam
      // juntos, e SÓ quando esta rodada teve insumo para apurar a régua —
      // camposFiscaisParaUpsert devolve {} quando reguaApurouNestaRodada(breakdown)
      // é falso (destino desconhecido, sem vigência, sem config, receita
      // ausente), e a AUSÊNCIA das chaves no payload é o sinal que a sentinela
      // de intenção de batch_upsert_orders (migration 20260820210000) lê para
      // PRESERVAR a linha em vez de gravar ausência por cima do que uma rodada
      // anterior já tinha apurado. Regime fixo (Simples Nacional, Lucro
      // Presumido) sempre apura, mesmo com destino desconhecido — a conta do
      // Junior não se move por causa desta mudança.
      ...camposFiscaisParaUpsert(breakdown),
    };
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const syncAt = new Date().toISOString();

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !authData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = authData.user.id;
    }

    // ── Body validation ───────────────────────────────────────────────────────
    const BodySchema = z.object({
      ml_user_id: z.string().min(1),
      date_from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      seller_id:  z.string().nullable().optional(),
      // [225-10] Modo de CONFERÊNCIA: leitura pura, devolve o diff por conjunto
      // de identificadores nos dois sentidos. Não escreve uma linha.
      audit_only:   z.boolean().optional(),
      // [225-10] Modo de RECAPTURA: em vez de varrer a janela, busca por id os
      // identificadores de `order_ids` e insere SÓ os que ainda não existem.
      only_missing: z.boolean().optional(),
      order_ids:    z.array(z.string().min(1)).max(500).optional(),
      // [225-10] Repescagem de 30 dias. Ausente = decide pela assinatura da
      // rodada diária; explícito = liga ou desliga para esta invocação.
      repescagem:   z.boolean().optional(),
      // [225-10] Linha de `sync_jobs` desta rodada, para o vigia da folga da
      // janela gravar o maior atraso medido. Ausente = a rodada não mede.
      sync_job_id:  z.union([z.string().min(1), z.number()]).optional(),
    });

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const {
      ml_user_id, date_from, date_to, seller_id,
      audit_only, only_missing, order_ids, repescagem, sync_job_id,
    } = parsed.data;

    // ── Token lookup (ME-04: ORDER BY determinístico + filtro por org quando conhecida) ──
    // Sem ORDER BY, o lookup é não-determinístico em multi-tenant (dois orgs com mesmo ml_user_id).
    // process-sync-job não envia organization_id no body; filtro por org é feito pós-lookup via
    // is_org_member (skip para service role). ORDER BY updated_at DESC garante token mais recente.
    //
    // [222-05-R] O modificador de linha única saiu daqui também. Não é o bug
    // desta fase — `.limit(1)` já garante no máximo uma linha, então a troca é
    // equivalente em comportamento — mas a régua da fase é "nenhuma leitura de
    // linha única neste arquivo", e uma exceção sobrevivente convidaria a
    // próxima. Erro de leitura continua chegando em `tokenErr`.
    const { data: tokenRows, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, seller_id, updated_at")
      .eq("ml_user_id", ml_user_id)
      .not("access_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    const tokenRow = (tokenRows ?? [])[0] ?? null;

    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Org membership check (skip for service role — called from process-sync-job) ──
    if (!isServiceRole && tokenRow.organization_id) {
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: userId,
        _org_id:  tokenRow.organization_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const accessToken      = tokenRow.access_token    as string;
    const organizationId   = tokenRow.organization_id as string | null;
    const effectiveSellerId = seller_id ?? tokenRow.seller_id ?? null;

    // ── Resolve numeric ML seller id ──────────────────────────────────────────
    const mlUser       = await mlFetch("/users/me", accessToken);
    const mlNumericId  = mlUser.id as number;

    // ── [225-10] MODO DE CONFERÊNCIA — leitura pura, retorno antecipado ──────
    // Fica ANTES de qualquer construção de lote de propósito: o retorno daqui
    // não pode alcançar nenhuma porta de escrita, nem a de `orders` nem a do
    // log de sync. O portão de forma afirma isso.
    if (audit_only) {
      if (!organizationId) {
        return new Response(
          JSON.stringify({ success: false, error: "conferencia exige token com organizacao" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(`sync-ml-orders: CONFERENCIA ${date_from} → ${date_to} (leitura pura)`);
      const conferencia = await conferirJanela(
        mlNumericId, date_from, date_to, accessToken, supabaseAdmin, organizationId,
      );
      return new Response(
        JSON.stringify({ success: true, modo: "conferencia", date_from, date_to, ...conferencia }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build ISO range (BRT midnight = UTC 03:00) ────────────────────────────
    const { rangeStart, rangeEnd } = janelaBRT(date_from, date_to);

    console.log(
      `sync-ml-orders: ml_user_id=${ml_user_id} from=${date_from} to=${date_to}`,
    );

    // ── Fetch orders ──────────────────────────────────────────────────────────
    // Dois caminhos de colheita, e um só de escrita.
    //
    // [225-10] RECAPTURA (`only_missing`): a lista explícita de identificadores
    // é filtrada contra `orders` ANTES de qualquer chamada ao ML e ANTES de
    // qualquer enriquecimento. A ordem é a garantia, não a intenção — e é ela
    // que faz "rodar a recaptura sobre pedidos que já existem" custar zero
    // escrita E zero chamada.
    let rawOrders: any[];
    let recapturaSolicitados = 0;
    let recapturaDescartados: string[] = [];
    let recapturaRecusados: { id: string; motivo: string }[] = [];

    if (only_missing) {
      if (!organizationId) throw new Error("recaptura exige token com organizacao");
      const solicitados = Array.from(new Set((order_ids ?? []).map((id) => String(id))));
      recapturaSolicitados = solicitados.length;

      const { ausentes, descartados } = await filtrarIdentificadoresAusentes(
        supabaseAdmin, organizationId, solicitados,
      );
      recapturaDescartados = descartados;
      console.log(
        `sync-ml-orders: RECAPTURA — ${solicitados.length} pedidos, ${descartados.length} ja no banco (descartados), ${ausentes.length} a buscar`,
      );

      const colhido = await buscarPedidosPorId(ausentes, accessToken);
      rawOrders = colhido.pedidos;
      recapturaRecusados = colhido.recusados;
    } else {
      rawOrders = await fetchOrdersPage(
        mlNumericId,
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
        accessToken,
      );
    }

    // ── [225-10] REPESCAGEM — a segunda passada, pendurada na rodada diária ──
    // Ela COLHE; quem escreve é o pipeline abaixo, com uma porta só. O que ela
    // trouxer é FUNDIDO no mesmo lote e segue pelo caminho normal de
    // enriquecimento, cálculo fiscal e upsert — e é essa fusão que faz a passada
    // nova INSERIR, ao contrário de `reconcileCancelled`, que roda todo dia há
    // meses e nunca criou uma linha.
    const repescagem_resultado = await executarRepescagem({
      mlNumericId, accessToken, supabaseAdmin, organizationId,
      dateFrom: date_from, dateTo: date_to,
      forcada: repescagem, modoRecaptura: Boolean(only_missing),
    });
    const pedidosDaRepescagem = repescagem_resultado.pedidos;
    if (pedidosDaRepescagem.length > 0) {
      rawOrders = rawOrders.concat(pedidosDaRepescagem);
    }

    // Deduplicate by order id
    const seen    = new Set<number>();
    const orders  = rawOrders.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    console.log(`sync-ml-orders: ${orders.length} unique orders`);

    // ── Fetch shipment details (cost + address) for all orders ───────────────
    // Sync incremental: descobre quais pedidos do lote JA tem frete e endereco
    // gravados. So os que faltam vao para a API do ML.
    //
    // Backfill do Flex (Fase 222, FLEX-01): `orders` nao tinha `logistic_type`
    // ate o 222-04 -- todo pedido historico Flex ficaria pulado por este
    // mesmo otimizacao PARA SEMPRE, sem o predicado abaixo enxergar o campo
    // novo. BACKFILL_LOGISTIC_TYPE, DESLIGADO por padrao (ausencia da
    // variavel e falso, nunca verdadeiro): ligado, o predicado tambem exige
    // logistic_type preenchido, entao todo pedido do lote que ainda nao tem
    // tipo logistico volta a ser buscado no ML -- ha 193 pedidos com frete
    // nulo na Pe Vermeio e 630 no Junior (222-CONTEXT.md), cada um custando
    // uma chamada a /shipments/{id} que ja seria feita de qualquer forma
    // (zero chamada NOVA so por causa deste campo). Manter o predicado
    // alargado depois do backfill terminar faria toda rodada horaria pagar
    // por um dado que ja esta la -- por isso o interruptor e desligado ao
    // fim do backfill (222-PROVA.md, Passo 8), nao deixado ligado.
    const backfillLogisticType =
      (Deno.env.get("BACKFILL_LOGISTIC_TYPE") ?? "").trim().toLowerCase() === "true";
    // [222-13-R2, D-R2-04] Mesmo molde, mesma razao, mesmo desligamento:
    // `orders` nao tinha `frete_comprador` ate o 222-11-R2, entao todo pedido
    // historico ficaria pulado PARA SEMPRE pela otimizacao incremental sem um
    // predicado que enxergue o campo novo. BACKFILL_FRETE_COMPRADOR, DESLIGADO
    // por padrao (ausencia da variavel e falso, nunca verdadeiro): ligado, o
    // predicado tambem exige `frete_comprador` preenchido, e o historico volta
    // a ser buscado. Diferente do tipo logistico, aqui a busca custa UMA
    // chamada nova por envio (/shipments/{id}/costs) — razao a mais para
    // DESLIGAR ao fim do backfill, e nao deixar ligado: manter o predicado
    // alargado faria toda rodada horaria pagar por um dado que ja esta la.
    const backfillFreteComprador =
      (Deno.env.get("BACKFILL_FRETE_COMPRADOR") ?? "").trim().toLowerCase() === "true";
    const jaCompletos = new Set<string>();
    if (organizationId && orders.length) {
      const idsLote = orders.map((o: any) => String(o.id));
      let lookupCompletos = supabaseAdmin
        .from("orders")
        .select("ml_order_id")
        .eq("organization_id", organizationId)
        .in("ml_order_id", idsLote)
        .not("frete", "is", null)
        .not("estado", "is", null);
      if (backfillLogisticType) {
        lookupCompletos = lookupCompletos.not("logistic_type", "is", null);
      }
      if (backfillFreteComprador) {
        lookupCompletos = lookupCompletos.not("frete_comprador", "is", null);
      }
      const { data: jaNoBanco, error: erroLookup } = await lookupCompletos;
      if (erroLookup) {
        // Falha aqui NAO pode virar dado faltando: sem a lista, busca tudo,
        // que e o comportamento antigo. Degrada para lento, nunca para errado.
        console.warn("lookup de pedidos completos falhou; buscando todos:", erroLookup.message);
      } else {
        for (const r of (jaNoBanco ?? []) as any[]) jaCompletos.add(String(r.ml_order_id));
      }
    }
    const {
      detailMap: shipmentMap,
      attempted: shipmentsAttempted,
      failed:    shipmentsFailed,
      flexSelfService,
      flexBonusResolved,
      flexBonusFailed,
      freteCompradorCapturado,
      freteCompradorZero,
      freteCompradorAusente,
    } = await fetchShipmentDetails(orders, accessToken, 500, jaCompletos);

    // ── Load tax config + product costs for this store ──────────────────────
    // [222-05-R] LISTA de vigências, uma leitura por rodada — a escolha da
    // linha é feita por PEDIDO, dentro de expandOrder. A leitura de linha
    // única saiu daqui de propósito: com duas vigências ela devolveria erro,
    // o erro seria ignorado e o imposto da loja inteira sairia ausente em
    // silêncio. Mesmo espírito do bloco de `tabelaUf` logo abaixo: falha de
    // leitura degrada para ausência nomeada, nunca para número inventado.
    let taxConfigs: LinhaTaxConfigVigencia[] = [];
    if (organizationId) {
      const { data: cfgs, error: erroCfg } = await supabaseAdmin
        .from("ml_tax_config")
        .select("*")
        .eq("ml_user_id", ml_user_id)
        .eq("organization_id", organizationId);
      if (erroCfg) {
        console.warn(
          `sync-ml-orders: leitura de ml_tax_config falhou (${erroCfg.message}) — seguindo sem config (imposto sai ausente, nunca zero)`,
        );
      } else {
        taxConfigs = (cfgs ?? []) as LinhaTaxConfigVigencia[];
      }
    }

    // ── Tabela de alíquota interna + FCP por UF (Fase 222, TAX-01/02) ────────
    // UMA leitura por rodada — nunca uma por pedido dentro do laço de
    // expandOrder. `date_to` é "a data do lote": fim da janela sincronizada,
    // usada como referência de vigência. Se a chamada falhar, segue com
    // tabela vazia — o DIFAL sai null e a view de saúde do 222-05 mostra;
    // abortar o sync inteiro por causa do DIFAL seria pior que a ausência.
    let tabelaUf: TabelaDifal = {};
    {
      const { data: linhasUf, error: erroUf } = await supabaseAdmin.rpc(
        "aliquota_interna_vigente",
        { p_data: date_to },
      );
      if (erroUf) {
        console.warn(
          `sync-ml-orders: aliquota_interna_vigente falhou (${erroUf.message}) — seguindo com tabela de UF vazia (DIFAL sai ausente, nunca zero)`,
        );
      } else {
        tabelaUf = montarTabelaAliquotas(linhasUf ?? []);
      }
    }

    const itemIds = Array.from(new Set(
      orders.flatMap((o) => (o.order_items ?? []).map((i: any) => String(i.item?.id ?? ""))).filter(Boolean),
    ));
    const costMap = new Map<string, number>();
    const skuCostMap = new Map<string, number>(); // fallback: custo por seller_sku (Tiny sync)
    // Fase 96-07 (Trava C): custo CHEIO por seller_sku. Este é o caminho de
    // ingestão de TODO pedido novo — é ele que mantém custo_unit (médio) em
    // ~95% de cobertura. O cheio não tinha caminho de ingestão nenhum: por isso
    // congelou em 32,9% em julho enquanto o médio seguia em 94,9%. Só por
    // seller_sku (sem fallback por item_id): cost_full vem do Tiny, que casa por
    // SKU — mesmo critério do costFullBySku de recalc-order-costs.
    const skuCostFullMap = new Map<string, number>();
    {
      // Busca por item_id E por seller_sku (sem filtrar item_id para pegar custos do Tiny)
      // Quando service role (cron, userId=null): busca por org_id OU org_id IS NULL (custos salvos sem contexto de org)
      // Quando user JWT: busca por user_id (cobre todos os custos que o usuário salvou)
      const costOr = userId
        ? `user_id.eq.${userId}${organizationId ? `,organization_id.eq.${organizationId}` : ""}`
        : `${organizationId ? `organization_id.eq.${organizationId},` : ""}organization_id.is.null`;
      const { data: costRows } = await supabaseAdmin
        .from("ml_product_costs")
        .select("item_id, seller_sku, cost, cost_full, organization_id, user_id")
        .or(costOr)
        .limit(50000);
      for (const r of (costRows ?? []) as any[]) {
        // `cost == null` não pode mais abortar a linha: um produto pode ter
        // cost_full sem cost. O early-continue anterior descartaria o cheio.
        if (r.cost != null) {
          if (r.item_id) costMap.set(r.item_id, Number(r.cost));
          if (r.seller_sku) skuCostMap.set(r.seller_sku, Number(r.cost));
        }
        if (r.cost_full != null && r.seller_sku) skuCostFullMap.set(r.seller_sku, Number(r.cost_full));
      }
    }

    // ── Fetch brand names for all unique item IDs ─────────────────────────────
    console.log(`Fetching brands for ${itemIds.length} unique items…`);
    const brandMap = await fetchItemBrands(itemIds, accessToken);
    console.log(`Brand map populated: ${brandMap.size} entries`);

    // ── Expand + upsert ───────────────────────────────────────────────────────
    const contadoresFiscais = { pedidosSemVigencia: 0 };
    const records = orders.flatMap((o) =>
      expandOrder(o, ml_user_id, effectiveSellerId, userId, organizationId, syncAt, shipmentMap, costMap, taxConfigs, brandMap, skuCostMap, skuCostFullMap, tabelaUf, contadoresFiscais),
    );
    if (contadoresFiscais.pedidosSemVigencia > 0) {
      console.log(
        `sync-ml-orders: ${contadoresFiscais.pedidosSemVigencia} pedidos com config fiscal cadastrada mas SEM vigência cobrindo a data do pedido — imposto ausente e receita_liquida não recalculada`,
      );
    }
    // Visibilidade (Fase 220, TAX-01): silêncio foi o que deixou o bug do
    // imposto viver quatro meses. Conta quantos itens ficaram com o imposto
    // preservado (não recalculado) por destino desconhecido nesta rodada.
    const impostoPreservado = records.filter((r) => r.tax_rate == null).length;
    if (impostoPreservado > 0) {
      console.log(`sync-ml-orders: ${impostoPreservado} itens com imposto preservado por destino desconhecido`);
    }

    let upserted = 0;
    if (records.length > 0) {
      // Batch upsert via RPC — 1 round-trip para todos os pedidos do lote.
      // Passa o array direto (NÃO JSON.stringify): o param é jsonb; uma string
      // viraria escalar e jsonb_array_elements falha ("cannot extract elements
      // from a scalar").
      const { data: batchCount, error: batchErr } = await supabaseAdmin.rpc(
        "batch_upsert_orders",
        { p_records: records },
      );

      if (batchErr) {
        // NÃO engolir o erro: lançar para o job refletir failure (antes retornava
        // 200 orders_synced=0 e mascarava o RPC quebrado — congelou orders em 05-27).
        console.error("batch_upsert_orders failed:", batchErr.message);
        throw new Error(`batch_upsert_orders failed: ${batchErr.message}`);
      }
      upserted = (batchCount as number) ?? records.length;
      console.log(`Batch upserted ${upserted}/${records.length} orders (cost preserved, 1 RPC)`);
    }

    // ── Reconciliação de cancelamentos tardios ────────────────────────────────
    // A busca acima janela por `order.date_created`. Um pedido capturado como
    // `paid` e cancelado DEPOIS nunca reaparece numa janela posterior — ele já
    // não pertence a ela — e o status congela para sempre no que era na captura.
    //
    // Em 2026-07-31 isso somava 203 pedidos cancelados contados como pagos
    // (R$ 63.243,96 de receita fantasma), confirmados um a um contra a API do ML.
    //
    // A correção pergunta ao ML especificamente pelos cancelados do período —
    // conjunto pequeno (855 em sete meses) — em vez de reprocessar tudo por
    // `last_updated`, que traria milhares de pedidos sem mudança de status.
    //
    // [225-10] Não roda na recaptura: ali a janela `date_from`/`date_to` serve
    // só de referência de vigência fiscal, não é um período varrido — varrer
    // cancelados dela seria trabalho sobre uma janela que ninguém pediu.
    const reconciliados = only_missing ? 0 : await reconcileCancelled(
      mlNumericId,
      rangeStart,
      rangeEnd,
      accessToken,
      supabaseAdmin,
      organizationId,
    );
    if (reconciliados > 0) {
      console.log(`sync-ml-orders: ${reconciliados} cancelamentos tardios reconciliados`);
    }

    // ── [225-10] O vigia da folga, na linha da própria rodada ────────────────
    // Sem `sync_job_id` a rodada não tem onde gravar, e isso é dito no retorno:
    // coluna vazia significa "esta rodada não mediu", nunca "o atraso foi zero".
    let vigia_gravado = false;
    if (repescagem_resultado.rodou && sync_job_id != null) {
      vigia_gravado = await gravarVigiaDaFolga(
        supabaseAdmin,
        sync_job_id,
        repescagem_resultado.maior_atraso_horas,
        repescagem_resultado.atraso_denominador,
      );
    }

    // ── Log to ml_sync_log ────────────────────────────────────────────────────
    // [225-10] A recaptura NÃO escreve aqui. A chave do upsert é
    // (user_id, ml_user_id, date_from, date_to, source), e a janela que a
    // recaptura recebe é referência de vigência fiscal, não período varrido:
    // gravar por cima sobrescreveria o registro da varredura real daquele dia
    // com uma contagem que não corresponde a ele.
    const daysCount = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1;
    if (!only_missing) await supabaseAdmin
      .from("ml_sync_log")
      .upsert(
        {
          user_id:        userId,
          ml_user_id,
          seller_id:      effectiveSellerId,
          organization_id: organizationId,
          date_from,
          date_to,
          days_synced:    daysCount,
          orders_fetched: upserted,
          source:         "orders",
          synced_at:      syncAt,
        },
        { onConflict: "user_id,ml_user_id,date_from,date_to,source" },
      );

    return new Response(
      JSON.stringify({
        success: true,
        modo: only_missing ? "recaptura" : "captura",
        orders_synced: upserted,
        date_from,
        date_to,
        // [225-10] A recaptura conta os três estados sem colapsar nenhum:
        // pedido pedido, pedido descartado por já existir (ZERO escrita e ZERO
        // chamada de enriquecimento para ele) e pedido recusado pelo ML com o
        // motivo ao lado — 26 menos um sem explicação é pior que 25 com motivo.
        recaptura_solicitados: recapturaSolicitados,
        recaptura_descartados: recapturaDescartados.length,
        recaptura_descartados_ids: recapturaDescartados,
        recaptura_recusados: recapturaRecusados.length,
        recaptura_recusados_detalhe: recapturaRecusados,
        // [225-10] 🔴 ZERO RECUPERADOS COM ZERO DIVERGÊNCIAS É APROVAÇÃO;
        // zero recuperados com `dias_nao_medidos` maior que zero é CEGUEIRA. O
        // retorno tem que permitir distinguir os dois sem adivinhação — por isso
        // os campos são separados e nenhum deles colapsa no outro.
        repescagem: {
          rodou:                        repescagem_resultado.rodou,
          motivo:                       repescagem_resultado.motivo,
          faixa:                        repescagem_resultado.faixa,
          janela_dias:                  repescagem_resultado.janela_dias,
          teto_dias:                    repescagem_resultado.teto_dias,
          bloco:                        repescagem_resultado.bloco,
          dias_examinados:              repescagem_resultado.dias_examinados,
          dias_nao_examinados:          repescagem_resultado.dias_nao_examinados,
          dias_com_divergencia:         repescagem_resultado.dias_com_divergencia,
          dias_nao_medidos:             repescagem_resultado.dias_nao_medidos,
          dias_nao_medidos_lista:       repescagem_resultado.dias_nao_medidos_lista,
          bordas_nao_medidas:           repescagem_resultado.bordas_nao_medidas,
          ausentes_encontrados:         repescagem_resultado.ausentes_encontrados,
          descartados_por_ja_existirem: repescagem_resultado.descartados_por_ja_existirem,
          recuperados:                  repescagem_resultado.recuperados,
          recuperacao_adiada:           repescagem_resultado.recuperacao_adiada,
          recusados:                    repescagem_resultado.recusados,
          maior_atraso_horas:           repescagem_resultado.maior_atraso_horas,
          atraso_denominador:           repescagem_resultado.atraso_denominador,
          sem_data_de_fechamento:       repescagem_resultado.sem_data_de_fechamento,
          folga_estourada:              repescagem_resultado.folga_estourada,
          vigia_gravado,
        },
        shipments_failed: shipmentsFailed,
        shipments_total:  shipmentsAttempted,
        tax_preserved:    impostoPreservado,
        // [222-05-R] Distinto de tax_preserved: aqui a loja TEM regime
        // cadastrado, e mesmo assim nenhuma vigência cobre a data do pedido.
        tax_sem_vigencia: contadoresFiscais.pedidosSemVigencia,
        // Flex (Fase 222): silêncio aqui é o que deixou o imposto errado
        // viver quatro meses (Fase 220) — nunca omitir estes três.
        flex_self_service:  flexSelfService,
        flex_bonus_resolved: flexBonusResolved,
        flex_bonus_failed:   flexBonusFailed,
        // [222-13-R2, D-R2-04] Particao dos envios buscados nesta rodada.
        // `_zero` e `_ausente` NUNCA colapsam: zero e o comprador que
        // comprovadamente nao pagou frete, ausente e a chamada de custos que
        // falhou. E `_ausente` alto e o sinal de que o recalculo em lote ainda
        // nao pode rodar sobre a janela.
        frete_comprador_capturado: freteCompradorCapturado,
        frete_comprador_zero:      freteCompradorZero,
        frete_comprador_ausente:   freteCompradorAusente,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-orders error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
