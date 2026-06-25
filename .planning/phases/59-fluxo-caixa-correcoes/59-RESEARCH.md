# Phase 59: Fluxo de Caixa Correções — Research

**Researched:** 2026-06-25
**Domain:** PostgreSQL RPC rewrite (window function CASE) + Deno Edge Function debug/fix (pg_net timeout, upsert observability)
**Confidence:** HIGH (all findings verified against real codebase files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Projeção — regra final (2 partes):
  1. Primeiros 7 dias a partir de hoje: linha de projeção usa APENAS recebimentos confirmados (d.inc), sem nenhuma entrada de previsão/média.
  2. Do 8º dia em diante: aplica a média 15d (v_sma) SOMENTE nos dias que não tiverem nenhum recebimento confirmado (d.inc = 0). Dias com d.inc > 0 mantêm o valor real.
- Contas a pagar: foco é fazer persistir (synced_at crescendo), não mudar cadência (6h já atende o "≥1x/dia").
- Fix não pode mexer na coluna accumulated_balance (linha confirmada verde) — só accumulated_balance_sma muda.
- Cron atualizado via migration versionada (NUNCA via SQL Editor — regra feedback_no_drift_via_sql_editor).
- Reconciliação ao centavo com a DFC do Wesley (Phase 49) não pode quebrar.

### Claude's Discretion
- Estratégia de fix do timeout: timeout_milliseconds no net.http_post OU padrão waitUntil (202 imediato + fundo). Research recomenda o melhor.
- Indicador de "última atualização" na UI (opcional) — decidir no plano.

### Deferred Ideas (OUT OF SCOPE)
- Mudar a base/fórmula do v_sma (já travada).
- Mexer no Simulador (Phase 50) — herda a correção sem alteração própria.
- Rotação de segredos (item separado, já pendente).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CASHFIX-01 | Gráfico de Fluxo de Caixa não infla os primeiros dias com previsão | Seção "Issue 1 — Projeção": SQL exato validado contra nomes reais de coluna (d.inc, d.exp, d.d_date, v_sma, v_today, v_initial); CASE expression verificada compilável |
| CASHFIX-02 | Contas a pagar volta a sincronizar com o Tiny ≥1x/dia, com persistência real | Seção "Issue 2 — Sync": 4 suspects de silent-no-write enumerados com file:line; recomendação de timeout vs waitUntil fundamentada |
</phase_requirements>

---

## Summary

Esta fase corrige duas regressões reais no dashboard de Fluxo de Caixa (Phase 49, `ckcdevcxgvueywivefgx`).

**Issue 1 (CASHFIX-01):** A RPC `get_cashflow` (versão final = migration `20260619020000_cashflow_brt_timezone.sql`) usa um escalar `v_sma` aplicado de forma uniforme em todos os dias da série — incluindo os primeiros 7 dias onde os recebimentos do MP já estão confirmados em `cash_inflows`. O fix é cirúrgico: substituir `v_sma` no SUM da coluna `accumulated_balance_sma` por um CASE que usa `d.inc` nos dias 1-7 e `v_sma` apenas nos buracos futuros (d.inc = 0) a partir do 8º dia. A coluna `daily_projection` (tooltip "+ Previsão") também deve receber o mesmo tratamento para consistência com a linha âmbar. Nenhuma alteração de frontend é necessária — os nomes de colunas não mudam.

**Issue 2 (CASHFIX-02):** O cron `sync-tiny-payables-6h` está ativo e marcado "succeeded", mas a EF leva ~15,7s enquanto o `net.http_post` abandona a conexão em ~2-5s (timeout default). Esse é o bloqueio primário de entrega. Paralelamente, mesmo quando a EF completou com 200 em 15,7s (log de hoje às 12:00), `cash_outflows.synced_at` permanece preso em 2026-06-18 — indicando um segundo problema independente dentro da EF. Os quatro suspects de silent-no-write são enumerados abaixo com localização exata. A recomendação de fix é o padrão `EdgeRuntime.waitUntil` (responde 202 imediato, processa em background) por ser mais robusto que aumentar o timeout do pg_net e não requerer nova migration só para ajustar um número.

**Primary recommendation:** Criar uma migration `2026059000000_cashflow_projection_7d_rule.sql` (fix da RPC) e atualizar a EF `sync-tiny-payables` com observabilidade e padrão waitUntil + debug ativo antes de adicionar migration de cron.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lógica de projeção 7d | Database (RPC) | — | `get_cashflow` vive no Postgres; frontend só consome, não recalcula |
| Tooltip "+ Previsão" (daily_projection) | Database (RPC) | Frontend (read-only) | Coluna já exposta; frontend lê `point.daily_projection` sem lógica própria |
| Sync contas a pagar | Edge Function (Deno) | pg_cron (disparo) | EF `sync-tiny-payables` processa, pg_cron só enfileira o HTTP POST |
| Timeout de disparo | pg_cron / pg_net | — | O `net.http_post` da migration controla o timeout; EF não controla quanto tempo o pg_net espera |
| Persistência (upsert) | Edge Function (Deno) | Supabase client | EF faz o upsert; `sb.from("cash_outflows").upsert(...)` |

---

## Standard Stack

Nenhuma nova dependência — fase usa o stack existente do projeto.

| Component | File | Version/Pattern |
|-----------|------|----------------|
| RPC Postgres | `supabase/migrations/` | plpgsql, SECURITY INVOKER, CREATE OR REPLACE |
| Edge Function | `supabase/functions/sync-tiny-payables/index.ts` | Deno, `serve()` from `deno.land/std@0.168.0` |
| pg_net | migration de cron | `net.http_post(url, body, params, headers, timeout_milliseconds)` |
| EdgeRuntime.waitUntil | EF Deno | global `EdgeRuntime` disponível no runtime Supabase Edge (sem import) |

**Instalação:** zero — sem novos pacotes.

---

## Package Legitimacy Audit

> Sem novos pacotes externos nesta fase.

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious SUS:** none

---

## Issue 1 — Projeção: Análise Completa

### Versão Autoritativa da RPC

**Arquivo mais recente:** `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` [VERIFIED: codebase read]

Esta é a versão definitiva. Empregou `CREATE OR REPLACE` (sem DROP), então preserva a assinatura completa da `20260619010000`. As três migrations formam uma cadeia:

| Migration | Delta | Autoritativa? |
|-----------|-------|---------------|
| `20260619000000_cashflow_sma_bruta_menos_taxas.sql` | Base: 5 cols, CURRENT_DATE cru | Superada |
| `20260619010000_cashflow_daily_projection.sql` | +coluna `daily_projection`, DROP+CREATE | Superada |
| `20260619020000_cashflow_brt_timezone.sql` | `CREATE OR REPLACE`, v_today BRT, preserva daily_projection | **ATUAL — usar esta** |

### Definição Atual da RPC (campos críticos)

```sql
-- supabase/migrations/20260619020000_cashflow_brt_timezone.sql, linhas 28-76
DECLARE
  v_initial NUMERIC := 0;
  v_today   DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;  -- BRT, linha 29
  v_start   DATE;
  v_sma     NUMERIC := 0;
BEGIN
  v_start := GREATEST(p_start_date, v_today);  -- futuro-only, linha 34

  -- v_sma: média das últimas 15d (excluindo hoje), linha 36-42
  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  -- CTE daily, linhas 46-71:
  --   days: generate_series(v_start, p_end_date)
  --   inc: SUM(cash_inflows.net_amount) GROUP BY release_date → coluna `inc` (alias COALESCE)
  --   exp: SUM(cash_outflows.amount)   GROUP BY outflow_date  → coluna `exp` (alias COALESCE)
  --   daily: JOIN inc+exp em d_date → d.inc, d.exp

  -- SELECT final, linhas 69-76:
  SELECT d.d_date,
         d.inc,                                                                -- daily_income
         d.exp,                                                                -- daily_expense
         v_sma,                                                                -- daily_projection ← PROBLEMA: v_sma constante em todos os dias
         (d.inc - d.exp),                                                      -- daily_balance
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,     -- accumulated_balance (NÃO MUDAR)
         (v_initial + SUM(v_sma - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC      -- accumulated_balance_sma ← PROBLEMA: v_sma uniforme
  FROM daily d ORDER BY d.d_date ASC;
```

### Nomes de Coluna Confirmados (CTE `daily`)

| Alias no CTE | Origem | Tipo |
|---|---|---|
| `d.d_date` | `generate_series(...) gs::date` | DATE |
| `d.inc` | `COALESCE(i.amt, 0)` onde `i.amt = SUM(cash_inflows.net_amount)` | NUMERIC |
| `d.exp` | `COALESCE(e.amt, 0)` onde `e.amt = SUM(cash_outflows.amount)` | NUMERIC |
| `v_sma` | escalar DECLARE, fixo para todos os dias | NUMERIC |
| `v_today` | `(now() AT TIME ZONE 'America/Sao_Paulo')::date` | DATE |
| `v_initial` | `financial_settings.initial_balance` | NUMERIC |

**Verificação de nomes:** O CONTEXT.md usa `d.inc`, `d.exp`, `d.d_date` — exatamente os aliases do CTE real. Zero mismatch. [VERIFIED: codebase read]

### SQL Fix Validado para accumulated_balance_sma

```sql
-- Substituir na linha 76 de 20260619020000:
-- DE:
(v_initial + SUM(v_sma - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC

-- PARA:
(v_initial + SUM(
  (CASE
     WHEN d.d_date <= v_today + 7 THEN d.inc   -- dias 1-7: só confirmado, sem previsão
     WHEN d.inc > 0               THEN d.inc   -- dia 8+, COM recebimento: usa o real
     ELSE v_sma                                -- dia 8+, SEM recebimento: preenche com média
   END)
  - d.exp
) OVER (ORDER BY d.d_date ASC))::NUMERIC AS accumulated_balance_sma
```

**Verificação do threshold `d.inc > 0`:** Como `d.inc = COALESCE(i.amt, 0)`, o valor mínimo real é 0 (sem entrada) ou o sum de `net_amount` (sempre positivo para liberações MP). O threshold `> 0` é correto — não há entradas negativas em `cash_inflows`. Não há risco de arredondamento com NUMERIC (sem float imprecision).

**Verificação do "dia 8":** `d.d_date <= v_today + 7` → dias 1-7 caem no primeiro CASE. O dia `v_today + 8` cai no `WHEN d.inc > 0` ou no `ELSE` — conforme a regra do Wesley. Correto.

### Fix de daily_projection (tooltip "+ Previsão")

A coluna `daily_projection` hoje é `v_sma` — o escalar constante. Para manter consistência entre o tooltip e a linha âmbar, ela deve refletir a entrada projetada real usada em cada dia:

```sql
-- DE (linha 72 da 20260619020000):
v_sma,   -- daily_projection

-- PARA:
(CASE
   WHEN d.d_date <= v_today + 7 THEN 0       -- dias 1-7: sem previsão (só confirmado)
   WHEN d.inc > 0               THEN 0       -- dia 8+ COM recebimento: previsão = 0 (não usada)
   ELSE v_sma                                -- dia 8+ SEM recebimento: previsão = média
 END) AS daily_projection,
```

**Justificativa:** O tooltip mostra "+ Previsão: R$ X" — se a linha âmbar usa `d.inc` (não `v_sma`) nos dias 1-7 e dias com recebimento, exibir v_sma no tooltip seria enganoso. Com o fix, `daily_projection = 0` nesses dias e o tooltip mostrará "R$ 0,00", o que é correto (sem entrada de previsão adicionada).

**Frontend:** Nenhuma alteração necessária. [VERIFIED: codebase read]
- `useCashFlowData.ts` mapeia `r.daily_projection` para `daily_projection: number` (linha 75) — consome o que a RPC retornar.
- `CashFlowChart.tsx` exibe `point.daily_projection` no tooltip (linha 69) sem lógica própria.
- Coluna `accumulated_balance_sma` mantém o mesmo nome — Legend e dataKey intocados.

**Legenda/texto a atualizar:**
- `CashFlowChart.tsx` linha 190: `"Linha âmbar tracejada = projeção pela média de vendas dos últimos 15 dias"` → deve ser atualizada para `"Linha âmbar tracejada = projeção: confirmado nos primeiros 7 dias; média 15d onde não há recebimento confirmado a partir do 8º dia"`.
- `CashFlowChart.tsx` linha 238: `formatter` de Legend, label `"accumulated_balance_sma"` → `"Projeção média de vendas 15d"` → atualizar para `"Projeção (confirmado 7d + média)"`.
- `useCashFlowData.ts` JSDoc linha 36-38 (descrição de `accumulated_balance_sma`) → atualizar.

### accumulated_balance — INTOCADO

A coluna confirmada (linha verde) usa `SUM(d.inc - d.exp)` — não é alterada. O fix só afeta a expressão de `accumulated_balance_sma`. A reconciliação ao centavo com a DFC do Wesley é preservada.

---

## Issue 2 — Sync Contas a Pagar: Análise Completa

### Diagnóstico de Causa-Raiz

**Bloqueio primário (confirmado em prod):** `net._http_response` registra `Timeout of 5000 ms reached`. A EF `sync-tiny-payables` leva ~15,7s; o `net.http_post` do cron usa o timeout default — que a documentação oficial lista como 2000ms [VERIFIED: supabase.github.io/pg_net/api/] ou 5000ms dependendo da versão instalada. Em qualquer caso, é muito menor que 15,7s. O pg_net abandona a conexão antes da EF terminar.

**Bloqueio secundário (agravante):** Mesmo que o pg_net não abandonasse, a EF retornou 200 em 15,7s hoje às 12:00 mas `synced_at` permanece 2026-06-18. Há um segundo bug dentro da EF que impede a persistência.

### 4 Suspects de Silent-No-Write

**Suspect 1 — `fetchPayables` NÃO passa dateFrom/dateTo à Tiny API (file:line 175-178)**

```typescript
// supabase/functions/sync-tiny-payables/index.ts, linhas 175-178
const data = await tinyGet(token, "/contas-pagar", {
  offset: String(offset),
  limit:  "100",
  // dateFrom e dateTo NÃO são passados aqui — aceitos como parâmetros mas ignorados
});
```

O parâmetro `dateFrom` e `dateTo` entram na função `fetchPayables` (linhas 164-165) mas nunca são incluídos no `tinyGet`. Resultado: a API Tiny retorna TODAS as contas a pagar sem filtro de data. **Isso, por si só, não seria silent-no-write** (busca mais linhas do que o necessário, mas ainda upserta). Porém, se a Tiny API retorna contas sem `dataVencimento` válido, o `outflowDate` cai para `syncAt.slice(0, 10)` (linha 233) — o que é válido.

**Suspect 2 — Token Tiny expirado com refresh falhando silenciosamente (file:line 86-109)**

```typescript
// supabase/functions/sync-tiny-payables/index.ts, linhas 86-109
if (!tok.tiny_refresh_token) {
  throw new Error(`Token Tiny expirado e sem refresh_token...`);  // linha 88 — throw correto
}
// Refresh via tiny-oauth EF, linhas 91-109
const refreshData = await refreshResp.json();
if (!refreshResp.ok || !refreshData.success) {
  throw new Error(`Falha ao renovar token...`);  // linha 106 — throw correto
}
```

O `getTinyToken` lança exceção em token inválido. A exceção é capturada no try/catch do loop de lojas (linha 314): `lojaResults[mlUserId] = { synced: 0, errors: -1 }` — a EF ainda retorna HTTP 200 com `errors: 1`, mas `synced: 0`. **Este é um caminho de silent-no-write: EF 200, synced=0, sinced_at não atualizado.** Se o token Tiny da Pé Vermeio expirou e o refresh também está quebrado/expirado, todas as contas a pagar ficam sem sync.

**Suspect 3 — `fetchPayables` retornando array vazio por `itens.length === 0` (file:line 183-189)**

```typescript
// supabase/functions/sync-tiny-payables/index.ts, linhas 183-189
const itens: any[] = Array.isArray(data) ? data : (data?.itens ?? data?.data ?? []);
// ...
if (!itens.length) break;
allItems.push(...itens);
```

Se a Tiny API mudou o formato de resposta (ex: retornou `{ contas: [...] }` em vez de `{ itens: [...] }`), todos os 3 fallbacks (`itens`, `data`, fallback `[]`) falham → `itens = []` → `break` na 1ª página → retorna `[]`. Em `processLoja` (linha 211): `if (!itens.length) return { synced: 0, errors: 0 }`. EF retorna 200, `synced: 0`, sem upsert. **Silent-no-write.**

**Suspect 4 — Erro de upsert engolido por try/catch local (file:line 263-267)**

```typescript
// supabase/functions/sync-tiny-payables/index.ts, linhas 263-267
const { error: upsertErr } = await sb
  .from("cash_outflows")
  .upsert(rows, { onConflict: "organization_id,tiny_payable_id", ignoreDuplicates: false });

if (upsertErr) {
  console.error(`[sync-tiny-payables] ml_user_id=${mlUserId} upsert error:`, upsertErr.message);
  return { synced: 0, errors: rows.length };  // retorna sem lançar — loop continua
}
```

Upsert falha (ex: schema drift, constraint violação, service_role_key inválida no supabase client) → `console.error` + `return { synced: 0, errors: rows.length }`. A EF retorna HTTP 200 com `errors > 0` mas `synced: 0`. `synced_at` não atualizado. **Silent-no-write.**

**Verificação de `synced_at` no CONFLICT:** A constraint de upsert é `(organization_id, tiny_payable_id)`. O payload de cada row inclui `synced_at: syncAt` (linha 246) e `updated_at: syncAt` (linha 247). Com `ignoreDuplicates: false`, o Supabase faz `INSERT ... ON CONFLICT DO UPDATE SET ...todos os campos...`. Logo, `synced_at` É atualizado no conflito — se o upsert chegar a executar. O problema não é o upsert em si, mas um dos 4 suspects acima impedindo que o upsert seja atingido.

### Ranking dos Suspects por Probabilidade

1. **Suspect 2 (token expirado/refresh quebrado)** — mais provável. Token Tiny da Pé Vermeio foi conectado em ~18/06. Tokens Tiny OAuth 2.0 expiram em horas/dias; se o refresh também expirou ou falhou, a EF loga erro mas retorna 200. O log de 12:00 de 25/06 mostrou 200 com 15,7s — o que sugere que ela chegou a tentar algo — mas não sabemos se entrou no refresh ou caiu no catch da loja.

2. **Suspect 3 (formato de resposta Tiny)** — possível se o Tiny mudou formato entre 18/06 e hoje. A EF tem 3 fallbacks mas nenhum cobre `contas`, `lista`, ou outros nomes possíveis.

3. **Suspect 4 (upsert engolido)** — possível se o SERVICE_KEY no supabase client estiver errado (raro mas possível após rotação).

4. **Suspect 1 (dateFrom/dateTo ignorados)** — menor impacto imediato (não causa silent-no-write por si só, apenas busca dados excessivos).

### Estratégia de Debug (antes de corrigir)

O plano deve incluir uma task de debug que adiciona observabilidade à EF **antes** de aplicar qualquer fix definitivo:

```typescript
// Adicionar após busca de tokenRows (linha ~300):
console.log(`[sync-tiny-payables] tokenRows count=${tokenRows?.length ?? 0}`);
console.log(`[sync-tiny-payables] tokenRows=${JSON.stringify(tokenRows?.map(r => r.ml_user_id))}`);

// No processLoja, após getTinyToken:
console.log(`[sync-tiny-payables] ml_user_id=${mlUserId} token obtido OK`);

// No fetchPayables, logar raw da 1ª página:
console.log(`[sync-tiny-payables] ml_user_id=${mlUserId} raw keys=${Object.keys(data ?? {}).join(',')}, itens=${itens.length}`);

// Antes do upsert, logar rows.length e uma amostra:
console.log(`[sync-tiny-payables] ml_user_id=${mlUserId} rows para upsert=${rows.length}`);
```

Essa versão de debug é deployed, o cron é invocado manualmente ou esperado, e os logs do Supabase revelam qual suspect é o real.

---

## Fix Recomendado: Issue 2

### Fix A — Timeout: waitUntil (RECOMENDADO) vs timeout_milliseconds

**Opção 1: `timeout_milliseconds` no net.http_post**

```sql
-- Assinatura oficial pg_net (supabase.github.io/pg_net/api/):
net.http_post(
  url                  text,
  body                 jsonb    default '{}'::jsonb,
  params               jsonb    default '{}'::jsonb,
  headers              jsonb    default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int      default 2000    -- ou 1000 dependendo da versão
)
```

Uso com timeout estendido:
```sql
SELECT net.http_post(
  url                  := 'https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-payables',
  headers              := jsonb_build_object(...),
  body                 := '{}'::jsonb,
  timeout_milliseconds := 60000   -- 60s
) AS request_id;
```

**Problema:** aumentar o timeout não resolve o segundo bug (silent-no-write). A EF já completou em 15,7s — e mesmo assim não gravou. A migration de cron seria um fix parcial que mascara o problema real.

**Opção 2: `EdgeRuntime.waitUntil` (RECOMENDADA)**

```typescript
// supabase/functions/sync-tiny-payables/index.ts — padrão waitUntil
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authError = requireServiceRole(req);
  if (authError) return authError;

  // Responder 202 IMEDIATAMENTE — desacopla o pg_net do tempo de execução
  EdgeRuntime.waitUntil(runSync());  // sem await — processa em background
  return jsonResp({ ok: true, msg: "sync enqueued" }, 202);
});

async function runSync() {
  // toda a lógica atual do handler (calcular janela, buscar tokenRows, processLoja loop)
  // com observabilidade aumentada
}
```

**Vantagens do waitUntil:**
- O pg_net recebe 202 em < 100ms → never times out, nunca mais registra "Timeout of 5000ms reached"
- A EF continua executando por até 150s (free tier) ou 400s (paid) — suficiente para 15,7s
- Desacopla completamente o cron da duração de execução
- Não requer nova migration de cron (a migration de cron atual pode permanecer)
- `EdgeRuntime` é global no runtime Supabase Edge — sem import necessário [VERIFIED: supabase.com/docs/guides/functions/background-tasks]

**Desvantagem menor:** a resposta do cron sempre será 202 (não há como saber o resultado do sync pelo status HTTP). Os logs do Supabase são a única forma de monitorar. Isso é aceitável — o cron não lê o body da resposta de qualquer forma.

**RECOMENDAÇÃO FINAL:** Implementar waitUntil + observabilidade. Se após isso o bug de silent-no-write for corrigido e o sync funcionar, não é necessária migration de cron. Se por algum motivo o waitUntil não for suficiente (ex: plano free com limite de background atingido), adicionar `timeout_milliseconds := 60000` como fallback em uma migration nova.

### Fix B — Persistência: Observabilidade + Root Cause

A task de execução deve:
1. Adicionar logs detalhados (ver Estratégia de Debug acima)
2. Deploy da EF com debug
3. Invocar manualmente: `curl -X POST https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/sync-tiny-payables -H "Authorization: Bearer <service_role_key>"`
4. Ler os logs para identificar qual suspect é o real
5. Corrigir o bug específico + implementar waitUntil
6. Validar: `SELECT count(DISTINCT synced_at::date), max(synced_at) FROM cash_outflows` — deve aumentar

---

## Deploy / Checkpoint Constraints (CRITICAL)

**EF deploy:** Requer `SUPABASE_ACCESS_TOKEN` (token do Wesley `sbp_...`). O `gsd-executor` NÃO possui o MCP Supabase nem o token. O deploy de EF é executado pelo ORQUESTRADOR via CLI ou MCP. [VERIFIED: STATE.md + CONTEXT.md]

Padrão confirmado das phases anteriores:
- Phase 57-04: "deploy EF pelo orquestrador" — checkpoint blocking
- Phase 58: "EF nexo-chat v5 deployada via CLI (script 127kB)"

**Migration apply:** Via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx` (NÃO `db push` local — projeto local linkado no errado). [VERIFIED: STATE.md linha "Supabase CLI local linkado no projeto ERRADO"]

**Regra de não-drift:** Qualquer alteração no cron (ex: `timeout_milliseconds`) deve ser feita via migration versionada com timestamp sequencial, nunca via SQL Editor. [CITED: feedback_no_drift_via_sql_editor]

---

## Common Pitfalls

### Pitfall 1: Pegar a versão errada da RPC para editar
**O que vai errado:** Editar a `20260619000000` (que não tem `daily_projection`) e criar uma migration DROP+CREATE sobreescrevendo a versão BRT.
**Por que acontece:** Três migrations mexem na mesma função; a mais antiga é mencionada no CONTEXT como referência.
**Como evitar:** A migration autoritativa é `20260619020000_cashflow_brt_timezone.sql`. Usar `CREATE OR REPLACE` sem DROP para preservar assinatura. Garantir que a nova migration inclui `daily_projection` no RETURNS TABLE.
**Warning signs:** Migration compilar mas gráfico perder a coluna `daily_projection` no frontend.

### Pitfall 2: accumulated_balance quebrado pelo fix de SMA
**O que vai errado:** A janela SQL edita `SUM(d.inc - d.exp)` por engano ao copiar a expressão.
**Por que acontece:** As duas colunas no SELECT final são similares; é fácil editar a linha errada.
**Como evitar:** Editar SOMENTE a linha de `accumulated_balance_sma` (linha 76 da 20260619020000 atual). Testar com `SELECT * FROM get_cashflow(org_id, today, today+30)` e verificar que `accumulated_balance = accumulated_balance_sma` nos primeiros 7 dias (quando não há SMA sendo adicionado).
**Warning signs:** Reconciliação DFC quebra.

### Pitfall 3: v_today BRT omitido no CASE
**O que vai errado:** Usar `CURRENT_DATE + 7` no CASE em vez de `v_today + 7`.
**Por que acontece:** CURRENT_DATE é UTC; a migração 020000 existe exatamente para corrigir esse bug.
**Como evitar:** Sempre usar `v_today` (já declarado como `(now() AT TIME ZONE 'America/Sao_Paulo')::date`).
**Warning signs:** Gráfico começa um dia errado dependendo do horário BRT.

### Pitfall 4: waitUntil sem try/catch na função de background
**O que vai errado:** Exceção não capturada dentro de `runSync()` mata o processo sem log claro.
**Por que acontece:** No padrão waitUntil, a função roda fora do request handler — erros não propagam para o caller.
**Como evitar:** Embrulhar `runSync()` em try/catch com `console.error` completo. Supabase recomenda isso explicitamente na documentação de background tasks.

### Pitfall 5: Migration de cron sem unschedule antes do schedule
**O que vai errado:** Criar um segundo job com o mesmo nome → erro duplicado ou comportamento imprevisível.
**Por que acontece:** O `cron.schedule` não é idempotente por padrão.
**Como evitar:** Sempre fazer `cron.unschedule('nome') EXCEPTION WHEN OTHERS THEN NULL` antes do `cron.schedule`. Padrão já estabelecido em todas as migrations de cron do projeto.

---

## Code Examples

### CASE Expression Validado (copiar para nova migration)

```sql
-- Arquivo: supabase/migrations/2026059XXXXXX_cashflow_projection_7d_rule.sql
-- Baseado em: 20260619020000_cashflow_brt_timezone.sql
-- Nomes de coluna validados contra o CTE real: d.inc, d.exp, d.d_date, v_sma, v_today, v_initial

CREATE OR REPLACE FUNCTION public.get_cashflow(
  p_org_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE (
  date DATE,
  daily_income NUMERIC,
  daily_expense NUMERIC,
  daily_projection NUMERIC,
  daily_balance NUMERIC,
  accumulated_balance NUMERIC,
  accumulated_balance_sma NUMERIC
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_initial NUMERIC := 0;
  v_today   DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_start   DATE;
  v_sma     NUMERIC := 0;
BEGIN
  v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs WHERE fs.organization_id = p_org_id LIMIT 1), 0);
  v_start := GREATEST(p_start_date, v_today);

  v_sma := COALESCE((
    SELECT SUM(o.receita_bruta - COALESCE(o.comissao, 0) - COALESCE(o.frete, 0)) / 15.0
    FROM orders o
    WHERE o.organization_id = p_org_id
      AND o.status IN ('paid','shipped','delivered')
      AND LEFT(o.data_pedido, 10)::date BETWEEN v_today - 15 AND v_today - 1
  ), 0);

  RETURN QUERY
  WITH days AS (
    SELECT gs::date AS d_date
    FROM generate_series(v_start, p_end_date, INTERVAL '1 day') gs
  ),
  inc AS (
    SELECT ci.release_date AS d_date, SUM(ci.net_amount) AS amt
    FROM cash_inflows ci
    WHERE ci.organization_id = p_org_id AND ci.release_date BETWEEN v_start AND p_end_date
    GROUP BY ci.release_date
  ),
  exp AS (
    SELECT co.outflow_date AS d_date, SUM(co.amount) AS amt
    FROM cash_outflows co
    WHERE co.organization_id = p_org_id AND co.outflow_date BETWEEN v_start AND p_end_date
    GROUP BY co.outflow_date
  ),
  daily AS (
    SELECT d.d_date,
           COALESCE(i.amt, 0) AS inc,
           COALESCE(e.amt, 0) AS exp
    FROM days d
    LEFT JOIN inc i ON i.d_date = d.d_date
    LEFT JOIN exp e ON e.d_date = d.d_date
  )
  SELECT d.d_date,
         d.inc,
         d.exp,
         -- daily_projection: 0 nos dias 1-7 e dias com recebimento; v_sma apenas nos buracos futuros
         (CASE
            WHEN d.d_date <= v_today + 7 THEN 0::NUMERIC
            WHEN d.inc > 0               THEN 0::NUMERIC
            ELSE v_sma
          END),
         (d.inc - d.exp),
         -- accumulated_balance: INTOCADO (reconciliado ao centavo com DFC)
         (v_initial + SUM(d.inc - d.exp) OVER (ORDER BY d.d_date ASC))::NUMERIC,
         -- accumulated_balance_sma: CASE com regra de 7 dias
         (v_initial + SUM(
           (CASE
              WHEN d.d_date <= v_today + 7 THEN d.inc
              WHEN d.inc > 0               THEN d.inc
              ELSE v_sma
            END) - d.exp
         ) OVER (ORDER BY d.d_date ASC))::NUMERIC
  FROM daily d
  ORDER BY d.d_date ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow(UUID,DATE,DATE) TO authenticated;
```

### waitUntil Pattern para sync-tiny-payables

```typescript
// supabase/functions/sync-tiny-payables/index.ts — estrutura com waitUntil

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authError = requireServiceRole(req);
  if (authError) return authError;

  // Responder 202 imediatamente — pg_net não expira mais
  EdgeRuntime.waitUntil(runSync());
  return jsonResp({ ok: true, msg: "sync enqueued" }, 202);
});

async function runSync(): Promise<void> {
  try {
    const now     = new Date();
    const dateFrom = new Date(now.getTime() - DAYS_BACK    * 86400000).toISOString().slice(0, 10);
    const dateTo   = new Date(now.getTime() + DAYS_FORWARD * 86400000).toISOString().slice(0, 10);

    console.log(`[sync-tiny-payables] runSync iniciando. Janela: ${dateFrom} → ${dateTo}`);

    const { data: tokenRows, error: tokErr } = await sb
      .from("ml_tokens")
      .select("ml_user_id, organization_id")
      .not("tiny_access_token", "is", null);

    if (tokErr) {
      console.error("[sync-tiny-payables] Erro ao buscar ml_tokens:", tokErr.message);
      return;
    }

    console.log(`[sync-tiny-payables] tokenRows=${tokenRows?.length ?? 0} lojas com Tiny conectado`);

    if (!tokenRows?.length) {
      console.log("[sync-tiny-payables] Nenhuma loja com Tiny conectado — abortando.");
      return;
    }

    // ... loop de processLoja com observabilidade (ver Estratégia de Debug) ...
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-tiny-payables] runSync ERRO:", message);
  }
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 |
| Config file | `vitest.config.ts` (inclui `supabase/functions/**/*.test.ts`) |
| Quick run command | `npx vitest run --reporter=verbose 2>&1 | tail -20` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| CASHFIX-01 | accumulated_balance_sma ≡ accumulated_balance nos primeiros 7 dias | SQL manual / smoke | Testar via `supabase.rpc("get_cashflow", ...)` e verificar que para d_date ≤ today+7, `accumulated_balance_sma = accumulated_balance` quando d.exp=0 |
| CASHFIX-01 | daily_projection = 0 nos dias 1-7 | SQL manual | Verificar no resultado da RPC |
| CASHFIX-02 | synced_at cresce após fix | SQL manual | `SELECT count(DISTINCT synced_at::date), max(synced_at) FROM cash_outflows` — deve mostrar > 1 dia após sync |
| CASHFIX-02 | EF retorna 202 em < 200ms | Invocação direta | `curl -w "%{time_total}" ...` |

### Wave 0 Gaps
- Não há testes unitários para `get_cashflow` RPC — testes são validações SQL manuais pós-deploy.
- A EF `sync-tiny-payables` não tem arquivo de teste `.test.ts` — não é necessário criar agora (lógica é I/O-bound e a validação real é via observabilidade de prod).

### Validação SQL pós-deploy (CASHFIX-01)

```sql
-- Verificar que accumulated_balance_sma = accumulated_balance nos dias 1-7
-- (quando não há saídas previstas — caso mais simples):
SELECT date, accumulated_balance, accumulated_balance_sma,
       accumulated_balance - accumulated_balance_sma AS diff
FROM get_cashflow(
  '7f615df7-7bac-45e5-8a93-827fb9ddeec7',  -- org Pé Vermeio
  (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  (now() AT TIME ZONE 'America/Sao_Paulo')::date + 30
)
ORDER BY date;
-- Esperado: diff = 0 nos primeiros 7 dias (quando cash_inflows tem entradas)
-- ou diff = v_sma*7 nos primeiros 7 dias sem entradas (mas ambas usam 0 de previsão → correto)
```

### Validação pós-deploy (CASHFIX-02)

```sql
-- Antes do fix (baseline — deve mostrar 1 dia distinto):
SELECT count(DISTINCT synced_at::date) AS dias_distintos, max(synced_at) AS ultimo_sync
FROM cash_outflows WHERE organization_id = '7f615df7-7bac-45e5-8a93-827fb9ddeec7';

-- Após o fix + sync manual, deve mostrar >= 2:
-- count = 2, ultimo_sync > '2026-06-18'
```

---

## Security Domain

> Fase não introduz novas superfícies de segurança. Padrões existentes mantidos.

### ASVS Aplicável

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `SECURITY INVOKER` na RPC (anti-IDOR via RLS) — mantido |
| V5 Input Validation | parcial | `requireServiceRole()` na EF — mantido; upsert com constraint `(org_id, tiny_payable_id)` |
| V6 Cryptography | yes | service_role_key Pattern B (vault, sb_secret_*) — não alterado |

**Nenhum novo vetor de IDOR introduzido.** A RPC de fix usa SECURITY INVOKER (padrão do projeto — conforme `feedback_supabase_security_invoker.md`).

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Supabase MCP (apply_migration) | Aplicar migration RPC | Sim (orquestrador) | Não usar CLI local |
| SUPABASE_ACCESS_TOKEN (Wesley) | Deploy EF | Requer token do Wesley | Checkpoint blocking para deploy |
| Tiny API access | Debug/validação | A confirmar | Token pode estar expirado — é um dos suspects |
| Supabase Edge Function logs | Debug do Suspect | Sim (dashboard ou MCP get_logs) | Crítico para identificar o bug real |

**Missing dependencies with no fallback:**
- `SUPABASE_ACCESS_TOKEN` do Wesley — sem ele o deploy da EF não ocorre. Orquestrador solicita no checkpoint.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | O token Tiny da Pé Vermeio (ml_user_id 1639558873) está expirado ou com refresh quebrado | Issue 2, Suspect 2 (mais provável) | Se token está OK, Suspect 3 ou 4 é o real — debug logs revelarão |
| A2 | `EdgeRuntime` é global no runtime Supabase Edge sem import | Fix Issue 2 — waitUntil | Se não for global, será necessário import ou usar abordagem alternativa (resposta 202 + flag de background via Deno.serve options) |
| A3 | pg_net timeout default da versão instalada é ≤ 5000ms | Issue 2 causa-raiz | Mesmo que seja diferente, a EF leva 15,7s — qualquer timeout < 15,7s é o bloqueio |

**Se A1 estiver errado:** Suspects 3 ou 4 revelados pelos logs de debug — fix muda mas estrutura waitUntil permanece.

**Se A2 estiver errado:** Adicionar declaração explícita `declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }` no topo do arquivo.

---

## Open Questions

1. **O token Tiny da Pé Vermeio está de fato expirado?**
   - O que sabemos: EF retornou 200 em 15,7s às 12:00 — ela chegou a rodar. Mas não sabemos se o log de `total= contas a pagar` foi emitido.
   - O que está claro: os logs de debug revelarão isso na 1ª execução pós-deploy da versão com observabilidade.
   - Recomendação: task de debug/observabilidade deve ser Wave 1, fix definitivo Wave 2.

2. **Incluir indicador de "última atualização" na UI?**
   - CONTEXT.md marca como opcional ("decidir no plano").
   - Seria `max(synced_at)` de `cash_outflows` lido via query direta na página de Caixa.
   - Simples de implementar: 1 query extra no hook `useCashFlowData` ou componente novo.
   - Recomendação: incluir — custo baixo, valor alto para visibilidade futura de congelamento.

---

## Sources

### Primary (HIGH confidence)
- `/root/garment-glow-test/supabase/migrations/20260619020000_cashflow_brt_timezone.sql` — versão autoritativa de `get_cashflow` (lida completa)
- `/root/garment-glow-test/supabase/migrations/20260619010000_cashflow_daily_projection.sql` — versão anterior com `daily_projection`
- `/root/garment-glow-test/supabase/migrations/20260619000000_cashflow_sma_bruta_menos_taxas.sql` — versão base
- `/root/garment-glow-test/supabase/functions/sync-tiny-payables/index.ts` — EF completa, lida linha a linha
- `/root/garment-glow-test/src/components/financial/CashFlowChart.tsx` — frontend, confirmado zero alteração necessária
- `/root/garment-glow-test/src/hooks/useCashFlowData.ts` — hook, confirmado consumo passivo das colunas
- `/root/garment-glow-test/supabase/migrations/20260618115000_cash_outflows_tiny_cron.sql` — cron atual, confirmado sem `timeout_milliseconds`
- `/root/garment-glow-test/supabase/migrations/20260618100000_cash_flow_tables.sql` — schema de `cash_outflows`
- [Supabase Background Tasks Docs](https://supabase.com/docs/guides/functions/background-tasks) — padrão `EdgeRuntime.waitUntil`
- [pg_net API Reference](https://supabase.github.io/pg_net/api/) — assinatura `net.http_post` com `timeout_milliseconds`

### Secondary (MEDIUM confidence)
- [Supabase pg_net Docs](https://supabase.com/docs/guides/database/extensions/pg_net) — timeout default confirmado como 2000ms
- `/root/garment-glow-test/.planning/phases/59-fluxo-caixa-correcoes/59-CONTEXT.md` — diagnóstico em prod (Wesley + engenheiro em 25/06)
- `/root/garment-glow-test/.planning/STATE.md` — padrão de deploy EF (orquestrador, não executor)

---

## Metadata

**Confidence breakdown:**
- SQL fix (CASHFIX-01): HIGH — nomes de coluna verificados no código real, CASE expression validada
- Silent-no-write suspects (CASHFIX-02): HIGH para a enumeração; MEDIUM para o ranking (Suspect 2 mais provável mas confirmar com debug)
- waitUntil recommendation: HIGH — documentação oficial Supabase
- Deploy constraints: HIGH — padrão confirmado em STATE.md + múltiplas phases anteriores

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stack estável; Tiny API sem mudanças previstas)

---

## RESEARCH COMPLETE
