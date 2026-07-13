# Phase 95: Fluxo de Caixa Confiável - Research

**Researched:** 2026-07-13
**Domain:** PostgreSQL/plpgsql (Supabase RPC) + React/TanStack Query (SPA frontend)
**Confidence:** HIGH — 100% baseado em leitura direta do código-fonte e das migrations deste
repositório (não é conhecimento de treinamento; ver `## Sources`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Abordagem do saldo**
- Âncora + roll-forward (decidido após spike descartar API de saldo). O usuário digita o saldo
  real de vez em quando (âncora com data); o sistema rola o saldo de abertura dos dias seguintes.
- NÃO automatizar leitura de saldo (MP 403 forbidden; Bradesco exige agregador pago). Fora de escopo.

**Fórmula do roll-forward**
- `saldo_abertura = âncora + Σ entradas − Σ saídas`, no intervalo `[anchor_date, hoje)`.
- Entradas: `cash_inflows.net_amount` por `release_date` no intervalo.
- Saídas: SOMENTE `status='paid'` (decisão explícita — alinhada ao fluxo do Wesley de dar baixa
  no Tiny no dia do pagamento). `pending` NÃO entra no roll.
- Convenção: `initial_balance` = saldo de ABERTURA do `anchor_date`; a curva soma `[hoje, fim]`
  por cima. Âncora de hoje (intervalo vazio) → resultado idêntico ao atual (não-regressão).

**Alerta (faixa de saúde dos dados)**
- Dispara em 3 situações de confiabilidade (não de negócio): Tiny sync > 6h, MP sync > 6h,
  âncora > 7 dias. (Wesley deixou de fora "curva no vermelho à frente" — ele já lê isso na curva.)
- Limiares: 6h para syncs (cron roda a cada 3h = 2 ciclos), 7 dias para âncora.
- Texto acionável por gatilho, com link pra Integrações no caso do Tiny.

**Técnico**
- Nova coluna `financial_settings.balance_anchor_date` (backfill = `updated_at::date`).
- Função `get_rolled_opening_balance(p_org_id)` — lógica num lugar só; consumida por
  `get_cashflow`, `get_projected_balance_summary`, `get_treasury_panel` (trocam `v_initial`).
- Nova RPC `get_cashflow_data_health(p_org_id)`.
- Frontend: faixa no topo de `MLFluxoCaixa.tsx` via hook novo (`useCashflowDataHealth`).
- RPCs em SECURITY INVOKER, org via `is_org_member` (padrão do projeto — DEFINER+org = IDOR).
- TDD. Teste-âncora obrigatório: `anchor_date=hoje` → curva idêntica à atual (não-regressão).

### Claude's Discretion
- Nomes exatos de hooks/componentes, estrutura de testes, formato do retorno da RPC de health
  (jsonb vs table), estilo visual da faixa (seguir design system existente da página).

### Deferred Ideas (OUT OF SCOPE)
- Automação de leitura de saldo real (MP via app de pagamentos / agregador Open Finance pago).
- Alerta de negócio "curva projetada negativa à frente".
- Automação da reancoragem (segue manual, lembrada pelo alerta de âncora velha).
</user_constraints>

## Summary

O design no spec (`.planning/specs/2026-07-13-fluxo-caixa-confiavel.md`) já resolve o "o quê".
Este research resolve o "onde tocar" e "como não quebrar o que já funciona": mapeei os 3 arquivos
de RPC que hoje leem `financial_settings.initial_balance` (mesma leitura, 3 cópias — `v_initial :=
COALESCE((SELECT fs.initial_balance ...), 0)`), o hook e o dialog que escrevem esse valor, e o
padrão de RLS que faz `SECURITY INVOKER` funcionar sem checagem manual de org dentro da função.

**Achado crítico não coberto no spec:** o dialog `AdjustBalanceDialog` (em `MLFluxoCaixa.tsx`)
grava `initial_balance` via `.upsert({ organization_id, initial_balance }, { onConflict:
"organization_id" })` — SEM tocar `updated_at` nem (após esta fase) `balance_anchor_date`. Não
existe trigger de `updated_at` em `financial_settings`. Se a Parte A adicionar a coluna
`balance_anchor_date` mas a Parte B não alterar esse caminho de escrita, a âncora nunca mais será
atualizada depois do backfill inicial — o alerta "âncora > 7 dias" vai disparar sempre e o
roll-forward vai ficar rolando um intervalo cada vez maior a partir de uma âncora fixa e antiga.
**As duas partes têm uma dependência de escrita que precisa estar no mesmo plano de execução**
(ver `Pitfall 1` abaixo) — recomendo uma nova RPC de escrita (`set_financial_balance`) para
resolver isto no servidor, na mesma data BRT que `get_rolled_opening_balance` usa como "hoje".

**Primary recommendation:** criar `get_rolled_opening_balance(p_org_id uuid) RETURNS numeric` como
função `plpgsql SECURITY INVOKER SET search_path = 'public'` (mesmo padrão das 3 RPCs existentes,
sem checagem manual de org — o RLS de `financial_settings`/`cash_inflows`/`cash_outflows` já filtra
via `is_org_member`), trocar a linha `v_initial := COALESCE((SELECT fs.initial_balance ...` nas 3
RPCs por `v_initial := public.get_rolled_opening_balance(p_org_id);`, criar
`get_cashflow_data_health` no mesmo padrão, e substituir o upsert direto do dialog por uma RPC de
escrita que grava `initial_balance` + `balance_anchor_date` atomicamente.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cálculo do saldo rolado (roll-forward) | Database/Storage | — | Lógica centralizada em 1 função SQL, consumida por 3 RPCs — evita 3 cópias divergentes |
| Exposição do saldo rolado às 3 RPCs existentes | API/Backend (RPC) | Database/Storage | `get_cashflow`/`get_projected_balance_summary`/`get_treasury_panel` só trocam a fonte de `v_initial`, sem mudar assinatura pública |
| Cálculo de staleness (Tiny/MP/âncora) | Database/Storage | — | `MAX(synced_at)` e `EXTRACT(EPOCH...)` são operações de agregação — mais barato e correto no banco do que buscar linhas cruas no cliente |
| Exibição da faixa de alerta | Browser/Client (SPA) | — | App é SPA pura (React 18 + Vite, sem SSR — ver CLAUDE.md); toda renderização é client-side |
| Gravação da âncora (saldo digitado) | Browser/Client (form) | Database/Storage (RPC de escrita) | Dialog já existe no client; a data BRT do "hoje" deve ser calculada no servidor (mesma fonte de verdade que `get_rolled_opening_balance`), não no browser |

## Standard Stack

Esta fase **não introduz nenhuma dependência nova**. Usa exclusivamente o que já está em
`package.json` e no runtime Supabase deste projeto.

### Core (já em uso — sem instalação)
| Library | Version | Purpose | Onde já é usado nesta área |
|---------|---------|---------|------------------------------|
| PostgreSQL/plpgsql (Supabase-hosted) | — | RPCs `get_cashflow`, `get_treasury_panel`, `get_projected_balance_summary` | `supabase/migrations/20260660000000_cashflow_dfc_alignment.sql` |
| `@tanstack/react-query` | 5.83.0 | Hooks `useCashFlowData`, `useTreasuryPanel`, `useProjectedBalance` | `src/hooks/useCashFlowData.ts:11,58` |
| `@supabase/supabase-js` | 2.98.0 | `supabase.rpc(...)` | idem |
| shadcn/ui `Alert`/`AlertTitle`/`AlertDescription` | — (local, `src/components/ui/alert.tsx`) | Banner de aviso já usado em `MLPedidos.tsx:1116-1128` | `src/components/ui/alert.tsx` |
| `date-fns` | 3.6.0 | Formatação de datas no client | `MLFluxoCaixa.tsx:11` |
| `vitest` + `@testing-library/react` | 3.2.4 / 16.0.0 | Testes de hook (TDD) | `src/hooks/useDreOperational.test.ts` |

### Package Legitimacy Audit

**Não aplicável** — nenhum pacote novo é instalado nesta fase. O gate de legitimidade de pacotes
(`gsd-tools query package-legitimacy check`) não precisa rodar: todo o trabalho é SQL (migrations
aplicadas via MCP `apply_migration`) + código React usando bibliotecas já presentes no
`package.json`/`bun.lock` deste repositório.

## Architecture Patterns

### Fluxo de dados atual (o que a Parte A precisa alterar)

```
┌─────────────────────────────────────────────────────────────────────┐
│  MLFluxoCaixa.tsx  (aba "Caixa Real")                                │
│                                                                       │
│   AdjustBalanceDialog ──upsert direto──▶ financial_settings          │
│   (owner only)              (organization_id, initial_balance)       │
│                              ⚠ NÃO grava balance_anchor_date          │
│                              ⚠ NÃO grava updated_at                   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ invalidateQueries(["cashflow"], ...)
                                 ▼
        ┌────────────────────────────────────────────────────────┐
        │  3 RPCs — cada uma lê financial_settings.initial_balance│
        │  de forma independente (3 cópias da mesma leitura):     │
        │                                                          │
        │  get_cashflow(org,start,end,forecasts)                  │
        │    v_initial := COALESCE((SELECT fs.initial_balance     │
        │      FROM financial_settings ...),0)     [linha 58]      │
        │                                                          │
        │  get_projected_balance_summary(org,days,forecasts)      │
        │    v_initial := COALESCE((SELECT fs.initial_balance     │
        │      FROM financial_settings ...),0)     [linha 44]      │
        │                                                          │
        │  get_treasury_panel(org,horizon,forecasts)              │
        │    SELECT ... fs.initial_balance INTO v_initial [linha 97]│
        └────────────────────────────────────────────────────────┘
                                 │
                                 ▼
        useCashFlowData / useTreasuryPanel / useProjectedBalance
                                 │
                                 ▼
                    Gráfico + 3 cards + Painel de Tesouraria
```

### Fluxo de dados alvo (Parte A + Parte B)

```
┌─────────────────────────────────────────────────────────────────────┐
│  AdjustBalanceDialog ──rpc──▶ set_financial_balance(org_id, amount)  │
│  (NOVA RPC de escrita — grava initial_balance + balance_anchor_date  │
│   ATOMICAMENTE, data BRT calculada NO SERVIDOR: mesma fonte que      │
│   get_rolled_opening_balance usa como "hoje" — evita drift de fuso)  │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
        ┌────────────────────────────────────────────────────────┐
        │  get_rolled_opening_balance(p_org_id) RETURNS numeric   │
        │  (NOVA — lógica do roll-forward em 1 lugar só)          │
        │                                                          │
        │  v_anchor_date, v_anchor_balance ← financial_settings   │
        │  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date│
        │  RETURN v_anchor_balance                                 │
        │    + Σ cash_inflows.net_amount  WHERE release_date       │
        │        ∈ [anchor_date, hoje)                              │
        │    − Σ cash_outflows.amount     WHERE status='paid' AND  │
        │        outflow_date ∈ [anchor_date, hoje)                 │
        │  (anchor_date = hoje → intervalo vazio → retorna a âncora │
        │   crua = comportamento atual, não-regressão)              │
        └───────────────────────┬──────────────────────────────────┘
                                 │ chamada por
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     get_cashflow        get_projected_       get_treasury_panel
     (v_initial :=       balance_summary      (v_initial :=
      get_rolled_          (idem)               get_rolled_
      opening_balance)                           opening_balance)

┌─────────────────────────────────────────────────────────────────────┐
│  get_cashflow_data_health(p_org_id) RETURNS TABLE (NOVA)             │
│    tiny_last_sync, tiny_hours_ago, tiny_stale (>6h)                  │
│    mp_last_sync,   mp_hours_ago,   mp_stale   (>6h)                  │
│    anchor_date,    anchor_days_ago, anchor_stale (>7d)               │
│  Lê MAX(cash_outflows.synced_at) / MAX(cash_inflows.synced_at) /     │
│  financial_settings.balance_anchor_date — mesmo padrão INVOKER,      │
│  RLS de is_org_member já filtra a org.                                │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
                    useCashflowDataHealth (novo hook)
                                 ▼
                    Faixa de alerta no topo de MLFluxoCaixa.tsx
                    (acima das <Tabs>, visível em Caixa Real E Simulador)
```

### Recommended file changes (Parte A — backend/RPCs)

```
supabase/migrations/
├── 2026970000000_cashflow_balance_anchor.sql        # NOVO: coluna + backfill + get_rolled_opening_balance
├── 2026970100000_cashflow_rpcs_use_rolled_balance.sql # NOVO: DROP+CREATE das 3 RPCs trocando v_initial
├── 2026970200000_cashflow_data_health_rpc.sql        # NOVO: get_cashflow_data_health
└── 2026970300000_set_financial_balance_rpc.sql       # NOVO: RPC de escrita (âncora atômica)
```
*(Escolher o timestamp real checando o estado ao vivo do banco via MCP antes de aplicar — ver
Pitfall 4. Os números acima são só placeholder de ordem relativa.)*

### Recommended file changes (Parte B — frontend)

```
src/
├── hooks/
│   └── useCashflowDataHealth.ts        # NOVO — molde: useTreasuryPanel.ts (RPC de 1 linha só)
│   └── useCashflowDataHealth.test.ts   # NOVO — molde: useDreOperational.test.ts
├── components/financial/
│   └── CashflowHealthBanner.tsx        # NOVO — molde de banner: MLPedidos.tsx:1116-1128
│   └── CashflowHealthBanner.test.tsx   # NOVO (se testar render condicional)
├── pages/mercadolivre/
│   └── MLFluxoCaixa.tsx                # EDITAR — inserir <CashflowHealthBanner /> antes de <Tabs>
│                                        # EDITAR — AdjustBalanceDialog.handleSave: trocar upsert
│                                        #   direto por supabase.rpc("set_financial_balance", ...)
```

### Pattern 1: RPC financeira SECURITY INVOKER sem checagem manual de org

**What:** Todas as RPCs de fluxo de caixa deste projeto são `LANGUAGE plpgsql SECURITY INVOKER SET
search_path = 'public'` e NÃO fazem `IF NOT is_org_member(...) THEN RAISE EXCEPTION` dentro do
corpo da função. A proteção anti-IDOR vem inteiramente do RLS das tabelas que a função lê
(`financial_settings`, `cash_inflows`, `cash_outflows` — todas com policy `USING
(public.is_org_member(auth.uid(), organization_id))`). Como a função roda com os privilégios do
caller (INVOKER), o Postgres aplica essas policies normalmente — mesmo dentro de uma função.

**When to use:** Sempre que a nova RPC só faz SELECT/agregação sobre tabelas que já têm RLS
`is_org_member`. Não recriar a checagem manualmente — é redundante e pode divergir do RLS real.

**Example (fonte real, não hipotética):**
```sql
-- supabase/migrations/20260618120000_cash_flow_rpcs.sql (comentário, linhas 22-28)
-- SEGURANÇA (CRÍTICO — regra de projeto):
--   TODAS as funções são SECURITY INVOKER.
--   DEFINER + p_org_id por parâmetro = IDOR: caller poderia passar qualquer org_id e
--   obter dados de outra organização, bypassando o RLS completamente.
--   INVOKER preserva o contexto do caller e o RLS de cash_inflows/cash_outflows/orders
--   (is_org_member) filtra apenas os dados da org do caller — guard real.

-- supabase/migrations/20260618100000_cash_flow_tables.sql:69-73
CREATE POLICY "financial_settings_select"
  ON public.financial_settings
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));
```

**get_rolled_opening_balance segue o MESMO padrão** — não precisa nem deve reimplementar checagem
de org.

### Pattern 2: hook TanStack Query de RPC escalar única (molde para `useCashflowDataHealth`)

**What:** `useTreasuryPanel` é o molde mais próximo — RPC que retorna 1 linha de escalares,
mapeados explicitamente com `Number(...)`/coerção de tipo, `queryKey` incluindo `orgId`,
`enabled: !!orgId`.

**Example:**
```typescript
// Fonte: src/hooks/useTreasuryPanel.ts:32-68 (adaptar para get_cashflow_data_health)
export function useCashflowDataHealth() {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;

  return useQuery<CashflowDataHealth | null>({
    queryKey: ["cashflow", "data_health", orgId] as const,
    enabled: !!orgId,
    staleTime: 3 * 60 * 1000, // mesmo staleTime das outras RPCs de caixa
    queryFn: async (): Promise<CashflowDataHealth | null> => {
      if (!orgId) return null;
      const { data, error } = await supabase.rpc("get_cashflow_data_health", { p_org_id: orgId });
      if (error) throw error;
      const r = (data as any)?.[0];
      if (!r) return null;
      return {
        tinyHoursAgo: Number(r.tiny_hours_ago ?? 0),
        tinyStale: Boolean(r.tiny_stale),
        mpHoursAgo: Number(r.mp_hours_ago ?? 0),
        mpStale: Boolean(r.mp_stale),
        anchorDaysAgo: Number(r.anchor_days_ago ?? 0),
        anchorStale: Boolean(r.anchor_stale),
      };
    },
  });
}
```

### Pattern 3: mock de `supabase.rpc` em teste de hook (molde de teste)

**What:** O repo já estabeleceu (comentário explícito no próprio teste) que hooks que usam
`supabase.rpc(...)` devem mockar `rpc: vi.fn()`, não a chain `from/select/eq` (usada para os
hooks de SELECT direto). Ver `src/hooks/useDreOperational.test.ts:24-31` — este é o teste mais
recente do repo para exatamente este padrão (Phase 88, mesma sessão que fechou a DRE por
competência).

**Example:** ver arquivo completo `src/hooks/useDreOperational.test.ts` — copiar a estrutura de
`describe`/`createWrapper`/mock de `useOrganization` para `useCashflowDataHealth.test.ts`.

### Pattern 4: banner acionável com link para outra página

**What:** `MLPedidos.tsx` já tem um banner de alerta condicional com `Alert`/`AlertDescription` +
`<Link to="...">texto</Link>` — mesmo formato que o spec pede para o gatilho do Tiny ("reconecte o
Tiny em Integrações").

**Example (fonte real):**
```tsx
// src/pages/mercadolivre/MLPedidos.tsx:1116-1128
<Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
  <AlertDescription className="text-xs leading-relaxed flex items-center justify-between gap-3 flex-wrap">
    <span>
      {summary.missing_cost > 0 && (
        <>{summary.missing_cost} pedido(s) sem <strong>custo</strong> configurado.{" "}
          <Link to="/anuncios" className="underline hover:no-underline">Configurar custos</Link>.{" "}</>
      )}
    </span>
  </AlertDescription>
</Alert>
```
Rota real para o link do Tiny: `/integracoes` (`src/App.tsx:142` — `Integrations`, `owner only`).

### Anti-Patterns to Avoid
- **Reimplementar a checagem de org dentro da função nova:** todas as RPCs deste domínio confiam
  no RLS (`is_org_member`) das tabelas subjacentes. Adicionar `IF p_org_id != ...` manual é
  redundante e, se divergir do RLS real, cria uma falsa sensação de segurança.
- **Ler `financial_settings.initial_balance` direto em qualquer lugar novo:** depois desta fase,
  toda leitura de saldo de abertura deve passar por `get_rolled_opening_balance`. Um novo card ou
  RPC que leia `initial_balance` direto reintroduz o mesmo bug que esta fase corrige.
- **Confiar na data do browser (`new Date()`) para gravar `balance_anchor_date`:** o projeto já
  corrigiu esse exato tipo de bug para `get_cashflow`/`get_projected_balance_summary` (migration
  `20260619020000_cashflow_brt_timezone.sql` — "CURRENT_DATE no Postgres é UTC... a lógica
  puxava dia errado"). A data da âncora deve vir do mesmo `(now() AT TIME ZONE
  'America/Sao_Paulo')::date` usado em todo o resto do domínio, calculada no servidor.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cálculo "há quantas horas/dias" | Lógica de diff de datas em JS no frontend | `EXTRACT(EPOCH FROM (now() - synced_at)) / 3600` no Postgres, dentro da RPC | Evita duplicar `America/Sao_Paulo` em dois lugares (client e server) e evita drift de relógio do browser |
| Anti-IDOR na nova RPC | `IF p_org_id <> auth.org...` manual | SECURITY INVOKER + confiar no RLS (`is_org_member`) já existente nas 3 tabelas | Ver Pattern 1 — é o padrão de todo o domínio, testado e documentado como guard real |
| Verificação de "sync travado" | Nova tabela de heartbeat / novo cron de monitoramento | `MAX(synced_at)` sobre `cash_inflows`/`cash_outflows` já existentes | Os dois campos já existem e já são bumpados a cada execução bem-sucedida do cron (ver Pitfall 3 sobre por que isso É suficiente) |

**Key insight:** este domínio já tem um padrão de segurança e um padrão de "hoje em BRT"
estabelecidos e testados em produção (3 gerações de bugfix: SMA, DFC alignment, BRT timezone). A
tarefa desta fase é replicar esses padrões, não inventar novos.

## Common Pitfalls

### Pitfall 1: escrever a âncora sem atualizar `balance_anchor_date` (quebra silenciosa entre Parte A e Parte B)
**What goes wrong:** `AdjustBalanceDialog.handleSave` (`src/pages/mercadolivre/MLFluxoCaixa.tsx:94-100`)
faz `.from("financial_settings").upsert({ organization_id, initial_balance }, ...)`. Se a Parte A
criar a coluna `balance_anchor_date` mas ninguém mudar este upsert, toda vez que Wesley reancorar o
saldo, `initial_balance` muda mas `balance_anchor_date` fica parado na data do backfill — a partir
daí o roll-forward soma um intervalo `[anchor_date, hoje)` cada vez maior a partir de uma âncora
cada vez mais desatualizada, e o alerta "âncora > 7 dias" nunca mais reflete a realidade (o usuário
ACABOU de reancorar, mas o sistema continua achando que não).
**Why it happens:** não existe trigger de `updated_at` em `financial_settings` (verificado — nenhum
`CREATE TRIGGER` referencia esta tabela em nenhuma migration), e o upsert atual só envia as colunas
que já conhece. Colunas novas simplesmente não são tocadas em um upsert parcial.
**How to avoid:** criar uma RPC de escrita dedicada (`set_financial_balance(p_org_id, p_amount)`)
que grava `initial_balance` + `balance_anchor_date := (now() AT TIME ZONE
'America/Sao_Paulo')::date` na MESMA instrução, e trocar o upsert direto do dialog por
`supabase.rpc("set_financial_balance", {...})`. Isto também resolve o problema de confiar na data
do browser (ver Anti-Pattern 3).
**Warning signs:** teste manual — reancorar o saldo na UI, checar se `balance_anchor_date` mudou no
banco. Se não mudou, a Parte B está incompleta.

### Pitfall 2: `updated_at::date` como fonte do backfill pode não refletir a última edição real
**What goes wrong:** o backfill travado pelo Wesley é `balance_anchor_date = updated_at::date`. Mas
como não há trigger de `updated_at` nesta tabela, e o upsert atual nunca envia essa coluna,
`updated_at` provavelmente ainda reflete a data de **criação** da linha (ex.: a migration de seed
`20260618130000_cash_flow_seed_settings.sql`), não a data em que Wesley de fato digitou o valor
atual pela última vez (ele mesmo relatou que o saldo ficou 18 dias parado — sugerindo uma edição
manual em algum ponto que este `updated_at` pode não capturar).
**Why it happens:** ausência de trigger + upsert parcial (mesma causa raiz do Pitfall 1).
**How to avoid:** aceitar o backfill como aproximação de melhor esforço (decisão já travada pelo
Wesley — não é para questionar), mas **garantir que o fix do Pitfall 1 esteja no ar antes ou junto
do backfill**, para que a partir do deploy a âncora sempre reflita a realidade. Vale checar ao vivo
(via MCP `execute_sql`, SELECT em `financial_settings`) qual é o `updated_at` real de cada org antes
de rodar o backfill, e reportar ao Wesley se o valor parecer suspeito (ex.: muito mais antigo que
os 18 dias que ele relatou).
**Warning signs:** `balance_anchor_date` pós-backfill muito mais antigo que "há 18 dias" para a org
Pé Vermeio — sinal de que `updated_at` não capturou a edição real.

### Pitfall 3: filtrar `synced_at` sem excluir linhas manuais (falso "sync OK")
**What goes wrong:** `get_cashflow_data_health` precisa calcular `MAX(cash_outflows.synced_at)`
para saber quando o Tiny sincronizou pela última vez. Se um dia existir uma linha `source='manual'`
com `synced_at` recente (inserida por engano ou por outro fluxo futuro), o `MAX()` cru mostraria
"Tiny sincronizado agora" mesmo com o token morto — mascarando exatamente o cenário que a Phase 95
existe para detectar (o token do Tiny morreu em 08/07 e o cron continuou reportando "succeeded").
**Why it happens:** `cash_outflows.synced_at` é uma coluna genérica; hoje só a EF `sync-tiny-payables`
grava `source='tiny'` com `synced_at=syncAt` (ver `supabase/functions/sync-tiny-payables/index.ts:280,282`),
mas nada impede outra origem de escrever nessa mesma coluna no futuro.
**How to avoid:** calcular `MAX(synced_at) FILTER (WHERE source = 'tiny')` (não `MAX(synced_at)`
puro) em `get_cashflow_data_health`. Mesmo raciocínio não se aplica a `cash_inflows` (não tem coluna
`source` — toda linha vem do MP via `sync-mp-releases`), então ali `MAX(synced_at)` puro está OK.
**Warning signs:** teste `get_cashflow_data_health`: inserir manualmente uma linha `cash_outflows`
com `synced_at=now()` e sem `source='tiny'` (ou `source='manual'`), confirmar que `tiny_stale`
continua refletindo o sync real do Tiny, não essa linha manual.

### Pitfall 4: escolher timestamp de migration sem checar drift real do banco
**What goes wrong:** este repo tem branches paralelas com migrations não mescladas ao `main`
aplicadas direto no MESMO projeto de produção via MCP (ex.: Phase 87 reconciliou uma RPC que já
tinha sido aplicada em prod por uma branch não mergeada, com timestamp de migration MAIOR que
qualquer coisa presente no `main` na época). Verifiquei agora: o branch de trabalho atual
(`gsd/phase-95-fluxo-caixa-confiavel`) está um commit ATRÁS do `main` em migrations —
`main` já tem `20260694000000_dre_month_close.sql`, que não existe no checkout deste branch. Se o
próximo migration file desta fase usar um timestamp menor que esse (ex.: baseado só no que existe
localmente em `supabase/migrations/`), corre risco de colidir/ficar fora de ordem quando este branch
mesclar ou quando o MCP aplicar contra o estado real do banco.
**Why it happens:** migrations não vivem 100% no git — muitas são aplicadas via MCP
`apply_migration` direto no projeto `ckcdevcxgvueywivefgx`, então o git local pode estar
desatualizado em relação ao schema real.
**How to avoid:** antes de criar o primeiro migration file desta fase, (a) rodar `git fetch` +
conferir `git log main -- supabase/migrations` ou (b) consultar via MCP quais migrations já foram
aplicadas no projeto vivo, e escolher um timestamp maior que o MAIOR encontrado em qualquer uma das
duas fontes. Referência da lição original: comentário em
`supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` (Phase 87).
**Warning signs:** `apply_migration` falhar com erro de "function already exists" com corpo
diferente do esperado, ou a ordem de aplicação parecer inconsistente com o que está no git.

### Pitfall 5: `get_cashflow`'s próprio filtro de saída (`status='pending'`) é DIFERENTE do filtro do roll-forward (`status='paid'`) — não confundir os dois
**What goes wrong:** é fácil, ao editar `get_cashflow`, reusar sem pensar o mesmo filtro de status
que já está na CTE `exp` da própria função (`co.status = 'pending' -- CASHFIX-04: só contas a pagar
EM ABERTO`, linha 85 de `20260660000000_cashflow_dfc_alignment.sql`). Mas o filtro do
**roll-forward** (dentro de `get_rolled_opening_balance`, para o intervalo `[anchor_date, hoje)`) é
o OPOSTO: `status='paid'` — porque ali o objetivo é saber o que JÁ FOI de fato pago entre a âncora e
hoje (dinheiro que realmente saiu), não o que ainda está em aberto. São dois filtros de status
corretos e intencionalmente diferentes, em duas partes diferentes da mesma função `get_cashflow`
(uma para o passado rolado via `v_initial`, outra para os dias futuros da própria série).
**Why it happens:** mesma tabela (`cash_outflows`), mesma coluna (`status`), duas semânticas
diferentes (contas pagas vs. contas em aberto) dependendo se a data é passado (âncora→hoje) ou
futuro (hoje→fim).
**How to avoid:** nomear claramente as variáveis/CTEs (ex.: `v_rolled_paid` vs. `exp` da série
futura) e comentar explicitamente por que o status difere, exatamente como o CONTEXT.md já faz.
**Warning signs:** teste do CONTEXT.md item (c) — "outflow `pending` no intervalo é ignorado (só
`paid` conta)" — falhar seria o sinal de que os dois filtros foram confundidos.

## Estratégia de Testes (TDD)

**Test runner:** `vitest` (config em `vitest.config.ts`, ambiente `jsdom`, `include:
["src/**/*.{test,spec}.{ts,tsx}", "supabase/functions/**/*.{test,spec}.ts"]`).
**Comando:** `npm test` (= `vitest run`) ou `npm run test:watch`.
**Não há testes de RPC/SQL neste repo** — os testes cobrem funções `_shared` das Edge Functions
(Deno, ex.: `supabase/functions/_shared/claimActions.test.ts`) e hooks React (`vitest`). A lógica
SQL de `get_rolled_opening_balance` e `get_cashflow_data_health` **não tem cobertura automatizada
de vitest** — a verificação dos casos SQL do CONTEXT.md (âncora=hoje, âncora−3d com
inflows/outflows, outflow pending ignorado, `get_cashflow_data_health` stale/não-stale) precisa ser
feita via `execute_sql`/`apply_migration` + SELECT manual contra dados reais ou fixtures inseridas
na própria migration de teste (padrão já usado no projeto: Phase 87 validou "cross-org 0/own 11"
rodando a RPC como o role `authenticated` real via `SET ROLE`/impersonação, não só como `postgres`
— ver memória do projeto `feedback_rpc_rls_correlated_subquery_timeout.md`).

**Testes de hook (frontend) — seguir o molde de `src/hooks/useDreOperational.test.ts`:**
1. `useCashflowDataHealth` chama `supabase.rpc("get_cashflow_data_health", { p_org_id })` com os
   args corretos e mapeia o shape (mock de `supabase.rpc`, NÃO da chain `from/select/eq` —
   Pitfall 4 do research da Phase 88, citado no próprio arquivo de teste).
2. `error` da RPC → hook entra em estado de erro (`isError: true`).
3. Sem `orgId` → hook fica `disabled`, não chama a RPC.
4. Coerção de tipos: `tiny_stale`/`mp_stale`/`anchor_stale` podem vir como string do Postgres
   (`"true"`/`"false"`) — testar `Boolean(...)`/coerção explícita, mesmo padrão do teste de
   `useDreOperational` (`double_count_risk: "true"` → `true`).

**Teste do banner (opcional, discretion):** se `CashflowHealthBanner` tiver lógica condicional de
qual mensagem mostrar por gatilho, testar via `@testing-library/react` render com props mockadas
(sem passar pelo hook) — mais simples e rápido que montar o hook inteiro.

**Verificação SQL manual obrigatória antes do merge (não-regressão, decisão travada):**
- `anchor_date = hoje` → `get_rolled_opening_balance` retorna a âncora crua (idêntico ao
  `initial_balance` puro de hoje).
- `get_cashflow` com uma org cuja âncora está no passado, comparando a série antes/depois da
  migration — a diferença deve ser exatamente a soma de entradas−saídas pagas no intervalo
  `[anchor_date, hoje)`, nada mais.
- Rodar como role `authenticated` (não `postgres`) para confirmar que o RLS de `is_org_member`
  ainda filtra corretamente (cross-org deve retornar vazio/erro, não dados de outra org).

## Code Examples

### `get_rolled_opening_balance` (esqueleto sugerido)
```sql
-- Fonte do padrão de estrutura: supabase/migrations/20260660000000_cashflow_dfc_alignment.sql:37-58
CREATE OR REPLACE FUNCTION public.get_rolled_opening_balance(p_org_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_today       DATE    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_anchor_date DATE;
  v_anchor_bal  NUMERIC := 0;
  v_inc         NUMERIC := 0;
  v_paid_exp    NUMERIC := 0;
BEGIN
  SELECT fs.balance_anchor_date, fs.initial_balance
    INTO v_anchor_date, v_anchor_bal
  FROM public.financial_settings fs
  WHERE fs.organization_id = p_org_id
  LIMIT 1;

  IF v_anchor_date IS NULL THEN
    RETURN COALESCE(v_anchor_bal, 0); -- org sem âncora ainda: comportamento atual
  END IF;

  SELECT COALESCE(SUM(ci.net_amount), 0) INTO v_inc
  FROM public.cash_inflows ci
  WHERE ci.organization_id = p_org_id
    AND ci.release_date >= v_anchor_date AND ci.release_date < v_today;

  SELECT COALESCE(SUM(co.amount), 0) INTO v_paid_exp
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.status = 'paid'  -- SOMENTE pago — diferente do filtro 'pending' da série futura (Pitfall 5)
    AND co.outflow_date >= v_anchor_date AND co.outflow_date < v_today;

  RETURN v_anchor_bal + v_inc - v_paid_exp;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_rolled_opening_balance(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_rolled_opening_balance(UUID) TO authenticated, service_role;
```
*(`anchor_date = hoje` → intervalo `[hoje, hoje)` vazio → `v_inc`/`v_paid_exp` = 0 → retorna
`v_anchor_bal` cru, satisfazendo o teste de não-regressão do CONTEXT.md.)*

### Substituição nas 3 RPCs consumidoras (diff conceitual)
```sql
-- ANTES (repetido em get_cashflow, get_projected_balance_summary, get_treasury_panel):
v_initial := COALESCE((SELECT fs.initial_balance FROM financial_settings fs
                        WHERE fs.organization_id = p_org_id LIMIT 1), 0);

-- DEPOIS:
v_initial := public.get_rolled_opening_balance(p_org_id);
```
Atenção: `get_treasury_panel` também lê `fs.alert_threshold` na MESMA query (linha 97-98 de
`20260660000200_cashflow_saldo_indicators_forecasts.sql`) — ao trocar, manter essa segunda leitura
intacta, só substituindo a parte de `initial_balance`.

### RPC de escrita da âncora (fix do Pitfall 1)
```sql
CREATE OR REPLACE FUNCTION public.set_financial_balance(p_org_id UUID, p_amount NUMERIC)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.financial_settings (organization_id, initial_balance, balance_anchor_date, updated_at)
  VALUES (p_org_id, p_amount, (now() AT TIME ZONE 'America/Sao_Paulo')::date, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET initial_balance     = EXCLUDED.initial_balance,
        balance_anchor_date = EXCLUDED.balance_anchor_date,
        updated_at          = now();
END;
$$;
-- RLS de financial_settings_write (get_org_role=owner) continua sendo o guard —
-- INVOKER preserva isso automaticamente.
REVOKE EXECUTE ON FUNCTION public.set_financial_balance(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_financial_balance(UUID, NUMERIC) TO authenticated;
```
Client (`AdjustBalanceDialog.handleSave`, substituindo `src/pages/mercadolivre/MLFluxoCaixa.tsx:94-102`):
```typescript
const { error } = await supabase.rpc("set_financial_balance", {
  p_org_id: orgId,
  p_amount: parsed,
});
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `updated_at` de `financial_settings` reflete a data de criação da linha (seed), não a última edição real, porque não há trigger e o upsert atual não envia essa coluna | Pitfall 2 | Se houver algum outro caminho de escrita não encontrado nesta busca que já atualize `updated_at`, o backfill pode estar mais correto do que o research assume — vale confirmar com uma query rápida ao vivo antes do backfill |
| A2 | `TABLE` (não `jsonb`) é a forma de retorno recomendada para `get_cashflow_data_health`, por consistência com `get_treasury_panel`/`get_projected_balance_summary` | Standard Stack / Code Examples | É discretion explícita do Wesley — se o planner preferir jsonb por outro motivo (ex.: retorno aninhado), não há perda funcional, só inconsistência estilística |
| A3 | Nenhuma outra tela/RPC além das 3 citadas (`get_cashflow`, `get_projected_balance_summary`, `get_treasury_panel`) lê `financial_settings.initial_balance` diretamente | Architecture Patterns | Busquei por `initial_balance` só nas migrations de fluxo de caixa; se outra RPC fora desse domínio (ex.: DRE, Consultor) também ler essa coluna, ela ficaria fora do escopo do roll-forward — vale um grep final de `initial_balance` em TODAS as migrations antes de considerar a Parte A completa |

## Open Questions

1. **`get_cashflow_data_health` deve alertar por org com múltiplas contas ML (multi-seller)?**
   - What we know: `financial_settings`/`cash_inflows`/`cash_outflows` são por `organization_id`,
     não por `ml_user_id` — já agregam todas as lojas ML da org (ex.: Thales tem só 1 seller;
     Pé Vermeio também). Não há hoje um cenário de 1 org com múltiplos sellers ML neste domínio.
   - What's unclear: se isso mudar no futuro, o "Tiny stale" agregado por org pode mascarar 1 loja
     travada entre várias saudáveis.
   - Recommendation: fora de escopo desta fase — o schema atual não distingue por loja neste
     domínio; não adicionar complexidade especulativa.

2. **A RPC de escrita (`set_financial_balance`) é discretion — o Wesley só travou "nova coluna +
   backfill", não travou uma nova RPC de escrita.**
   - What we know: sem essa RPC (ou equivalente), o Pitfall 1 quebra silenciosamente a relação
     entre Parte A e Parte B.
   - What's unclear: se o planner preferir resolver de outra forma (ex.: enviar
     `balance_anchor_date` explicitamente do client, calculada via alguma lib de timezone no
     frontend), isso também resolveria o Pitfall 1, só que com mais risco de drift de fuso
     (ver Anti-Pattern 3).
   - Recommendation: usar a RPC de escrita (mais simples, mais seguro, replica o padrão do
     projeto de sempre calcular "hoje" no servidor).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | não (fora do escopo desta fase) | — |
| V3 Session Management | não | — |
| V4 Access Control | sim | `SECURITY INVOKER` + RLS `is_org_member` (SELECT) / `get_org_role = owner` (escrita via `set_financial_balance`) — padrão já estabelecido, ver Pattern 1 |
| V5 Input Validation | sim | `p_org_id UUID`, `p_amount NUMERIC` tipados na assinatura da função — Postgres rejeita tipo inválido antes de executar o corpo |
| V6 Cryptography | não | — |

### Known Threat Patterns for este domínio

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR via `p_org_id` arbitrário em RPC `DEFINER` | Elevation of Privilege | NUNCA usar `SECURITY DEFINER` nestas RPCs — usar `SECURITY INVOKER`, deixando o RLS (`is_org_member`) fazer o filtro real (ver Pattern 1) |
| Escrita de saldo por não-owner | Elevation of Privilege | RLS `financial_settings_write` já exige `get_org_role(auth.uid(), organization_id) = 'owner'`; `set_financial_balance` em INVOKER herda essa proteção automaticamente — não reimplementar a checagem dentro da função |
| Leitura de `synced_at`/saldo de outra org via a nova RPC de health | Information Disclosure | Mesma proteção — RLS de `SELECT` em `cash_inflows`/`cash_outflows`/`financial_settings` já existe e é herdada via INVOKER |

## Sources

### Primary (HIGH confidence — leitura direta do código-fonte deste repositório)
- `.planning/phases/95-.../95-CONTEXT.md` — decisões travadas
- `.planning/specs/2026-07-13-fluxo-caixa-confiavel.md` — design + diagnóstico
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` — página, dialog de ajuste de saldo
- `src/hooks/useCashFlowData.ts`, `useTreasuryPanel.ts`, `useProjectedBalance.ts`, `useFinancialSettings.ts`
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — schema + RLS de `financial_settings`/`cash_inflows`/`cash_outflows`
- `supabase/migrations/20260660000000_cashflow_dfc_alignment.sql` — corpo atual de `get_cashflow` (mais recente)
- `supabase/migrations/20260660000200_cashflow_saldo_indicators_forecasts.sql` — corpo atual de `get_projected_balance_summary`/`get_treasury_panel`
- `supabase/migrations/20260619020000_cashflow_brt_timezone.sql` — padrão BRT (`America/Sao_Paulo`)
- `supabase/migrations/20260692000000_dre_operational_reconcile_context_map.sql` — padrão SECURITY INVOKER sem checagem manual + lição de drift de migration timestamp (Phase 87)
- `supabase/migrations/20260686000000_cash_outflows_competence_date.sql` — padrão de coluna aditiva + backfill
- `supabase/functions/sync-tiny-payables/index.ts`, `sync-mp-releases/index.ts` — comportamento de `synced_at`/`source` no upsert
- `src/hooks/useDreOperational.test.ts` — molde de teste de hook com `supabase.rpc` mockado
- `src/pages/mercadolivre/MLPedidos.tsx` — molde de banner de alerta com link
- `src/components/ui/alert.tsx` — componente `Alert` do design system
- `vitest.config.ts`, `package.json` — comandos e config de teste
- `git ls-tree`/`git branch -a` no próprio repo — confirmação de drift entre `main` e o branch de trabalho

### Secondary / Tertiary
- Nenhuma — esta fase não dependeu de WebSearch/Context7, pois é 100% código interno já existente
  no repositório.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sem dependências novas, tudo lido do `package.json` real.
- Architecture: HIGH — os 3 arquivos de RPC e os 3 hooks foram lidos por completo, não inferidos.
- Pitfalls: HIGH — Pitfalls 1, 2, 3 e 4 vêm de leitura direta de código/git, não de suposição.
- Security: HIGH — padrão INVOKER/RLS confirmado em múltiplas migrations e no comentário explícito do projeto.

**Research date:** 2026-07-13
**Valid until:** próxima migration que tocar `get_cashflow`/`get_treasury_panel`/
`get_projected_balance_summary` ou o schema de `financial_settings` (domínio já mudou 8+ vezes
neste ano — revalidar corpo das funções antes de implementar se muito tempo passar entre research e execução).
