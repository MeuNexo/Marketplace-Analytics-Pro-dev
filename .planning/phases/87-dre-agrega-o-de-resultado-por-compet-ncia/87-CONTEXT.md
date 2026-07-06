# Phase 87: DRE — Agregação de Resultado por Competência - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Source:** Discussão consolidada com Wesley (ver memória project_garment_dre_resultado_completa). Depende da Phase 86 (competence_date em cash_outflows — EM PROD).

<domain>
## Phase Boundary

Criar a RPC que entrega a **DRE de resultado mensal por competência**, lendo `cash_outflows` (custos operacionais, agora com `competence_date` da Phase 86) e classificando por categoria nos blocos da DRE. A margem (Receita − impostos venda − comissão/tarifas ML − frete − CMV − ads) já vem da fonte existente do `/vendas` (orders + ml_billing_daily); esta fase adiciona os **custos fora do ML** e o **resultado líquido**.

**Nesta fase:** RPC de agregação (SECURITY INVOKER, anti-IDOR por organization_id), mapa categoria→bloco, exclusões, tratamento do juro do empréstimo, reconciliação com um mês real.
**NÃO nesta fase:** frontend (Phase 88).
</domain>

<decisions>
## Implementation Decisions (LOCKED com Wesley)

### Mapa categoria (Tiny `category`) → bloco da DRE
- **Impostos sobre venda (deduzem receita):** `Imposto Venda - ICMS`, `Imposto Venda - PIS`, `Imposto Venda - COFINS`.
- **Pessoal (operacional):** `Salários`, `Pró-labore` (hoje lançado como `Salários`), `Pessoal - INSS`.
- **Estrutura (operacional):** `Aluguéis e condomínio`, `Água, luz`, `Telecomunicação, internet`.
- **Serviços/Admin (operacional):** `Contabilidade`, `Insumos`, `Itens do CD` (Wesley confirmou: Insumos e Itens do CD = operacional).
- **Financeiro:** `Empréstimo` → **somente o JURO** (ver questão aberta abaixo).
- **EXCLUIR (não entram na DRE):** `Fornecedores` e `Previsões de compra` (viram CMV), `Aporte` (capital), `Vendas Mercado Livre`/`Vendas Magalu` (receita, não despesa), `ADS Mercado Livre`/`ADS Shopee`/`Ads Magazine Luiza`/`Prestação de serviço do Mercado Envios Full` (já vêm do ML e/ou outros canais — escopo é SÓ Mercado Livre).
- **Sem IRPJ/CSLL** (empresa não recolhe) e **sem FGTS** (só INSS). DRE fecha no resultado líquido.

### Régua e escopo
- Agrega por `competence_date` (mês de competência), casando com a receita por competência de venda.
- Escopo = **só Mercado Livre / Pé Vermeio** (org `7f615df7`, seller 1639558873).
- Anti-IDOR: RPC **SECURITY INVOKER**, filtra por `organization_id` do chamador (padrão do projeto; cuidado com timeout de subquery correlacionada — ver [[feedback_rpc_rls_correlated_subquery_timeout]]).

### Estrutura de saída
Receita − impostos venda − comissão/tarifas ML − frete − CMV − ads = **Margem de contribuição** → − Pessoal − Estrutura − Serviços = **Resultado operacional** → − Financeiro (juro) = **Resultado líquido**.

### Categorias não-mapeadas
NÃO descartar silenciosamente. Categorias fora do mapa (ex.: `Cartão de crédito`, `Veículos, transportes`, `Serviços gerais`, `Reembolso cliente`, `Impostos, taxas` genérico) → jogar num bucket **"Outros operacionais"** visível, para revisão. `log`/expor o que caiu ali.
</decisions>

<open_questions>
## QUESTÃO ABERTA (precisa do Wesley — NÃO resolver autonomamente com aproximação frágil)

**Separação juro × principal do `Empréstimo`.** Wesley lança principal+juros juntos numa parcela; o Tiny não separa (campo `juros`=0). Só o juro é despesa (o principal é amortização, não custa resultado).
- Aproximação SAC (300.000/45 = R$6.666,67 principal/parcela) **ERRA a carência** (a parcela de carência R$13.189 é 100% juros; SAC classificaria R$6.667 como principal indevidamente) e as parcelas não seguem fórmula limpa (varia por dias).
- **Decisão pendente:** Wesley enviar a **tabela de amortização do banco** (juro+amortização por parcela) para exatidão, OU aprovar uma aproximação explícita.
- **Enquanto isso:** a RPC deve isolar o bloco Financeiro de forma que o juro seja um valor claramente marcado como aproximado/pendente (não misturar com o resto), para não contaminar o resultado líquido. NÃO fechar os números do Financeiro sem input do Wesley.
</open_questions>

<canonical_refs>
## Canonical References

- `.planning/phases/86-.../86-CONTEXT.md` + `86-RESEARCH.md` — competence_date em cash_outflows (fonte desta fase).
- DRE existente do `/vendas` (margem): localizar o componente `MLCostCard` e a fonte da margem (orders + ml_billing_daily) — reusar, NÃO re-derivar a margem.
- Categorias reais no Tiny: `GET /categorias-receita-despesa` (26 categorias; lista no histórico da sessão / memória).
- Supabase garment = `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md). Deploy de migration/RPC só via MCP `apply_migration`.
- Reconciliação de referência: junho/2026, org `7f615df7` (dados já batidos: receita R$261.987, etc.).
</canonical_refs>

<deferred>
## Deferred (fora desta fase)
- Frontend da DRE completa → Phase 88.
- Tabela exata de amortização do empréstimo (se Wesley enviar) → refina o bloco Financeiro.
</deferred>

---

*Phase: 87-dre-agrega-o-de-resultado-por-compet-ncia*
*Context gathered: 2026-07-06 via discussão consolidada (orquestrador)*
