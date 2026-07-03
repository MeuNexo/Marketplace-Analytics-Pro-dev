# 83-02 SUMMARY — Deploy da migration `marca` + smoke (checkpoint do orquestrador)

**Plano:** 83-02 (wave 2, BLOCKING)
**Executado por:** orquestrador (via MCP claude.ai Supabase — o gsd-executor não tem acesso)
**Data:** 2026-07-03
**Projeto:** ckcdevcxgvueywivefgx (produção)
**Autorização:** Wesley autorizou explicitamente o deploy em produção (AskUserQuestion, 2026-07-03).

## O que foi feito
Aplicada a migration `20260683000000_margin_with_ads_marca.sql` (DROP FUNCTION + CREATE de
`get_margin_with_ads_by_product` com a coluna `marca` no fim da RETURNS TABLE) via MCP
`apply_migration` (name: `margin_with_ads_marca`). Retornou `{"success":true}`. Não via SQL
Editor nem `supabase db push`.

## Smoke — evidência

**1. Retorno + `marca` preenchida** (org Pé Vermeio `e4150d57…`, ml_user_id 427063369, últimos 30d, `unidades>0`):
`marca` vem preenchida — ex.: MLB4340888693=Sandrini (R$801.134,36), MLB3768353737=Fila (R$519.360,58), MLB5547123710=New Balance (R$356.996,54). Sem erro de tipo/função.

**2. Retrocompat:** `pg_get_function_result` confirma **20 colunas**, todas as 18 antigas por nome (item_id, titulo, sku, listing_type, receita, cmv, comissao, frete, impostos, lucro, lucro_pct, pedidos, unidades, has_cmv, ads_spend, ads_attributed_orders, lucro_pos_ads, lucro_pct_pos_ads, ads_no_sale) + `marca`. `retrocompat_ok=true`. Os 4 consumidores (useMLMarginWithAds, useMLProductMargins, nexo-chat/tools, consultor-insights) leem por nome → nenhum quebra.

**3. Reconciliação de receita** (período 2026-06-25→06-30, critério unificado paid+shipped+delivered):
- Σreceita RPC (unidades>0) = **1.014.058,38**
- Σreceita manual em `orders` (mesmo filtro) = **1.014.058,38**
- **diff = 0,00** (reconciliado ao centavo).

**4. Anti-IDOR:** impersonando role `authenticated` de org alheia (`7f615df7…`, user ce8c797c…) chamando a RPC para os itens da Pé Vermeio → **0 linhas** vazadas. RLS org-first (SECURITY INVOKER) intacta.

## Achado importante (data quality, NÃO bug de código)
Os maiores anúncios (Sandrini, Fila, New Balance — marcas de **revenda**) vêm com `has_cmv=false`
(custo_unit ausente no Tiny). Isso infla `lucro_pct_pos_ads` para 82–91% (cmv=0). **Confirma a
necessidade da decisão travada:** quando `has_cmv=false`, a UI (83-03) mostra MCO% = "—" + aviso,
NUNCA o número — senão exibiríamos "MCO 83%" que é falso. Raiz = custo de marcas de revenda
ausente no Tiny (mesmo diagnóstico do bug custo_unit null anterior; é sync manual do admin, não
código). Consequência prática: uma parcela relevante da receita da Pé Vermeio aparecerá com MCO
indefinido até os custos serem preenchidos no Tiny.

## Resume-signal
migration aplicada em prod ✓ · coluna marca preenchida ✓ · retrocompat OK (18 colunas antigas por
nome) ✓ · Σreceita RPC ≡ soma manual em orders (paid+shipped+delivered), diff 0,00 ✓ · anti-IDOR
= 0 linhas para org alheia ✓ → **Wave 3 (UI) liberada.**
