/**
 * sync-ml-comissao-tabela — captura da tarifa PUBLICADA de comissão
 * (Fase 244, plano 244-02, D-244-04 / D-244-05 / D-244-06).
 *
 * ─── O QUE ELA CAPTURA, E POR QUE ─────────────────────────────────────────
 *
 * 🔴 `sale_fee_amount` de `GET /sites/MLB/listing_prices`. É a tarifa que o
 * Mercado Livre PUBLICA, não a que ele cobrou — a única coisa capaz de dizer
 * "cobrou a mais do que devia" sobre comissão.
 *
 * Sem ela a tela compara o ML contra o extrato dele mesmo: `repasse_a_menor`
 * confere `receita + ponta do comprador − o que o ML DECLAROU cobrar` contra o
 * que entrou. Se o ML declarar 16% num anúncio de 11% e pagar de acordo, o
 * resíduo é zero e a conta fecha. Foi essa a lacuna que abriu a fase 244.
 *
 * Confere ao centavo, medido em 05/09/2026 no pedido `2000017848004682`:
 *   12,0% publicado × 383,99 = 46,08 = `sale_fee.net` = `CVVML` + `CVVPRC`.
 *
 * ─── 🔴 A CHAVE INCLUI O PREÇO ────────────────────────────────────────────
 *
 *   MLB430275 @ R$ 100 -> 14,0%     MLB430275 @ R$ 150 -> 12,0%
 *
 * A alíquota tem DEGRAU por faixa. Uma consulta por categoria — o que a
 * intuição manda — produziria esperado errado em toda venda barata, e a régua
 * acusaria o ML justamente onde ele cobrou o certo.
 *
 * ─── O UNIVERSO SÃO OS PARES (ANÚNCIO, PREÇO) QUE JÁ VENDERAM ─────────────
 *
 * Não é a lista de anúncios: é a lista de preços em que houve venda. 7.535
 * linhas de pedido desde 28/01 colapsam em 1.039 pares distintos — sete
 * rodadas do orçamento. Varrer o catálogo inteiro em todos os preços possíveis
 * seria infinito e inútil.
 *
 * ⚠️ `listing_type_id` vem do `ml_inventory_cache` (`gold_special`), NUNCA de
 * `orders.listing_type` (`classic`) — a API não entende o segundo. Para o
 * anúncio que não está no cache, a ficha vem do `GET /items/{id}`: o cache já
 * teve nove anúncios fantasma e não é fonte.
 *
 * ─── AGENDAMENTO: CARONA, NÃO CRON NOVO ───────────────────────────────────
 *
 * Mesma decisão do `sync-ml-frete-tabela` (D-225-17): o teto de chamadas do ML
 * é COMPARTILHADO e o bloqueio por excesso é por ENDEREÇO DE ORIGEM — derruba
 * as outras sincronizações junto. Carona no fim do `runSync` de
 * `sync-mp-releases`, que já roda de 3 em 3 horas, com TRAVA DIÁRIA: par já
 * tentado hoje é pulado.
 *
 * Supabase project: ckcdevcxgvueywivefgx.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API = "https://api.mercadolibre.com";
const ML_APP_ID = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";

const SITE_ID = "MLB";
/** Pares por invocação. Varredura sem teto estoura o tempo da função. */
const ORCAMENTO = 150;
/** Pausa entre chamadas, mesma cadência da ingestão de repasses. */
const PAUSA_MS = 150;
/** Teto de recuo no 429 — o bloqueio do ML é por endereço de origem. */
const MAX_RETENTATIVAS = 4;

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

/**
 * 🔴 LEITURA PAGINADA, e não `.limit(20000)`.
 *
 * O PostgREST corta em 1.000 linhas EM SILÊNCIO — `limit` maior não levanta o
 * teto do servidor, só a intenção. Medido na primeira invocação desta função
 * em 05/09/2026: o universo saiu **335 pares** em vez de 1.039, porque as
 * 7.535 linhas de `orders` viraram as primeiras 1.000. Nada falhou, nada
 * avisou, e a régua nasceria cobrindo um terço da base achando que cobria tudo.
 *
 * É a mesma classe do truncamento de 20/08 que custou R$ 22 mil na fase 240:
 * resposta curta lida como resposta completa.
 */
async function lerTudo(
  construir: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  rotulo: string,
): Promise<Record<string, unknown>[]> {
  const PAGINA = 1000;
  const tudo: Record<string, unknown>[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await construir(de, de + PAGINA - 1);
    if (error) throw new Error(rotulo + ": " + error.message);
    const pagina = (data ?? []) as Record<string, unknown>[];
    tudo.push(...pagina);
    // 🔴 A parada é `pagina.length < PAGINA`, não um teto de segurança: página
    // cheia significa que pode haver mais, e parar ali seria truncar de novo.
    if (pagina.length < PAGINA) break;
    if (de > 200000) throw new Error(rotulo + ": paginacao sem fim");
  }
  return tudo;
}


// ── Guarda de papel de serviço ──────────────────────────────────────────────
// Fica ANTES de qualquer trabalho e não pode mover para depois do waitUntil:
// autenticação que roda depois do trabalho não é autenticação.
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
  sb: ReturnType<typeof createClient>,
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
    throw new Error("refresh falhou para ml_user_id=" + mlUserId);
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

/** A ficha do anúncio direto da origem — usada só onde o cache não tem. */
async function lerFichaDoItem(
  itemId: string,
  token: string,
): Promise<{ categoryId: string; listingTypeId: string } | null> {
  const res = await fetch(
    ML_API + "/items/" + itemId + "?attributes=category_id,listing_type_id",
    { headers: { Authorization: "Bearer " + token, Accept: "application/json" } },
  );
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const corpo = await res.json();
  const categoryId = typeof corpo.category_id === "string" ? corpo.category_id : null;
  const listingTypeId = typeof corpo.listing_type_id === "string" ? corpo.listing_type_id : null;
  if (!categoryId || !listingTypeId) return null;
  return { categoryId, listingTypeId };
}

type Tarifa = { percentageFee: number; fixedFee: number; saleFee: number };

/**
 * 🔴 UMA chamada por par (anúncio, preço).
 *
 * O tratamento por código é deliberadamente DIFERENTE, porque os códigos
 * significam coisas diferentes:
 *   429 — bloqueio por excesso: recuo com espera crescente
 *   404 — categoria que o ML não reconhece mais: condição normal, não erro
 *   demais — falha alto, para não esconder defeito nosso
 */
async function lerTarifaPublicada(
  categoryId: string,
  listingTypeId: string,
  preco: number,
  token: string,
): Promise<Tarifa | null> {
  let espera = 1000;
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa++) {
    const url =
      ML_API + "/sites/" + SITE_ID + "/listing_prices" +
      "?price=" + preco +
      "&listing_type_id=" + encodeURIComponent(listingTypeId) +
      "&category_id=" + encodeURIComponent(categoryId);
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });

    if (res.status === 429) {
      await res.body?.cancel();
      if (tentativa === MAX_RETENTATIVAS) {
        throw new Error("429 persistente em " + categoryId + "@" + preco);
      }
      await dormir(espera);
      espera *= 2;
      continue;
    }

    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }

    const corpo = await res.json();
    if (!res.ok) {
      throw new Error(
        "listing_prices " + categoryId + "@" + preco + " devolveu " + res.status,
      );
    }

    // A resposta pode vir como objeto (um listing_type) ou lista.
    const item = Array.isArray(corpo)
      ? corpo.find((o: Record<string, unknown>) => o.listing_type_id === listingTypeId)
      : corpo;
    if (!item) return null;

    const det = (item.sale_fee_details ?? {}) as Record<string, unknown>;
    const pct = det.percentage_fee;
    const fixo = det.fixed_fee;
    const total = item.sale_fee_amount;
    // 🔴 Ausência viaja como ausência. Um `?? 0` aqui gravaria tarifa zero e a
    // régua diria "o ML cobrou R$ 46 onde deveria cobrar R$ 0" — acusação
    // inventada a partir de um campo que não veio.
    if (typeof pct !== "number" || typeof fixo !== "number" || typeof total !== "number") {
      return null;
    }
    return { percentageFee: pct, fixedFee: fixo, saleFee: total };
  }
  return null;
}

async function capturarOrg(
  sb: ReturnType<typeof createClient>,
  linha: { ml_user_id: string; organization_id: string },
): Promise<Record<string, unknown>> {
  const orgId = linha.organization_id;
  const mlUserId = String(linha.ml_user_id);
  const token = await getAccessToken(sb, mlUserId);
  const hoje = new Date().toISOString().slice(0, 10);

  // ── O universo: os pares (anúncio, preço) em que houve venda ─────────────
  // 🔴 Vem de `orders`, e não do catálogo: o que a régua precisa comparar é o
  // preço em que a venda ACONTECEU, não os preços que o anúncio já teve.
  const vendas = await lerTudo(
    (de, ate) =>
      sb
        .from("orders")
        .select("item_id,preco_unit")
        .eq("organization_id", orgId)
        .in("status", ["paid", "shipped", "delivered"])
        .not("item_id", "is", null)
        .not("preco_unit", "is", null)
        .gte("data_pedido", "2026-01-28")
        .order("ml_order_id", { ascending: true })
        .range(de, ate),
    "orders",
  );

  const pares = new Map<string, { itemId: string; preco: number }>();
  for (const v of vendas) {
    const itemId = String(v.item_id);
    const preco = Number(v.preco_unit);
    if (!itemId || !Number.isFinite(preco) || preco <= 0) continue;
    pares.set(itemId + "|" + preco.toFixed(2), { itemId, preco });
  }

  // Estado da varredura: a trava diária vive aqui.
  const estado = await lerTudo(
    (de, ate) =>
      sb
        .from("ml_comissao_captura")
        .select("item_id,preco,ultima_tentativa,tentativas")
        .eq("organization_id", orgId)
        .order("item_id", { ascending: true })
        .order("preco", { ascending: true })
        .range(de, ate),
    "ml_comissao_captura",
  );

  const tentadoEm = new Map<string, string>();
  const contagem = new Map<string, number>();
  for (const e of estado) {
    const chave = String(e.item_id) + "|" + Number(e.preco).toFixed(2);
    tentadoEm.set(chave, String(e.ultima_tentativa));
    contagem.set(chave, Number(e.tentativas ?? 0));
  }

  // A tarifa já vigente hoje, por par — para saber o que MUDOU sem uma
  // consulta por linha.
  const serie = await lerTudo(
    (de, ate) =>
      sb
        .from("ml_comissao_tabela")
        .select("item_id,preco,percentage_fee,vigente_desde")
        .eq("organization_id", orgId)
        .lte("vigente_desde", hoje)
        .order("vigente_desde", { ascending: false })
        .order("item_id", { ascending: true })
        .range(de, ate),
    "ml_comissao_tabela",
  );

  const vigente = new Map<string, number>();
  for (const s of serie) {
    const chave = String(s.item_id) + "|" + Number(s.preco).toFixed(2);
    if (!vigente.has(chave)) vigente.set(chave, Number(s.percentage_fee));
  }

  const pendentes = [...pares.entries()]
    .filter(([chave]) => (tentadoEm.get(chave) ?? "").slice(0, 10) !== hoje)
    .sort((a, b) => (tentadoEm.get(a[0]) ?? "").localeCompare(tentadoEm.get(b[0]) ?? ""));

  if (pendentes.length === 0) {
    return { motivo: "nada_novo", universo: pares.size, tentados: 0 };
  }

  const fila = pendentes.slice(0, ORCAMENTO);

  // A ficha do anúncio: cache primeiro, API para quem falta. Uma leitura só.
  const cache = await lerTudo(
    (de, ate) =>
      sb
        .from("ml_inventory_cache")
        .select("item_id,category_id,listing_type_id")
        .eq("organization_id", orgId)
        .order("item_id", { ascending: true })
        .range(de, ate),
    "ml_inventory_cache",
  );

  const ficha = new Map<string, { categoryId: string; listingTypeId: string }>();
  for (const c of cache) {
    if (typeof c.category_id === "string" && typeof c.listing_type_id === "string") {
      ficha.set(String(c.item_id), {
        categoryId: c.category_id,
        listingTypeId: c.listing_type_id,
      });
    }
  }

  let novos = 0;
  let inalterados = 0;
  let semFicha = 0;
  let semTarifa = 0;
  let nErros = 0;
  const falhas: string[] = [];

  for (const [chave, par] of fila) {
    let status = "erro";
    let mensagem: string | null = null;

    try {
      let f = ficha.get(par.itemId);
      if (!f) {
        // 🔴 O cache não é fonte: nove anúncios fantasma já provaram isso.
        // Aqui ele é atalho, e a origem responde por quem ele não tem.
        const daApi = await lerFichaDoItem(par.itemId, token);
        if (daApi) {
          ficha.set(par.itemId, daApi);
          f = daApi;
        }
        await dormir(PAUSA_MS);
      }

      if (!f) {
        status = "sem_ficha";
        semFicha++;
      } else {
        const tarifa = await lerTarifaPublicada(f.categoryId, f.listingTypeId, par.preco, token);
        if (!tarifa) {
          // Resposta que não serve. Não se inventa zero.
          status = "sem_tarifa";
          semTarifa++;
        } else {
          const anterior = vigente.get(chave);
          const mudou =
            anterior === undefined || Math.abs(anterior - tarifa.percentageFee) > 0.0005;

          if (mudou) {
            // 🔴 Linha NOVA com vigência a partir de hoje. A anterior NÃO é
            // apagada — é ela que torna honesta a comparação com venda antiga.
            const { error } = await sb.from("ml_comissao_tabela").upsert(
              {
                organization_id: orgId,
                ml_user_id: Number(mlUserId),
                item_id: par.itemId,
                preco: par.preco,
                percentage_fee: tarifa.percentageFee,
                fixed_fee: tarifa.fixedFee,
                sale_fee_publicado: tarifa.saleFee,
                category_id: f.categoryId,
                listing_type_id: f.listingTypeId,
                vigente_desde: hoje,
                capturado_em: new Date().toISOString(),
                visto_em: new Date().toISOString(),
              },
              { onConflict: "organization_id,item_id,preco,vigente_desde" },
            );
            if (error) throw new Error("upsert: " + error.message);
            vigente.set(chave, tarifa.percentageFee);
            status = "ok";
            novos++;
          } else {
            // Tarifa inalterada: a série NÃO ganha linha, só o carimbo de que
            // alguém olhou. Série que cresce por dia mente sobre mudança.
            await sb
              .from("ml_comissao_tabela")
              .update({ visto_em: new Date().toISOString() })
              .eq("organization_id", orgId)
              .eq("item_id", par.itemId)
              .eq("preco", par.preco);
            status = "inalterado";
            inalterados++;
          }
        }
      }
    } catch (e: unknown) {
      mensagem = e instanceof Error ? e.message : String(e);
      nErros++;
      if (falhas.length < 5) falhas.push(chave + ": " + mensagem);
    }

    await sb.from("ml_comissao_captura").upsert(
      {
        organization_id: orgId,
        ml_user_id: Number(mlUserId),
        item_id: par.itemId,
        preco: par.preco,
        ultima_tentativa: new Date().toISOString(),
        ultimo_status: status,
        tentativas: (contagem.get(chave) ?? 0) + 1,
        ultimo_erro: mensagem,
      },
      { onConflict: "organization_id,item_id,preco" },
    );

    await dormir(PAUSA_MS);
  }

  return {
    universo: pares.size,
    pendentes: pendentes.length,
    tentados: fila.length,
    novos,
    inalterados,
    // 🔴 Campos PRÓPRIOS: condição normal não pode ser lida como falha, nem
    // falha pode se esconder atrás dela.
    sem_ficha: semFicha,
    sem_tarifa: semTarifa,
    erros: nErros,
    exemplos_de_erro: falhas,
  };
}

async function runSync(): Promise<Record<string, unknown>> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // 🔴 D-225-14: só as organizações que o monitor de conciliação cobre. O
    // escopo sai de DADO (`conciliacao_config`), nunca de um UUID no código.
    const { data: cobertas, error: erroCfg } = await sb
      .from("conciliacao_config")
      .select("organization_id");
    if (erroCfg) {
      console.error("sync-ml-comissao-tabela: conciliacao_config:", erroCfg.message);
      return { ok: false, error: erroCfg.message };
    }
    const noEscopo = new Set(
      (cobertas ?? []).map((c: Record<string, unknown>) => c.organization_id),
    );
    if (noEscopo.size === 0) {
      console.log("sync-ml-comissao-tabela: nenhuma organizacao no escopo do monitor");
      return { ok: true, results: [] };
    }

    const { data: todosTokens, error } = await sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id")
      .not("refresh_token", "is", null);
    if (error) {
      console.error("sync-ml-comissao-tabela: ml_tokens:", error.message);
      return { ok: false, error: error.message };
    }

    const tokens = (todosTokens ?? []).filter((t: Record<string, unknown>) =>
      noEscopo.has(t.organization_id)
    );
    if (tokens.length === 0) {
      console.log("sync-ml-comissao-tabela: no active users");
      return { ok: true, results: [] };
    }

    const results: Record<string, unknown>[] = [];
    for (const linha of tokens) {
      try {
        const r = await capturarOrg(sb, linha as never);
        results.push({ ml_user_id: linha.ml_user_id, ...r });
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        console.error("sync-ml-comissao-tabela ml_user_id=" + linha.ml_user_id + ":", m);
        results.push({ ml_user_id: linha.ml_user_id, error: m });
      }
    }
    return { ok: true, results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-comissao-tabela runSync error:", message);
    return { ok: false, error: message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const guard = requireServiceRole(req);
  if (guard) return guard;

  // Modo síncrono de depuração: prova a persistência sem depender de log.
  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  if (isDebug) {
    const diag = await runSync();
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  EdgeRuntime.waitUntil(runSync());
  return json({ ok: true, msg: "sync enqueued" }, 202);
});
