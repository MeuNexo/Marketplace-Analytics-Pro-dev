# Phase 105: Consultor CCO — Preços, competitivo e completude - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Source:** Brainstorming + spec docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md (Grupos 3 e 4)

<domain>
## Phase Boundary

Fecha a milestone "Consultor CCO Completo": acende o **pilar competitivo (Rafael) — hoje fantasma** (a persona
promete concorrentes/preço total/Buy Box mas não há UMA tool com dado competitivo real), adiciona **preço praticado ×
meta de MCO**, e completa a leitura de dados (custos faltando, receita cancelada).

**Entrega (Grupos 3 + 4 do spec) — 4 tools read-only em `supabase/functions/nexo-chat/tools.ts`:**
1. `get_price_practiced` → RPC `orders_sold_products_agg` + tabela `ml_mco_targets` (preço praticado × meta MCO).
2. `get_competitive_price` → edge fn `ml-precos-custos` (modo `references`): sugestão competitiva + comissão.
3. `get_cost_gaps` → RPC `get_cmv_cheio_gaps` (QUAIS SKUs sem custo — hoje só a contagem via get_no_cost_count).
4. `get_cancelled_revenue` → RPC `get_cancelled_revenue`.
+ playbook Rafael ampliado (agora com dado competitivo real) + persona FINAL (aponta TODAS as tools novas 103/104/105 + rótulos).
</domain>

<decisions>
## Implementation Decisions

### Padrão (herdado de 103/104 — validado)
- Anti-IDOR "org-only" (molde get_coverage/get_treasury_panel); p_org_id do servidor; args de org/seller ignorados.
- Cap MAX_ROWS; summary+sample quando o retorno for grande. Read-only estrito.
- Contagem de tools 31→35 em tools.test.ts. NÃO quebrar greps de prompt.test.ts nem remover conteúdo de playbooks.

### get_price_practiced → orders_sold_products_agg + ml_mco_targets
- Cruza preço praticado (histórico de preço vendido, agregado) com a meta de MCO (ml_mco_targets). Confirmar assinatura
  de orders_sold_products_agg (params: janela? variação? por SKU?) e o schema de ml_mco_targets (select direto → .eq('organization_id', orgId)).
- Rótulo: preço praticado é histórico; meta MCO é alvo cadastrado (pode não existir p/ todo SKU → declarar limitação).

### get_competitive_price → edge fn ml-precos-custos (modo references)
- ÚNICA fonte de dado competitivo real (sugestão de preço competitiva + calculadora de comissão). Precisa de item(s) ML.
- ATENÇÃO: é EDGE FUNCTION, não RPC. Ver como get_reputation invoca EF via ctx.userJwt (a ml-precos-custos pode exigir
  JWT do usuário). Confirmar no research: params da EF (modo references exige item_id?), se exige JWT real, como escopar anti-IDOR.
- Rótulo: sugestão competitiva do ML, NÃO garantia; é subconjunto/indicativo. Este é o pilar Rafael — sem inventar concorrente.

### get_cost_gaps → get_cmv_cheio_gaps
- Retorna QUAIS SKUs estão sem custo (não só a contagem). Útil para "posso confiar na margem?" e completude.
- Contexto garment: revenda (org Thales) tem custo ausente por natureza (custo não está no Tiny) — rótulo deve dizer que
  custo ausente pode ser legítimo (revenda), não necessariamente erro.

### get_cancelled_revenue → get_cancelled_revenue
- Receita de pedidos cancelados. Rótulo: cancelado ≠ faturamento; complementa get_sales_kpis.

### Playbook Rafael (ampliar bloco "4. RAFAEL — Inteligência Competitiva" em playbooks.ts)
- Agora com dado real: preço total (preço + frete) vs concorrente; quando reagir a concorrente vs manter margem;
  usar a sugestão competitiva do ML como sinal, não ordem. Estilo DADO→Diagnóstico→Ação→Métrica; citar fontes; não remover.

### Persona prompt.ts (FINALIZAÇÃO da milestone)
- "USO DAS FERRAMENTAS": garantir que TODAS as tools novas (103: replenishment/suppliers; 104: DRE/caixa/impostos;
  105: preço praticado/competitivo/cost_gaps/cancelada) estejam citadas com quando usar.
- VERACIDADE: preço competitivo = sugestão, não garantia; custo ausente pode ser legítimo (revenda); cancelado ≠ faturamento.
- NÃO quebrar greps de prompt.test.ts.

### Testes
- Espelhar 103/104: anti-IDOR org-only, cap, rótulos; a de get_competitive_price precisa testar o caminho de EF (mock do fetch/EF como get_reputation).

### Claude's Discretion
- Se get_competitive_price precisar de item_id do modelo (input não-sensível) — definir; nunca aceitar org/seller do modelo.
- Formato dos retornos respeitando cap.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` — Grupos 3 e 4.
- `.planning/phases/103-.../103-01-PLAN.md` e `.planning/phases/104-.../104-01-PLAN.md` — molde de tool org-only, tool via EF (get_reputation), summary/sample, testes.
- `supabase/functions/nexo-chat/tools.ts` — molde org-only (get_coverage/get_treasury_panel) e molde de EF-com-JWT (get_reputation via ctx.userJwt).
- `supabase/functions/nexo-chat/prompt.ts` (PERSONA), `playbooks.ts` (bloco "4. RAFAEL"), `tools.test.ts`, `prompt.test.ts`.
- Fonte de dados (confirmar via grep/leitura):
  - `src/hooks/useMLSoldProducts.ts` → `orders_sold_products_agg`; `src/hooks/useMcoTargets.ts` → `ml_mco_targets`.
  - `src/hooks/useMLPrecosCustos.ts` → edge fn `ml-precos-custos` (modos items/references/costs) — ver supabase/functions/ml-precos-custos/.
  - `src/hooks/useCmvCheioGate.ts` → `get_cmv_cheio_gaps`; `src/hooks/useCancelledRevenue.ts` → `get_cancelled_revenue`.
  - `supabase/migrations/` — grep pelas definições das RPCs.
</canonical_refs>

<specifics>
## Specific Ideas
- DB alvo: `ckcdevcxgvueywivefgx`. Deploy da EF nexo-chat é do orquestrador (CLI/MCP), não do executor.
- ml-precos-custos modo references é a única porta de dado competitivo — tratar com cuidado (é EF, pode exigir JWT).
</specifics>

<deferred>
## Deferred Ideas
- RAG / embeddings da base de conhecimento → Fase 2 (quando a base crescer).
</deferred>

---

*Phase: 105-consultor-cco-precos-competitivo-e-completude*
*Context gathered: 2026-07-28 via brainstorming + spec*
