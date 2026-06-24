---
gsd_state_version: 1.0
milestone: v8.0
milestone_name: Consultor v2 (Inteligência)
status: planning
last_updated: "2026-06-23T23:15:47.482Z"
last_activity: 2026-06-23
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

## ✅ Milestone v7.0 FECHADO (2026-06-24) + Phase 46 concluída

- **Phase 46 (UX para Leigos) — COMPLETA.** Plano 46-04 (checkpoint): gate técnico OK (`tsc --noEmit` sem erros, `npm run build` limpo 15s); glossário central de **28 termos** (`src/lib/kpi-glossary.ts`) com redação leiga **aprovada por Wesley**; checkpoint visual (tooltips hover+tap, empty states, tabelas→cards mobile, dark mode nas 6 páginas) **confirmado por Wesley** (validado em sessões anteriores). Cobertura UX-01: 15 telas consomem KPICard.
- **Milestone v7.0 FECHADO sem Stripe** — Phase 44 (Monetização Stripe) **deferida** por decisão de Wesley (versão de teste não precisa de pagamento; planos 44-01/02/03 existem para reativação futura). Phases 41,42,43,45,46,48,49,50,51 completas; 47 go-live técnico (PR#6).
- **Limpeza de planning commitada** (decisão Wesley): 252 planos de phase (`.planning/phases/*`) removidos do working tree + `REQUIREMENTS.md` reescrito para o v8.0. Planos preservados no histórico git (até commit fc7fbad5).
- **Próximo:** Milestone v8.0 — Consultor v2 (Inteligência). Research concluído (commits 5cf049b6 + fc7fbad5, 2026-06-23). Falta: definir requisitos + roadmap das phases.

## Fechamento Phase 47 — QA / Go-Live (2026-06-20, escopo técnico sem Stripe)

Decisão Wesley: pular tudo de assinatura/Stripe ("esta versão é só testes"). Critérios cobertos:

- **Build/deploy:** tsc --noEmit + npm run build limpos; prod READY.
- **Segurança (críticos corrigidos em prod via MCP):** migration `20260650000400_phase47_security_hardening` →
  (1) RLS habilitado em `cat_backfill_queue` (era advisor ERROR rls_disabled_in_public);
  (2) REVOKE total (anon/PUBLIC) em `batch_upsert_orders` + `upsert_order_preserve_cost` (anon escrevia pedidos via REST). EFs de sync usam service_role, sem regressão.

- **EFs de debug neutralizadas** (deploy stub 410, sem token p/ delete): `temp-reset-password` (backdoor reset-senha sem auth) e `probe-tiny-map`. Remoção definitiva do endpoint: dashboard ou `supabase functions delete` (requer SUPABASE_ACCESS_TOKEN).
- **EFs de negócio:** verify_jwt=true confirmado (ml-ads/inventory/reputation/precos-custos/recalc-order-costs/org-*/admin-*).

**Backlog não-bloqueante (deferido p/ go-live real):** ~13 helper/cron SECURITY DEFINER chamáveis por anon (enumeração, não escrevem); 9 funções search_path mutável; leaked-password protection off (config Auth); validação E2E de tenant-novo (depende de Stripe/Phase 44).

**Restam no milestone v7.0:** Phase 44 (Stripe) — adiada por decisão (não será o Wesley a organizar assinatura).

# Project State

## Project Reference

See: .planning/PROJECT.md

**Milestone:** v8.0 — Consultor v2 (Inteligência)
**Core value:** Consultor que explica, prioriza e ajuda a agir — LLM sob demanda + ações com aprovação, sobre o motor determinístico do v1.
**Current focus:** Definindo requisitos (pesquisa de domínio em andamento).

## Current Position

Phase: **52 (Fundação de Dados v8.0) COMPLETA** — verifier PASSED 6/6, aplicada em prod ckcdevcxgvueywivefgx
Plan: 52-01 (4 migrations) + 52-02 (types.ts) — ambos completos
Status: Phase 52 fechada; desbloqueia 53/54/55/56
Last activity: 2026-06-24 — Phase 52 executada (3 tabelas novas + 5 colunas + RPC atômica INVOKER, advisors sem erro novo, build verde)
Next: `/gsd-plan-phase 53` (Camada LLM) e/ou `/gsd-plan-phase 54` (Pipeline de Ações) — podem rodar em paralelo

### Phase 52 (2026-06-24) — schema v8.0 em prod
- 3 tabelas novas: `proposed_actions` (state-machine 6 estados text+CHECK + dedup parcial), `action_audit_log` (append-only), `llm_analysis_cache` (org-first key).
- ALTERs: `insights.snoozed_until`/`snooze_count`, `consultor_config.llm_enabled`/`llm_model`, `consultor_health_snapshots.ml_user_id_key` (+ troca UNIQUE p/ por-loja).
- RPC `claim_approved_action` SECURITY INVOKER (anti-IDOR) + REVOKE de PUBLIC/anon/authenticated (anti default-EXECUTE).
- 4 migrations `20260652*` commitadas; aplicadas via MCP (CLI no projeto errado — nunca db push). types.ts manual.
- **WARNING aberto (não-bloqueante, p/ Phase 56):** mapeamento TUNE-01 → 14 limiares existentes é MEDIUM confidence; confirmar com Wesley se quer limiares-alvo NOVOS antes da 56.

### Pendências de validação visual (não bloqueiam novo milestone)

- Checkpoint visual do painel de Tesouraria (Phase 51) por Wesley.
- Card "Caixa Hoje": conferir saldo inicial (efeito do fix de fuso BRT pode estar 1 dia adiantado; ajustável pelo botão).

### Fechamento Phase 51 (2026-06-20) — EM PROD via PR#4 (merge 69883b00) + fix mobile PR#7 (101754ef)

### Fechamento Phase 51 (2026-06-20)

- **Verifier:** PASS 5/5 (TESO-01..05), build limpo (51-VERIFICATION.md).
- **Code review:** 1 Critical + 4 High (51-REVIEW.md). HG-02 e HG-04 = falsos positivos vs prod (já BRT / já bounded). Reais corrigidos + aplicados em prod via MCP (commit 1d1750c4):
  - CR-01: enrich_drain token Tiny hardcoded (1639558873) → token por org da fila + REVOKE de PUBLIC/anon/authenticated. (latente: só Pé Vermeio usa Tiny hoje)
  - HG-01: card "Saldo Mín" → horizonte 30d (decisão Wesley); RPC retorna min_balance (valor) + data do mesmo modelo. −719k/90d → −168k/30d.
  - HG-03: burn_rate só status='paid' (R$185.149) consistente c/ Saída Real (decisão Wesley). Antes R$189.316 (incluía 9 contas vencidas).
- Migrations prod: treasury_fix_cr01_enrich_drain_security, treasury_fix_hg01_hg03_panel. Arquivo repo: 20260650000200.
- **STATUS:** push + deploy frontend CONCLUÍDOS (PR#4 merge 69883b00, em prod). Único item aberto = checkpoint visual de Wesley (não bloqueante).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260613-2p6 | DRE mês-calendário exato (01–31) via ml_billing_daily | 2026-06-13 | feat(dre) | [260613-2p6](./quick/260613-2p6-dre-mes-calendario-exato-01-31-via-ml-bi/) |
| 260618-sum | Fluxo de caixa: RPCs consideram contas a pagar de QUALQUER status (paid+pending), futuro-only | 2026-06-18 | 5652ebfa | [260618-sum](./quick/260618-sum-corrigir-rpcs-de-fluxo-de-caixa-consider/) |
| 260618-sma | Fluxo de caixa: 2ª linha de projeção (média 15d via orders) — AGUARDA validação Wesley | 2026-06-18 | fe19611d | [260618-sma](./quick/260618-sma-segunda-linha-projecao-media-15d/) |
| 260619-02b | Fluxo de caixa: base da média 15d = bruta−comissão−frete (sem dupla imposto) + rótulo piso ~30d | 2026-06-19 | ddf946c8 | [260619-02b](./quick/260619-02b-trocar-base-da-linha-de-projecao-media-1/) |

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
| Phase 48-mco-com-ads P01 | 45min | 3 tasks | 3 files |
| Phase 48-mco-com-ads P02 | 30min | 3 tasks | 1 files |
| Phase 48-mco-com-ads P03 | ~3h | 2 tasks + 3 fixes + 1 checkpoint | 4 files |
| Phase 46-ux-para-leigos P01 | 4min | 3 tasks | 3 files |
| Phase 46 P02 | 213 | 3 tasks | 5 files |
| Phase 46 P03 | 90 | 2 tasks | 3 files |
| Phase 46-ux-para-leigos P05 | 8min | 2 tasks | 6 files |
| Phase 49-fluxo-de-caixa-caixa-real P01 | 45m | 3 tasks | 4 files |
| Phase 49-fluxo-de-caixa-caixa-real P03 | 15min | 2 tasks | 6 files |
| Phase 49 P04 | 20 | 2 tasks | 8 files |
| Phase 51-painel-de-tesouraria-fluxo-de-caixa P03 | 25min | 4 tasks | 4 files |

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
- [Phase ?]: SECURITY INVOKER (não DEFINER) para RPCs de margem: RLS org-first de orders/ml_ads_products_cache enforça isolamento de tenant; DEFINER era IDOR CRITICAL (bypass RLS com p_org_id alheio)
- [Phase ?]: PostgREST trunca em 1000 linhas apenas no endpoint REST; supabase.rpc() retorna set completo — sem LIMIT na RPC é suficiente para MCO-01
- [Phase ?]: ads_eating_margin é SEPARADO de margin_critical (D-07/MCO-04): produto com lucro operacional > 0 pode disparar ads_eating sem estar em margin_critical
- [Phase ?]: RULE ads_no_sale mantém rule_key='ads_no_sale' ao migrar org→item-level (D-09/D-10): índice único (org,rule_key,ml_user_id_key) diferencia '' de item_id; org-level antigo auto-resolvido
- [Phase ?]: Paginação .range() loop obrigatória em ml_ads_products_cache (~6000 linhas/30d): PostgREST trunca em 1000 linhas
- [Phase 48-03]: DRE não adiciona linha extra de Publicidade — groupBillingCharges já categoriza PADS em 'Campanhas de publicidade'; linha extra causaria dupla contagem (Pitfall 7 mais profundo que documentado)
- [Phase 48-03]: supabase.rpc() retorna set completo sem LIMIT; PostgREST select direto trunca em 1000 linhas — para conjuntos financeiros >1000 linhas/período, sempre usar RPC
- [Phase 48-03]: MCO-02 e MCO-03 satisfeitos e aprovados por Wesley no preview Vercel (dados reais ckcdevcxgvueywivefgx)
- [Phase 46]: Popover over Tooltip for KPICard: Radix Tooltip does not fire on touch; Popover with controlled open state is reliable on iOS/Android
- [Phase 46]: KPICard tooltip prop stays string (not GlossaryKey) — component stays generic; consumers do glossary lookup
- [Phase ?]: tip(key) helper defined in MLKPIGrid typed by keyof typeof KPI_GLOSSARY — tsc enforces valid glossary keys at compile time
- [Phase ?]: MLEstoque NotConnected CTA uses /integracoes (correct Portuguese route)
- [Phase ?]: Sub-tables kept overflow-x-auto scroll — secondary analytical views with column-comparison needs; primary CRUD tables upgraded to stacked cards
- [Phase ?]: Recharts SVG fill/stroke hex values preserved untouched — SVG attributes bypass Tailwind token system
- [Phase ?]: cash_outflows com schema Tiny criada no 49-01 compartilhada por 49-05
- [Phase ?]: release_date e outflow_date como DATE não timestamptz para cálculo de caixa por dia
- [Phase ?]: Mantido como média das saídas dos últimos 3 meses para diferenciar de Saída Real (30d)

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

Last session: 2026-06-19T18:27:04.447Z
Stopped at: Phase 51 planned + verified (3 plans, 3 waves)

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
