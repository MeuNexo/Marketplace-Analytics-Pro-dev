/**
 * sync-mp-saidas — ingestao das SAIDAS da conta do Mercado Pago (225-04, D-225-09).
 *
 * ─── AGENDAMENTO: POR QUE NAO EXISTE CRON NOVO AQUI ────────────────────────
 *
 * 🔴 A proibicao do plano e explicita: nao se cria um terceiro pg_cron/pg_net,
 * porque o teto de chamadas e COMPARTILHADO e ja ha dois ativos.
 *
 * A escolha foi: pendurar a invocacao no FIM do `runSync` de `sync-mp-releases`,
 * que ja roda de 3 em 3 horas pelo cron `sync-mp-releases-daily`
 * (20260618110000_cash_flow_cron.sql). Duas razoes:
 *
 *  (a) `sync_jobs` exigiria um `job_type` novo em `process-sync-job`, que e a EF
 *      que drena a fila de orders/inventory/ads. Redeployar a fila inteira para
 *      acrescentar uma ingestao de relatorio e raio de explosao maior do que o
 *      ganho — a fila move o sync do negocio todo.
 *  (b) `sync-mp-releases` ja e a EF irma desta: mesma conta, mesmo token, mesmo
 *      dominio (dinheiro entrando e saindo do MP). A saida chegar logo depois da
 *      entrada e a ordem certa.
 *
 * ⚠️ A chamada la e estritamente APOS todo o trabalho de caixa, envolvida em
 * try/catch que nao propaga: ingestao de caixa NAO pode cair por causa de
 * relatorio de saida.
 *
 * ─── A FONTE DO ARQUIVO ────────────────────────────────────────────────────
 *
 * Existe um agendamento ATIVO do lado do Mercado Pago (id 889077413, criado na
 * sonda de 03/09) que gera um relatorio de liberacoes todo dia as 06:00Z. Ele e
 * a fonte OFICIAL desta ingestao — o que resolve o efeito colateral da sonda:
 * o agendamento tem dono, nao virou job orfao.
 *
 * Consequencia de desenho: esta EF NAO cria relatorio no caminho feliz. Ela
 * lista, acha arquivo ainda nao ingerido, baixa e grava. Isso elimina de vez o
 * T-225-04-05 (laco de criacao contra o MP). So existe UM caminho de criacao,
 * como rede: se o arquivo mais novo estiver velho demais, cria no maximo UM
 * relatorio por dia, guardado pela tabela de estado.
 *
 * 🔴 O id do POST NAO e o id do arquivo. A sonda mediu: o `POST` devolve
 * `889071630` (pedido de geracao) e o `/list` devolve `64978498` (arquivo). Sao
 * namespaces diferentes, e confundi-los foi o que fez o research concluir que o
 * relatorio "nunca apareceu". Por isso o casamento aqui e por JANELA
 * (begin_date/end_date, que os dois lados devolvem normalizados em Z), nunca
 * por id.
 *
 * ⚠️ E `date_created` do `/list` vem rotulado `-04:00` enquanto o nome do
 * arquivo vem em `-03:00` — o mesmo instante com dois fusos no mesmo objeto.
 * Nao se confia no offset de `date_created` para nada.
 *
 * Supabase project: ckcdevcxgvueywivefgx.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { lerCsv, chaveDoMovimento } from "../_shared/csvSimples.ts";
import {
  classificar,
  contaNoTotal,
  valorComSinal,
  dataDoMovimento,
} from "../_shared/movimentoMp.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const ML_API = "https://api.mercadolibre.com";
const MP_API = "https://api.mercadopago.com";
const ML_APP_ID = Deno.env.get("ML_APP_ID") ?? "";
const ML_CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";

/** Idade maxima do arquivo mais novo antes de a EF criar um sob demanda. */
const DIAS_ATE_CRIAR_SOB_DEMANDA = 2;
/** Tamanho do lote de upsert — arquivo grande nao pode estourar o tempo. */
const LOTE = 200;

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

// ── Guarda de papel de servico ───────────────────────────────────────────────
// T-ixc-01: fica ANTES de qualquer trabalho, e nao pode mover para depois do
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

  const expiresTs = row.expires_at ? new Date(row.expires_at).getTime() / 1000 : 0;
  const now = Date.now() / 1000;
  if (row.access_token && expiresTs - now > 300) return row.access_token as string;

  if (!row.refresh_token) throw new Error("No refresh token for ml_user_id=" + mlUserId);
  if (!ML_APP_ID || !ML_CLIENT_SECRET) throw new Error("ML_APP_ID/ML_CLIENT_SECRET not set");

  const resp = await fetch(ML_API + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!resp.ok) throw new Error("Token refresh " + resp.status + " for ml_user_id=" + mlUserId);

  const data = await resp.json();
  const newExpiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();
  await sb
    .from("ml_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("ml_user_id", mlUserId);

  return data.access_token as string;
}

async function mpGet(url: string, token: string): Promise<Response> {
  return await fetch(url, { headers: { Authorization: "Bearer " + token } });
}

interface ArquivoMp {
  file_name?: string;
  begin_date?: string;
  end_date?: string;
  date_created?: string;
  status?: string;
}

async function listarArquivos(token: string): Promise<ArquivoMp[]> {
  const res = await mpGet(MP_API + "/v1/account/release_report/list", token);
  if (!res.ok) throw new Error("release_report/list " + res.status);
  const corpo = await res.json();
  return Array.isArray(corpo) ? corpo : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// A ingestao de uma organizacao.
// ─────────────────────────────────────────────────────────────────────────────
async function sincronizarOrg(
  sb: ReturnType<typeof createClient>,
  linhaToken: { ml_user_id: string; organization_id: string },
): Promise<Record<string, unknown>> {
  const { ml_user_id: mlUserId, organization_id: orgId } = linhaToken;
  const token = await getAccessToken(sb, mlUserId);

  const arquivos = await listarArquivos(token);
  const disponiveis = arquivos.filter((a) => a.file_name && a.status === "enabled");

  // Quais ja foram ingeridos? A tabela de estado e a memoria entre invocacoes —
  // sem ela, cada execucao reprocessaria (ou recriaria) tudo.
  const { data: jaVistos } = await sb
    .from("mp_saidas_relatorio")
    .select("arquivo,status")
    .eq("organization_id", orgId);

  const prontos = new Set(
    (jaVistos ?? []).filter((r: any) => r.status === "pronto" && r.arquivo).map((r: any) => r.arquivo),
  );

  const pendentes = disponiveis.filter((a) => !prontos.has(a.file_name));

  if (pendentes.length === 0) {
    // Rede de seguranca: se o agendamento do MP parou de produzir, cria UM
    // relatorio sob demanda. No maximo um por dia, guardado pelo estado.
    const maisNovo = disponiveis
      .map((a) => a.date_created ?? "")
      .sort()
      .pop();
    const idadeDias = maisNovo
      ? (Date.now() - new Date(maisNovo).getTime()) / 86400000
      : Number.POSITIVE_INFINITY;

    if (idadeDias > DIAS_ATE_CRIAR_SOB_DEMANDA) {
      return await criarSobDemanda(sb, token, orgId, mlUserId, idadeDias);
    }
    return { ok: true, motivo: "nada_novo", arquivos_disponiveis: disponiveis.length };
  }

  const resultados: Record<string, unknown>[] = [];
  for (const arquivo of pendentes) {
    resultados.push(await ingerirArquivo(sb, token, orgId, mlUserId, arquivo));
  }
  return { ok: true, arquivos: resultados };
}

async function criarSobDemanda(
  sb: ReturnType<typeof createClient>,
  token: string,
  orgId: string,
  mlUserId: string,
  idadeDias: number,
): Promise<Record<string, unknown>> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: jaHoje } = await sb
    .from("mp_saidas_relatorio")
    .select("id")
    .eq("organization_id", orgId)
    .gte("criado_em", hoje + "T00:00:00Z")
    .limit(1);

  // T-225-04-05: no maximo UMA criacao por dia. O teto de chamadas contra o MP
  // e compartilhado, e laco de criacao e o jeito de queimar ele.
  if (jaHoje && jaHoje.length > 0) {
    return { ok: true, motivo: "criacao_ja_feita_hoje", idade_dias: idadeDias };
  }

  const fim = new Date();
  const inicio = new Date(fim.getTime() - 3 * 86400000);
  const res = await fetch(MP_API + "/v1/account/release_report", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      begin_date: inicio.toISOString().slice(0, 19) + "Z",
      end_date: fim.toISOString().slice(0, 19) + "Z",
    }),
  });
  const corpo = await res.json().catch(() => ({}));

  await sb.from("mp_saidas_relatorio").upsert(
    {
      organization_id: orgId,
      ml_user_id: Number(mlUserId),
      // 🔴 Este id e o do PEDIDO de geracao, NAO o do arquivo. O casamento com
      // o arquivo e por janela, na proxima invocacao.
      relatorio_id: String(corpo?.id ?? "sem-id-" + Date.now()),
      status: res.ok ? "pendente" : "erro",
      begin_date: corpo?.begin_date ?? null,
      end_date: corpo?.end_date ?? null,
      ultimo_erro: res.ok ? null : "POST release_report " + res.status,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "organization_id,relatorio_id" },
  );

  return { ok: res.ok, motivo: "criado_sob_demanda", http: res.status, id: corpo?.id ?? null };
}

async function ingerirArquivo(
  sb: ReturnType<typeof createClient>,
  token: string,
  orgId: string,
  mlUserId: string,
  arquivo: ArquivoMp,
): Promise<Record<string, unknown>> {
  const nome = arquivo.file_name as string;
  const identidade = "file:" + nome;

  const marcar = async (campos: Record<string, unknown>) => {
    await sb.from("mp_saidas_relatorio").upsert(
      {
        organization_id: orgId,
        ml_user_id: Number(mlUserId),
        relatorio_id: identidade,
        arquivo: nome,
        begin_date: arquivo.begin_date ?? null,
        end_date: arquivo.end_date ?? null,
        atualizado_em: new Date().toISOString(),
        ...campos,
      },
      { onConflict: "organization_id,relatorio_id" },
    );
  };

  const res = await mpGet(MP_API + "/v1/account/release_report/" + nome, token);
  if (!res.ok) {
    // Relatorio ainda em preparo nao e erro: encerra sem gravar nada, registra
    // o estado, e a execucao seguinte continua de onde parou.
    await marcar({ status: "pendente", ultimo_erro: "download " + res.status });
    return { arquivo: nome, ok: false, http: res.status, motivo: "ainda_em_preparo" };
  }

  const texto = await res.text();
  const { cabecalho, linhas } = lerCsv(texto, { separador: ";" });

  if (cabecalho.length === 0 || linhas.length === 0) {
    await marcar({ status: "erro", ultimo_erro: "arquivo vazio ou sem cabecalho", linhas_lidas: 0 });
    return { arquivo: nome, ok: false, motivo: "arquivo_vazio" };
  }

  // Ocorrencia: desempata linhas identicas nas seis colunas da chave. Duas
  // linhas iguais sao DUAS — colapsa-las seria perder dinheiro em silencio.
  const vistas = new Map<string, number>();
  const registros: Record<string, unknown>[] = [];

  for (const linha of linhas) {
    const campos = linha.campos;
    const dia = dataDoMovimento(campos.DATE);
    if (!dia) continue; // sem data nao ha movimento posicionavel no tempo

    const assinatura = [
      campos.DATE,
      campos.SOURCE_ID,
      campos.DESCRIPTION,
      campos.GROSS_AMOUNT,
      campos.NET_CREDIT_AMOUNT,
      campos.NET_DEBIT_AMOUNT,
    ].join("");
    const ocorrencia = (vistas.get(assinatura) ?? 0) + 1;
    vistas.set(assinatura, ocorrencia);

    const classe = classificar(campos);
    const hash = await chaveDoMovimento(campos, ocorrencia);
    const fonte = (campos.SOURCE_ID ?? "").trim();

    registros.push({
      organization_id: orgId,
      ml_user_id: Number(mlUserId),
      movimento_hash: hash,
      ocorrencia,
      source_id: fonte || null,
      external_reference: (campos.PURCHASE_ID ?? "").trim() || null,
      ml_order_id: null,
      data_movimento: dia,
      tipo: (campos.DESCRIPTION ?? "").trim() || "saldo_de_abertura",
      descricao: (campos.BUSINESS_UNIT ?? "").trim() || null,
      business_unit: (campos.BUSINESS_UNIT ?? "").trim() || null,
      classe,
      conta_no_total: contaNoTotal(classe),
      valor: valorComSinal(campos),
      relatorio_arquivo: nome,
      linha_no_arquivo: linha.numeroDaLinha,
      divergente: linha.divergente,
      payload: { ...campos, __extras: linha.extras },
    });
  }

  // 🔴 A chave do pedido NAO vem no arquivo. As colunas que a documentacao
  // publica prometia (EXTERNAL_REFERENCE, ORDER_ID) NAO EXISTEM no arquivo
  // real. A atribuicao e DERIVADA por join: o SOURCE_ID da linha de disputa e
  // o payment_id do MP, e esse pagamento ja esta em `cash_inflows` com
  // `ml_order_id`. Medido na sonda: 29 de 29.
  const fontes = [
    ...new Set(
      registros
        .filter((r) => r.classe === "atribuivel_a_venda" && r.source_id)
        .map((r) => String(r.source_id)),
    ),
  ];
  const porPagamento = new Map<string, string>();
  for (let i = 0; i < fontes.length; i += LOTE) {
    const { data } = await sb
      .from("cash_inflows")
      .select("payment_id,ml_order_id")
      .eq("organization_id", orgId)
      .in("payment_id", fontes.slice(i, i + LOTE));
    for (const linha of data ?? []) {
      if (linha.ml_order_id) porPagamento.set(String(linha.payment_id), String(linha.ml_order_id));
    }
  }
  for (const registro of registros) {
    if (registro.source_id) {
      registro.ml_order_id = porPagamento.get(String(registro.source_id)) ?? null;
    }
  }

  // Upsert paginado: arquivo grande nao pode estourar o tempo da EF.
  let gravadas = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE);
    const { error } = await sb
      .from("mp_saidas")
      .upsert(lote, { onConflict: "organization_id,movimento_hash" });
    if (error) {
      await marcar({ status: "erro", ultimo_erro: error.message, linhas_lidas: linhas.length });
      return { arquivo: nome, ok: false, motivo: "upsert", erro: error.message, gravadas };
    }
    gravadas += lote.length;
  }

  await marcar({
    status: "pronto",
    linhas_lidas: linhas.length,
    linhas_gravadas: gravadas,
    ultimo_erro: null,
  });

  return {
    arquivo: nome,
    ok: true,
    linhas_lidas: linhas.length,
    gravadas,
    divergentes: linhas.filter((l) => l.divergente).length,
    atribuiveis: registros.filter((r) => r.ml_order_id).length,
  };
}

// ── runSync: TODO o trabalho em background, com try/catch externo ────────────
// Pitfall 4: excecao em background morre SEM LOG se nao for capturada aqui.
async function runSync(): Promise<Record<string, unknown>> {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: tokens, error } = await sb
      .from("ml_tokens")
      .select("ml_user_id,organization_id")
      .not("refresh_token", "is", null);

    if (error) {
      console.error("sync-mp-saidas runSync error: ml_tokens:", error.message);
      return { ok: false, error: error.message };
    }
    if (!tokens || tokens.length === 0) {
      console.log("sync-mp-saidas runSync: no active users");
      return { ok: true, results: [] };
    }

    const results: Record<string, unknown>[] = [];
    for (const linha of tokens) {
      try {
        const r = await sincronizarOrg(sb, linha as any);
        results.push({ ml_user_id: linha.ml_user_id, ...r });
      } catch (e: any) {
        console.error("sync-mp-saidas ml_user_id=" + linha.ml_user_id + " error:", e?.message);
        results.push({ ml_user_id: linha.ml_user_id, error: e?.message });
      }
    }
    return { ok: true, results };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sync-mp-saidas runSync error:", message);
    return { ok: false, error: message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // A guarda vem ANTES de qualquer trabalho — inclusive antes do waitUntil.
  const guard = requireServiceRole(req);
  if (guard) return guard;

  // Modo debug sincrono: prova a persistencia sem depender de log de console.
  const isDebug = new URL(req.url).searchParams.get("debug") === "1";
  if (isDebug) {
    const diag = await runSync();
    return json({ ok: true, mode: "debug-sync", diag }, 200);
  }

  EdgeRuntime.waitUntil(runSync());
  return json({ ok: true, msg: "sync enqueued" }, 202);
});
