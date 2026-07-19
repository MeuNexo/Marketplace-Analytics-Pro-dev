# Phase 101: Detalhamento de MCO e recomendação de margem na página /analise-precos - Research

**Researched:** 2026-07-19
**Domain:** Internal feature extension (no new tech stack) — React/TypeScript frontend card + small Supabase config table, on top of existing `/analise-precos` (Phases 77/79/81/82).
**Confidence:** HIGH — every claim below is verified by reading the actual source files in this repo (not training data / not web search). This phase touches zero external services and needs zero new npm packages.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Card fixo (sempre visível, não é tooltip/hover) posicionado abaixo do gráfico existente, para o anúncio + variação atualmente selecionados no seletor.
- **D-02:** Granularidade do waterfall = **por unidade, média do período selecionado** (mesmo período dos KPIs/filtro de data já existentes na página) — receita/un, CMV/un, comissão/un, frete/un, impostos/un, MC/un, ads/un, MCO/un. Não é o total do período (isso já está nos KPIs do topo).
- **D-03:** O tooltip existente do gráfico (Phase 79) permanece como está — o card novo é adicional, não substitui o tooltip.
- **D-04:** Faixa PADRÃO = reusar `MCO_SAUDAVEL_PCT` de `src/lib/mcoHealth.ts` (🔴≤5% 🟡6-8% 🟢≥9%), a mesma da Phase 83 — zero divergência entre páginas.
- **D-05:** Além do padrão, permitir **meta de MCO% customizada por item_id**, configurável **direto na `/analise-precos`** (não em `/precos-custos` nem outra página) — um campo editável no card de detalhamento (ex: input "Meta MCO%: [12]"), persistido por SKU/item_id no backend. Quando não há meta customizada definida, usa o padrão (D-04) como referência.
- **D-06 (planner/researcher decide o mecanismo exato de persistência):** precisa de alguma forma de guardar a meta por `item_id` (nova coluna/tabela pequena, escopo da org). Não há tabela existente para isso — pesquisar o padrão mais simples e consistente com o resto do schema.
- **D-07:** Quando a página calcula a recomendação, ela mostra **as duas alavancas simultaneamente**: (a) preço mínimo de venda necessário para atingir a meta (mesmo cálculo de "preço de equilíbrio" que fizemos manualmente na conversa: `preço = (cmv_unit + frete_unit + ads_unit) / (1 - taxa_comissão - taxa_imposto)`, generalizado para a meta MCO% em vez de MCO=0), e (b) o ACOS-alvo que a campanha precisaria ter para atingir a meta mantendo o preço atual.
- **D-08:** A recomendação (ambas alavancas) fica **sempre visível** no card — não é condicional a estar abaixo da meta.

### Claude's Discretion

- Layout exato do card (grid de linhas do waterfall, onde entram os dois números de recomendação dentro do card).
- Texto/copy exato dos rótulos e tooltips auxiliares do card novo.
- Detalhes visuais (cores, tokens) — seguir a paleta CVD-safe já validada (skill `dataviz`) e os tokens do projeto (`--success`, `--warning`, `--destructive`, `--kpi-*`).
- Mecanismo exato de persistência da meta customizada por item_id (nome da tabela/coluna, RPC vs REST direto) — pesquisar antes de planejar. **→ resolvido abaixo, ver "Standard Stack" e "Code Examples".**
- Comportamento quando `custo_unit` está ausente para o item (seguir o padrão já estabelecido nas Phases 79-83: nunca inventar número, mostrar aviso "custo ausente").

### Deferred Ideas (OUT OF SCOPE)

- Comparação lado a lado entre múltiplos itens (ex: Pistola vs Carabina na mesma tela) — usuário optou por manter escopo single-item nesta phase; pode virar phase futura se a necessidade aparecer de novo.
- Faixas de saúde diferentes por categoria de produto (em vez de uma faixa global) — usuário decidiu manter a faixa global do `mcoHealth.ts`, só a meta numérica é customizável por item.
- Configuração da meta customizada em `/precos-custos` em vez de `/analise-precos` — descartado, mas anotado caso a UX evolua para centralizar configs de produto lá no futuro.
</user_constraints>

<phase_requirements>
## Phase Requirements

Nenhum REQ-ID formal foi atribuído a esta phase (não existe entrada em REQUIREMENTS.md — o milestone v8.0 é sobre o Consultor v2/Inteligência; esta phase é uma extensão de UX de `/analise-precos` fora dessa trilha, decidida via `/gsd-discuss-phase`). Os requisitos operacionais desta phase são as decisões D-01..D-08 do CONTEXT.md acima; o planner deve tratá-las como a fonte de verdade de escopo.
</phase_requirements>

## Summary

Esta phase é 100% aditiva sobre código já em produção (Phases 77-82, 90-96 style). Não há stack novo: React 18 + TypeScript + shadcn/ui + Recharts (já usados na própria página) e Supabase (tabela + RLS, sem edge function nova). A pesquisa localizou, com alta confiança, os três blocos que a phase precisa e onde cada um se encaixa:

1. **Persistência da meta customizada (D-06):** o analog mais próximo e mais simples no schema é `ml_product_costs` (tabela per-item_id, escopo org, RLS org-first owner/admin/member-write) — não uma RPC. Recomenda-se uma tabela nova e pequena, ex. `ml_mco_targets`, com o mesmo padrão de RLS, sem RPC (leitura/escrita via `supabase.from(...)` direto, exatamente como `useMLProductCosts.ts` já faz). Nenhum SECURITY DEFINER, nenhuma superfície de IDOR nova.

2. **Dados do waterfall (D-02):** o util puro `src/lib/precoMcoSeries.ts` já calcula tudo por bucket (`McoSeriesPoint`: `cmvUnit`, `comissaoUnit`, `freteUnit`, `adsUnit`, `impostoUnit`, `precoUnit`, `mco`, `mcoPct`), mas a agregação do período inteiro (`computePriceKpis`) hoje só devolve os totais/médias gerais — **não** devolve o breakdown por componente já dividido por unidade para o período todo. Essa é a única peça de cálculo que falta: uma pequena extensão pura (mesmo arquivo, mesmo padrão zero-I/O) que resume `rows` + `adsDaily` em um único ponto "waterfall do período" com os 8 campos do D-02.

3. **As duas alavancas de recomendação (D-07):** a álgebra generalizada de "preço mínimo para meta X%" **já existe, testada e em produção** em `src/lib/pricing/calculator.ts` (`reversePrice`, criada na Phase 50 para o Simulador de Precificação) — é literalmente a mesma fórmula que o Wesley descreveu manualmente na conversa. O "ACOS-alvo" não precisa de nenhuma função nova: é álgebra de uma linha derivada do playbook de ads já existente no repo (`break_even.md`: *"break-even ACoS = 100 × margem [antes de ads]"*), generalizada para `ACOS_meta = MC%_antes_de_ads − meta%`.

**Primary recommendation:** Não reinventar nenhuma fórmula. (1) Nova tabela `ml_mco_targets` clonando a RLS de `ml_product_costs`; (2) nova função pura `computeWaterfallCard(rows, opts)` em `precoMcoSeries.ts` (TDD RED/GREEN, como todo o resto do arquivo); (3) chamar `reversePrice()` de `src/lib/pricing/calculator.ts` para a alavanca de preço, e uma fórmula de 1 linha (`mcBeforeAdsPct - metaPct`) para a alavanca de ACOS; (4) UI = `InlineEditCell`-style (já existe em `MLAnuncios.tsx`) para o campo de meta editável — sem debounce, sem lib nova.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cálculo do waterfall por unidade (médias do período) | Browser/Client (util puro TS) | API/Backend (RPC `orders_price_timeseries` já existe) | A RPC já entrega os componentes agregados por bucket; a divisão em "por unidade, período inteiro" é lógica de apresentação pura — mesmo padrão de `computePriceKpis`/`computePrecoMcoSeries`, sem novo round-trip ao banco. |
| Persistência da meta MCO% customizada por item | Database/Storage (tabela + RLS) | Browser/Client (upsert direto via supabase-js) | Configuração leve, por org, sem necessidade de lógica de servidor (nenhum cálculo acontece no insert) — mesmo padrão de `ml_product_costs`/`replenishment_params`: tabela simples, sem Edge Function, sem RPC. |
| Cálculo de preço mínimo / ACOS-alvo | Browser/Client (util puro TS) | — | Álgebra determinística sobre dados já carregados no client (nenhum novo fetch); `reversePrice` já roda 100% client-side no Simulador (Phase 50). |
| Semáforo de saúde (cores) | Browser/Client (`mcoHealth.ts`) | — | Já é client-side puro; esta phase só reusa, não adiciona camada nova. |
| Renderização do card | Browser/Client (React, dentro de `PrecoPraticadoReport.tsx`) | — | Mesmo componente que já hospeda gráfico/KPIs/tooltip desta página. |

## Standard Stack

Nenhuma dependência nova. A tabela abaixo documenta apenas o que já está em uso e será reaproveitado (todas as versões conforme `package.json`, sem necessidade de `npm view` — não há instalação nesta phase).

### Core (já em uso, reaproveitado sem mudança)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI do card novo | Já é o framework do componente-pai `PrecoPraticadoReport.tsx` |
| @supabase/supabase-js | 2.98.0 | Leitura/escrita da tabela de meta | Mesmo client já usado em `useMLProductCosts.ts` |
| recharts | 2.15.4 | (nenhum gráfico novo previsto no card — apenas linhas de texto/valor) | N/A — o card é textual/tabular, não um gráfico |
| shadcn/ui (Card, Badge, Input, Tooltip) | via components.json | Layout do card, badge de semáforo, input de meta | Mesmos primitivos já usados na página |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 1.7.0 | Ícones do card (ex. `Percent`, `TrendingUp`, já importados na página) | Consistência visual com KPICards existentes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tabela simples `ml_mco_targets` + upsert direto (recomendado) | RPC dedicada `set_mco_target(item_id, sku, pct)` | RPC adicionaria uma camada sem necessidade real — nem `ml_product_costs` nem `replenishment_params` (os dois analogs mais próximos) usam RPC para escrita simples; RLS na tabela já basta. Só se justificaria se houvesse lógica de validação server-side complexa, o que não é o caso (validação de faixa numérica é trivial e pode ficar no CHECK constraint). |
| Derivar `taxa_comissão`/`taxa_imposto` das médias observadas no próprio período (recomendado) | Buscar `commissionPct` ao vivo na API do ML (`ml-precos-custos` mode `costs`) + `ml_tax_config.effective_rate` via `computeOrderTaxRate` | O Simulador (Phase 50) faz isso porque simula um preço HIPOTÉTICO ainda não praticado. Aqui o card já está mostrando dados HISTÓRICOS reais do próprio item/período — usar as taxas implícitas nos dados já carregados (`comissaoUnit/precoUnit`, `impostoUnit/precoUnit`) evita 1-2 fetches extras e mantém 100% de consistência com os números que o próprio card mostra (comissão R$X = comissão %Y do mesmo período). Ver Pitfall 2 abaixo sobre por que isso é preferível. |
| `InlineEditCell` (já existe em `MLAnuncios.tsx`, padrão onBlur+Enter, sem debounce) | Adicionar `use-debounce`/lodash.debounce para salvar a cada tecla | Não há nenhuma lib de debounce no `package.json` hoje; o próprio TUNE-03 (Phase 56, preview ao vivo de limiares) ainda não foi implementado, então não existe precedente de debounce-por-tecla no repo. Onblur/Enter é o padrão estabelecido e é suficiente para "editar uma meta % ocasionalmente". |

**Installation:** nenhuma — sem `npm install` nesta phase.

## Package Legitimacy Audit

**N/A — esta phase não instala nenhum pacote externo.** Toda a implementação usa dependências já presentes no `package.json` e uma migration Supabase (schema, não pacote). Nenhuma tabela abaixo é necessária.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  /analise-precos → MLAnalisePrecos.tsx → PrecoPraticadoReport.tsx    │
│  (estado já existente: selectedId, selectedSku, fromDate/toDate)     │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │                                     │
                ▼                                     ▼
   ┌─────────────────────────┐          ┌──────────────────────────────┐
   │ RPC orders_price_timeseries│        │ Tabela ml_mco_targets (nova)  │
   │ (já existe — rows agregadas│        │ organization_id, item_id, sku │
   │  por bucket: cmv/comissao/ │        │ target_mco_pct                │
   │  frete/impostos/qtd)       │        │ RLS org-first (clona          │
   │ + ml_ads_products_cache    │        │ ml_product_costs)             │
   │  (spend diário — já busca- │        └───────────┬───────────────────┘
   │  do pelo componente)       │                    │ SELECT ao montar
   └───────────┬────────────────┘                    │ UPSERT ao editar
               │ rows, adsDaily                       │ (sem RPC, direto)
               ▼                                      │
   ┌─────────────────────────────────────┐            │
   │ precoMcoSeries.ts (util puro)        │            │
   │  computePrecoMcoSeries() — já existe  │            │
   │  ⭐ NOVO: computeWaterfallCard()      │◄───────────┘
   │  agrega rows+adsDaily → 1 ponto:      │  targetPct (customizado ou
   │  {precoUnit,cmvUnit,comissaoUnit,     │   MCO_SAUDAVEL_PCT default)
   │   freteUnit,adsUnit,impostoUnit,      │
   │   mcoUnit,mcoPct,custoAusente,...}    │
   └───────────┬───────────────────────────┘
               │
               ▼
   ┌─────────────────────────────────────────────────────┐
   │ mcoHealth.ts (já existe) → classifyMcoHealth(target)  │
   │ pricing/calculator.ts (já existe) → reversePrice()    │
   │   mode="margin", target=targetPct                     │
   │   → preço mínimo recomendado                          │
   │ 1 linha nova: ACOS_meta = mcBeforeAdsPct - targetPct   │
   └───────────┬───────────────────────────────────────────┘
               │
               ▼
   ┌─────────────────────────────────────────────────────┐
   │ Card fixo novo (dentro de PrecoPraticadoReport.tsx)   │
   │  - waterfall receita→CMV→comissão→frete→impostos→     │
   │    MC→ads→MCO (linhas R$ + %, estilo ChartTooltip.Row)│
   │  - badge semáforo (mcoHealthRole)                      │
   │  - input "Meta MCO%: [x]" (InlineEditCell-style)       │
   │  - "Preço mínimo recomendado: R$ Y" (sempre visível)   │
   │  - "ACOS-alvo da campanha: Z%" (sempre visível)        │
   └─────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── lib/
│   ├── precoMcoSeries.ts        # ESTENDER: + computeWaterfallCard() (novo, puro)
│   ├── mco.ts                   # intocado — fonte da fórmula MCO
│   ├── mcoHealth.ts             # intocado — reusar classifyMcoHealth/mcoHealthRole
│   └── pricing/
│       └── calculator.ts        # intocado — reusar reversePrice()
├── hooks/
│   └── useMcoTargets.ts         # NOVO — espelha useMLProductCosts.ts (fetch por org + upsert por item_id/sku)
├── components/mercadolivre/anuncios/
│   └── PrecoPraticadoReport.tsx # ESTENDER: novo card fixo abaixo do histograma
supabase/migrations/
└── 202607XXXXXXXX_ml_mco_targets.sql   # NOVO — tabela + RLS (clona ml_product_costs)
```

### Pattern 1: Tabela de config per-item_id, org-scoped, sem RPC
**What:** tabela simples com `organization_id + item_id (+ sku opcional)` e uma coluna de valor, RLS org-first (SELECT para todos os membros, escrita para owner/admin/member), upsert direto do client via `supabase.from(table).upsert(...)`.
**When to use:** quando o valor é uma configuração de negócio simples (não precisa de cálculo/validação complexa no servidor) e a leitura precisa ser rápida e cacheável no client.
**Example (analog real, `ml_product_costs`, intocado nesta phase — só como modelo):**
```sql
-- Source: supabase/migrations/20260514120000_ml_product_costs.sql (+ 20260614120000 tenant01)
CREATE TABLE public.ml_product_costs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  seller_sku text DEFAULT NULL,
  cost numeric(12,2) DEFAULT NULL,
  tax_rate numeric(6,4) DEFAULT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ml_product_costs_unique UNIQUE (user_id, item_id)
);
-- RLS: mpc_select (qualquer membro lê), mpc_insert/update/delete
-- (owner, admin, member — NÃO viewer), todas com
-- `organization_id IS NOT NULL AND is_org_member/get_org_role(...)`.
```
**Recomendação para `ml_mco_targets` (nova, D-06):**
```sql
CREATE TABLE public.ml_mco_targets (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id         text        NOT NULL,
  -- sentinela '' = meta do anúncio inteiro (sem variação selecionada) — mesmo
  -- padrão de replenishment_params.scope_value (NUNCA usar NULL: Postgres trata
  -- NULL como distinto em UNIQUE, permitindo duplicatas silenciosas).
  sku             text        NOT NULL DEFAULT '',
  target_mco_pct  numeric(5,2) NOT NULL CHECK (target_mco_pct > 0 AND target_mco_pct <= 100),
  updated_by      uuid        NULL,  -- auditoria (quem editou), não usado em RLS
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ml_mco_targets_org_item_sku_unique UNIQUE (organization_id, item_id, sku)
);
-- RLS: clonar mpc_select/mpc_insert/mpc_update/mpc_delete de ml_product_costs
-- 1:1 (mesma allowlist owner/admin/member para escrita, todos os membros para leitura).
```

### Pattern 2: Extensão pura de série agregada (mesmo arquivo, TDD)
**What:** `precoMcoSeries.ts` já agrega `rows: PrecoSeriesRow[]` + `adsDaily` em pontos por bucket (`computePrecoMcoSeries`) e em KPIs do período (`computePriceKpis` — mas sem breakdown por componente). Falta uma terceira função irmã que produz o "1 ponto = card do waterfall" com os 8 campos por unidade do D-02.
**When to use:** sempre que o card precisar renderizar valores "por unidade, média do período" — nunca duplicar a soma/divisão inline no componente (mesma lição já aplicada em `computeMco`/`computePrecoMcoSeries`/`computePriceKpis`).
**Example (a escrever, mesmo estilo das funções vizinhas no arquivo):**
```typescript
// Source: padrão de src/lib/precoMcoSeries.ts (computePriceKpis, linha ~201)
export interface WaterfallCard {
  precoUnit: number; cmvUnit: number; comissaoUnit: number; freteUnit: number;
  adsUnit: number; impostoUnit: number; mcUnit: number; /* antes de ads */
  mcoUnit: number; mcoPct: number | null; mcBeforeAdsPct: number | null;
  custoAusente: boolean; impostoAusente: boolean;
}

export function computeWaterfallCard(
  rows: PrecoSeriesRow[],
  opts: ComputePrecoMcoSeriesOpts,
): WaterfallCard {
  const serie = computePrecoMcoSeries(rows, opts);
  const adsTotal = serie.reduce((s, p) => s + p.ads, 0);
  const qtd = rows.reduce((s, r) => s + r.qtd, 0);
  const receita = rows.reduce((s, r) => s + r.total, 0);
  const cmv = rows.reduce((s, r) => s + r.cmv, 0);
  const comissao = rows.reduce((s, r) => s + r.comissao, 0);
  const frete = rows.reduce((s, r) => s + r.frete, 0);
  const impostos = rows.reduce((s, r) => s + r.impostos, 0);

  const { mco, pct } = computeMco({
    grossRevenue: receita, cmv, platformCost: comissao + frete, ads: adsTotal, tax: impostos,
  });

  const precoUnit = qtd > 0 ? receita / qtd : 0;
  const mcBeforeAdsUnit = qtd > 0 ? (receita - cmv - comissao - frete - impostos) / qtd : 0;

  return {
    precoUnit,
    cmvUnit: qtd > 0 ? cmv / qtd : 0,
    comissaoUnit: qtd > 0 ? comissao / qtd : 0,
    freteUnit: qtd > 0 ? frete / qtd : 0,
    adsUnit: qtd > 0 ? adsTotal / qtd : 0,
    impostoUnit: qtd > 0 ? impostos / qtd : 0,
    mcUnit: mcBeforeAdsUnit,
    mcoUnit: qtd > 0 ? mco / qtd : 0,
    mcoPct: pct,
    mcBeforeAdsPct: precoUnit > 0 ? (mcBeforeAdsUnit / precoUnit) * 100 : null,
    custoAusente: rows.some((r) => r.qtd_sem_custo > 0),
    impostoAusente: rows.some((r) => r.qtd_sem_imposto > 0),
  };
}
```
*(Nomes/campos ilustrativos — o planner decide a interface exata; o ponto arquitetural que importa é: reusar `computeMco` + as mesmas somas já feitas por `computePriceKpis`, não recalcular do zero.)*

### Pattern 3: As duas alavancas de recomendação — reusar, não recriar
**What:** `reversePrice()` de `src/lib/pricing/calculator.ts` já resolve algebricamente "que preço eu preciso cobrar para bater uma margem-alvo %", em produção desde a Phase 50 (Simulador de Precificação).
**Fórmula exata (fonte: `reversePrice`, `mode="margin"`):**
```
proportional = commissionPct + taxPct   (+ difal/extras, não usados aqui)
fixed        = shippingCost (+ fixedFee, extras — não usados aqui)
denom        = 1 - (proportional + target) / 100
preco_min    = denom > 0 ? (cost + fixed) / denom : null   // null = meta inatingível
```
**Mapeamento para o card desta phase (D-07, alavanca a — preço mínimo):**
```typescript
// Source: src/lib/pricing/calculator.ts (reversePrice) + WaterfallCard (Pattern 2)
const NO_EXTRA = { enabled: false, mode: "percent" as const, value: 0 };

const commissionPct = card.precoUnit > 0 ? (card.comissaoUnit / card.precoUnit) * 100 : 0;
const taxPct        = card.precoUnit > 0 ? (card.impostoUnit  / card.precoUnit) * 100 : 0;

const precoMinimo = reversePrice(
  {
    cost: card.cmvUnit,
    commissionPct,
    fixedFee: 0,
    shippingCost: card.freteUnit + card.adsUnit, // ads tratado como custo fixo/un (mesma lógica de breakevenUnit)
    taxPct,
    difalEnabled: false, difalPct: 0,
    rebate: NO_EXTRA, cupom: NO_EXTRA, afiliado: NO_EXTRA, promo: NO_EXTRA,
  },
  targetMcoPct,   // meta (customizada ou default da faixa)
  "margin",
);
// null → "meta impraticável com os custos atuais deste item" (não inventar número)
```
**Alavanca b — ACOS-alvo (não precisa de função nova, é 1 linha, alinhada ao playbook já existente):**
```typescript
// Source: supabase/functions/nexo-chat/playbooks.ts, ads/playbooks/break_even.md
// "ACoS só é caro se > break-even ACoS (= 100 × margem [antes de ads])."
// Generalização para meta (em vez de break-even puro, que é meta=0):
const acosMeta = card.mcBeforeAdsPct != null ? card.mcBeforeAdsPct - targetMcoPct : null;
// acosMeta <= 0 → "meta inatingível mesmo sem gastar em ads" (não sugerir ACOS negativo)
```

### Anti-Patterns to Avoid
- **Reusar `breakevenUnit` do gráfico (Phase 79) como "preço mínimo recomendado":** `breakevenUnit` em `computePrecoMcoSeries` é a soma literal de custos observados NAQUELE bucket (`cmv+comissao+frete+ads+impostos`), calculado a partir do preço JÁ PRATICADO — é uma linha de referência histórica, não uma solução algébrica para "que preço eu deveria cobrar". Se o preço mudar, comissão e imposto (proporcionais à receita) também mudam — `breakevenUnit` não captura isso. Usar `reversePrice()` (que trata comissão/imposto como taxas %, e cmv/frete/ads como R$ fixos) é a forma correta de responder "qual preço mínimo" — ver Pitfall 1.
- **Escrever uma RPC nova só para persistir a meta:** nenhum dos dois analogs mais próximos (`ml_product_costs`, `replenishment_params`) usa RPC para escrita simples de configuração — ambos usam tabela + RLS + upsert direto. Adicionar RPC aqui seria complexidade sem ganho.
- **Usar `NULL` como sentinela de "sem variação" na tabela de meta:** Postgres trata `NULL` como distinto em `UNIQUE` — duas linhas com `item_id` igual e `sku=NULL` NÃO conflitam, permitindo duplicatas silenciosas. Usar `''` (mesmo padrão de `replenishment_params.scope_value`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fórmula de MCO / componentes de custo | Nova função de decomposição | `computeMco` (`src/lib/mco.ts`) + `computePrecoMcoSeries`/nova `computeWaterfallCard` (`precoMcoSeries.ts`) | Fonte única da fórmula (fora de escopo mudar, per CONTEXT.md) — qualquer duplicação gera divergência entre páginas (já aconteceu e foi corrigido nas Phases 83/96). |
| Semáforo de saúde MCO% | Novos limiares hardcoded no componente | `MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole` (`mcoHealth.ts`) | D-04 travado — zero divergência entre `/produtos-vendidos` e `/analise-precos`. |
| Álgebra "preço para bater margem-alvo" | Reimplementar a fórmula de break-even generalizada | `reversePrice()` (`src/lib/pricing/calculator.ts`) | Já testada em produção (Simulador, Phase 50); é literalmente a mesma fórmula do D-07. Reimplementar arrisca uma sutil divergência de sinal/denominador (ex.: esquecer que ads não é % de receita). |
| Campo numérico editável persistido | Novo componente de input com debounce/save custom | `InlineEditCell` (`src/pages/mercadolivre/MLAnuncios.tsx`, padrão onBlur+Enter) | Já existe, já testado visualmente em produção, evita introduzir um novo padrão de "salvar a cada tecla" que não existe em nenhum outro lugar do repo. |
| Persistência de config por item/org | Nova arquitetura de tabela | Clonar `ml_product_costs` (RLS org-first, sem RPC) | Padrão já auditado (Phase 43 TENANT-01, anti-IDOR provado) — reduz risco de RLS mal configurada numa tabela nova. |

**Key insight:** esta phase não tem NENHUM problema de domínio novo — é 100% recombinação de peças já existentes e já provadas em produção (`computeMco`, `mcoHealth`, `reversePrice`, `ml_product_costs`-style RLS, `InlineEditCell`). O único código genuinamente novo é (1) a tabela `ml_mco_targets` e (2) a função pura que agrega "por unidade, período inteiro" — tudo o mais é composição.

## Common Pitfalls

### Pitfall 1: Confundir `breakevenUnit` (histórico) com "preço mínimo recomendado" (algébrico)
**What goes wrong:** o gráfico existente (Phase 79) já mostra uma linha `breakevenUnit = (cmv+comissao+frete+ads+impostos)/qtd` — é tentador reusar esse mesmo número como a "alavanca (a)" do D-07. Mas esse valor é uma soma de R$ observados NO preço que já foi praticado, não a solução de "que preço eu deveria cobrar para atingir X% de MCO". Comissão ML e imposto (regime real) são proporcionais ao preço de venda — se o preço mudar, esses dois componentes mudam junto, e `breakevenUnit` não modela isso.
**Why it happens:** os dois números ("break-even histórico" e "preço mínimo algébrico") coincidem quando a meta é exatamente 0% E o preço não muda — daí a ilusão de que são a mesma coisa.
**How to avoid:** usar `reversePrice()` (Pattern 3) para a alavanca (a), que trata `commissionPct`/`taxPct` como taxas e resolve a equação; usar `breakevenUnit` apenas onde já está (o gráfico/tooltip, D-03 preservado sem mudança).
**Warning signs:** se o "preço mínimo recomendado" do card novo bater exatamente com `d.breakevenUnit` do tooltip quando a meta customizada ≠ 0, é sinal de que a fórmula errada foi usada.

### Pitfall 2: `reversePrice` retorna `null` (ou é inválido) para `target <= 0`
**What goes wrong:** a implementação atual de `reversePrice` tem um guard `if (target <= 0) return null;` logo no início — ou seja, não aceita meta exatamente 0% (break-even puro) nem meta negativa. Isso é inofensivo enquanto a meta customizada e os cortes do semáforo (`MCO_SAUDAVEL_PCT`: 5/9) forem sempre > 0 (o que é o caso hoje — inclusive o `CHECK (target_mco_pct > 0)` recomendado na tabela nova já impede meta 0/negativa no cadastro), mas deve ser um guard explícito no planner: se algum fluxo futuro tentar chamar com meta=0, vai silenciosamente virar "meta impraticável" em vez de calcular o break-even de fato.
**Why it happens:** `reversePrice` foi desenhada para o Simulador, onde meta=0 não faz sentido de negócio (ninguém simula "quero vender no zero a zero"). Reusar a função fora desse contexto original pode expor esse edge case.
**How to avoid:** manter o `CHECK (target_mco_pct > 0)` na tabela + validação de input no card (não deixar o usuário digitar 0 ou negativo); documentar a decisão no plano.
**Warning signs:** card mostrando "meta impraticável" para uma meta customizada pequena mas positiva (ex. 1%) quando na verdade deveria calcular um preço bem baixo.

### Pitfall 3: Derivar `commissionPct`/`taxPct` de um período com poucas vendas gera taxa instável
**What goes wrong:** `commissionPct = comissaoUnit/precoUnit * 100` e `taxPct = impostoUnit/precoUnit * 100` são derivados dos R$ observados no período selecionado. Se o período tiver poucas unidades vendidas (ou nenhuma), essas taxas ficam com denominador pequeno/zero e a recomendação fica ruidosa ou "—".
**Why it happens:** o card reflete "média do período selecionado" (D-02) — um período muito curto (ex. 1 dia com 1 venda) não é uma amostra confiável de taxa de comissão/imposto (a categoria pode ter taxa fixa por ML, mas o imposto por UF varia por pedido).
**How to avoid:** exibir o aviso já padronizado do restante da página quando `custoAusente`/`impostoAusente` (mesmo padrão dos avisos existentes em `PrecoPraticadoReport.tsx`, linhas 822-838); considerar (Claude's Discretion) exigir um mínimo de unidades no período para mostrar a recomendação com confiança, análogo ao `MIN_DIAS_CONFIANCA` já usado no histograma de faixas (`precoFaixas.ts`).
**Warning signs:** preço mínimo recomendado oscilando de forma extrema ao trocar o período de 7 para 30 dias.

### Pitfall 4: `NULL` como valor de `sku` na tabela de meta permite duplicatas silenciosas
**What goes wrong:** se a coluna `sku` aceitar `NULL` (em vez do sentinela `''`), duas linhas idênticas em `organization_id + item_id` com `sku=NULL` NÃO violam o `UNIQUE` (regra do Postgres: `NULL` nunca é igual a `NULL` em constraints), permitindo dois upserts "concorrentes" criarem duas linhas em vez de uma atualizar a outra.
**Why it happens:** é o comportameto padrão do SQL, fácil de esquecer ao desenhar a tabela.
**How to avoid:** seguir o mesmo padrão já usado em `replenishment_params.scope_value` (`NOT NULL DEFAULT ''`), e sempre normalizar no client: `selectedSku ?? ''` antes de ler/escrever.
**Warning signs:** query `SELECT * FROM ml_mco_targets WHERE item_id=... ` retornando mais de 1 linha para o mesmo `item_id` sem variação.

## Code Examples

### Extraindo o `Row` do tooltip para reuso no card novo
O componente `ChartTooltip` em `PrecoPraticadoReport.tsx` já define um sub-componente local `Row` (linhas 117-136) com exatamente o formato "label + valor colorido + dotColor" que o waterfall do card novo precisa. Ele **não é exportado** hoje (é interno a `ChartTooltip`). Como o card novo entra no MESMO arquivo (mesmo módulo), a opção mais simples é mover `Row` para escopo do módulo (fora de `ChartTooltip`) e reusá-lo nos dois lugares — evita duplicar o JSX de formatação linha a linha.

```typescript
// Source: src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx, linhas 117-136
// (hoje interno a ChartTooltip — mover para module scope para reuso no card novo)
const Row = ({ k, v, accent, danger, muted, dotColor }: {
  k: string; v: string; accent?: boolean; danger?: boolean; muted?: boolean; dotColor?: string;
}) => (
  <p className={cn("flex justify-between gap-6", muted && "text-[10px]")}>
    <span className="text-muted-foreground flex items-center gap-1.5">
      {dotColor && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />}
      {k}
    </span>
    <span className={cn("font-semibold tabular-nums", accent && "text-success", danger && "text-destructive", muted && "font-normal text-muted-foreground")}>
      {v}
    </span>
  </p>
);
```

### Hook de persistência (`useMcoTargets`), espelhando `useMLProductCosts.ts` 1:1
```typescript
// Source: padrão de src/hooks/useMLProductCosts.ts (fetchAll + upsert otimista)
export function useMcoTargets() {
  const { currentOrg } = useOrganization();
  const { user } = useAuth();
  const [targets, setTargets] = useState<Map<string, number>>(new Map()); // key = `${item_id}::${sku||''}`

  const keyOf = (itemId: string, sku: string | null) => `${itemId}::${sku ?? ""}`;

  const fetchAll = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase
      .from("ml_mco_targets")
      .select("item_id, sku, target_mco_pct")
      .eq("organization_id", currentOrg.id)
      .limit(10000);
    if (error) { console.warn("useMcoTargets fetch error", error); return; }
    const map = new Map<string, number>();
    for (const row of data ?? []) map.set(keyOf(row.item_id, row.sku || null), Number(row.target_mco_pct));
    setTargets(map);
  }, [currentOrg]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const upsert = useCallback(async (itemId: string, sku: string | null, pct: number) => {
    if (!currentOrg?.id) return;
    setTargets((prev) => new Map(prev).set(keyOf(itemId, sku), pct)); // otimista
    const { error } = await supabase.from("ml_mco_targets").upsert(
      { organization_id: currentOrg.id, item_id: itemId, sku: sku ?? "", target_mco_pct: pct, updated_by: user?.id ?? null },
      { onConflict: "organization_id,item_id,sku" },
    );
    if (error) console.warn("useMcoTargets upsert error", error);
  }, [currentOrg, user]);

  return { targets, keyOf, upsert, refetch: fetchAll };
}
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Comissão ML e imposto (regime real) são proporcionais à receita (% do preço), permitindo derivar `commissionPct`/`taxPct` como `comissaoUnit/precoUnit` e `impostoUnit/precoUnit` a partir dos dados históricos do período. | Standard Stack (Alternatives), Pattern 3, Pitfall 3 | Se a comissão ML tiver uma parte fixa relevante (taxa fixa por categoria, hoje só usada no Simulador via `fixedFee`) ou se algum regime tributário tiver componente fixo em R$ (não observado no schema atual de `ml_tax_config`, que só tem campos de alíquota %), a taxa derivada dessa forma subestimaria levemente o custo real em preços baixos. Mitigação: os dois analogs (`orders_price_timeseries` e `computeMco`) já tratam comissão/imposto como valores agregados sem separar parte fixa — não há regressão, apenas uma simplificação consistente com o resto da página. |
| A2 | O escopo da meta customizada (D-05/D-06) deve ser por `item_id` + `sku` opcional (não só `item_id`), para acompanhar o mesmo grão do seletor de variação (D-01: "para o anúncio + variação atualmente selecionados"). | Pattern 1, Code Examples | Se Wesley quiser a meta SEMPRE no nível do anúncio (ignorando variação), a coluna `sku` vira sempre `''` e o comportamento colapsa para "1 meta por anúncio" sem quebrar nada — mudança de baixo risco caso a suposição esteja errada. |
| A3 | Não é necessário nenhum mínimo de amostra (unidades vendidas no período) para exibir a recomendação — apenas os avisos já padronizados de custo/imposto ausente. | Pitfall 3 | Se o período selecionado tiver poucas vendas, a taxa de comissão/imposto derivada pode oscilar bastante entre trocas de período, dando a impressão de recomendação "instável"; o planner pode decidir adicionar um limiar mínimo (ex. `MIN_DIAS_CONFIANCA` já usado em `precoFaixas.ts`) como discretion. |

**Se esta tabela parecer vazia de riscos graves:** é porque a maior parte desta pesquisa foi verificada lendo o código-fonte real do repo (não treino/web) — as únicas áreas de incerteza genuína são decisões de produto que ainda cabem ao planner/Wesley (granularidade exata da meta, limiar de confiança), não fatos técnicos.

## Open Questions

1. **A meta customizada (D-05) deve ser por `item_id` sozinho, ou por `item_id + sku`?**
   - What we know: D-01 amarra o card ao "anúncio + variação atualmente selecionados"; D-05 diz "persistida por SKU/item_id" (ambíguo — usa "/" como "ou").
   - What's unclear: se o usuário troca de variação dentro do mesmo anúncio, ele espera ver a MESMA meta customizada, ou uma meta diferente por variação?
   - Recommendation: seguir o grão mais fino (por `item_id + sku`, com `sku=''` = "anúncio inteiro/sem variação selecionada") — é estritamente mais flexível, custa uma coluna extra, e colapsa para "1 por anúncio" se o usuário nunca customizar por variação. Confirmar com Wesley no checkpoint de UI se o comportamento observado bate com a expectativa.

2. **Deve haver um piso de amostra (unidades no período) antes de mostrar a recomendação?**
   - What we know: o histograma de faixas (Phase 80/81) já tem o conceito de "baixa confiança" (`MIN_DIAS_CONFIANCA`, `baixaConfianca`) para evitar mostrar conclusões fortes com poucos dados.
   - What's unclear: D-08 diz que a recomendação fica "sempre visível" — não está claro se isso significa "sempre visível mesmo com 1 venda no período" ou só "sempre visível independentemente de estar saudável/insalubre".
   - Recommendation: manter "sempre visível" (D-08 é sobre não esconder condicionalmente à saúde, não sobre suprimir por baixa amostra) mas considerar um aviso textual leve (reusando o padrão de aviso "custo ausente"/"imposto ausente" já existente) quando a amostra for pequena — não bloquear, só avisar.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | não | Reusa Supabase Auth já existente — nenhuma mudança de login/sessão. |
| V3 Session Management | não | Sem mudança. |
| V4 Access Control | sim | RLS org-first na tabela `ml_mco_targets`, clonada 1:1 de `ml_product_costs` (SELECT: qualquer membro da org via `is_org_member`; INSERT/UPDATE/DELETE: `owner`/`admin`/`member` via `get_org_role`, nunca `viewer` — default-deny). `/analise-precos` já roda sob `RoleRoute` (ver `App.tsx`, linha 150) sem restrição adicional de papel — não precisa mudar. |
| V5 Input Validation | sim | `CHECK (target_mco_pct > 0 AND target_mco_pct <= 100)` no banco (defesa em profundidade) + validação equivalente no client antes do upsert (não deixar salvar 0/negativo/>100, já que `reversePrice` não suporta `target<=0` — Pitfall 2). |
| V6 Cryptography | não | Nenhum dado sensível novo (meta de margem % não é PII nem segredo). |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR — outra org lê/escreve a meta MCO% de itens da Pé Vermeio | Tampering / Information Disclosure | RLS org-first idêntica a `ml_product_costs` (já auditada e provada anti-IDOR na Phase 43 TENANT-01: 0 vazamentos em 15 tabelas escopo-org). Nenhum parâmetro de organização vindo do client — sempre `organization_id` do `currentOrg` do contexto de sessão, nunca de input do usuário passado para uma query sem filtro de RLS. |
| Duplicidade silenciosa de meta por `sku=NULL` | Tampering (dado inconsistente, não segurança per se) | `sku TEXT NOT NULL DEFAULT ''` em vez de nullable — ver Pitfall 4. |
| Meta % fora de faixa quebrando a álgebra de `reversePrice` (denom ≤ 0) | — (robustez, não ameaça) | `reversePrice` já retorna `null` quando `denom <= 0`; a UI deve tratar `null` como "meta impraticável" (mesmo padrão "nunca inventar número" já estabelecido nas Phases 79-83), nunca renderizar `NaN`/`Infinity`. |

## Sources

### Primary (HIGH confidence — lido diretamente do repositório nesta sessão)
- `src/lib/mco.ts` — `computeMco`, fórmula canônica.
- `src/lib/mcoHealth.ts` — `MCO_SAUDAVEL_PCT`, `classifyMcoHealth`, `mcoHealthRole`.
- `src/lib/precoMcoSeries.ts` — `computePrecoMcoSeries`, `computePriceKpis`, tipos `PrecoSeriesRow`/`McoSeriesPoint`.
- `src/lib/pricing/calculator.ts` — `computePricing`, `reversePrice` (Phase 50, Simulador).
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — `ChartTooltip`/`Row`, KPICards, estado `selectedId`/`selectedSku`/`incluirAds`.
- `src/hooks/useMLProductCosts.ts` — padrão de fetch-por-org + upsert otimista (modelo para `useMcoTargets`).
- `src/pages/mercadolivre/MLAnuncios.tsx` — `InlineEditCell` (padrão de campo editável onBlur/Enter).
- `supabase/migrations/20260514120000_ml_product_costs.sql` + `20260518200000_ml_product_costs_seller_sku.sql` + `20260614120000_tenant01_ml_product_costs_rls_orgfirst.sql` — schema + RLS org-first de referência.
- `supabase/migrations/20260662000000_replenishment_params.sql` — padrão de `scope_value=''` sentinela (evita NULL em UNIQUE).
- `supabase/migrations/20260682000000_orders_price_timeseries_sku.sql` — RPC atual, `_sku` param, `SECURITY INVOKER`, cast `data_pedido::date`.
- `supabase/functions/nexo-chat/playbooks.ts` — fórmula "break-even ACoS = 100 × margem [antes de ads]" (linha ~277), base da alavanca (b).
- `src/lib/kpi-glossary.ts` — termos já padronizados (`cmv`, `comissao_ml`, `impostos`, `publicidade`, `acos`, `mco`) para reuso de copy.
- `supabase/config.toml` — confirma `project_id = "ckcdevcxgvueywivefgx"` (o projeto correto deste repo, per memória do projeto — `CLAUDE.md` no working dir referencia um projeto diferente/desatualizado, `gionpsuunfkkzzjdubfy`, de um módulo não relacionado).
- `.planning/config.json` — `workflow.nyquist_validation: false` (seção de Validation Architecture omitida desta pesquisa por configuração explícita).

### Secondary (MEDIUM confidence)
- Nenhuma — toda a pesquisa desta phase foi feita por leitura direta de código-fonte (não houve necessidade de WebSearch/Context7: não há biblioteca externa nova nem API de terceiros nova envolvida).

### Tertiary (LOW confidence)
- Nenhuma.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nenhuma dependência nova, tudo já em uso e versionado em `package.json`.
- Persistência (D-06): HIGH — padrão clonado de `ml_product_costs`/`replenishment_params`, já auditado anti-IDOR (Phase 43).
- Fórmulas (D-07): HIGH — `reversePrice` já é código de produção testado (Phase 50); ACOS-alvo é álgebra de 1 linha derivada de um playbook já escrito e versionado no repo.
- Waterfall/agregação por unidade (D-02): HIGH para o que reusa (`computeMco`, `computePrecoMcoSeries`), MEDIUM para a nova função `computeWaterfallCard` proposta (não existe ainda — é uma extensão de baixo risco no mesmo estilo do arquivo, mas o planner deve escrever/testar como qualquer código novo).
- Pitfalls: HIGH — todos derivados de comportamento real observado no código (guard `target<=0` em `reversePrice`, semântica de `breakevenUnit`, sentinela `''` já usada em `replenishment_params`).

**Research date:** 2026-07-19
**Valid until:** 60 dias (feature interna, sem dependência de API externa ou biblioteca de terceiros que possa mudar — o único fator de obsolescência seria uma mudança na própria fórmula de MCO/comissão ML, que é explicitamente fora de escopo desta phase).
