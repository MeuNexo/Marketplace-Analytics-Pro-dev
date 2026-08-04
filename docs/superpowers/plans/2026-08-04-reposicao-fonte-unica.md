# Reposição como Fonte Única de Compras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a tela de Reposição do dashboard cobrir o catálogo completo (hoje vê 86 de 681 SKUs) e usar o estoque real (Full do ML + CD do Tiny + trânsito), aposentando o relatório de compras do Tiny.

**Architecture:** Uma Edge Function nova (`sync-tiny-stock`) varre o catálogo e o estoque por depósito do Tiny com cursor retomável, gravando em duas tabelas novas. A RPC `get_replenishment_by_sku` troca a lista-base de "anúncios ML ativos" para catálogo unificado ML ∪ Tiny, e o estoque de "só Full" para "Full (ML) + CD (Tiny)". O núcleo de cálculo (EWMA, sazonalidade, demanda reprimida, lead time real) **não é tocado** — o problema nunca foi o cérebro, foi a comida.

**Tech Stack:** Deno (Supabase Edge Functions), PostgreSQL/plpgsql, TypeScript, Vitest, API Tiny v3, Supabase (`ckcdevcxgvueywivefgx`).

**Spec:** `docs/superpowers/specs/2026-08-04-reposicao-fonte-unica-design.md`

## Global Constraints

- **Organização de referência:** Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, seller/`ml_user_id` `1639558873`. Nunca completar UUID por prefixo — sempre `SELECT id, name FROM organizations`.
- **D-1:** item sem anúncio ML ativo → **apenas sinaliza**, `compra_sugerida = 0` e `tem_anuncio_ativo = false`. Nunca entra em compra automática.
- **D-2:** o estoque Full vem **sempre** de `ml_inventory_cache.available_quantity`. O Full do Tiny nunca é somado.
- **D-3:** compra desconta `estoque_full + estoque_cd + qtd_a_caminho`.
- **D-4:** escopo da lista = giro nos últimos 365 dias **OU** estoque total > 0.
- **D-5:** do Tiny conta **apenas o depósito CD Expedição** (nome exato medido na Task 1).
- **O núcleo de cálculo da RPC é INTOCÁVEL:** `ewma_sales`, `seasonal_index`, `best_rate_by_sku`, `sales_history_by_sku`, `lead_time_by_fornecedor`, `params`, `daily_qty_180d`, `window_sums_30d`, e a expressão de `compra` em `calc`. Mudança é só de alimentação.
- **Lint de migration (`src/lib/migrationSecurityLint.ts`) é gate:** todo `CREATE TABLE` em `public` precisa de `ENABLE ROW LEVEL SECURITY` no mesmo conjunto de arquivos; toda função `SECURITY DEFINER` precisa de `REVOKE` citando o nome.
- **Rate limit do Tiny:** ~60 req/min. Usar `RATE_MS = 1100` entre chamadas de detalhe e `PAGE_SLEEP_MS = 300` entre páginas de listagem — valores já em produção em `sync-tiny-costs`.
- **Nunca `DROP FUNCTION`** — apaga a ACL. Sempre `CREATE OR REPLACE`.
- **Nunca delete-all/insert-all** nas tabelas novas — abre janela em que a tela lê vazio e sugere comprar o mundo. Sempre upsert.
- **Testes:** `npx vitest run`. O `include` do vitest já cobre `supabase/functions/**/*.{test,spec}.ts`.
- **Baseline a preservar:** a suíte está em 60 arquivos / 837 testes verdes. `tsc` tem 191 erros pré-existentes — não aumentar.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_tiny_stock_tables.sql` | Tabelas `tiny_products`, `tiny_stock`, `tiny_sync_cursor` + RLS |
| `supabase/functions/sync-tiny-stock/depositos.ts` | **Puro.** Extrai saldo por depósito da resposta do Tiny |
| `supabase/functions/sync-tiny-stock/depositos.test.ts` | Testes do acima |
| `supabase/functions/sync-tiny-stock/cursor.ts` | **Puro.** Decide avançar/fechar/reiniciar a volta |
| `supabase/functions/sync-tiny-stock/cursor.test.ts` | Testes do acima — inclui a regra anti-bug do reset |
| `supabase/functions/sync-tiny-stock/index.ts` | Orquestra: auth, HTTP, persistência. Sem regra de negócio. |
| `supabase/migrations/<ts>_replenishment_v2.sql` | `CREATE OR REPLACE` da RPC com catálogo unificado |
| `docs/superpowers/plans/gate-86-skus.md` | Evidência do gate de não-regressão (Tasks 6 e 8) |

---

### Task 1: Medir a forma dos SKUs no Tiny (risco declarado da spec §8)

**Por que primeiro:** o sync de referência do nexo-mcp filtra `tipoVariacao === "P"` (produto pai). Os SKUs da operação são por tamanho/cor (`BS8991PTO41`, `12012422-PTO3360G`). Se no Tiny esses SKUs forem **variação** e não pai, aquele filtro descartaria exatamente o nível que interessa e **todo o resto do plano não fecha**.

**Files:**
- Create: `docs/superpowers/plans/tiny-shape-medicao.md`

**Interfaces:**
- Consumes: nada.
- Produces: dois fatos que as Tasks 3 e 5 consomem — (1) em qual nível vive o `sku` (`tipoVariacao` do registro que carrega o SKU da operação); (2) o **nome exato** do depósito CD, string literal, para D-5.

- [ ] **Step 1: Obter um token Tiny válido e listar produtos**

Rodar via MCP Supabase (`execute_sql`) para pegar o token sem imprimi-lo, e então chamar a API por `net.http_get`. Nunca ecoar o token.

```sql
select net.http_get(
  url := 'https://api.tiny.com.br/public-api/v3/produtos?situacao=A&limit=100&offset=0',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select tiny_access_token from public.ml_tokens
                                   where ml_user_id = '1639558873')
  )
) as request_id;
```

Depois ler o resultado:

```sql
select status_code, left(content, 4000) from net._http_response order by id desc limit 1;
```

- [ ] **Step 2: Localizar um SKU conhecido da operação e registrar seu `tipoVariacao`**

Procurar na resposta os SKUs `BS8991PTO41`, `12012422-PTO3360G`, `101110PTO3360M`. Para cada um encontrado, registrar: `id`, `sku`, `tipoVariacao`, e se o `sku` aparece no registro pai ou dentro de um array de variações.

Se nenhum aparecer na primeira página, paginar com `offset=100`, `200`, … até achar pelo menos dois.

- [ ] **Step 3: Medir a resposta de estoque e o nome exato do depósito**

Com o `id` de um produto achado no Step 2:

```sql
select net.http_get(
  url := 'https://api.tiny.com.br/public-api/v3/estoque/<TINY_ID>',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select tiny_access_token from public.ml_tokens
                                   where ml_user_id = '1639558873')
  )
) as request_id;
```

Registrar literalmente: o array `estoque.depositos[]` com `nome`, `saldo`, `desconsiderar`, e o `estoque.saldo` de topo. **O nome do depósito CD deve ser copiado como string exata** — é o valor de D-5 usado na RPC e na EF.

- [ ] **Step 4: Escrever a medição**

Criar `docs/superpowers/plans/tiny-shape-medicao.md` com: data/hora, as saídas brutas (sem token), e duas conclusões explícitas:
1. `NIVEL_DO_SKU`: `pai` ou `variacao` — e, se variação, qual campo do JSON carrega o SKU.
2. `DEPOSITO_CD`: a string exata do nome do depósito.

- [ ] **Step 5: Decidir se o plano segue como está**

- Se `NIVEL_DO_SKU = pai`: seguir o plano sem alteração.
- Se `NIVEL_DO_SKU = variacao`: **parar e reportar.** As Tasks 3 e 5 mudam (a varredura precisa descer nas variações, e `/estoque/{id}` pode ter que ser chamado por variação, o que muda o volume de requisições). Não improvisar — o desenho volta para revisão.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/tiny-shape-medicao.md
git commit -m "docs: medicao da forma dos SKUs e depositos no Tiny"
```

---

### Task 2: Tabelas de catálogo, estoque e cursor

**Files:**
- Create: `supabase/migrations/20260805100000_tiny_stock_tables.sql`

**Interfaces:**
- Consumes: `DEPOSITO_CD` da Task 1 (só como comentário documental aqui; o filtro vive na Task 7).
- Produces: tabelas `public.tiny_products`, `public.tiny_stock`, `public.tiny_sync_cursor`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Catálogo do Tiny: todo SKU, tenha ou não anúncio no ML.
CREATE TABLE IF NOT EXISTS public.tiny_products (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      text        NOT NULL,
  tiny_id         text        NOT NULL,
  sku             text        NOT NULL,
  nome            text,
  situacao        text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sku)
);

CREATE INDEX IF NOT EXISTS tiny_products_org_idx
  ON public.tiny_products (organization_id);

-- Estoque por depósito. Uma linha por (sku, depósito).
CREATE TABLE IF NOT EXISTS public.tiny_stock (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id      text        NOT NULL,
  sku             text        NOT NULL,
  deposito        text        NOT NULL,
  saldo           numeric     NOT NULL DEFAULT 0,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sku, deposito)
);

CREATE INDEX IF NOT EXISTS tiny_stock_org_sku_idx
  ON public.tiny_stock (organization_id, sku);

-- Cursor da varredura. Uma linha por (organization_id, ml_user_id).
CREATE TABLE IF NOT EXISTS public.tiny_sync_cursor (
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ml_user_id       text        NOT NULL,
  fase             text        NOT NULL DEFAULT 'catalogo',
  fila             jsonb       NOT NULL DEFAULT '[]',
  indice           integer     NOT NULL DEFAULT 0,
  volta_iniciada   timestamptz,
  volta_completa   timestamptz,
  erros            integer     NOT NULL DEFAULT 0,
  ultimo_erro      text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, ml_user_id)
);

ALTER TABLE public.tiny_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_stock       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiny_sync_cursor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tiny_products select"
  ON public.tiny_products FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "tiny_stock select"
  ON public.tiny_stock FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "tiny_sync_cursor select"
  ON public.tiny_sync_cursor FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- INSERT/UPDATE/DELETE: service_role apenas (a Edge Function escreve).
```

- [ ] **Step 2: Rodar o lint de segurança de migration**

Run: `npx vitest run src/lib/migrationSecurityLint.test.ts`
Expected: PASS. As três tabelas têm `ENABLE ROW LEVEL SECURITY` no mesmo arquivo; nenhuma função `SECURITY DEFINER` foi criada.

- [ ] **Step 3: Aplicar no banco**

Aplicar via MCP Supabase `apply_migration` com o conteúdo do arquivo, nome `tiny_stock_tables`.

- [ ] **Step 4: Conferir no banco**

```sql
select c.relname, c.relrowsecurity as rls, count(p.polname) as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname='public' and c.relname in ('tiny_products','tiny_stock','tiny_sync_cursor')
group by 1,2 order by 1;
```

Expected: três linhas, `rls = true`, `politicas = 1` em cada.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260805100000_tiny_stock_tables.sql
git commit -m "feat(tiny): tabelas de catalogo, estoque por deposito e cursor"
```

---

### Task 3: Extração de depósitos (módulo puro, TDD)

**Files:**
- Create: `supabase/functions/sync-tiny-stock/depositos.ts`
- Test: `supabase/functions/sync-tiny-stock/depositos.test.ts`

**Interfaces:**
- Consumes: `DEPOSITO_CD` e o formato de resposta medidos na Task 1.
- Produces: `export function extrairDepositos(resposta: unknown): SaldoDeposito[]` onde `interface SaldoDeposito { deposito: string; saldo: number }`. A Task 5 importa esta função.

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from "vitest";
import { extrairDepositos } from "./depositos";

describe("extrairDepositos", () => {
  it("extrai um saldo por deposito", () => {
    const r = { estoque: { saldo: 10, depositos: [
      { deposito: { nome: "CD Expedição", saldo: 7, desconsiderar: false } },
      { deposito: { nome: "Mercado Livre Fullfilment", saldo: 3, desconsiderar: false } },
    ] } };
    expect(extrairDepositos(r)).toEqual([
      { deposito: "CD Expedição", saldo: 7 },
      { deposito: "Mercado Livre Fullfilment", saldo: 3 },
    ]);
  });

  it("descarta deposito marcado como desconsiderar", () => {
    const r = { estoque: { saldo: 5, depositos: [
      { deposito: { nome: "CD Expedição", saldo: 5, desconsiderar: false } },
      { deposito: { nome: "Avaria", saldo: 9, desconsiderar: true } },
    ] } };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 5 }]);
  });

  it("cai no saldo de topo quando nao ha depositos", () => {
    const r = { estoque: { saldo: 4, depositos: [] } };
    expect(extrairDepositos(r)).toEqual([{ deposito: "(sem deposito)", saldo: 4 }]);
  });

  it("devolve vazio para resposta malformada", () => {
    expect(extrairDepositos(null)).toEqual([]);
    expect(extrairDepositos({})).toEqual([]);
  });

  it("trata saldo ausente como zero e nao quebra", () => {
    const r = { estoque: { depositos: [
      { deposito: { nome: "CD Expedição", desconsiderar: false } },
    ] } };
    expect(extrairDepositos(r)).toEqual([{ deposito: "CD Expedição", saldo: 0 }]);
  });
});
```

> **Ajuste obrigatório:** se a Task 1 mediu um envelope diferente (por exemplo `depositos[]` sem o wrapper `deposito`), corrigir estes fixtures para a forma **medida** antes de implementar. O teste existe para casar com a realidade, não o contrário.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/sync-tiny-stock/depositos.test.ts`
Expected: FAIL — `Failed to resolve import "./depositos"`.

- [ ] **Step 3: Implementar**

```ts
export interface SaldoDeposito {
  deposito: string;
  saldo: number;
}

const SEM_DEPOSITO = "(sem deposito)";

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza a resposta de GET /estoque/{id} do Tiny em saldos por deposito.
 * Depositos com `desconsiderar = true` sao descartados: nao sao vendaveis.
 * Sem depositos, usa o saldo de topo sob um rotulo unico.
 */
export function extrairDepositos(resposta: unknown): SaldoDeposito[] {
  if (!resposta || typeof resposta !== "object") return [];
  const estoque = (resposta as Record<string, unknown>).estoque;
  if (!estoque || typeof estoque !== "object") return [];

  const e = estoque as Record<string, unknown>;
  const lista = Array.isArray(e.depositos) ? e.depositos : [];

  const saldos: SaldoDeposito[] = [];
  for (const item of lista) {
    const d = (item as Record<string, unknown>)?.deposito ?? item;
    if (!d || typeof d !== "object") continue;
    const dep = d as Record<string, unknown>;
    if (dep.desconsiderar === true) continue;
    const nome = typeof dep.nome === "string" ? dep.nome.trim() : "";
    if (!nome) continue;
    saldos.push({ deposito: nome, saldo: num(dep.saldo) });
  }

  if (saldos.length === 0 && e.saldo !== undefined) {
    return [{ deposito: SEM_DEPOSITO, saldo: num(e.saldo) }];
  }
  return saldos;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/sync-tiny-stock/depositos.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sync-tiny-stock/depositos.ts supabase/functions/sync-tiny-stock/depositos.test.ts
git commit -m "feat(tiny): extracao pura de saldo por deposito"
```

---

### Task 4: Cursor retomável (módulo puro, TDD) — a correção do bug do nexo-mcp

**Files:**
- Create: `supabase/functions/sync-tiny-stock/cursor.ts`
- Test: `supabase/functions/sync-tiny-stock/cursor.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface EstadoCursor { fase: "catalogo" | "estoque"; fila: {tiny_id: string; sku: string}[]; indice: number; volta_iniciada: string | null; volta_completa: string | null; }`
  - `export function proximaAcao(estado: EstadoCursor | null, agora: Date): Acao` onde `type Acao = {tipo: "iniciar_volta"} | {tipo: "seguir_estoque"; de: number} | {tipo: "fechar_volta"}`.
  - A Task 5 importa `proximaAcao`.

- [ ] **Step 1: Escrever o teste falhando**

```ts
import { describe, it, expect } from "vitest";
import { proximaAcao, type EstadoCursor } from "./cursor";

const AGORA = new Date("2026-08-06T03:00:00Z");

function estado(over: Partial<EstadoCursor> = {}): EstadoCursor {
  return {
    fase: "estoque",
    fila: [{ tiny_id: "1", sku: "A" }, { tiny_id: "2", sku: "B" }],
    indice: 0,
    volta_iniciada: "2026-08-05T22:00:00Z",
    volta_completa: null,
    ...over,
  };
}

describe("proximaAcao", () => {
  it("sem estado, inicia uma volta", () => {
    expect(proximaAcao(null, AGORA)).toEqual({ tipo: "iniciar_volta" });
  });

  it("volta em andamento continua do indice", () => {
    expect(proximaAcao(estado({ indice: 1 }), AGORA))
      .toEqual({ tipo: "seguir_estoque", de: 1 });
  });

  // A REGRA QUE CORRIGE O BUG DO nexo-mcp:
  // la, o cursor reseta quando snapshot_date !== today e a volta nunca fecha.
  it("volta aberta que atravessa a meia-noite NAO reinicia", () => {
    const s = estado({ indice: 1, volta_iniciada: "2026-08-05T22:00:00Z" });
    expect(proximaAcao(s, new Date("2026-08-06T09:00:00Z")))
      .toEqual({ tipo: "seguir_estoque", de: 1 });
  });

  it("fila esgotada fecha a volta", () => {
    expect(proximaAcao(estado({ indice: 2 }), AGORA)).toEqual({ tipo: "fechar_volta" });
  });

  it("so reinicia depois que a volta anterior fechou", () => {
    const s = estado({ indice: 2, volta_completa: "2026-08-05T23:00:00Z" });
    expect(proximaAcao(s, AGORA)).toEqual({ tipo: "iniciar_volta" });
  });

  it("fase catalogo sempre inicia volta", () => {
    expect(proximaAcao(estado({ fase: "catalogo", fila: [] }), AGORA))
      .toEqual({ tipo: "iniciar_volta" });
  });

  it("fila vazia com volta aberta fecha em vez de girar em falso", () => {
    expect(proximaAcao(estado({ fase: "estoque", fila: [], indice: 0 }), AGORA))
      .toEqual({ tipo: "fechar_volta" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run supabase/functions/sync-tiny-stock/cursor.test.ts`
Expected: FAIL — `Failed to resolve import "./cursor"`.

- [ ] **Step 3: Implementar**

```ts
export interface ItemFila {
  tiny_id: string;
  sku: string;
}

export interface EstadoCursor {
  fase: "catalogo" | "estoque";
  fila: ItemFila[];
  indice: number;
  volta_iniciada: string | null;
  volta_completa: string | null;
}

export type Acao =
  | { tipo: "iniciar_volta" }
  | { tipo: "seguir_estoque"; de: number }
  | { tipo: "fechar_volta" };

/**
 * Decide o proximo passo da varredura.
 *
 * REGRA CENTRAL: a volta so reinicia depois de FECHAR por inteiro. Nunca por
 * virada de data. O sync equivalente do nexo-mcp reseta com
 * `snapshot_date !== today` e por isso cobre ~15% do catalogo e nunca fecha
 * uma volta. `agora` entra na assinatura para que essa regra seja testavel,
 * nao para decidir reset.
 */
export function proximaAcao(estado: EstadoCursor | null, _agora: Date): Acao {
  if (!estado) return { tipo: "iniciar_volta" };
  if (estado.fase === "catalogo") return { tipo: "iniciar_volta" };
  if (estado.volta_completa !== null) return { tipo: "iniciar_volta" };
  if (estado.indice >= estado.fila.length) return { tipo: "fechar_volta" };
  return { tipo: "seguir_estoque", de: estado.indice };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run supabase/functions/sync-tiny-stock/cursor.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sync-tiny-stock/cursor.ts supabase/functions/sync-tiny-stock/cursor.test.ts
git commit -m "feat(tiny): cursor retomavel que so reinicia apos fechar a volta"
```

---

### Task 5: Edge Function `sync-tiny-stock`

**Files:**
- Create: `supabase/functions/sync-tiny-stock/index.ts`

**Interfaces:**
- Consumes: `extrairDepositos` (Task 3), `proximaAcao` / `EstadoCursor` (Task 4), tabelas da Task 2.
- Produces: EF invocável por POST `{ ml_user_id }`, que responde JSON **descritivo** (nunca 202 vazio) com `{ ok, fase, processados, restantes, volta_completa }`.

- [ ] **Step 1: Escrever o `index.ts`**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extrairDepositos } from "./depositos.ts";
import { proximaAcao, type EstadoCursor, type ItemFila } from "./cursor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TINY_API     = "https://api.tiny.com.br/public-api/v3";
const RATE_MS        = 1100;  // ~60 req/min, igual ao sync-tiny-costs
const PAGE_SLEEP_MS  = 300;
const CAP_POR_CHAMADA   = 150;    // produtos de estoque por invocacao
const ORCAMENTO_MS      = 90_000; // teto auto-imposto, abaixo do limite da EF

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    body: JSON.stringify({ action: "refresh_token", refresh_token: tok.tiny_refresh_token, ml_user_id: mlUserId }),
  });
  const d = await resp.json();
  if (!resp.ok || !d.success) throw new Error(`Falha ao renovar token Tiny: ${d.error ?? "desconhecido"}`);
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
    const data = await tinyGet(token, "/produtos", { situacao: "A", limit: "100", offset: String(offset) });
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
        synced_at: new Date().toISOString(),
      }))
      .filter((l: { sku: string; tiny_id: string }) => l.sku !== "" && l.tiny_id !== "");

    if (linhas.length > 0) {
      const { error } = await sb.from("tiny_products")
        .upsert(linhas, { onConflict: "organization_id,sku" });
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
            organization_id: orgId, ml_user_id: mlUserId, sku: item.sku,
            deposito: s.deposito, saldo: s.saldo, synced_at: new Date().toISOString(),
          })),
          { onConflict: "organization_id,sku,deposito" },
        );
        if (error) throw new Error(`upsert tiny_stock: ${error.message}`);
      }
    } catch (e) {
      // Falha de um produto nao derruba o lote — registra e segue.
      erros++;
      ultimoErro = `${item.sku}: ${e instanceof Error ? e.message : String(e)}`;
      if (ultimoErro.includes("429")) { i++; break; }  // respeita o teto e retoma depois
    }
    await sleep(RATE_MS);
  }
  return { ate: i, erros, ultimoErro };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ml_user_id } = await req.json();
    if (!ml_user_id) return json({ ok: false, error: "ml_user_id obrigatorio" }, 400);

    const { data: tokenRow } = await sb.from("ml_tokens")
      .select("organization_id").eq("ml_user_id", ml_user_id).maybeSingle();
    if (!tokenRow?.organization_id) return json({ ok: false, error: "organizacao nao encontrada" }, 404);
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
      return json({ ok: true, fase: "catalogo", processados: fila.length, restantes: fila.length, volta_completa: false });
    }

    if (acao.tipo === "fechar_volta") {
      await sb.from("tiny_sync_cursor").update({ volta_completa: agora, updated_at: agora })
        .eq("organization_id", orgId).eq("ml_user_id", ml_user_id);
      return json({ ok: true, fase: "fechada", processados: 0, restantes: 0, volta_completa: true });
    }

    const fila = (estado!.fila ?? []) as ItemFila[];
    const r = await varrerEstoque(token, orgId, ml_user_id, fila, acao.de);
    await sb.from("tiny_sync_cursor").update({
      indice: r.ate,
      erros: (errosAntes ?? 0) + r.erros,
      ultimo_erro: r.ultimoErro, updated_at: agora,
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
```

- [ ] **Step 2: Checar tipos e rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS. A suíte deve estar em 837 + 12 = **849 testes**, todos verdes.

- [ ] **Step 3: Publicar a EF**

Deploy via MCP Supabase `deploy_edge_function` (projeto `ckcdevcxgvueywivefgx`, slug `sync-tiny-stock`), ou CLI com `SUPABASE_ACCESS_TOKEN=$(cat /root/.supabase-token-mcp)`.

> **Se o deploy falhar por credencial:** parar e reportar. Não improvisar. `/root/.supabase-token` está morto (401); o vivo é `/root/.supabase-token-mcp`.

- [ ] **Step 4: Rodar a primeira volta manualmente e conferir**

Invocar repetidamente até `volta_completa: true`, conferindo o cursor entre as chamadas:

```sql
select fase, indice, jsonb_array_length(fila) as fila,
       volta_iniciada, volta_completa, erros, left(coalesce(ultimo_erro,''),120)
from public.tiny_sync_cursor;
```

Expected ao final: `volta_completa` preenchida, `indice = jsonb_array_length(fila)`.

```sql
select count(distinct sku) as skus, count(*) as linhas, count(distinct deposito) as depositos
from public.tiny_stock where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';
```

Expected: `skus` na ordem de centenas (comparável aos 681 de `ml_product_costs`), `depositos` listando o CD e o Full.

- [ ] **Step 5: Provar idempotência (spec §7.4)**

Guardar a impressão digital da volta que acabou de fechar:

```sql
create temp table snap_1 as
select sku, deposito, saldo from public.tiny_stock
where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';

select count(*) as linhas, sum(saldo) as soma,
       md5(string_agg(sku || '|' || deposito || '|' || saldo, ',' order by sku, deposito)) as digest
from snap_1;
```

Forçar uma segunda volta completa (o cursor já está com `volta_completa` preenchida, então a próxima invocação reinicia) e invocar até fechar de novo. Então:

```sql
select count(*) as linhas, sum(saldo) as soma,
       md5(string_agg(sku || '|' || deposito || '|' || saldo, ',' order by sku, deposito)) as digest
from public.tiny_stock
where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';
```

Expected: `linhas` e `digest` **idênticos** aos de `snap_1`, salvo saldo que mudou de verdade no Tiny entre as duas voltas. Divergência de `linhas` significa upsert com chave errada — corrigir antes de seguir.

- [ ] **Step 6: Provar retomada no meio da volta (spec §7.4)**

```sql
-- interrompe artificialmente: devolve o cursor para o meio da fila
update public.tiny_sync_cursor
set indice = 10, volta_completa = null
where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';
```

Invocar a EF uma vez e conferir que `indice` avançou **a partir de 10** (não de 0, não pulou):

```sql
select indice from public.tiny_sync_cursor
where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';
```

Expected: `indice > 10`. Voltar a invocar até fechar a volta.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/sync-tiny-stock/index.ts
git commit -m "feat(tiny): edge function de varredura de estoque por deposito"
```

---

### Task 6: Capturar o baseline dos 86 SKUs (ANTES de tocar na RPC)

**Files:**
- Create: `docs/superpowers/plans/gate-86-skus.md`

**Interfaces:**
- Consumes: RPC atual, ainda não modificada.
- Produces: tabela `public.gate_reposicao_baseline` com o retorno atual, consumida pela Task 8.

> **Esta task precisa rodar antes da Task 7.** Depois que a RPC mudar, o baseline é irrecuperável.

- [ ] **Step 1: Materializar o baseline**

```sql
create table if not exists public.gate_reposicao_baseline as
select sku_code, item_id, variation_id, sku_stock, venda_dia,
       compra_sugerida, gatilho_ativo, venda_dia_origem
from public.get_replenishment_by_sku(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid, 30, 1.0, true);
```

- [ ] **Step 2: Registrar o tamanho e a soma**

```sql
select count(*) as linhas,
       count(*) filter (where compra_sugerida > 0) as com_compra,
       sum(compra_sugerida) as total_unidades
from public.gate_reposicao_baseline;
```

Colar a saída bruta em `gate-86-skus.md`, com data/hora e os parâmetros usados.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/gate-86-skus.md
git commit -m "test: baseline dos SKUs de reposicao antes da mudanca da RPC"
```

---

### Task 7: RPC v2 — catálogo unificado e estoque Full + CD

**Files:**
- Create: `supabase/migrations/20260805110000_replenishment_v2.sql`

**Interfaces:**
- Consumes: `tiny_products`, `tiny_stock` (Task 2, populadas na Task 5); `DEPOSITO_CD` (Task 1).
- Produces: `get_replenishment_by_sku` com 5 colunas novas no `RETURNS TABLE`: `estoque_full integer`, `estoque_cd integer`, `tem_anuncio_ativo boolean`, `origem_catalogo text`, `divergencia_full integer`.

- [ ] **Step 1: Partir da definição atual**

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='get_replenishment_by_sku';
```

Salvar a saída. A migration é essa definição com as alterações abaixo — **`CREATE OR REPLACE`, nunca `DROP`** (apaga a ACL).

- [ ] **Step 2: Trocar a CTE base**

Substituir `inventory_by_sku` por três CTEs. O resto do corpo continua consumindo `inventory_by_sku` com o mesmo nome e as mesmas colunas, **mais** as novas.

```sql
  ml_by_sku AS MATERIALIZED (
    -- Identico ao inventory_by_sku de hoje: mantem o vinculo com o anuncio.
    SELECT i.item_id, i.title, i.brand, i.logistic_type, v.variation_id,
           v.attribute_combinations, v.available_quantity AS estoque_full,
           v.seller_custom_field AS sku_code
    FROM ml_inventory_cache i CROSS JOIN LATERAL jsonb_to_recordset(i.variations) AS v(
      variation_id TEXT, attribute_combinations JSONB,
      available_quantity INTEGER, sold_quantity INTEGER, seller_custom_field TEXT)
    WHERE i.organization_id = p_org_id AND i.status = 'active'
      AND i.has_variations = TRUE AND jsonb_array_length(i.variations) > 0
    UNION ALL
    SELECT i.item_id, i.title, i.brand, i.logistic_type, NULL::TEXT, NULL::JSONB,
           i.available_quantity, i.seller_custom_field
    FROM ml_inventory_cache i
    WHERE i.organization_id = p_org_id AND i.status = 'active'
      AND (i.has_variations = FALSE OR jsonb_array_length(i.variations) = 0)
  ),
  cd_by_sku AS MATERIALIZED (
    -- D-5: apenas o deposito CD. O Full do Tiny e ignorado: vem do ML (D-2).
    SELECT s.sku AS sku_code, SUM(s.saldo)::INTEGER AS estoque_cd
    FROM tiny_stock s
    WHERE s.organization_id = p_org_id
      AND s.deposito = '<DEPOSITO_CD_DA_TASK_1>'
    GROUP BY s.sku
  ),
  full_tiny_by_sku AS MATERIALIZED (
    -- So para exibir divergencia (secao 6 da spec). Nunca entra no calculo.
    SELECT s.sku AS sku_code, SUM(s.saldo)::INTEGER AS full_tiny
    FROM tiny_stock s
    WHERE s.organization_id = p_org_id
      AND s.deposito ILIKE '%fullfilment%'
    GROUP BY s.sku
  ),
  inventory_by_sku AS MATERIALIZED (
    SELECT m.item_id, m.title, m.brand, m.logistic_type, m.variation_id,
           m.attribute_combinations, m.sku_code,
           m.estoque_full,
           COALESCE(cd.estoque_cd, 0) AS estoque_cd,
           (m.estoque_full + COALESCE(cd.estoque_cd, 0)) AS sku_stock,
           TRUE AS tem_anuncio_ativo,
           'ml'::TEXT AS origem_catalogo,
           CASE WHEN ft.full_tiny IS NULL THEN NULL
                ELSE ft.full_tiny - m.estoque_full END AS divergencia_full
    FROM ml_by_sku m
    LEFT JOIN cd_by_sku cd ON cd.sku_code = m.sku_code
    LEFT JOIN full_tiny_by_sku ft ON ft.sku_code = m.sku_code
    UNION ALL
    -- D-1: SKU que so existe no Tiny entra para SINALIZAR.
    SELECT NULL::TEXT, t.nome, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::JSONB,
           t.sku, 0, COALESCE(cd.estoque_cd, 0), COALESCE(cd.estoque_cd, 0),
           FALSE, 'tiny'::TEXT, NULL::INTEGER
    FROM tiny_products t
    LEFT JOIN cd_by_sku cd ON cd.sku_code = t.sku
    WHERE t.organization_id = p_org_id
      AND NOT EXISTS (SELECT 1 FROM ml_by_sku m WHERE m.sku_code = t.sku)
  ),
```

- [ ] **Step 3: Fazer o join de vendas funcionar sem `item_id`**

`row_sales` hoje casa `orders` por `item_id` + `variation_id`. SKU só-Tiny não tem `item_id`. Adicionar o caminho por SKU:

```sql
  row_sales AS (
    SELECT inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type,
           inv.attribute_combinations, inv.sku_code, inv.sku_stock,
           inv.estoque_full, inv.estoque_cd, inv.tem_anuncio_ativo,
           inv.origem_catalogo, inv.divergencia_full,
           COALESCE(SUM(o.quantidade), 0)::NUMERIC AS total_qty
    FROM inventory_by_sku inv
    LEFT JOIN orders o
      ON o.organization_id = p_org_id
     AND o.data_pedido::timestamptz::date >= v_cutoff
     AND o.status = 'paid'
     AND (
          (inv.item_id IS NOT NULL
            AND o.item_id = inv.item_id
            AND (o.variation_id = inv.variation_id
                 OR (inv.variation_id IS NULL AND o.variation_id = '')))
       OR (inv.item_id IS NULL AND o.sku = inv.sku_code)
     )
    GROUP BY inv.item_id, inv.variation_id, inv.title, inv.brand, inv.logistic_type,
             inv.attribute_combinations, inv.sku_code, inv.sku_stock,
             inv.estoque_full, inv.estoque_cd, inv.tem_anuncio_ativo,
             inv.origem_catalogo, inv.divergencia_full
  ),
```

Aplicar o mesmo predicado nas CTEs que também casam `orders` por item: `sales_history_by_sku` e `daily_qty_180d`.

- [ ] **Step 4: Zerar a compra de quem não tem anúncio (D-1) e aplicar o escopo (D-4)**

Em `calc`, envolver a expressão existente de `compra` — **sem alterar a fórmula interna**:

```sql
      (CASE WHEN NOT b.tem_anuncio_ativo THEN 0
            ELSE ( <a expressao de compra que ja existe, sem uma virgula mudada> )
       END) AS compra
```

E no `SELECT` final, aplicar D-4:

```sql
  WHERE (c.venda_base > 0 OR c.sku_stock > 0 OR c.dias_desde_ultima_venda <= 365)
```

- [ ] **Step 5: Adicionar as colunas novas ao `RETURNS TABLE` e ao `SELECT` final**

Acrescentar ao final da lista de colunas, preservando a ordem existente:

```sql
    c.estoque_full, c.estoque_cd, c.tem_anuncio_ativo,
    c.origem_catalogo, c.divergencia_full
```

- [ ] **Step 6: Aplicar e conferir que não quebrou a assinatura**

Aplicar via `apply_migration`. Depois:

```sql
select public.get_replenishment_by_sku(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid, 30, 1.0, true) limit 1;
```

Expected: retorna sem erro.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805110000_replenishment_v2.sql
git commit -m "feat(reposicao): catalogo unificado ML+Tiny e estoque Full+CD"
```

---

### Task 8: Gate de não-regressão e provas positivas

**Files:**
- Modify: `docs/superpowers/plans/gate-86-skus.md`

**Interfaces:**
- Consumes: `gate_reposicao_baseline` (Task 6), RPC v2 (Task 7).
- Produces: veredito escrito. **Bloqueante:** diferença não explicada interrompe a entrega.

- [ ] **Step 1: Comparar antes × depois**

```sql
with novo as (
  select sku_code, compra_sugerida, sku_stock
  from public.get_replenishment_by_sku(
    '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid, 30, 1.0, true)
)
select b.sku_code, b.compra_sugerida as antes, n.compra_sugerida as depois,
       b.sku_stock as estoque_antes, n.sku_stock as estoque_depois
from public.gate_reposicao_baseline b
join novo n on n.sku_code = b.sku_code
where b.compra_sugerida is distinct from n.compra_sugerida
order by abs(coalesce(n.compra_sugerida,0) - coalesce(b.compra_sugerida,0)) desc;
```

Expected: **vazio**, ou apenas linhas em que `estoque_depois > estoque_antes` — a única diferença legítima é o CD sendo descontado (D-3).

- [ ] **Step 2: Enumerar cada exceção, uma a uma**

Para cada linha do Step 1, confirmar que a diferença é exatamente o saldo de CD:

```sql
select sku, deposito, saldo from public.tiny_stock
where organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7'
  and sku = '<SKU_DA_DIFERENCA>';
```

**Diferença sem saldo de CD que a explique = regressão. Parar e reportar.**

- [ ] **Step 3: Prova positiva — os SKUs que sumiam**

```sql
select sku_code, tem_anuncio_ativo, origem_catalogo, compra_sugerida, sku_stock, venda_dia
from public.get_replenishment_by_sku(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid, 30, 1.0, true)
where sku_code in ('101110PTO3360M','13011457PTO3360GG','K9PMCMS7000SOR3943');
```

Expected: três linhas, `tem_anuncio_ativo = false`, `compra_sugerida = 0` (D-1: sinaliza, não compra).

- [ ] **Step 4: Prova de completude**

```sql
select count(*) as linhas,
       count(*) filter (where tem_anuncio_ativo) as com_anuncio,
       count(*) filter (where not tem_anuncio_ativo) as sinalizar
from public.get_replenishment_by_sku(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7'::uuid, 30, 1.0, true);
```

Expected: `linhas` na faixa de 100–250 (D-4), contra 86 antes.

- [ ] **Step 5: Escrever o veredito e limpar o baseline**

Registrar em `gate-86-skus.md` as saídas brutas dos Steps 1–4 e o veredito por prova. Depois:

```sql
drop table if exists public.gate_reposicao_baseline;
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/gate-86-skus.md
git commit -m "test: gate de nao-regressao verde e provas positivas da reposicao"
```

---

### Task 9: Frescor, divergência e cron

**Files:**
- Create: `supabase/migrations/20260805120000_tiny_stock_cron.sql`
- Modify: `src/hooks/useReplenishmentBySku.ts` — interface `ReplenishmentSkuRow` (linha ~20) e o mapeamento (linha ~130); função de agrupamento `GroupedReplenishmentRow` (linha ~72)
- Modify: `src/components/mercadolivre/ReplenishmentSkuTable.tsx` — coluna de origem e aviso de divergência
- Modify: `src/pages/mercadolivre/MLCompras.tsx` — faixa de frescor

**Interfaces:**
- Consumes: `tiny_sync_cursor.volta_completa`, colunas novas da RPC v2.
- Produces: aviso de estoque desatualizado, marcação de divergência, e a seção "sinalizar".

> **Armadilha identificada na revisão do plano:** `useReplenishmentBySku.ts` agrupa
> as linhas **por anúncio** (`GroupedReplenishmentRow`, somando
> `total_compra_sugerida` por `item_id`). SKU que só existe no Tiny tem
> `item_id = null` — se todos caírem no mesmo balde nulo, viram uma linha só.
> O agrupamento precisa usar `item_id` quando existe e **cair para `sku_code`**
> quando é nulo. Sem isso, os itens de "sinalizar" colapsam numa linha e a
> entrega parece funcionar mas está errada.

- [ ] **Step 1: Agendar a varredura**

```sql
select cron.schedule(
  'tiny-stock-tick', '*/10 * * * *',
  $$select net.http_post(
      url := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-stock',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'service_role_key')),
      body := jsonb_build_object('ml_user_id','1639558873')
    );$$
);
```

> Uma volta são ~681 produtos ÷ 150 por invocação ≈ 5 invocações. A cada 10 min, fecha em ~50 min e fica ociosa até a próxima volta. Confirmar o nome do segredo no vault antes de aplicar — o padrão deste projeto é `service_role_key` (Pattern B).

- [ ] **Step 2: Expor o frescor**

```sql
create or replace view public.tiny_stock_health as
select organization_id, ml_user_id, volta_completa,
       (now() - volta_completa) > interval '48 hours' as desatualizado,
       indice, jsonb_array_length(fila) as total_fila, erros, ultimo_erro
from public.tiny_sync_cursor;
```

- [ ] **Step 3: Estender o tipo do hook**

Em `src/hooks/useReplenishmentBySku.ts`, acrescentar à interface `ReplenishmentSkuRow`:

```ts
  estoque_full:       number;
  estoque_cd:         number;
  tem_anuncio_ativo:  boolean;
  origem_catalogo:    "ml" | "tiny";
  divergencia_full:   number | null;
```

E no mapeamento (junto de `sku_stock: Number(r.sku_stock)`):

```ts
    estoque_full:      Number(r.estoque_full ?? 0),
    estoque_cd:        Number(r.estoque_cd ?? 0),
    tem_anuncio_ativo: Boolean(r.tem_anuncio_ativo),
    origem_catalogo:   (r.origem_catalogo === "tiny" ? "tiny" : "ml"),
    divergencia_full:  r.divergencia_full == null ? null : Number(r.divergencia_full),
```

- [ ] **Step 4: Corrigir o agrupamento para SKU sem anúncio**

Na função que monta `GroupedReplenishmentRow`, a chave de agrupamento passa a ser:

```ts
const chave = row.item_id ?? `sku:${row.sku_code}`;
```

Aplicar em **todos** os pontos que hoje agrupam por `item_id`. Sem isso, todos os
SKUs só-Tiny colapsam numa linha única (ver armadilha acima).

- [ ] **Step 5: Escrever o teste do agrupamento**

Criar em `src/hooks/useReplenishmentBySku.test.ts` (ou estender o existente):

```ts
it("nao colapsa SKUs sem item_id numa linha so", () => {
  const linhas = [
    { item_id: null, sku_code: "A", compra_sugerida: 0, tem_anuncio_ativo: false },
    { item_id: null, sku_code: "B", compra_sugerida: 0, tem_anuncio_ativo: false },
    { item_id: "MLB1", sku_code: "C", compra_sugerida: 5, tem_anuncio_ativo: true },
  ] as unknown as ReplenishmentSkuRow[];
  expect(agrupar(linhas)).toHaveLength(3);
});
```

Run: `npx vitest run src/hooks/useReplenishmentBySku.test.ts`
Expected: FAIL antes do Step 4, PASS depois.

- [ ] **Step 6: Aviso na tela**

Em `src/pages/mercadolivre/MLCompras.tsx`, quando `desatualizado = true`:
`"Estoque do CD desatualizado — última varredura completa em <data>."`

Em `src/components/mercadolivre/ReplenishmentSkuTable.tsx`, quando
`divergencia_full` não for nulo nem zero, marcar a linha:
`"Tiny diz <estoque_full + divergencia_full>, ML diz <estoque_full> — usando o ML."`

E separar visualmente os itens com `tem_anuncio_ativo = false` numa seção
**"Esgotados sem anúncio — decidir reativar"**, sem coluna de compra (D-1).

- [ ] **Step 7: Rodar a suíte e o lint**

Run: `npx vitest run`
Expected: PASS, sem teste novo quebrado.

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: ≤ 191 (baseline). Não aumentar.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260805120000_tiny_stock_cron.sql src/
git commit -m "feat(reposicao): cron da varredura, guarda de frescor e aviso de divergencia"
```

---

## Conferência final do Wesley

Depois da Task 9, abrir a tela de Reposição com a Pé Vermeio e confirmar:

1. A lista cobre os SKUs que ele vê no Tiny — em especial os que tinham sumido.
2. Os itens sem anúncio ativo aparecem como **sinalizar**, sem número de compra.
3. Onde há saldo no CD, a compra sugerida veio descontada.
4. Um SKU da linha Champion (`12012422-*`) mostra a divergência Tiny × ML, se ainda houver.
5. O número sugerido continua maior que o do Tiny nos campeões de giro (é a correção de demanda reprimida fazendo efeito).

---

## Notas de execução

- **Não trocar de branch nem criar worktree sem avisar.** A fase 211 roda na mesma árvore; um `checkout` puxa o tapete do outro agente.
- **Ordem obrigatória:** Task 1 → 2 → 3 → 4 → 5 → **6 antes de 7** → 7 → 8 → 9.
- Task 1 pode reprovar o desenho (§8 da spec). Se `NIVEL_DO_SKU = variacao`, parar e reportar.
- Task 8 é bloqueante: diferença não explicada por saldo de CD interrompe a entrega.
