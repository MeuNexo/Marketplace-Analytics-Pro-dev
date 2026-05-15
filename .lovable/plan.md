## Objetivo

Adicionar custo (CMV), impostos, margem bruta e líquida em cada linha da tabela de Pedidos, KPIs e relatórios, considerando ICMS interestadual (origem ≠ destino) para lojas no regime Lucro Real.

---

## 1. Configuração fiscal (`/fiscal`)

Hoje a configuração é só por loja/regime, sem UF.

- Adicionar **UF de origem** por loja em `ml_tax_config` (campo `uf_origem`, ex.: "SP"). Editável no diálogo de configuração de cada loja.
- Para Lucro Real, adicionar campos de **alíquota ICMS por destino**:
  - `lr_icms_aliquota_intra` (UF destino = origem) — usa o `lr_icms_debito` atual como default.
  - `lr_icms_aliquota_inter_sul_sudeste` (destino SP/RJ/MG/RS/SC/PR exceto ES, vindo de SP/RJ/MG/RS/SC/PR) — default 12%.
  - `lr_icms_aliquota_inter_norte_nordeste` (destino N/NE/CO + ES) — default 7%.
- Para Simples Nacional e Lucro Presumido: nada muda (UF não afeta a alíquota efetiva).

A função `calculate_effective_rate()` continua igual; o ICMS por UF é aplicado no momento do cálculo por pedido (ver §3).

---

## 2. Snapshot por pedido (orders)

Adicionar colunas em `orders` preenchidas no `sync-ml-orders`:

- `custo_unit numeric` — copia do `product_costs.cost` no momento do sync (snapshot histórico).
- `tax_rate numeric` — alíquota efetiva aplicada (já considerando UF destino se Lucro Real).
- `tax_amount numeric` — `preco_unit * quantidade * tax_rate / 100`.
- `uf_origem text` — UF da loja no momento do sync.

Pedidos antigos ficam com NULL nas novas colunas; um botão "Recalcular custos/impostos" no header da página reaplica o snapshot para o período visível usando os valores atuais de `product_costs` + `ml_tax_config`.

---

## 3. Cálculo do imposto por pedido (lógica)

```text
regime = simples_nacional | lucro_presumido
  → tax_rate = effective_rate (igual hoje)

regime = lucro_real
  uf_dest = orders.estado
  uf_orig = ml_tax_config.uf_origem
  se uf_dest == uf_orig OU uf_dest é null:
    icms = lr_icms_aliquota_intra
  senão se destino em (N, NE, CO, ES):
    icms = lr_icms_aliquota_inter_norte_nordeste  (7%)
  senão:
    icms = lr_icms_aliquota_inter_sul_sudeste      (12%)
  tax_rate = (lr_pis_debito + lr_cofins_debito + icms)
           - (lr_pis_credito + lr_cofins_credito + lr_icms_credito)
  tax_rate = max(0, tax_rate)
```

Implementado dentro de `sync-ml-orders` (lê `ml_tax_config` da loja antes de gravar). Também replicado em util `src/lib/tax/perOrder.ts` para o botão de recálculo client-side.

---

## 4. UI — tabela de Pedidos

Novas colunas, na ordem (depois de Frete):

| Custo | Impostos | M. Bruta | M. Líquida |

- **Custo**: `custo_unit * quantidade`. Vermelho se NULL (sem custo cadastrado), com tooltip "Cadastre o custo em /anuncios".
- **Impostos**: `tax_amount` com `(tax_rate%)` em cinza menor.
- **Margem Bruta** = `(preco − custo) / preco * 100`.
- **Margem Líquida** = `(preco − custo − comissão − frete − impostos) / preco * 100`.
- Cores reaproveitam `marginColor()` existente (verde ≥60, âmbar ≥40, vermelho <40).
- Sort: adicionar `costs` e `taxes` ao `SortKey` (a coluna Margem já existe).

---

## 5. KPIs e Relatórios

KPIs do topo:
- "Margem líquida média" passa a usar `net_revenue − custos − impostos` (hoje só desconta comissão+frete).
- Novo KPI "Custos + Impostos" substituindo um dos cards menos usados, OU adicionar como subtitle no card de margem líquida.

Relatórios:
- **Top Produtos por Margem**: somar `costs` e `taxes` por produto; nova coluna "Custo+Imposto" e margem recalculada.
- **Custo por Tipo de Anúncio**: já mostra comissão+frete; adicionar linhas Custo e Impostos com seus % sobre receita.
- **Vendas por Estado**: ganha coluna "Imposto médio (%)" útil para visualizar o efeito do ICMS interestadual.

---

## 6. Banner de configuração faltante

Reaproveitar o padrão do Catálogo: se alguma loja do escopo não tem `ml_tax_config` ou (Lucro Real sem `uf_origem`), exibir banner amarelo no topo da página com link para `/fiscal`.

---

## Detalhes técnicos

**Migrações:**
- `ALTER TABLE ml_tax_config ADD COLUMN uf_origem text, lr_icms_aliquota_intra numeric, lr_icms_aliquota_inter_sul_sudeste numeric DEFAULT 12, lr_icms_aliquota_inter_norte_nordeste numeric DEFAULT 7;`
- `ALTER TABLE orders ADD COLUMN custo_unit numeric, tax_rate numeric, tax_amount numeric, uf_origem text;`
- Trigger `calculate_effective_rate()` permanece (continua sendo o fallback para SN/LP e referência geral).

**Edge function `sync-ml-orders`:**
- Carrega `ml_tax_config` + `product_costs` da loja antes do upsert.
- Calcula `tax_rate` por pedido conforme §3 e grava snapshot.

**Frontend:**
- `src/lib/tax/perOrder.ts` — função pura `computeOrderTax({regime, ufOrig, ufDest, config})`.
- `src/pages/mercadolivre/MLPedidos.tsx` — colunas, KPIs e relatórios atualizados; botão "Recalcular".
- `src/pages/mercadolivre/MLFiscal.tsx` — campos novos no diálogo do regime Lucro Real e UF origem em todos os regimes.
- Mapa `UF → região` (constantes em `src/lib/tax/regions.ts`).

**Não muda:**
- Coluna Impostos do Catálogo (continua com `effective_rate` da loja, sem UF, pois lá não há destino).
- `useMLProductCosts`, RLS, estrutura de cache de vendas.

---

## Fora de escopo (próxima iteração)

- Difal/partilha ICMS para consumidor final não-contribuinte (EC 87/15) — hoje usaríamos só a alíquota interestadual sem partilha.
- Substituição tributária por NCM.
- Tabela completa UF×UF customizável (modelo simplificado por região é suficiente p/ a maioria dos casos).
