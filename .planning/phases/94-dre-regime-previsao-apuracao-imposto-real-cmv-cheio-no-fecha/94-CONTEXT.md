# Phase 94: DRE Regime Previsão↔Apuração - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning
**Source:** Discussão ao vivo com Wesley (CEO) + viabilidade confirmada no banco de produção

<domain>
## Phase Boundary

O card **"DRE do Mês"** em `/vendas` (entregue na Phase 88, em prod, validado por Wesley em 07-10) hoje mostra a cascata Receita → Resultado usando SEMPRE imposto estimado (~20% do `orders.tax_amount`) e CMV médio (`orders.custo_unit`). Isso faz o resultado de um mês oscilar R$40-48k dependendo da régua, e nunca mostra o resultado REAL depois que a contabilidade apura as guias.

Esta fase adiciona **dois regimes por mês de venda**, sem quebrar nada do que a Phase 88 já mostra:
- **PREVISÃO** (default, mês em aberto) = comportamento atual (CMV médio + imposto estimado).
- **APURAÇÃO** (mês fechado pelo owner) = CMV cheio (`orders.custo_unit_cheio`) + guias reais de imposto (bloco `impostos_venda` do contas a pagar), parando de estimar.

A virada é disparada por um **clique manual do owner** ("marcar mês como apurado"), persistido em nova tabela `dre_month_close`. NÃO é automática (o dado real é ambíguo demais).

**Fora de escopo (NÃO fazer nesta fase):**
- Toggle previsão×apuração como escolha livre do usuário por eixo (CMV e imposto são consequência do regime, não toggles independentes).
- Categorização na fonte (Tiny) / mapeamento categoria→bloco / limpeza do cartão Bradesco / `nao_classificado` — isso é trabalho de outra fase (o Wesley faz na fonte).
- Apurar/lançar PIS/COFINS faltantes — é ação do Wesley no Tiny, não código.
- Precificação/MCO/break-even — continuam usando `total_tax` (imposto cheio por venda); esta fase não toca neles.
</domain>

<decisions>
## Implementation Decisions (TRAVADAS com Wesley — não re-discutir)

### Regime é único, não são toggles soltos
- Só existem DOIS mundos coerentes; **nunca misturar as bases** (senão o crédito de ICMS/PIS/COFINS conta 2×):
  - PREVISÃO = CMV médio (`orders.custo_unit` → `get_cost_waterfall.cmv`) + imposto estimado (`orders.tax_amount`).
  - APURAÇÃO = CMV cheio (`orders.custo_unit_cheio` → `get_cost_waterfall.cmv_cheio`) + guias reais (bloco `impostos_venda`).
- **CMV cheio×médio é CONSEQUÊNCIA do regime**, jamais uma escolha separada exposta ao usuário.

### Mês inteiro ou nada (Opção A)
- Um mês só pode virar APURAÇÃO quando ICMS+PIS+COFINS daquele mês estiverem reais.
- Motivo técnico: o imposto estimado (`tax_amount`) é um número BORRADO (~20% por produto, alíquotas 7/12/18% combinadas), NÃO quebrado por tipo de imposto → não dá pra substituir só o ICMS mantendo PIS/COFINS estimado.

### Casamento M+1 (a régua que reconcilia)
- A DRE é por **mês da VENDA** (`orders.data_pedido`).
- O `competence_date` da guia no `cash_outflows` = **mês do PAGAMENTO** (sempre 1º dia do mês do vencimento), NÃO o mês da venda. ICMS de venda é pago ~dia 21 do mês seguinte.
- **Regra: imposto da DRE do mês de venda M = guia com `competence_date = M+1`.** A apuração paga este mês é sobre as vendas do mês passado.
- Hoje a RPC `get_dre_operational_by_competence` casa pela competência crua → **precisa aplicar o shift M+1** no bloco de impostos.
- Reconciliação-alvo: junho/2026 usa a guia ICMS de julho (5.151,56), NÃO a de junho (4.793,21, que é de maio).

### Gatilho = clique manual do owner (nunca automático)
- Persistir em nova tabela `dre_month_close` (PK org-first `organization_id` + `competence_month`), RLS org-first, escrita só owner, **reversível** (reabrir mês).
- Mês SEM registro → previsão. Mês COM registro → apuração.
- Sinal de "parece pronto pra fechar" (vencimento≠21 / `status='paid'` / valor≠recorrente) é só **empurrãozinho visual** 🟢, NUNCA gatilho. Comprovado no banco que vários apurados reais ficam no dia 21 → sinal ambíguo.

### Enquanto o mês está aberto
- Ignora a linha recorrente de imposto do Tiny (é placeholder) e usa a estimativa própria (`tax_amount`). A guia real só "vale" depois do fechamento.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design/decisões já fechadas (fonte da verdade desta fase)
- `/root/.claude/projects/-root/memory/project_garment_dre_ponto_verdade.md` — DESENHO FECHADO + VIABILIDADE CONFIRMADA NO BANCO (evidências reais do `cash_outflows`, a regra M+1, o veredito de viabilidade). LER PRIMEIRO.
- `/root/.claude/projects/-root/memory/feedback_garment_dre_imposto_apuracao.md` — as DUAS DREs (A/B), por que CMV cheio casa com guia real e CMV médio casa com estimativa, por que não misturar (crédito 2×).

### Código existente a reusar/estender (a mapear na pesquisa)
- RPC `get_dre_operational_by_competence` (Phase 87) — bloco `impostos_venda` é onde o shift M+1 entra.
- Frontend do card "DRE do Mês" (Phase 88): `src/lib/dreCascade.ts` + hook `src/hooks/useDreOperational.ts` + componente `MLCostCard` fiado em `src/pages/mercadolivre/MercadoLivre.tsx` (ou equivalente `/vendas`).
- RPC `get_cost_waterfall` — expõe `cmv` (médio) e `cmv_cheio`; a fonte de CMV muda conforme o regime.
- Padrão de tabela nova + RLS org-first + policy `is_org_member` + SECURITY INVOKER: ver migrations recentes (ex. `dre_month_close` espelha o padrão de `proposed_actions`/outras tabelas org-first).

### Infra
- Supabase proj **ckcdevcxgvueywivefgx** (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md — este projeto usa o de produção real). Org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`.
- Deploy de RPC (migration) e EF via **MCP** (`apply_migration` / `deploy_edge_function`) — sem token CLI. Nunca aplicar migration via SQL Editor.
</canonical_refs>

<specifics>
## Specific Ideas

- Card mostra **selo do regime**: "Previsão" (âmbar/neutro) ou "Apurado — baseado nas guias de DD/MM" (verde), + botão owner-only "marcar mês como apurado" / "reabrir mês".
- Empurrãozinho 🟢 "as 3 guias parecem lançadas — fechar mês?" quando ICMS+PIS+COFINS do mês saíram do placeholder (heurística: vencimento≠dia 21 OU status=paid OU valor≠valor do mês anterior). É dica, não trava.
- Junho/2026 é o caso de teste de reconciliação: com CMV cheio + guia ICMS real (5.151,56 via M+1) o resultado bate ~histórico; PIS/COFINS ainda placeholder → junho fica "previsão / apuração pendente (falta PIS, COFINS)".
- Números de referência no banco (Pé Vermeio, jun/2026): Receita data-pedido 261.987,61; CMV médio 110.613,42 / cheio 133.264,87; imposto estimado (tax_amount) 53.327,05.
</specifics>

<deferred>
## Deferred Ideas

- **Toggle explícito previsão×apuração** que o usuário liga/desliga à vontade — decidido que regime é derivado do fechamento, não um toggle livre. (Se Wesley quiser "espiar" a apuração de um mês aberto no futuro, vira refinamento.)
- Decompor o imposto estimado por tipo (ICMS/PIS/COFINS separados) para apuração parcial por imposto — hoje é borrado; não fazer.
- Detecção 100% automática do fechamento (sem clique) — descartada por ambiguidade do dado.
- Categorização na fonte (Tiny) e limpeza de `nao_classificado`/cartão — fase separada, trabalho do Wesley na fonte.
</deferred>

---

*Phase: 94-dre-regime-previsao-apuracao*
*Context gathered: 2026-07-11 via discussão ao vivo + viabilidade no banco de produção*
