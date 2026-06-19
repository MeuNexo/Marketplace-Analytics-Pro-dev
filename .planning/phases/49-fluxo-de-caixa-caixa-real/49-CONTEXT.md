# Phase 49: Fluxo de Caixa (Caixa Real) - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Source:** discuss inline (3 perguntas respondidas pelo Wesley em sessão) + análise do repo de referência nexointeligence

<domain>
## Phase Boundary

Portar para o dashboard garment-glow-test a **página de fluxo de caixa** do antigo SaaS `nexointeligence`
(clonado em `/tmp/nexointeligence`), começando pelo gráfico "COMO MEU DINHEIRO VAI EVOLUIR?" + 3 cards
principais. É a visão de CAIXA (saldo de dinheiro evoluindo no tempo) — conceito distinto do `/financeiro`
atual do garment, que é DRE de competência (lucro por venda).

**No escopo desta fase (MVP):**
- Ingestão de dados de CAIXA REAL (entradas + saídas) multi-tenant
- RPC de fluxo de caixa (saldo real acumulado + projeção)
- Nova página `/fluxo-de-caixa` sob novo grupo de menu "Operações"
- Gráfico "Como meu dinheiro vai evoluir?" (2 linhas: real/pessimista + projetado/realista)
- 3 cards: Caixa Hoje, Projeção Futura (pessimista/realista), Capacidade de Compra
- Parâmetros por org (saldo inicial, custo operacional, margem de segurança)

**FORA do escopo (fase posterior):** demais cards do nexointeligence — Análise de Despesas,
Valor em Estoque, Estoque Parado, DRE Sintético, Previsão de Receita (card detalhado), simulador
de cenários, tabela de lançamentos com CRUD.
</domain>

<decisions>
## Implementation Decisions

### Fonte do caixa (DECISÃO TRAVADA — Wesley 2026-06-18)
- **CAIXA REAL.** Entradas = **liberações reais do Mercado Pago** (dinheiro que efetivamente cai/é liberado).
  Saídas = **ordens de compra / contas a pagar do Tiny ERP** (decisão Wesley 2026-06-18 — atualizada).
- **NÃO** derivar entradas das vendas (receita de competência), **NÃO** usar lançamento manual como fonte primária.
- **CASH-02 RESOLVIDO (Wesley 2026-06-18): as saídas vêm de INTEGRAÇÃO COM O TINY já na Wave 1** — não é
  lançamento manual. Fonte = contas a pagar / ordens de compra do Tiny (data de pagamento/vencimento = saída de
  caixa). Reusar a conexão Tiny já existente no garment (tiny-oauth) + referência da implementação no nexo-mcp
  (`get_payables_tiny` / `get_purchase_orders`, Tiny API v3). `cash_outflows` é alimentada por uma EF de sync do Tiny.
- Consequência: o garment HOJE não tem nem ingestão de liberações MP nem ingestão de pagáveis/OCs do Tiny —
  esta fase precisa CONSTRUIR as DUAS ingestões na Wave 1 (a parte pesada do backend).

### Localização (DECISÃO TRAVADA — Wesley 2026-06-18)
- Nova página sob um **novo grupo de menu "Operações"** (criar o agrupamento no shell se não existir).
- **NÃO** mexer no `/financeiro` atual (DRE/margem) — são conceitos diferentes, mantê-los separados.

### Escopo MVP (DECISÃO TRAVADA — Wesley 2026-06-18)
- Gráfico de evolução do dinheiro + 3 cards (Caixa Hoje, Projeção Futura, Capacidade de Compra).
- Os indicadores que o Wesley disse que mais usava no SaaS antigo.

### Multi-tenant / segurança (regra do projeto)
- Tudo escopado por `organization_id` com RLS.
- RPC de tenant = **SECURITY INVOKER** (DEFINER + org por parâmetro = IDOR). Ver memória feedback_supabase_security_invoker.
- Boundary de data: `orders.data_pedido` é `timestamptz` — usar `.lt(nextDayUTC(to))`, nunca `.lte` com string só-data.
- Paginar selects/RPC com `.range()` — PostgREST trunca em 1000 linhas.

### Lógica de projeção (do nexointeligence, replicar)
- Linha REAL (pessimista): saldo inicial + Σ(entradas − saídas confirmadas) acumulado por dia.
- Linha PROJETADA (realista): real + projeção SMA das vendas. SMA = (Σ vendas últimos 15d ÷ dias) × (1 − custo_operacional).
  Ativa após o dia 8 (dias 9+). `operational_cost_rate` default 0.22; `safety_margin` default 10000.
- Capacidade de compra = saldo projetado (30d) − margem de segurança. Status SAFE/DANGER.

### Claude's Discretion (resolver no plano)
- Forma exata de ingerir liberações MP: endpoint/scope correto da API ML/Mercado Pago. Consultar o MCP de
  API do ML: https://developers.mercadolivre.com.br/pt_br/server-mcp . Reusar padrão das EFs `sync-*` (ml_tokens).
- SAÍDAS = Tiny (RESOLVIDO, não é discrição): definir qual recurso do Tiny usar (contas a pagar vs ordens de
  compra) e qual data representa a saída de caixa (data de pagamento efetiva preferível; vencimento como fallback).
  Reusar padrão tiny-oauth do garment + payload de referência do nexo-mcp (`get_payables_tiny`).
- Tabelas novas: nomes/colunas (ex: `cash_inflows`/`mp_releases`, `cash_outflows`/`expenses`, `financial_settings`).
- Estrutura do RPC `get_cashflow` (espelhar `get_financial_cashflow` do nexointeligence, adaptado às tabelas do garment).
- Onde colocar "Operações" no shell de navegação e quais ícones.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo de referência (nexointeligence — clonado)
- `/tmp/nexointeligence/src/components/financial/CashFlowChart.tsx` — gráfico-alvo (Recharts ComposedChart, 2 linhas)
- `/tmp/nexointeligence/src/hooks/useCashFlowData.ts` — hook + RPC `get_financial_cashflow` (lógica de acumulação + SMA)
- `/tmp/nexointeligence/src/components/financial/{TodayBalanceCard,ProjectedBalanceCard,CapacityCard}.tsx` — os 3 cards
- `/tmp/nexointeligence/src/hooks/{useTodayBalance,useProjectedBalance,useFinancialHealth}.ts` — hooks dos cards
- Tabelas-fonte do original: `transactions`, `financial_settings` (initial_balance, operational_cost_rate=0.22, safety_margin=10000), `sales_history`

### Garment (projeto-alvo) — padrões a reusar
- Supabase project REAL = `ckcdevcxgvueywivefgx` (CONFIRMAR via Supabase MCP `list_projects`/`list_tables` antes de aplicar nada — CLAUDE.md tem ID desatualizado)
- EFs de sync existentes (`supabase/functions/sync-ml-orders`, `sync-ads`) + `ml_tokens` — modelo para a nova EF de liberações MP
- `src/pages/mercadolivre/MLFinanceiro.tsx` — padrão de página (header sticky, period picker, KPICard, Recharts)
- Shell/navegação: `src/components/layout/` (sidebar/header) — onde criar o grupo "Operações"
- Route guards: `src/components/auth/{ProtectedRoute,RoleRoute}.tsx`
- Memórias: feedback_supabase_security_invoker, feedback_postgrest_pagination, feedback_timestamptz_date_filter

### API Mercado Livre / Mercado Pago (liberações)
- MCP de configurações de API do ML: https://developers.mercadolivre.com.br/pt_br/server-mcp
</canonical_refs>

<specifics>
## Specific Ideas

- Título do gráfico: "Como meu dinheiro vai evoluir?" (mesma pergunta-guia do original).
- Cards com perguntas de leigo: "Quanto tenho hoje?", "Quanto vou ter?", "Posso comprar mais estoque?".
- Período padrão do gráfico: 120 dias (4 meses) à frente, como o original.
- Stack idêntica entre os dois repos (React 18 + Vite + shadcn/ui + Supabase + Recharts 2.15.4 + TanStack Query) — reuso quase direto dos componentes, adaptando só a camada de dados.
</specifics>

<deferred>
## Deferred Ideas

- Cards: Análise de Despesas ("para onde meu dinheiro vai?"), Valor em Estoque, Estoque Parado, DRE Sintético, card de Previsão de Receita detalhado.
- Simulador de cenários (`ScenarioSimulator`).
- Tabela de lançamentos com CRUD + filtros + exportação.
- Âncora manual de saldo (`balance_adjustment_history`).
- Mascaramento de valores sensíveis (`hide_financial_values`).
</deferred>

---

*Phase: 49-fluxo-de-caixa-caixa-real*
*Context gathered: 2026-06-18 (discuss inline — 3 decisões travadas do Wesley + análise do repo de referência)*
