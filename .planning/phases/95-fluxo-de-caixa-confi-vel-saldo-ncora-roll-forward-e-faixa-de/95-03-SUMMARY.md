# 95-03 — SUMMARY (checkpoint do orquestrador)

**Status:** Provas técnicas PASS (aplicação + SQL). **Pendente: ok visual do Wesley** (gate humano bloqueante).
**Executado por:** orquestrador (não gsd-executor — projeto aplica migrations só via MCP).
**Data:** 2026-07-13. Projeto vivo: `ckcdevcxgvueywivefgx`.

## 1. Drift de timestamp (Pitfall 4) — resolvido
`SELECT max(version)` no banco vivo = **`20260711125934`** (dre_month_close, 11/07). Os arquivos da 95
usavam `20260695xxxxxx`, que é **menor** que o max → renumerados para **`20260713xxxxxx`** (hoje),
preservando a ordem relativa. Commit `32d80048`.

## 2. Aplicação — 4 migrations via `apply_migration` (todas success:true)
1. `cashflow_balance_anchor` — coluna `balance_anchor_date` + backfill (`updated_at::date`) + `get_rolled_opening_balance`
2. `cashflow_rpcs_use_rolled_balance` — get_cashflow / get_projected_balance_summary / get_treasury_panel trocam `v_initial`
3. `set_financial_balance_rpc` — escrita atômica da âncora
4. `cashflow_data_health_rpc` — RPC de saúde

## 3. Sanity do backfill + NEUTRALIZAÇÃO de não-regressão (decisão do orquestrador — documentar p/ Wesley)
Estado pré-migration de `financial_settings`:
| org | initial_balance | updated_at | backfill âncora |
|-----|-----------------|-----------|-----------------|
| Pé Vermeio `7f615df7` | **−1495.45** | 13/07 (hoje) | 13/07 → não-regressão exata |
| Thales `e4150d57` | 0 | 18/06 | **18/06 (25 dias atrás)** |

**Achado:** Thales tem **116.859 `cash_inflows`** (revenda ~R$6,35M) e 0 outflows. Backfillar a âncora
dela para 18/06 rolaria o saldo de abertura de `0` para **milhões** — regressão/surpresa.
**Ação tomada (conservadora, honra a decisão travada de não-regressão):** após o backfill, forcei
`balance_anchor_date = hoje` para **todas** as orgs (`UPDATE financial_settings SET balance_anchor_date = hoje_BRT`).
Assim a curva de cada org fica **idêntica à atual** até o dono reancorar com um saldo real.
`initial_balance` **não** foi alterado por mim.

> ⚠️ **Descoberta colateral p/ Wesley:** o `initial_balance` da Pé Vermeio na prod está **−1495,45**
> (valor velho de 25/06), **não** −9.495,45. O UPDATE que fizemos nesta sessão **não persistiu** (ou foi
> revertido). Não afeta a não-regressão, mas é o item nº1 a reancorar quando você validar.

## 4. Provas SQL ao vivo

### 4.1 Não-regressão (decisão travada) — PASS
Curva de `get_cashflow(PV, hoje, hoje+30)` com âncora=hoje: `md5` da série =
`a9187696f1fe4693740eff501a90990b` **==** baseline pré-migration `a9187696f1fe4693740eff501a90990b`.
`get_rolled_opening_balance(PV)` com âncora=hoje = **−1495.45** = `initial_balance` cru. **Delta 0.**

### 4.2 Roll com âncora passada — PASS
Âncora PV setada temporariamente para hoje−30 (e restaurada depois):
- `get_rolled_opening_balance` = **−48740.01**
- Fórmula manual (`âncora + Σ inflows.net − Σ paid.amount` no intervalo) = **−48740.01** → **bate**.

### 4.3 Pending ignorado (Pitfall 5) — PASS
No mesmo intervalo havia **R$31.373,60** de outflows `status='pending'`. Se contassem, o resultado seria
**−80113.61**; a função retornou **−48740.01** (só `paid`). Pending corretamente excluído (teste não-vazio).

### 4.4 Health flags — PASS (e coerente com o estado real de hoje)
`get_cashflow_data_health(PV)`: tiny_last_sync 13/07 11:59 (~1,2h, `stale=false`) · mp_last_sync 13/07
09:02 (~4,1h, `stale=false`) · anchor 13/07 (0d, `stale=false`). **Hoje a faixa não aparece** (dados
frescos) — comportamento esperado. `tiny_last_sync` usa `MAX(synced_at) FILTER (source='tiny')` (Pitfall 3).

### 4.5 Anti-IDOR (role `authenticated` real, JWT do owner da PV) — PASS
Impersonando o owner da PV (`ce8c797c…`) e pedindo dados da **Thales**:
| caso | rolled | mp_last_sync | tiny_last_sync | anchor_date |
|------|--------|--------------|----------------|-------------|
| own (PV) | −1495.45 | 13/07 09:02 | 13/07 11:59 | 13/07 |
| cross (Thales) | **0** | **NULL** | **NULL** | **NULL** |

Thales tem 116.859 inflows, mas o usuário da PV recebe tudo NULL/0 → **RLS filtra, sem vazamento**.
INVOKER + `is_org_member`/`get_org_role` das tabelas é o guard (nenhuma checagem manual redundante).

## 5. Fora de escopo / risco registrado
- **`get_daily_balance`** (usada por `src/hooks/useTodayBalance.ts`) ainda lê `initial_balance` **cru** —
  não estava na lista travada de 3 RPCs, **não** foi migrada. Decisão futura: incluí-la no roll ou não.
  Enquanto a âncora ficar em hoje, ela também não regride.
- Entradas fora do MP (dinheiro direto no Bradesco) não entram no roll — drift lento coberto pela
  reancoragem semanal + alerta de âncora velha (já era ressalva do spec).

## 6. Pendente (gate humano bloqueante) — só Wesley pode fechar
1. **Ok visual da faixa** em preview/prod: aparece quando há gatilho, some quando não há; textos e link `/integracoes`.
2. **Reancorar o saldo real da PV** pelo dialog e confirmar que `balance_anchor_date` vira hoje (testa o `set_financial_balance`) e que o alerta de âncora some.
3. Digitar **"approved"** para fechar a Phase 95, ou descrever problemas.
