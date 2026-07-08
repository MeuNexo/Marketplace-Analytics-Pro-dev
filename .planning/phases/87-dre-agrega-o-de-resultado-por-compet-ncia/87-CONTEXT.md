# Phase 87: DRE — Agregação de Resultado por Competência - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Source:** Discuss (orquestrador + Wesley) com dados reais de prod `ckcdevcxgvueywivefgx`

<domain>
## Phase Boundary

Uma RPC entrega a DRE mensal **por competência de venda** lendo `cash_outflows` (custos fora do ML, com `competence_date` da Phase 86) + `orders` (receita/CMV/impostos ML já existentes), aplicando o mapa categoria→linha da DRE. Escopo **só Mercado Livre**. SECURITY INVOKER + anti-IDOR por `organization_id`. Reconciliação com um mês real fechado (junho/2026). NÃO inclui frontend (Phase 88).
</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Fonte de competência (fallback) — decisão Wesley 2026-07-08
- A agregação usa `competence_date` quando presente; quando NULL (~8,7% das linhas 2026 = 55/630, `dataCompetencia` ausente no Tiny), **cai no mês do `outflow_date`** (vencimento/caixa) como fallback. Efetivamente `COALESCE(competence_date, date_trunc('month', outflow_date)::date)`. **Não perde valor da DRE.**

### Empréstimo — decisão Wesley 2026-07-08 (OVERRIDE do ROADMAP)
- **Incluir o valor CHEIO da parcela** (juro + principal) em **Financeiro**. NÃO fazer o split SAC (o ROADMAP SC-1 sugeria separar principal via R$300.000/45=R$6.666,67 — Wesley decidiu NÃO separar; usar o valor total da categoria `Empréstimo`). 2026: R$160.961,77 (19 linhas).

### Cartão de crédito — decisão Wesley 2026-07-08
- **INCLUIR** como despesa operacional. 2026: R$268.292,37 (12 linhas), fornecedor único **"Bradesco"** = pagamento da fatura do cartão.
- **Double-count conhecido:** a única duplicidade é a **fatura do Mercado Livre** embutida na fatura do cartão (o billing ML já está capturado no MCO/margem). Como as linhas são todas lump-sum "Bradesco", **não dá pra netar por fornecedor**. Wesley vai **separar na fonte (contas a pagar) daqui pra frente**; meses passados vão duplicar essa parcela. **A DRE deve deixar isso VISÍVEL** (linha/nota "Cartão de crédito — pode conter fatura ML já contabilizada"), não esconder o double-count.

### Mapa categoria → linha da DRE (nomes REAIS de `cash_outflows.category`, Pé Vermeio)

**Impostos sobre venda (DEDUZEM a receita):**
- `Imposto Venda - ICMS`, `Imposto Venda - PIS`, `Imposto Venda - COFINS`

**CMV — EXCLUIR da DRE de despesas** (já é custo de mercadoria; tratado na margem via `orders`):
- `Fornecedores`, `Previsões de compra`

**Pessoal:**
- `Salários`, `Pró-labore` (não apareceu nos dados 2026 mas mapear), `Pessoal - INSS`

**Estrutura:**
- `Aluguéis e condomínio`, `Água, luz`, `Telecomunicação, internet`

**Serviços:**
- `Contabilidade`, `Serviços gerais` (inferência do orquestrador — categoria pequena, R$2,3k/2026)

**Operacional (outros custos operacionais):**
- `Insumos`, `Itens do CD`, `Impostos, taxas` (NÃO é imposto sobre venda — inferência: operacional, R$829/2026), `Veículos, transportes`, `Cartão de crédito` (ver decisão acima)

**Financeiro:**
- `Empréstimo` (valor cheio da parcela — ver decisão acima)

**EXCLUIR (capital / outros canais / JÁ contabilizado no ML — evitar double-count):**
- `Aporte` (capital, não é resultado)
- `ADS Shopee`, `Vendas Magalu` (outros canais — escopo só ML)
- `ADS Mercado Livre` (JÁ no MCO/ads do ML via ml_billing — double-count se incluído)
- `Prestação de serviço do Mercado Envios Full` (frete ML — JÁ no MCO)
- `Reembolso cliente` (dedução de receita; 0 em 2026 — impacto nulo; se surgir, deduz receita)
- `Outros` (catch-all, 0 em 2026 — decidir no plano: agregar em operacional OU balde "não classificado" visível)

### Regras fiscais (ROADMAP, LOCKED)
- **SEM IRPJ/CSLL** (empresa não recolhe). **SEM FGTS** (só INSS). A DRE fecha no **resultado líquido** sem esses.

### Segurança
- RPC **SECURITY INVOKER**, anti-IDOR por `organization_id = org do chamador` (nunca DEFINER + param de org). Ver [[feedback_supabase_security_invoker]].
- ⚠️ Cuidado com timeout de RLS: pré-carregar lookups em CTE MATERIALIZED, evitar subquery correlacionada em RPC INVOKER (statement_timeout 8s do role authenticated). Ver [[feedback_rpc_rls_correlated_subquery_timeout]].

### Estrutura de saída (pronta pro frontend Phase 88)
Receita → (−) impostos sobre venda → (−) comissão/tarifas ML → (−) frete → (−) CMV → (−) ads = **Margem de contribuição** → (−) Pessoal/Estrutura/Serviços/Operacional = **Resultado operacional** → (−) Financeiro (Empréstimo) = **Resultado líquido**. Agregado por mês de competência.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### DRE design & Phase 86 (fundação)
- `.planning/phases/86-dre-compet-ncia-no-contas-a-pagar/86-SUMMARY` (via 86-01/86-02-SUMMARY.md) — `competence_date` em `cash_outflows`, 91,3% backfill 2026
- ROADMAP.md Phase 87 (Success Criteria detalhados) e Phase 84/86 (contexto DRE)

### Receita/CMV/impostos ML (lado ML da margem — já existente)
- RPCs existentes de margem/MCO com ads: `get_margin_with_ads_by_product` e afins (procurar em `supabase/migrations/`) — a RPC 87 deve REUSAR a fonte de receita/CMV/tarifas/ads do ML já validada, não recalcular.

### Reconciliação
- Reconciliar a DRE de **junho/2026** com um mês fechado. Ver [[project_garment_tiny_vs_dash_reconciliation]] (Tiny agrupa por data da nota).
</canonical_refs>

<specifics>
## Specific Ideas

- A RPC recebe `p_month` (ou range) e retorna as linhas da DRE agregadas. Impersonar/testar como role `authenticated` real (não só `postgres`) — anti-IDOR + timeout.
- Distribuição real de `cash_outflows` por categoria (Pé Vermeio, com competência) coletada em 2026-07-08 — usar como fixtures/expectativa na reconciliação.
- Fonte de receita/CMV/tarifas ML: NÃO reinventar — plugar na fonte já usada por `/produtos-vendidos` / `/analise-precos` (MCO com ads).
</specifics>

<deferred>
## Deferred Ideas

- Frontend da DRE em `/vendas` → **Phase 88**.
- Split SAC do empréstimo (juro vs principal) → descartado por decisão do Wesley (usar valor cheio).
- Netar a fatura ML dentro do cartão de crédito → Wesley corrige na FONTE (contas a pagar) daqui pra frente; não implementar netting automático agora.
- IRPJ/CSLL/FGTS → fora de escopo (empresa não recolhe).
</deferred>

---

*Phase: 87-dre-agrega-o-de-resultado-por-compet-ncia*
*Context gathered: 2026-07-08 via discuss (orquestrador + Wesley, dados reais de prod)*
