/**
 * sync-ml-shipment-frete — captura do ESPERADO HISTORICO do frete, por ENVIO
 * (Fase 239, plano 239-02, D-239-02).
 *
 * ─── O QUE ELA CAPTURA, E POR QUE ISTO E A UNICA FONTE QUE SOBROU ──────────
 *
 * 🔴 `shipping_option.list_cost` de GET /shipments/{id}: o custo de tabela que
 * o ML CONGELOU na data daquela compra. A regua por anuncio
 * (`ml_item_frete_tabela`, 225-06) nao serve para o passado — ela le
 * /items/{id}/shipping_options, que devolve o custo de HOJE, e por isso 1.137
 * dos 1.200 pedidos de frete da tela saem como `frete_sem_vigencia_na_venda`
 * (M-01, 94,8%). O envio, ao contrario, nao envelhece: ele guarda o que valia
 * quando a venda aconteceu.
 *
 * O numero ja passa pela nossa ingestao e e DESTRUIDO la: `sync-ml-orders` faz
 * `s.shipping_option?.list_cost ?? s.base_cost` e depois escolhe entre isso e o
 * frete do comprador, gravando o vencedor em `orders.frete`. Depois do colapso
 * nao da mais para saber qual das duas grandezas o numero e. Esta funcao NAO
 * toca `sync-ml-orders` — ela da lugar proprio ao valor.
 *
 * ─── A REGUA E `list_cost`. `base_cost` NAO E, E ISTO FOI MEDIDO ───────────
 *
 * M-07, 04/09/2026, 6 pedidos contra a API do ML: `cobrado == list_cost` AO
 * CENTAVO em 6 de 6. E `base_cost` foi SEMPRE MAIOR (28,70 x 27,05 · 38,10 x
 * 19,05 · 90,50 x 45,25). Cair para `base_cost` quando `list_cost` falta
 * fabricaria "frete cobrado a menor" em 100% dos pedidos — uma tela inteira de
 * acusacao falsa contra o ML, que e exatamente o defeito que a fase 239 existe
 * para matar. A queda e PROIBIDA e o portao `shipmentFreteSqlAudit.test.ts`
 * falha se alguem a reintroduzir.
 *
 * Ausencia de `list_cost` viaja como AUSENCIA, com status proprio
 * (`sem_opcao_de_envio`) — nunca como zero, nunca como base_cost.
 *
 * ─── AS DUAS PONTAS DO CUSTO, SEPARADAS ────────────────────────────────────
 *
 * GET /shipments/{id}/costs da `senders[0].cost` (o que o vendedor paga) e
 * `receiver.cost` (o que o comprador paga). No 6º pedido de M-07 foi a SOMA das
 * duas (19,05 + 14,99 = 34,04) que fechou com o cobrado; `senders` sozinho
 * subestimaria. As duas viajam em colunas separadas — quem soma e a regua do
 * 239-03, que ve as duas. Nao se le `save` nem `promoted_amount`: a propria doc
 * do ML os declara informativos.
 *
 * ⚠️ Falha na chamada de custos NAO derruba o envio: o `list_cost` e gravado
 * assim mesmo e as duas pontas ficam AUSENTES. Chamada que falhou e ausencia,
 * nunca zero.
 *
 * ─── O MAPA PEDIDO -> ENVIO, QUE E METADE DO PRODUTO ───────────────────────
 *
 * `GET /orders/{id}` da `shipping.id`. Sem esse mapa o rotulo
 * `possivel_carrinho` (49 pedidos, M-01) continua nascendo de "mesmo comprador,
 * mesmo dia" — suposicao. `shipment_id` compartilhado e FATO. E como carrinho
 * compartilha o MESMO envio, envio ja capturado nao e rebuscado: a segunda
 * ocorrencia so grava o par.
 *
 * ─── O QUE PROTEGE AS OUTRAS SINCRONIZACOES ────────────────────────────────
 *
 * 🔴 UM UNICO 429 INTERROMPE A RODADA INTEIRA, grava `bloqueio` e NAO dispara
 * continuacao. O bloqueio do ML e por ENDERECO DE ORIGEM: insistir derruba
 * `sync-ml-orders`, `sync-ml-billing` e ads junto. Nada desta funcao roda em
 * paralelo com elas. Alem disso ha ORCAMENTO por invocacao (o backfill de 1.200
 * pedidos e feito em ondas, nao numa varrida) e TRAVA DIARIA por pedido.
 *
 * ⚠️ SEM CRON. Esta funcao e chamada a mao, em ondas, pelo portao P2-B. O teto
 * de chamadas do ML e compartilhado e ja ha dois pg_cron ativos.
 *
 * ─── O QUE O RETORNO E, E O QUE ELE NAO E ──────────────────────────────────
 *
 * 🔴 O corpo da resposta e DIAGNOSTICO, NAO PROVA. `ok:true` ja conviveu com
 * captura inteira falhada nesta base (feedback_corpo_da_resposta_nao_prova_efeito,
 * 4 ocorrencias numa noite) — e o proprio `sync-ml-frete-tabela` devolveu HTTP
 * 200 com `{"ok":true}` carregando um `400 Invalid user_id in path` dentro.
 * Quem prova e a CONTAGEM no banco, no portao P2-B, sempre com denominador.
 *
 * Supabase project: ckcdevcxgvueywivefgx.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extrairLogisticType } from "../_shared/flexOrder.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

/** `createClient(url, key)` infere `SupabaseClient<any,"public",any>`, que o
 *  `deno check` recusa contra `ReturnType<typeof createClient>` (`never` no
 *  parametro de schema). O molde `sync-ml-frete-tabela` carrega esse erro em
 *  producao; aqui ele e resolvido com UM cast nomeado, no ponto de criacao. */
type Sb = ReturnType<typeof createClient>;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API = "https://api.mercadolibre.com";
const ML_APP_ID = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";

/** Pedidos por invocacao. Varredura sem teto estoura o tempo da funcao, e o
 *  backfill sao ~1.200 pedidos: ele e feito em ONDAS, com continuacao pela
 *  fila de `ultima_tentativa`. Pode ser reduzido por parametro na primeira
 *  invocacao, para observar 429 antes de soltar o resto. */
const ORCAMENTO_PADRAO = 150;
/** Pausa entre chamadas, mesma cadencia da ingestao de repasses. */
const PAUSA_MS = 150;
/** Horizonte de fallback, em dias, quando `conciliacao_config.janela_dias`
 *  nao existe. Mesmo default da RPC da tela. */
const JANELA_FALLBACK = 30;
/** Teto de pagina do PostgREST: ele TRUNCA em 1000 sem avisar. Toda leitura de
 *  lista aqui e paginada com `.range()`. */
const PAGINA = 1000;

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

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Guarda de papel de servico ───────────────────────────────────────────────
// T-239-08: fica ANTES de qualquer trabalho e nao pode mover para depois do
// waitUntil. Autenticacao que roda depois do trabalho nao e autenticacao.
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

async function getAccessToken(
  sb: Sb,
  mlUserId: string,
): Promise<string> {
  const { data: row } = await sb
    .from("ml_tokens")
    .select("access_token,refresh_token,expires_at")
    .eq("ml_user_id", mlUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) throw new Error("No ML token for ml_user_id=" + mlUserId);

  const expiraEm = row.expires_at ? new Date(row.expires_at as string).getTime() / 1000 : 0;
  const agora = Date.now() / 1000;
  if (row.access_token && expiraEm - agora > 300) return row.access_token as string;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);

  const res = await fetch(ML_API + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token as string,
    }),
  });
  const novo = await res.json();
  if (!res.ok || !novo.access_token) {
    throw new Error("refresh falhou para ml_user_id=" + mlUserId + ": " + JSON.stringify(novo));
  }

  await sb
    .from("ml_tokens")
    .update({
      access_token: novo.access_token,
      refresh_token: novo.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + (novo.expires_in ?? 21600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("ml_user_id", mlUserId);

  return novo.access_token as string;
}

/** Sinaliza o 429 sem confundi-lo com erro comum: ele PARA A RODADA. */
class BloqueioDoML extends Error {
  constructor(recurso: string) {
    super("429 do Mercado Livre em " + recurso + " — rodada interrompida");
    this.name = "BloqueioDoML";
  }
}

/**
 * 🔴 NAO enviar o cabecalho `x-format-new`: com ele `logistic_type`, `mode` e
 * `shipping_option` voltam vazios na propria API (item 5 do Veredito,
 * 222-ML-API.md) — ou seja, o esperado SOME e a captura ficaria plausivel e
 * vazia ao mesmo tempo. Armadilha medida, nunca "otimizar" isto.
 *
 * 404 nao e tratado como erro pelo chamador quando o recurso e opcional: a
 * decisao de significado fica em quem chama, aqui so viaja o status.
 */
async function chamarML(
  caminho: string,
  token: string,
): Promise<{ status: number; corpo: Record<string, unknown> | null }> {
  const res = await fetch(ML_API + caminho, {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });

  if (res.status === 429) {
    await res.body?.cancel();
    throw new BloqueioDoML(caminho);
  }

  let corpo: Record<string, unknown> | null = null;
  try {
    corpo = await res.json();
  } catch {
    corpo = null;
  }
  return { status: res.status, corpo };
}

/**
 * Le uma lista inteira do PostgREST, que TRUNCA em 1000 em silencio.
 *
 * 🔴 `ordem` NAO e enfeite. Paginar com `.range()` sem ORDER BY deixa a ordem
 * a cargo do planner do Postgres, que nao a garante estavel entre requisicoes:
 * a pagina 2 pode repetir linhas da 1 e PULAR outras. O resultado seria uma
 * fila com buracos — pedidos que nunca sao varridos — e a cobertura ficaria
 * abaixo do possivel sem nenhum erro aparecer em lugar nenhum.
 */
async function lerTudo(
  sb: Sb,
  tabela: string,
  colunas: string,
  ordem: string,
  filtrar: (q: any) => any,
): Promise<Record<string, unknown>[]> {
  const linhas: Record<string, unknown>[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await filtrar(sb.from(tabela).select(colunas))
      .order(ordem, { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(tabela + ": " + error.message);
    const pagina = (data ?? []) as Record<string, unknown>[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return linhas;
}

type Desfecho = "ok" | "sem_envio" | "sem_opcao_de_envio" | "erro" | "bloqueio";

async function capturarOrg(
  sb: Sb,
  linha: { ml_user_id: string; organization_id: string },
  janelaDias: number,
  orcamento: number,
): Promise<Record<string, unknown>> {
  const orgId = linha.organization_id;
  const mlUserId = String(linha.ml_user_id);
  // 🔴 `ml_tokens.seller_id` e UUID INTERNO (FK para `sellers`), nao o id do
  // vendedor no Mercado Livre. Usar ele no path devolve
  // `400 Invalid user_id in path` — medido em 04/09/2026 no plano irmao. O id
  // que a API do ML entende e `ml_user_id`, e ele e o unico que entra em URL.
  const token = await getAccessToken(sb, mlUserId);

  // Horizonte. `orders.data_pedido` e TEXT nesta base, entao o corte e por
  // comparacao de string no formato 'YYYY-MM-DD' — o mesmo que a RPC da tela
  // faz com `to_char`. Converter para date aqui cegaria o indice.
  const corte = new Date(Date.now() - janelaDias * 86_400_000).toISOString().slice(0, 10);

  // ⚠️ `orders` tem UMA LINHA POR ITEM. O universo e de pedidos DISTINTOS —
  // sem o `Set` um pedido de 3 itens consumiria 3 vagas do orcamento para
  // buscar exatamente o mesmo envio.
  const linhasDePedido = await lerTudo(sb, "orders", "ml_order_id", "ml_order_id", (q: any) =>
    q.eq("organization_id", orgId)
      .in("status", ["paid", "shipped", "delivered"])
      .gte("data_pedido", corte)
      .not("ml_order_id", "is", null));
  const universo = [...new Set(linhasDePedido.map((o) => String(o.ml_order_id)))];

  // Pedidos que ja tem o par pedido->envio: nao voltam a fila.
  const jaMapeados = new Set(
    (await lerTudo(sb, "ml_shipment_pedido", "ml_order_id", "ml_order_id", (q: any) =>
      q.eq("organization_id", orgId))).map((p) => String(p.ml_order_id)),
  );

  // Estado da varredura: quem foi tentado, quando, e com que desfecho.
  const estado = await lerTudo(sb, "ml_shipment_frete_captura",
    "ml_order_id,ultima_tentativa,tentativas,ultimo_status", "ml_order_id",
    (q: any) => q.eq("organization_id", orgId));

  const tentadoEm = new Map<string, string>();
  const contagem = new Map<string, number>();
  // 🔴 Pedido SEM ENVIO PROPRIO esta RESOLVIDO, nao pendente. Ele nunca ganha
  // linha em `ml_shipment_pedido` — nao ha envio para mapear —, entao sem esta
  // lista ele voltaria a fila em toda rodada e `restam` NUNCA chegaria a zero,
  // que e justamente o criterio de parada do backfill. Um pedido pago que nao
  // tem `shipping.id` nao passa a ter depois: o envio nasce com a venda.
  const resolvidos = new Set<string>();
  for (const e of estado) {
    const id = String(e.ml_order_id);
    tentadoEm.set(id, String(e.ultima_tentativa ?? ""));
    contagem.set(id, Number(e.tentativas ?? 0));
    if (String(e.ultimo_status ?? "") === "sem_envio") resolvidos.add(id);
  }

  // 🔴 TRAVA DIARIA. Pedido ja tentado hoje e pulado — sem ela, um pedido que
  // erra volta ao topo da fila a cada rodada e consome o orcamento inteiro
  // numa lista que nunca avanca.
  const hoje = new Date().toISOString().slice(0, 10);
  const pendentes = universo
    .filter((id) => !jaMapeados.has(id) && !resolvidos.has(id))
    .filter((id) => (tentadoEm.get(id) ?? "").slice(0, 10) !== hoje)
    // `nulls first`: pedido nunca tentado vem antes do tentado ha mais tempo.
    .sort((a, b) => (tentadoEm.get(a) ?? "").localeCompare(tentadoEm.get(b) ?? ""));

  if (pendentes.length === 0) {
    return {
      motivo_parada: "nada_novo",
      pedidos_na_fila: 0,
      tentados: 0,
      restam: 0,
      janela_dias: janelaDias,
      universo: universo.length,
    };
  }

  const fila = pendentes.slice(0, orcamento);

  // Envios ja capturados: carrinho compartilha o MESMO envio e a segunda
  // ocorrencia nao paga uma segunda chamada de API.
  //
  // 🔴 E um MAPA, nao um conjunto, e o valor e "este envio tem regua?". O
  // segundo pedido de um carrinho cujo envio NAO trouxe `shipping_option`
  // precisa sair como `sem_opcao_de_envio` igual ao primeiro. Marca-lo `ok` so
  // porque o envio ja estava na tabela contaminaria justamente o contador que
  // aprova ou refuta a premissa A2 — a decisao sairia de um numero adulterado.
  const enviosConhecidos = new Map<string, boolean>();
  for (const e of await lerTudo(sb, "ml_shipment_frete", "shipment_id,list_cost", "shipment_id",
    (q: any) => q.eq("organization_id", orgId))) {
    enviosConhecidos.set(String(e.shipment_id), e.list_cost !== null && e.list_cost !== undefined);
  }

  let enviosNovos = 0;
  let comListCost = 0;
  let semOpcao = 0;
  let semEnvio = 0;
  let nErros = 0;
  let tentados = 0;
  let motivoParada = "orcamento";
  const falhas: string[] = [];

  for (const mlOrderId of fila) {
    let status: Desfecho = "erro";
    let mensagem: string | null = null;
    tentados++;

    try {
      // 1. O pedido, para achar o envio.
      const pedido = await chamarML("/orders/" + mlOrderId, token);
      if (pedido.status !== 200 || !pedido.corpo) {
        throw new Error("/orders devolveu " + pedido.status + ": " +
          String((pedido.corpo as Record<string, unknown> | null)?.message ?? "").slice(0, 160));
      }

      const envio = (pedido.corpo.shipping ?? null) as Record<string, unknown> | null;
      const shipmentId = envio?.id != null ? String(envio.id) : "";
      const packIdPedido = pedido.corpo.pack_id != null ? String(pedido.corpo.pack_id) : null;

      if (!shipmentId) {
        // 🔴 CONDICAO NORMAL, nao falha: ha pedido sem envio proprio. Conta-lo
        // como erro faria a taxa de erro mentir para cima e a cobertura mentir
        // para baixo na mesma consulta.
        status = "sem_envio";
        semEnvio++;
      } else {
        // O mapa e conhecimento e e gravado ANTES do custo: envio que falhar na
        // leitura nao pode impedir o par pedido->envio de existir, porque e ele
        // que troca a heuristica de carrinho por fato.
        const { error: erroMapa } = await sb.from("ml_shipment_pedido").upsert(
          {
            organization_id: orgId,
            ml_order_id: mlOrderId,
            shipment_id: shipmentId,
            pack_id: packIdPedido,
            capturado_em: new Date().toISOString(),
          },
          { onConflict: "organization_id,ml_order_id" },
        );
        if (erroMapa) throw new Error("upsert do mapa: " + erroMapa.message);

        if (enviosConhecidos.has(shipmentId)) {
          // Carrinho: o envio ja foi lido. So o par era novo — e o desfecho do
          // pedido e o MESMO do envio, senao o contador de A2 mente.
          if (enviosConhecidos.get(shipmentId)) {
            status = "ok";
          } else {
            status = "sem_opcao_de_envio";
            semOpcao++;
          }
        } else {
          const det = await chamarML("/shipments/" + shipmentId, token);
          if (det.status !== 200 || !det.corpo) {
            throw new Error("/shipments devolveu " + det.status + ": " +
              String((det.corpo as Record<string, unknown> | null)?.message ?? "").slice(0, 160));
          }

          const opcao = (det.corpo.shipping_option ?? null) as Record<string, unknown> | null;
          const bruto = opcao?.list_cost;
          // 🔴 A REGUA, e SO ela. Ausencia viaja como AUSENCIA — cair para
          // `base_cost` aqui inventaria "frete cobrado a menor" em 100% dos
          // pedidos (M-07: base_cost foi maior em 6 de 6). O portao falha se
          // alguem reintroduzir a queda.
          const listCost = typeof bruto === "number" && Number.isFinite(bruto) ? bruto : null;

          const brutoBase = det.corpo.base_cost;
          const baseRef = typeof brutoBase === "number" && Number.isFinite(brutoBase)
            ? brutoBase
            : null;

          // 2. As duas pontas do custo. Falha aqui NAO derruba o envio.
          let custoVendedor: number | null = null;
          let custoComprador: number | null = null;
          try {
            const custos = await chamarML("/shipments/" + shipmentId + "/costs", token);
            if (custos.status === 200 && custos.corpo) {
              const remetentes = (custos.corpo.senders ?? []) as Array<Record<string, unknown>>;
              const cVend = Array.isArray(remetentes) ? remetentes[0]?.cost : undefined;
              if (typeof cVend === "number" && Number.isFinite(cVend)) custoVendedor = cVend;

              const receptor = (custos.corpo.receiver ?? null) as Record<string, unknown> | null;
              const cComp = receptor?.cost;
              if (typeof cComp === "number" && Number.isFinite(cComp)) custoComprador = cComp;
            }
          } catch (e: unknown) {
            if (e instanceof BloqueioDoML) throw e;
            // Chamada que falhou e AUSENCIA, nunca zero. O `list_cost` e
            // gravado assim mesmo — ele e a regua e ja esta na mao.
            console.warn("costs de " + shipmentId + " falhou: " +
              (e instanceof Error ? e.message : String(e)));
          }

          const agora = new Date().toISOString();
          const { error: erroFrete } = await sb.from("ml_shipment_frete").upsert(
            {
              organization_id: orgId,
              ml_user_id: Number(mlUserId),
              shipment_id: shipmentId,
              pack_id: det.corpo.pack_id != null ? String(det.corpo.pack_id) : packIdPedido,
              list_cost: listCost,
              base_cost_ref: baseRef,
              custo_vendedor: custoVendedor,
              custo_comprador: custoComprador,
              logistic_type: extrairLogisticType(det.corpo as { logistic_type?: unknown }),
              capturado_em: agora,
              visto_em: agora,
            },
            { onConflict: "organization_id,shipment_id" },
          );
          if (erroFrete) throw new Error("upsert do envio: " + erroFrete.message);

          enviosConhecidos.set(shipmentId, listCost !== null);
          enviosNovos++;

          if (listCost === null) {
            // O envio existe e foi lido, mas nao trouxe opcao de envio. Este
            // e o contador que APROVA OU REFUTA a premissa A2 do plano.
            status = "sem_opcao_de_envio";
            semOpcao++;
          } else {
            status = "ok";
            comListCost++;
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof BloqueioDoML) {
        // 🔴 Um unico 429 PARA A RODADA. O bloqueio do ML e por endereco de
        // origem: insistir derruba `sync-ml-orders`, `sync-ml-billing` e ads
        // junto. Nao ha continuacao automatica — a proxima onda e manual.
        status = "bloqueio";
        mensagem = e.message;
        motivoParada = "bloqueio";
      } else {
        mensagem = e instanceof Error ? e.message : String(e);
        nErros++;
        if (falhas.length < 5) falhas.push(mlOrderId + ": " + mensagem);
      }
    }

    await sb.from("ml_shipment_frete_captura").upsert(
      {
        organization_id: orgId,
        ml_user_id: Number(mlUserId),
        ml_order_id: mlOrderId,
        ultima_tentativa: new Date().toISOString(),
        ultimo_status: status,
        tentativas: (contagem.get(mlOrderId) ?? 0) + 1,
        ultimo_erro: mensagem,
      },
      { onConflict: "organization_id,ml_order_id" },
    );

    if (motivoParada === "bloqueio") break;

    await dormir(PAUSA_MS);
  }

  return {
    janela_dias: janelaDias,
    universo: universo.length,
    pedidos_na_fila: pendentes.length,
    tentados,
    envios_novos: enviosNovos,
    com_list_cost: comListCost,
    // 🔴 Campos PROPRIOS: condicao normal nao pode ser lida como falha, nem
    // falha pode se esconder atras dela.
    sem_opcao_de_envio: semOpcao,
    sem_envio: semEnvio,
    erros: nErros,
    exemplos_de_erro: falhas,
    motivo_parada: motivoParada,
    restam: Math.max(0, pendentes.length - tentados),
  };
}

// ── runSync: TODO o trabalho em background, com try/catch externo ────────────
// Excecao em background morre SEM LOG se nao for capturada aqui.
async function runSync(dias: number | null, orcamento: number): Promise<Record<string, unknown>> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY) as unknown as Sb;

    // 🔴 O escopo sai de DADO, nunca de um UUID escrito no codigo — UUID nao se
    // completa por prefixo nesta casa. `conciliacao_config` e LIDA aqui e
    // NUNCA escrita: esta fase nao encosta na regua de acusacao.
    const { data: cobertas, error: erroCfg } = await sb
      .from("conciliacao_config")
      .select("organization_id,janela_dias");

    if (erroCfg) {
      console.error("sync-ml-shipment-frete runSync error: conciliacao_config:", erroCfg.message);
      return { ok: false, error: erroCfg.message };
    }
    const janelaPorOrg = new Map<string, number>();
    for (const c of cobertas ?? []) {
      janelaPorOrg.set(
        String((c as Record<string, unknown>).organization_id),
        Number((c as Record<string, unknown>).janela_dias ?? JANELA_FALLBACK),
      );
    }
    if (janelaPorOrg.size === 0) {
      console.log("sync-ml-shipment-frete runSync: nenhuma organizacao no escopo do monitor");
      return { ok: true, results: [] };
    }

    const { data: todosTokens, error } = await sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id")
      .not("refresh_token", "is", null);

    if (error) {
      console.error("sync-ml-shipment-frete runSync error: ml_tokens:", error.message);
      return { ok: false, error: error.message };
    }

    const tokens = (todosTokens ?? []).filter((t: Record<string, unknown>) =>
      janelaPorOrg.has(String(t.organization_id))
    );

    if (tokens.length === 0) {
      console.log("sync-ml-shipment-frete runSync: no active users");
      return { ok: true, results: [] };
    }

    const results: Record<string, unknown>[] = [];
    for (const linha of tokens) {
      try {
        // ⚠️ O horizonte segue a JANELA DA TELA por padrao. Capturar 30 dias
        // enquanto a tela olha 90 faria a cobertura ser reportada contra um
        // denominador menor que o alvo — a fracao subiria sem nada melhorar.
        const janela = dias ?? janelaPorOrg.get(String(linha.organization_id)) ?? JANELA_FALLBACK;
        const r = await capturarOrg(sb, linha as never, janela, orcamento);
        results.push({ ml_user_id: linha.ml_user_id, ...r });
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        console.error("sync-ml-shipment-frete ml_user_id=" + linha.ml_user_id + " error:", m);
        results.push({ ml_user_id: linha.ml_user_id, error: m });
      }
    }
    return { ok: true, results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-shipment-frete runSync error:", message);
    return { ok: false, error: message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // A guarda vem ANTES de qualquer trabalho — inclusive antes do waitUntil.
  const guard = requireServiceRole(req);
  if (guard) return guard;

  const params = new URL(req.url).searchParams;
  const diasBruto = Number(params.get("dias"));
  const dias = Number.isFinite(diasBruto) && diasBruto > 0 ? Math.floor(diasBruto) : null;
  const orcBruto = Number(params.get("orcamento"));
  // Teto duro: o parametro pode ENCOLHER o orcamento (a primeira onda roda com
  // 20 para observar 429 antes de soltar o resto), nunca esticar.
  const orcamento = Number.isFinite(orcBruto) && orcBruto > 0
    ? Math.min(Math.floor(orcBruto), ORCAMENTO_PADRAO)
    : ORCAMENTO_PADRAO;

  // Modo sincrono: e o modo do backfill. Ele devolve os contadores da onda, que
  // sao DIAGNOSTICO — a prova e a contagem no banco, no portao P2-B.
  const isDebug = params.get("debug") === "1";
  if (isDebug) {
    const diag = await runSync(dias, orcamento);
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  EdgeRuntime.waitUntil(runSync(dias, orcamento));
  return json({ ok: true, msg: "sync enqueued" }, 202);
});
