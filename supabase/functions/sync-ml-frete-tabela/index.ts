/**
 * sync-ml-frete-tabela — captura do custo de tabela do frete por anuncio
 * (Fase 225, plano 06, D-225-17 / D-225-18).
 *
 * ─── O QUE ELA CAPTURA, E POR QUE E BARATO ─────────────────────────────────
 *
 * 🔴 `list_cost` de GET /items/{id}/shipping_options. UMA chamada por anuncio,
 * sem varrer destino, porque `list_cost` NAO varia por CEP nem por metodo de
 * envio. Medido ao vivo em 03/09/2026:
 *
 *   MLB7273733004   base_cost R$ 23,30 (SP) / 47,50 (DF) / 29,20 (RS)
 *                   list_cost R$ 25,45 NOS TRES
 *   MLB4391644481   base_cost R$ 42,20 (SP) / 85,30 (DF)
 *                   list_cost R$ 50,75 NOS DOIS, e em 4 metodos de envio
 *
 * E o Wesley CONFIRMOU esses dois numeros na tela do painel de vendedor
 * (D-W-225-03, 03/09): "sobre o frete, e esse mesmo, ja confirmei pra voce".
 * Por isso `list_cost` e a regua e `base_cost` entra so como `base_cost_ref`,
 * DIAGNOSTICO — ele e funcao do destino e usa-lo na comparacao inventaria
 * divergencia.
 *
 * ⚠️ A prova e CONFIRMACAO VISUAL HUMANA, nao leitura automatizada do painel.
 * Se o frete prometido divergir sistematicamente do que ele enxerga, esta e a
 * primeira premissa a remedir — e `base_cost_ref` existe para isso.
 *
 * ─── O UNIVERSO VEM DA API, NAO DO CACHE ───────────────────────────────────
 *
 * `GET /users/{seller_id}/items/search`, paginado. NAO se le
 * `ml_inventory_cache`: aquele cache ja teve NOVE anuncios fantasma — fechados
 * no ML e ainda marcados como ativos, com 94 unidades de estoque que nao
 * existiam. Cache e derivado e ja mentiu; a busca do vendedor e a origem.
 *
 * ─── AGENDAMENTO: POR QUE NAO EXISTE CRON NOVO AQUI ────────────────────────
 *
 * 🔴 A proibicao do plano e explicita: nao se cria um terceiro pg_cron, porque
 * o teto de chamadas e COMPARTILHADO e ja ha dois ativos.
 *
 * A escolha e a MESMA do plano 04: carona no fim do `runSync` de
 * `sync-mp-releases`, que ja roda de 3 em 3 horas. Duas razoes:
 *
 *  (a) `sync_jobs` exigiria um `job_type` novo em `process-sync-job`, que e a EF
 *      que drena a fila de orders/inventory/ads. Redeployar a fila do negocio
 *      inteiro para acrescentar uma captura de frete e raio de explosao maior
 *      que o ganho.
 *  (b) `sync-mp-releases` ja carrega a ingestao irma (`sync-mp-saidas`) com o
 *      mesmo padrao, e o caminho ja esta provado em producao.
 *
 * ⚠️ De 3 em 3 horas sao OITO invocacoes por dia. Varrer a conta inteira oito
 * vezes atras de um valor de TABELA seria desperdicio e risco: o bloqueio do ML
 * por excesso e por ENDERECO DE ORIGEM e derruba as outras sincronizacoes
 * junto. Por isso existe TRAVA DIARIA — item ja tentado hoje e pulado, e a
 * segunda invocacao do dia devolve `nada_novo` depois de uma consulta barata.
 *
 * ─── ANUNCIO SEM ESTOQUE E CONDICAO NORMAL ─────────────────────────────────
 *
 * O endpoint devolve 404 "stock out for all requested products" para anuncio
 * sem estoque. Isso NAO e falha de sync: e condicao normal, contada em campo
 * PROPRIO do retorno, com a tentativa registrada para o item nao monopolizar o
 * orcamento da proxima rodada. Ele volta quando houver estoque.
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

/**
 * 🔴 CEP de referencia — UMA constante, nao uma lista.
 * Qualquer CEP valido serviria, porque `list_cost` nao varia por destino. Este
 * e o que produziu os R$ 25,45 e R$ 50,75 que o Wesley confirmou na tela; usar
 * outro tornaria a serie nao comparavel com a medicao que fundou a decisao.
 * (Av. Paulista, Sao Paulo/SP.)
 */
const CEP_REF = "01310100";

/** Anuncios por invocacao. Varredura sem teto estoura o tempo da funcao. */
const ORCAMENTO = 150;
/** Pausa entre chamadas, mesma cadencia da ingestao de repasses. */
const PAUSA_MS = 150;
/** Teto de reticencia no 429 — o bloqueio do ML e por endereco de origem. */
const MAX_RETENTATIVAS = 4;
const PAGINA_BUSCA = 100;

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
// T-ixc-01: fica ANTES de qualquer trabalho e nao pode mover para depois do
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

/** O universo de anuncios da conta, direto da origem. */
async function listarAnuncios(sellerId: string, token: string): Promise<string[]> {
  const ids: string[] = [];
  for (const situacao of ["active", "paused"]) {
    let salto = 0;
    while (true) {
      const res = await fetch(
        ML_API + "/users/" + sellerId + "/items/search?status=" + situacao +
          "&limit=" + PAGINA_BUSCA + "&offset=" + salto,
        { headers: { Authorization: "Bearer " + token, Accept: "application/json" } },
      );
      const corpo = await res.json();
      if (!res.ok) {
        throw new Error("items/search " + situacao + " devolveu " + res.status + ": " +
          (corpo?.message ?? ""));
      }
      const pagina: string[] = corpo.results ?? [];
      ids.push(...pagina);
      const total: number = corpo.paging?.total ?? 0;
      salto += PAGINA_BUSCA;
      if (pagina.length < PAGINA_BUSCA || salto >= total || salto >= 10000) break;
      await dormir(PAUSA_MS);
    }
  }
  return [...new Set(ids)];
}

type Leitura =
  | { tipo: "ok"; listCost: number; baseCostRef: number | null }
  | { tipo: "sem_estoque" }
  | { tipo: "sem_custo" };

/**
 * 🔴 UMA chamada por anuncio. Nao ha varredura de destino porque nao ha o que
 * varrer: `list_cost` e constante por item.
 *
 * O tratamento por codigo e deliberadamente DIFERENTE, porque os codigos
 * significam coisas diferentes:
 *   404 — anuncio sem estoque: CONDICAO NORMAL, volta na proxima rodada
 *   429 — bloqueio por excesso: recuo com espera crescente
 *   400 — destino invalido: DEFEITO NOSSO (o CEP e constante do codigo), falha alto
 */
async function lerCustoDeTabela(itemId: string, token: string): Promise<Leitura> {
  let espera = 1000;
  for (let tentativa = 0; tentativa <= MAX_RETENTATIVAS; tentativa++) {
    const res = await fetch(
      ML_API + "/items/" + itemId + "/shipping_options?zip_code=" + CEP_REF,
      { headers: { Authorization: "Bearer " + token, Accept: "application/json" } },
    );

    if (res.status === 404) {
      // Anuncio sem estoque nao e mensuravel neste endpoint. Nao e erro.
      await res.body?.cancel();
      return { tipo: "sem_estoque" };
    }

    if (res.status === 429) {
      // Recuo com espera crescente: o bloqueio do ML e por ENDERECO DE ORIGEM
      // e derruba as outras sincronizacoes junto se insistirmos.
      await res.body?.cancel();
      if (tentativa === MAX_RETENTATIVAS) {
        throw new Error("429 persistente em " + itemId + " apos " + MAX_RETENTATIVAS + " recuos");
      }
      await dormir(espera);
      espera *= 2;
      continue;
    }

    if (res.status === 400) {
      // O CEP e constante NOSSA, nunca entrada do usuario. 400 aqui significa
      // que a constante esta errada — falhar baixo esconderia isso para sempre.
      const corpo = await res.text();
      throw new Error(
        "400 do endpoint de opcoes de envio para " + itemId +
        " — o CEP de referencia do codigo esta invalido: " + corpo.slice(0, 200),
      );
    }

    const corpo = await res.json();
    if (!res.ok) {
      throw new Error("opcoes de envio " + itemId + " devolveu " + res.status + ": " +
        (corpo?.message ?? ""));
    }

    const opcoes: Array<Record<string, unknown>> = corpo.options ?? [];
    const comLista = opcoes.find((o) => typeof o.list_cost === "number");
    if (!comLista) return { tipo: "sem_custo" };

    const baseNumerico = opcoes
      .map((o) => o.base_cost)
      .find((v) => typeof v === "number") as number | undefined;

    return {
      tipo: "ok",
      listCost: comLista.list_cost as number,
      baseCostRef: baseNumerico ?? null,
    };
  }
  return { tipo: "sem_custo" };
}

async function capturarOrg(
  sb: ReturnType<typeof createClient>,
  linha: { ml_user_id: string; organization_id: string; seller_id: string | null },
): Promise<Record<string, unknown>> {
  const orgId = linha.organization_id;
  const mlUserId = String(linha.ml_user_id);
  const sellerId = String(linha.seller_id ?? linha.ml_user_id);

  const token = await getAccessToken(sb, mlUserId);
  const universo = await listarAnuncios(sellerId, token);

  // Estado da varredura: quem foi tentado, quando, e com que desfecho.
  const { data: estado } = await sb
    .from("ml_item_frete_captura")
    .select("item_id,ultima_tentativa,tentativas")
    .eq("organization_id", orgId);

  const tentadoEm = new Map<string, string>();
  const contagem = new Map<string, number>();
  for (const e of estado ?? []) {
    tentadoEm.set(String(e.item_id), String(e.ultima_tentativa));
    contagem.set(String(e.item_id), Number(e.tentativas ?? 0));
  }

  // 🔴 TRAVA DIARIA. `list_cost` e custo de TABELA — nao muda de hora em hora,
  // e a carona no `sync-mp-releases` traz oito invocacoes por dia.
  const hoje = new Date().toISOString().slice(0, 10);
  const pendentes = universo
    .filter((id) => (tentadoEm.get(id) ?? "").slice(0, 10) !== hoje)
    .sort((a, b) => (tentadoEm.get(a) ?? "").localeCompare(tentadoEm.get(b) ?? ""));

  if (pendentes.length === 0) {
    return { motivo: "nada_novo", universo: universo.length, tentados: 0 };
  }

  const fila = pendentes.slice(0, ORCAMENTO);

  // O custo vigente hoje, por item — para saber o que MUDOU sem uma consulta
  // por anuncio. Uma linha por item: a mais recente com vigencia <= hoje.
  const { data: serie } = await sb
    .from("ml_item_frete_tabela")
    .select("item_id,list_cost,vigente_desde")
    .eq("organization_id", orgId)
    .lte("vigente_desde", hoje)
    .order("vigente_desde", { ascending: false });

  const vigente = new Map<string, number>();
  for (const s of serie ?? []) {
    const chave = String(s.item_id);
    if (!vigente.has(chave)) vigente.set(chave, Number(s.list_cost));
  }

  let novos = 0;
  let inalterados = 0;
  let semEstoque = 0;
  let semCusto = 0;
  let nErros = 0;
  const falhas: string[] = [];

  for (const itemId of fila) {
    let status = "erro";
    let mensagem: string | null = null;

    try {
      const leitura = await lerCustoDeTabela(itemId, token);

      if (leitura.tipo === "sem_estoque") {
        // Condicao normal, contada a parte de erro real.
        status = "sem_estoque";
        semEstoque++;
      } else if (leitura.tipo === "sem_custo") {
        // Resposta que nao serve. Nao se inventa zero: ausencia nao e zero.
        status = "sem_custo";
        semCusto++;
      } else {
        const anterior = vigente.get(itemId);
        const mudou = anterior === undefined || Math.abs(anterior - leitura.listCost) > 0.005;

        if (mudou) {
          // 🔴 Linha NOVA com vigencia a partir de hoje. A anterior NAO e
          // apagada — e ela que torna honesta a comparacao com venda antiga.
          const { error } = await sb.from("ml_item_frete_tabela").upsert(
            {
              organization_id: orgId,
              ml_user_id: Number(mlUserId),
              item_id: itemId,
              list_cost: leitura.listCost,
              base_cost_ref: leitura.baseCostRef,
              cep_ref: CEP_REF,
              vigente_desde: hoje,
              capturado_em: new Date().toISOString(),
              visto_em: new Date().toISOString(),
            },
            { onConflict: "organization_id,item_id,vigente_desde" },
          );
          if (error) throw new Error("upsert: " + error.message);
          vigente.set(itemId, leitura.listCost);
          status = "ok";
          novos++;
        } else {
          // Custo inalterado: a serie NAO ganha linha, so o carimbo de que
          // alguem olhou. Serie que cresce por dia mente sobre mudanca.
          await sb
            .from("ml_item_frete_tabela")
            .update({ visto_em: new Date().toISOString() })
            .eq("organization_id", orgId)
            .eq("item_id", itemId);
          status = "inalterado";
          inalterados++;
        }
      }
    } catch (e: unknown) {
      mensagem = e instanceof Error ? e.message : String(e);
      nErros++;
      if (falhas.length < 5) falhas.push(itemId + ": " + mensagem);
    }

    await sb.from("ml_item_frete_captura").upsert(
      {
        organization_id: orgId,
        ml_user_id: Number(mlUserId),
        item_id: itemId,
        ultima_tentativa: new Date().toISOString(),
        ultimo_status: status,
        tentativas: (contagem.get(itemId) ?? 0) + 1,
        ultimo_erro: mensagem,
      },
      { onConflict: "organization_id,item_id" },
    );

    await dormir(PAUSA_MS);
  }

  return {
    universo: universo.length,
    pendentes: pendentes.length,
    tentados: fila.length,
    novos,
    inalterados,
    // 🔴 `sem_estoque` e campo PROPRIO: condicao normal nao pode ser lida como
    // falha, nem falha pode se esconder atras dela.
    sem_estoque: semEstoque,
    sem_custo: semCusto,
    erros: nErros,
    exemplos_de_erro: falhas,
    cep_ref: CEP_REF,
  };
}

// ── runSync: TODO o trabalho em background, com try/catch externo ────────────
// Excecao em background morre SEM LOG se nao for capturada aqui.
async function runSync(): Promise<Record<string, unknown>> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // 🔴 D-225-14: so as organizacoes que o monitor de conciliacao cobre. O
    // escopo sai de DADO (`conciliacao_config`, semeada so para a Pe Vermeio),
    // nunca de um UUID escrito no codigo — que alem de desperdicio seria
    // superficie que o escopo da fase nao pediu.
    const { data: cobertas, error: erroCfg } = await sb
      .from("conciliacao_config")
      .select("organization_id");

    if (erroCfg) {
      console.error("sync-ml-frete-tabela runSync error: conciliacao_config:", erroCfg.message);
      return { ok: false, error: erroCfg.message };
    }
    const noEscopo = new Set((cobertas ?? []).map((c: Record<string, unknown>) => c.organization_id));
    if (noEscopo.size === 0) {
      console.log("sync-ml-frete-tabela runSync: nenhuma organizacao no escopo do monitor");
      return { ok: true, results: [] };
    }

    const { data: todosTokens, error } = await sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id,seller_id")
      .not("refresh_token", "is", null);

    if (error) {
      console.error("sync-ml-frete-tabela runSync error: ml_tokens:", error.message);
      return { ok: false, error: error.message };
    }

    const tokens = (todosTokens ?? []).filter((t: Record<string, unknown>) =>
      noEscopo.has(t.organization_id)
    );

    if (!tokens || tokens.length === 0) {
      console.log("sync-ml-frete-tabela runSync: no active users");
      return { ok: true, results: [] };
    }

    const results: Record<string, unknown>[] = [];
    for (const linha of tokens) {
      try {
        const r = await capturarOrg(sb, linha as never);
        results.push({ ml_user_id: linha.ml_user_id, ...r });
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        console.error("sync-ml-frete-tabela ml_user_id=" + linha.ml_user_id + " error:", m);
        results.push({ ml_user_id: linha.ml_user_id, error: m });
      }
    }
    return { ok: true, results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-ml-frete-tabela runSync error:", message);
    return { ok: false, error: message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // A guarda vem ANTES de qualquer trabalho — inclusive antes do waitUntil.
  const guard = requireServiceRole(req);
  if (guard) return guard;

  // Modo sincrono de depuracao: prova a persistencia sem depender de log.
  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  if (isDebug) {
    const diag = await runSync();
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  EdgeRuntime.waitUntil(runSync());
  return json({ ok: true, msg: "sync enqueued" }, 202);
});
