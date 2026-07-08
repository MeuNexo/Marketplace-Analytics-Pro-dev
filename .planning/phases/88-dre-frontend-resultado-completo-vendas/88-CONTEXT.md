# Phase 88: DRE — Frontend Resultado Completo (/vendas) - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Source:** Artefatos GSD já existentes (NÃO re-discutir o desenho — já decidido em sessões anteriores). Este CONTEXT só aponta as fontes-da-verdade e o escopo do frontend.

<domain>
## Phase Boundary

Estender a **"DRE do Mês"** (`src/components/mercadolivre/MLCostCard.tsx`) em `/vendas` para mostrar o **resultado completo**: hoje ela para em "Lucro do mês" (Receita − tarifas ML − CMV − impostos = margem de contribuição). A Phase 88 continua a cascata para baixo com os **custos operacionais + financeiro** vindos da RPC da Phase 87, chegando a **Resultado operacional** e **Resultado líquido**.

SÓ frontend + wiring de hook. NÃO mexer nas RPCs (86/87) nem na metodologia de receita/CMV/impostos (já correta, vinda de `orders` — ver spec 07-03). NÃO tocar `get_cashflow`/DFC.
</domain>

<canonical_refs>
## Fontes da verdade (LER antes de planejar — o desenho JÁ está decidido nelas)

- **`src/components/mercadolivre/MLCostCard.tsx`** — o card atual ("DRE do Mês"). Baseline visual e de props a estender. Hoje: Receita → grupos de tarifas ML (`gruposTarifas`) → CMV (`cmvMes`) → Impostos próprios (`impostosMes`) → "Lucro do mês". Extensão entra DEPOIS do lucro atual.
- **`src/hooks/useMLBilling.ts`** (`useMLBillingDaily`/`useMLBillingDailyWithSync`, tipo `BillingGroup`) — fonte das tarifas por competência; seletor de mês.
- **`docs/superpowers/specs/2026-07-03-dre-competencia-venda-design.md`** — método por competência de venda (Phase 84). Regra travada: receita/CMV/impostos vêm de `orders`, já corretas; NÃO mudar.
- **`.planning/phases/87-dre-agrega-o-de-resultado-por-compet-ncia/87-CONTEXT.md`** + **87-01-PLAN.md** — o mapa categoria→bloco (impostos_venda/pessoal/estrutura/servicos/operacional/financeiro/excluido/nao_classificado), decisões do Wesley (cartão em operacional com flag `double_count_risk`; empréstimo valor cheio; NULL→outflow_date).
- **RPC a consumir:** `get_dre_operational_by_competence(p_org_id uuid, p_month date)` → colunas `bloco, category, total, n, double_count_risk`. SECURITY INVOKER, anti-IDOR por org.
- **Regra imposto/CMV (memória `feedback_garment_dre_imposto_apuracao`):** DUAS DREs. **Previsão** (mês aberto) = CMV médio (`cmv`) + imposto estimado (saídas 7/12/18%). **Real/apuração** (mês fechado) = CMV cheio (`cmv_cheio` = preço custo) + guia real a pagar (se houver). NÃO misturar (conta crédito 2×). Confirmado 07-08: `orders.custo_unit`=médio, `orders.custo_unit_cheio`=preço custo cheio.
</canonical_refs>

<decisions>
## Escopo do frontend (Phase 88)

### Cascata completa (ordem LOCKED — ROADMAP SC-1)
Receita − impostos s/ venda − comissão/tarifas ML − frete − CMV − ads = **Margem de contribuição** → − Pessoal / Estrutura / Serviços / Operacional / Não classificado = **Resultado operacional** → − Financeiro (Empréstimo) = **Resultado líquido**.

### Como renderizar os blocos novos (da RPC 87)
- Buscar `get_dre_operational_by_competence(org, mês)` para o mês selecionado (mesmo mês do card).
- Agrupar por `bloco`: **pessoal, estrutura, servicos, operacional, nao_classificado** somam para chegar ao **Resultado operacional**; **financeiro** desce para o **Resultado líquido**.
- **NÃO exibir o bloco `excluido`** na cascata (é CMV/capital/outros canais — já tratado ou fora de escopo). Pode ir num "ver detalhes" colapsado, opcional.
- **`operacional` com `double_count_risk=true` (cartão de crédito):** mostrar um aviso/tooltip discreto ("pode conter fatura ML já contabilizada") — não esconder, não netar automático.
- **`nao_classificado`:** exibir visível como linha própria (não somar silenciosamente em operacional) — princípio "não esconder" do Wesley.

### Modo previsão × apuração
- Decisão de escopo a confirmar no planejamento: se a Phase 88 já entrega o **toggle previsão/apuração** (troca CMV médio↔cheio e imposto estimado↔guia real) OU se entrega só a extensão do resultado mantendo a fonte atual do card (previsão) e o toggle fica pra follow-up. Surface como pergunta no plano, NÃO decidir sozinho — Wesley já discutiu o desenho, então alinhar ao que estiver no GSD/decisão dele.

### Consistência visual (ROADMAP SC-2/3)
- Mesmos tokens/estilo do `MLCostCard` atual (BRL via `toLocaleString`, tabular-nums, light/dark, mobile — padrão Phase 78). Subtotais destacados (margem, operacional, líquido) com hierarquia visual. Sinal semântico verde/vermelho no líquido.
</decisions>

<specifics>
## Notas de implementação
- A RPC 87 é por **competência** (mês-calendário); o card de tarifas/CMV é por **competência de venda** (spec 07-03). Régua a alinhar visível — o mês selecionado deve ser o mesmo eixo. Surface qualquer descasamento no plano.
- Anti-IDOR já garantido na RPC (INVOKER + RLS is_org_member); o frontend só passa a org do contexto.
- Reconciliação de junho/2026 já provada no backend (Phase 87). O frontend deve BATER com esses números para o mesmo mês.
</specifics>

<deferred>
## Fora de escopo
- Mudar RPCs 86/87 ou a metodologia de receita/CMV/imposto (já decidida).
- IRPJ/CSLL/FGTS (empresa não recolhe).
- Alinhamento de régua venda×competência no backend (é ajuste de dado/EF, não frontend) — só sinalizar na UI se houver descasamento.
</deferred>

---

*Phase: 88-dre-frontend-resultado-completo-vendas*
*Context: 2026-07-08 — aponta artefatos GSD decididos; sem re-discussão de desenho*
