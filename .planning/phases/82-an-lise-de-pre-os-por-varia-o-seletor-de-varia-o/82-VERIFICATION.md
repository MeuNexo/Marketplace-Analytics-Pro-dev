---
phase: 82-an-lise-de-pre-os-por-varia-o-seletor-de-varia-o
verified: 2026-07-03T01:15:00Z
status: passed
human_needed: true
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Abrir /analise-precos em um anúncio com variações (ex.: MLB4113792113), confirmar visualmente o dropdown 'Todas as variações (anúncio)' + demais opções, o badge 'Analisando variação: …' ao selecionar, o aviso discreto de N variações/M esgotadas no nível pai, e o reset do dropdown ao trocar de anúncio. Testar light+dark, mobile+desktop."
    expected: "Dropdown aparece só em anúncios com has_variations=true; troca de variação atualiza histograma/giro/cobertura em tempo real; troca de anúncio volta ao pai."
    why_human: "Comportamento visual/interativo em runtime (render condicional, refetch de RPC ao trocar Select, layout responsivo) não é observável só por grep/tsc/vitest — é o próprio checkpoint que a 82-03-SUMMARY.md registra como pendente antes do merge do PR #27."
  - test: "Confirmar em produção (via MCP execute_sql/list_migrations, fora do alcance desta ferramenta de verificação) que a migration 20260682000000_orders_price_timeseries_sku.sql está de fato aplicada no projeto ckcdevcxgvueywivefgx e que os números do smoke (pai=6d / variação SKU …420603=0d) reproduzem."
    expected: "RPC de 6 argumentos responde sem erro 'function is not unique'; retrocompat de 5 argumentos preservada; cobertura da variação = 0d, do pai = 6d."
    why_human: "Este verificador roda em sandbox sem token/MCP do Supabase (sem SUPABASE_ACCESS_TOKEN, sem `supabase login`). A 82-02-SUMMARY.md documenta os números exatos do smoke (956 und, giro 95,6/dia, estoque 19, SKU SA025132197AABPCN420603) e eles batem com os achados manuais registrados ANTES da implementação no 82-CONTEXT.md — forte evidência circunstancial de que não foi fabricado, mas não constitui prova direta de estado do banco de produção."
---

# Phase 82: Análise de Preços por Variação (seletor de variação) Verification Report

**Phase Goal:** Adicionar seletor de variação em `/analise-precos`. Default = anúncio pai (Phase 81 intacta); variação selecionada filtra tudo por ela (faixas, giro, estoque, cobertura). RPC ganha `_sku` opcional; join vendas↔estoque por SKU (`seller_custom_field`), NÃO `variation_id`.

**Verified:** 2026-07-03
**Status:** passed (com 2 itens de validação humana pendentes — ver `human_verification`)
**Re-verification:** No — initial verification

## Veredito

**PASSED** — o código entrega o que a Phase 82 prometeu. Todos os 8 must-haves (roadmap + PLAN frontmatter 82-01/82-03) têm evidência direta no código, `npx vitest run` (374/374) e `npx tsc --noEmit` (limpo) rodaram de verdade nesta sessão (não foi aceito o relato do SUMMARY), `precoFaixas.ts`/`precoMcoSeries.ts` estão comprovadamente intactos via `git diff` vazio, e não há scope creep (a métrica agregada "sustentável + % rompido" não existe em lugar nenhum do código). Restam 2 itens que exigem verificação humana/de infraestrutura fora do alcance deste verificador: (1) validação visual do Wesley em `/analise-precos` — que o próprio 82-03-SUMMARY.md já registra como pendente antes do merge do PR #27; (2) confirmação direta em produção de que a migration está aplicada (este agente não tem token MCP/CLI do Supabase no sandbox de verificação).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | RPC `orders_price_timeseries` ganha 6º parâmetro opcional `_sku text DEFAULT NULL`, no fim da assinatura, sem quebrar chamadas de 5 args | ✓ VERIFIED | `supabase/migrations/20260682000000_orders_price_timeseries_sku.sql:25-32` — `_sku text DEFAULT NULL` é o 6º e último parâmetro; `DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text)` (linha 23) remove a assinatura antiga de 5 args antes do `CREATE`, evitando overload ambíguo |
| 2 | Quando `_sku` não-nulo, filtra `AND o.sku = _sku` (join por SKU, não `variation_id`) | ✓ VERIFIED | Migration linha 82: `AND (_sku IS NULL OR o.sku = _sku)` — usa `o.sku`, nunca `o.variation_id` |
| 3 | Quando `_sku` nulo, comportamento idêntico ao pai (Phase 79/81) | ✓ VERIFIED | Predicado `_sku IS NULL OR ...` é neutro por construção; 13 colunas de retorno, `GROUP BY 1`/`ORDER BY 1`, `SECURITY INVOKER`, `SET search_path` e todos os demais filtros (`status`, `_ml_user_ids`, `_from`, `_to`) idênticos linha a linha à migration anterior (79) — só o parâmetro e o predicado novo foram acrescentados |
| 4 | Dropdown de variação existe, default "Todas as variações (anúncio)", populado por SKU (`seller_custom_field`), oculto se `has_variations=false` | ✓ VERIFIED | `PrecoPraticadoReport.tsx:600-619` — `{selectedItem?.has_variations && (<Select .../>)}`; item fixo `value="__all__"` = "Todas as variações (anúncio)" (linha 609-611); opções vêm de `variacoesInfo.opcoes` = `resumoVariacoes(...)`, que filtra `v.seller_custom_field != null` (`variacoesResumo.ts:37`) |
| 5 | Reset do seletor ao trocar de anúncio | ✓ VERIFIED | `PrecoPraticadoReport.tsx:270-273` — `useEffect(() => { setSelectedSku(null); }, [selectedId])`, dedicado e separado do effect que mantém `selectedId` válido |
| 6 | As duas chamadas RPC passam `_sku` quando variação selecionada | ✓ VERIFIED | `PrecoPraticadoReport.tsx:327` (série temporal) e `:382` (histograma diário) — ambas `_sku: selectedSku`, e `selectedSku` está nas deps dos dois `useEffect` (linhas 354, 394) — refetch automático ao trocar |
| 7 | Estoque injetado é o da variação (join por `seller_custom_field`, NÃO `variation_id`) quando há SKU selecionado; senão o do pai | ✓ VERIFIED | `PrecoPraticadoReport.tsx:465-470` — `estoqueAtual` = `estoqueDaVariacao(selectedItem?.variations ?? [], selectedSku)` quando `selectedSku != null`, senão `selectedItem.available_quantity`; `estoqueDaVariacao` (`variacoesResumo.ts:59-63`) faz `v.seller_custom_field === sku`, nunca `variation_id` |
| 8 | Badge de variação + aviso no nível pai existem | ✓ VERIFIED | Badge: `PrecoPraticadoReport.tsx:623-627` (`"Analisando variação: {label}"`, só quando `selectedVariacaoOption` não-nulo). Aviso: linhas 645-651 (`"Anúncio com N variações (M esgotadas) — selecione uma variação para cobertura precisa"`, só quando `has_variations && selectedSku == null && total > 0`) |

**Score:** 8/8 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260682000000_orders_price_timeseries_sku.sql` | Migration DROP+CREATE com `_sku` opcional | ✓ VERIFIED | Existe, 94 linhas, contém `_sku text DEFAULT NULL`, `DROP FUNCTION`, predicado correto |
| `src/lib/variacoesResumo.ts` | Util puro `resumoVariacoes`/`estoqueDaVariacao` | ✓ VERIFIED | 64 linhas, exporta ambas funções, zero I/O (só recebe `ProductVariation[]`) |
| `src/lib/variacoesResumo.test.ts` | Testes incluindo caso-prova SKU …420603 | ✓ VERIFIED | 8 testes, inclui `"caso-prova real: SKU …420603 estoque 19"` (linha 91-93) |
| `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` | Dropdown, `_sku` na RPC, estoque condicional, badge, aviso | ✓ VERIFIED | Diff focado vs Phase 81 (`0b7a8149`): 85 inserções/8 remoções, todas nas áreas descritas (linhas 30, 257-259, 270-273, 280-288, 327, 382, 465-470, 597-651) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Dropdown de variação | `variacoesInfo.opcoes` | `resumoVariacoes(selectedItem?.variations ?? [])` ← `MLInventoryContext` (`rowToItem`, linha 79-87, lê `row.variations` real do `ml_inventory_cache` via sync ML) | Sim — não é array hardcoded; depende do item selecionado no contexto real | ✓ FLOWING |
| `estoqueAtual` (variação) | `estoqueDaVariacao(...)` | Lookup no mesmo array `selectedItem.variations` (jsonb real) | Sim | ✓ FLOWING |
| Série do histograma/temporal | `rows`/`dailyRows` | `supabase.rpc("orders_price_timeseries", { ..., _sku: selectedSku })` — chamada real à RPC de produção | Sim (depende do smoke em prod — ver human_verification #2) | ✓ FLOWING (pendente confirmação de prod, ver item 2 do human_verification) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Testes unitários do novo util (incl. caso-prova real) passam | `npx vitest run` | 374/374 testes verdes em 25 arquivos, incluindo `src/lib/variacoesResumo.test.ts (8 tests)` e `src/lib/precoFaixas.test.ts (32 tests)` inalterado | ✓ PASS |
| Typecheck limpo (novo código + integração com contexto/tipos existentes) | `npx tsc --noEmit` | Saída vazia, exit 0 | ✓ PASS |
| `precoFaixas.ts`/`precoMcoSeries.ts` intactos vs fechamento da Phase 81 | `git diff 0b7a8149 HEAD --stat -- src/lib/precoFaixas.ts src/lib/precoMcoSeries.ts` | Saída vazia (nenhuma mudança) | ✓ PASS |
| Ausência de scope creep ("sustentável" / "% rompido") | `grep -rni "sustentavel\|rompid" src/lib/variacoesResumo.ts src/lib/precoFaixas.ts .../PrecoPraticadoReport.tsx` | Sem matches | ✓ PASS |
| Ausência de debt markers nos arquivos tocados | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` nos 4 arquivos da fase | Sem matches | ✓ PASS |
| RPC aplicada em produção (deploy real) | fora do alcance — sem MCP/CLI Supabase autenticado neste sandbox | Não executável por este verificador | ? SKIP (ver human_verification #2) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| APV-RPC-SKU | 82-01 | RPC `orders_price_timeseries` com `_sku` opcional | ✓ SATISFIED | Migration correta e consistente com o padrão anti-IDOR das fases 63/69/79 |
| APV-UI-SELECTOR | 82-03 | Dropdown de variação em `/analise-precos` | ✓ SATISFIED | `PrecoPraticadoReport.tsx:597-619` |
| APV-UI-AVISO-PAI | 82-03 | Badge + aviso no nível pai | ✓ SATISFIED | `PrecoPraticadoReport.tsx:621-651` |

Nenhum requirement órfão encontrado no ROADMAP para a Phase 82 (fase marcada como "ad-hoc — nenhum requirement ID" no cabeçalho do roadmap, e os 3 IDs usados nos PLANs são consistentes entre si).

### Anti-Patterns Found

Nenhum. Nenhum `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` nos 4 arquivos tocados pela fase. Nenhuma métrica agregada "giro sustentável + % rompido" (explicitamente fora de escopo no CONTEXT.md) presente em código. `estoqueDaVariacao` retorna `null` (não `0`) quando o SKU não é encontrado — evita inventar dado, consistente com o padrão do resto do arquivo.

### Human Verification Required

#### 1. Validação visual em `/analise-precos`

**Test:** Abrir `/analise-precos`, selecionar um anúncio com variações (ex.: MLB4113792113), interagir com o dropdown de variação (selecionar, trocar, voltar para "Todas"), trocar de anúncio e confirmar que o seletor reseta. Testar light+dark, mobile+desktop.
**Expected:** Dropdown aparece só quando `has_variations=true`; badge "Analisando variação: …" aparece/desaparece corretamente; aviso "Anúncio com N variações (M esgotadas)…" aparece só no nível pai; histograma/giro/cobertura mudam de fato ao trocar variação.
**Why human:** Comportamento de runtime (render condicional, refetch reativo, layout responsivo) — o próprio 82-03-SUMMARY.md já lista este item como pendente ("Checkpoint Visual… ainda não foi feita pelo Wesley — recomendado antes do merge do PR #27").

#### 2. Confirmação de estado de produção da migration

**Test:** Via MCP Supabase (`list_migrations` / `execute_sql`) no projeto `ckcdevcxgvueywivefgx`, confirmar que `orders_price_timeseries_sku` está na lista de migrations aplicadas e reproduzir o smoke: RPC de 5 args (pai) vs 6 args (`_sku`) para MLB4113792113, comparando cobertura ~6d (pai) vs ~0d (SKU …420603).
**Expected:** Ambas as assinaturas coexistem sem erro; números batem com os documentados em `82-02-SUMMARY.md`.
**Why human:** Este verificador não possui `SUPABASE_ACCESS_TOKEN` nem sessão `supabase login` neste sandbox — não há como executar `execute_sql`/`list_migrations` diretamente. A evidência disponível (82-02-SUMMARY.md com números que batem com a validação manual pré-implementação do 82-CONTEXT.md) é consistente mas não é prova direta de estado do banco.

### Gaps Summary

Nenhum gap bloqueante encontrado no código. A fase entrega exatamente o que o goal do roadmap descreve, com evidência de arquivo:linha para cada truth, testes reais executados nesta sessão (não copiados do SUMMARY) e diffs `git` confirmando que `precoFaixas.ts`/`precoMcoSeries.ts` não foram tocados. Os dois itens em `human_verification` são checkpoints de validação humana/infraestrutura já esperados pelo próprio fluxo da fase (o 82-03-SUMMARY.md explicitamente adia a validação visual para antes do merge do PR #27) — não são evidência de trabalho incompleto no código.

---

*Verified: 2026-07-03T01:15:00Z*
*Verifier: Claude (gsd-verifier)*
