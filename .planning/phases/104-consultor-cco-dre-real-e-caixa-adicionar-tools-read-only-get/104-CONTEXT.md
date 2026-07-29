# Phase 104: Consultor CCO — DRE real & caixa - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Source:** Brainstorming + spec docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md (Grupo 2)

<domain>
## Phase Boundary

Fecha o buraco mais grave para um CCO: hoje o Consultor NÃO sabe o **lucro real**. Ele só tem
`get_margin_summary` (base pedidos pagos) e `get_dre_monthly` (fatura ML) — não o DRE de resultado por
competência que o Wesley validou (Phases 84-100), nem a DRE de regime de caixa (`/dre-caixa` inteira invisível).

**Entrega (Grupo 2 do spec) — 4 tools read-only em `supabase/functions/nexo-chat/tools.ts`:**
1. `get_dre_result` → RPC `get_dre_operational_by_competence` (o DRE de resultado real por competência).
2. `get_dre_cash` → RPC `get_dre_cash` (+ `get_dre_cash_forecast` para previsão do mês).
3. `get_projected_balance` → RPC `get_projected_balance_summary` (saldo projetado 3 cenários).
4. `get_taxes_paid` → RPCs `get_imposto_guia_by_competence` + `get_inss_guia_by_competence` (impostos reais por guia).
+ playbook Gabriel ampliado (DRE resultado vs caixa vs pagos, break-even de caixa) + persona (rótulos de veracidade).

**FORA de escopo:** compras (103, já shipada), preços/competitivo/completude (105), RAG (Fase 2), qualquer mutação.
</domain>

<decisions>
## Implementation Decisions

### Padrão (herdado da Phase 103 — validado)
- Anti-IDOR "org-only": injetar `p_org_id: orgId` do servidor; args de org/seller do modelo IGNORADOS.
  Confirmar via grep se alguma dessas RPCs aceita `p_user_ids` (as de compras NÃO aceitavam — provável que estas também não).
- Cap `MAX_ROWS`; se o retorno for grande (linhas de DRE, série de forecast), usar padrão summary+sample como no get_replenishment.
- Read-only estrito (só rpc()/select()).
- NÃO quebrar testes existentes; contagem de tools 27→31 em tools.test.ts.

### get_dre_result → get_dre_operational_by_competence
- Param provável: competência (YYYY-MM). Confirmar assinatura EXATA na migration (ver Phases 86/87/96/97 no ROADMAP/STATE).
- Rótulo de veracidade OBRIGATÓRIO: **competência ≠ pagos ≠ caixa**. Este é o "lucro de verdade" (método validado),
  distinto de get_margin_summary (base pagos). Deixar claro que imposto aqui = apuração real (guia), não imposto cheio
  (ver feedback DRE imposto = apuração). Confirmar as linhas/blocos que a RPC retorna.

### get_dre_cash → get_dre_cash (+ get_dre_cash_forecast)
- DRE regime de CAIXA (apuração por recebimento Mercado Pago — Phase 99). Rótulo: caixa (recebimento MP) ≠ competência.
- Avaliar se expõe também o forecast (get_dre_cash_forecast) numa tool só ou nota. Confirmar params (competência? janela?).

### get_projected_balance → get_projected_balance_summary
- Saldo projetado em 3 cenários (otimista/realista/pessimista). Rótulo: PROJEÇÃO, não realizado. Confirmar params (horizonte?).
- Cuidado p/ não duplicar get_treasury_panel/get_cashflow já existentes — este dá os 3 cenários; explicar a diferença no description.

### get_taxes_paid → get_imposto_guia + get_inss_guia
- Impostos REAIS por guia (o que se paga de fato, com créditos), por competência. Rótulo: guia real ≠ imposto cheio
  (total_tax serve só p/ MCO/precificação). Uma tool que cruza ICMS/PIS/COFINS (imposto guia) + INSS folha (M+1, Phase 98).

### Playbook Gabriel (ampliar bloco "2. GABRIEL — Financeiro & Precificação" em playbooks.ts)
- DRE de resultado (competência) vs DRE de caixa (recebimento) vs base-pagos: quando usar cada uma.
- Break-even de caixa do mês (Phase 100: quanto falta vender p/ fechar no zero).
- Imposto guia real vs imposto cheio. Estilo DADO→Diagnóstico→Ação→Métrica; citar fontes; não remover conteúdo.

### Persona prompt.ts
- Ampliar "USO DAS FERRAMENTAS" citando as 4 tools novas e quando usá-las (ex.: "qual meu lucro real em junho?" → get_dre_result).
- Estender VERACIDADE com: competência ≠ pagos ≠ caixa; saldo projetado = projeção; imposto guia ≠ imposto cheio.
- NÃO quebrar greps de prompt.test.ts.

### Testes
- Espelhar 103: anti-IDOR org-only por tool, cap, rótulos; greps de persona. Mockar supabase client como o padrão atual.

### Claude's Discretion
- Nomes exatos dos params conforme as RPCs reais; formato do retorno (summary/sample) respeitando o cap.
- Se get_dre_cash_forecast vira tool própria ou entra no get_dre_cash — decidir no plano conforme as assinaturas.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec + fase anterior (padrão validado)
- `docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` — Grupo 2, contratos.
- `.planning/phases/103-.../103-01-PLAN.md` e `103-RESEARCH.md` — molde de tool org-only + summary/sample + testes.

### Código a modificar
- `supabase/functions/nexo-chat/tools.ts` (agora 27 tools; molde org-only = get_coverage/get_treasury_panel).
- `supabase/functions/nexo-chat/prompt.ts` (PERSONA), `playbooks.ts` (bloco "2. GABRIEL"), `tools.test.ts`, `prompt.test.ts`.

### Fonte de dados (referência de contrato — confirmar assinaturas via grep nas migrations)
- `src/hooks/useDreOperational.ts` → `get_dre_operational_by_competence`
- `src/hooks/useDreCash.ts` + `useDreCashForecast.ts` → `get_dre_cash` / `get_dre_cash_forecast`
- `src/hooks/useProjectedBalance.ts` → `get_projected_balance_summary`
- `src/hooks/useImpostoGuiaReal.ts` + `useInssGuiaReal.ts` → `get_imposto_guia_by_competence` / `get_inss_guia_by_competence`
- `supabase/migrations/` — grep pelas definições (params, INVOKER/DEFINER, colunas). Ver STATE Phases 86/87/94/96/97/98/99/100.
</canonical_refs>

<specifics>
## Specific Ideas
- DB alvo: `ckcdevcxgvueywivefgx`. Deploy da EF é do orquestrador (CLI/MCP), não do executor.
- Regra DRE imposto = apuração a pagar (guias reais, com créditos), NÃO total_tax — ver feedback_garment_dre_imposto_apuracao.
- INSS folha segue régua M+1 (competência) — Phase 98.
</specifics>

<deferred>
## Deferred Ideas
- Preços/competitivo/completude → Phase 105.
- RAG → Fase 2.
</deferred>

---

*Phase: 104-consultor-cco-dre-real-e-caixa*
*Context gathered: 2026-07-28 via brainstorming + spec*
