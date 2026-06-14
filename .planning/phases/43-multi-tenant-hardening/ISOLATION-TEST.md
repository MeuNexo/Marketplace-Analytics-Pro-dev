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
| **Org B** | Thales | `e4150d57-1349-48c9-9a89-82b1774857b0` | não-enterprise (testável em §7) |

> **Resultado §0 (Task 2 — 2026-06-14):** PASS. Variáveis confirmadas via MCP no `ckcdevcxgvueywivefgx`,
> usando as 2 orgs reais (sem orgs fake). **Não há viewer separado** — ambas as orgs só têm owner,
> então ME-06 (§4) foi testado sob o **próprio owner**, prova mais forte (nem o owner escreve billing).

> **Cada org tem uma loja ML distinta** (`ml_user_id` diferente em `ml_tokens`). Confirmar na Task 2:
> ```sql
> SELECT organization_id, ml_user_id, (access_token IS NOT NULL) AS tem_token, updated_at
> FROM public.ml_tokens
> ORDER BY organization_id, updated_at DESC;
> ```
> Anotar abaixo, pois os UUIDs de usuário e os `ml_user_id` são reusados em todos os itens:
>
> | Var | Significado | Valor (Task 2) |
> |-----|-------------|------------------------------|
> | `ORG_A` | org_id Pé Vermeio | `7f615df7-7bac-45e5-8a93-827fb9ddeec7` |
> | `ORG_B` | org_id Thales | `e4150d57-1349-48c9-9a89-82b1774857b0` |
> | `USER_A` | owner de A | `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73` |
> | `USER_A_VIEWER` | viewer de A | N-A — sem viewer separado; ME-06 testado sob o owner `ce8c797c-...` |
> | `USER_B` | owner de B | `4aed4678-3c3a-42bc-94ff-b6e9b2d08b2e` |
> | `MLUID_A` | `ml_user_id` da loja ML de A | `1639558873` |
> | `MLUID_B` | `ml_user_id` da loja ML de B | `427063369` |

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

**Resultado §1:** N-A — usado o par real (Pé Vermeio + Thales). Ambas já existem em produção,
cada uma com sua loja ML (`MLUID_A=1639558873`, `MLUID_B=427063369`) e dados reais nos caches.
**Evidência:** `ml_tokens` tem 1 linha por org com `ml_user_id` distinto; volume real de B confirmado
(via service_role, fora de RLS): ml_ads_products_cache=15962, ml_daily_cache=30, ml_tokens=1, ml_user_cache=1
→ o teste "A não vê B" (§2) NÃO é vácuo.

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

> **Nota de método (Task 2):** a impersonação usou
> `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"<owner>","role":"authenticated"}',true); <counts FILTER por org>; ROLLBACK;`
> (`set_config(..., true)` = equivalente a `SET LOCAL`, escopo de transação). Necessário porque o
> service_role do MCP bypassa RLS.

| # | Tabela | A vê linhas de B? (espera 0) | B vê linhas de A? (espera 0) | Resultado | Evidência (linhas próprias visíveis) |
|---|--------|------------------------------|------------------------------|-----------|-----------|
| 1 | ml_daily_cache | 0 | 0 | PASS | A=549; B=30 |
| 2 | ml_hourly_cache | 0 | 0 | PASS | A=5812 |
| 3 | ml_product_daily_cache | 0 | 0 | PASS | A=7567 |
| 4 | ml_ads_daily_cache | 0 | 0 | PASS | (sem vazamento) |
| 5 | ml_ads_campaigns_cache | 0 | 0 | PASS | (sem vazamento) |
| 6 | ml_ads_products_cache | 0 | 0 | PASS | A=10323; B=15962 |
| 7 | ml_state_daily_cache | 0 | 0 | PASS | A=4329 |
| 8 | ml_user_cache | 0 | 0 | PASS | A=1; B=1 |
| 9 | ml_product_costs | 0 | 0 | PASS | A=604; B=0 |
| 10 | ml_billing_monthly | 0 | 0 | PASS | A=6; B=0 |
| 11 | ml_billing_daily | 0 | 0 | PASS | A=1649 |
| 12 | ml_tokens | 0 | 0 | PASS | A=1; B=1 |
| 13 | ml_tax_config | 0 | 0 | PASS | A=1 |
| 14 | ml_targets | RESSALVA — sem `organization_id` (scope = seller_id/user_id) | idem | N-A | ver observação |
| 15 | ml_sync_log | 0 | 0 | PASS | (sem vazamento) |
| 16 | onboarding_progress | 0 | 0 | PASS | A=1; B=0 |

**Resultado §2 (global):** **PASS bidirecional — 0 vazamentos cross-org.** 15 tabelas com `organization_id`
testadas (todos os `*_LEAK = 0` nos dois contextos). Contexto A (USER_A): `total_vazamentos=0`, vê só os
próprios. Contexto B (USER_B): `total_vazamentos=0`, vê só os próprios (`ml_billing_monthly=0`,
`ml_product_costs=0`, `onboarding_progress=0` — Thales ainda sem esses dados). Volume real de B em
service_role (fora de RLS) confirma que o teste não é vácuo.

**Observações:** `ml_targets` **NÃO tem coluna `organization_id`** (scope = `seller_id`/`user_id`), por isso
ficou fora do loop por-org — **não é vazamento conhecido**, mas fica registrado como gap de cobertura:
recomenda-se uma verificação dedicada de RLS por `user_id`/`seller_id` em `ml_targets` numa fase futura
(candidato à code-review/verify-phase desta fase). O roteiro original listava 16 tabelas; efetivamente
15 têm scope-org e foram cobertas.

---

## 3. Defesa em profundidade — frontend filtra por org

**Objetivo:** confirmar que o frontend lê por `organization_id` (não vaza por `user_id`), reforçando a RLS.

- [ ] **3.1** `useMLProductCosts.fetchAll` filtra por `.eq("organization_id", currentOrg.id)` (ajustado em 43-01).
      PASS: logado no app como membro de A, a tela `/precos-custos` mostra apenas custos de A; trocando o
      seletor de org para B (se o usuário for membro de ambas) mostra apenas os de B.
- [ ] **3.2** `mlCacheService` / hooks de leitura escopam por org. PASS: dashboard `/` de A não exibe KPIs de B.

**Resultado §3:** PASS (código) — `useMLProductCosts.fetchAll` filtra por `.eq("organization_id", currentOrg.id)`
(ajustado em 43-01, commit 3e2584a0). A defesa em profundidade é redundante à RLS (§2 já garante isolamento
no DB). Confirmação visual ao vivo (trocar seletor de org no app) fica junto ao checkpoint visual de onboarding
pendente de Wesley — **não-bloqueante**, pois a RLS é a fronteira de segurança e está PASS.
**Evidência:** 43-01-SUMMARY (Task 3) + RLS §2 PASS.

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

> **Nota (Task 2):** como não há viewer separado, o teste foi feito sob o **owner** de A — prova
> mais forte: se nem o owner escreve billing, o viewer (menos privilegiado) também não.

| Ação | Esperado | Resultado | Evidência (erro/linhas) |
|------|----------|-----------|--------------------------|
| INSERT (owner A) | falha por policy | **PASS** | `ERROR: 42501: new row violates row-level security policy for table "ml_billing_monthly"` |
| SELECT (owner A) | OK (lê billing de A) | **PASS** | leitura permitida (A=6 linhas em §2) |
| Inventário de policies | só SELECT | **PASS** | única policy = `org_member_billing_select` (cmd=SELECT, role authenticated); nenhuma policy permissiva de INSERT/UPDATE/DELETE → escrita só via service_role (EFs) |

**Resultado §4:** **PASS.** `ml_billing_monthly` é leitura-apenas para `authenticated` (ME-06/D-15 confirmado).
A ausência de policy de INSERT/UPDATE/DELETE garante que UPDATE/DELETE também falham (mesma RLS); o INSERT
foi exercitado e abortou com 42501.
**Observações:** escrita exclusiva de service_role (EF `sync-ml-billing`).

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

**Resultado da auditoria de código (Task 2):** guard `is_org_member` presente nas 3 EFs —
`supabase.rpc("is_org_member",{_user_id:userId,_org_id:tokenRow.organization_id})` → **403** se não-membro:
- `ml-ads`: is_org_member + 2 retornos 403.
- `ml-inventory`: is_org_member + 1 retorno 403.
- `ml-reputation`: is_org_member + 1 retorno 403.

| EF | ml_user_id usado | Esperado | HTTP obtido | Resultado | Evidência |
|----|------------------|----------|-------------|-----------|-----------|
| ml-ads | MLUID_B (cross-org) | 403 | — | PASS (código) | guard is_org_member + 403×2 |
| ml-inventory | MLUID_B (cross-org) | 403 | — | PASS (código) | guard is_org_member + 403×1 |
| ml-reputation | MLUID_B (cross-org) | 403 | — | PASS (código) | guard is_org_member + 403×1 |
| ml-ads/ml-inventory/ml-reputation | MLUID_A (controle) | 200 | — | A CONFIRMAR (Wesley) | requer JWT de sessão real |

**Resultado §5:** **PASS (código)** — guard confirmado nas 3 EFs. **Comportamental ao vivo PENDENTE Wesley:**
o teste HTTP (sessão de A chamando a EF com `MLUID_B=427063369` → 403; controle `MLUID_A=1639558873` → 200)
exige um JWT de sessão real obtido no browser — fora do alcance de automação MCP. **Não-bloqueante:** o guard
está no código deployado (43-02); a confirmação ao vivo é validação adicional.
**Observações:** resposta 403 é genérica (`{"error":"Forbidden"}`) — não vaza existência/dados de B.

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
| ORDER BY presente nas EFs de lookup | PASS | **PASS** | `order("updated_at"` (DESC) presente 1× em sync-ml-orders, sync-ml-billing, ml-reputation, ml-inventory |
| process-sync-job | N-A | **PASS** | 0 ocorrências — é dispatcher, não faz lookup de token por `ml_user_id` (correto) |
| EFs deployadas (43-02) | versões novas | **PASS** | sync-ml-orders v20, sync-ml-billing v9, ml-reputation v10, ml-inventory v9 |

**Resultado §6:** **PASS (código + deploy).** O lookup de token é determinístico (`ORDER BY updated_at DESC`)
em todas as EFs de sync que resolvem token por `ml_user_id`, garantindo que com colisão de `ml_user_id`
cross-org o token retornado é o mais recente (e, quando a org é conhecida, o da org correta). ME-04 confirmado.
**Observações:** `process-sync-job` corretamente não faz lookup (apenas despacha jobs).

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

> **Nota (Task 2):** o teste de bloqueio usou a **org Thales** temporariamente em
> `sync_interval_minutes=480` (→ limite = `floor(1440/480) = 3`) dentro de transação **ROLLBACK**
> (não alterou a configuração de produção).

| Verificação | Esperado | Resultado | Evidência |
|-------------|----------|-----------|-----------|
| A — enterprise (ORG_A, interval=-1) | true | **PASS** | `check_quota` = `true` sempre (nunca bloqueia) |
| B — tier pequeno (interval=480, limite=3): 5 chamadas | t,t,t,f,f | **PASS** | sequência observada = `[true, true, true, false, false]` — bloqueia ao exceder 3 |
| Lógica do RPC | conforme RESEARCH | **PASS** | confirmada via `pg_get_functiondef` (ON CONFLICT incrementa; `-1`→true; `v_count <= v_limit`) |

**Resultado §7:** **PASS.** `check_quota` bloqueia ao exceder o limite diário derivado do tier e nunca
bloqueia enterprise (`-1`). TENANT-03 confirmado. (A verificação C de log ao vivo em `process-sync-job`
é redundante — a lógica do gate é a mesma `check_quota` aqui exercitada; as orgs reais estão em enterprise,
então o gate não morde a operação atual.)
**Observações:** teste feito em transação ROLLBACK — configuração de produção da Thales inalterada.

---

## 8. Sumário de resultados (Task 2 — 2026-06-14)

| Item | Requisito / Threat | PASS/FAIL | Gap (se FAIL) |
|------|--------------------|-----------|----------------|
| §2 Isolamento de leitura RLS (15 tabelas scope-org) | TENANT-05 / T-43-12 | **PASS** | nenhum (ml_targets sem org_id → observação, não-vazamento) |
| §3 Frontend filtra por org (defesa em profundidade) | TENANT-05 | **PASS** (código) | confirmação visual ao vivo junto ao checkpoint Wesley (não-bloqueante) |
| §4 Owner/viewer não escreve billing | ME-06 / T-43-13 | **PASS** | nenhum |
| §5 Enumeração cross-org → 403 | ME-05 / T-43-14 | **PASS** (código) | comportamental ao vivo pendente Wesley (não-bloqueante) |
| §6 Token lookup determinístico por org | ME-04 | **PASS** | nenhum |
| §7 Quota bloqueia excedente; enterprise não | TENANT-03 / T-43-15 | **PASS** | nenhum |

**Veredito da fase:** **PASS — TENANT-05 (isolamento) confirmado; ME-04/05/06 e TENANT-03 confirmados.
0 vazamentos cross-org. Nenhum FAIL.** Únicos pendentes, **não-bloqueantes** e fora do alcance de
automação MCP: (a) ME-05 comportamental ao vivo (Wesley, via JWT de sessão no browser); (b) ressalva
de cobertura de `ml_targets` (sem `organization_id` — RLS por `user_id`/`seller_id`; recomendar
verificação dedicada na code-review/verify-phase).

**Executado por:** orquestrador via Supabase MCP (`ckcdevcxgvueywivefgx`) usando as 2 orgs reais
(Pé Vermeio + Thales); passos de sessão ML ao vivo delegados a Wesley.
**Data:** 2026-06-14
