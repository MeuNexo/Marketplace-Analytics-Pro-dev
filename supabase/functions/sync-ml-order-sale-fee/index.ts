import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  selecionarLote,
  TAMANHO_MAXIMO_LOTE,
  type PedidoSaleFee,
  type CapturaDecidida,
} from "../_shared/orderSaleFee.ts";
import { resolverLoteComTruncamento, type ChamarResultado } from "../_shared/orderSaleFeeLote.ts";
import {
  inicioInclusivoDataPedido,
  fimExclusivoDataPedido,
} from "../_shared/janelaDataPedido.ts";

/**
 * sync-ml-order-sale-fee/index.ts — a ingestão do rebate por pedido
 * (Fase 223, plano 223-04; corrigida na quick 260821-hap).
 *
 * O QUE ESTA EDGE FUNCTION É, E O QUE ELA NÃO É: ela busca, entrega ao
 * núcleo puro (`orderSaleFee.ts`) e ao módulo de lote (`orderSaleFeeLote.ts`)
 * e grava o que eles decidiram. Nenhuma regra de negócio mora aqui —
 * `selecionarLote` decide quantos ids cabem num lote,
 * `resolverLoteComTruncamento` decide o que é comissão, o que é estorno, o
 * que autoriza afirmar rebate e o que fazer quando um lote volta truncado.
 * Ver o cabeçalho de `orderSaleFee.ts`/`orderSaleFeeLote.ts` para as
 * identidades medidas e a armadilha do cancelamento (Q4).
 *
 * 🔴 O TETO REAL É DE LINHAS DE COBRANÇA, NÃO DE PEDIDOS (D-hap-01,
 * 260821-hap). `/group/ML/order/details` pagina o envelope da resposta por
 * LINHA de cobrança, teto fixo de 150 — `limit`/`offset` da query string são
 * IGNORADOS. Medido: 60 `order_ids` enviados → `limit:150 · total:49 ·
 * results:49 · linhas:150`, 11 pedidos SUMIRAM da resposta.
 * `TAMANHO_MAXIMO_LOTE` (núcleo puro) caiu de 60 para 25 por causa disso —
 * mas o teto menor só torna o caso RARO, nunca impossível.
 *
 * 🔴 AUSÊNCIA NUM LOTE NUNCA CONCLUI NADA (D-hap-02). O defeito medido em
 * produção: 327 de 1.560 pedidos (21%) foram gravados `sem_linha` a partir
 * de um lote truncado — a API os devolvia normalmente, dois com rebate real
 * de R$ 11,85 e R$ 14,55, descartado como se não existisse. A defesa vive em
 * `orderSaleFeeLote.ts`: `resolverLoteComTruncamento` só conclui `sem_linha`
 * a partir de uma chamada com UM ÚNICO `order_id` — lote com mais de um id
 * que perde pedido reconsulta cada ausente SOZINHO, na MESMA rodada.
 *
 * POR QUE ESTE ENDPOINT EXIGE DISCIPLINA DE LIMITE DE TAXA (D-223-05,
 * ML-BILLING-API-DOC.txt linhas 194-211): `/group/ML/order/details` é o
 * CAMPEÃO de erro 429 no Mercado Livre, e o bloqueio é POR IP — quando ele
 * cai, cai em cima de `sync-ml-orders`, `sync-ml-billing` e da sincronização
 * de ads ao mesmo tempo. Por isso:
 *
 *   · nunca mais que `TAMANHO_MAXIMO_LOTE` (núcleo puro — o número não é
 *     reescrito aqui);
 *   · a marca de processado vive em `ml_order_sale_fee_captura` — um pedido
 *     capturado (status "ok") nunca reentra num lote seguinte;
 *   · nenhuma chamada de rede em paralelo, em ponto nenhum deste arquivo —
 *     nem entre lotes da mesma conta, nem entre contas no leque diário, nem
 *     dentro das reconsultas solo (`orderSaleFeeLote.ts`);
 *   · um 429 interrompe a RODADA INTEIRA desta invocação (todas as contas,
 *     se for o leque) e NÃO dispara continuação — insistir é o que
 *     transforma bloqueio preventivo em bloqueio longo;
 *   · uma resposta 206 (dado incompleto) nunca vira rebate zero.
 *
 * 🔴 `max_lotes` INFORMADO NUNCA ENCADEIA CONTINUAÇÃO SOZINHO (D-hap-06).
 * Defeito medido: uma chamada com `max_lotes: 1` respondeu `lotes:1` e
 * mesmo assim varreu 1.560 pedidos, encadeando 26 vezes em background até
 * morrer sozinha, 82% por fazer, SEM sinalizar nada. Agora: a continuação só
 * dispara quando `max_lotes` NÃO veio no corpo, ou quando `continuar: true`
 * é passado explicitamente — e mesmo assim, um teto de saltos (`hop`,
 * `MAX_HOPS`) impede a cadeia de sumir de novo.
 *
 * 🔴 TODA INVOCAÇÃO DECLARA `motivo_parada` (D-hap-07) — na resposta E no
 * log, inclusive nos caminhos de leque diário e de continuação em
 * background, que são justamente os que ninguém lê a resposta.
 * `mode: "status"` responde quanto trabalho sobrou lendo só o banco
 * (`ml_order_sale_fee_captura`), ZERO chamadas ao ML.
 *
 * DUAS FORMAS DE RESPOSTA, no molde do irmão:
 *   · leque diário (mode=daily, sem ml_user_id, só service-role): responde
 *     202 de imediato e roda em `EdgeRuntime.waitUntil`.
 *   · conta única (backfill, status, ou daily com ml_user_id): processa até
 *     `max_lotes` de forma SÍNCRONA nesta própria invocação, com um corpo de
 *     resposta declarado (`restantes`, `interrompido_por_429`,
 *     `motivo_parada`, ...).
 *
 * ⚠️ Nada de deploy aqui. Escrever o arquivo é o trabalho desta task;
 * publicar (via MCP `apply_migration`/deploy de function) é portão do
 * orquestrador (260821-hap-PORTAO.md).
 */

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ML_API = "https://api.mercadolibre.com";

/** Padrão do corpo quando `max_lotes` não é informado (D-223-02: custo medido do backfill — 143 chamadas). */
const MAX_LOTES_PADRAO = 5;

/** Pausa fixa entre lotes da MESMA conta, e entre uma reconsulta solo e a próxima — nunca disparar a próxima chamada sem aguardar a anterior. */
const PAUSA_ENTRE_LOTES_MS = 1_000;

/**
 * Orçamento de reconsultas SOLO por INVOCAÇÃO (D-hap-03), não por lote —
 * decrementado ao longo de toda a rodada e passado a cada lote resolvido.
 * Dimensionado como UM LOTE INTEIRO de reconsultas: o pior caso plausível é
 * um lote inteiro voltar truncado e cada id virar uma solo — não faz sentido
 * orçar mais do que isso, é o próprio custo de reprocessar um lote id-a-id.
 */
const MAX_SOLO_POR_INVOCACAO = TAMANHO_MAXIMO_LOTE;

/**
 * Teto de saltos da cadeia de continuação (D-hap-06). Medido: sem teto, uma
 * chamada com `max_lotes: 1` encadeou 26 vezes em background até morrer
 * sozinha às 19h46, 82% do backfill por fazer, sem sinalizar nada. 50 dá
 * folga generosa mesmo para um backfill grande — com `MAX_LOTES_PADRAO=5` e
 * `TAMANHO_MAXIMO_LOTE=25`, cada invocação processa até ~125 pedidos sem
 * truncamento; 50 saltos cobrem um backfill de milhares de pedidos. Ao
 * bater o teto, a cadeia PARA e GRITA (`console.error` com `restantes`), em
 * vez de sumir de novo.
 */
const MAX_HOPS = 50;

/**
 * Tolerância da conferência interna (Identidade I: soma das linhas de
 * comissão contra `sale_fee.net` da raiz) — mesma tolerância de centavo do
 * núcleo puro (`orderSaleFee.ts`, `TOLERANCIA_CENTAVO`, não exportada).
 * `identidade_interna_divergente` é só um contador de observabilidade — não
 * decide o que gravar, por isso não precisa importar a constante privada.
 */
const TOLERANCIA_CENTAVO_OBSERVABILIDADE = 0.01;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Continuação: dispara a PRÓXIMA invocação sem esperar ────────────────────
// Fire-and-forget: se falhar, o cron/backfill seguinte retoma do mesmo ponto —
// o progresso vive no banco (ml_order_sale_fee_captura), nunca em memória.
async function continuarEmOutraInvocacao(body: Record<string, unknown>) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-ml-order-sale-fee`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    console.log(`sync-ml-order-sale-fee: continuacao disparada para ${JSON.stringify(body)}`);
  } catch (e) {
    console.error(
      "sync-ml-order-sale-fee: falha ao disparar continuacao:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ── A chamada ao endpoint campeão de 429 ────────────────────────────────────

interface RespostaLote {
  httpStatus: number;
  results: unknown[];
}

/**
 * `GET /billing/integration/group/ML/order/details?order_ids=<até
 * TAMANHO_MAXIMO_LOTE>`, uma chamada por vez, nunca em paralelo com outra.
 * Repetição de até 5 tentativas com espera crescente em 429 e 5xx — mesmo
 * molde de `sync-ml-billing/index.ts` (`fetchPage`, linhas 170-211) — e
 * **try/catch explícito em volta do `fetch`**: `AbortSignal.timeout` lança
 * exceção, não devolve status, e sem este catch o tempo limite escapa do
 * laço de repetição (bug real, corrigido em 06/08 no irmão).
 *
 * Se as 5 tentativas se esgotarem AINDA em 429, o `httpStatus` devolvido é
 * 429 mesmo assim — é quem chama (`resolverLoteComTruncamento`,
 * `orderSaleFeeLote.ts`) quem decide que isso interrompe a rodada inteira,
 * não esta função.
 */
async function fetchOrderSaleFeeLote(
  token: string,
  loteIds: readonly string[],
): Promise<RespostaLote> {
  const url = `${ML_API}/billing/integration/group/ML/order/details?order_ids=${loteIds.join(",")}`;
  let ultimoErro = "";
  let ultimoStatus = 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      // "Signal timed out." NÃO tem status — precisa deste catch, senão o
      // tempo limite escapa do laço de repetição (mesmo bug de sync-ml-billing).
      ultimoErro = e instanceof Error ? e.message : String(e);
      console.warn(
        `sync-ml-order-sale-fee: fetch falhou (tentativa ${attempt + 1}/5): ${ultimoErro}`,
      );
      await sleep(1_500 * (attempt + 1));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      ultimoStatus = res.status;
      if (res.status === 429) {
        console.warn(
          `sync-ml-order-sale-fee: 429 (bloqueio preventivo por IP) na tentativa ${attempt + 1}/5`,
        );
      }
      if (attempt < 4) {
        await sleep(1_500 * (attempt + 1));
        continue;
      }
      // Esgotou as tentativas ainda em 429/5xx — devolve o status para o
      // chamador decidir (429 interrompe a rodada; 5xx vira "erro" e reagenda).
      return { httpStatus: res.status, results: [] };
    }

    if (res.status === 206) {
      // Partial Content — dado incompleto. NUNCA vira zero (D-223-05).
      return { httpStatus: 206, results: [] };
    }

    if (res.status === 404) {
      // O(s) pedido(s) não existe(m) no faturamento — normalizado para
      // "200 vazio" por resolverLoteComTruncamento (D-hap-03), nunca um
      // erro a reagendar com o mesmo peso de um 5xx.
      return { httpStatus: 404, results: [] };
    }

    if (!res.ok) {
      return { httpStatus: res.status, results: [] };
    }

    const j = await res.json().catch(() => ({} as Record<string, unknown>));
    const results = Array.isArray((j as { results?: unknown }).results)
      ? ((j as { results: unknown[] }).results)
      : [];
    return { httpStatus: 200, results };
  }

  // Só chega aqui se as 5 tentativas falharam por exceção (timeout repetido).
  console.error(
    `sync-ml-order-sale-fee: lote esgotou 5 tentativas por exceção (ultimo erro: ${ultimoErro || "desconhecido"})`,
  );
  return { httpStatus: ultimoStatus || 599, results: [] };
}

// ── Persistência: TODAS as linhas, inclusive frete/parcelamento/estorno ─────

// deno-lint-ignore no-explicit-any
async function gravarLinhas(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  mapaPedidos: ReadonlyMap<string, PedidoSaleFee>,
  idsCapturados: readonly string[],
): Promise<number> {
  const linhas: Record<string, unknown>[] = [];
  for (const id of idsCapturados) {
    const pedido = mapaPedidos.get(id);
    if (!pedido) continue;
    for (const l of pedido.linhas) {
      linhas.push({
        organization_id: organizationId,
        ml_user_id: mlUserId,
        ml_order_id: id,
        detail_id: l.detail_id,
        item_id: l.item_id,
        detail_type: l.detail_type,
        detail_sub_type: l.detail_sub_type,
        detail_amount: l.detail_amount,
        charge_bonified_id: l.charge_bonified_id,
        charge_status: l.charge_status,
        charge_status_description: l.charge_status_description,
      });
    }
  }
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("ml_order_sale_fee")
      .upsert(linhas.slice(i, i + 500), { onConflict: "organization_id,ml_order_id,detail_id" });
    if (error) throw new Error(`upsert ml_order_sale_fee: ${error.message}`);
  }
  return linhas.length;
}

// deno-lint-ignore no-explicit-any
async function gravarCapturas(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  decisoes: readonly CapturaDecidida[],
): Promise<void> {
  const agoraISO = new Date().toISOString();
  const linhas = decisoes.map((d) => ({
    organization_id: organizationId,
    ml_user_id: mlUserId,
    ml_order_id: d.ml_order_id,
    status: d.status,
    http_status: d.httpStatus,
    tentativas: d.tentativas,
    linhas: d.linhas,
    sale_fee_gross: d.saleFee?.gross ?? null,
    sale_fee_net: d.saleFee?.net ?? null,
    // D-223-05, no nível do banco: "parcial" nunca pode gravar rebate — a
    // CHECK de ml_order_sale_fee_captura_parcial_sem_rebate (223-03) recusa
    // se este código tentar mesmo assim.
    sale_fee_rebate: d.saleFee?.rebate ?? null,
    sale_fee_discount: d.saleFee?.discount ?? null,
    discount_reason: d.saleFee?.discount_reason ?? null,
    comissao_linhas: d.comissaoLinhas,
    tem_estorno: d.temEstorno,
    capturado_em: d.status === "ok" ? agoraISO : null,
    ultima_tentativa: agoraISO,
    proxima_tentativa: d.proximaTentativa ? d.proximaTentativa.toISOString() : null,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("ml_order_sale_fee_captura")
      .upsert(linhas.slice(i, i + 500), { onConflict: "organization_id,ml_order_id" });
    if (error) throw new Error(`upsert ml_order_sale_fee_captura: ${error.message}`);
  }
}

// ── Leitura: config, janela, pendências — sempre paginado (.range()) ────────

interface ConfigConta {
  habilitado: boolean;
  backfill_desde: string;
}

// deno-lint-ignore no-explicit-any
async function lerConfig(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
): Promise<ConfigConta | null> {
  const { data, error } = await supabaseAdmin
    .from("ml_sale_fee_sync_config")
    .select("habilitado, backfill_desde")
    .eq("organization_id", organizationId)
    .eq("ml_user_id", mlUserId)
    .maybeSingle();
  if (error) throw new Error(`select ml_sale_fee_sync_config: ${error.message}`);
  return data as ConfigConta | null;
}

const STATUSES_ELEGIVEIS = ["paid", "shipped", "delivered"];

// deno-lint-ignore no-explicit-any
async function listarPedidosNaJanela(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  inicio: string,
  fim: string,
): Promise<string[]> {
  const vistos = new Set<string>();
  const PASSO = 1000;
  // PostgREST trunca em 1000 linhas em silêncio — .range() é obrigatório aqui,
  // igual à régua que a Fase 222/223 já cravaram nesta casa. Distinto por
  // ml_order_id: se orders algum dia deixar de ser 1:1 com o pedido (223-01
  // mediu 1:1 hoje, mas a tabela não impõe isso), uma venda com N linhas em
  // orders não pode virar N chamadas ao mesmo pedido no ML.
  for (let offset = 0; ; offset += PASSO) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("ml_order_id")
      .eq("organization_id", organizationId)
      .eq("ml_user_id", mlUserId)
      .in("status", STATUSES_ELEGIVEIS)
      // [D-jic-01] janelaDataPedido.ts: início inclusivo, fim EXCLUSIVO no dia
      // seguinte. data_pedido é TEXT com carimbo de hora — um <= sem hora é
      // FALSO para tudo que não seja meia-noite exata (recalc-order-costs
      // mentiu assim em 20/08: success:true, scanned:0).
      .gte("data_pedido", inicio)
      .lt("data_pedido", fim)
      .order("ml_order_id", { ascending: true })
      .range(offset, offset + PASSO - 1);
    if (error) throw new Error(`select orders (janela): ${error.message}`);
    const lote = data ?? [];
    // deno-lint-ignore no-explicit-any
    for (const r of lote as any[]) vistos.add(String(r.ml_order_id));
    if (lote.length < PASSO) break;
  }
  return [...vistos];
}

interface CapturaExistente {
  status: string;
  proxima_tentativa: string | null;
  tentativas: number;
  /** Usado só por `mode: "status"` — a última vez que este pedido foi tentado. */
  ultima_tentativa: string | null;
}

// deno-lint-ignore no-explicit-any
async function lerCapturaExistente(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
): Promise<Map<string, CapturaExistente>> {
  const mapa = new Map<string, CapturaExistente>();
  const PASSO = 1000;
  for (let offset = 0; ; offset += PASSO) {
    const { data, error } = await supabaseAdmin
      .from("ml_order_sale_fee_captura")
      .select("ml_order_id, status, proxima_tentativa, tentativas, ultima_tentativa")
      .eq("organization_id", organizationId)
      .eq("ml_user_id", mlUserId)
      .order("ml_order_id", { ascending: true })
      .range(offset, offset + PASSO - 1);
    if (error) throw new Error(`select ml_order_sale_fee_captura (existente): ${error.message}`);
    const lote = data ?? [];
    // deno-lint-ignore no-explicit-any
    for (const r of lote as any[]) {
      mapa.set(String(r.ml_order_id), {
        status: String(r.status),
        proxima_tentativa: r.proxima_tentativa ?? null,
        tentativas: Number(r.tentativas ?? 0),
        ultima_tentativa: r.ultima_tentativa ?? null,
      });
    }
    if (lote.length < PASSO) break;
  }
  return mapa;
}

// ── A janela de datas por modo ───────────────────────────────────────────────

/** `dias` dias antes de `agora`, em UTC puro, formato AAAA-MM-DD. */
function diasAntesUTC(agora: Date, dias: number): string {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hojeUTC(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}

// ── Um lote: resolve com resolverLoteComTruncamento, grava ──────────────────

interface ResultadoLote {
  decisoes: CapturaDecidida[];
  interrompidoPor429: boolean;
  truncamentoDetectado: boolean;
  solosUsados: number;
  ausentesNaoResolvidos: number;
  chamadas: number;
}

/**
 * Resolve UM lote (até `TAMANHO_MAXIMO_LOTE` ids): a decisão sobre
 * truncamento, reconsulta solo e classificação de cada pedido é INTEIRA de
 * `resolverLoteComTruncamento` (`orderSaleFeeLote.ts`, 260821-hap Task 2) —
 * este arquivo só injeta a chamada de rede (`fetchOrderSaleFeeLote`) e a
 * pausa, e persiste o resultado.
 */
async function processarLote(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  accessToken: string,
  lote: readonly string[],
  agora: Date,
  tentativasAtuais: Readonly<Record<string, number>>,
  maxSolo: number,
): Promise<ResultadoLote> {
  const resultado = await resolverLoteComTruncamento({
    lote,
    agora,
    tentativasAtuais,
    chamar: (ids): Promise<ChamarResultado> => fetchOrderSaleFeeLote(accessToken, ids),
    pausar: sleep,
    pausaMs: PAUSA_ENTRE_LOTES_MS,
    maxSolo,
  });

  const idsCapturados = resultado.decisoes
    .filter((d) => d.status === "ok")
    .map((d) => d.ml_order_id);
  await gravarLinhas(supabaseAdmin, organizationId, mlUserId, resultado.pedidosLidos, idsCapturados);
  await gravarCapturas(supabaseAdmin, organizationId, mlUserId, resultado.decisoes);

  return {
    decisoes: resultado.decisoes,
    interrompidoPor429: resultado.interrompidoPor429,
    truncamentoDetectado: resultado.truncamentoDetectado,
    solosUsados: resultado.solosUsados,
    ausentesNaoResolvidos: resultado.ausentesNaoResolvidos,
    chamadas: resultado.chamadas,
  };
}

// ── Uma conta inteira: até max_lotes, sequencial, sem paralelismo ───────────

/**
 * Os seis valores declarados de D-hap-07 — toda invocação termina num
 * destes, nunca calada.
 */
type MotivoParada =
  | "sem_pendencia"
  | "max_lotes"
  | "orcamento_solo"
  | "429"
  | "max_hops"
  | "conta_desabilitada";

interface ResultadoConta {
  conta: string;
  lotes: number;
  pedidos_consultados: number;
  linhas_gravadas: number;
  capturados: number;
  parciais: number;
  sem_linha: number;
  com_estorno: number;
  identidade_interna_divergente: number;
  erros: number;
  interrompido_por_429: boolean;
  restantes: number;
  /** Quantas reconsultas solo esta invocação disparou (D-hap-03). */
  reconsultas_solo: number;
  /** Em quantos lotes principais o envelope voltou truncado (D-hap-01). */
  truncamentos_detectados: number;
  /** Ausentes que sobraram sem resolução nesta invocação (orçamento/429) — nunca sem_linha. */
  ausentes_nao_resolvidos: number;
  /** D-hap-07: nunca termina calada. */
  motivo_parada: MotivoParada;
  motivo?: string;
}

interface OpcoesContinuacao {
  /** Verdadeiro quando `max_lotes` veio no CORPO CRU da requisição (antes do padrão) — D-hap-06. */
  maxLotesInformado: boolean;
  /** Verdadeiro quando `continuar: true` foi passado explicitamente. */
  continuarInformado: boolean;
  /** O `hop` desta invocação (0 na primeira chamada de uma cadeia). */
  hopAtual: number;
}

async function executarParaConta(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  accessToken: string,
  modo: "daily" | "backfill",
  maxLotes: number,
  opts: OpcoesContinuacao,
): Promise<ResultadoConta> {
  const configRow = await lerConfig(supabaseAdmin, organizationId, mlUserId);
  if (!configRow || !configRow.habilitado) {
    // Quais contas entram vem da tabela de configuração, não de constante no
    // código (D-223-02/D-223-03) — conta ausente ou desabilitada não gasta
    // nenhuma chamada de rede.
    const resultadoDesabilitada: ResultadoConta = {
      conta: mlUserId,
      lotes: 0,
      pedidos_consultados: 0,
      linhas_gravadas: 0,
      capturados: 0,
      parciais: 0,
      sem_linha: 0,
      com_estorno: 0,
      identidade_interna_divergente: 0,
      erros: 0,
      interrompido_por_429: false,
      restantes: 0,
      reconsultas_solo: 0,
      truncamentos_detectados: 0,
      ausentes_nao_resolvidos: 0,
      motivo_parada: "conta_desabilitada",
      motivo: "conta nao habilitada em ml_sale_fee_sync_config",
    };
    console.log(`sync-ml-order-sale-fee: ${JSON.stringify(resultadoDesabilitada)}`);
    return resultadoDesabilitada;
  }

  const agora = new Date();
  const dateFrom = modo === "backfill" ? configRow.backfill_desde : diasAntesUTC(agora, 3);
  const dateTo = hojeUTC(agora);
  const inicio = inicioInclusivoDataPedido(dateFrom);
  const fim = fimExclusivoDataPedido(dateTo);
  if (inicio === null || fim === null) {
    throw new Error(
      `janela invalida para ml_user_id=${mlUserId}: dateFrom=${dateFrom} dateTo=${dateTo}`,
    );
  }

  const idsNaJanela = await listarPedidosNaJanela(supabaseAdmin, organizationId, mlUserId, inicio, fim);
  const capturaMap = await lerCapturaExistente(supabaseAdmin, organizationId, mlUserId);

  const agoraMs = agora.getTime();
  const pendentesIniciais: string[] = [];
  for (const id of idsNaJanela) {
    const c = capturaMap.get(id);
    if (!c) {
      pendentesIniciais.push(id);
      continue;
    }
    if (c.status === "ok") continue; // capturado: nunca reconsultado (D-223-05)
    if (c.proxima_tentativa === null) continue; // desistiu (ex.: sem_linha esgotado)
    if (new Date(c.proxima_tentativa).getTime() > agoraMs) continue; // ainda não chegou a vez
    pendentesIniciais.push(id);
  }

  let restantesTrabalho: string[] = [...pendentesIniciais];
  let lotes = 0;
  let pedidosConsultados = 0;
  let linhasGravadas = 0;
  let capturados = 0;
  let parciais = 0;
  let semLinha = 0;
  let comEstorno = 0;
  let identidadeDivergente = 0;
  let erros = 0;
  let interrompidoPor429 = false;
  let capturadosOkCount = 0;
  let desistidosCount = 0;
  let soloOrcamentoRestante = MAX_SOLO_POR_INVOCACAO;
  let reconsultasSolo = 0;
  let truncamentosDetectados = 0;
  let ausentesNaoResolvidosTotal = 0;
  let paradaPorOrcamentoSolo = false;

  // Guarda de laço: nunca mais que maxLotes rodadas de rede nesta invocação —
  // nunca loopar infinitamente se algo de inesperado vier do banco/API.
  while (lotes < maxLotes && restantesTrabalho.length > 0) {
    // TAMANHO_MAXIMO_LOTE vem do núcleo puro — o teto medido nunca é
    // reescrito aqui.
    const lote = selecionarLote(restantesTrabalho, TAMANHO_MAXIMO_LOTE);
    if (lote.length === 0) break;

    const tentativasAtuais: Record<string, number> = {};
    for (const id of lote) {
      const c = capturaMap.get(id);
      if (c) tentativasAtuais[id] = c.tentativas;
    }

    // Uma resolução de lote por vez, sempre aguardada antes da próxima —
    // nenhuma agregação de promessas simultâneas em ponto nenhum deste laço.
    const resultado = await processarLote(
      supabaseAdmin,
      organizationId,
      mlUserId,
      accessToken,
      lote,
      agora,
      tentativasAtuais,
      soloOrcamentoRestante,
    );
    lotes += 1;
    pedidosConsultados += lote.length;
    soloOrcamentoRestante = Math.max(0, soloOrcamentoRestante - resultado.solosUsados);
    reconsultasSolo += resultado.solosUsados;
    if (resultado.truncamentoDetectado) truncamentosDetectados += 1;
    ausentesNaoResolvidosTotal += resultado.ausentesNaoResolvidos;

    for (const d of resultado.decisoes) {
      if (d.status === "ok") {
        capturados += 1;
        capturadosOkCount += 1;
        linhasGravadas += d.linhas;
        if (d.temEstorno) comEstorno += 1;
        // Identidade (I), só observabilidade: soma das linhas de comissão
        // contra sale_fee.net da raiz — não depende de orders. Ignora
        // comissaoLinhas nulo (D-hap-04: "não confere" não é "diverge").
        if (
          d.saleFee?.net != null &&
          d.comissaoLinhas != null &&
          Math.abs(d.comissaoLinhas - d.saleFee.net) > TOLERANCIA_CENTAVO_OBSERVABILIDADE
        ) {
          identidadeDivergente += 1;
        }
      } else if (d.status === "parcial") {
        parciais += 1;
      } else if (d.status === "sem_linha") {
        semLinha += 1;
        if (d.proximaTentativa === null) desistidosCount += 1;
      } else {
        erros += 1;
      }
      // Atualiza o mapa local para as próximas iterações deste MESMO laço —
      // sem isso, um pedido reprocessado dentro da mesma invocação recontaria
      // tentativas a partir de zero.
      capturaMap.set(d.ml_order_id, {
        status: d.status,
        proxima_tentativa: d.proximaTentativa ? d.proximaTentativa.toISOString() : null,
        tentativas: d.tentativas,
        ultima_tentativa: agora.toISOString(),
      });
    }

    restantesTrabalho = restantesTrabalho.filter((id) => !lote.includes(id));

    if (resultado.interrompidoPor429) {
      // Bloqueio preventivo por IP — interrompe a RODADA INTEIRA desta
      // invocação. Nunca insistir: é isso que transforma bloqueio preventivo
      // em bloqueio longo (D-223-05).
      interrompidoPor429 = true;
      break;
    }

    if (soloOrcamentoRestante <= 0 && restantesTrabalho.length > 0) {
      // Orçamento de solos desta invocação esgotado (D-hap-03): continuar
      // disparando lotes principais só acumularia mais ausentes não
      // resolvidos. Para aqui e deixa a próxima invocação (orçamento fresco)
      // continuar — nunca gravar sem_linha por falta de orçamento.
      paradaPorOrcamentoSolo = true;
      break;
    }

    if (restantesTrabalho.length > 0 && lotes < maxLotes) {
      // Pausa fixa entre lotes — nunca disparar o próximo sem aguardar.
      await sleep(PAUSA_ENTRE_LOTES_MS);
    }
  }

  // restantes: quantos pedidos AINDA não têm resposta definitiva (nem
  // capturados, nem desistidos) — número declarado, nunca inferido.
  const restantes = pendentesIniciais.length - capturadosOkCount - desistidosCount;

  // motivo_parada (D-hap-07): nunca termina calada. Prioridade: 429 (mais
  // urgente) > trabalho zerado > parada deliberada por orçamento > teto de
  // lotes desta invocação.
  let motivoParada: MotivoParada;
  if (interrompidoPor429) {
    motivoParada = "429";
  } else if (restantesTrabalho.length === 0) {
    motivoParada = "sem_pendencia";
  } else if (paradaPorOrcamentoSolo) {
    motivoParada = "orcamento_solo";
  } else {
    motivoParada = "max_lotes";
  }

  // Continuação (D-hap-06): só quando ainda há pendência NÃO TENTADA nesta
  // invocação, nenhum 429 ocorreu, E (max_lotes NÃO veio no corpo CRU, OU
  // continuar:true foi passado explicitamente). `max_lotes` informado sem
  // `continuar` é o caminho do portão de produção/chamada à mão: "faça
  // exatamente isto e devolva" — nunca encadeia sozinho.
  const podeContinuar =
    restantesTrabalho.length > 0 && !interrompidoPor429 && (opts.continuarInformado || !opts.maxLotesInformado);

  if (podeContinuar) {
    if (opts.hopAtual < MAX_HOPS) {
      EdgeRuntime.waitUntil(
        continuarEmOutraInvocacao({
          mode: modo,
          ml_user_id: mlUserId,
          max_lotes: maxLotes,
          continuar: opts.continuarInformado,
          hop: opts.hopAtual + 1,
        }),
      );
    } else {
      // Teto de saltos atingido — a cadeia PARA e GRITA, em vez de sumir
      // calada (era exatamente esse o defeito medido: 26 saltos silenciosos).
      console.error(
        `sync-ml-order-sale-fee: MAX_HOPS (${MAX_HOPS}) atingido para ml_user_id=${mlUserId}; restantes=${restantesTrabalho.length}`,
      );
      motivoParada = "max_hops";
    }
  }

  const resultadoFinal: ResultadoConta = {
    conta: mlUserId,
    lotes,
    pedidos_consultados: pedidosConsultados,
    linhas_gravadas: linhasGravadas,
    capturados,
    parciais,
    sem_linha: semLinha,
    com_estorno: comEstorno,
    identidade_interna_divergente: identidadeDivergente,
    erros,
    interrompido_por_429: interrompidoPor429,
    restantes,
    reconsultas_solo: reconsultasSolo,
    truncamentos_detectados: truncamentosDetectados,
    ausentes_nao_resolvidos: ausentesNaoResolvidosTotal,
    motivo_parada: motivoParada,
  };

  // D-hap-07: registrado em log ANTES de retornar — inclusive nos caminhos
  // (leque diário, continuação em background) que ninguém lê a resposta.
  console.log(`sync-ml-order-sale-fee: ${JSON.stringify(resultadoFinal)}`);

  return resultadoFinal;
}

// ── mode: "status" — quanto sobrou, lendo só o banco (D-hap-07) ────────────

interface ResultadoStatus {
  conta: string;
  pendentes: number;
  capturados: number;
  sem_linha: number;
  parciais: number;
  erros: number;
  desistidos: number;
  ultima_tentativa: string | null;
}

/**
 * Responde quanto trabalho sobrou para uma conta, lendo só
 * `ml_order_sale_fee_captura` e `orders` (via `listarPedidosNaJanela` e
 * `lerCapturaExistente`, as MESMAS funções de `executarParaConta`) — ZERO
 * chamadas de rede ao ML. É também o que o portão de produção usa para
 * conferir o reparo dos 327 `sem_linha` antes e depois (260821-hap-PORTAO.md).
 */
async function executarStatusConta(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
): Promise<ResultadoStatus> {
  const vazio: ResultadoStatus = {
    conta: mlUserId,
    pendentes: 0,
    capturados: 0,
    sem_linha: 0,
    parciais: 0,
    erros: 0,
    desistidos: 0,
    ultima_tentativa: null,
  };

  const configRow = await lerConfig(supabaseAdmin, organizationId, mlUserId);
  if (!configRow) return vazio;

  const agora = new Date();
  const inicio = inicioInclusivoDataPedido(configRow.backfill_desde);
  const fim = fimExclusivoDataPedido(hojeUTC(agora));
  if (inicio === null || fim === null) {
    throw new Error(`janela invalida para status ml_user_id=${mlUserId}`);
  }

  const idsNaJanela = await listarPedidosNaJanela(supabaseAdmin, organizationId, mlUserId, inicio, fim);
  const capturaMap = await lerCapturaExistente(supabaseAdmin, organizationId, mlUserId);

  let pendentes = 0;
  let capturados = 0;
  let semLinha = 0;
  let parciais = 0;
  let erros = 0;
  let desistidos = 0;
  let ultimaTentativa: string | null = null;

  for (const id of idsNaJanela) {
    const c = capturaMap.get(id);
    if (!c) {
      pendentes += 1;
      continue;
    }
    if (c.status === "ok") {
      capturados += 1;
    } else if (c.status === "sem_linha") {
      semLinha += 1;
      if (c.proxima_tentativa === null) desistidos += 1;
    } else if (c.status === "parcial") {
      parciais += 1;
    } else if (c.status === "erro") {
      erros += 1;
    }
    if (c.ultima_tentativa && (!ultimaTentativa || c.ultima_tentativa > ultimaTentativa)) {
      ultimaTentativa = c.ultima_tentativa;
    }
  }

  return {
    conta: mlUserId,
    pendentes,
    capturados,
    sem_linha: semLinha,
    parciais,
    erros,
    desistidos,
    ultima_tentativa: ultimaTentativa,
  };
}

// ── O leque diário (mode=daily, sem ml_user_id) — só service-role ──────────

async function executarFanOutDiario(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  maxLotes: number,
): Promise<ResultadoConta[]> {
  const { data: contas, error } = await supabaseAdmin
    .from("ml_sale_fee_sync_config")
    .select("organization_id, ml_user_id")
    .eq("habilitado", true);
  if (error) throw new Error(`select ml_sale_fee_sync_config (fan-out): ${error.message}`);

  const resultados: ResultadoConta[] = [];
  // Sequencial — uma conta de cada vez, nunca uma agregação de promessas em
  // paralelo. Um 429 numa conta interrompe SÓ a rodada daquela conta
  // (executarParaConta já para sozinha); o leque segue para a próxima conta
  // normalmente.
  // deno-lint-ignore no-explicit-any
  for (const conta of (contas ?? []) as any[]) {
    const organizationId = String(conta.organization_id);
    const mlUserId = String(conta.ml_user_id);
    try {
      const { data: tokenRow } = await supabaseAdmin
        .from("ml_tokens")
        .select("access_token")
        .eq("ml_user_id", mlUserId)
        .not("access_token", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!tokenRow?.access_token) {
        console.warn(`sync-ml-order-sale-fee fan-out: sem token para ml_user_id=${mlUserId}`);
        continue;
      }
      const r = await executarParaConta(
        supabaseAdmin,
        organizationId,
        mlUserId,
        tokenRow.access_token,
        "daily",
        maxLotes,
        // O leque diário sempre trata como "max_lotes não informado" —
        // continuação opt-in por padrão para o cron, cadeia sempre nova
        // (hop 0) a cada disparo diário (D-hap-06).
        { maxLotesInformado: false, continuarInformado: false, hopAtual: 0 },
      );
      resultados.push(r);
      // D-hap-07: log do resultado (já inclui motivo_parada) — este é
      // justamente um dos caminhos que ninguém lê a resposta.
      console.log(`sync-ml-order-sale-fee fan-out: ${JSON.stringify(r)}`);
    } catch (e) {
      console.error(
        `sync-ml-order-sale-fee fan-out: ml_user_id=${mlUserId} falhou:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  return resultados;
}

// ── Body schema ───────────────────────────────────────────────────────────

const BodySchema = z.object({
  mode: z.enum(["daily", "backfill", "status"]),
  ml_user_id: z.string().min(1).optional(),
  max_lotes: z.number().int().positive().optional(),
  /** D-hap-06: opt-in explícito para encadear continuação mesmo com max_lotes informado. */
  continuar: z.boolean().optional(),
  /** D-hap-06: contador de saltos da cadeia de continuação — 0 na primeira chamada. */
  hop: z.number().int().min(0).optional(),
});

// ── Handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
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

    const rawBody = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { mode, ml_user_id, max_lotes, continuar, hop } = parsed.data;
    const maxLotes = max_lotes ?? MAX_LOTES_PADRAO;
    // 🔴 D-hap-06: a decisão de continuar lê o campo CRU do corpo
    // (max_lotes, antes do `??` padrão) — nunca `maxLotes` já com o padrão
    // aplicado, senão TODA chamada pareceria "max_lotes informado".
    const maxLotesInformado = max_lotes !== undefined;
    const continuarInformado = continuar === true;
    const hopAtual = hop ?? 0;

    if ((mode === "backfill" || mode === "status") && !ml_user_id) {
      return new Response(JSON.stringify({ error: "ml_user_id required for " + mode }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Leque diário (mode=daily, sem ml_user_id) — só service-role, molde
    // do irmão (sync-ml-billing, runAllAccountsDailySync). Responde de
    // imediato e roda em background: evita o pg_net do cron segurar a
    // conexão pela rodada inteira de todas as contas.
    if (mode === "daily" && !ml_user_id) {
      if (!isServiceRole) {
        return new Response(JSON.stringify({ error: "ml_user_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bg = executarFanOutDiario(supabaseAdmin, maxLotes)
        .then((resultados) =>
          console.log(`sync-ml-order-sale-fee fan-out done: ${resultados.length} conta(s)`),
        )
        .catch((e: unknown) =>
          console.error(
            "sync-ml-order-sale-fee fan-out failed:",
            e instanceof Error ? e.message : String(e),
          ),
        );
      EdgeRuntime.waitUntil(bg);
      return new Response(
        JSON.stringify({ ok: true, modo: "daily", conta: null, status: "enqueued" }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Conta única (backfill, status, ou daily com ml_user_id) ──────────
    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("ml_tokens")
      .select("access_token, organization_id, updated_at")
      .eq("ml_user_id", ml_user_id!)
      .not("access_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tokenErr || !tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "No ML token found for this store" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accessToken: string = tokenRow.access_token;
    const organizationId: string | null = tokenRow.organization_id ?? null;
    if (!organizationId) {
      return new Response(JSON.stringify({ ok: true, warning: "organization_id missing" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isServiceRole) {
      const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
        _user_id: userId,
        _org_id: organizationId,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 🔴 mode: "status" — ZERO chamadas ao ML: nada de token usado, nada de
    // fetchOrderSaleFeeLote/resolverLoteComTruncamento neste ramo.
    if (mode === "status") {
      const resultado = await executarStatusConta(supabaseAdmin, organizationId, ml_user_id!);
      return new Response(JSON.stringify({ ok: true, modo: mode, ...resultado }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resultado = await executarParaConta(
      supabaseAdmin,
      organizationId,
      ml_user_id!,
      accessToken,
      mode,
      maxLotes,
      { maxLotesInformado, continuarInformado, hopAtual },
    );

    return new Response(JSON.stringify({ ok: true, modo: mode, ...resultado }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-order-sale-fee error:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
