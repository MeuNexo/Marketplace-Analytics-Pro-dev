# Teste de Isolamento Multi-Tenant 2-Org (TENANT-05 / D-16)

**Fase:** 43 — Multi-Tenant Hardening
**Plano:** 43-04 (Wave 3 — teste de aceitação da fase)
**Projeto Supabase (produção):** `ckcdevcxgvueywivefgx`
**Roteiro escrito em:** 2026-06-14 (Task 1)
**Execução / resultados:** Task 2 (checkpoint blocking — orquestrador via MCP + Wesley)

> Este documento é o roteiro **reproduzível** do teste de isolamento ponta-a-ponta.
> A Task 1 apenas escreve o roteiro. A Task 2 (checkpoint `human-verify`, gate=blocking)
> executa cada item, preenche o campo **Resultado** (PASS/FAIL) e cola a **Evidência**.
> A fase **NÃO fecha** com nenhum FAIL aberto (qualquer FAIL vira gap documentado).

---

## 0. Pré-requisitos e contexto

### 0.1 Orgs reais já em produção (usar como Org A / Org B)

Já existem **2 organizações reais** em produção — usá-las evita criar orgs fake e exercita
o isolamento sobre dados verdadeiros. (Há uma seção de setup limpo em §1 caso seja necessário
um par controlado.)

| Papel no teste | Organização | org_id | Tier |
|----------------|-------------|--------|------|
| **Org A** | Pé Vermeio | `7f615df7-7bac-45e5-8a93-827fb9ddeec7` | enterprise (`sync_interval_minutes = -1`, `history_days = -1`) |
| **Org B** | Thales | _(preencher na Task 2 via `SELECT id, name FROM organizations WHERE id <> '7f615df7-...';`)_ | _(confirmar tier)_ |

> **Cada org tem uma loja ML distinta** (`ml_user_id` diferente em `ml_tokens`). Confirmar na Task 2:
> ```sql
> SELECT organization_id, ml_user_id, (access_token IS NOT NULL) AS tem_token, updated_at
> FROM public.ml_tokens
> ORDER BY organization_id, updated_at DESC;
> ```
> Anotar abaixo, pois os UUIDs de usuário e os `ml_user_id` são reusados em todos os itens:
>
> | Var | Significado | Valor (preencher na Task 2) |
> |-----|-------------|------------------------------|
> | `ORG_A` | org_id Pé Vermeio | `7f615df7-7bac-45e5-8a93-827fb9ddeec7` |
> | `ORG_B` | org_id Thales | `__________` |
> | `USER_A` | UUID de um membro de A (owner) | `__________` |
> | `USER_A_VIEWER` | UUID de um membro `viewer` de A | `__________` (criar via convite se não existir — ver §1.3) |
> | `USER_B` | UUID de um membro de B | `__________` |
> | `MLUID_A` | `ml_user_id` da loja ML de A | `__________` |
> | `MLUID_B` | `ml_user_id` da loja ML de B | `__________` |

### 0.2 Estado aplicado pelos planos 43-01/02/03 (pré-condição do teste)

Confirmar que o hardening está em produção **antes** de testar (senão o teste valida o estado errado):

- **43-01 aplicado** (RLS org-first `ml_product_costs` = policies `mpc_select/insert/update/delete`;
  `ml_billing_monthly` = só `org_member_billing_select` FOR SELECT; backfill + `NOT NULL` em
  `ml_product_costs`).
- **43-02 deployado** (token lookup `ORDER BY updated_at DESC` nas 5 EFs; guard `is_org_member`
  em ml-ads/ml-inventory/ml-reputation; RPC `check_quota`; gate em `process-sync-job` v15;
  cron Pattern B).
- **43-03 aplicado** (tabela `onboarding_progress` + RLS).

Query de confirmação rápida (Task 2):
```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('ml_product_costs','ml_billing_monthly','onboarding_progress')
ORDER BY tablename, policyname;
```
PASS esperado: `ml_billing_monthly` tem **somente** `org_member_billing_select` (cmd=SELECT);
`ml_product_costs` tem `mpc_select/insert/update/delete`.

### 0.3 MÉTODO DE VERIFICAÇÃO DE RLS (crítico — ler antes de §2/§3)

O `service_role` (usado pelo MCP `execute_sql`) **bypassa RLS**. Rodar um `SELECT` direto via MCP
**NÃO** testa isolamento — retornaria linhas de todas as orgs. Para exercitar a RLS é preciso
**simular o contexto `authenticated`** de um usuário específico, dentro de uma transação:

```sql
BEGIN;
  -- assume o papel do usuário autenticado X (substituir o sub pelo UUID real)
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<USER_UUID>","role":"authenticated"}';

  -- a partir daqui auth.uid() = <USER_UUID> e a RLS está ATIVA
  SELECT ...;            -- a query do item de teste
ROLLBACK;                -- nada é persistido; é só leitura/tentativa
```

Regras do método:
- **Sempre** `SET LOCAL ... ` dentro de `BEGIN ... ROLLBACK/COMMIT` — `LOCAL` garante que o papel
  volta a `service_role` ao fim da transação.
- Para tentativas de escrita (ME-06), usar o mesmo padrão e esperar **erro de policy** (a transação
  aborta; fechar com `ROLLBACK`).
- Para testar "A não vê B", autenticar como `USER_A` e filtrar/contar linhas cujo `organization_id = ORG_B`
  → esperar **0 linhas** (a RLS já não deixa nem aparecer).
- Repetir simetricamente como `USER_B` olhando para `ORG_A`.

---

## 1. Setup 2-org (apenas se precisar de um par limpo)

> Em produção as 2 orgs já existem (§0.1). Esta seção é o procedimento para montar um par
> controlado do zero, caso a Task 2 decida não usar dados reais.

- [ ] **1.1 Criar Org A e Org B** via EF `super-admin-orgs` (super-admin), cada uma com um owner distinto
      (`USER_A`, `USER_B`). PASS: `SELECT count(*) FROM organizations WHERE id IN (ORG_A, ORG_B)` = 2.
- [ ] **1.2 Conectar uma loja ML distinta em cada org** via OAuth ML (`mercado-libre-integration` / `ml-oauth`),
      gerando `ml_tokens` com `ml_user_id` diferente por org (`MLUID_A` ≠ `MLUID_B`).
      PASS: 2 linhas em `ml_tokens`, `ml_user_id` distintos, `organization_id` correto, `access_token` não-nulo.
- [ ] **1.3 Criar um `viewer` em Org A** (`USER_A_VIEWER`) via `org-invite-create` + `org-invite-accept` com role `viewer`
      (necessário para o item ME-06, §4). PASS: `SELECT get_org_role('<USER_A_VIEWER>', ORG_A)` = `viewer`.
- [ ] **1.4 Disparar um sync em cada org** (orders/ads) para popular caches com dados reais por org.
      PASS: cada cache tem linhas com `organization_id` = ORG_A e ORG_B respectivamente.

**Resultado §1:** ____ (PASS/FAIL/N-A — usado par real)
**Evidência:** _______________________________________________

---

## 2. Isolamento de leitura via RLS — por tabela (TENANT-05 / T-43-12)

**Objetivo:** logado (simulado) como `USER_A`, nenhuma linha de `ORG_B` deve ser visível em **nenhuma**
tabela com escopo de org — e vice-versa.

**Tabelas de cache/scope-org a verificar (lista exata):**

1. `ml_daily_cache`
2. `ml_hourly_cache`
3. `ml_product_daily_cache`
4. `ml_ads_daily_cache`
5. `ml_ads_campaigns_cache`
6. `ml_ads_products_cache`
7. `ml_state_daily_cache`
8. `ml_user_cache`
9. `ml_product_costs`
10. `ml_billing_monthly`
11. `ml_billing_daily`
12. `ml_tokens`
13. `ml_tax_config`
14. `ml_targets`
15. `ml_sync_log`
16. `onboarding_progress`

> Se a Task 2 descobrir tabelas adicionais com coluna `organization_id` e RLS de org, acrescentar à lista
> (`SELECT table_name FROM information_schema.columns WHERE column_name='organization_id' AND table_schema='public';`).

**Procedimento por tabela (executar como USER_A, depois como USER_B):**

```sql
-- Como USER_A: contar quantas linhas de OUTRA org (ORG_B) o usuário A consegue ver.
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<USER_A>","role":"authenticated"}';
  SELECT '<tabela>' AS tabela,
         count(*) FILTER (WHERE organization_id = '<ORG_B>') AS ve_da_org_b,
         count(*)                                            AS total_visivel_para_A
  FROM public.<tabela>;
ROLLBACK;
```
Repetir trocando `USER_A`→`USER_B` e `ORG_B`→`ORG_A` (B não pode ver A).

**Critério de PASS (por tabela):** `ve_da_org_b = 0` quando autenticado como A, e `ve_da_org_a = 0`
quando autenticado como B. (E `total_visivel` > 0 para A nas tabelas que A realmente possui — prova
que a RLS deixa ver o próprio, só bloqueia o alheio.)

| # | Tabela | A vê linhas de B? (espera 0) | B vê linhas de A? (espera 0) | Resultado | Evidência |
|---|--------|------------------------------|------------------------------|-----------|-----------|
| 1 | ml_daily_cache | | | | |
| 2 | ml_hourly_cache | | | | |
| 3 | ml_product_daily_cache | | | | |
| 4 | ml_ads_daily_cache | | | | |
| 5 | ml_ads_campaigns_cache | | | | |
| 6 | ml_ads_products_cache | | | | |
| 7 | ml_state_daily_cache | | | | |
| 8 | ml_user_cache | | | | |
| 9 | ml_product_costs | | | | |
| 10 | ml_billing_monthly | | | | |
| 11 | ml_billing_daily | | | | |
| 12 | ml_tokens | | | | |
| 13 | ml_tax_config | | | | |
| 14 | ml_targets | | | | |
| 15 | ml_sync_log | | | | |
| 16 | onboarding_progress | | | | |

**Resultado §2 (global):** ____ (PASS sse TODAS as linhas = 0 cross-org)
**Observações:** _______________________________________________

---

## 3. Defesa em profundidade — frontend filtra por org

**Objetivo:** confirmar que o frontend lê por `organization_id` (não vaza por `user_id`), reforçando a RLS.

- [ ] **3.1** `useMLProductCosts.fetchAll` filtra por `.eq("organization_id", currentOrg.id)` (ajustado em 43-01).
      PASS: logado no app como membro de A, a tela `/precos-custos` mostra apenas custos de A; trocando o
      seletor de org para B (se o usuário for membro de ambas) mostra apenas os de B.
- [ ] **3.2** `mlCacheService` / hooks de leitura escopam por org. PASS: dashboard `/` de A não exibe KPIs de B.

**Resultado §3:** ____
**Evidência:** _______________________________________________

---

## 4. ME-06 — viewer NÃO escreve billing (T-43-13)

**Objetivo:** `ml_billing_monthly` tem apenas policy `FOR SELECT`; qualquer INSERT/UPDATE/DELETE por
usuário autenticado (mesmo membro/owner, e em especial `viewer`) deve **falhar**.

```sql
-- Como VIEWER de A: tentar INSERT em billing → deve ABORTAR por RLS (sem policy de write).
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<USER_A_VIEWER>","role":"authenticated"}';
  INSERT INTO public.ml_billing_monthly (organization_id, ml_user_id, ano_mes /*, ... */)
  VALUES ('<ORG_A>', '<MLUID_A>', '2026-06' /*, ... */);
  -- esperado: ERROR new row violates row-level security policy for table "ml_billing_monthly"
ROLLBACK;
```
Repetir com UPDATE e DELETE como viewer (ambos devem falhar):
```sql
BEGIN;
  SET LOCAL role authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<USER_A_VIEWER>","role":"authenticated"}';
  UPDATE public.ml_billing_monthly SET total = total WHERE organization_id = '<ORG_A>';
  -- esperado: 0 linhas afetadas OU erro de policy (não há policy de UPDATE)
ROLLBACK;
```

**Critério de PASS:**
- INSERT como viewer → erro de RLS (ou 0 linhas inseridas).
- UPDATE/DELETE como viewer → 0 linhas afetadas / erro de policy.
- SELECT como membro de A → funciona (leitura permitida).

| Ação | Esperado | Resultado | Evidência (erro/linhas) |
|------|----------|-----------|--------------------------|
| INSERT (viewer A) | falha por policy | | |
| UPDATE (viewer A) | 0 linhas / falha | | |
| DELETE (viewer A) | 0 linhas / falha | | |
| SELECT (membro A) | OK (lê billing de A) | | |

**Resultado §4:** ____
**Observações:** _______________________________________________

---

## 5. ME-05 — enumeração cross-org de `ml_user_id` → 403 (T-43-14)

**Objetivo:** um usuário de A, chamando as EFs `ml-ads`, `ml-inventory` e `ml-reputation` com o
`ml_user_id` da org B (`MLUID_B`), recebe **403 Forbidden** (guard `is_org_member` antes de aceitar o input).

**Procedimento (HTTP, com o JWT de sessão de `USER_A` — Wesley/orquestrador obtém o access_token de A):**

```bash
# Substituir <JWT_A> pelo access_token de uma sessão autenticada de USER_A, <ANON> pela anon key.
for FN in ml-ads ml-inventory ml-reputation; do
  echo "== $FN com ml_user_id de B (MLUID_B) =="
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/$FN" \
    -X POST \
    -H "Authorization: Bearer <JWT_A>" \
    -H "apikey: <ANON>" \
    -H "Content-Type: application/json" \
    -d '{"ml_user_id":"<MLUID_B>"}'
done
```

**Controle positivo (não deve dar 403):** mesma chamada com `MLUID_A` (a própria loja de A) deve
retornar 200/dados — prova que o 403 acima é por cross-org, não por erro genérico.

**Critério de PASS:**
- `ml-ads`, `ml-inventory`, `ml-reputation` com `MLUID_B` (sessão A) → **403** nas três.
- Mesmas EFs com `MLUID_A` (sessão A) → 200 (controle positivo).
- A resposta 403 é **genérica** (`{"error":"Forbidden"}`) — não vaza existência/dados de B.

| EF | ml_user_id usado | Esperado | HTTP obtido | Resultado | Evidência |
|----|------------------|----------|-------------|-----------|-----------|
| ml-ads | MLUID_B (cross-org) | 403 | | | |
| ml-inventory | MLUID_B (cross-org) | 403 | | | |
| ml-reputation | MLUID_B (cross-org) | 403 | | | |
| ml-ads | MLUID_A (controle) | 200 | | | |
| ml-inventory | MLUID_A (controle) | 200 | | | |
| ml-reputation | MLUID_A (controle) | 200 | | | |

**Resultado §5:** ____
**Observações:** _______________________________________________

---

## 6. ME-04 — token lookup determinístico por org (T-43-15 / spoofing)

**Objetivo:** o sync usa o **token correto da org** mesmo se duas orgs compartilharem o mesmo
`ml_user_id`. Lookup nas EFs foi endurecido com `ORDER BY updated_at DESC` + filtro por org quando
o caller conhece a org (43-02).

**Verificação A — código/contrato (estático):**
- [ ] Confirmar que `sync-ml-orders`, `sync-ml-billing`, `ml-reputation`, `ml-inventory` fazem o lookup
      de `ml_tokens` com `.order("updated_at", { ascending:false }).limit(1)`.
      ```bash
      for f in sync-ml-orders sync-ml-billing ml-reputation ml-inventory ml-ads; do
        echo "== $f =="; grep -n 'order("updated_at"' supabase/functions/$f/index.ts || echo "FALTA";
      done
      ```
      PASS: todas presentes (ml-ads já tinha).

**Verificação B — comportamento (DB, simulando colisão de `ml_user_id`):**
- [ ] Em transação `ROLLBACK`, inserir um segundo `ml_tokens` para ORG_B com o **mesmo** `ml_user_id`
      de A mas `updated_at` mais antigo, e confirmar que o lookup filtrado por org retorna o token **de A**
      (quando a org é conhecida) e o **mais recente** (quando não é):
      ```sql
      BEGIN;
        -- simula colisão (não persiste)
        INSERT INTO public.ml_tokens (organization_id, ml_user_id, access_token, updated_at)
        VALUES ('<ORG_B>', '<MLUID_A>', 'token_de_B_antigo', now() - interval '10 days');

        -- caller conhece a org (padrão das EFs de sync por org): retorna o token de A
        SELECT organization_id, left(access_token,12)
        FROM public.ml_tokens
        WHERE ml_user_id = '<MLUID_A>' AND organization_id = '<ORG_A>'
          AND access_token IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1;   -- espera ORG_A

        -- sem filtro de org: retorna o mais recente (determinístico, nunca arbitrário)
        SELECT organization_id, updated_at
        FROM public.ml_tokens
        WHERE ml_user_id = '<MLUID_A>' AND access_token IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1;   -- espera o de updated_at mais novo, sempre o mesmo
      ROLLBACK;
      ```

**Critério de PASS:**
- Todas as EFs de sync têm `ORDER BY updated_at DESC` no lookup.
- Com org conhecida, o lookup retorna o token da org correta (A), nunca o de B.
- Sem org conhecida, o resultado é determinístico (sempre o mais recente), nunca arbitrário.

| Verificação | Esperado | Resultado | Evidência |
|-------------|----------|-----------|-----------|
| ORDER BY presente nas 5 EFs | todas PASS | | |
| Lookup filtrado por org → token de A | ORG_A | | |
| Lookup sem org → mais recente (determinístico) | estável | | |

**Resultado §6:** ____
**Observações:** _______________________________________________

---

## 7. TENANT-03 — quota bloqueia excedente; enterprise nunca bloqueia (T-43-15)

**Objetivo:** `check_quota` bloqueia uma org quando excede o limite diário derivado do tier; tier
`enterprise` (`sync_interval_minutes = -1`) **nunca** bloqueia. Gate ativo em `process-sync-job` (v15).

**Verificação A — enterprise nunca bloqueia (orgs reais):**
```sql
SELECT public.check_quota('<ORG_A>');  -- Pé Vermeio enterprise → espera TRUE
```
PASS: `true` (já validado em 43-02: `check_quota('7f615df7-...')` = true).

**Verificação B — tier pequeno bloqueia (org de teste, em transação ROLLBACK):**
```sql
BEGIN;
  -- coloca uma org de teste num tier pequeno: 1 sync/dia (interval grande)
  -- limite = greatest(1, floor(1440 / sync_interval_minutes))
  UPDATE public.organization_plans
     SET sync_interval_minutes = 1440           -- => limite diário = 1
   WHERE organization_id = '<ORG_TESTE>';

  SELECT public.check_quota('<ORG_TESTE>');  -- 1ª chamada do dia → TRUE (count=1 <= 1)
  SELECT public.check_quota('<ORG_TESTE>');  -- 2ª chamada       → FALSE (count=2 > 1)  ← bloqueio
ROLLBACK;
```

**Verificação C — gate em produção (log):** disparar syncs acima do limite para uma org não-enterprise e
confirmar no log de `process-sync-job` a linha `quota EXCEEDED org=<...>` e o job marcado
`status='failed', error_msg='quota exceeded...'`. (Como todas as orgs reais estão em enterprise, este passo
usa a org de teste de §1 ou é validado via execução controlada — registrar a linha de log como evidência.)

**Critério de PASS:**
- `check_quota(ORG_A enterprise)` = `true` sempre.
- Org tier pequeno: 1ª chamada `true`, chamada além do limite `false`.
- Log de `process-sync-job` mostra bloqueio (`quota EXCEEDED`) e job `failed` ao exceder.

| Verificação | Esperado | Resultado | Evidência |
|-------------|----------|-----------|-----------|
| A — enterprise (ORG_A) | true | | |
| B — tier pequeno: 1ª chamada | true | | |
| B — tier pequeno: além do limite | false | | |
| C — log de bloqueio em process-sync-job | `quota EXCEEDED` + job failed | | |

**Resultado §7:** ____
**Observações:** _______________________________________________

---

## 8. Sumário de resultados (preencher na Task 2)

| Item | Requisito / Threat | PASS/FAIL | Gap (se FAIL) |
|------|--------------------|-----------|----------------|
| §2 Isolamento de leitura RLS (16 tabelas) | TENANT-05 / T-43-12 | | |
| §3 Frontend filtra por org (defesa em profundidade) | TENANT-05 | | |
| §4 Viewer não escreve billing | ME-06 / T-43-13 | | |
| §5 Enumeração cross-org → 403 | ME-05 / T-43-14 | | |
| §6 Token lookup determinístico por org | ME-04 | | |
| §7 Quota bloqueia excedente; enterprise não | TENANT-03 / T-43-15 | | |

**Veredito da fase:**  ____ (todos PASS = TENANT-05 confirmado / qualquer FAIL = fase não fecha, abrir gap)
**Executado por:** ____ (orquestrador via MCP + Wesley nos passos de 2 contas ML reais)
**Data:** ____
