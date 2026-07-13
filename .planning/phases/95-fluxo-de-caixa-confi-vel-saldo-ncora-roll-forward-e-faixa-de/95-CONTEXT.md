# Phase 95: Fluxo de Caixa Confiável - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning
**Source:** Brainstorming com Wesley (sessão 2026-07-13) + spike de viabilidade

<domain>
## Phase Boundary

Tornar a página `/fluxo-de-caixa` confiável, eliminando os dois furos que a fazem "nunca bater":
saldo de abertura que envelhece e dados que congelam sem aviso. NÃO inclui automação de leitura
de saldo bancário (spike provou inviável — MP retorna 403, Bradesco sem via grátis).

O design completo e as provas do diagnóstico estão no spec canônico (ler antes de planejar):
`.planning/specs/2026-07-13-fluxo-caixa-confiavel.md`
</domain>

<decisions>
## Implementation Decisions (TRAVADAS por Wesley)

### Abordagem do saldo
- **Âncora + roll-forward** (decidido após spike descartar API de saldo). O usuário digita o saldo
  real de vez em quando (âncora com data); o sistema rola o saldo de abertura dos dias seguintes.
- **NÃO automatizar leitura de saldo** (MP 403 forbidden; Bradesco exige agregador pago). Fora de escopo.

### Fórmula do roll-forward
- `saldo_abertura = âncora + Σ entradas − Σ saídas`, no intervalo `[anchor_date, hoje)`.
- **Entradas:** `cash_inflows.net_amount` por `release_date` no intervalo.
- **Saídas: SOMENTE `status='paid'`** (decisão explícita — alinhada ao fluxo do Wesley de dar baixa
  no Tiny no dia do pagamento). `pending` NÃO entra no roll.
- **Convenção:** `initial_balance` = saldo de ABERTURA do `anchor_date`; a curva soma `[hoje, fim]`
  por cima. Âncora de hoje (intervalo vazio) → resultado idêntico ao atual (não-regressão).

### Alerta (faixa de saúde dos dados)
- Dispara em 3 situações de **confiabilidade** (não de negócio): Tiny sync > 6h, MP sync > 6h,
  âncora > 7 dias. (Wesley deixou de fora "curva no vermelho à frente" — ele já lê isso na curva.)
- Limiares: **6h** para syncs (cron roda a cada 3h = 2 ciclos), **7 dias** para âncora.
- Texto acionável por gatilho, com link pra Integrações no caso do Tiny.

### Técnico
- Nova coluna `financial_settings.balance_anchor_date` (backfill = `updated_at::date`).
- Função `get_rolled_opening_balance(p_org_id)` — lógica num lugar só; consumida por
  `get_cashflow`, `get_projected_balance_summary`, `get_treasury_panel` (trocam `v_initial`).
- Nova RPC `get_cashflow_data_health(p_org_id)`.
- Frontend: faixa no topo de `MLFluxoCaixa.tsx` via hook novo (`useCashflowDataHealth`).
- RPCs em **SECURITY INVOKER**, org via `is_org_member` (padrão do projeto — DEFINER+org = IDOR).
- **TDD.** Teste-âncora obrigatório: `anchor_date=hoje` → curva idêntica à atual (não-regressão).

### Claude's Discretion
- Nomes exatos de hooks/componentes, estrutura de testes, formato do retorno da RPC de health
  (jsonb vs table), estilo visual da faixa (seguir design system existente da página).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design e diagnóstico
- `.planning/specs/2026-07-13-fluxo-caixa-confiavel.md` — design completo, fórmula do roll-forward,
  provas do diagnóstico (saldo velho, token Tiny morto, MP 403), riscos e fora-de-escopo.

### Código a tocar (mapear no research)
- RPCs no banco Supabase `ckcdevcxgvueywivefgx`: `get_cashflow`, `get_projected_balance_summary`,
  `get_treasury_panel` (todas usam `financial_settings.initial_balance` hoje).
- Frontend: `MLFluxoCaixa.tsx` + hooks `useCashFlowData`, `useTreasuryPanel`, `useProjectedBalance`.
</canonical_refs>

<specifics>
## Specific Ideas

- Estado real verificado em prod (13/07): `initial_balance` era manual e travou 18 dias; sync Tiny
  congelou 5 dias por token morto. A faixa de alerta teria pego ambos.
- Migrations aplicadas via MCP Supabase (padrão do projeto — sem token CLI). Deploy só após auditoria.
</specifics>

<deferred>
## Deferred Ideas

- Automação de leitura de saldo real (MP via app de pagamentos / agregador Open Finance pago).
- Alerta de negócio "curva projetada negativa à frente".
- Automação da reancoragem (segue manual, lembrada pelo alerta de âncora velha).
</deferred>

---

*Phase: 95-fluxo-caixa-confiavel*
*Context gathered: 2026-07-13 via brainstorming + spike*
