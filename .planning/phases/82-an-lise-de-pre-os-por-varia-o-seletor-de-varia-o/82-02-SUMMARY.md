# 82-02 SUMMARY — Deploy da RPC `_sku` + smoke (checkpoint do orquestrador)

**Plan:** 82-02 (BLOCKING) · **Executado por:** orquestrador via MCP Supabase · **Data:** 2026-07-03

## Deploy
- `apply_migration` no projeto `ckcdevcxgvueywivefgx`, nome `orders_price_timeseries_sku` → `{"success": true}`.
- Arquivo versionado: `supabase/migrations/20260682000000_orders_price_timeseries_sku.sql` (DROP+CREATE, `_sku text DEFAULT NULL` como 6º parâmetro, `AND (_sku IS NULL OR o.sku = _sku)`, SECURITY INVOKER, 13 colunas intactas).

## Smoke (execute_sql, dados reais MLB4113792113, 2026-06-03..07-03)
| Teste | Resultado |
|---|---|
| RPC 5 args (pai, retrocompat) | R$40–60: 6930 und, giro 693/dia, **cobertura 6d** (estoque pai 4401) — idêntico ao pré-migration ✓ |
| RPC 6 args (`_sku`=SA025132197AABPCN420603) | R$40–60: 956 und, giro 95,6/dia, **cobertura 0d** (estoque variação 19) ✓ |
| Duas assinaturas coexistem | Sem erro "function is not unique" ✓ |
| Reconciliação | RPC com `_sku` == query manual anterior (956 und, 95,6/dia, 0d) ✓ |
| **Prova da feature** | pai=6d esconde; variação campeã=0d (esgota hoje no preço baixo) ✓ |
| Anti-IDOR | user de outra org (ce8c797c… / org 7f615df7…) impersonado como role `authenticated` → **0 linhas** com e sem `_sku` ✓ |

## Conclusão
RPC em produção, retrocompatível, filtro por SKU correto, sem nova superfície de IDOR (herdado da RLS de `orders`, SECURITY INVOKER). Libera a wave 3 (UI 82-03).
