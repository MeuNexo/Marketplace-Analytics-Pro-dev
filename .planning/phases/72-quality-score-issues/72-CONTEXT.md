# Phase 72: Aba Quality Score + Issues - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning
**Source:** Alinhamento (AskUserQuestion) + spec `docs/superpowers/specs/2026-06-29-anuncio-detail-modal-design.md` (seção 4, Fase B)

<domain>
## Phase Boundary

Fase B do milestone Modal de Detalhe do Anúncio. Enriquece a aba **Indicadores** (entregue na Phase 71) com a **saúde detalhada do anúncio** (lista de problemas/issues acionáveis), buscada AO VIVO via uma nova edge function quando o modal abre.

**Dentro do escopo:** EF nova (Deno) que chama a API de saúde do ML; hook/consumo lazy no `ListingIndicatorsTab`; UI da lista de issues em PT-BR.
**Fora do escopo:** sync em lote/tabela/cron; issues na tabela de catálogo; as outras abas (Vendas/Precificação/Avaliações/Histórico = Phases 73–76).
</domain>

<decisions>
## Implementation Decisions (LOCKED)

- **Busca ao vivo, on-demand:** a EF é invocada quando o modal abre (lazy, só para o anúncio aberto), com estados loading/erro/vazio. NÃO há sync em lote, tabela nova nem cron.
- **Só no modal:** issues aparecem só na aba Indicadores; nada na tabela de catálogo nesta fase.
- **API ML:** EF chama `GET https://api.mercadolibre.com/item/{id}/performance` com **fallback** `GET https://api.mercadolibre.com/items/{id}/health`. Espelha a `fetch-ml-listing-health` do projeto antigo (referência: `supabase/functions/fetch-ml-listing-health/index.ts` no repo `nexointeligence`, que converte `goals[]` → actions/issues e usa `health`/`level`).
- **Token ML + multi-conta:** resolver token org-scoped seguindo o padrão das EFs existentes do projeto (`supabase/functions/ml-inventory/index.ts`, `ml-token-refresh/index.ts`). Conta vinculada exige `ml_account_id`/seller; conta principal sem. Anti-IDOR: nunca retornar saúde de anúncio fora da org/seller do chamador.
- **Resiliência:** se a API ML falhar/expirar, a EF retorna estado explícito e o modal NÃO quebra; o quality score já existente (de `ProductItem.health`) continua aparecendo.
- **UI:** estender o `ListingIndicatorsTab` (Phase 71) com a seção de issues, reusando/estendendo `ListingQualityScore` ou um subcomponente novo isolado em `src/components/mercadolivre/anuncios/`. Issues em PT-BR, como lista acionável.

### Claude's Discretion
- Nome exato da EF (sugestão: `ml-listing-health`, seguindo o padrão `ml-*` do projeto), forma do payload de retorno, nome do hook (`useMLListingHealth`?), micro-componentes da lista de issues, cópia/tradução exata dos issues.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Referência da API de saúde (projeto antigo — só estrutura, não copiar token handling)
- `/tmp/claude-0/-root/30e04a02-c669-47fd-bfa8-5238a7b17d08/scratchpad/nexointeligence/supabase/functions/fetch-ml-listing-health/index.ts` — endpoints `/item/{id}/performance` + fallback `/items/{id}/health`, conversão de `goals[]`.

### Padrões do projeto atual a seguir
- `supabase/functions/ml-inventory/index.ts` — padrão de EF Deno que chama a API ML com token org-scoped e multi-conta.
- `supabase/functions/ml-token-refresh/index.ts` — refresh/uso de token ML.
- `src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx` e `ListingQualityScore.tsx` (Phase 71) — onde a seção de issues entra.
- `src/contexts/MLInventoryContext.tsx` — `ProductItem` (item_id, _ml_user_id) que o modal já tem.
- CLAUDE.md — Deno `std@0.168.0`, `@supabase/supabase-js@2` via esm.sh, zod; deploy de EF via MCP `deploy_edge_function`.
</canonical_refs>

<specifics>
## Specific Ideas

- O modal já tem `item.id` e `item._ml_user_id` — passar ambos para o hook/EF.
- Smoke test: invocar a EF contra um anúncio real (ex.: um MLB da Pé Vermeio) e confirmar que retorna issues coerentes.
</specifics>

<deferred>
## Deferred Ideas
- Cache/sync dos issues, badge na tabela de catálogo, e as demais abas — fases futuras.
</deferred>

---

*Phase: 72-quality-score-issues*
*Context gathered: 2026-06-29 via alinhamento + spec*
