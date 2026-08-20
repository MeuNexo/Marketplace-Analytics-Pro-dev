import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  lerPedidos,
  classificarCaptura,
  selecionarLote,
  TAMANHO_MAXIMO_LOTE,
  type PedidoSaleFee,
  type CapturaDecidida,
} from "../_shared/orderSaleFee.ts";
import {
  inicioInclusivoDataPedido,
  fimExclusivoDataPedido,
} from "../_shared/janelaDataPedido.ts";

/**
 * sync-ml-order-sale-fee/index.ts — a ingestão do rebate por pedido
 * (Fase 223, plano 223-04).
 *
 * O QUE ESTA EDGE FUNCTION É, E O QUE ELA NÃO É: ela busca, entrega ao
 * núcleo puro (`orderSaleFee.ts`, 223-03) e grava o que ele decidiu. Nenhuma
 * regra de negócio mora aqui — `lerPedidos`, `classificarCaptura` e
 * `selecionarLote` são quem decide o que é comissão, o que é estorno, o que
 * autoriza afirmar rebate e quantos pedidos cabem num lote. Ver o cabeçalho
 * de `orderSaleFee.ts` para as duas identidades medidas e a armadilha do
 * cancelamento (Q4).
 *
 * POR QUE ESTE ENDPOINT EXIGE DISCIPLINA DE LIMITE DE TAXA (D-223-05,
 * ML-BILLING-API-DOC.txt linhas 194-211): `/group/ML/order/details` é o
 * CAMPEÃO de erro 429 no Mercado Livre, e o bloqueio é POR IP — quando ele
 * cai, cai em cima de `sync-ml-orders`, `sync-ml-billing` e da sincronização
 * de ads ao mesmo tempo. As duas causas documentadas são: consulta repetida
 * por pedido já processado, e mais de 60 `order_ids` por chamada. Por isso:
 *
 *   · nunca mais que `TAMANHO_MAXIMO_LOTE` (60, importado do núcleo puro —
 *     o número não é reescrito aqui);
 *   · a marca de processado vive em `ml_order_sale_fee_captura` — um pedido
 *     capturado (status "ok") nunca reentra num lote seguinte;
 *   · nenhuma chamada de rede em paralelo, em ponto nenhum deste arquivo —
 *     nem entre lotes da mesma conta, nem entre contas no leque diário;
 *   · um 429 interrompe a RODADA INTEIRA desta invocação (todas as contas,
 *     se for o leque) e NÃO dispara continuação — insistir é o que
 *     transforma bloqueio preventivo em bloqueio longo;
 *   · uma resposta 206 (dado incompleto) nunca vira rebate zero — o núcleo
 *     puro marca "parcial" com `saleFee: null`, e a restrição de banco do
 *     223-03 recusa a linha se este arquivo tentar gravar valor mesmo assim.
 *
 * O QUE NÃO FOI COPIADO de `sync-ml-billing/index.ts` (223-PATTERNS.md): a
 * paginação por `from_id`/`ml_billing_page_cursor` — este endpoint não pagina
 * por cursor de página, o "cursor" aqui é "quais order_ids ainda não têm
 * captura", resolvido por consulta ao banco; a agregação de fatura por
 * competência; a resolução de fatura por período; e o staging apagado depois
 * (`limparInsumo`) — D-223-04 é explícita: tabela definitiva, nada de insumo
 * temporário.
 *
 * DUAS FORMAS DE RESPOSTA, no molde do irmão:
 *   · leque diário (mode=daily, sem ml_user_id, só service-role): responde
 *     202 de imediato e roda em `EdgeRuntime.waitUntil` — evita o pg_net do
 *     cron segurar a conexão pela rodada inteira de todas as contas.
 *   · conta única (backfill, ou daily com ml_user_id): processa até
 *     `max_lotes` de forma SÍNCRONA nesta própria invocação (é o que dá ao
 *     portão de produção do 223-08 um corpo de resposta com números
 *     declarados — `restantes`, `interrompido_por_429` — para chamar a
 *     função à mão e saber se o backfill terminou, sem inferir). Só a
 *     PRÓXIMA invocação (quando ainda há pendência não tentada e nenhum 429
 *     ocorreu) é disparada sem esperar, dentro de `EdgeRuntime.waitUntil`.
 *
 * ⚠️ Nada de deploy aqui. Escrever o arquivo é o trabalho desta task;
 * publicar (via MCP `apply_migration`/deploy de function) é portão do
 * orquestrador no 223-08.
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

/** Pausa fixa entre lotes da MESMA conta — nunca disparar o próximo lote sem aguardar o anterior. */
const PAUSA_ENTRE_LOTES_MS = 1_000;

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
 * `GET /billing/integration/group/ML/order/details?order_ids=<até 60>`, uma
 * chamada por vez, nunca em paralelo com outra. Repetição de até 5
 * tentativas com espera crescente em 429 e 5xx — mesmo molde de
 * `sync-ml-billing/index.ts` (`fetchPage`, linhas 170-211) — e
 * **try/catch explícito em volta do `fetch`**: `AbortSignal.timeout` lança
 * exceção, não devolve status, e sem este catch o tempo limite escapa do
 * laço de repetição (bug real, corrigido em 06/08 no irmão).
 *
 * Se as 5 tentativas se esgotarem AINDA em 429, o `httpStatus` devolvido é
 * 429 mesmo assim — é o chamador (`processarLote`) quem decide que isso
 * interrompe a rodada inteira, não esta função.
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
      // O(s) pedido(s) não existe(m) no faturamento — vira "sem linha de
      // faturamento" pela regra do núcleo puro (classificarCaptura), não
      // um erro a reagendar com o mesmo peso de um 5xx.
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
      .select("ml_order_id, status, proxima_tentativa, tentativas")
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

// ── Um lote: chama, classifica pelo núcleo puro, grava ───────────────────────

interface ResultadoLote {
  httpStatusRecebido: number;
  decisoes: CapturaDecidida[];
}

async function processarLote(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  accessToken: string,
  lote: readonly string[],
  agora: Date,
  tentativasAtuais: Readonly<Record<string, number>>,
): Promise<ResultadoLote & { mapaPedidos: ReadonlyMap<string, PedidoSaleFee> | null }> {
  const resposta = await fetchOrderSaleFeeLote(accessToken, lote);

  if (resposta.httpStatus === 404) {
    // 404 → "sem linha de faturamento" pela regra do núcleo puro: chamamos
    // classificarCaptura como se fosse 200 com o mapa de leitura vazio, para
    // que cada pedido caia no ramo "sem_linha" (nunca "erro" — 404 aqui não
    // é falha transitória, é ausência confirmada de linha).
    const decisoes = classificarCaptura({
      pedidosDoLote: lote,
      lidos: new Map(),
      httpStatus: 200,
      agora,
      tentativasAtuais,
    });
    await gravarCapturas(supabaseAdmin, organizationId, mlUserId, decisoes);
    return { httpStatusRecebido: 404, decisoes, mapaPedidos: null };
  }

  if (resposta.httpStatus === 200) {
    const mapaPedidos = lerPedidos(resposta.results);
    const decisoes = classificarCaptura({
      pedidosDoLote: lote,
      lidos: mapaPedidos,
      httpStatus: 200,
      agora,
      tentativasAtuais,
    });
    const idsCapturados = decisoes.filter((d) => d.status === "ok").map((d) => d.ml_order_id);
    await gravarLinhas(supabaseAdmin, organizationId, mlUserId, mapaPedidos, idsCapturados);
    await gravarCapturas(supabaseAdmin, organizationId, mlUserId, decisoes);
    return { httpStatusRecebido: 200, decisoes, mapaPedidos };
  }

  // 206, 429, 5xx esgotado, ou qualquer outro status: o núcleo puro trata
  // tudo que não é 200 nem 206 como "erro" (reagenda); 206 vira "parcial"
  // (saleFee null, nunca zero — D-223-05).
  const decisoes = classificarCaptura({
    pedidosDoLote: lote,
    lidos: new Map(),
    httpStatus: resposta.httpStatus,
    agora,
    tentativasAtuais,
  });
  await gravarCapturas(supabaseAdmin, organizationId, mlUserId, decisoes);
  return { httpStatusRecebido: resposta.httpStatus, decisoes, mapaPedidos: null };
}

// ── Uma conta inteira: até max_lotes, sequencial, sem paralelismo ───────────

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
  motivo?: string;
}

async function executarParaConta(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  organizationId: string,
  mlUserId: string,
  accessToken: string,
  modo: "daily" | "backfill",
  maxLotes: number,
): Promise<ResultadoConta> {
  const configRow = await lerConfig(supabaseAdmin, organizationId, mlUserId);
  if (!configRow || !configRow.habilitado) {
    // Quais contas entram vem da tabela de configuração, não de constante no
    // código (D-223-02/D-223-03) — conta ausente ou desabilitada não gasta
    // nenhuma chamada de rede.
    return {
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
      motivo: "conta nao habilitada em ml_sale_fee_sync_config",
    };
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

  // Guarda de laço: nunca mais que maxLotes rodadas de rede nesta invocação —
  // nunca loopar infinitamente se algo de inesperado vier do banco/API.
  while (lotes < maxLotes && restantesTrabalho.length > 0) {
    // TAMANHO_MAXIMO_LOTE vem do núcleo puro (223-03) — o teto de 60 nunca é
    // reescrito aqui.
    const lote = selecionarLote(restantesTrabalho, TAMANHO_MAXIMO_LOTE);
    if (lote.length === 0) break;

    const tentativasAtuais: Record<string, number> = {};
    for (const id of lote) {
      const c = capturaMap.get(id);
      if (c) tentativasAtuais[id] = c.tentativas;
    }

    // Uma chamada de rede por vez, sempre aguardada antes da próxima —
    // nenhuma agregação de promessas simultâneas em ponto nenhum deste laço.
    const resultado = await processarLote(
      supabaseAdmin,
      organizationId,
      mlUserId,
      accessToken,
      lote,
      agora,
      tentativasAtuais,
    );
    lotes += 1;
    pedidosConsultados += lote.length;

    for (const d of resultado.decisoes) {
      if (d.status === "ok") {
        capturados += 1;
        capturadosOkCount += 1;
        linhasGravadas += d.linhas;
        if (d.temEstorno) comEstorno += 1;
        // Identidade (I), só observabilidade: soma das linhas de comissão
        // contra sale_fee.net da raiz — não depende de orders.
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
      });
    }

    restantesTrabalho = restantesTrabalho.filter((id) => !lote.includes(id));

    if (resultado.httpStatusRecebido === 429) {
      // Bloqueio preventivo por IP — interrompe a RODADA INTEIRA desta
      // invocação. Nunca insistir: é isso que transforma bloqueio preventivo
      // em bloqueio longo (D-223-05).
      interrompidoPor429 = true;
      break;
    }

    if (restantesTrabalho.length > 0 && lotes < maxLotes) {
      // Pausa fixa entre lotes — nunca disparar o próximo sem aguardar.
      await sleep(PAUSA_ENTRE_LOTES_MS);
    }
  }

  // restantes: quantos pedidos AINDA não têm resposta definitiva (nem
  // capturados, nem desistidos) — número declarado, nunca inferido. Inclui
  // tanto os que nem chegaram a ser tentados nesta invocação (cortados pelo
  // teto de maxLotes) quanto os que ficaram "parcial"/"erro"/"sem_linha" e
  // aguardam a próxima janela de retentativa.
  const restantes = pendentesIniciais.length - capturadosOkCount - desistidosCount;

  // Continuação: só quando ainda há pendência NÃO TENTADA nesta invocação
  // (cortada pelo teto de maxLotes) e nenhum 429 ocorreu. Pedidos que
  // ficaram "parcial"/"erro" já têm `proxima_tentativa` agendada — não
  // precisam de continuação imediata, o próximo ciclo (cron/backfill) os
  // pega sozinho.
  if (restantesTrabalho.length > 0 && !interrompidoPor429) {
    EdgeRuntime.waitUntil(
      continuarEmOutraInvocacao({ mode: modo, ml_user_id: mlUserId, max_lotes: maxLotes }),
    );
  }

  return {
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
  // (executarParaConta já para sozinha);
  // o leque segue para a próxima conta normalmente, porque contas diferentes
  // não compartilham o mesmo risco imediato de bloqueio — mas continuam
  // sendo chamadas uma de cada vez, nunca em paralelo.
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
      );
      resultados.push(r);
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
  mode: z.enum(["daily", "backfill"]),
  ml_user_id: z.string().min(1).optional(),
  max_lotes: z.number().int().positive().optional(),
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
    const { mode, ml_user_id, max_lotes } = parsed.data;
    const maxLotes = max_lotes ?? MAX_LOTES_PADRAO;

    if (mode === "backfill" && !ml_user_id) {
      return new Response(JSON.stringify({ error: "ml_user_id required for backfill" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Leque diário (mode=daily, sem ml_user_id) — só service-role, molde
    // do irmão (sync-ml-billing, runAllAccountsDailySync). Responde de
    // imediato e roda em background: evita o pg_net do cron segurar a
    // conexão pela rodada inteira de todas as contas habilitadas.
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

    // ── Conta única (backfill, ou daily com ml_user_id) ──────────────────
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

    const resultado = await executarParaConta(
      supabaseAdmin,
      organizationId,
      ml_user_id!,
      accessToken,
      mode,
      maxLotes,
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
