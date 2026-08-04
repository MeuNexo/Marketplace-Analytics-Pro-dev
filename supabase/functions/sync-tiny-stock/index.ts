// ── sync-tiny-stock ───────────────────────────────────────────────────────────
// Fase 214 — Task 5. Varre o catalogo e o estoque por deposito do Tiny com
// cursor retomavel, alimentando `tiny_products` e `tiny_stock`.
//
// POR QUE EXISTE: a tela de Reposicao ve 86 de 681 SKUs porque a RPC nasce de
// `ml_inventory_cache WHERE status='active'` — item sem anuncio some, inclusive
// o que pausou sozinho por ruptura. E o estoque que ela conhece e so o Full do
// ML. Esta EF traz o catalogo inteiro e o saldo por deposito.
//
// SO LE o Tiny. Nao cria, nao altera e nao apaga nada la.
//
// MEDIDO em 2026-08-04 (docs/superpowers/plans/tiny-shape-medicao.md):
//   - 771 produtos ativos; ~84% sao VARIACAO. NUNCA filtrar tipoVariacao='P':
//     e na variacao que vive o SKU da operacao.
//   - 12 requisicoes sem espacamento -> 7 responderam HTTP 429. Serializar e
//     requisito, nao precaucao.
//   - O mesmo SKU pode ter mais de um tiny_id (337 e -1 no K6CBS2345SORG3):
//     por isso as tabelas sao chaveadas por tiny_id, nunca por sku.
//
// Autenticacao: verify_jwt=false no config.toml; guard interno
// requireServiceRole(). Mesmo padrao de sync-tiny-costs / sync-tiny-payables.
//
// Resposta SEMPRE descritiva — nunca 202 vazio. Licao da fase 211: EF que
// responde 202 e engole a falha faz o operador achar que sincronizou.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extrairDepositos } from "./depositos.ts";
import { proximaAcao, type EstadoCursor, type ItemFila } from "./cursor.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_KEY  = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const TINY_API     = "https://api.tiny.com.br/public-api/v3";

// ~60 req/min. Medido: paralelizar devolve 429.
const RATE_MS       = 1100;
const PAGE_SLEEP_MS = 300;
// Teto de itens por invocacao. Na pratica o ORCAMENTO_MS corta antes (~81
// itens), o que da ~10 invocacoes e ~14 min por volta completa dos 771.
const CAP_POR_CHAMADA = 150;
const ORCAMENTO_MS    = 90_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function requireServiceRole(req: Request): Response | null {
  if (!SERVICE_KEY) return null; // dev local sem key configurada — permitir
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + SERVICE_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  return null;
}

// ── Token (mesmo padrao de sync-tiny-costs) ──────────────────────────────────
async function getTinyToken(mlUserId: string): Promise<string> {
  const { data: tok, error } = await sb
    .from("ml_tokens")
    .select("tiny_access_token, tiny_refresh_token, tiny_expires_at")
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error || !tok) throw new Error(`Conta ML ${mlUserId} nao encontrada em ml_tokens`);
  if (!tok.tiny_access_token) throw new Error(`Tiny nao conectado para ${mlUserId}.`);

  const now = Math.floor(Date.now() / 1000);
  if (tok.tiny_expires_at && tok.tiny_expires_at - now > 300) return tok.tiny_access_token;
  if (!tok.tiny_refresh_token) throw new Error(`Token Tiny expirado sem refresh para ${mlUserId}.`);

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/tiny-oauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      action: "refresh_token",
      refresh_token: tok.tiny_refresh_token,
      ml_user_id: mlUserId,
    }),
  });
  const d = await resp.json();
  if (!resp.ok || !d.success) {
    throw new Error(`Falha ao renovar token Tiny: ${d.error ?? "desconhecido"}`);
  }
  return d.access_token;
}

// deno-lint-ignore no-explicit-any
async function tinyGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${TINY_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 429) throw new Error("Tiny 429 rate limit");
  if (!resp.ok) throw new Error(`Tiny ${path} ${resp.status}`);
  return await resp.json();
}

// ── Fase 1: catalogo ─────────────────────────────────────────────────────────
async function varrerCatalogo(token: string, orgId: string, mlUserId: string): Promise<ItemFila[]> {
  const fila: ItemFila[] = [];
  let offset = 0;
  for (let pagina = 0; pagina < 60; pagina++) {
    const data = await tinyGet(token, "/produtos", {
      situacao: "A",
      limit: "100",
      offset: String(offset),
    });
    const itens = Array.isArray(data?.itens) ? data.itens : [];
    if (itens.length === 0) break;

    const linhas = itens
      .map((it: Record<string, unknown>) => ({
        organization_id: orgId,
        ml_user_id: mlUserId,
        tiny_id: String(it.id ?? ""),
        sku: String(it.sku ?? "").trim(),
        nome: (it.descricao ?? it.nome ?? null) as string | null,
        situacao: (it.situacao ?? null) as string | null,
        // MEDIDO: ~84% do catalogo e 'V'. NUNCA filtrar por 'P' aqui — e na
        // variacao que vive o SKU da operacao. 'N' tambem existe.
        tipo_variacao: (it.tipoVariacao ?? null) as string | null,
        synced_at: new Date().toISOString(),
      }))
      .filter((l: { sku: string; tiny_id: string }) => l.sku !== "" && l.tiny_id !== "");

    if (linhas.length > 0) {
      const { error } = await sb.from("tiny_products")
        // D-7: chave por tiny_id. O mesmo SKU tem mais de um registro no Tiny.
        .upsert(linhas, { onConflict: "organization_id,tiny_id" });
      if (error) throw new Error(`upsert tiny_products: ${error.message}`);
      for (const l of linhas) fila.push({ tiny_id: l.tiny_id, sku: l.sku });
    }

    if (itens.length < 100) break;
    offset += 100;
    await sleep(PAGE_SLEEP_MS);
  }
  return fila;
}

// ── Fase 2: estoque ──────────────────────────────────────────────────────────
async function varrerEstoque(
  token: string, orgId: string, mlUserId: string, fila: ItemFila[], de: number,
): Promise<{ ate: number; erros: number; ultimoErro: string | null }> {
  const inicio = Date.now();
  let i = de, erros = 0, ultimoErro: string | null = null;
  const limite = Math.min(fila.length, de + CAP_POR_CHAMADA);

  for (; i < limite; i++) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const item = fila[i];
    try {
      const resp = await tinyGet(token, `/estoque/${item.tiny_id}`);
      const saldos = extrairDepositos(resp);
      if (saldos.length > 0) {
        const { error } = await sb.from("tiny_stock").upsert(
          saldos.map((s) => ({
            organization_id: orgId,
            ml_user_id: mlUserId,
            tiny_id: item.tiny_id,
            sku: item.sku,
            deposito: s.deposito,
            saldo: s.saldo,
            disponivel: s.disponivel, // D-6: e este que decide compra
            synced_at: new Date().toISOString(),
          })),
          // D-7: chave por tiny_id. Chavear por sku faria o registro de saldo
          // -1 sobrescrever o de 337 conforme a ordem da varredura.
          { onConflict: "organization_id,tiny_id,deposito" },
        );
        if (error) throw new Error(`upsert tiny_stock: ${error.message}`);
      }
    } catch (e) {
      // Falha de um produto nao derruba o lote — registra e segue.
      erros++;
      ultimoErro = `${item.sku}: ${e instanceof Error ? e.message : String(e)}`;
      // 429 significa que o teto foi atingido: para e retoma na proxima
      // invocacao, do mesmo indice.
      if (ultimoErro.includes("429")) { break; }
    }
    await sleep(RATE_MS);
  }
  return { ate: i, erros, ultimoErro };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const naoAutorizado = requireServiceRole(req);
  if (naoAutorizado) return naoAutorizado;

  try {
    const { ml_user_id } = await req.json();
    if (!ml_user_id) return json({ ok: false, error: "ml_user_id obrigatorio" }, 400);

    const { data: tokenRow } = await sb.from("ml_tokens")
      .select("organization_id").eq("ml_user_id", ml_user_id).maybeSingle();
    if (!tokenRow?.organization_id) {
      return json({ ok: false, error: "organizacao nao encontrada" }, 404);
    }
    const orgId = tokenRow.organization_id as string;

    const { data: cur } = await sb.from("tiny_sync_cursor")
      .select("fase, fila, indice, volta_iniciada, volta_completa, erros")
      .eq("organization_id", orgId).eq("ml_user_id", ml_user_id).maybeSingle();

    const errosAntes = (cur as { erros?: number } | null)?.erros ?? 0;
    const estado = (cur as EstadoCursor | null) ?? null;
    const acao = proximaAcao(estado, new Date());
    const token = await getTinyToken(ml_user_id);
    const agora = new Date().toISOString();

    if (acao.tipo === "iniciar_volta") {
      const fila = await varrerCatalogo(token, orgId, ml_user_id);
      await sb.from("tiny_sync_cursor").upsert({
        organization_id: orgId, ml_user_id, fase: "estoque", fila, indice: 0,
        volta_iniciada: agora, volta_completa: null, erros: 0, ultimo_erro: null,
        updated_at: agora,
      }, { onConflict: "organization_id,ml_user_id" });
      return json({
        ok: true, fase: "catalogo", processados: fila.length,
        restantes: fila.length, volta_completa: false,
      });
    }

    if (acao.tipo === "fechar_volta") {
      await sb.from("tiny_sync_cursor")
        .update({ volta_completa: agora, updated_at: agora })
        .eq("organization_id", orgId).eq("ml_user_id", ml_user_id);
      return json({
        ok: true, fase: "fechada", processados: 0, restantes: 0, volta_completa: true,
      });
    }

    const fila = (estado?.fila ?? []) as ItemFila[];
    const r = await varrerEstoque(token, orgId, ml_user_id, fila, acao.de);
    await sb.from("tiny_sync_cursor").update({
      indice: r.ate,
      erros: errosAntes + r.erros,
      ultimo_erro: r.ultimoErro,
      updated_at: agora,
    }).eq("organization_id", orgId).eq("ml_user_id", ml_user_id);

    return json({
      ok: true, fase: "estoque", processados: r.ate - acao.de,
      restantes: Math.max(0, fila.length - r.ate),
      volta_completa: false, erros: r.erros, ultimo_erro: r.ultimoErro,
    });
  } catch (e) {
    // A falha aparece na RESPOSTA. Nunca 202 silencioso — licao da fase 211.
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
