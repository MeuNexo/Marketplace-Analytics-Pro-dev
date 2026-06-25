# Phase 60: Alinhamento da DFC (Fluxo de Caixa) - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Source:** Diagnóstico fechado em sessão com Wesley (dados live em prod + decisões do owner)

<domain>
## Phase Boundary

Alinhar a **projeção** do gráfico de Fluxo de Caixa (página `/caixa`) com a DFC/Tiny do Wesley.
Continuação direta da Phase 59 (que travou a regra de projeção 7d e o `status='pending'`/CASHFIX-04).

Escopo: a RPC `public.get_cashflow` (projeto Supabase `ckcdevcxgvueywivefgx`, org Pé Vermeio
`7f615df7-7bac-45e5-8a93-827fb9ddeec7`) e o front-end da página `/caixa` que a consome.

FORA de escopo: a linha confirmada `accumulated_balance` (reconciliada ao centavo na Phase 49/59 —
NÃO tocar), o sync de contas a pagar (Phase 59, já corrigido), o Simulador (Phase 50).

## Diagnóstico (já provado nesta sessão, NÃO re-pesquisar)

Estado atual em prod (hoje BRT 2026-06-25): `v_sma` = R$5.880,68/dia (bate EXATO com a "Entrada
Mercado Livre" da DFC do Wesley). `initial_balance` = R$16.833,14 (correto). Sync de payables fresco.

**Problema 1 — ENTRADA suprimida pela cauda do MP.** A regra da Phase 59 (CASHFIX-01) no dia 8+ usa
`d.inc` onde `d.inc>0` e `v_sma` só onde `d.inc=0`. Mas o MP só agenda liberações ~30d à frente e a
cauda (09–20/07) tem recebimentos confirmados MINÚSCULOS (R$56–785/dia). A regra vê `d.inc>0` e usa
esses R$56–785 em vez da média R$5.880 → a entrada projetada some justo onde vêm as saídas grandes.

**Problema 2 — SAÍDA conta "Previsões de compra" (ordens de compra não faturadas).** O `cash_outflows`
inclui linhas com `category='Previsões de compra'` (ordens de compra: OC 404, OC 383, OC 410, OC 386).
São previsões, não contas firmes. Reconciliação provada ao centavo (período 05–12/07):
- Dashboard saídas em aberto (`status='pending'`): R$99.495,58
- (−) Previsões de compra: OC 383 (09/07) R$10.390,28 + OC 410 (10/07) R$1.999,51 = R$12.389,79
- (=) R$87.105,79 = **exatamente** o "contas a pagar" do Tiny do Wesley (filtro correto)

Excluir as previsões também resolve a **OC nº 383 contada 2x**: ela aparece em 09/07 como
`category='Previsões de compra'` (estágio previsão) e em 11/07 como conta a pagar real já faturada
(`category` nula). Filtrando previsões, fica só a conta real de 11/07.
</domain>

<decisions>
## Implementation Decisions (LOCKED — decididas pelo Wesley)

### ENTRADA — Opção A (média como piso)
- No dia 8+ (datas > hoje(BRT)+7), `accumulated_balance_sma` usa `GREATEST(d.inc, v_sma)` no lugar do
  CASE atual `WHEN d.inc>0 THEN d.inc ELSE v_sma`. A média de 15d vira PISO: dias de cauda com
  confirmado minúsculo recebem R$5.880; dias com confirmado genuinamente maior mantêm o real (é max,
  não soma — sem dupla contagem).
- Dias 1–7 (datas ≤ hoje(BRT)+7) continuam **confirmado-only** (`d.inc`), regra travada na Phase 59 —
  NÃO mexer (não inflar o curto prazo, onde o MP já tem as liberações agendadas).
- `daily_projection` no dia 8+ passa a ser `GREATEST(0, v_sma - d.inc)` (o quanto a média acrescenta
  acima do confirmado). Dias 1–7 e a coerência com a linha continuam como na Phase 59.

### SAÍDA — Toggle de "Previsões de compra" (decisão do Wesley: habilitar/desabilitar na página)
- `get_cashflow` ganha 4º parâmetro `p_include_purchase_forecasts BOOLEAN DEFAULT false`.
- `false` (PADRÃO): a CTE `exp` filtra `AND COALESCE(category,'') <> 'Previsões de compra'` (somado ao
  `AND co.status='pending'` já existente do CASHFIX-04). Caixa bate com a Tiny do Wesley.
- `true`: soma as previsões de compra (visão "e se eu já comprometer as compras").
- O default `false` garante que chamadas antigas de 3 args (se houver) continuem corretas.

### Assinatura da função (cuidado de migração)
- Trocar a assinatura exige `DROP FUNCTION public.get_cashflow(UUID,DATE,DATE)` ANTES do `CREATE` da
  versão de 4 args com default — senão o Postgres dá "function ... is not unique" quando chamada com 3 args.
- Preservar: `LANGUAGE plpgsql SECURITY INVOKER SET search_path='public'`, `REVOKE EXECUTE ... FROM
  PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated`. A nova assinatura é `(UUID,DATE,DATE,BOOLEAN)`.

### FRONTEND
- Toggle/switch "Incluir previsões de compra" na página `/caixa`, **desligado por padrão**.
- O estado do toggle propaga o 4º argumento (`p_include_purchase_forecasts`) na chamada RPC `get_cashflow`.
- Localizar o hook/serviço que chama `get_cashflow` (provável em `src/hooks` ou na página de Caixa) e
  passar o boolean; usar o componente Switch do shadcn/ui já presente no projeto.
- A linha confirmada (`accumulated_balance`) NÃO muda com o toggle (o filtro de previsões afeta só a
  CTE `exp`, que entra em ambas as linhas — confirmar no plano que o comportamento é o desejado:
  o toggle muda tanto a projeção quanto a confirmada, pois previsões não são caixa real de nenhuma das duas).

### Curva esperada após o fix (validação de referência, toggle OFF, com Opção A)
| Data | Saldo projetado (OFF) |
|------|----------------------:|
| 05/07 | +5.241 |
| 09/07 | +24.042 |
| 10/07 | +7.893 |
| 11/07 | −5.892 |
| 15/07 | −27.836 |
Nota: com as saídas reais da Tiny (R$87k em 05–12/07) e entrada R$5.880/dia, a curva vira negativa
por volta de 11/07 — isso é o comportamento correto (não o "15/07" da sessão passada, que era efeito
do bug). Wesley deve validar visualmente contra a DFC dele.

### Claude's Discretion
- Nome exato da migration (seguir convenção `2026MMDDHHMMSS_...` da Phase 59, ex. `20260660000000_cashflow_dfc_alignment.sql`).
- Detalhes de UI do toggle (posição, label exato, tooltip) dentro do padrão shadcn/ui do projeto.
- Como o hook expõe o parâmetro (estado React local na página vs. param do hook de query).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend — RPC get_cashflow (baseline a estender)
- `supabase/migrations/20260659000300_cashflow_outflows_pending_only.sql` — versão ATUAL da função
  (CASHFIX-04, `status='pending'`). É a base sobre a qual a Phase 60 estende (GREATEST + 4º param).
- `supabase/migrations/20260659000000_cashflow_projection_7d_rule.sql` — regra de projeção 7d (CASHFIX-01),
  comentários explicando o CASE de `accumulated_balance_sma` e `daily_projection`.
- `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` — data BRT (base anterior).

### Frontend — página /caixa
- Localizar a página e o hook que chamam `rpc('get_cashflow', ...)` (grep por `get_cashflow` em `src/`).
  Provável `src/pages/.../Caixa*.tsx` e/ou `src/hooks/use*Cashflow*` ou similar.
- CLAUDE.md do projeto — Switch do shadcn/ui, padrões TanStack Query, design tokens.

### Phase anterior (contexto)
- `.planning/phases/59-fluxo-caixa-correcoes/59-CONTEXT.md` e `59-01-SUMMARY.md` / `59-02-SUMMARY.md`.
</canonical_refs>

<specifics>
## Specific Ideas

- Deploy da migration: via MCP Supabase `apply_migration` (a Phase 59 fez assim; NÃO usar SQL Editor manual).
- Branch atual: `gsd/phase-59-fluxo-caixa-correcoes` (PR #10 aberto). Decidir no plano se a Phase 60 entra
  no mesmo PR ou abre novo (config git branching_strategy = none).
- Frontend: push → Vercel auto-deploy.
</specifics>

<deferred>
## Deferred Ideas

- Indicador de "última atualização do contas a pagar" na UI (estava como opcional na Phase 59) — não é escopo da 60.
- Qualquer ajuste no valor de `v_sma` em si (Wesley confirmou R$5.880/dia, não mudar a fórmula da média).
</deferred>

---

*Phase: 60-alinhamento-da-dfc-fluxo-de-caixa*
*Context gathered: 2026-06-25 (diagnóstico fechado com dados live + decisões do Wesley)*
