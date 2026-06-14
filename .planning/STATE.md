---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: milestone
status: executing
stopped_at: Phase 48 context gathered
last_updated: "2026-06-14T19:28:26.606Z"
last_activity: 2026-06-14 -- Phase 45 marked complete
progress:
  total_phases: 8
  completed_phases: 4
  total_plans: 18
  completed_plans: 15
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v7.0 — SaaS Operacional End-to-End
**Core value:** Sistema 100% operacional e vendável como assinatura — dados verdadeiros em todas as páginas (zero mock), multi-tenant endurecido, monetização via Stripe ativa, onboarding guiado para lojista leigo, e Consultor v1 (motor de regras + score de saúde) como diferencial de venda.
**Current focus:** Phase 45 — consultor-v1

## Current Position

Phase: 45 — COMPLETE
Plan: 1 of 3
Status: Ready to execute
Last activity: 2026-06-14 -- Phase 45 marked complete

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260613-2p6 | DRE mês-calendário exato (01–31) via ml_billing_daily | 2026-06-13 | feat(dre) | [260613-2p6](./quick/260613-2p6-dre-mes-calendario-exato-01-31-via-ml-bi/) |

### DRE mês-calendário (quick 260613-2p6, 2026-06-13)

- **Problema:** ciclo de fatura ML = dia 06→05 (não mês-calendário). Card do mês corrente mostrava ~7 dias de tarifa vs 30 de receita → lucro inflado (jun ~R$27k, real ~R$11k).
- **Solução:** tabela `ml_billing_daily` (agregado por dia+tipo, competência = data de lançamento), EF v8 modo `daily` (pagina /details ML+MP **sequencial** — offset é instável sob concorrência), cascata daily→fatura mensal→estimado no card, badge "mês 01–31".
- **Regra de reconciliação:** estornos B* só contam se a venda caiu na janela de consumo da fatura (ML exclui estornos de vendas antigas). Reconcilia 99,8%.
- **Backfill mar–jun** validado vs faturas (±0,2–2%). **2026-05/consumo-abril subcontado −1,7%** (paginação offset instável no backfill pg_net) — EF corrige ao re-sincronizar; mês corrente OK.
- **Pendente:** checkpoint visual Wesley (badge "mês 01–31", lucro junho ~R$11k).

### DATA-01 executado (2026-06-12, commit fc090c46)

- Migration `20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve` aplicada em produção (ckcdevcxgvueywivefgx)
- **ATENÇÃO:** migration local `20260601000000` foi REMOVIDA do repo — nunca aplicada e continha batch_upsert_orders sem cast ::uuid (reverteria fix da Phase 38)
- Validado via SQL: get_cost_waterfall jun/01-12 → paid_revenue R$115.195, CMV R$46.165, tax R$23.667 não-nulos (402 orders); fallback + COALESCE + cast ::uuid confirmados via pg_get_functiondef
- Pendente: confirmação visual de Wesley no card "Custos" em /vendas (CMV e Impostos aparecendo)
- Descoberta: produção tinha 0 orders com receita_bruta NULL (backfill virou no-op idempotente); o bug ativo era só a definição das funções
- Supabase CLI local linkado no projeto ERRADO (gionpsuunfkkzzjdubfy) — não usar `db push`; aplicar migrations via MCP apply_migration no ckcdevcxgvueywivefgx

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 41. Veracidade Total | TBD | — | — |
| 42. Zero Mock | TBD | — | — |
| 43. Multi-Tenant Hardening | TBD | — | — |
| 44. Monetizacao Stripe | TBD | — | — |
| 45. Consultor v1 | TBD | — | — |
| 46. UX para Leigos | TBD | — | — |
| 47. QA End-to-End + Go-Live | TBD | — | — |
| Phase 41-veracidade-total P03 | 15 | 3 tasks | 1 files |
| 41 | 4 | - | - |
| Phase 42-zero-mock P01 | 30min | 3 tasks | 4 files |
| Phase 42-zero-mock P04 | 3min | 1 tasks | 1 files |
| Phase 43-multi-tenant-hardening P01 | 205 | 3 tasks | 4 files |

## Accumulated Context

### Decisions

- Phase 17-02: item_id placeholder "TINY_{sku}" used in ml_product_costs because sync-ml-orders keys costMap by item_id (not seller_sku) — follow-up needed to wire SKU-based cost lookup in sync-ml-orders
- Phase 18-02: Tiny OAuth state elevated to Integrations parent scope (same pattern as ML OAuth)
- Phase 18-02: sync-tiny-costs now uses stored tiny_access_token + refresh via tiny-oauth (no client_credentials)
- Phase 18-02: tiny token columns added to types.ts manually (not regenerated from Supabase schema)
- Fonte primária de comissão/frete: `ml_orders` (orders individuais via ML API)
- Fonte primária de CFFE/CFONPN: `ml_billing_monthly` (ML Billing API `/billing/periods`)
- Phase 14 e Phase 15 são independentes entre si (podem ser executadas em paralelo)
- Nexo MCP Supabase: `muesqdxnjlbaoiqylpjn` — estrutura de referência para schemas
- Scope garment-glow: sempre `organization_id` + `ml_user_id` (não apenas `seller_id`)
- Milestone anterior v6.0 completo — brand charts, sync de orders e ads spend reais funcionando
- **Supabase project correto: ckcdevcxgvueywivefgx** (CLAUDE.md menciona gionpsuunfkkzzjdubfy — desatualizado, sempre usar ckcdevcxgvueywivefgx)
- Gateway de pagamento: Stripe (checkout + webhook + customer portal)
- Entrada de clientes: convite controlado (self-service signup fica para v2)
- Consultor v1: motor de regras determinístico (~12 regras + score 0-100), sem LLM por usuário
- /perguntas e /devolucoes: integração real (ML Questions API + Claims API — portar padrão do Nexo MCP)
- [Phase ?]: DATA-05: guard columnView removido do commCache useEffect — comissao real populada para todos os itens filtrados
- [Phase ?]: DATA-06: /vendas e /financeiro confirmados usando useMLCostWaterfall como fonte unica — sem fix de codigo necessario
- [Phase ?]: vault.secrets service_role_key deferred to plan 42-02: Wesley must insert SERVICE_ROLE_KEY before pg_cron migration is applied
- [Phase ?]: 42-04: Sellers loaded from sellers table scoped to currentOrg.id filtered ML-connected via ml_tokens
- [Phase ?]: RLS org-first usa is_org_member/get_org_role em ml_product_costs; user_id mantido como auditoria (D-10/D-11)
- [Phase ?]: Backfill de orfaos via ml_tokens (nao organization_members) para evitar duplicacao multi-org (D-02)
- [Phase ?]: ml_billing_monthly trocado de FOR ALL para FOR SELECT — viewer nao escreve billing (ME-06/D-15)
- [Phase 43-04]: TENANT-05 confirmado — teste de isolamento 2-org (Pé Vermeio + Thales) via MCP: 0 vazamentos cross-org em 15 tabelas scope-org; ME-04/05/06 e quota PASS. Veredito PASS, sem FAIL
- [Phase 43-04]: Método de verificação de RLS = impersonação `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims',...,true)` em transação ROLLBACK (service_role bypassa RLS)
- [Phase 43-04]: RESSALVA `ml_targets` sem `organization_id` (scope user_id/seller_id) — fora do loop por-org; verificação dedicada recomendada na code-review/verify-phase

### Nexo MCP Data Reference (análise 2026-05-21)

Abril/2026 — Pé Vermeio (seller_id=1639558873):

- Receita bruta orders: R$351.236
- Comissão real (sum orders.comissao): R$39.170 (11.15%)
- Frete real (sum orders.frete): R$37.555 — mas CFFE billing R$40.065 (inclui extras)
- CFONPN (parcelamento): R$15.902 — INVISÍVEL hoje
- PADS (publicidade): R$12.341
- Bonificações BVVML: −R$3.004

Dashboard atual mostra:

- Frete: ~R$17.561 (5% hardcoded) → erro de R$22.504
- CFONPN: R$0 → erro de R$15.902
- Total custos subestimados: ~R$38.406/mês

### Pending Todos

- Rodar `/gsd-plan-phase 41` — plans prontos para DATA-01 (32-01), DATA-02 (31-01), DATA-03 (21-01) devem ser referenciados e reaproveitados pelo planejador
- Testar sync Tiny ERP em /integracoes → clicar "Sincronizar Custos" → verificar `SELECT COUNT(*) FROM ml_product_costs WHERE cost > 0;`

### Blockers/Concerns

- A `mercado-libre-integration` usa Deno — cuidado com o tamanho da função ao adicionar upsert em `ml_orders`
- ML Billing API pode ter formato diferente de `/orders` — validar campos CFFE e CFONPN durante planejamento da Phase 41 (bloco DATA-04)
- ML Claims/Questions API: rate limits e formatos — mitigar portando lógica já validada do Nexo MCP (/root/nexo-mcp/)
- Stripe em 1 dia é apertado — escopo mínimo: checkout + webhook + portal (sem proration custom)
- Phases 28/29 (performance) ficam condicionais — só entram no dia 10 (Phase 47) se QA mostrar lentidão real

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v5.1 | Filtros por estado/cidade/SKU no dashboard | Deferred | Roadmap v5.0 |
| v5.1 | Billing para outras contas além da Pé Vermeio | Deferred | Roadmap v5.0 |
| v5.1 | DIFAL, CSHIA e outras cobranças menores do billing | Deferred | Roadmap v5.0 |
| v6.0 | Melhorias em outros menus (Publicidade, Estoque, Financeiro) | Deferred | Roadmap v5.0 |
| v8.0 | Self-service signup público | Deferred | Roadmap v7.0 |
| v8.0 | Consultor com análises geradas por LLM | Deferred | Roadmap v7.0 |
| v8.0 | Phase 23 dashboard granular (coluna Margem % em Top Anúncios, dual-axis) | Deferred | Roadmap v7.0 |
| v8.0 | Phases 28/29 performance — só entram se QA mostrar lentidão | Conditional | Roadmap v7.0 |
| v8.0 | Landing page pública de marketing/pricing | Deferred | Roadmap v7.0 |

## Session Continuity

Last session: 2026-06-14T19:01:10.451Z
Stopped at: Phase 48 context gathered

### Sessão 2026-06-14 — Phase 43 fechada (43-04 isolamento)

- **43-04 (Wave 3) COMPLETO** — ISOLATION-TEST.md (roteiro reproduzível 2-org) escrito (commit b8656049) + executado via MCP no `ckcdevcxgvueywivefgx` com as 2 orgs reais (Pé Vermeio `7f615df7-...` MLUID 1639558873 / Thales `e4150d57-...` MLUID 427063369) (resultados commit f3b383bf).
- **Veredito PASS:** §2 RLS bidirecional 0 vazamentos em 15 tabelas scope-org; §4 ME-06 INSERT billing sob owner → ERROR 42501 (só FOR SELECT); §5 ME-05 guard is_org_member nas 3 EFs (código); §6 ME-04 ORDER BY updated_at nas 4 EFs (v20/v9/v10/v9); §7 TENANT-03 check_quota [t,t,t,f,f] limite=3 + enterprise sempre true.
- **Pendentes não-bloqueantes:** ME-05 comportamental ao vivo (JWT de sessão no browser, Wesley); confirmação visual frontend por org; ressalva `ml_targets` (sem organization_id) → verificação dedicada na code-review/verify-phase.
- **Aprendizado:** gsd-executor não tem MCP/deploy Supabase → Task 2 (checkpoint blocking) executada pelo orquestrador; executor só escreveu o roteiro (Task 1).

### Sessão 2026-06-13 — Fechamento Phase 41

**41-04 finalizado:**

- EF sync-ml-billing v4 deployada (bonuses B* nos charges) → depois v6 com fix HI-01 (404 ≠ 401/429/5xx); smoke 401 OK
- Re-sync mar–jun JÁ tinha sido feito no fim da sessão anterior (synced_at 18:54/19:50) — validado: cancelamentos jun -674,87 / mai -6.820,03 / abr -8.895,29 / mar -9.301,68; jun CFONPN 3.008,28 EXATO
- Frontend: linha "Cancelamentos de tarifas" (última, líquido = total_amount da fatura) + navegação ‹ Mês/Ano › no card (dreMonthOverride, reset ao mudar filtro, canGoNext≤mês corrente) + useMLBillingWithSync (sync on-demand via user JWT, 1 tentativa por escopo+período, falha libera retry)

**Fechamento:**

- gsd-verifier: PASSED 12/12 (VERIFICATION.md)
- Code review: 18 findings (1C/3H/6M/8L) em REVIEW.md — corrigidos na hora: CR-01 (merge multi-loja no useMLBilling), HI-01 (EF status branch), HI-02 (useMLSync re-sync mês anterior), HI-03 (MLAnuncios chunks de 5), ME-01 (loading DRE), ME-02/03 (attemptKey por escopo + retry), LO-07 (prop morta)
- **Deferidos → Phase 43 (Multi-Tenant Hardening): ME-04/05/06** (ml_tokens lookup não-determinístico, enumeração ml_user_id, RLS viewer com INSERT/UPDATE/DELETE em billing). Lows no REVIEW.md.
- REQUIREMENTS.md: DATA-01..06 marcados Complete; phase.complete OK
- Checkpoint visual de Wesley sobre cancelamentos + navegação de meses: **pendente** (verificar card Custos em /vendas)

**Pós-fechamento (mesma sessão, decisão Wesley — opção C):**

- **Ciclo REAL da fatura ML da conta: dia 06 → dia 05 do mês seguinte** (não mês-calendário). Confirmado via /billing/periods: key 2026-06 = 06/mai–05/jun. O DRE mantém o espelho da fatura e exibe a janela real no card ("Tarifas da fatura ML: 06/05 → 05/06"). EF v7 grava resumo.invoice_from/invoice_to; período OPEN tem date_from anômalo (placeholder) → derivado de date_to. Backfill mar–jun feito. Commit 86314ee7.
- ~~Observação não investigada~~ **RESOLVIDO (2026-06-13)**: a diferença de 2.241,18 na fatura key 2026-04 é o type **CSHIA = "Tarifa por disponibilidade antecipada de dinheiro em conta"** (antecipação de recebíveis MP): 2 lançamentos em março (08/03 R$1.097,11 + 16/03 R$1.144,07). CSHIA pertence ao **group MP**, não ML — o `amount` da listagem de periods (group=ML) o exclui; o `bill_includes.total_amount` do summary (nossa fonte) inclui a fatura completa (ML+MP). Nosso número (113.742,18) é o correto/oficial. CSHIA hoje cai no bucket "Outras tarifas" do DRE.

**Aprendizados de domínio (manter):**

- Fatura ML = mês de fechamento; consumo N → fatura N+1 (chave period 2026-07 existe em 12/jun = fatura corrente)
- Janela da fatura = ciclo da conta (06→05), varia por conta; receita do DRE é mês-calendário — descasamento de borda ~5 dias é explícito no card
- Cancelamentos/estornos em bill_includes.bonuses (types B*), negativos; total_amount = charges + bonuses
- Referência "abril" do Nexo na memória era fatura de abril = consumo de MARÇO (Nexo rotula por fatura)
- Invocar EF programaticamente: net.http_get/post com token de ml_tokens (ML API direto); key sb_secret do cron ≠ SERVICE_ROLE_KEY env → 401 esperado na EF
- Decisão Wesley: card Custos = DRE mensal (sempre mês), espelhando a fatura ML; demais cards seguem o filtro

---

## Sessão 2026-06-04 — Phases 36/37/38

**Phase 36 (concluída, deployada)** — brand charts via ml_product_daily_cache fallback

- Migration `marca` em ml_product_daily_cache + mercado-libre-integration busca BRAND
- useMLOrdersByBrand: fallback para cache quando orders vazio

**Phase 37 (deployada)** — markup por marca via seller_sku

- Root cause: ml_product_costs.item_id = `TINY_<sku>` mas cache.item_id = `MLB...` → join nunca casava
- Ponte correta: seller_sku (`seller_custom_field` no ML)
- Migration `seller_sku` em ml_product_daily_cache (20260604120000)
- mercado-libre-integration v12: popula seller_sku
- recalc-order-costs v13: usa orders.sku → costs.seller_sku (prioridade Tiny) + fallback item_id legado
- useMLOrdersByBrand: join por seller_sku
- PENDENTE: aguardar próximo sync para popular seller_sku no cache; validar markup carregando

**Phase 38 (concluída)** — validar 5 páginas do dashboard

- Causa raiz: orders congelou em 2026-05-27 — batch_upsert_orders falhava e o erro era mascarado
- Fixes: cast ::uuid + JSON.stringify fix + throw em erros + mercado-libre-integration v13 service-role
- Commits: 0f31e710, f69a8bc1

**Phase 39 (concluída)** — /anuncios custo + /publicidade produtos

- /anuncios: costFor() com fallback por seller_sku (useMLProductCosts expõe costsBySku)
- /publicidade: sync-ads v18 com metrics params + constraint única dropeada
- Backfill 30 dias: spend real populado
- Commits: 57bbb9aa, cb0ec5c9

**Phase 40 (concluída)** — fix charts overlap brand row

- min-w-0 overflow-hidden nos 3 Card raízes de BrandRevenueChart, BrandMarkupChart, CustoOperacionalChart
- Commits: confirmados e deployados via Vercel

**Deploys confirmados (project ckcdevcxgvueywivefgx):**

- mercado-libre-integration v13 ACTIVE
- recalc-order-costs v13 ACTIVE
- sync-ads v18 ACTIVE
