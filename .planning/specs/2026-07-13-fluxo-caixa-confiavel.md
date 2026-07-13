# Fluxo de Caixa Confiável — Design (2026-07-13)

## Problema
Wesley não confia na página `/fluxo-de-caixa`: "os valores nunca batem". Diagnóstico (sessão
2026-07-13) provou que a **lógica está correta** (reconciliada ao centavo em jun/2026), mas
**dois dados de alimentação falham EM SILÊNCIO** e contaminam a curva inteira (que é saldo acumulado):

1. **Saldo de abertura manual e velho** — `financial_settings.initial_balance` é digitado à mão e
   não é atualizado; ficou 18 dias parado (−1.495,45 de 25/06 vs −9.495,45 real de 13/07). Como é a
   base do acúmulo, o erro se propaga por toda a projeção.
2. **Sync do Tiny congelado sem aviso** — o token OAuth do Tiny morreu ("Token is not active") em
   08/07 e o sync de contas a pagar ficou 5 dias parado. O cron reportava "succeeded", mas a Edge
   Function não gravava. A página não avisou nada.

Spike descartou automatizar o saldo via API bancária: endpoint de saldo do MP retorna **403
Forbidden** (nosso OAuth de marketplace não tem escopo de pagamentos); Bradesco não tem via
gratuita (Open Finance exige agregador pago). **Automatizar leitura de saldo está fora de alcance.**

## Decisões aprovadas por Wesley
- **Abordagem do saldo: âncora + roll-forward** (não API de saldo, não agregador pago).
- **Saídas no roll-forward: só o que foi dado baixa (`status='paid'`)** — alinhado ao fluxo do Wesley
  de dar baixa no Tiny no dia do pagamento.
- **Alerta dispara em 3 situações de confiabilidade:** Tiny travado, MP travado, âncora velha.
  (Deixado de fora: alerta de negócio "curva no vermelho" — Wesley já lê isso na curva.)
- **Limiares:** sync Tiny/MP > 6h (cron roda a cada 3h = 2 ciclos perdidos); âncora > 7 dias.

## Arquitetura

### Parte A — Saldo âncora + roll-forward
Hoje `get_cashflow` usa `v_initial := initial_balance` tratado como "saldo de abertura de HOJE".
Passa a ser um saldo **rolado** a partir da última âncora manual.

- **Convenção:** `initial_balance` = saldo de **abertura** do dia da âncora. A curva soma os fluxos de
  `[hoje, fim]` por cima. O roll fecha o gap `[anchor_date, hoje)`.
- **Nova coluna** `financial_settings.balance_anchor_date date` — a data em que o Wesley digitou o
  saldo. Migration de backfill: registros existentes recebem `balance_anchor_date = updated_at::date`.
  (Coluna explícita para não acoplar a `updated_at`, que outros updates podem tocar.)
- **Nova função** `get_rolled_opening_balance(p_org_id uuid) returns numeric`:
  ```
  v_initial = âncora
            + Σ cash_inflows.net_amount  onde release_date ∈ [anchor_date, hoje)
            − Σ cash_outflows.amount     onde status='paid' e outflow_date ∈ [anchor_date, hoje)
  ```
  Se `anchor_date = hoje` → intervalo vazio → retorna a âncora crua (**idêntico ao comportamento
  atual** = garantia de não-regressão).
- **Consumo:** `get_cashflow`, `get_projected_balance_summary` e `get_treasury_panel` trocam
  `v_initial := initial_balance` por `v_initial := get_rolled_opening_balance(p_org_id)`. Lógica num
  lugar só (a função helper), as 3 RPCs apenas chamam.

### Parte B — Faixa de saúde dos dados (alerta)
- **Nova RPC** `get_cashflow_data_health(p_org_id uuid)` retorna:
  - `tiny_last_sync` (max `synced_at` de cash_outflows), `tiny_hours_ago`, `tiny_stale` (> 6h)
  - `mp_last_sync` (max `synced_at` de cash_inflows), `mp_hours_ago`, `mp_stale` (> 6h)
  - `anchor_date`, `anchor_days_ago`, `anchor_stale` (> 7d)
- **Frontend:** faixa (banner) no topo de `MLFluxoCaixa.tsx`, via hook `useCashflowDataHealth`.
  Vermelha quando qualquer flag `stale`; texto acionável por gatilho:
  - Tiny → *"Contas a pagar sem atualizar há Xh — reconecte o Tiny em Integrações"* (+ link).
  - MP → *"Entradas do Mercado Pago sem atualizar há Xh."*
  - Âncora → *"Você não confirma o saldo real há X dias — atualize para a curva não desviar."*

## Segurança
RPCs novas em **SECURITY INVOKER**, org via `is_org_member` (padrão do projeto — DEFINER+org param
= IDOR). Testar como role `authenticated` real, não só `postgres`. Anti-IDOR: cross-org retorna 0.

## Testes (TDD)
- `get_rolled_opening_balance`: (a) âncora=hoje → âncora crua; (b) âncora −3d com inflows/outflows →
  soma correta; (c) outflow `pending` no intervalo é **ignorado** (só `paid` conta).
- `get_cashflow` não-regressão: com `anchor_date=hoje`, curva idêntica à atual.
- `get_cashflow_data_health`: synced velho → `stale=true`; recente → `false`; âncora 8d → `stale`.
- Frontend: banner aparece/desaparece conforme flags; textos e link corretos.

## Fora de escopo
- Captura de saldo real (MP 403 / Bradesco) via API ou agregador Open Finance.
- Alerta de negócio "curva projetada negativa à frente".
- Automação da reancoragem (segue manual, ~1x/semana, lembrada pelo alerta).

## Riscos / ressalvas
- **Entradas não-MP** (dinheiro que cai direto no Bradesco, raro na operação) não entram no roll →
  drift lento, corrigido pela reancoragem semanal + alerta de âncora velha.
- **Baixa de conta esquecida no Tiny** → roll conta menos saída → saldo otimista. Mitigado pelo
  hábito de dar baixa no dia + o alerta não cobre isso (é comportamento, não dado velho).

## Encaminhamento
Vira fase GSD no garment (provável Phase 95). Duas partes independentes (A backend+RPCs, B
health+frontend) que podem ser 1 fase com 2 waves ou 2 fases pequenas — decidir no plan.
