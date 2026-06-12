# Phase 41: Veracidade Total - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Source:** Express path — decisões aprovadas por Wesley em 2026-06-12 (`.planning/MILESTONE-v7-SAAS.md` + sessão de revisão)

<domain>
## Phase Boundary

Usuários veem KPIs financeiros corretos em /vendas, /financeiro e /anuncios — sem cálculos hardcoded, com billing real (CFFE/CFONPN) e fonte única consistente. Esta fase entrega APENAS veracidade de números (bloco DATA). Zero-mock (/perguntas, /devolucoes), multi-tenant, Stripe, Consultor e UX ampla são fases 42–47.

</domain>

<decisions>
## Implementation Decisions

### Estado de partida (CRÍTICO — não refazer trabalho)
- **DATA-01 JÁ EXECUTADO no backend (2026-06-12, commit fc090c46):** migration `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve` APLICADA em produção e validada via SQL (waterfall jun/01-12 → CMV R$46.165, tax R$23.667 não-nulos, 402 orders). O plano para DATA-01 deve conter SOMENTE validação visual no card "Custos" de /vendas e eventual fix residual de frontend — NÃO recriar a migration.
- A migration local `20260601000000` foi REMOVIDA do repo de propósito (continha batch_upsert_orders sem cast ::uuid — reverteria o fix da Phase 38). Nunca restaurá-la.

### Reaproveitamento de planos prontos (decisão do roadmap)
- DATA-02 (auto-recalc "Hoje") → adaptar/executar plano pronto `.planning/phases/31-auto-sync-cmv-impostos-pedidos-realtime/31-01-PLAN.md`
- DATA-03 (Lucro Bruto mensal fonte única) → adaptar/executar plano pronto `.planning/phases/21-lucro-cache/21-01-PLAN.md`
- Os planos da Phase 41 podem copiar esses planos com ajustes mínimos (renumerar, revalidar premissas contra o código atual — eles foram escritos semanas atrás).

### DATA-04 — Billing (ex-Phase 15, requisitos BILLING-01..06 do v5.0)
- Tabela `ml_billing_monthly`: colunas `id`, `organization_id`, `ml_user_id`, `period_month` (YYYY-MM), `charges` (JSONB array tipo+valor), `resumo` (JSONB totais), `synced_at`. RLS por organization_id (padrão `is_org_member`).
- Edge function `sync-ml-billing`: busca ML Billing API (`/billing/integration/periods` ou endpoint equivalente — pesquisa confirma) para um ml_user_id+period_month, upsert em ml_billing_monthly.
- Dashboard /vendas: linha "Frete ML" usa CFFE real quando billing disponível para o período (fallback: frete de orders), e NOVA linha "Parcelamento (CFONPN)" no breakdown de custos.
- Indicador visual de fonte: "billing" vs "estimado".
- Escopo: CFFE + CFONPN apenas. DIFAL/CSHIA/cobranças menores = out of scope (deferidas).

### DATA-05 — Comissão real em /anuncios
- Substituir `LISTING_TYPE_RATES` (hardcoded em src/data/financialMockData.ts) por tarifa real da API ML (`sale_fee` via /sites/MLB/listing_prices ou fee por item) por anúncio.
- Cache no DB ou em memória aceitável — decisão de implementação a critério do planner, coerente com padrão DB-first do projeto.

### DATA-06 — Consistência entre páginas
- /vendas, /financeiro e /anuncios devem usar a MESMA fonte para comissão/frete/CMV/impostos (useMLCostWaterfall como autoritativo, padrão já estabelecido na Phase 25).
- Validar contra referência Nexo Abril/2026: comissão R$39,2k, CFFE R$40k, CFONPN R$15,9k (seller 1639558873).

### Ambiente e deploy (REGRAS RÍGIDAS)
- Supabase de produção: **ckcdevcxgvueywivefgx** (o CLAUDE.md cita gionpsuunfkkzzjdubfy — DESATUALIZADO; o supabase CLI local está linkado nesse projeto errado — NUNCA usar `supabase db push`/`functions deploy` sem `--project-ref ckcdevcxgvueywivefgx`).
- Migrations: escrever arquivo em `supabase/migrations/` E aplicar via MCP Supabase `apply_migration` no ckcdevcxgvueywivefgx (padrão validado nesta sessão).
- Edge functions: deploy via MCP `deploy_edge_function` ou `npx supabase functions deploy <fn> --project-ref ckcdevcxgvueywivefgx`.
- Frontend: commit + push → Vercel auto-deploy.
- Multi-conta: existem 2 contas ML em produção (1639558873 Pé Vermeio + 427063369). Tudo escopado por organization_id + ml_user_id.

### Claude's Discretion
- Formato exato do parse da Billing API (charges → JSONB) — conforme pesquisa.
- Estratégia de cache da comissão real (tabela vs in-memory) — coerente com padrões existentes.
- Componentização da linha CFONPN e do indicador de fonte no MLCostCard.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Especificação do milestone
- `.planning/MILESTONE-v7-SAAS.md` — spec completa, decisões de Wesley, riscos
- `.planning/REQUIREMENTS.md` — DATA-01..06 com detalhes

### Planos prontos a reaproveitar
- `.planning/phases/31-auto-sync-cmv-impostos-pedidos-realtime/31-01-PLAN.md` — base do DATA-02
- `.planning/phases/21-lucro-cache/21-01-PLAN.md` — base do DATA-03
- `.planning/phases/32-fix-lucro-bruto-cmv-impostos/32-01-PLAN.md` — DATA-01 (backend JÁ FEITO; só validação visual)

### Histórico relevante
- `.planning/STATE.md` — seção "DATA-01 executado" + decisões acumuladas
- `supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` — estado atual das RPCs get_cost_waterfall/batch_upsert_orders
- `src/hooks/useMLCostWaterfall.ts`, `src/components/mercadolivre/MLCostCard.tsx` — consumidores do waterfall
- Requisitos BILLING-01..06 originais: seção "Bloco BILLING" do REQUIREMENTS.md do v5.0 (git history) — replicados em DATA-04

</canonical_refs>

<specifics>
## Specific Ideas

- Referência de validação (Nexo MCP, Abril/2026, Pé Vermeio): comissão real R$39.170 (11,15%), CFFE billing R$40.065 (vs frete orders R$37.555 — billing inclui extras), CFONPN R$15.902, PADS R$12.341, bonificações BVVML −R$3.004.
- Waterfall alvo: Receita Bruta → (−) Comissão → (−) Frete/CFFE → (−) Parcelamento CFONPN → (−) Publicidade → (−) CMV → (−) Impostos → = Lucro.
- O hook `useMLCostWaterfall` retorna null quando paid_revenue=0 — comportamento pós-fix correto (só dispara sem orders no período).

</specifics>

<deferred>
## Deferred Ideas

- DIFAL, CSHIA e cobranças menores do billing → Future Requirements (v8+)
- Billing para histórico longo (backfill de meses antigos) — sync do mês corrente + mês anterior basta para o lançamento
- UI-SPEC formal — UI desta fase é mínima; polish visual completo na Phase 46

</deferred>

---

*Phase: 41-veracidade-total*
*Context gathered: 2026-06-12 via express path (decisões da sessão de revisão v7.0)*
