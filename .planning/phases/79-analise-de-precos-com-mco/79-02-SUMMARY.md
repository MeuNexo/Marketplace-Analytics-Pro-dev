# 79-02 SUMMARY — Deploy da RPC + smoke (checkpoint do orquestrador)

**Executado:** 2026-07-02 (orquestrador via MCP claude.ai Supabase — gsd-executor não tem acesso ao MCP)
**Status:** ✓ COMPLETO — todos os must_haves provados

## O que foi feito

1. **Migration aplicada em prod** (`ckcdevcxgvueywivefgx`) via MCP `apply_migration`
   (nome: `orders_price_timeseries_mco`) — nunca SQL Editor. `{"success":true}`.
   DROP FUNCTION + CREATE FUNCTION (13 colunas, SECURITY INVOKER, sem org param).

2. **Smoke como role `authenticated`** (org Pé Vermeio, user `ce8c797c-…`, via
   `set_config('request.jwt.claims', …)` + `set_config('role','authenticated')` num único
   statement com CROSS JOIN LATERAL dependente — o MCP `execute_sql` só retorna o primeiro
   result set de statements múltiplos, então BEGIN/SET LOCAL ROLE em statements separados
   NÃO funciona; o LATERAL com `WHERE s.c1 IS NOT NULL` força a ordem).
   Item: `MLB3773747679` (105 pedidos jun/26, 100% com custo e tax_amount).
   → RPC retornou as **13 colunas** para 6 buckets (25–30/06).

3. **Reconciliação ao centavo (3 buckets)** — RPC(authenticated) ≡ soma manual em `orders`:

   | bucket | total | qtd | cmv | comissao | frete | impostos |
   |---|---|---|---|---|---|---|
   | 2026-06-25 | 368.50 | 10 | 158.10 | 29.50 | 94.47 | 86.5892… |
   | 2026-06-27 | 331.65 | 9 | 142.29 | 23.60 | 86.73 | 78.8332… |
   | 2026-06-30 | 479.05 | 13 | 205.53 | 38.35 | 151.73 | 107.1819… |

   Todos os valores idênticos nas duas consultas. `qtd_sem_custo=0` e `qtd_sem_imposto=0`
   (item 100% populado — consistente com o ground truth `sum FILTER (custo_unit IS NULL) = null/0`).

4. **Anti-IDOR ✓** — user da org Thales (`e4150d57-…`) chamando a RPC para o item da
   Pé Vermeio → **0 linhas** (`linhas_cross_org: 0`).

5. **Cobertura do cache de ads (calibração p/ 79-03):** `ml_ads_products_cache` da
   Pé Vermeio tem 15.691 linhas, 301 itens, período 2026-05-06 → 2026-07-02 (~2 meses).
   O item do smoke não tem ads (0 linhas) — caso "ads ausente = 0" da UI é real e comum.

## Desvios

- Nenhum no conteúdo. Operacional: o método de impersonação documentado no plano
  (BEGIN + SET LOCAL ROLE em statements separados) não retorna o result set no MCP
  `execute_sql`; substituído pelo single-statement LATERAL (mesma semântica, mesmo role).

## Aprendizado

- MCP `execute_sql` retorna apenas o PRIMEIRO result set → impersonação de role em smoke
  deve ser single-statement: `FROM (SELECT set_config(claims), set_config('role',…)) s
  CROSS JOIN LATERAL (query WHERE s.c1 IS NOT NULL) t`.
