/**
 * sync-mp-releases — scheduled edge function (CASH-01)
 * Ingere liberações reais do Mercado Pago para todas as orgs ativas.
 *
 * DOIS MODOS de janela temporal:
 *   (a) Histórica  (days_back=30):  saldo real passado (releases realizados/agendados)
 *   (b) Futura     (days_ahead=45): projeção de entradas (só quando days_ahead > 0)
 *
 * PERF (corrigido 2026-06-18): o endpoint /v1/payments/search JÁ retorna
 * transaction_details.net_received_amount, money_release_date, status e
 * transaction_amount em cada result — NÃO é preciso buscar /v1/payments/{id}
 * individualmente. Processa e faz UPSERT incremental POR PÁGINA (100), evitando
 * estourar o tempo-limite da edge function e tornando o progresso durável.
 *
 * Token: mesmo access_token de ml_tokens (OAuth ML serve para ML + MP na mesma conta —
 * validado em produção: /v1/payments/search retornou 200 com o token ML da Pé Vermeio).
 * Upsert idempotente por (organization_id, payment_id).
 *
 * CASHFIX-03 (2026-06-25): Reescrito com EdgeRuntime.waitUntil (202 imediato) para
 * eliminar o timeout do pg_net (~5s) que abortava antes dos ~118s de execução —
 * mesmo bug do CASH-02/payables. Toda a lógica de sync movida para runSync() com
 * try/catch + console.error (Pitfall 4: exceção no background morre silenciosamente
 * sem log se não capturada). Modo ?debug=1 roda runSync inline para prova de persistência.
 *
 * Supabase project: ckcdevcxgvueywivefgx (NÃO usar gionpsuunfkkzzjdubfy).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// 🔴 225-13 — a régua de entrada do dinheiro, em módulo puro e import RELATIVO.
// O resolvedor do vitest no Node não abre import por URL, então o núcleo
// testável mora em arquivo separado — mesmo padrão de `sync-ads/aggregate.ts`.
import { julgaPagamento } from "./aceite.ts";

// EdgeRuntime é global no runtime Supabase Edge — sem import necessário.
// Declaração de tipo para satisfazer deno check (premissa A2).
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API       = "https://api.mercadolibre.com";
const MP_API       = "https://api.mercadopago.com";
const ML_APP_ID    = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const VALID_STATUSES = ["approved", "authorized", "in_process", "in_mediation", "refunded"];

// ── 225-09: a procedência do dinheiro ────────────────────────────────────────
// O filtro acima pergunta DE QUE TIPO É O PEDIDO. Ele é verdadeiro tanto quando a
// organização VENDE quanto quando o dono COMPRA no ML pagando com a mesma conta
// Mercado Pago — e não existe checagem de QUEM RECEBEU. Foi só isso que pôs
// R$ 12.232,60 de compra pessoal em 38 linhas dentro do caixa da empresa desde
// 07/01/2026, 97,6% em maio (R$ 6.436,32) e agosto (R$ 5.496,89).
//
// 🔴 O DISCRIMINADOR NÃO É ANTI-JOIN CONTRA `orders`. As 28 vendas reais órfãs
// (R$ 2.449,52) falham no MESMO teste de "não casa com orders" que as 38 compras:
// elas são órfãs porque a ingestão de PEDIDOS as perdeu. Quem separa é o PAR
// collector_id × payer_id, medido mutuamente exclusivo e exaustivo em 438 de 438
// linhas — 0 com ambos, 0 com nenhum (225-CENSO-COLLECTOR.md, seções 1, 2 e 4).
//
// ⚠️ /v1/payments/search OMITE collector_id quando o dono do token é o pagador.
// A busca dá o sinal; o detalhe (/v1/payments/{id}) dá a prova, e é lá que o
// payer_id aparece NA RAIZ do payload — o objeto `payer` vem nulo nos dois casos.
const MOTIVO_COMPRA_DO_TITULAR = "compra_do_titular";

// A descrição que o Mercado Pago dá ao repasse de frete pago pelo comprador.
// Nesses pagamentos o id do bloco de pedido É o id do ENVIO (11 dígitos), não do
// pedido (16) — 105 linhas, R$ 1.329,15, desde 27/12/2025.
const DESCRICAO_FRETE_DO_COMPRADOR = "marketplace_shipment";

// Teto de consultas de detalhe por invocação. O censo mediu a minoria que precisa
// de detalhe em 2 de 65; o teto existe para o caso raro não estourar o tempo da
// função. O que sobra é CONTADO e volta na rodada seguinte — e a rodada seguinte
// avança porque a leitura de estado anterior faz o já conferido não gastar consulta.
const TETO_DETALHE_POR_INVOCACAO = 60;

// Página da leitura de estado anterior. O PostgREST trunca em 1.000 EM SILÊNCIO e
// cash_inflows tem 9.891 linhas na Pé Vermeio — sem faixa explícita a função
// "descobriria" que tem trabalho a fazer para sempre.
const PAGINA_ESTADO = 1000;

// Formato do identificador de pedido do ML: 16 dígitos. Usado APENAS como CONTADOR
// de anomalia no retorno, NUNCA como regra de classificação — serve para descobrir
// uma quarta família amanhã, não para decidir hoje.
const FORMATO_DE_PEDIDO_ML = /^\d{16}$/;

/** Identificador do Mercado Livre, ou nulo. Zero e vazio são ausência, não id. */
function idOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return null;
}

async function getAccessToken(sb: ReturnType<typeof createClient>, mlUserId: string): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now       = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data         = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  await sb
    .from("ml_tokens")
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at:    newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token;
}

async function mpGet(
  url: string,
  token: string,
  sb: ReturnType<typeof createClient>,
  mlUserId: string,
  retried = false,
): Promise<any> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.ok) return res.json();

    if (res.status === 401 && !retried) {
      console.warn("sync-mp-releases: 401 para ml_user_id=" + mlUserId + " — tentando refresh");
      const newToken = await getAccessToken(sb, mlUserId);
      return mpGet(url, newToken, sb, mlUserId, true);
    }

    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "2");
      await new Promise(r => setTimeout(r, (wait || 2) * 1000));
      continue;
    }

    if (i < 2 && [500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }

    throw new Error("MP " + res.status + " " + url.split("?")[0]);
  }
  throw new Error("MP retries exhausted: " + url.split("?")[0]);
}

function toBrtIso(dateStr: string, time: "start" | "end"): string {
  const t = time === "start" ? "T00:00:00.000-03:00" : "T23:59:59.000-03:00";
  return dateStr + t;
}

function todayStr(): string {
  return new Date().toISOString().substring(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

interface PaymentWindow {
  beginDate: string;
  endDate:   string;
  mode:      "historical" | "future";
}

/** O que a EF apurou nesta janela, para o retorno. Contadores, nunca adjetivos. */
interface ResultadoJanela {
  upserted:                  number;
  fora_do_caixa:             number;
  origem_indeterminada:      number;
  detalhes_consultados:      number;
  detalhes_pendentes:        number;
  envios_resolvidos:         number;
  envios_falhados:           number;
  formato_de_pedido_anomalo: number;
  /** 225-13: quantos entraram pelo CAMINHO DO DINHEIRO, e não pela lista de
   *  status. Sem contador próprio o efeito da régua nova ficaria
   *  indistinguível do movimento normal da janela. */
  aceitos_pelo_caminho_do_dinheiro: number;
}

function janelaVazia(): ResultadoJanela {
  return {
    upserted: 0, fora_do_caixa: 0, origem_indeterminada: 0,
    detalhes_consultados: 0, detalhes_pendentes: 0,
    envios_resolvidos: 0, envios_falhados: 0, formato_de_pedido_anomalo: 0,
    aceitos_pelo_caminho_do_dinheiro: 0,
  };
}

function somarJanela(a: ResultadoJanela, b: ResultadoJanela): ResultadoJanela {
  return {
    upserted:                  a.upserted + b.upserted,
    fora_do_caixa:             a.fora_do_caixa + b.fora_do_caixa,
    origem_indeterminada:      a.origem_indeterminada + b.origem_indeterminada,
    detalhes_consultados:      a.detalhes_consultados + b.detalhes_consultados,
    detalhes_pendentes:        a.detalhes_pendentes + b.detalhes_pendentes,
    envios_resolvidos:         a.envios_resolvidos + b.envios_resolvidos,
    envios_falhados:           a.envios_falhados + b.envios_falhados,
    formato_de_pedido_anomalo: a.formato_de_pedido_anomalo + b.formato_de_pedido_anomalo,
    aceitos_pelo_caminho_do_dinheiro:
      a.aceitos_pelo_caminho_do_dinheiro + b.aceitos_pelo_caminho_do_dinheiro,
  };
}

/** O que JÁ estava apurado numa linha desta janela. */
interface EstadoAnterior {
  recebedor_ml_user_id: number | null;
  pagador_ml_user_id:   number | null;
  entra_no_caixa:       boolean;
  motivo_fora_do_caixa: string | null;
  origem_conferida_em:  string | null;
  ml_order_id:          string | null;
  ml_shipment_id:       string | null;
}

/**
 * 225-09 — lê, ANTES do laço, tudo o que já foi apurado nos pagamentos da janela.
 *
 * 🔴 POR QUE ELA TRAZ A CLASSIFICAÇÃO INTEIRA, E NÃO SÓ "QUEM JÁ FOI CONFERIDO":
 * o laço monta uma linha para TODO pagamento da página e a empurra no upsert, que
 * grava a linha inteira. Se a re-invocação apenas PULASSE a consulta de detalhe de
 * um pagamento já conferido, o que aconteceria com uma compra pessoal na segunda
 * passada seria isto: a busca não traz o recebedor (a organização é a pagadora), o
 * detalhe é pulado porque já foi conferido, nada resolve — e pela regra de "estado
 * indeterminado entra no caixa" a linha voltaria a ser gravada como RECEITA, com
 * motivo nulo. O CHECK do banco considera essa combinação VÁLIDA: sem erro, sem
 * log, sem sinal. E a rota é obrigatória, não rara — o 225-11 manda reinvocar cada
 * mês que devolver pendentes.
 *
 * 🔴 E ELA TRAZ TAMBÉM AS DUAS CHAVES (pedido e envio): sem isso, uma falha
 * transitória de rede na segunda passada apagaria uma chave de pedido que já estava
 * certa, e o que ficaria contado seria "a resolução falhou", não "a chave anterior
 * foi perdida".
 *
 * ⚠️ Pagina com faixa explícita. O PostgREST trunca em 1.000 em silêncio.
 */
async function lerEstadoAnterior(
  sb: ReturnType<typeof createClient>,
  orgId: string,
  diaInicio: string,
  diaFim: string,
): Promise<Map<string, EstadoAnterior>> {
  const mapa = new Map<string, EstadoAnterior>();
  let de = 0;

  for (;;) {
    const { data, error } = await sb
      .from("cash_inflows")
      .select(
        "payment_id,recebedor_ml_user_id,pagador_ml_user_id,entra_no_caixa," +
        "motivo_fora_do_caixa,origem_conferida_em,ml_order_id,ml_shipment_id",
      )
      .eq("organization_id", orgId)
      .gte("release_date", diaInicio)
      .lte("release_date", diaFim)
      .order("payment_id", { ascending: true })
      .range(de, de + PAGINA_ESTADO - 1);

    if (error) {
      throw new Error("cash_inflows leitura de estado org=" + orgId + ": " + error.message);
    }

    const linhas: any[] = data ?? [];
    for (const l of linhas) mapa.set(String(l.payment_id), l as EstadoAnterior);

    if (linhas.length < PAGINA_ESTADO) break;
    de += PAGINA_ESTADO;
  }

  return mapa;
}

// Pagina o /search e faz UPSERT incremental por página.
async function processWindow(
  sb: ReturnType<typeof createClient>,
  mlUserId: string,
  orgId: string,
  token: string,
  win: PaymentWindow,
): Promise<ResultadoJanela> {
  let offset = 0;
  const apurado = janelaVazia();

  // 🔴 Antes de processar a janela: o que já foi apurado nela.
  const estadoAnterior = await lerEstadoAnterior(
    sb, orgId, win.beginDate.substring(0, 10), win.endDate.substring(0, 10),
  );

  while (true) {
    const qs = new URLSearchParams({
      sort:       "money_release_date",
      criteria:   "asc",
      range:      "money_release_date",
      begin_date: win.beginDate,
      end_date:   win.endDate,
      limit:      "100",
      offset:     String(offset),
    });

    const data = await mpGet(MP_API + "/v1/payments/search?" + qs.toString(), token, sb, mlUserId);
    const pageResults: any[] = data?.results ?? [];
    const total: number      = data?.paging?.total ?? 0;

    if (offset === 0) {
      console.log(
        "sync-mp-releases: 1a chamada MP ml_user_id=" + mlUserId +
        " mode=" + win.mode + " total=" + total +
        " begin=" + win.beginDate.substring(0, 10) + " end=" + win.endDate.substring(0, 10) +
        " estado_lido=" + estadoAnterior.size,
      );
    }

    const syncedAt = new Date().toISOString();
    const rows: any[] = [];

    for (const p of pageResults) {
      // Só VENDAS reais do Mercado Livre (decisão Wesley 2026-06-18): a venda tem
      // order.type === 'mercadolibre' (mesmo paga via pix/bank_transfer/account_money).
      // Exclui aportes/transferências (cofrinho/rendimento do MP, PSP_TRANSFER) que
      // vêm como regular_payment mas sem order de marketplace — NÃO são receita.
      //
      // ⚠️ 225-09: este filtro NÃO muda. Ele continua sendo a porta de entrada; o que
      // mudou é que passar por ele deixou de ser suficiente para o valor virar receita.
      if (String(p?.order?.type ?? "") !== "mercadolibre") continue;

      const status = String(p?.status ?? "").toLowerCase();

      // 🔴 225-13 — A RÉGUA DECIDE PELO DINHEIRO, NÃO PELO RÓTULO.
      //
      // Até aqui a recusa era `!VALID_STATUSES.includes(status)`, e ela
      // acontecia ANTES de qualquer escrita. `charged_back` com
      // `status_detail = reimbursed` é contestação encerrada A NOSSO FAVOR: o
      // dinheiro foi liberado e está no bolso. 14 pagamentos e R$ 3.330,88 em
      // 2026 eram descartados aqui — 6 nunca entraram (R$ 1.280,40) e 8
      // congelaram sem a chave de pedido que o payload trazia, porque toda
      // passagem seguinte morria neste `continue`.
      //
      // A régua é ADITIVA e mora em `./aceite.ts`: a lista de cinco continua
      // sendo o primeiro ramo, intocada, e chega como ARGUMENTO. O segundo
      // ramo admite o que tem dinheiro liberado e estorno ZERO, com os dois
      // campos PRESENTES — contestação de fato perdida continua recusada.
      const veredito = julgaPagamento(p, VALID_STATUSES);
      if (!veredito.aceita) continue;
      if (veredito.via === "dinheiro") apurado.aceitos_pelo_caminho_do_dinheiro++;

      const releaseDate = String(p?.money_release_date ?? "").substring(0, 10);
      if (!releaseDate) continue;

      let net = Number(p?.transaction_details?.net_received_amount ?? 0);
      if (status === "refunded") net = -Math.abs(net);

      // FIX 3 (99, 2026-07-17, decisão do dono): estorno pesa no mês em que
      // o dinheiro SAIU, não no mês da venda original. Para isso a RPC
      // precisa de uma data própria para o estorno — `date_last_updated` do
      // payment é a melhor aproximação disponível no /v1/payments/search
      // para "quando o estorno aconteceu" (o endpoint não devolve um campo
      // dedicado tipo refund_date; buscar /v1/payments/{id}/refunds exigiria
      // 1 chamada extra por pagamento, reintroduzindo o problema de perf que
      // o /search em lote resolveu — ver cabeçalho do arquivo). Limitação
      // pré-existente e já documentada: estornos PARCIAIS (status continua
      // approved, só net_received_amount cai) ficam fora do modelo — mesma
      // lacuna que já existia antes desta mudança.
      const refundDate = status === "refunded"
        ? (String(p?.date_last_updated ?? "").substring(0, 10) || null)
        : null;

      const paymentId = String(p.id);
      const anterior  = estadoAnterior.get(paymentId) ?? null;

      // 🔴 Já conferido = a pergunta já foi respondida para esta linha. Não gasta
      // consulta de detalhe E carrega a classificação de volta VERBATIM.
      const jaConferido =
        anterior !== null &&
        anterior.origem_conferida_em !== null &&
        anterior.origem_conferida_em !== undefined;

      let recebedor:    number | null = null;
      let pagador:      number | null = null;
      let entraNoCaixa: boolean       = true;
      let motivo:       string | null = null;
      let conferidaEm:  string | null = null;

      if (jaConferido) {
        // Verbatim: não recalcula, não consulta, não deduz. Reprocessar a mesma
        // janela duas vezes tem que deixar a classificação IDÊNTICA à da primeira
        // passada — é essa a definição operacional de idempotência aqui.
        recebedor    = (anterior as EstadoAnterior).recebedor_ml_user_id;
        pagador      = (anterior as EstadoAnterior).pagador_ml_user_id;
        entraNoCaixa = (anterior as EstadoAnterior).entra_no_caixa;
        motivo       = (anterior as EstadoAnterior).motivo_fora_do_caixa;
        conferidaEm  = (anterior as EstadoAnterior).origem_conferida_em;
      } else {
        recebedor = idOuNulo(p?.collector_id);
        pagador   = idOuNulo(p?.payer_id);

        // ⚠️ "não perguntei ainda" e "perguntei e a fonte não respondeu" são estados
        // DIFERENTES, e somá-los no mesmo contador inflaria o número que existe para
        // avisar que a exclusividade mútua do par quebrou. O censo mediu ZERO
        // indeterminadas em 438 — se o teto contasse como indeterminada, a primeira
        // invocação de uma janela grande devolveria dezenas e ninguém saberia se é
        // sinal novo ou só fila.
        let ficouPendentePorTeto = false;

        // Ausência dos dois é DÚVIDA, não veredito: a busca omite o recebedor
        // quando o dono do token é o pagador. Quem responde é o detalhe.
        if (recebedor === null && pagador === null) {
          if (apurado.detalhes_consultados < TETO_DETALHE_POR_INVOCACAO) {
            apurado.detalhes_consultados++;
            try {
              const detalhe = await mpGet(MP_API + "/v1/payments/" + paymentId, token, sb, mlUserId);
              recebedor = idOuNulo(detalhe?.collector_id);
              pagador   = idOuNulo(detalhe?.payer_id);
            } catch (e: any) {
              console.warn(
                "sync-mp-releases: detalhe de pagamento falhou payment_id=" + paymentId + ": " + e.message,
              );
            }
          } else {
            // Ficou para a rodada seguinte. Este contador é o que precisa DECRESCER
            // entre invocações — e decresce porque quem foi conferido não volta a
            // gastar consulta.
            apurado.detalhes_pendentes++;
            ficouPendentePorTeto = true;
          }
        }

        const recebeuOVendedor = recebedor !== null && recebedor === Number(mlUserId);
        const pagouOVendedor   = pagador   !== null && pagador   === Number(mlUserId);

        if (recebeuOVendedor && !pagouOVendedor) {
          entraNoCaixa = true;
          motivo       = null;
          conferidaEm  = syncedAt;
        } else if (pagouOVendedor && !recebeuOVendedor) {
          // A organização PAGOU. Não é receita. A linha FICA na tabela, visível, com
          // o motivo escrito — descartar esconderia, e nenhuma entrada some (D-225-10).
          entraNoCaixa = false;
          motivo       = MOTIVO_COMPRA_DO_TITULAR;
          conferidaEm  = syncedAt;
        } else {
          // Nem o detalhe resolveu, ou os dois vieram preenchidos. Entra no caixa —
          // é a escolha que NÃO inventa uma exclusão — com a conferência nula, e
          // soma num contador próprio. O censo mediu ZERO destes em 438 linhas:
          // qualquer ocorrência é sinal novo, e o contador é o que impede a escolha
          // de virar silêncio.
          entraNoCaixa = true;
          motivo       = null;
          conferidaEm  = null;
          // Só conta como indeterminada quem foi PERGUNTADO e não respondeu. Quem
          // apenas esbarrou no teto já está contado em detalhes_pendentes.
          if (!ficouPendentePorTeto) apurado.origem_indeterminada++;
        }
      }

      // 🔴 O `order.id` do payload é lido UMA única vez, aqui. Daqui em diante tudo
      // usa a variável — nenhum ramo regrava o identificador de ENVIO no campo de
      // pedido.
      let mlOrderId = String(p?.order?.id ?? "") || null;
      const idDoBlocoDePedido = mlOrderId;
      let mlShipmentId: string | null = anterior !== null ? anterior.ml_shipment_id : null;

      // Preservação genérica: payload sem chave não apaga chave já gravada.
      if (mlOrderId === null && anterior !== null && anterior.ml_order_id !== null) {
        mlOrderId = anterior.ml_order_id;
      }

      // ── G-06: o frete pago pelo comprador ────────────────────────────────
      // Aqui o id do bloco de pedido é o do ENVIO. Guardá-lo em coluna própria e
      // resolver o PEDIDO REAL pelo endpoint de envio — provado 103/103 pelo censo,
      // com order_id sempre presente, sender_id = o próprio vendedor nas 103 e
      // nenhuma colisão entre si. Reescrever a chave não duplica dinheiro: o frete é
      // pagamento SEPARADO do da venda e a chave única é (organization_id, payment_id).
      const ehFreteDoComprador = String(p?.description ?? "") === DESCRICAO_FRETE_DO_COMPRADOR;
      if (ehFreteDoComprador && idDoBlocoDePedido !== null) {
        mlShipmentId = idDoBlocoDePedido;

        // 🔴 Linha que JÁ resolveu conserva a chave e não gasta chamada: uma falha
        // transitória de rede não pode apagar um pedido que já estava certo.
        const pedidoJaResolvido =
          anterior !== null &&
          anterior.ml_order_id !== null &&
          anterior.ml_order_id !== idDoBlocoDePedido
            ? anterior.ml_order_id
            : null;

        if (pedidoJaResolvido !== null) {
          mlOrderId = pedidoJaResolvido;
        } else {
          // Linha que NUNCA resolveu: o campo de pedido fica nulo até a resolução
          // dar certo. Gravar o identificador de envio ali é o defeito que este
          // ramo existe para acabar.
          mlOrderId = null;
          try {
            const envio = await mpGet(ML_API + "/shipments/" + idDoBlocoDePedido, token, sb, mlUserId);
            mlOrderId = String(envio?.order_id ?? "") || null;
            if (mlOrderId !== null) apurado.envios_resolvidos++;
            else apurado.envios_falhados++;
          } catch (e: any) {
            apurado.envios_falhados++;
            console.warn(
              "sync-mp-releases: resolucao de envio falhou payment_id=" + paymentId + ": " + e.message,
            );
          }
        }
      }

      // Contador de anomalia de formato. MEDE, não classifica: serve para descobrir
      // uma quarta família amanhã, não para decidir hoje.
      if (mlOrderId !== null && !FORMATO_DE_PEDIDO_ML.test(mlOrderId)) {
        apurado.formato_de_pedido_anomalo++;
      }

      if (!entraNoCaixa) apurado.fora_do_caixa++;

      // ⚠️ UM ÚNICO sítio de push, de propósito: o PostgREST monta o insert pela
      // UNIÃO das chaves do lote e preenche com nulo/default o que falta em cada
      // objeto. Dois formatos de linha no mesmo lote produzem exatamente a reversão
      // silenciosa que este plano existe para fechar.
      rows.push({
        organization_id: orgId,
        ml_user_id:      Number(mlUserId),
        payment_id:      paymentId,
        release_date:    releaseDate,
        net_amount:      net,
        gross_amount:    p?.transaction_amount ?? null,
        status_mp:       p?.status ?? null,
        payment_method:  p?.payment_method_id ?? null,
        description:     p?.description ?? null,
        synced_at:       syncedAt,
        refund_date:     refundDate,
        // 225-01: a chave de conciliação venda↔repasse. `release_date` é a data em
        // que o dinheiro liberou, não a da venda, então sem esta chave é impossível
        // dizer se uma venda foi repassada. 225-09: no frete ela passou a receber o
        // PEDIDO RESOLVIDO, e nunca mais o identificador de envio.
        ml_order_id:     mlOrderId,
        // 225-09: a procedência, gravada na MESMA linha e na MESMA transação que o
        // valor. 🔴 O valor não muda — net_amount e gross_amount continuam sendo o
        // que a API devolveu; estas colunas dizem se aquele valor é da empresa.
        recebedor_ml_user_id: recebedor,
        pagador_ml_user_id:   pagador,
        entra_no_caixa:       entraNoCaixa,
        motivo_fora_do_caixa: motivo,
        origem_conferida_em:  conferidaEm,
        ml_shipment_id:       mlShipmentId,
      });
    }

    if (rows.length > 0) {
      const { error } = await sb
        .from("cash_inflows")
        .upsert(rows, { onConflict: "organization_id,payment_id" });
      if (error) throw new Error("cash_inflows upsert org=" + orgId + ": " + error.message);
      apurado.upserted += rows.length;
    }

    offset += pageResults.length;
    if (pageResults.length < 100 || offset >= total) break;
    await new Promise(r => setTimeout(r, 150)); // rate limit gentil entre páginas
  }

  return apurado;
}

async function syncOrg(
  sb: ReturnType<typeof createClient>,
  row: { ml_user_id: string; organization_id: string; seller_id: string | null },
  daysBack:   number,
  daysAhead:  number,
  beginDate:  string | null,
  endDate:    string | null,
): Promise<{ org_id: string } & ResultadoJanela> {
  const { ml_user_id: mlUserId, organization_id: orgId } = row;

  let token: string;
  try {
    token = await getAccessToken(sb, mlUserId);
  } catch (e: any) {
    throw new Error("Token error ml_user_id=" + mlUserId + ": " + e.message);
  }

  const today = todayStr();
  let apurado = janelaVazia();

  // 🔴 225-09 — JANELA EXPLÍCITA. Por que é requisito e não conveniência: a varredura
  // ordena por data de liberação em ordem CRESCENTE, então qualquer parada por teto ou
  // por tempo perde a CAUDA RECENTE — que é exatamente onde estão maio (R$ 6.436,32) e
  // agosto (R$ 5.496,89), os 97,6% da contaminação. Sem janela explícita não existe
  // forma de mirar esses dois meses nem de retomar de onde parou: toda invocação
  // recomeçaria de hoje e andaria para trás, e uma passada larga que PAREÇA ter dado
  // certo pode ter reclassificado janeiro e fevereiro e deixado maio e agosto intactos.
  if (beginDate !== null && endDate !== null) {
    try {
      apurado = somarJanela(apurado, await processWindow(sb, mlUserId, orgId, token, {
        beginDate: toBrtIso(beginDate, "start"),
        endDate:   toBrtIso(endDate, "end"),
        mode:      "historical",
      }));
    } catch (e: any) {
      console.warn("sync-mp-releases: erro janela explicita ml_user_id=" + mlUserId + ": " + e.message);
    }
  } else {
    // Sem janela explícita, o comportamento é IDÊNTICO ao de antes desta passagem.
    // (a) Histórica: hoje-N até hoje
    try {
      apurado = somarJanela(apurado, await processWindow(sb, mlUserId, orgId, token, {
        beginDate: toBrtIso(addDays(today, -daysBack), "start"),
        endDate:   toBrtIso(today, "end"),
        mode:      "historical",
      }));
    } catch (e: any) {
      console.warn("sync-mp-releases: erro janela histórica ml_user_id=" + mlUserId + ": " + e.message);
    }

    // (b) Futura: amanhã até hoje+daysAhead (só quando daysAhead > 0)
    if (daysAhead > 0) {
      try {
        apurado = somarJanela(apurado, await processWindow(sb, mlUserId, orgId, token, {
          beginDate: toBrtIso(addDays(today, 1), "start"),
          endDate:   toBrtIso(addDays(today, daysAhead), "end"),
          mode:      "future",
        }));
      } catch (e: any) {
        console.warn("sync-mp-releases: erro janela futura ml_user_id=" + mlUserId + ": " + e.message);
      }
    }
  }

  console.log(
    "sync-mp-releases: org=" + orgId + " ml_user_id=" + mlUserId +
    " upserted=" + apurado.upserted +
    " fora_do_caixa=" + apurado.fora_do_caixa +
    " indeterminadas=" + apurado.origem_indeterminada +
    " detalhes=" + apurado.detalhes_consultados +
    " pendentes=" + apurado.detalhes_pendentes +
    " envios_ok=" + apurado.envios_resolvidos +
    " envios_falha=" + apurado.envios_falhados +
    " pelo_dinheiro=" + apurado.aceitos_pelo_caminho_do_dinheiro,
  );
  return { org_id: orgId, ...apurado };
}

// ── Background sync (toda a lógica de sync — Pitfall 4: try/catch obrigatório) ─
// CASHFIX-03: movida para runSync() para uso com EdgeRuntime.waitUntil.
// O try/catch externo captura TODA exceção do background — sem ele o processo
// morre silenciosamente (sem log) quando chamado via EdgeRuntime.waitUntil.

async function runSync(
  daysBack:  number,
  daysAhead: number,
  beginDate: string | null,
  endDate:   string | null,
  filtroMlUserId: string | null = null,
): Promise<unknown> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // 🔴 225-11 — O FILTRO DE ORGANIZAÇÃO, OPCIONAL E ADITIVO.
    //
    // Esta função sempre varreu TODAS as linhas de `ml_tokens` com refresh
    // token, e a janela explícita do 225-09 vale para todas elas. Medido em
    // 04/09/2026: o Thales tem 247.523 linhas em `cash_inflows` — 25× a Pé
    // Vermeio (9.894) — e o Junior, 4.343. O 225-11 reprocessa MÊS A MÊS: dez
    // invocações sem filtro varreriam o Thales dez vezes, esgotariam o teto de
    // consultas de detalhe em linhas que ninguém pediu e, pior, gravariam
    // classificação numa organização que D-225-14 põe fora do escopo da fase.
    //
    // ⚠️ Quando o filtro NÃO vem, o comportamento é idêntico ao de antes desta
    // passagem — e é isso que o cron `sync-mp-releases-daily` (0 */3 * * *)
    // invoca oito vezes por dia, já em produção classificando sozinho. Um
    // filtro obrigatório desligaria a correção do 225-09 em silêncio.
    let consultaTokens = sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (filtroMlUserId !== null) {
      consultaTokens = consultaTokens.eq("ml_user_id", filtroMlUserId);
    }

    const { data: tokenRows, error: tokErr } = await consultaTokens;

    if (tokErr) {
      console.error("sync-mp-releases runSync error: Erro ao buscar ml_tokens:", tokErr.message);
      return { ok: false, error: tokErr.message };
    }

    if (!tokenRows || tokenRows.length === 0) {
      console.log("sync-mp-releases runSync: no active users");
      return { ok: true, days_back: daysBack, days_ahead: daysAhead, begin_date: beginDate, end_date: endDate, ml_user_id: filtroMlUserId, orgs_varridas: 0, results: [] };
    }

    const results: any[] = [];
    for (const row of tokenRows) {
      try {
        const result = await syncOrg(sb, row, daysBack, daysAhead, beginDate, endDate);
        results.push({ ml_user_id: row.ml_user_id, ...result });
      } catch (e: any) {
        console.error("sync-mp-releases ml_user_id=" + row.ml_user_id + " error:", e.message);
        results.push({ ml_user_id: row.ml_user_id, error: e.message });
      }
    }

    // ── 225-04: a ingestao das SAIDAS do MP pega carona AQUI ────────────────
    // O teto de pg_cron/pg_net e compartilhado e ja ha dois jobs ativos, entao
    // nao se cria um terceiro. `sync-mp-saidas` sai desta invocacao, que ja e
    // agendada de 3 em 3 horas pelo cron `sync-mp-releases-daily`.
    //
    // 🔴 E estritamente APOS todo o trabalho de caixa, e o catch NAO propaga:
    // ingestao de caixa nao pode cair por causa de relatorio de saida. Nenhuma
    // linha da logica acima muda por causa deste bloco.
    try {
      await fetch(SUPABASE_URL + "/functions/v1/sync-mp-saidas", {
        method:  "POST",
        headers: { Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
        body:    "{}",
      });
    } catch (e: any) {
      console.warn("sync-mp-releases: disparo de sync-mp-saidas falhou (nao bloqueia):", e?.message);
    }

    // ── 225-06: a captura do custo de tabela do frete pega carona AQUI ──────
    // Mesma disciplina do 225-04 e pelo mesmo motivo: o teto de pg_cron/pg_net
    // e compartilhado e ja ha dois jobs ativos, entao nao se cria um terceiro.
    //
    // ⚠️ Esta invocacao acontece OITO vezes por dia (cron de 3 em 3 horas), e
    // `list_cost` e custo de TABELA — nao muda de hora em hora. Quem impede a
    // varredura de repetir e a TRAVA DIARIA dentro da propria EF: item ja
    // tentado hoje e pulado, e as sete invocacoes seguintes devolvem
    // `nada_novo` depois de uma consulta barata. Sem essa trava a conta seria
    // varrida 8x/dia contra o ML, cujo bloqueio por excesso e por ENDERECO DE
    // ORIGEM e derrubaria estas outras sincronizacoes junto.
    //
    // 🔴 Tambem estritamente APOS todo o trabalho de caixa, e o catch NAO
    // propaga: ingestao de caixa nao pode cair por causa de captura de frete.
    try {
      await fetch(SUPABASE_URL + "/functions/v1/sync-ml-frete-tabela", {
        method:  "POST",
        headers: { Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
        body:    "{}",
      });
    } catch (e: any) {
      console.warn("sync-mp-releases: disparo de sync-ml-frete-tabela falhou (nao bloqueia):", e?.message);
    }

    return { ok: true, days_back: daysBack, days_ahead: daysAhead, begin_date: beginDate, end_date: endDate, ml_user_id: filtroMlUserId, orgs_varridas: results.length, results };
  } catch (err: unknown) {
    // Pitfall 4: capturar TODA exceção do background — sem try/catch o processo
    // morre silenciosamente (sem log) quando chamado via EdgeRuntime.waitUntil
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-mp-releases runSync error:", message);
    return { ok: false, error: message };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
// CASHFIX-03: serve() responde 202 imediatamente via EdgeRuntime.waitUntil(runSync()).
// O pg_net do cron recebe 202 em <200ms → nunca mais timeout de ~5s abortando ~118s.
// A lógica de sync continua em background.
// requireServiceRole() permanece ANTES do waitUntil (T-ixc-01: auth não pode mover).

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  let body: any = {};
  try { body = await req.json(); } catch { /* sem body */ }

  const daysBack  = Number(body.days_back  ?? 30);
  const daysAhead = Number(body.days_ahead ?? 45);

  // 🔴 225-09: janela explícita, OPCIONAL. Quando as duas datas vêm, a função
  // processa exatamente aquela janela; quando não vêm, o comportamento é o de
  // antes desta passagem, sem uma linha de diferença — e é isso que o cron de 3
  // em 3 horas continua invocando.
  const dataOuNulo = (v: unknown): string | null =>
    typeof v === "string" && v.length >= 10 ? v.substring(0, 10) : null;
  const beginDate = dataOuNulo(body.begin_date);
  const endDate   = dataOuNulo(body.end_date);

  // 🔴 225-11: o vendedor a processar, OPCIONAL. Vazio, zero e ausente são a
  // MESMA coisa — ausência de filtro —, e nunca um filtro que não casa com
  // ninguém: um filtro inválido silenciosamente virando "nenhuma organização"
  // seria uma invocação que não faz nada e devolve 202 dizendo que fez.
  const filtroMlUserId =
    body.ml_user_id !== undefined && body.ml_user_id !== null && String(body.ml_user_id).trim() !== ""
      ? String(body.ml_user_id).trim()
      : null;

  // Modo debug síncrono (CASHFIX-03): ?debug=1 roda runSync inline e
  // devolve o diagnóstico no corpo — permite ao orquestrador provar a persistência
  // (upserted>0) sem depender de logs de console.
  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  if (isDebug) {
    const diag = await runSync(daysBack, daysAhead, beginDate, endDate, filtroMlUserId);
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  // Desacoplar o pg_net da duração de execução (CASHFIX-03):
  // runSync() processa em background — o caller recebe 202 imediatamente.
  EdgeRuntime.waitUntil(runSync(daysBack, daysAhead, beginDate, endDate, filtroMlUserId));
  return json({ ok: true, msg: "sync enqueued" }, 202);
});
