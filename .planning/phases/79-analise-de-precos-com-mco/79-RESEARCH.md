# Phase 79: Análise de Preços com MCO — Research

**Researched:** 2026-07-02
**Domain:** Recharts (banded area charts), PostgreSQL RPC evolution (SECURITY INVOKER), imposto/ads server-side aggregation patterns
**Confidence:** HIGH (todo o código relevante já existe no repo e foi lido nesta sessão — não houve necessidade de web search)

## Summary

Esta phase estende um componente e uma RPC que já existem em produção (Phase 77). O
trabalho real é: (1) adicionar 4 colunas agregadas à RPC `orders_price_timeseries`
(cmv/comissao/frete/qtd_sem_custo) via `DROP FUNCTION` + `CREATE FUNCTION` (não
`CREATE OR REPLACE` — Postgres não permite mudar o `RETURNS TABLE` de uma função
existente sem dropar antes); (2) criar `src/lib/precoMcoSeries.ts` reusando
`computeMco`; (3) trocar o gráfico de `PrecoPraticadoReport.tsx` para a técnica de
"bandas empilhadas" (stacked Area com base transparente) — não há precedente exato no
repo, mas o padrão é bem estabelecido e documentado abaixo com código completo; (4)
trocar os 6 KPIs.

**Achado crítico que muda a receita técnica do imposto e dos ads (ver seção 3):** a
tabela `orders` já tem uma coluna `tax_amount` **firme, por pedido, calculada com a UF
de destino real** (populada por `recalc-order-costs` via `computeOrderTaxRate`), e o
padrão estabelecido do projeto (`get_cost_waterfall`, usado por `MLCostCard`, e
`get_margin_with_ads_by_product`) é simplesmente `SUM(o.tax_amount)` — **sem nenhuma
resolução client-side de "alíquota efetiva média"**. `ml_tax_config`/`calculateEffectiveRate`
só são usados em telas de configuração/simulação (`MLFiscal`, `SimuladorPrecificacao`),
nunca para agregar imposto de pedidos já ocorridos. Da mesma forma, `ml_ads_products_cache`
**tem coluna `date`** (desde a migration `20260522_ads_products_daily.sql`) — é uma série
diária por item, não um total sem data como a spec assumiu — e `get_margin_with_ads_by_product`
já faz `SUM(a.spend) ... WHERE a.date BETWEEN p_from AND p_to`. Isso não invalida a
decisão travada do Wesley (MCO completo, rateio de ads, toggle), mas muda **como**
implementar os dois pontos que o CONTEXT.md deixou a critério do Claude ("Como resolver
multi-loja na alíquota — espelhar MLCostCard"): espelhar MLCostCard literalmente
significa `SUM(tax_amount)` na RPC, não recalcular no TS. Ver seção "Achados que Requerem
Decisão do Planner" para o detalhe e a recomendação.

**Primary recommendation:** Estender a RPC com `SUM(tax_amount) FILTER` (mesmo padrão de
`cmv`/`comissao`/`frete`) em vez de resolver `taxaEfetiva` no TS; para ads, manter o
rateio por receita (decisão travada), mas usar `SUM(spend)` filtrado pelo período do
relatório (não "spend total" do item) como a base do rateio.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Agregação de cmv/comissão/frete/qtd_sem_custo por bucket | Database (RPC) | — | Mesma agregação de grupo já existente (Phase 77); evita trazer linhas de `orders` para o cliente |
| Imposto por bucket | Database (RPC) — `SUM(tax_amount)` | Frontend (fallback) | `tax_amount` já é computado e persistido por pedido (recalc-order-costs); replicar a fórmula no TS duplicaria lógica e perderia a UF real |
| Spend de ads por item/período | Database (query direta RLS-scoped) | Frontend (rateio) | `ml_ads_products_cache` tem RLS org-first; a soma pode ser feita client-side (poucas linhas por item) sem precisar de nova RPC |
| MCO completo, bandas gain/loss, breakeven por bucket | Frontend (`src/lib/precoMcoSeries.ts`) | — | Função pura testável; combina dado firme da RPC com o toggle de ads (estado de UI) |
| Renderização do gráfico (Area bands + 2 Lines + eixo direito) | Frontend (`PrecoPraticadoReport.tsx`) | — | Puramente apresentacional sobre a série já calculada |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **Composição do MCO: completa** — `venda − custo − comissão − frete − publicidade −
  imposto`, idêntica a `computeMco` de `src/lib/mco.ts` (`platformCost = comissao + frete`).
  REUSAR, não duplicar a fórmula.
- **Gráfico:** linha preço praticado (R$/un) + linha break-even (R$/un) no eixo
  esquerdo; colchão (Area) entre as linhas — verde (`--success`) quando preço ≥
  break-even, vermelho (`--destructive`) quando preço < break-even, via técnica de
  séries divididas (gainBand/lossBand calculadas no util, não no componente); linha
  MCO% no eixo direito. SAEM: barras de volume e toggle Qtd/Receita. FICAM: seletor de
  anúncio, granularidade dia/semana/mês. ENTRA: toggle "incluir ads" (Switch, default
  ON). Tooltip: preço, break-even, MCO R$/un, MCO %, decomposição por unidade (custo,
  comissão, frete, ads, imposto). Rodapé: "Ads rateado pela participação de receita ·
  imposto pelo regime configurado · linha tracejada = break-even".
- **Backend — RPC estendida:** `CREATE OR REPLACE` de `orders_price_timeseries`
  acrescentando por bucket `cmv`, `comissao`, `frete`, `qtd_sem_custo`. MANTER SECURITY
  INVOKER, sem parâmetro de org, sem subquery correlacionada. `data_pedido::date`
  mantido. Deploy via MCP `apply_migration` no projeto `ckcdevcxgvueywivefgx`. Smoke
  como role `authenticated` com dados reais, comparando 2–3 buckets contra soma manual
  em SQL.
- **Camada TS — util puro `src/lib/precoMcoSeries.ts`:** entrada = linhas da RPC +
  taxaEfetiva + spendItem + flag incluirAds. Saída por bucket: imposto (receita ×
  taxaEfetiva), ads (spendItem × receita/receitaTotalPeriodo se incluirAds, senão 0),
  mco/mcoPct via `computeMco`, precoUnit, breakevenUnit, custoAusente, gainBand/lossBand.
  Alíquota efetiva via `ml_tax_config` + `computeOrderTaxRate`/helpers de `src/lib/tax/`,
  sem UF destino por bucket → taxa efetiva média da loja. Múltiplas lojas: seguir o que
  `MLCostCard` já faz. spendItem: `ml_ads_products_cache` pelo `item_id` (coluna
  `spend`); ausente → ads=0.
- **KPIs (6):** Preço médio · Break-even médio · MCO (R$) · MCO % (verde/vermelho pelo
  sinal) · Qtd vendida · Receita. SAEM: faixa de preço, média diária, receita média
  diária.
- **Estados e erros:** sem vendas → estado vazio atual; `custo_unit` NULL → break-even
  sem a parte ausente + aviso "custo ausente em N un — break-even subestimado" (nunca
  inventar número); sem `ml_tax_config` → imposto=0 + aviso "regime fiscal não
  configurado"; sem ads no cache → parcela 0 silenciosamente; erro RPC → comportamento
  atual (console.warn + vazio).

### Claude's Discretion

- Detalhes visuais do colchão (gradiente/opacidade), formatação do tooltip, layout
  exato do toggle — seguir design tokens do projeto e skill dataviz.
- Nome/formato exato dos campos do util e testes.
- **Como resolver multi-loja na alíquota (espelhar MLCostCard)** — ver "Achados que
  Requerem Decisão do Planner": espelhar `MLCostCard` literalmente aponta para
  `SUM(tax_amount)` na RPC, não recálculo client-side.

### Deferred Ideas (OUT OF SCOPE)

- Ads por item por dia real (novo sync da API de ads com breakdown diário por item) —
  phase futura se o rateio incomodar. **Nota de research:** `ml_ads_products_cache` já
  tem granularidade diária por item hoje (ver achado crítico); o que falta é cobertura
  histórica garantida (o sync só roda sob demanda, sem cron), não a coluna `date` em si.
  Isso não desbloqueia o deferred automaticamente — a cobertura de dados históricos
  continua não-garantida — mas é relevante se o Wesley perguntar "por que não usamos o
  dado real".
- Deep-link `?item=` (deferido desde a Phase 77).

</user_constraints>

<phase_requirements>
## Phase Requirements

Phase ad-hoc — nenhum requirement ID formal. O goal da phase (ver ROADMAP.md) funciona
como requisito único: "a página `/analise-precos` responde 'o preço praticado deu
MCO?'". Toda a pesquisa abaixo dá suporte a esse goal único.
</phase_requirements>

## Achados que Requerem Decisão do Planner

Estes dois pontos não contradizem nenhuma decisão travada — ambos caem dentro de
"Claude's Discretion" ou de detalhes de implementação não especificados — mas mudam
significativamente a receita técnica descrita no CONTEXT.md/spec, porque a spec foi
escrita sem checar o schema atual. Recomendo o planner decidir explicitamente (ou
levar ao Wesley em 1 pergunta rápida) antes de escrever as tasks.

### 1. Imposto: `SUM(tax_amount)` na RPC vs. `taxaEfetiva` client-side

`[VERIFIED: codebase]` A tabela `orders` já tem uma coluna `tax_amount` numeric,
calculada e persistida **por pedido** por `recalc-order-costs`
(`supabase/functions/recalc-order-costs/index.ts:134-146`), usando
`computeOrderTaxRate(cfg, uf_destino_real)` — ou seja, já usa a UF de destino real do
pedido, não uma média. Duas RPCs existentes já agregam esse campo exatamente como
`cmv`/`comissao`/`frete` seriam agregados nesta phase:

- `get_cost_waterfall` (`supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql:46`):
  `COALESCE(SUM(o.tax_amount), 0) AS total_tax` — é o dado que `MLCostCard` exibe como
  "Impostos próprios (regime fiscal)". **`MLCostCard` não resolve alíquota nenhuma —
  apenas exibe o número que a RPC já somou.** Isso é o que "espelhar MLCostCard"
  realmente significa.
- `get_margin_with_ads_by_product` (`supabase/migrations/20260615120000_margin_with_ads_rpc.sql:54`):
  mesmo padrão, no mesmo formato de RPC por-item-por-bucket que esta phase precisa
  (ver seção 4 abaixo — é o template quase pronto para a migration da Phase 79).

**Recomendação:** acrescentar à RPC `orders_price_timeseries`, junto com
`cmv`/`comissao`/`frete`/`qtd_sem_custo`, também:
```sql
SUM(o.tax_amount)                                              AS impostos,
SUM(o.quantidade) FILTER (WHERE o.tax_amount IS NULL)          AS qtd_sem_imposto,
```
Isso elimina a necessidade de `src/lib/tax/*` no util `precoMcoSeries.ts` — o util
recebe `impostos` já pronto da RPC, não precisa de `taxaEfetiva` nem de
`useMLTaxConfig`. O aviso "regime fiscal não configurado" vira `qtd_sem_imposto > 0`,
espelhando `custoAusente`/`qtd_sem_custo` (mesmo padrão, zero código novo de resolução
de imposto). **Vantagem extra:** usa a UF real de cada pedido (mais preciso que a
"taxa efetiva média da loja" descrita no CONTEXT.md, que é uma aproximação
necessária **apenas quando não há UF por pedido** — e aqui há).

**Se o planner preferir seguir a letra do CONTEXT.md** (resolver `taxaEfetiva` no TS
via `ml_tax_config`), isso também funciona — é a abordagem descrita nas Locked
Decisions — mas é estritamente mais aproximada e reintroduz `src/lib/tax/*` como
dependência do util (que passa a não ser mais 100% "puro" no sentido de não precisar
de nenhum dado de configuração externo por chamada — ainda é puro no sentido de não
fazer I/O, só recebe mais um parâmetro).

**Ação sugerida para o planner:** decidir entre as duas opções antes de escrever a task
1 da RPC (afeta as colunas da migration) — não é um checkpoint bloqueante, é uma
escolha de design com evidência forte a favor da opção `tax_amount`.

### 2. Ads: cobertura diária real vs. rateio puro

`[VERIFIED: codebase]` `ml_ads_products_cache` tem coluna `date` desde
`supabase/migrations/20260522_ads_products_daily.sql` — chave única
`(organization_id, ml_user_id, item_id, date)`. O sync (`supabase/functions/ml-ads/index.ts:150-266`)
grava spend real por item por dia. **Isso contradiz a premissa da spec** ("Não existe
ads por item por dia... `ml_ads_products_cache` tem spend por item sem data").

Porém, a cobertura **não é garantida**: o sync só roda sob demanda quando alguém abre
uma tela que chama a edge function `ml-ads` (não há cron — `grep` em todas as
migrations não encontrou nenhum `pg_cron` agendando `ml-ads`), limitado a 90 dias de
lookback (`ml-ads/index.ts:389`). Para um item + período específicos da Análise de
Preços, pode não haver nenhuma linha, ou haver linhas só para uma parte dos dias.

**Recomendação:** manter a decisão travada (rateio por participação de receita), mas
calcular `spendItem` como `SUM(spend) WHERE item_id = X AND date BETWEEN fromDate AND
toDate` (não uma soma "de todos os tempos" do item) — isso já é filtrado pelo período
do relatório, o que é mais correto e é exatamente o que `get_margin_with_ads_by_product`
faz (`a.date BETWEEN p_from AND p_to`, linha 82). O rateio por receita dentro do
período continua sendo necessário porque o breakdown diário real, mesmo quando
presente, não é garantido bucket-a-bucket (a granularidade do relatório pode ser
semana/mês, agregando N dias de ads que podem ter cobertura parcial).

**Não é necessário resolver isso com o Wesley** — a decisão travada já cobre o
comportamento observável (toggle, rodapé "melhor-esforço"); é só uma correção de
precisão no cálculo de `spendItem` que este research recomenda aplicar.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 2.15.4 (já no projeto) | ComposedChart com Area+Line+dois eixos Y | `[VERIFIED: package.json]` já é a lib de charts padrão do projeto; nenhuma dependência nova |
| date-fns | 3.6.0 (já no projeto) | `parseISO`/`format`/`differenceInCalendarDays` para buckets | já usado em `PrecoPraticadoReport.tsx` |

Nenhuma dependência nova é necessária. **Não há `npm install` nesta phase.**

## Package Legitimacy Audit

Não aplicável — esta phase não introduz nenhum pacote novo (nem no `package.json` nem
em nenhuma edge function). Nenhum `npm install` é necessário.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────┐
│  orders (tabela)             │  cmv = custo_unit×qtd, comissao, frete,
│  tax_amount já firme/pedido  │  tax_amount já firme/pedido (UF real)
└──────────────┬────────────────┘
               │ SECURITY INVOKER RLS (org isolation)
               ▼
┌──────────────────────────────────────────────────────────┐
│ RPC orders_price_timeseries (estendida, DROP+CREATE)      │
│  GROUP BY bucket:                                         │
│   preco_medio/min/max, qtd, total, orders  (já existe)    │
│   + cmv, comissao, frete, qtd_sem_custo    (nova)         │
│   + impostos, qtd_sem_imposto              (nova, recom.) │
└──────────────┬─────────────────────────────────────────────┘
               │ supabase.rpc() — 1 chamada por seleção de anúncio
               ▼
┌──────────────────────────────────────────────────────────┐
│ ml_ads_products_cache (query direta client, RLS org)       │
│  SUM(spend) WHERE item_id=X AND date BETWEEN from/to        │
└──────────────┬─────────────────────────────────────────────┘
               │ spendItem (escalar)
               ▼
┌──────────────────────────────────────────────────────────┐
│ src/lib/precoMcoSeries.ts (função pura, testável)           │
│  input: rows[] da RPC + spendItem + incluirAds               │
│  por bucket: ads = incluirAds ? spendItem×(receita/receitaTot) : 0 │
│              mco/mcoPct = computeMco(...)                    │
│              precoUnit, breakevenUnit, gainBand, lossBand     │
│              custoAusente, impostoAusente                     │
└──────────────┬─────────────────────────────────────────────┘
               │ série pronta para renderizar
               ▼
┌──────────────────────────────────────────────────────────┐
│ PrecoPraticadoReport.tsx                                     │
│  ComposedChart: Area(gainBand/lossBand stackId) + Line(preco)│
│                 + Line(breakeven, dash) + Line(mcoPct, eixo D)│
│  KPIs: preço médio, breakeven médio, MCO R$, MCO%, qtd, receita│
│  Toggle "incluir ads" (Switch) + Tooltip decomposto           │
└──────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

Nenhum arquivo novo além do já previsto no CONTEXT.md:

```
src/lib/precoMcoSeries.ts          # novo — util puro
src/lib/precoMcoSeries.test.ts     # novo — testes (mesma pasta, padrão mco.test.ts)
src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx   # editado
supabase/migrations/202606790000NN_orders_price_timeseries_mco.sql  # novo — migration
```

### Pattern 1: RPC "por-item-por-bucket com componentes firmes" (template pronto)

**What:** agregação em uma única `GROUP BY` de todos os componentes de custo diretos
da tabela `orders`, sem subquery correlacionada, seguindo exatamente o padrão de
`get_margin_with_ads_by_product`.
**When to use:** sempre que uma RPC precisar decompor margem/MCO por bucket a partir de
`orders`.
**Example (adaptado do `get_margin_with_ads_by_product` real, `supabase/migrations/20260615120000_margin_with_ads_rpc.sql:44-71`):**
```sql
-- Fonte: supabase/migrations/20260615120000_margin_with_ads_rpc.sql (código real do projeto)
SELECT
  o.item_id,
  COALESCE(SUM(o.receita_bruta), 0)                     AS receita,
  COALESCE(SUM(o.custo_unit * o.quantidade), 0)         AS cmv,
  COALESCE(SUM(o.comissao), 0)                          AS comissao,
  COALESCE(SUM(o.frete), 0)                             AS frete,
  COALESCE(SUM(o.tax_amount), 0)                        AS impostos,
  BOOL_OR(o.custo_unit IS NOT NULL)                     AS has_cmv
FROM public.orders o
WHERE o.organization_id = p_org_id
  AND o.ml_user_id = ANY(p_user_ids)
  AND o.status IN ('paid', 'shipped', 'delivered')
  AND o.data_pedido::date BETWEEN p_from AND p_to
GROUP BY o.item_id
```
Este é o template para as novas colunas de `orders_price_timeseries` — mesma lógica,
`GROUP BY` trocado de `o.item_id` para `date_trunc(granularidade, o.data_pedido::date)`
(já é o `GROUP BY 1` existente da RPC atual).

### Pattern 2: técnica de "colchão" (banded area) entre duas linhas no Recharts

**What:** Recharts não tem um componente nativo "área entre duas linhas com cor
condicional". A técnica padrão (usada amplamente na comunidade Recharts/D3, sem
precedente direto neste repo — `[ASSUMED]`, mas é o único jeito viável com a API do
Recharts 2.x) é: pré-calcular no util, por ponto, uma "base" invisível e duas bandas
empilhadas (`stackId` igual) que ficam zeradas quando não se aplicam.

**When to use:** exatamente este caso — colchão verde quando preço ≥ break-even,
vermelho quando preço < break-even.

**Cálculo no util (`precoMcoSeries.ts`):**
```typescript
// Por bucket, após calcular precoUnit e breakevenUnit:
const base      = Math.min(precoUnit, breakevenUnit);
const gainBand   = precoUnit >= breakevenUnit ? precoUnit - breakevenUnit : 0;
const lossBand   = precoUnit <  breakevenUnit ? breakevenUnit - precoUnit : 0;
// gainBand e lossBand nunca são não-nulos ao mesmo tempo no mesmo ponto.
```

**Renderização no componente:**
```tsx
<ComposedChart data={chartData}>
  <YAxis yAxisId="preco" ... />
  <YAxis yAxisId="mco" orientation="right" ... />

  {/* Base invisível — empurra as bandas até o valor mínimo(preço,breakeven) */}
  <Area
    yAxisId="preco" type="linear" dataKey="base" stackId="mco"
    stroke="none" fill="transparent" isAnimationActive={false}
  />
  {/* Banda verde — só aparece quando preço >= breakeven */}
  <Area
    yAxisId="preco" type="linear" dataKey="gainBand" stackId="mco"
    stroke="none" fill="hsl(var(--success))" fillOpacity={0.25}
    isAnimationActive={false}
  />
  {/* Banda vermelha — só aparece quando preço < breakeven */}
  <Area
    yAxisId="preco" type="linear" dataKey="lossBand" stackId="mco"
    stroke="none" fill="hsl(var(--destructive))" fillOpacity={0.25}
    isAnimationActive={false}
  />

  <Line yAxisId="preco" type="linear" dataKey="precoUnit" name="precoUnit"
        stroke="hsl(var(--accent))" strokeWidth={2.2} dot={{ r: 2.5 }} />
  <Line yAxisId="preco" type="linear" dataKey="breakevenUnit" name="breakevenUnit"
        stroke="hsl(var(--muted-foreground))" strokeWidth={1.5}
        strokeDasharray="5 4" dot={false} />
  <Line yAxisId="mco" type="monotone" dataKey="mcoPct" name="mcoPct"
        stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
</ComposedChart>
```

**Pitfall de interpolação nos cruzamentos:** use `type="linear"` (não `"monotone"`)
tanto nas `Area` das bandas quanto nas `Line` de preço/breakeven. Com `monotone`, a
curva pode "overshootar" entre pontos (undershooting/overshooting cúbico), fazendo a
banda parecer errada nos cruzamentos. Com `linear`, a transição de cor acontece
exatamente no ponto (bucket) onde o sinal muda — **não** na interseção geométrica real
entre as duas retas dentro do intervalo (Recharts não interpola a cor dentro de um
segmento). Isso é uma limitação conhecida da técnica: o cruzamento visual é "em
degrau" na granularidade do bucket, não um gradiente suave. Se granularidade = dia, o
efeito é sutil; se granularidade = mês, pode parecer abrupto. Documentar isso no
rodapé ou aceitar como comportamento esperado (não há solução nativa no Recharts sem
recorrer a `<defs><linearGradient>` com `offset` calculado por segmento, que é
significativamente mais complexo e não vale o esforço para esta phase).

**Eixo esquerdo dividido preço vs. banda:** como a banda usa `yAxisId="preco"` (mesmo
eixo das linhas), os valores de `gainBand`/`lossBand` estão em R$/un absoluto empilhado
sobre `base` — isso é o comportamento correto para que a altura visual da banda
corresponda à distância real entre as duas linhas no mesmo eixo. Não usar um eixo
separado para a banda.

### Pattern 3: KPI colorido pelo sinal (já existe no projeto)

**What:** `KPICard` já suporta `variant="success" | "danger"` dinâmico.
**Example (já usado em outras telas do projeto, `src/components/dashboard/KPICard.tsx:34,36`):**
```tsx
<KPICard
  title="MCO %"
  value={`${kpis.mcoPct.toFixed(1)}%`}
  variant={kpis.mcoPct >= 0 ? "success" : "danger"}
  icon={<Percent className="w-4 h-4" />}
  size="compact"
/>
```

### Anti-Patterns to Avoid
- **Duplicar a fórmula de imposto no TS quando a RPC já pode entregar `tax_amount`
  agregado:** ver "Achados que Requerem Decisão do Planner" #1 — evite reimplementar
  `computeOrderTaxRate` no cliente se a RPC puder somar o campo já calculado no
  servidor.
- **Rateio de ads sem filtrar por período:** somar `spend` de todos os tempos do item
  (não só do período do relatório) infla o MCO negativamente fora de contexto — sempre
  filtrar `date BETWEEN fromDate AND toDate`.
- **`CREATE OR REPLACE FUNCTION` para mudar `RETURNS TABLE`:** falha com erro do
  Postgres — ver seção "Migration Segura" abaixo.
- **`type="monotone"` nas bandas empilhadas:** pode causar overshoot visual nos
  cruzamentos — usar `type="linear"`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cálculo de MCO (R$ e %) | Nova fórmula `receita - custos...` | `computeMco` (`src/lib/mco.ts`) | Já testado (4 casos), já reconciliado com o resto do dashboard; decisão travada exige reuso |
| Resolução de alíquota de imposto por pedido | Recalcular no cliente com `ml_tax_config` | `orders.tax_amount` (já calculado por `recalc-order-costs`) agregado via `SUM()` na RPC | Ver achado crítico — o campo já existe, já é mais preciso (UF real), e é o padrão usado por `MLCostCard`/`get_cost_waterfall` |
| Banda colorida entre duas linhas | Componente customizado com SVG manual/clipPath | Técnica de stacked Area com base transparente (Pattern 2 acima) | É o padrão estabelecido da comunidade Recharts para este problema com a API pública do 2.x |

**Key insight:** a maior parte da "inteligência" desta phase já existe no banco
(`tax_amount`, `ml_ads_products_cache.date`) ou no repo (`computeMco`,
`get_margin_with_ads_by_product` como template). O trabalho novo real é: 1 migration, 1
util pequeno, e a técnica de bandas no gráfico — que é a única peça genuinamente nova.

## Common Pitfalls

### Pitfall 1: `CREATE OR REPLACE FUNCTION` falha ao mudar `RETURNS TABLE`
**What goes wrong:** `CREATE OR REPLACE FUNCTION orders_price_timeseries(...) RETURNS
TABLE(..., cmv numeric, ...)` sobre uma função já existente com um `RETURNS TABLE`
menor falha com `ERROR: cannot change return type of existing function` / `HINT: Use
DROP FUNCTION first.`
**Why it happens:** `[CITED: PostgreSQL CREATE FUNCTION docs]` — para funções com OUT
parameters (que é o que `RETURNS TABLE` realmente é por baixo), o Postgres não permite
alterar a lista de colunas de retorno via `CREATE OR REPLACE`, mesmo que seja apenas
para *adicionar* colunas no final. Isso vale mesmo que a assinatura de entrada não
mude.
**How to avoid:** na migration, antes do `CREATE FUNCTION` (sem `OR REPLACE`, ou com
`OR REPLACE` mas precedido de `DROP FUNCTION IF EXISTS`), rodar:
```sql
DROP FUNCTION IF EXISTS public.orders_price_timeseries(text, text[], date, date, text);
CREATE FUNCTION public.orders_price_timeseries(
  _item_id      text,
  _ml_user_ids  text[] DEFAULT NULL,
  _from         date   DEFAULT NULL,
  _to           date   DEFAULT NULL,
  _granularity  text   DEFAULT 'day'
)
RETURNS TABLE(
  bucket        date,
  preco_medio   numeric,
  preco_min     numeric,
  preco_max     numeric,
  qtd           bigint,
  total         numeric,
  orders        bigint,
  cmv           numeric,
  comissao      numeric,
  frete         numeric,
  qtd_sem_custo bigint,
  impostos        numeric,  -- recomendado (ver Achado #1)
  qtd_sem_imposto bigint    -- recomendado (ver Achado #1)
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$ ... $function$;
```
Nota: `DROP FUNCTION` identifica a função pelos **tipos dos argumentos de entrada**
(sem defaults) — a assinatura `(text, text[], date, date, text)` continua igual (só o
retorno muda), então o `DROP` é seguro e não afeta chamadores existentes assim que o
`CREATE` seguinte é aplicado na mesma transação/migration.
**Warning signs:** erro do `apply_migration` mencionando "cannot change return type" —
não é um erro de sintaxe, é a proteção do Postgres.

### Pitfall 2: divisão por zero em `breakevenUnit` quando `qtd = 0`
**What goes wrong:** buckets sem vendas não deveriam existir na série (a RPC já agrupa
por `data_pedido` de pedidos reais, então `qtd` nunca é 0 numa linha retornada) — mas o
util deve ser defensivo mesmo assim (testes unitários devem cobrir `qtd = 0` como
edge case, conforme já indicado no CONTEXT.md: "divisão por zero (qtd 0)").
**How to avoid:** `qtd > 0 ? total_custos / qtd : 0` (ou `null`, a decidir pelo
planner) em vez de deixar `NaN`/`Infinity` vazar para o gráfico.

### Pitfall 3: `status IN ('paid','shipped','delivered')` inconsistente com o resto do projeto
**What goes wrong:** a RPC atual `orders_price_timeseries` (Phase 77) e
`get_margin_with_ads_by_product` usam `status IN ('paid','shipped','delivered')`, mas a
maioria das RPCs mais recentes (Phase 62–69, incluindo a RPC-irmã
`orders_sold_products_agg` da mesma página) usa **só** `status = 'paid'`.
**Why it happens:** decisões diferentes em phases diferentes; não documentado como bug,
mas é uma inconsistência real do codebase.
**How to avoid:** **não é escopo desta phase mudar isso** (a phase não pede alteração
do filtro de status) — apenas preservar o filtro existente da RPC ao adicionar as novas
colunas. Mencionar como observação, não como task.
**Warning signs:** se o planner notar diferenças entre o total de "Produtos Vendidos"
(status='paid') e o total desta RPC (status IN 3 valores) para o mesmo item/período,
essa é a causa — não um bug novo desta phase.

### Pitfall 4: cobertura de `tax_amount`/`custo_unit` incompleta
**What goes wrong:** nem todo pedido tem `tax_amount`/`custo_unit` preenchido —
`recalc-order-costs` roda em background e depende de `ml_tax_config`/`ml_product_costs`
estarem configurados. Buckets antigos (antes da config fiscal existir) ou com produtos
sem custo cadastrado no Tiny terão `NULL`.
**Why it happens:** já documentado no projeto (`project_garment_custo_unit_diagnostico.md`
na memória — root cause é lacuna de cadastro, não bug de código).
**How to avoid:** exatamente o padrão que o CONTEXT.md já define para `custo_unit`
(`qtd_sem_custo` → aviso, nunca inventar número) — replicar para `qtd_sem_imposto` se
a Opção recomendada do Achado #1 for adotada.

### Pitfall 5: `data_pedido` é TEXT com formatos mistos
**What goes wrong:** comparações de data sem `::date` cast podem comparar strings
lexicograficamente, dando resultados errados em formatos mistos.
**How to avoid:** já é feito corretamente na RPC atual (`o.data_pedido::date`) — manter
o padrão em todas as novas colunas/filtros que tocarem `data_pedido`.

### Pitfall 6: RLS timeout de 8s em subquery correlacionada
**What goes wrong:** RPCs SECURITY INVOKER rodando como `role authenticated` têm
`statement_timeout` de 8s; subqueries correlacionadas (um `SELECT` dentro do `SELECT`
por linha) podem estourar esse limite em tabelas grandes.
**How to avoid:** não é um risco real nesta phase — todas as colunas novas são
agregações simples (`SUM`/`COUNT` com `FILTER`) no mesmo `GROUP BY` já existente, sem
nenhum subquery novo. Ainda assim, o smoke test deve rodar como `role authenticated`
(não `postgres`) para confirmar que o plano de execução não mudou.

## Code Examples

### Assinatura recomendada de `precoMcoSeries.ts`

```typescript
// src/lib/precoMcoSeries.ts — util puro, zero deps de React/Supabase/rede
import { computeMco } from "./mco";

export interface PrecoSeriesRow {
  bucket: string;            // YYYY-MM-DD
  preco_medio: number;
  qtd: number;
  total: number;             // receita bruta do bucket
  cmv: number;
  comissao: number;
  frete: number;
  qtd_sem_custo: number;
  impostos: number;          // se Achado #1 (recomendado) for adotado
  qtd_sem_imposto: number;   // idem
}

export interface McoSeriesPoint {
  bucket: string;
  precoUnit: number;
  breakevenUnit: number;
  cmvUnit: number;
  comissaoUnit: number;
  freteUnit: number;
  adsUnit: number;
  impostoUnit: number;
  mco: number;
  mcoPct: number | null;
  base: number;       // min(precoUnit, breakevenUnit) — série invisível de apoio
  gainBand: number;   // 0 quando preço < breakeven
  lossBand: number;   // 0 quando preço >= breakeven
  custoAusente: boolean;
  impostoAusente: boolean;
}

export function computePrecoMcoSeries(
  rows: PrecoSeriesRow[],
  opts: { spendItem: number; incluirAds: boolean },
): McoSeriesPoint[] {
  const receitaTotalPeriodo = rows.reduce((s, r) => s + r.total, 0);

  return rows.map((r) => {
    const qtd = r.qtd;
    const ads = opts.incluirAds && receitaTotalPeriodo > 0
      ? opts.spendItem * (r.total / receitaTotalPeriodo)
      : 0;

    const { mco, pct } = computeMco({
      grossRevenue: r.total,
      cmv: r.cmv,
      platformCost: r.comissao + r.frete,
      ads,
      tax: r.impostos,
    });

    const precoUnit     = qtd > 0 ? r.total / qtd : 0;
    const breakevenUnit = qtd > 0
      ? (r.cmv + r.comissao + r.frete + ads + r.impostos) / qtd
      : 0;

    const base     = Math.min(precoUnit, breakevenUnit);
    const gainBand = precoUnit >= breakevenUnit ? precoUnit - breakevenUnit : 0;
    const lossBand = precoUnit <  breakevenUnit ? breakevenUnit - precoUnit : 0;

    return {
      bucket: r.bucket,
      precoUnit, breakevenUnit,
      cmvUnit:      qtd > 0 ? r.cmv      / qtd : 0,
      comissaoUnit: qtd > 0 ? r.comissao / qtd : 0,
      freteUnit:    qtd > 0 ? r.frete    / qtd : 0,
      adsUnit:      qtd > 0 ? ads        / qtd : 0,
      impostoUnit:  qtd > 0 ? r.impostos / qtd : 0,
      mco, mcoPct: pct,
      base, gainBand, lossBand,
      custoAusente:   r.qtd_sem_custo   > 0,
      impostoAusente: r.qtd_sem_imposto > 0,
    };
  });
}
```

### Query direta de `spendItem` (client, RLS-scoped)

```typescript
// Dentro de PrecoPraticadoReport.tsx ou hook dedicado — RLS já restringe por org
const { data } = await supabase
  .from("ml_ads_products_cache")
  .select("spend")
  .eq("item_id", selectedId)
  .in("ml_user_id", mlUserIds)
  .gte("date", fromDate)
  .lte("date", toDate);

const spendItem = (data ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);
```
RLS confirmada (`supabase/migrations/20260423153544...sql:465-466`):
`FOR SELECT ... USING (organization_id IS NOT NULL AND is_org_member(auth.uid(), organization_id))`
— mesmo padrão de todas as outras tabelas `ml_*_cache` do projeto. Não precisa filtrar
`organization_id` explicitamente na query (RLS já restringe), mas incluir por defesa em
profundidade é aceitável se o planner preferir espelhar outros hooks do projeto.

## Runtime State Inventory

Não aplicável — esta phase não é rename/refactor/migração de dados. Nenhum dado
existente muda de nome/schema; apenas colunas novas são adicionadas (aditivo).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A técnica de "stacked Area com base transparente" é a forma padrão de simular banda colorida condicional entre duas linhas no Recharts 2.x (sem componente nativo para isso) | Architecture Patterns > Pattern 2 | Baixo — é conhecimento de treinamento amplamente documentado na comunidade Recharts/D3, não verificado via Context7/docs nesta sessão porque não havia acesso a MCP de documentação configurado; se o comportamento visual não corresponder ao esperado, o fallback é ajustar `type`/`stackId` nos testes visuais do checkpoint, não uma mudança de arquitetura |
| A2 | `type="linear"` evita overshoot visual nos cruzamentos das bandas melhor que `type="monotone"` | Pattern 2 (pitfall de interpolação) | Baixo/médio — comportamento de interpolação de curvas é conhecimento de treinamento sobre a biblioteca; se o resultado visual ficar "anguloso" demais, o Wesley pode preferir `monotone` mesmo com o pequeno risco de overshoot — decidir no checkpoint visual |

**Nota:** os dois achados críticos da seção "Achados que Requerem Decisão do Planner"
(tax_amount e ml_ads_products_cache.date) são `[VERIFIED: codebase]` — confirmados por
leitura direta do código-fonte nesta sessão (migrations, edge functions, RPCs), não são
assumptions.

## Open Questions

1. **Opção do imposto: `SUM(tax_amount)` na RPC vs. `taxaEfetiva` client-side (Achado #1)**
   - What we know: `tax_amount` já existe, já é mais preciso, já é o padrão do projeto
     (`MLCostCard`/`get_cost_waterfall`).
   - What's unclear: se o planner ou Wesley têm alguma razão para preferir a
     abordagem client-side descrita literalmente no CONTEXT.md (ex.: independência da
     RPC, ou expor `taxaEfetiva` como número visível em algum lugar da UI).
   - Recommendation: adotar `SUM(tax_amount)` — é "Claude's Discretion" no CONTEXT.md
     ("como resolver multi-loja na alíquota — espelhar MLCostCard"), e espelhar
     MLCostCard literalmente aponta para essa opção. Documentar a escolha no PLAN.md.

2. **Cobertura real de `ml_ads_products_cache` para os itens/períodos mais usados**
   - What we know: a coluna `date` existe e é populada sob demanda (sem cron); os
     itens mais vendidos da Pé Vermeio provavelmente têm alguma cobertura recente
     (usuário visita /publicidade regularmente), mas não há garantia para períodos
     antigos (>90d) ou itens de cauda longa.
   - What's unclear: qual o percentual real de cobertura para os itens que o Wesley vai
     efetivamente analisar em `/analise-precos`.
   - Recommendation: não bloqueia a phase (o toggle "incluir ads" e o aviso de
     melhor-esforço já cobrem o caso de dado ausente = ads 0). Se o planner quiser,
     pode incluir uma verificação rápida (`SELECT count(*), min(date), max(date) FROM
     ml_ads_products_cache WHERE organization_id = '<pe-vermeio-org-id>'`) como parte
     do checkpoint de smoke da RPC, só para calibrar expectativa — não é bloqueante.

## Environment Availability

Não aplicável — esta phase não introduz nenhuma dependência de ambiente nova (sem CLI,
sem serviço externo novo, sem runtime novo). Usa Supabase (já conectado), recharts (já
instalado), Vitest (já configurado).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | `/root/garment-glow-test/vitest.config.ts` |
| Quick run command | `npx vitest run src/lib/precoMcoSeries.test.ts` |
| Full suite command | `npm run test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| (ad-hoc) MCO composição | `computeMco` reusado corretamente (custo+comissão+frete+ads+imposto) | unit | `npx vitest run src/lib/precoMcoSeries.test.ts` | ❌ Wave 0 |
| (ad-hoc) bandas gain/loss | cruzamento de linhas gera gainBand/lossBand mutuamente exclusivos | unit | idem | ❌ Wave 0 |
| (ad-hoc) custo/imposto ausente | `custoAusente`/`impostoAusente` refletem `qtd_sem_custo`/`qtd_sem_imposto` > 0 | unit | idem | ❌ Wave 0 |
| (ad-hoc) toggle ads | `incluirAds=false` zera `adsUnit` em todos os buckets | unit | idem | ❌ Wave 0 |
| (ad-hoc) divisão por zero | `qtd=0` não produz NaN/Infinity | unit | idem | ❌ Wave 0 |
| (ad-hoc) RPC estendida | smoke em prod como `authenticated`, 2–3 buckets batendo com soma manual SQL | manual (checkpoint) | consulta SQL via MCP `execute_sql` | ❌ Wave 0 (é um checkpoint, não um arquivo) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/precoMcoSeries.test.ts`
- **Per wave merge:** `npm run build && npm run test`
- **Phase gate:** `npm run build` + `npm run test` verdes antes do `/gsd-verify-work`.
  **Não usar `npx tsc -p tsconfig.app.json` como gate** — o projeto já tem erros
  pré-existentes nesse comando (lição registrada na spec/CONTEXT.md desta phase e em
  sessões anteriores).

### Wave 0 Gaps
- [ ] `src/lib/precoMcoSeries.test.ts` — novo arquivo de teste (padrão `mco.test.ts`,
  mesma pasta `src/lib/`)
- [ ] Nenhum framework/config novo — Vitest já cobre `src/**/*.test.ts`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | não | Nenhuma mudança de auth |
| V3 Session Management | não | — |
| V4 Access Control | **sim** | RLS `is_org_member`/SECURITY INVOKER em `orders`, `ml_ads_products_cache` — anti-IDOR já estabelecido (Phases 63/69); manter sem parâmetro de org na RPC estendida |
| V5 Input Validation | sim (leve) | Parâmetros da RPC já validados por tipo (SQL function signature); `_item_id`/`_ml_user_ids` já filtrados por RLS, não há input de usuário livre-forma nesta phase |
| V6 Cryptography | não | — |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR via parâmetro de org em RPC | Elevation of Privilege | SECURITY INVOKER (nunca DEFINER) + RLS `is_org_member` — já é o padrão de `orders_price_timeseries`; manter sem `p_org_id` |
| Vazamento de dados de ads/custo entre orgs | Information Disclosure | RLS org-first já confirmada em `ml_ads_products_cache` (`is_org_member`); `orders.tax_amount`/`custo_unit` já protegidos pela mesma RLS de `orders` |

## Sources

### Primary (HIGH confidence — leitura direta de código nesta sessão)
- `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` — componente atual a refazer
- `src/pages/mercadolivre/MLAnalisePrecos.tsx` — wrapper da página
- `src/lib/mco.ts` + `src/lib/mco.test.ts` — `computeMco` e padrão de teste
- `src/lib/tax/index.ts` + `src/lib/tax/perOrder.ts` — helpers de imposto (uso real: config/simulação, não agregação pós-venda)
- `src/hooks/useMLTaxConfig.ts` — hook de config fiscal (usado só em `MLAnuncios.tsx`/`SimuladorPrecificacao.tsx`)
- `src/components/mercadolivre/MLCostCard.tsx` — confirma que impostos vêm prontos via prop, não resolvidos no componente
- `supabase/migrations/20260677000000_orders_price_timeseries.sql` — RPC atual (Phase 77)
- `supabase/migrations/20260615120000_margin_with_ads_rpc.sql` — template de RPC com cmv/comissao/frete/tax_amount/ads já implementado
- `supabase/migrations/20260612120000_fix_cost_waterfall_fallback_and_upsert_preserve.sql` — `get_cost_waterfall`, origem de `total_tax` do `MLCostCard`
- `supabase/migrations/20260522_ads_products_daily.sql` — confirma coluna `date` em `ml_ads_products_cache`
- `supabase/functions/ml-ads/index.ts` — confirma sync real por item/dia, sem cron
- `supabase/functions/recalc-order-costs/index.ts` — confirma `tax_amount` calculado por pedido com UF real
- `supabase/migrations/20260423153544_937751fe-2ac3-4e2e-ba69-b7639fc1475e.sql` — RLS de `ml_ads_products_cache`
- `src/components/dashboard/KPICard.tsx` — variantes success/danger para KPI colorido por sinal
- `src/components/financial/CashFlowChart.tsx` — confirma ausência de precedente de banda colorida (não usar como template de banda, só de estilo geral)
- `vitest.config.ts` + `package.json` — comandos de teste/build

### Secondary (MEDIUM confidence)
- Nenhuma fonte externa consultada — todo o escopo desta phase foi resolvido por
  leitura de código do próprio repositório.

### Tertiary (LOW confidence)
- Técnica de "stacked area com base transparente" para bandas coloridas (Pattern 2) —
  conhecimento de treinamento sobre Recharts, não verificado via documentação externa
  nesta sessão (ver Assumptions Log A1/A2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero dependências novas, tudo já no projeto
- Architecture (RPC/tax/ads): HIGH — confirmado por leitura direta de migrations/edge functions reais
- Architecture (banda no gráfico): MEDIUM — técnica padrão da comunidade, sem precedente no repo, não verificada via doc externa nesta sessão
- Pitfalls: HIGH — `DROP FUNCTION` é comportamento documentado do Postgres; demais pitfalls vêm de lições já registradas no projeto

**Research date:** 2026-07-02
**Valid until:** 30 dias (stack estável — recharts/postgres não devem mudar; risco real é o schema de `orders`/`ml_ads_products_cache` mudar em phases futuras)
