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

<db_reality>
## DB REALITY VERIFIED (Wave 0 já resolvido — 2026-07-11 via MCP em ckcdevcxgvueywivefgx)

O researcher alertou "schema-drift" porque as migrations de CMV cheio / RPCs de DRE **não estão no repo git do garment-glow-test** (foram aplicadas via MCP / vivem no worktree `/root/garment-glow-dre`). **Verifiquei o banco de PRODUÇÃO direto: está TUDO lá.** Isso NÃO é bloqueio — só significa que o SQL fonte-da-verdade dessas RPCs não está no repo (padrão conhecido; migrations via MCP). Como esta fase NÃO modifica essas RPCs (só ADICIONA tabela + frontend), o risco de drift é mínimo.

**Fatos confirmados (não re-investigar):**
- `orders.custo_unit_cheio` **EXISTE** (numeric) em prod. `orders.custo_unit`, `tax_amount`, `data_pedido` (text), `sku`, `item_id`, `status` também.
- `get_cost_waterfall(p_org_id uuid, p_user_ids text[], p_from date, p_to date)` INVOKER → `TABLE(paid_revenue, cmv, total_comissao, total_frete, total_tax, orders_count, cmv_cheio)`. **`cmv`=médio, `cmv_cheio`=cheio, `total_tax`=estimado.** A fonte de CMV muda conforme o regime; a fonte de imposto também.
- `get_dre_operational_by_competence(p_org_id uuid, p_month date)` INVOKER → `TABLE(bloco, category, total, n, double_count_risk)`. Agrupa TODOS os blocos por UMA janela `[M, M+1)` sobre `COALESCE(competence_date, date_trunc('month',outflow_date))`. O card da Phase 88 **já FILTRA o bloco `impostos_venda` fora** (usa `total_tax` estimado). **Portanto o shift M+1 NÃO precisa mexer nesta RPC** (evita regressão nos outros blocos operacionais).
- `get_imposto_guia_by_competence(p_org_id uuid, p_competence date)` INVOKER → `TABLE(category, total, status, n)` das 3 categorias `Imposto Venda - ICMS/PIS/COFINS`, por `competence_date` no mês, agrupado por category+status. **Esta é a fonte da guia REAL: no modo apuração, o hook chama com `p_competence = M+1` e soma os totais.** O `status` (paid/pending) serve pro empurrãozinho.
- `is_org_member(_user_id uuid, _org_id uuid)` DEFINER e `get_org_role(_user_id uuid, _org_id uuid)` DEFINER existem (helpers de RLS).
- Template de RLS owner-only já no repo: `supabase/migrations/20260515120000_ml_tax_config.sql` (owner INSERT/UPDATE/DELETE via `get_org_role(...)='owner'`, member SELECT via `is_org_member`). Clonar pra `dre_month_close`.

**Desenho refinado por esses fatos (mais simples e baixo risco):**
- **M+1 vive no frontend/hook**, não na RPC grande: modo apuração chama `get_imposto_guia_by_competence(org, M+1)` e soma como a linha de imposto real; modo previsão usa `total_tax`. `get_dre_operational_by_competence` fica INTOCADA (zero regressão nos outros blocos).
- **Regime derivado da presença em `dre_month_close`**: mês fechado → CMV `cmv_cheio` + imposto = guia real (M+1); mês aberto → CMV `cmv` + imposto = `total_tax`. Nunca cruzar.
- **`dre_month_close`**: PK `(organization_id, competence_month date)`; presença da linha = fechado; DELETE = reabrir. Member SELECT (is_org_member), owner INSERT/DELETE (get_org_role='owner'), SECURITY INVOKER na policy. Migration criada no repo E aplicada via MCP.
- **Empurrãozinho** (frontend): `get_imposto_guia_by_competence(org, M+1)` traz as 3 categorias + status → se as 3 presentes com status=paid OU valor≠placeholder do mês anterior → 🟢 "parece pronto pra fechar". Dica, não trava.

**Verificação-alvo de reconciliação:** junho/2026 (sales-month=jun, p_month=2026-06) em apuração usa `get_imposto_guia_by_competence(org, 2026-07)` → ICMS 5.151,56 (a guia de julho = imposto das vendas de junho), NÃO a de junho (4.793,21). CMV = 133.264,87 (cheio).
</db_reality>

---

*Phase: 94-dre-regime-previsao-apuracao*
*Context gathered: 2026-07-11 via discussão ao vivo + viabilidade no banco de produção*
*DB reality verified: 2026-07-11 via MCP*
