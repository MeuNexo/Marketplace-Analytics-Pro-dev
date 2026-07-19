# Phase 98: INSS de folha na DRE deve seguir a régua M+1 — Research

**Researched:** 2026-07-16
**Domain:** DRE (frontend React puro + RPC Postgres/Supabase) — extensão da régua M+1 (impostos de venda) para `Pessoal - INSS`
**Confidence:** MEDIUM-HIGH no código (tudo lido em disco, arquivo:linha reais). LOW no estado vivo do banco (ver `## Environment Availability` — MCP Supabase indisponível nesta sessão; dados de banco vêm do CONTEXT.md, já coletados ao vivo por outra sessão com Wesley).

## Summary

O mecanismo M+1 que esta phase precisa clonar já existe, é pequeno, e está 100% isolado em módulos puros testáveis: `dreRegime.ts` (resolver), `useImpostoGuiaReal.ts` (hook + RPC), `dreCloseGate.ts` (gate C7), `dreCascade.ts` (consumidor da cascata). O padrão do projeto é uma RPC pequena e dedicada por regra de negócio — **não existe** nenhuma RPC "genérica por lista de categorias" reutilizável; `dre_bloco_for_category(p_category text)` é o único helper compartilhado, e ele só resolve o mapa categoria→bloco, não a régua de competência. Confirma a recomendação do CONTEXT: criar `get_inss_guia_by_competence` nova e pequena, seguir o estilo do repo.

**Achado crítico que muda o escopo do planner:** a Phase 96 (`C11`) **já travou explicitamente**, com 4 testes de regressão em `dreCascade.test.ts`, o comportamento atual — "INSS fica no bloco Pessoal, NENHUM valor migra pra linha de impostos, `dreCascade.ts` NÃO muda". O comentário do describe diz literalmente "se algum dos 4 testes falhar... não editar `dreCascade.ts`". A Phase 98 precisa **deliberadamente invalidar/reescrever esses 4 testes** (não são mais uma "não-mudança" — Wesley reverteu a decisão hoje, 2026-07-16, ao vivo). Isso não é um bug do research anterior: era correto no dia em que foi escrito. O planner PRECISA saber disso ou vai achar que quebrou algo ao rodar a suíte e vai tentar reverter o comportamento novo para fazer os 4 testes antigos passarem de novo.

A RPC 87 (`get_dre_operational_by_competence`) já filtra `co.status <> 'cancelled'` e agrupa `Salários`, `Pró-labore`, `Pessoal - INSS` juntos no bloco `pessoal`, **sem deslocamento de mês** — ela nunca muda (guardrail confirmado, migration `20260716210000_cancelled_payables_dre.sql:31-82`, aplicada hoje 2026-07-16). Isso significa que a linha "Pessoal - INSS" que chega em `dreOperationalRows` (via `useDreOperational`) é sempre a do mês corrente M, **não** a M+1 — exatamente o valor errado que a phase precisa substituir, nunca somar em cima.

A RPC `get_imposto_guia_by_competence` (o molde a clonar) **não existe em nenhuma migration deste repo** — confirma o drift já documentado no CONTEXT: veio de um worktree irmão não mergeado (`/root/garment-glow-dre`, branch `gsd/phase-90-...`). Encontrei o arquivo fonte real: `/root/garment-glow-dre/supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql`. A nova RPC de INSS deve seguir literalmente essa definição, trocando só a lista de categorias (uma categoria em vez de três).

**Primary recommendation:** Clonar o padrão dos 4 arquivos (RPC dedicada + hook + reuso do resolver + gate), com UMA mudança de arquitetura importante: **não é preciso duplicar `resolveDreRegime`** — o valor de INSS-real (M+1) é resolvido com a MESMA regra "soma tudo exceto cancelled" que já existe (é uma soma simples de 1 categoria, não precisa da complexidade do resolver de 3 categorias + regime previsão/apuração). Uma função pura pequena `resolveInssReal(guia: GuiaRealCategoryTotal[] | null): number | null` no estilo do trecho de `apuracaoImpostoReal` em `dreRegime.ts:139-145` é suficiente. O ponto de integração é `MercadoLivre.tsx`: filtrar `Pessoal - INSS` das `dreOperationalRows` ANTES de `buildDreCascade`, e somar o `inssReal` resolvido no total do bloco `pessoal` da cascata resultante (mudança de assinatura de `buildDreCascade` OU pós-processamento do resultado — decisão do planner, mas a saída observável tem que ser: bloco Pessoal = Salários+Pró-labore (mês corrente) + INSS (M+1)).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Nova régua M+1 para categoria INSS | **Frontend** (hook + resolver puro) | Database (RPC nova, dedicada) | Mesmo padrão do imposto de venda — o deslocamento de mês é decidido no frontend, a RPC só expõe status×total por competência crua |
| Exclusão da linha INSS não-deslocada do bloco `pessoal` | **Frontend** (`MercadoLivre.tsx` ou `dreCascade.ts`) | — | `dreOperationalRows` (RPC 87) nunca muda; o filtro/substituição é client-side, como já é o padrão do C1 (cancelamentos somados na fórmula, não na RPC) |
| Gate de fechamento (INSS ausente bloqueia?) | **Frontend** (`dreCloseGate.ts`) | — | Mesmo lugar do C6/C7 — decisão em aberto, ver seção própria |
| Migration da nova RPC | **Database** | — | `CREATE OR REPLACE`, SECURITY INVOKER, RLS herdada de `cash_outflows` (já org-scoped e anti-IDOR provada) |

## Standard Stack

Nenhuma dependência nova. Stack já em uso: React + TypeScript + TanStack Query 5.83 (hook) + Supabase RPC (SQL puro, `SECURITY INVOKER`) + Vitest (testes puros).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RPC dedicada `get_inss_guia_by_competence` (1 categoria) | Generalizar `get_imposto_guia_by_competence` para aceitar `p_categories text[]` | Rejeitado — `get_imposto_guia_by_competence` é uma RPC viva com múltiplos consumidores (guardrail explícito no CONTEXT: "NUNCA modificar"); mudar a assinatura quebraria contratos existentes. Nenhum precedente no repo de RPC parametrizada por lista de categorias — o padrão observado (`get_cancelled_revenue`, `dre_bloco_for_category`, `get_imposto_guia_by_competence`) é sempre 1 RPC pequena, hardcoded, por regra de negócio |

**Instalação:** nenhum pacote novo. Só migration SQL + arquivos TS/TSX novos.

## Package Legitimacy Audit

N/A — esta phase não instala nenhum pacote externo (só SQL + TypeScript usando dependências já presentes no projeto).

## Architecture Patterns

### System Architecture Diagram

```
cash_outflows (Postgres)
  category='Pessoal - INSS', competence_date=M+1, status ∈ {paid,pending,cancelled}
        │
        ▼
[NOVA] RPC get_inss_guia_by_competence(org_id, p_competence)
  SELECT category, sum(amount) total, status, count(*) n
  WHERE category = 'Pessoal - INSS' AND competence_date ∈ [mês, mês+1)
  GROUP BY category, status
        │  (chamada com p_competence = monthPlusOne(saleMonth))
        ▼
[NOVO] useInssGuiaReal(saleMonth)  ── mirror de useImpostoGuiaReal.ts
        │  retorna GuiaRealCategoryTotal[] (mesmo tipo, reaproveitado)
        ▼
[NOVA função pura] resolveInssReal(rows) → number | null
  soma total onde status !== 'cancelled'; null se ausente
        │
        ▼
MercadoLivre.tsx (orquestração, ~linha 280-440)
  dreOperationalRows (RPC 87, SEM deslocar, categoria INSS ainda no mês M)
        │
        ├─► filtra fora a linha 'Pessoal - INSS' de dreOperationalRows
        │
        ▼
  buildDreCascade(rowsFiltradas, margemContribuicao)  ── dreCascade.ts
        │
        ├─► soma inssReal (M+1) no total do bloco 'pessoal' da cascata
        │
        ▼
  MLCostCard.tsx — exibe bloco "Pessoal" já com o total ajustado
                    (nenhuma mudança neste componente — só recebe o número certo)

[gate paralelo, decisão em aberto] dreCloseGate.ts
  canApurarImposto() hoje só olha ICMS/PIS/COFINS — decidir se estende p/ INSS
```

### Recommended Project Structure

Nenhuma pasta nova — os arquivos entram nos mesmos diretórios dos pares que espelham:

```
src/
├── lib/
│   ├── dreRegime.ts          # existente — NÃO editar (resolver de impostos de venda)
│   ├── dreCascade.ts         # existente — precisa de mudança OU um wrapper novo
│   ├── dreCloseGate.ts       # existente — extensão possível (decisão em aberto)
│   ├── dreRegime.test.ts     # existente
│   ├── dreCascade.test.ts    # existente — 4 testes do C11 PRECISAM mudar
│   └── dreCloseGate.test.ts  # existente — testes novos se o gate for estendido
├── hooks/
│   ├── useImpostoGuiaReal.ts # existente — NÃO editar
│   └── useInssGuiaReal.ts    # NOVO — mirror de useImpostoGuiaReal (só a função (a), sem o nudge)
└── pages/
    └── MercadoLivre.tsx      # orquestração — precisa ligar o hook novo + filtrar bloco pessoal
```

### Pattern 1: RPC dedicada por régua de competência deslocada (M+1)
**What:** uma RPC `STABLE SECURITY INVOKER` que expõe linhas cruas (`category, total, status, n`) agrupadas por status, para UMA categoria (ou grupo fixo de categorias que sempre aparecem juntas), filtradas por `competence_date` dentro do mês pedido. A régua de deslocamento (M → M+1) é aplicada SÓ no frontend, nunca dentro da RPC.
**When to use:** quando uma categoria de `cash_outflows` tem uma competência real diferente do mês em que aparece na RPC agregada (RPC 87), e essa RPC agregada não pode ser tocada (múltiplos consumidores vivos).
**Example (clone de `/root/garment-glow-dre/supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql`):**
```sql
-- Fonte: RPC irmã get_imposto_guia_by_competence, único ponto de origem real
-- (não existe migration desta RPC no repo garment-glow-test — drift confirmado)
CREATE OR REPLACE FUNCTION public.get_inss_guia_by_competence(
  p_org_id     uuid,
  p_competence date
)
RETURNS TABLE (
  category text,
  total    numeric,
  status   text,
  n        integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    co.category                    AS category,
    sum(co.amount)                 AS total,
    co.status                      AS status,
    count(*)::integer              AS n
  FROM public.cash_outflows co
  WHERE co.organization_id = p_org_id
    AND co.category = 'Pessoal - INSS'
    AND co.competence_date >= date_trunc('month', p_competence)::date
    AND co.competence_date <  (date_trunc('month', p_competence) + interval '1 month')::date
  GROUP BY co.category, co.status
  ORDER BY co.status;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_inss_guia_by_competence(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_inss_guia_by_competence(uuid, date) TO authenticated;
```

### Pattern 2: Hook M+1 (mirror de `useImpostoGuiaReal`)
```typescript
// Source: src/hooks/useImpostoGuiaReal.ts (mirror — mesmo query key shape, staleTime, orgId guard)
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { monthPlusOne } from "@/lib/dreRegime";
import type { GuiaRealCategoryTotal } from "@/lib/dreRegime"; // TIPO REAPROVEITADO — shape idêntico

export function useInssGuiaReal(saleMonth: string) {
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const pCompetence = saleMonth ? monthPlusOne(saleMonth) : null;

  return useQuery<GuiaRealCategoryTotal[]>({
    queryKey: ["dre", "inss-guia", orgId, pCompetence] as const,
    enabled: !!orgId && !!saleMonth,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GuiaRealCategoryTotal[]> => {
      if (!orgId || !pCompetence) return [];
      const { data, error } = await supabase.rpc("get_inss_guia_by_competence", {
        p_org_id: orgId,
        p_competence: pCompetence,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        category: String(r.category),
        total: Number(r.total ?? 0),
        status: String(r.status ?? ""),
      }));
    },
  });
}
```

### Pattern 3: Resolver puro da soma real (mirror do trecho `apuracaoImpostoReal` de `resolveDreRegime`)
```typescript
// Source: src/lib/dreRegime.ts:139-145 (mesma regra, extraída para 1 categoria)
export function resolveInssReal(guia: GuiaRealCategoryTotal[] | null): number | null {
  if (!guia || guia.length === 0) return null;
  return round2(
    guia.filter((g) => g.status !== "cancelled").reduce((sum, g) => sum + g.total, 0),
  );
}
```
Isso pode viver em `dreRegime.ts` (módulo puro já existente, sem import de React/Supabase) como uma função irmã de `resolveDreRegime`, OU em um arquivo novo `dreInss.ts` — decisão de organização de arquivo fica pro planner; a regra de negócio (`status !== 'cancelled'` soma, ausente → null) é idêntica e NÃO deve ser reimplementada com lógica diferente.

### Anti-Patterns to Avoid
- **Somar o INSS deslocado EM CIMA do INSS não-deslocado:** a linha "Pessoal - INSS" que já vem em `dreOperationalRows` (RPC 87, mês M, sem deslocamento) tem que ser REMOVIDA da soma do bloco antes de adicionar o valor M+1 — nunca somar os dois.
- **Tocar em `get_dre_operational_by_competence` ou `get_imposto_guia_by_competence`:** guardrail explícito do CONTEXT e confirmado no código — ambas vivas, múltiplos consumidores (`useNaoClassificadoItems`, `useDreOperational`, `dreRegime`, `useCmvCheioGate` compartilham o mesmo eixo de mês dessas RPCs).
- **Deixar os 4 testes do C11 (`dreCascade.test.ts:153-208`) vermelhos sem entender por quê:** eles vão falhar DE PROPÓSITO depois desta mudança — isso é esperado, não é regressão. Precisam ser reescritos para refletir a nova regra (INSS deslocado), não revertidos.
- **Misturar o valor de INSS deslocado com o campo `total` cru de `dreOperationalRows`:** seguir a mesma separação de dados que `resolveDreRegime` já faz — nunca ler `total` de uma linha crua da RPC 87 quando o valor real já foi resolvido por outra fonte.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Soma "todas as linhas não-canceladas de uma categoria numa competência" | Uma nova função de agregação do zero | `resolveInssReal` (Pattern 3), clone literal do trecho já existente em `resolveDreRegime` | A regra `cancelled` = crédito sem guia já foi validada e testada em produção pela Phase 96/97 — reimplementar do zero arrisca divergir sutilmente (ex.: esquecer o `round2`) |
| Filtro de mês "YYYY-MM-01" → mês seguinte | Parsing de data com `new Date()` ou string concat | `monthPlusOne()` de `dreRegime.ts` (já importável, já testado para virada de dezembro) | Pitfall 3 documentado no projeto inteiro: qualquer cast/parse manual de "YYYY-MM" quebra silenciosamente |

**Key insight:** este domínio (DRE, competência deslocada) já tem TODO o ferramental necessário construído e testado em 2 phases anteriores (94, 96). A Phase 98 é 90% composição de peças existentes, não construção nova.

## Common Pitfalls

### Pitfall 1: Os 4 testes de regressão do C11 vão quebrar — isso é esperado
**What goes wrong:** o executor roda `npx vitest run src/lib/dreCascade.test.ts`, vê 4 falhas no describe `"buildDreCascade — C11: INSS fica no bloco Pessoal (NÃO-mudança)"` e acha que introduziu uma regressão.
**Why it happens:** a Phase 96 travou deliberadamente o comportamento ANTIGO com testes. Wesley reverteu essa decisão hoje (98-CONTEXT.md), então o comportamento antigo deixou de ser correto.
**How to avoid:** o plano precisa incluir explicitamente uma task para **reescrever** (não deletar silenciosamente) os 4 testes do C11, com um comentário no describe explicando que a Phase 98 substituiu a decisão da Phase 96 (mesmo estilo de "aviso ao futuro leitor" já usado nos comentários do C11 original).
**Warning signs:** `npx vitest run` reporta exatamente 4 falhas, todas no mesmo describe, todas comparando `pessoal.total` incluindo INSS não-deslocado.

### Pitfall 2: `dreOperationalRows` (RPC 87) nunca deve ser tratado como "já correto" para o bloco pessoal
**What goes wrong:** um dev lê `buildDreCascade` e assume que basta ADICIONAR o inssReal ao total do bloco `pessoal`, sem filtrar a linha crua — resultado: INSS contado duas vezes (mês M sem deslocar + mês M+1 deslocado).
**Why it happens:** a RPC 87 já inclui `Pessoal - INSS` misturado com `Salários`/`Pró-labore` numa única linha agregada por bloco (ou linhas separadas por categoria — confirmar shape exato: a RPC retorna `GROUP BY 1, co.category`, então HÁ uma linha por categoria dentro do bloco, não uma soma cega — isso facilita o filtro: `rows.filter(r => !(r.bloco === 'pessoal' && r.category === 'Pessoal - INSS'))`).
**How to avoid:** filtrar por `category === 'Pessoal - INSS'` (não por bloco inteiro) antes de chamar `buildDreCascade`, e adicionar o inssReal resolvido separadamente.
**Warning signs:** o total do bloco Pessoal exibido sobe em vez de mudar de mês corretamente ao navegar entre competências.

### Pitfall 3 (já documentado no projeto): datas "YYYY-MM-01"
**What goes wrong:** qualquer SQL ou JS novo que trate `competence_date`/`p_competence` como string "YYYY-MM" (sem o dia) quebra o cast Postgres ou o parse de `Date`.
**How to avoid:** clonar exatamente `monthPlusOne()` (já correto) e nunca reimplementar aritmética de data com string concat solta. Confirmado nesta pesquisa: a RPC `get_imposto_guia_by_competence` (molde) usa `date_trunc('month', p_competence)` — o mesmo padrão deve ir para a RPC nova.

### Pitfall 4: RPC molde não está neste repo — não confiar no `grep` local
**What goes wrong:** um `grep -rn "get_imposto_guia_by_competence" supabase/` neste repo (`garment-glow-test`) não encontra a definição da RPC — só comentários que a mencionam. Um dev apressado poderia concluir que a RPC não existe ou tentar recriá-la do zero, arriscando divergir do que está em produção.
**How to avoid:** a definição REAL está em `/root/garment-glow-dre/supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql` (worktree irmão, lido nesta pesquisa — reproduzida no Pattern 1). Antes de escrever a migration nova, o executor/planner deve confirmar via MCP Supabase (`list_migrations` + `pg_get_functiondef`) que a versão em prod bate com este arquivo — não assumir que o arquivo do worktree irmão é 100% idêntico ao que está live (drift já aconteceu uma vez neste projeto, RPC 87 teve que ser reconciliada na Phase 87/migration `20260692000000`).

### Pitfall 5: numeração de migration sem checar `list_migrations` ao vivo
**What goes wrong:** numerar a migration nova baseado só no `ls supabase/migrations/` local (`20260716210000` é o mais recente encontrado neste repo) pode colidir com uma migration aplicada em prod que não está neste repo (o próprio caso da RPC de imposto).
**How to avoid:** rodar `mcp Supabase list_migrations` no projeto `ckcdevcxgvueywivefgx` **antes** de numerar (bloqueado nesta sessão de pesquisa — ver `## Environment Availability`). Recomendo o planner inserir isso como o primeiro passo da Wave 0/task de implementação, não assumir o número aqui.

## Code Examples

### Ponto de integração em `MercadoLivre.tsx` (esboço — decisão de exato local fica pro planner)
```typescript
// Mirror do padrão já usado para guiaReal/guiaNudge (linhas ~283-285)
const inssGuiaReal = useInssGuiaReal(dreSaleMonth);
const inssReal = resolveInssReal(inssGuiaReal.data ?? null);

// Antes de buildDreCascade — filtra a linha crua de INSS (mês M, sem deslocar)
const dreOperationalRowsSemInss = useMemo(
  () => (dreOperationalRows ?? []).filter((r) => r.category !== "Pessoal - INSS"),
  [dreOperationalRows],
);

const dreCascade = useMemo(() => {
  const base = buildDreCascade(dreOperationalRowsSemInss, margemContribuicao);
  // Pós-processamento: soma o INSS real (M+1) no bloco 'pessoal' já montado.
  // (alternativa: passar inssReal como parâmetro extra de buildDreCascade —
  // decisão do planner; a saída observável tem que ser idêntica.)
  if (inssReal == null) return base;
  return {
    ...base,
    operacionalBlocos: base.operacionalBlocos.map((b) =>
      b.bloco === "pessoal" ? { ...b, total: round2(b.total + inssReal) } : b,
    ),
    totalOperacionalDeducoes: round2(base.totalOperacionalDeducoes + inssReal),
    resultadoOperacional: round2(base.resultadoOperacional - inssReal),
    resultadoLiquido: round2(base.resultadoLiquido - inssReal),
  };
}, [dreOperationalRowsSemInss, margemContribuicao, inssReal]);
```
**Nota:** este esboço assume que, se `Pessoal - INSS` nunca teve linha no mês (bloco `pessoal` ausente por completo, ex.: só existisse INSS no mês), o bloco `pessoal` pode não aparecer em `base.operacionalBlocos` — nesse caso a soma precisa CRIAR a linha, não só mapear. `Salários`/`Pró-labore` são recorrentes todo mês no histórico observado (folha mensal), então esse caso é raro mas o planner deve cobri-lo num teste (mês com SÓ INSS, sem Salários/Pró-labore no bloco pessoal).

## Runtime State Inventory

> Não aplicável — esta phase não é rename/refactor/migração de nome. É adição de régua de cálculo. Nenhuma stored data, config de serviço externo, ou secret muda de nome. Confirmado por leitura do CONTEXT.md e do código: a mudança é puramente na CAMADA DE LEITURA (frontend + 1 RPC nova, aditiva). Nenhum dado em `cash_outflows` precisa ser migrado — os dados já existem com `competence_date` correto (confirmado pelo dado real do CONTEXT: INSS de 2026-03-01 e 2026-04-01 já têm competence_date populado).

## Common Pitfalls (continuação) / Blast Radius

**Consumidores diretos de `useDreOperational` / bloco `pessoal` / categoria `Pessoal - INSS` (grep completo):**

| Arquivo | Como consome | Precisa mudar? |
|---|---|---|
| `src/pages/MercadoLivre.tsx` | Chama `useDreOperational`, monta `dreCascade` via `buildDreCascade` | **SIM** — ponto de integração principal |
| `src/lib/dreCascade.ts` | Agrega `rows` por bloco, soma `pessoal` | **SIM ou NÃO** dependendo se o planner escolhe mudar a assinatura de `buildDreCascade` ou fazer pós-processamento no caller |
| `src/lib/dreCascade.test.ts` | 4 testes do C11 fixam o comportamento antigo (linhas 153-208) | **SIM** — precisa reescrever |
| `src/hooks/useDreOperational.ts` | Só busca a RPC 87 crua, tipos `DreBloco`/`DreOperationalRow` | **NÃO** — RPC 87 nunca muda |
| `src/hooks/useDreOperational.test.ts` | Testa o hook (mock da RPC) | Verificar se testa conteúdo do bloco `pessoal` especificamente — se sim, pode precisar de nota, mas o hook em si não muda |
| `src/hooks/useNaoClassificadoItems.ts` | Usa `IMPOSTO_VENDA_CATEGORIES`, mas categoria distinta (`nao_classificado`) | **NÃO** |
| `src/lib/dreCloseGate.ts` / `.test.ts` | Gate C6/C7 — usa `IMPOSTO_VENDA_CATEGORIES`, não inclui INSS hoje | **DECISÃO EM ABERTO** (ver seção própria) |
| `src/components/mercadolivre/MLCostCard.tsx` | Só renderiza `DreCascadeBlocoLine[]` já prontos (não lê categoria diretamente) | **NÃO** — recebe o número já certo do caller |

Nenhum outro arquivo no repo (`grep -rln "Pessoal - INSS\|useDreOperational\|'pessoal'"`) toca este domínio. Blast radius é pequeno e totalmente mapeado — mesmo padrão de rigor que a pesquisa da Phase 96 aplicou para `paid_revenue` (6 consumidores).

## Open Questions

1. **O gate de fechamento (`resolveCloseGate`/`canApurarImposto`) deve bloquear se a guia de INSS (M+1) estiver ausente, no mesmo padrão do C6/C7?**
   - **O que sabemos:** Wesley confirmou explicitamente (98-CONTEXT.md, decisões travadas) a régua de DESLOCAMENTO DE VALOR (M+1) para o INSS, com a mesma semântica de status (`cancelled`=crédito, `paid`/`pending`=soma). Ele NÃO confirmou explicitamente que quer o mesmo comportamento de GATE (bloquear fechamento se ausente/pending).
   - **O que está incerto:** o gate atual (`canApurarImposto`) foi desenhado especificamente pros 3 impostos de venda (ICMS/PIS/COFINS) e é o que travou março por causa do COFINS ausente — o evento que disparou esta phase. Replicar o mesmo gate pro INSS é o padrão mais consistente (mesma régua = mesmo gate), mas também significa que UM mês pode ficar bloqueado esperando a guia de INSS de M+1 mesmo que os outros 3 impostos já tenham sido resolvidos — um NOVO ponto de travamento que Wesley pode não esperar.
   - **Prós de estender o gate:**
     - Consistência: mesma régua (M+1) implica no mesmo nível de confiança exigido antes de fechar.
     - Evita fechar um mês com o valor de INSS ainda "pending"/placeholder, que geraria a mesma dor que motivou o C7 original (mês fechado com dado fantasma).
   - **Contras de estender o gate:**
     - Mais um ponto de bloqueio pode frustrar o fluxo de fechamento (Wesley já reclamou implicitamente do gate travando março).
     - Semanticamente, o INSS é um encargo de FOLHA (recorrente, previsível), diferente de impostos de venda (variam com receita) — pode ser aceitável fechar com uma estimativa de INSS e corrigir depois, sem o mesmo rigor.
   - **Recomendação:** o planner deve levantar esta pergunta como um `checkpoint:human-verify` explícito ANTES de decidir se `resolveCloseGate` ganha um terceiro sinal (`canApurarInss`), com as duas opções acima. Não decidir sozinho — o CONTEXT.md já sinaliza isto como pendente.

2. **Onde a soma resolveInssReal deve morar organizacionalmente — `dreRegime.ts` (função irmã) ou um módulo novo `dreInss.ts`?**
   - **O que sabemos:** a lógica é idêntica (1 linha de código, clone do trecho de `apuracaoImpostoReal`), e não há import circular problem em nenhum dos dois locais.
   - **O que está incerto:** `dreRegime.ts` é hoje especificamente sobre o par (CMV, imposto de venda) e o regime previsão/apuração — misturar um resolver de categoria completamente diferente (folha) no mesmo arquivo pode confundir o próximo leitor sobre o escopo do módulo.
   - **Recomendação:** módulo novo (`dreInss.ts` ou nome equivalente) é mais limpo — decisão de baixo risco, fica a critério do planner/CLAUDE.

## Addendum (confirmado ao vivo via MCP Supabase logo após esta pesquisa, mesma sessão do orquestrador)

Os 2 itens marcados LOW/Tertiary abaixo foram confirmados diretamente no projeto `ckcdevcxgvueywivefgx`:

1. **`max(version)` real de migrations em prod = `20260716172353`** (nome `cancelled_payables_dre`, aplicada mais tarde no mesmo dia que a `20260716210000` local — os dois nomes de arquivo coexistem, o repo local usa um esquema de numeração próprio que diverge do timestamp de aplicação real). **A migration nova desta phase deve ser numerada ACIMA de `20260716172353`** (ex.: `20260716230000` ou qualquer valor maior, seguindo o padrão local de "YYYYMMDDHHMMSS").

2. **Padrão real de `Pessoal - INSS` em `cash_outflows` (org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, todos os meses 2024-12 a 2027-05):** confirma o caso extremo já antecipado no Pitfall/Code Example — **`competence_date = 2026-04-01` tem DUAS linhas**: `{amount: 1550, status: 'cancelled'}` e `{amount: 2652.31, status: 'paid'}`. Todos os outros meses têm exatamente 1 linha por competência. Isso VALIDA o design do Pattern 1/3 tal como proposto (`GROUP BY category, status` na RPC + `resolveInssReal` somando só `status !== 'cancelled'`) — o caso de abril resolve sozinho para `2652.31` sem nenhum código especial, exatamente como a soma de ICMS/PIS/COFINS já lida com múltiplas linhas por status. **Nenhuma mudança de design necessária**, só confirma que o plano deve incluir um teste explícito cobrindo "múltiplas linhas na mesma competência, uma cancelada e uma paga" (não é hipotético, já aconteceu em prod).

Meses futuros (2026-07 em diante) já têm INSS `pending` recorrente (R$3.852,19, idêntico todo mês) — mesmo padrão de placeholder recorrente do Tiny já documentado para ICMS/PIS/COFINS; não é dado real ainda, só confirma que o mesmo cuidado de UI ("empurrãozinho"/nudge) poderia se aplicar ao INSS no futuro, mas está FORA do escopo desta phase (só a régua de valor + pergunta em aberto do gate).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase MCP (`list_migrations`, `execute_sql`, `pg_get_functiondef`) | Confirmar `max(version)` real em prod + validar shape ao vivo de `cash_outflows` (categoria INSS) | ✗ (não exposto a este agente de pesquisa nesta sessão) | — | Dados de banco usados nesta pesquisa vêm do 98-CONTEXT.md (coletados ao vivo por Wesley/outra sessão com acesso MCP) + inspeção de migrations em disco (`garment-glow-test` + worktree irmão `garment-glow-dre`) |
| `supabase` CLI (`supabase migration list --linked`) | Numerar a migration nova sem colidir | ✗ (sem `SUPABASE_ACCESS_TOKEN` neste ambiente) | — | Máximo encontrado por `ls`/grep local nos dois repos: `20260716210000` (garment-glow-test, aplicada hoje) — **NÃO CONFIRMADO contra prod**, o planner/executor DEVE rodar `list_migrations` via MCP antes de nomear o arquivo |
| psql direto | idem | ✗ (sem credenciais no ambiente) | — | idem |

**Missing dependencies with no fallback:**
- Nenhuma — o fallback (dados já coletados no CONTEXT.md + arquivos de migration em disco, incluindo o worktree irmão) é suficiente para o planner trabalhar, DESDE QUE a primeira task do plano seja uma confirmação via MCP (que o orquestrador/executor têm acesso, diferente deste agente de pesquisa).

**Missing dependencies with fallback:**
- `list_migrations`/`pg_get_functiondef` ao vivo — fallback = dados já verificados nesta pesquisa (RPC molde encontrada em `/root/garment-glow-dre`, RPC 87 lida na íntegra em `supabase/migrations/20260716210000_cancelled_payables_dre.sql`). Recomendo o planner inserir como Task 1 (Wave 0) uma confirmação MCP antes de escrever a migration definitiva.

## Security Domain

`security_enforcement` não está desabilitado em `.planning/config.json` (ausente = habilitado). Esta phase não abre superfície de auth/input nova — é leitura adicional de dado já protegido por RLS existente.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | não | Nenhuma mudança de auth |
| V3 Session Management | não | — |
| V4 Access Control | **sim** | RLS de `cash_outflows` (org-scoped, já anti-IDOR provada nas Phases 87/94/96) + `SECURITY INVOKER` na RPC nova — clonar literalmente o padrão de `get_imposto_guia_by_competence` (`REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated`) |
| V5 Input Validation | sim | `p_org_id uuid`, `p_competence date` — tipos fortes no Postgres, sem input de usuário livre nesta RPC (não há endpoint HTTP novo, só RPC via cliente Supabase autenticado) |
| V6 Cryptography | não | Nenhum dado sensível novo |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR (org A lê dado de org B) | Tampering/Information Disclosure | `SECURITY INVOKER` + RLS de `cash_outflows` já filtra por `organization_id` — a RPC nova deve OBRIGATORIAMENTE usar `SECURITY INVOKER`, nunca `SECURITY DEFINER` (lição já documentada no projeto: `feedback_supabase_security_invoker.md` — DEFINER + org param = IDOR) |
| Bloqueio indevido de fechamento (se o gate for estendido) | Denial of Service (funcional, não segurança clássica) | Fail-closed é a política já adotada (`gaps === null` bloqueia) — se o gate de INSS for implementado, seguir o mesmo fail-closed, nunca fail-open |

## Sources

### Primary (HIGH confidence — lidos diretamente nesta sessão)
- `src/lib/dreRegime.ts` — resolver, `monthPlusOne`, `IMPOSTO_VENDA_CATEGORIES`, `resolveDreRegime`
- `src/hooks/useImpostoGuiaReal.ts` — hooks `useImpostoGuiaReal`/`useImpostoGuiaNudge`
- `src/lib/dreCascade.ts` + `src/lib/dreCascade.test.ts` — `buildDreCascade`, describe do C11 (linhas 153-208)
- `src/lib/dreCloseGate.ts` + `src/lib/dreCloseGate.test.ts` — `canApurarImposto`, `resolveCloseGate`
- `src/hooks/useDreOperational.ts` — hook da RPC 87
- `src/hooks/useCmvCheioGate.ts` — gate C6
- `src/pages/MercadoLivre.tsx` (linhas ~240-440) — orquestração completa
- `supabase/migrations/20260716210000_cancelled_payables_dre.sql` — definição VIVA e completa de `get_dre_operational_by_competence` (RPC 87), incluindo o mapa categoria→bloco com `Pessoal - INSS` em `pessoal`
- `supabase/migrations/20260715221559_dre_cancelled_revenue_and_nao_classificado.sql` — `get_cancelled_revenue` e `dre_bloco_for_category` (confirma padrão "RPC pequena e dedicada", nenhuma generalização por lista de categorias)
- `/root/garment-glow-dre/supabase/migrations/20260690000000_get_imposto_guia_by_competence.sql` — definição REAL da RPC molde (não está no repo `garment-glow-test`, drift confirmado)
- `supabase/functions/sync-tiny-payables/index.ts` (`normalizeSituacao`) — confirma que a normalização `pending/paid/cancelled` é agnóstica de categoria, mesma pipeline pra INSS e impostos de venda
- `.planning/phases/98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu/98-CONTEXT.md` — decisão travada do Wesley + dados reais do banco (coletados ao vivo em outra sessão com acesso MCP)
- `.planning/phases/96-dre-corre-es-da-revis-o-linha-a-linha-c1-c9-c11-fechar-a-dre/96-RESEARCH.md` e `96-02-PLAN.md` — origem e razão de ser do C11 (trava que esta phase precisa reabrir)

### Secondary (MEDIUM confidence)
- `.planning/config.json` — `nyquist_validation: false` (seção Validation Architecture omitida), `security_enforcement` ausente (tratado como habilitado)

### Tertiary (LOW confidence — não verificado ao vivo nesta sessão)
- Padrão exato de linhas de `Pessoal - INSS` em `cash_outflows` para TODOS os meses (só março/abril foram reportados no CONTEXT.md; não há confirmação MCP nesta sessão de que o padrão é sempre 1 linha por status por competência, ou se em algum mês existem múltiplas linhas com valores diferentes na mesma competência+status, como a 2ª linha "Guia INSS" de R$2.652,31 ainda não classificada mencionada no CONTEXT — que por definição não vai aparecer no `GROUP BY category, status` até ser categorizada)
- Confirmação de que `max(version)` de migrations em prod bate com `20260716210000` (só verificado localmente via `ls`, não via `list_migrations` MCP)

## Metadata

**Confidence breakdown:**
- Standard stack / arquitetura a clonar: HIGH — todos os arquivos-molde lidos por completo, inclusive o "drift" (RPC molde encontrada na íntegra no worktree irmão)
- Blast radius: HIGH — grep completo de todos os consumidores de `useDreOperational`, `dreCascade`, `Pessoal - INSS`, `IMPOSTO_VENDA_CATEGORIES`
- Pitfall do C11 (testes vão quebrar de propósito): HIGH — lido literalmente no describe + no 96-RESEARCH.md original
- Estado vivo do banco (padrão real das linhas de INSS por mês): LOW — depende inteiramente do que já foi reportado no CONTEXT.md; esta sessão de pesquisa não teve acesso a MCP Supabase nem a credenciais de CLI/psql

**Research date:** 2026-07-16
**Valid until:** 7 dias (domínio DRE deste projeto está em mudança ativa — Phases 94/96/97 todas na mesma semana; RPCs e migrations podem já ter mudado por sessões paralelas)

## RESEARCH COMPLETE
