## Objetivo

Transformar `/precos-custos` em `/precificacao` — uma área de ferramentas de pricing com layout padrão do app e arquitetura preparada para múltiplas ferramentas via tabs. Primeira (e única hoje) ferramenta: **Simulador de Precificação**, refeito do zero com cálculo reativo, busca de produto por MLB/SKU e fórmula fiscal completa (impostos da config Fiscal, DIFAL, rebate, cupom, afiliado).

---

## 1. Renomeação e rota

- Adicionar nova rota `/precificacao` em `App.tsx` (mantém `/precos-custos` como redirect 301-like via `<Navigate>` para não quebrar links).
- `ApiSidebar.tsx` (linha 46): trocar label `"Preços e Custos"` → `"Precificação"`, ícone `DollarSign` → `Calculator`, path → `/precificacao`.
- `roleAccess.ts`: replicar permissão de `/precos-custos` para `/precificacao`.
- Renomear arquivo: `src/pages/mercadolivre/MLPrecosCustos.tsx` → `MLPrecificacao.tsx`. Conteúdo é totalmente reescrito.
- Memória: atualizar `mem://features/mercado-livre/...` se houver referência ao nome antigo.

## 2. Layout da página (padrão do app)

```text
┌─ MLPageHeader (sticky, padrão dos outros módulos ML) ─┐
│  Título: Precificação                                  │
│  Subtítulo: Ferramentas para definir preço de venda    │
│  Slot direito: SellerMarketplaceBar                    │
├─ Tabs (framer-motion, padrão do app) ──────────────────┤
│  [Simulador]  (futuro: Tabela de preços, Reprecificação│
│                automática, Análise competitiva, etc.)  │
├─ Conteúdo da tab ──────────────────────────────────────┤
│  <SimuladorPrecificacao />                             │
└────────────────────────────────────────────────────────┘
```

- Usa `MLPageHeader` (mesmo componente de `MLFiscal`, `MLAnuncios` etc.) para coerência visual.
- Tabs em estilo idêntico ao consolidado de Vendas/Relatórios (memória `dashboard-consolidation`).
- Um único arquivo `MLPrecificacao.tsx` (page) + `src/components/mercadolivre/precificacao/SimuladorPrecificacao.tsx` (componente da ferramenta). Estrutura preparada pra adicionar mais ferramentas como irmãs.

## 3. Simulador — UX

Layout em duas colunas no desktop (lg:grid-cols-[1fr_420px]), uma coluna no mobile:

**Coluna esquerda — inputs (cálculo reativo, sem botão "Calcular"):**

1. **Buscar produto** (Card no topo)
   - Input `Combobox` (cmdk) com placeholder "Buscar por MLB ou SKU…"
   - Lista os anúncios ativos da loja selecionada (já vem de `useMLPrecosCustos.items`).
   - Ao selecionar, pré-preenche: título, thumb, `item_id`, `category_id`, `listing_type_id`, `price_sale` (sugestão de preço inicial), `cost` e `tax_rate` (de `ml_product_costs` via novo hook), e `regime` + UF de origem (de `ml_tax_config` via `useMLTaxConfig`).
   - Botão "Limpar" remove o produto selecionado e libera todos os campos para edição livre.

2. **Produto** (depois de selecionado, ou modo manual)
   - Custo do produto (R$) — editável
   - Tipo de anúncio: `gold_pro` / `gold_special` (Select) — pré-preenchido se buscado

3. **Logística**
   - Modal/Select: Full, Drop Off, Flex, Envio próprio
   - Custo de frete (R$) — auto-estimado, editável

4. **Tributação**
   - Badge mostrando regime herdado de Fiscal ("Simples Nacional 8,5%" etc.) com link "Editar em /fiscal".
   - UF de origem (read-only, vinda de `ml_tax_config.uf_origem` quando regime = `lucro_real`)
   - **UF de destino** (Select obrigatório no Lucro Real) — usado pra DIFAL/ICMS interestadual via `regions.ts`
   - Toggle "Override manual" → libera campo "Alíquota efetiva (%)" que sobrescreve o cálculo automático.
   - Para Lucro Real: mostra breakdown automático (ICMS débito por UF destino via `lr_icms_aliquota_intra/inter_sul_sudeste/inter_norte_nordeste`, PIS/COFINS débito − créditos), e calcula DIFAL quando UF destino ≠ origem e for consumidor final (toggle "Venda a consumidor final / DIFAL").

5. **Descontos extras** (Card colapsável "Descontos extras", default fechado)
   Cada subitem tem: toggle on/off + select (% ou R$) + input numérico. Ordem:
   - Rebate Mercado Livre
   - Cupom do vendedor
   - Comissão de afiliado
   - Desconto promocional (livre)

6. **Margem desejada / Markup** (Card "Objetivo")
   - Toggle entre "Margem (%)" e "Markup (%)"
   - Input do alvo
   - Mostra abaixo: "Preço sugerido para atingir alvo: R$ X,XX" (calculadora reversa embutida, recalcula ao vivo)
   - Botão "Aplicar este preço" copia pro campo "Preço de venda".

**Coluna direita — resultado em tempo real (sticky no desktop):**

- **Card "Preço de venda"** com input grande, formato monetário pt-BR. Editar aqui dispara recálculo instantâneo de toda a coluna.
- **Breakdown vertical** com cores semânticas:
  ```text
  Receita bruta              R$ 100,00
  − Comissão ML (16%)        R$  16,00
  − Taxa fixa                R$   6,00
  − Frete                    R$   8,50
  − Imposto efetivo (12%)    R$  12,00
  − Rebate                   R$   2,00
  − Cupom                    R$   0,00
  − Afiliado                 R$   0,00
  − DIFAL                    R$   1,80
  ─────────────────────────
  Receita líquida            R$  53,70
  − Custo do produto         R$  40,00
  ─────────────────────────
  Lucro                      R$  13,70  ← destacado
  Margem                       13,7%    ← cor por faixa
  Markup                       34,3%
  ROI                          34,3%
  Ponto de equilíbrio        R$  73,42
  ```
- Badge no topo: "Lucro" verde / amarelo / vermelho conforme faixa (≥20 / 10–20 / <10).
- Mini-gráfico opcional (recharts) "Margem x Preço" com 5 pontos ao redor do preço atual, pra visualizar sensibilidade.

## 4. Lógica de cálculo (resumo)

Tudo vive em `src/lib/pricing/calculator.ts` (novo, puro, testável):

```text
input  = { cost, listingType, salePrice, shippingCost, commissionPct,
           fixedFee, taxPct, difalPct, rebate{type,value},
           cupom{...}, afiliado{...}, promo{...} }

receita_bruta     = salePrice
comissao          = salePrice * commissionPct / 100
imposto           = salePrice * taxPct / 100
difal             = (modo consumidor final && UF dest ≠ orig) ? salePrice * difalPct / 100 : 0
deducoes_extras   = soma de rebate/cupom/afiliado/promo (resolvendo % vs R$)
receita_liquida   = receita_bruta − comissao − fixedFee − shippingCost
                    − imposto − difal − deducoes_extras
lucro             = receita_liquida − cost
margem_pct        = lucro / receita_bruta × 100
markup_pct        = lucro / cost × 100
roi_pct           = lucro / cost × 100
break_even        = (cost + fixedFee + shippingCost) /
                    (1 − (commissionPct + taxPct + difalPct + extras_pct) / 100)

reverse(targetMargin):
  denom = 1 − (commissionPct + taxPct + difalPct + extras_pct + targetMargin) / 100
  preço = (cost + fixedFee + shippingCost) / denom
```

Comissão e taxa fixa: API ML via `useMLPrecosCustos.fetchCosts` (já existente). Chamada **debounced** (300ms) só quando `salePrice` ou `logisticType` mudam — o resto é puro front, instantâneo.

DIFAL simplificado MVP: `difalPct = aliquota_intra_destino − aliquota_inter_origem→destino`. Como não temos tabela das alíquotas internas de cada UF destino, usamos um campo "Alíquota interna UF destino (%)" editável (default 18%) ao ativar o toggle DIFAL. Avisar via tooltip que é estimativa.

## 5. Dados / hooks

- **Reusar** `useMLPrecosCustos` (busca `items`, `fetchCosts`).
- **Reusar** `useMLTaxConfig` para regime + UF origem + alíquotas Lucro Real.
- **Reusar** `useMLProductCosts` para `cost` e `tax_rate` por `item_id` (já tem upsert; aqui só leitura).
- **Reusar** `src/lib/tax/index.ts` (`calculateEffectiveRate`) e `src/lib/tax/regions.ts` (`isReducedInterstateDest`).
- Novo: `src/lib/pricing/calculator.ts` + `calculator.test.ts` (vitest, casos: SN, LP, LR com crédito, DIFAL on/off, descontos %/R$, reversa).

## 6. Sem mudanças de schema

Nenhuma migration necessária — todos os dados vêm de tabelas existentes (`ml_tax_config`, `ml_product_costs`, `ml_user_cache`, API ML). DIFAL e descontos extras são puramente locais ao simulador (não persistem por enquanto).

## 7. Detalhes técnicos

- Estado do simulador num único `useReducer` para evitar dezenas de `useState` e simplificar o reset ao trocar produto.
- Formatação monetária: util compartilhado pt-BR (`formatBRL`).
- Inputs aceitam vírgula ou ponto; parseamento centralizado.
- Mobile: coluna direita vira card colapsável fixo no rodapé com lucro/margem resumidos; expande pra ver breakdown completo.
- Tema: tokens semânticos (`text-emerald-600` etc. ok pelas memórias atuais; sem hex hardcoded).

## 8. Fora de escopo (futuras tabs)

- Reprecificação automática em massa
- Tabela comparativa de preços ABC
- Histórico de simulações salvas
- Análise competitiva (já existe parcialmente em referências de preço — pode virar tab futura)
