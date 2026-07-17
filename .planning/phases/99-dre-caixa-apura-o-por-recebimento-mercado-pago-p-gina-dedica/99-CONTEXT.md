# Phase 99: DRE Caixa — apuração por recebimento Mercado Pago - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-16-dre-caixa-design.md — spec aprovada pelo Wesley em conversa 2026-07-16)

<domain>
## Phase Boundary

Página nova dedicada `/dre-caixa` que responde, em destaque, a pergunta do dono todo mês: **"o que entrou no mês pagou as contas do mês, ou tirei dinheiro de outro lugar?"** — apuração em regime de **caixa puro** usando dados que JÁ sincronizam em produção (`cash_inflows` do Mercado Pago + `cash_outflows` do Tiny). Backend = 3 RPCs novas; frontend = página completa (badge-resposta, KPIs, cascata com drill-down, evolução + histórico 12 meses), embrião de dashboard financeiro futuro.

**Fora do escopo:** confronto automático DRE faturamento × DRE caixa; monitor de venda (tarifa configurada × cobrada); entradas manuais (Bradesco/aportes); qualquer alteração na DRE por faturamento da página Vendas.

</domain>

<decisions>
## Implementation Decisions

### Base de entradas (LOCKED)
- Entradas = recebimento **líquido** MP: `cash_inflows.net_amount` somado por **`release_date`** (data de liberação) dentro do mês; para o mês corrente, só `release_date <= hoje`.
- Recebimento bruto (`gross_amount`) e "descontos na fonte" (bruto − líquido) são linhas **informativas**.
- Refunds: `net_amount` já vem negativo — a base já desconta; linha informativa "dos quais devoluções" (Σ net onde `status_mp='refunded'`).
- "Ainda a liberar no mês" = Σ `net_amount` com `release_date > hoje` e ≤ fim do mês (informativo; o sync já traz 45 dias à frente).

### Tarifas ML (LOCKED)
- **NÃO abater tarifas ML de novo** — já vêm retidas na fonte dentro do net do MP. `ml_billing_daily` NÃO entra nesta apuração.

### Régua de saídas (LOCKED)
- Caixa puro: `cash_outflows` com `status='paid'`, pela data de pagamento (`outflow_date`), dentro do mês. `cancelled` sempre excluídas. `competence_date` NÃO é usada aqui.
- **[AJUSTE Wesley 2026-07-16, durante checkpoint]: Fornecedores (bloco `excluido`) ENTRAM como saída na DRE Caixa** — linha "Fornecedores (compras)" na cascata, soma no resultado e no histórico. O conceito de "excluído" era da DRE por competência; aqui todo pagamento é saída.
- Blocos de categoria = reaproveitar o helper existente `dre_bloco_for_category(text)` (impostos_venda, pessoal, estrutura, servicos, operacional, financeiro, nao_classificado, excluido).
- `nao_classificado` > 0 → gate visual (mesmo aviso da DRE atual).

### Imposto (LOCKED)
- Guia **paga no mês** entra como saída real (dentro do bloco impostos_venda).
- Linha **informativa** de previsão: para cada um dos 3 meses fechados anteriores, `taxa_m = guias pagas no mês ÷ faturamento do mês (orders paid/shipped/delivered por data_pedido)`; previsão = média(taxa_m) × faturamento do mês corrente. Menos de 3 meses com dados → usar os que existirem; nenhum → previsão null (frontend mostra "—"). Alerta visual de desvio previsão × guia real.

### Cascata (LOCKED)
```
Recebimento bruto MP (informativo)
(−) Descontos na fonte (informativo)
    dos quais devoluções/refunds (informativo)
= RECEBIMENTO LÍQUIDO MP  ← base real
(−) Impostos (guias pagas) / Pessoal / Estrutura / Serviços / Operacional / Não classificado
= RESULTADO OPERACIONAL DE CAIXA
(−) Financeiro (empréstimos etc. pagos)
= RESULTADO DE CAIXA DO MÊS
```
- Badge-resposta no topo: verde "As entradas do mês pagaram as contas — sobrou R$ X" / vermelho "Faltou R$ X — esse dinheiro saiu de outro lugar". Mês corrente = selo "mês em andamento"; mês sem dados = badge neutro "sem movimentação".

### Backend (LOCKED)
- 3 RPCs, padrão obrigatório do projeto: `LANGUAGE sql STABLE SECURITY INVOKER SET search_path='public'`, 1º arg `p_org_id uuid`, RLS decide acesso, `REVOKE FROM PUBLIC, anon; GRANT TO authenticated`. **Sem subquery correlacionada** (timeout 8s do role authenticated — pré-carregar lookups em CTE).
  1. `get_dre_cash(p_org_id uuid, p_month date)` → `(secao text, bloco text, categoria text, total numeric, n int)`; seções `entrada` / `saida` / `previsao`.
  2. `get_dre_cash_items(p_org_id uuid, p_month date, p_bloco text)` → lançamentos individuais (outflow_date, supplier, category, amount) para drill-down sob demanda.
  3. `get_dre_cash_history(p_org_id uuid, p_months int)` → por mês até 12: (mes, entradas, saidas, resultado).
- Zero tabela/EF/cron novos. Cascata e totais montados no frontend (lib pura).

### Frontend (LOCKED)
- Página `src/pages/mercadolivre/MLDreCaixa.tsx`, rota lazy `/dre-caixa` + RoleRoute + item de menu (grupo financeiro).
- Hooks `useDreCash.ts`, `useDreCashItems.ts`, `useDreCashHistory.ts` (TanStack Query, padrão dos demais).
- Lib pura `src/lib/dreCashCascade.ts` (cascata + badge a partir das linhas da RPC) — testada com vitest, espelho de `dreCascade.ts`.
- Layout topo→baixo: header (seletor de mês + badge-resposta) → KPI row (4 tiles: Entradas líquidas · Saídas pagas · Resultado · Previsão imposto × guia) → cascata com drill-down (bloco → categorias → lançamentos) → gráfico evolução 12m (entradas × saídas × resultado) → tabela histórico 12m → banner dado-velho.
- Banner dado velho: `max(synced_at)` de `cash_inflows` > 6h → alerta; exibir também frescor de `cash_outflows` (token Tiny já morreu silenciosamente antes — lição 2026-07-13).

### Separações (LOCKED — crítico)
- **DRE por faturamento (página Vendas) INTOCADA** — nenhum arquivo dela é modificado.
- **NÃO ler nem confrontar saldo/`initial_balance`/projeções do Fluxo de Caixa** (`/fluxo-de-caixa`, `financial_settings`, `get_cashflow`, `get_treasury_panel`) — só as tabelas-fonte `cash_inflows`/`cash_outflows`.

### Claude's Discretion
- Componentização visual da página (reutilizar padrões de `src/components/financial/` e do `MLCostCard`).
- Escolha do componente de gráfico (Recharts, padrão do projeto).
- Formato exato do seletor de mês e microcopy secundária (manter linguagem para leigos do projeto).
- Nomes internos de tipos/interfaces TS.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec da phase (fonte da verdade)
- `docs/superpowers/specs/2026-07-16-dre-caixa-design.md` — design completo aprovado, cascata, RPCs, edge cases, gates de teste

### Dados-fonte (já em produção)
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — tabelas `cash_inflows` (linha ~90: release_date, net_amount, gross_amount, status_mp, synced_at) e `cash_outflows` (linha ~143: outflow_date, amount, supplier, category, status, source)
- `supabase/functions/sync-mp-releases/index.ts` — como o MP é sincronizado (money_release_date, filtro order.type='mercadolibre', refunds negativados, janela futura 45d)

### Padrões de RPC DRE a seguir
- `supabase/migrations/20260716210000_cancelled_payables_dre.sql` — versão viva de `get_dre_operational_by_competence` + `get_dre_nao_classificado_items` (padrão SECURITY INVOKER + mapa de blocos)
- `supabase/migrations/20260715221559_dre_cancelled_revenue_and_nao_classificado.sql` — helper `dre_bloco_for_category` (linha ~95)

### Padrões de frontend a espelhar
- `src/lib/dreCascade.ts` + `src/lib/dreCascade.test.ts` — lib pura de cascata testada (espelhar estrutura)
- `src/hooks/useDreOperational.ts` — padrão de hook RPC com TanStack Query (p_month = "YYYY-MM-01")
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` + `src/App.tsx` (rotas lazy + RoleRoute) — padrão de página nova
- `src/components/financial/` — componentes visuais financeiros existentes

</canonical_refs>

<specifics>
## Specific Ideas

- A resposta final é O produto: badge grande e legível pra leigo, sem jargão contábil.
- Drill-down até o lançamento individual — "nada de número opaco" (padrão do dono desde a revisão linha-a-linha da DRE).
- Página desenhada como embrião de dashboard financeiro futuro (evolução 12m é o primeiro tijolo).
- Provas de fechamento da phase: (1) vitest na lib pura; (2) provas SQL como role `authenticated` (<8s); (3) anti-IDOR nas 3 RPCs com org alheia REAL (`SELECT id, name FROM organizations` — NUNCA completar UUID de cabeça, lição 2026-07-15); (4) reconciliação de mês fechado × extrato MP conferida pelo Wesley; (5) ok visual do Wesley.
- Orgs de referência em prod: "Pé Vermeio" `7f615df7-7bac-45e5-8a93-827fb9ddeec7` (user impersonação `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73`) e "Thales" `e4150d57-1349-48c9-9a89-82b1774857b0` (anti-IDOR).

</specifics>

<deferred>
## Deferred Ideas

- Confronto automático DRE faturamento × DRE caixa (o "confere" — detectar ML cobrando diferente).
- Monitor de venda: tarifa configurada por anúncio × cobrada em cada venda.
- Entradas manuais (Bradesco, aportes) na DRE-caixa.
- Evolução da página para dashboard financeiro completo.

</deferred>

---

## Reconciliação com a DRE manual do Wesley (2026-07-16/17, durante checkpoint)

Planilha manual (aba caixa, jun): −10.527,09 × página: −44.666,66. **Fecha a ~R$1** com 5 ajustes: (1) estornos explícitos −33.837,64 (planilha não tem linha; e nosso estorno é retroativo ao mês da venda); (2) base = liberações 193.476,52 vs transferências Bradesco 204.236,91 (inclui sobra de maio); (3) ads+full +9.405,30 — **pagos via CARTÃO DE CRÉDITO** (não saem do saldo MP; modelo da página está correto, entrada íntegra); (4) ICMS competência 5.151,56 vs pago no mês 4.793,23 (caixa puro, by design); (5) cadastro Tiny ±995,90.

**Decisões/encaminhamentos:**
- Ads/full: saída de caixa = pagamento da fatura do cartão, LANÇADA NO TINY (não puxar do billing). Wesley vai lançar a fatura categorizada (ex. "Publicidade ML", "Tarifa Full ML") — categoria nova cai em nao_classificado (gate acusa) até mapear em `dre_bloco_for_category`.
- Alerta dado ao Wesley: planilha manual pode dupla-contar (deduz ads/full E cartão).
- Backfill MP executado via EF `sync-mp-releases` (body `days_back`): maio completo (entrada real 172.410,76, resultado −31.081,97); backfill fev→abr disparado (days_back=170).
- Melhoria futura registrada: estorno pesar no mês em que o dinheiro saiu (exige data do estorno no sync).

---

*Phase: 99-dre-caixa-apura-o-por-recebimento-mercado-pago-p-gina-dedica*
*Context gathered: 2026-07-16 via PRD Express Path*
