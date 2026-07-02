# Análise de Preços "Em que preço vendo bem" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a tela de um anúncio em `/analise-precos` para responder "em que preço eu vendo bem?" com um histograma de faixas de preço (toggle Unidades↔Lucro) + veredito em português, aposentando o gráfico temporal como aba secundária.

**Architecture:** Um util puro novo (`precoFaixas.ts`) reagrupa os pontos diários já reconciliados de `computePrecoMcoSeries` **por faixa de preço** em vez de por tempo. O componente ganha um novo fetch diário para o histograma, um BarChart com toggle, veredito determinístico e 4 KPIs; o gráfico de linha atual é preservado dentro de uma aba/accordion secundária.

**Tech Stack:** React 18 + TypeScript + recharts 2.15 + shadcn/ui + Tailwind + vitest. Sem novas dependências.

## Global Constraints

- **Sem novas dependências** — usar recharts/shadcn/Tailwind já presentes.
- **Fonte de dados intocada** — RPC `orders_price_timeseries` e `computeMco`/`computePrecoMcoSeries` não mudam; o util novo só reagrupa pontos já reconciliados ao centavo.
- **Veredito determinístico** — nenhuma string de veredito vem de LLM; tudo é template sobre números.
- **Acessibilidade** — cor NUNCA é o único sinal: toda barra leva rótulo de margem %. Paleta CVD-safe validada no script da skill `dataviz` (light + dark) antes de fechar.
- **Named exports**, interfaces inline acima do componente, `camelCase` helpers, `PascalCase` componentes — seguir convenções de `src/components/mercadolivre/`.
- **Threshold de saúde** (`MCO_SAUDAVEL_PCT`): default `5` (%). Constante nomeada única — Wesley confirma/ajusta na validação em produção.
- **Supabase project real:** `ckcdevcxgvueywivefgx` (NÃO o do CLAUDE.md).

---

### Task 1: Util `precoFaixas.ts` — bucketização e agregação por faixa

**Files:**
- Create: `src/lib/precoFaixas.ts`
- Test: `src/lib/precoFaixas.test.ts`

**Interfaces:**
- Consumes: `McoSeriesPoint` de `src/lib/precoMcoSeries.ts` (campos usados: `precoUnit`, `qtd`, `mco`, `mcoPct`, `bucket`, `custoAusente`, `impostoAusente`). Entrada esperada = pontos **diários** (`computePrecoMcoSeries(dailyRows, { granularity: "day", ... })`).
- Produces:
  ```ts
  export type FaixaMode = "unidades" | "lucro";
  export interface FaixaPreco {
    min: number;              // borda inferior (inclusive)
    max: number;              // borda superior (exclusive); Infinity no bucket outlier
    label: string;            // "R$55–60" ou "+R$75"
    unidades: number;         // Σ qtd
    mcoRsTotal: number;       // Σ mco (R$)
    receita: number;          // Σ precoUnit*qtd
    precoMedio: number;       // receita/unidades (0 se unidades=0)
    mcoPctMedio: number | null; // mcoRsTotal/receita (fração) | null se receita=0
    isOutlierBucket: boolean;
    isPrecoAtual: boolean;    // contém o preço recente
    altura: number;           // = unidades (mode "unidades") ou mcoRsTotal (mode "lucro")
  }
  export interface FaixasResult {
    faixas: FaixaPreco[];
    larguraBucket: number;
    faixaOtima: FaixaPreco | null;   // maior altura conforme mode, entre faixas com unidades>0
    precoRecente: number | null;     // precoUnit do ponto diário de data máxima
    margemRecentePct: number | null; // mcoPctMedio da faixa que contém precoRecente
    totalUnidades: number;
    totalMcoRs: number;
  }
  export interface ComputeFaixasOpts { mode: FaixaMode }
  export function niceStep(x: number): number;
  export function computePrecoFaixas(daily: McoSeriesPoint[], opts: ComputeFaixasOpts): FaixasResult;
  ```

- [ ] **Step 1: Escrever o teste de `niceStep`**

```ts
// src/lib/precoFaixas.test.ts
import { describe, it, expect } from "vitest";
import { niceStep } from "./precoFaixas";

describe("niceStep", () => {
  it("snaps para passos redondos da série 1/2/5", () => {
    expect(niceStep(0.3)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(23)).toBe(50);
  });
  it("nunca retorna 0 ou negativo", () => {
    expect(niceStep(0)).toBeGreaterThan(0);
    expect(niceStep(-5)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /root/garment-glow-test && npx vitest run src/lib/precoFaixas.test.ts`
Expected: FAIL — "niceStep is not a function" / módulo não encontrado.

- [ ] **Step 3: Implementar `niceStep` + esqueleto do módulo**

```ts
// src/lib/precoFaixas.ts
import type { McoSeriesPoint } from "./precoMcoSeries";

export type FaixaMode = "unidades" | "lucro";

/** Snap de largura de bucket para a série "bonita" 1/2/5 × 10^n. Sempre > 0. */
export function niceStep(x: number): number {
  const v = Math.abs(x);
  if (!isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow; // [1,10)
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/precoFaixas.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Escrever os testes de `computePrecoFaixas`**

```ts
// adicionar em src/lib/precoFaixas.test.ts
import { computePrecoFaixas } from "./precoFaixas";
import type { McoSeriesPoint } from "./precoMcoSeries";

// Helper: ponto diário mínimo com os campos que o util usa.
function pt(bucket: string, precoUnit: number, qtd: number, mco: number): McoSeriesPoint {
  const receita = precoUnit * qtd;
  return {
    bucket, qtd, precoUnit,
    breakevenUnit: 0, cmvUnit: 0, comissaoUnit: 0, freteUnit: 0, adsUnit: 0, impostoUnit: 0,
    ads: 0, mco, mcoPct: receita > 0 ? mco / receita : null,
    base: 0, gainBand: 0, lossBand: 0, custoAusente: false, impostoAusente: false,
  };
}

describe("computePrecoFaixas", () => {
  it("agrupa dias por faixa de preço somando unidades e MCO", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800),   // faixa 55–60
      pt("2026-06-02", 58, 100, 900),   // faixa 55–60
      pt("2026-06-03", 62, 50, 700),    // faixa 60–65
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const f5560 = r.faixas.find((f) => f.min === 55)!;
    expect(f5560.unidades).toBe(200);
    expect(f5560.mcoRsTotal).toBe(1700);
    expect(r.totalUnidades).toBe(250);
    expect(r.totalMcoRs).toBe(2400);
  });

  it("faixaOtima em modo unidades é a de mais unidades; em modo lucro é a de mais MCO R$", () => {
    const daily = [
      pt("2026-06-01", 55, 300, 300),  // muitas unidades, pouco lucro
      pt("2026-06-02", 62, 100, 900),  // poucas unidades, muito lucro
    ];
    expect(computePrecoFaixas(daily, { mode: "unidades" }).faixaOtima!.min).toBe(55);
    expect(computePrecoFaixas(daily, { mode: "lucro" }).faixaOtima!.min).toBe(60);
  });

  it("agrega outliers de preço alto num único bucket +R$X", () => {
    const daily = [
      ...Array.from({ length: 10 }, (_, i) => pt(`2026-06-${10 + i}`, 56 + (i % 3), 100, 500)),
      pt("2026-06-25", 300, 1, 100), // outlier isolado
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    const outlier = r.faixas.find((f) => f.isOutlierBucket)!;
    expect(outlier).toBeTruthy();
    expect(outlier.label.startsWith("+R$")).toBe(true);
    expect(outlier.unidades).toBe(1);
    // não deve haver dezenas de faixas vazias entre 65 e 300
    expect(r.faixas.length).toBeLessThan(12);
  });

  it("marca a faixa do preço recente (ponto de data máxima) e sua margem", () => {
    const daily = [
      pt("2026-06-01", 56, 100, 800),
      pt("2026-06-05", 63, 100, 1200), // data máxima → preço recente 63
    ];
    const r = computePrecoFaixas(daily, { mode: "unidades" });
    expect(r.precoRecente).toBe(63);
    const atual = r.faixas.find((f) => f.isPrecoAtual)!;
    expect(atual.min).toBe(60);
    expect(r.margemRecentePct).toBeCloseTo(1200 / 6300, 5);
  });

  it("é defensivo: entrada vazia não quebra", () => {
    const r = computePrecoFaixas([], { mode: "unidades" });
    expect(r.faixas).toEqual([]);
    expect(r.faixaOtima).toBeNull();
    expect(r.precoRecente).toBeNull();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/lib/precoFaixas.test.ts`
Expected: FAIL — "computePrecoFaixas is not a function".

- [ ] **Step 7: Implementar `computePrecoFaixas`**

```ts
// adicionar em src/lib/precoFaixas.ts

export interface FaixaPreco {
  min: number; max: number; label: string;
  unidades: number; mcoRsTotal: number; receita: number;
  precoMedio: number; mcoPctMedio: number | null;
  isOutlierBucket: boolean; isPrecoAtual: boolean; altura: number;
}
export interface FaixasResult {
  faixas: FaixaPreco[]; larguraBucket: number; faixaOtima: FaixaPreco | null;
  precoRecente: number | null; margemRecentePct: number | null;
  totalUnidades: number; totalMcoRs: number;
}
export interface ComputeFaixasOpts { mode: FaixaMode }

function brlEdge(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}

/** Percentil ponderado por unidades sobre pares (preço, peso) já ordenados por preço. */
function weightedPercentile(sorted: { p: number; w: number }[], q: number): number {
  const total = sorted.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return sorted.length ? sorted[0].p : 0;
  const target = total * q;
  let acc = 0;
  for (const x of sorted) { acc += x.w; if (acc >= target) return x.p; }
  return sorted[sorted.length - 1].p;
}

export function computePrecoFaixas(daily: McoSeriesPoint[], opts: ComputeFaixasOpts): FaixasResult {
  const pts = daily.filter((d) => d.qtd > 0 && d.precoUnit > 0);
  if (pts.length === 0) {
    return { faixas: [], larguraBucket: 0, faixaOtima: null, precoRecente: null,
      margemRecentePct: null, totalUnidades: 0, totalMcoRs: 0 };
  }

  // Preço recente = ponto de bucket (data) máximo.
  const recente = pts.reduce((a, b) => (b.bucket > a.bucket ? b : a));
  const precoRecente = recente.precoUnit;

  // Distribuição de preço ponderada por unidades → p05/p95 concentram ~90% das vendas.
  const sorted = pts.map((d) => ({ p: d.precoUnit, w: d.qtd })).sort((a, b) => a.p - b.p);
  const pLow = weightedPercentile(sorted, 0.05);
  const pHigh = weightedPercentile(sorted, 0.95);
  const spread = Math.max(pHigh - pLow, precoRecente * 0.02, 1);
  const w = niceStep(spread / 8);
  const firstEdge = Math.floor(pLow / w) * w;
  const topEdge = Math.ceil(pHigh / w) * w;

  // Buckets regulares [firstEdge, topEdge) + 1 bucket outlier (≥ topEdge).
  type Acc = { min: number; max: number; unidades: number; mcoRsTotal: number; receita: number; isOutlier: boolean };
  const buckets: Acc[] = [];
  for (let e = firstEdge; e < topEdge; e += w) {
    buckets.push({ min: e, max: e + w, unidades: 0, mcoRsTotal: 0, receita: 0, isOutlier: false });
  }
  const outlier: Acc = { min: topEdge, max: Infinity, unidades: 0, mcoRsTotal: 0, receita: 0, isOutlier: true };

  const idxFor = (price: number): Acc => {
    if (price >= topEdge) return outlier;
    const i = Math.floor((price - firstEdge) / w);
    return buckets[Math.min(Math.max(i, 0), buckets.length - 1)] ?? outlier;
  };

  for (const d of pts) {
    const b = idxFor(d.precoUnit);
    b.unidades += d.qtd;
    b.mcoRsTotal += d.mco;
    b.receita += d.precoUnit * d.qtd;
  }

  const all = [...buckets, outlier].filter((b) => b.isOutlier ? b.unidades > 0 : true);
  const faixas: FaixaPreco[] = all.map((b) => {
    const contemAtual = precoRecente >= b.min && precoRecente < b.max;
    return {
      min: b.min, max: b.max,
      label: b.isOutlier ? `+R$${brlEdge(b.min)}` : `R$${brlEdge(b.min)}–${brlEdge(b.max)}`,
      unidades: b.unidades, mcoRsTotal: b.mcoRsTotal, receita: b.receita,
      precoMedio: b.unidades > 0 ? b.receita / b.unidades : 0,
      mcoPctMedio: b.receita > 0 ? b.mcoRsTotal / b.receita : null,
      isOutlierBucket: b.isOutlier, isPrecoAtual: contemAtual,
      altura: opts.mode === "lucro" ? b.mcoRsTotal : b.unidades,
    };
  });

  const comVenda = faixas.filter((f) => f.unidades > 0);
  const faixaOtima = comVenda.length
    ? comVenda.reduce((a, b) => (b.altura > a.altura ? b : a))
    : null;
  const faixaAtual = faixas.find((f) => f.isPrecoAtual) ?? null;

  return {
    faixas, larguraBucket: w, faixaOtima, precoRecente,
    margemRecentePct: faixaAtual?.mcoPctMedio ?? null,
    totalUnidades: pts.reduce((s, d) => s + d.qtd, 0),
    totalMcoRs: pts.reduce((s, d) => s + d.mco, 0),
  };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/lib/precoFaixas.test.ts`
Expected: PASS (todos os testes de `niceStep` + `computePrecoFaixas`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/precoFaixas.ts src/lib/precoFaixas.test.ts
git commit -m "feat(analise-precos): util precoFaixas — reagrupa pontos diarios por faixa de preco"
```

---

### Task 2: Util — veredito determinístico

**Files:**
- Modify: `src/lib/precoFaixas.ts`
- Test: `src/lib/precoFaixas.test.ts`

**Interfaces:**
- Consumes: `FaixasResult`, `FaixaMode` (Task 1).
- Produces:
  ```ts
  export const MCO_SAUDAVEL_PCT = 5;
  export type SaudePreco = "saudavel" | "apertada" | "prejuizo" | "sem-dados";
  export interface Veredicto {
    saude: SaudePreco;
    saudeTexto: string;   // frase 1
    otimoTexto: string;   // frase 2 (depende do mode)
  }
  export function classificarSaude(mcoPct: number | null): SaudePreco;
  export function computeVeredicto(r: FaixasResult, mode: FaixaMode): Veredicto;
  ```

- [ ] **Step 1: Escrever os testes**

```ts
// adicionar em src/lib/precoFaixas.test.ts
import { classificarSaude, computeVeredicto, MCO_SAUDAVEL_PCT } from "./precoFaixas";

describe("classificarSaude", () => {
  it("prejuízo < 0, apertada [0, threshold), saudável >= threshold", () => {
    expect(classificarSaude(-0.01)).toBe("prejuizo");
    expect(classificarSaude(0.02)).toBe("apertada");
    expect(classificarSaude(MCO_SAUDAVEL_PCT / 100)).toBe("saudavel");
    expect(classificarSaude(null)).toBe("sem-dados");
  });
});

describe("computeVeredicto", () => {
  const base = {
    faixas: [], larguraBucket: 5, precoRecente: 60, margemRecentePct: 0.17,
    totalUnidades: 250, totalMcoRs: 2400,
  };
  it("frase de saúde cita preço recente e margem", () => {
    const r: any = { ...base, faixaOtima: { label: "R$58–62", unidades: 200, mcoRsTotal: 1700, precoMedio: 59 } };
    const v = computeVeredicto(r, "unidades");
    expect(v.saude).toBe("saudavel");
    expect(v.saudeTexto).toContain("60");
    expect(v.saudeTexto).toContain("17");
  });
  it("modo unidades fala de volume; modo lucro fala de R$", () => {
    const r: any = { ...base, faixaOtima: { label: "R$58–62", unidades: 200, mcoRsTotal: 1700, precoMedio: 59 } };
    expect(computeVeredicto(r, "unidades").otimoTexto).toMatch(/unidade/i);
    expect(computeVeredicto(r, "lucro").otimoTexto).toMatch(/R\$/);
  });
  it("sem faixa ótima degrada com transparência", () => {
    const r: any = { ...base, faixaOtima: null, precoRecente: null, margemRecentePct: null };
    const v = computeVeredicto(r, "unidades");
    expect(v.saude).toBe("sem-dados");
    expect(v.otimoTexto.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/precoFaixas.test.ts`
Expected: FAIL — "classificarSaude is not a function".

- [ ] **Step 3: Implementar veredito**

```ts
// adicionar em src/lib/precoFaixas.ts
export const MCO_SAUDAVEL_PCT = 5;
export type SaudePreco = "saudavel" | "apertada" | "prejuizo" | "sem-dados";
export interface Veredicto { saude: SaudePreco; saudeTexto: string; otimoTexto: string }

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n >= 1000 ? 0 : 2 });
const pct = (frac: number) => `${(frac * 100).toFixed(0)}%`;

export function classificarSaude(mcoPct: number | null): SaudePreco {
  if (mcoPct == null) return "sem-dados";
  if (mcoPct < 0) return "prejuizo";
  if (mcoPct < MCO_SAUDAVEL_PCT / 100) return "apertada";
  return "saudavel";
}

export function computeVeredicto(r: FaixasResult, mode: FaixaMode): Veredicto {
  const saude = classificarSaude(r.margemRecentePct);
  const rotulo: Record<SaudePreco, string> = {
    saudavel: "saudável", apertada: "apertada", prejuizo: "no vermelho", "sem-dados": "sem dados",
  };

  let saudeTexto: string;
  if (r.precoRecente == null || r.margemRecentePct == null) {
    saudeTexto = "Ainda não há vendas suficientes para avaliar a saúde do preço atual.";
  } else {
    saudeTexto = `No preço mais recente (${brl(r.precoRecente)}) sua margem é ${pct(r.margemRecentePct)} — ${rotulo[saude]}.`;
  }

  let otimoTexto: string;
  const f = r.faixaOtima;
  if (!f) {
    otimoTexto = "Ainda não há variação de preço suficiente para comparar faixas.";
  } else if (mode === "unidades") {
    const m = f.mcoPctMedio != null ? `, ${pct(f.mcoPctMedio)} de margem` : "";
    otimoTexto = `Você vende mais na faixa ${f.label}: ${f.unidades.toLocaleString("pt-BR")} unidades${m}.`;
  } else {
    otimoTexto = `Seu maior lucro veio na faixa ${f.label}: ${brl(f.mcoRsTotal)} no período.`;
  }

  return { saude, saudeTexto, otimoTexto };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/precoFaixas.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/precoFaixas.ts src/lib/precoFaixas.test.ts
git commit -m "feat(analise-precos): veredito deterministico de preco (saude + faixa otima)"
```

---

### Task 3: Componente — histograma de faixas com toggle + veredito

**Files:**
- Modify: `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`

**Interfaces:**
- Consumes: `computePrecoFaixas`, `computeVeredicto`, `FaixaMode`, `classificarSaude` (Tasks 1–2); `computePrecoMcoSeries` (existente).
- Produces: nada para outras tasks (é UI). Introduz estado `faixaMode` e um fetch diário `dailyRows`.

- [ ] **Step 1: Adicionar fetch diário dedicado ao histograma**

Perto do fetch existente da RPC (após o bloco que popula `rows`, ~linha 228), adicionar um `useEffect` que busca a janela atual **sempre em granularidade diária**, independente do toggle de granularidade (que passa a ser só da aba temporal). Reusar o mesmo shape de chamada `(supabase.rpc as any)("orders_price_timeseries", { ..., _granularity: "day" })`, gravando em novo estado `const [dailyRows, setDailyRows] = useState<PrecoSeriesRow[] | null>(null);`. Deps: `[selectedId, mlUserIds, fromDate, toDate]` (sem `granularity`).

- [ ] **Step 2: Derivar pontos diários, faixas e veredito**

```tsx
const [faixaMode, setFaixaMode] = useState<FaixaMode>("unidades");

const dailyPoints = useMemo(
  () => computePrecoMcoSeries(dailyRows ?? [], { adsDaily, incluirAds, granularity: "day" }),
  [dailyRows, adsDaily, incluirAds],
);
const faixasResult = useMemo(
  () => computePrecoFaixas(dailyPoints, { mode: faixaMode }),
  [dailyPoints, faixaMode],
);
const veredicto = useMemo(
  () => computeVeredicto(faixasResult, faixaMode),
  [faixasResult, faixaMode],
);
```

- [ ] **Step 3: Renderizar o cartão-veredito acima do gráfico**

Bloco novo antes do gráfico: duas frases (`veredicto.saudeTexto`, `veredicto.otimoTexto`), a primeira com uma bolinha/realce de cor por `veredicto.saude` (`saudavel`→`--success`, `apertada`→`--warning`, `prejuizo`→`--destructive`, `sem-dados`→`--muted-foreground`). Usar classes/tokens já existentes (`text-kpi-positive/negative/neutral` ou `hsl(var(--success))`).

- [ ] **Step 4: Trocar o gráfico principal por um BarChart de faixas com toggle**

Substituir o `ComposedChart` temporal como **visão principal** por:
- Um `ToggleGroup` (shadcn, já usado no arquivo p/ granularidade) com dois itens: `Unidades` / `Lucro R$`, controlando `faixaMode`.
- Um `BarChart` (recharts) com `data={faixasResult.faixas}`, `XAxis dataKey="label"`, `YAxis` (unidades ou R$ conforme mode), `Bar dataKey="altura"` com `<Cell>` colorido por `classificarSaude(f.mcoPctMedio)` (verde/âmbar/vermelho) e `<LabelList>` mostrando a margem % no topo de cada barra.
- `ReferenceLine` / destaque na faixa `isPrecoAtual` (ex.: borda ou `<Cell>` com stroke) rotulada "seu preço recente".
- `Tooltip` custom: preço médio da faixa, unidades, margem %, MCO R$ total, receita.

Cores: reusar tokens `--success` / `--warning` / `--destructive` (checar em `src/index.css`; se faltar `--warning`, usar `--chart-breakeven` âmbar já existente).

- [ ] **Step 5: Rodar build + suíte**

Run: `cd /root/garment-glow-test && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc limpo, suíte verde, build ok.

- [ ] **Step 6: Commit**

```bash
git add src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
git commit -m "feat(analise-precos): histograma de faixas de preco com toggle unidades/lucro + veredito"
```

---

### Task 4: Componente — 4 KPIs enxutos + aba secundária "Evolução no tempo"

**Files:**
- Modify: `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx`

**Interfaces:**
- Consumes: `faixasResult` (Task 3), `kpis`/`deltas` existentes, `computePrecoMcoSeries` existente.
- Produces: nada (UI).

- [ ] **Step 1: Reduzir os KPIs para 4**

Trocar a grade atual de 6 KPIs por 4 cards: **Preço recente** (`faixasResult.precoRecente`), **Margem recente %** (`faixasResult.margemRecentePct`, cor pelo sinal via `classificarSaude`), **Faixa campeã** (`faixasResult.faixaOtima?.label ?? "—"`), **Unidades no período** (`faixasResult.totalUnidades`). Manter o comparativo vs. período anterior onde já existe delta (`deltas.precoMedio`, `deltas.qtd`, `deltas.mcoPp`); "Faixa campeã" não tem delta.

- [ ] **Step 2: Mover o gráfico temporal atual para uma aba/accordion secundária**

Envolver o `ComposedChart` temporal existente (preço + break-even + colchão + MCO% + BarChart de unidades) num `Accordion`/`Tabs` (shadcn) recolhido por padrão, rótulo "Evolução no tempo". O toggle de granularidade (`granularity`/`setGranularity`) e o fetch `rows` existente passam a servir **apenas** esta aba — mantidos intactos (view reconciliada preservada).

- [ ] **Step 3: Ajustar o rodapé de transparência**

Atualizar o texto do rodapé para descrever a nova visão principal (faixas de preço, toggle unidades/lucro, cor = margem, outliers agregados em "+R$X") mantendo a nota de fonte/reconciliação e avisos de custo/imposto ausente (`kpis.qtdSemCusto`, `kpis.temImpostoAusente`).

- [ ] **Step 4: Rodar build + suíte**

Run: `cd /root/garment-glow-test && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc limpo, suíte verde, build ok.

- [ ] **Step 5: Commit**

```bash
git add src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx
git commit -m "feat(analise-precos): 4 KPIs focados + evolucao no tempo como aba secundaria"
```

---

### Task 5: Cores acessíveis (CVD) + verificação final

**Files:**
- Modify: `src/index.css` (só se faltar token de margem)
- Modify: `src/components/mercadolivre/anuncios/PrecoPraticadoReport.tsx` (ajuste fino de cor, se necessário)

**Interfaces:**
- Consumes: tokens de cor do tema.
- Produces: nada.

- [ ] **Step 1: Validar a paleta de margem (verde/âmbar/vermelho) no validador da skill dataviz**

Rodar o script de validação CVD/contraste da skill `dataviz` (`references/palette.md`) com as 3 cores usadas nas barras, em light e dark. Ajustar tokens até PASS nos dois modos. Garantir que verde≠âmbar≠vermelho são distinguíveis em deuteranopia/protanopia.

- [ ] **Step 2: Confirmar rótulo em toda barra (cor não é sinal único)**

Verificar no código que `<LabelList>` de margem % aparece em todas as barras (incluindo outlier), atendendo à constraint de acessibilidade.

- [ ] **Step 3: Verificação end-to-end com a skill `verify`**

Invocar a skill `verify` para dirigir a tela `/analise-precos`: selecionar um anúncio com boa variação (ex.: MLB4113792113), conferir veredito, alternar o toggle Unidades↔Lucro (altura das barras e frase mudam), abrir a aba "Evolução no tempo". Rodar em light e dark.

- [ ] **Step 4: Rodar suíte + build finais**

Run: `cd /root/garment-glow-test && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "style(analise-precos): valida paleta CVD-safe das barras de margem (light+dark)"
```

---

## Self-Review

**Spec coverage:**
- §1 Faixa-veredito → Task 2 (util) + Task 3 Step 3 (render). ✓
- §2 BarChart faixas + toggle Unidades↔Lucro → Task 1 (`altura`/`faixaOtima` por mode) + Task 3 Steps 4. ✓
- §2 cor de margem + rótulo % + marcador preço atual + tooltip → Task 3 Step 4 + Task 5. ✓
- §3 bucketização com outlier agregado → Task 1 Step 7 (`niceStep`, `topEdge`, outlier bucket) + teste Step 5. ✓
- §4 4 KPIs com comparativo → Task 4 Step 1. ✓
- §5 evolução no tempo aba secundária → Task 4 Step 2. ✓
- Confiabilidade (mesma fonte reconciliada) → entrada = pontos de `computePrecoMcoSeries`; util só reagrupa. ✓
- Paleta CVD → Task 5. ✓

**Placeholder scan:** sem TBD/TODO; todo passo de código tem o código. Threshold de saúde é constante nomeada com default explícito (não placeholder). ✓

**Type consistency:** `FaixaPreco`/`FaixasResult`/`FaixaMode`/`Veredicto` definidos na Task 1–2 e consumidos com os mesmos nomes/campos nas Tasks 3–4. `computePrecoFaixas(daily, {mode})` e `computeVeredicto(result, mode)` batem entre definição e uso. `McoSeriesPoint` reusado do módulo existente. ✓
