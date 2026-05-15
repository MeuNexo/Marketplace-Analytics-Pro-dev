# Stack Research — Tributação BR

## Summary

- Não existe biblioteca JS/TS madura para cálculo de tributos federais BR — implementar funções TypeScript puras em `src/lib/tax/`
- Lucro Presumido usa sistema **cumulativo**: PIS 0,65% + COFINS 3,00% = 3,65% sobre receita bruta (fixado em lei)
- Lucro Real usa sistema **não-cumulativo**: PIS 1,65% + COFINS 7,60% = 9,25% bruto, menos créditos (vendedor fornece os créditos)
- Simples Nacional: alíquota efetiva manual fornecida pelo contador é suficiente para v1 — embeber tabelas de Anexo/faixa é complexidade desnecessária agora
- Schema recomendado: tabela `ml_tax_config` com coluna `regime` (enum) + `config` (JSONB) — discriminated union em TypeScript + Zod valida o shape de cada regime

---

## Tax Calculation Approach

### Simples Nacional
```
imposto_valor = preco_venda × (aliquota_efetiva / 100)
imposto_pct   = aliquota_efetiva
```
O vendedor digita a alíquota efetiva que aparece no seu DAS (fornecida pelo contador). Não é necessário anexo ou faixa de faturamento no v1.

### Lucro Presumido
```
pis     = preco_venda × 0.0065   // 0,65% — cumulativo, fixo por lei
cofins  = preco_venda × 0.03     // 3,00% — cumulativo, fixo por lei
irpj    = preco_venda × (irpj_efetiva / 100)   // vendedor informa
csll    = preco_venda × (csll_efetiva / 100)   // vendedor informa
total   = pis + cofins + irpj + csll
```
PIS e COFINS são fixos e pré-preenchidos (editáveis). IRPJ e CSLL variam — vendedor informa a alíquota efetiva do seu contador.

### Lucro Real
```
pis_debito     = preco_venda × (pis_debito_pct / 100)     // pré-preencher 1,65%
cofins_debito  = preco_venda × (cofins_debito_pct / 100)  // pré-preencher 7,60%
pis_credito    = preco_venda × (pis_credito_pct / 100)    // vendedor informa
cofins_credito = preco_venda × (cofins_credito_pct / 100) // vendedor informa
total = (pis_debito + cofins_debito) - (pis_credito + cofins_credito)
```
ICMS pode ser adicionado com o mesmo padrão (débito - crédito). IRPJ/CSLL são calculados sobre o lucro real e geralmente tratados à parte — excluir do v1.

---

## Libraries / Formulas

| Abordagem | Recomendação | Motivo |
|---|---|---|
| Biblioteca BR | ❌ Não usar | Nenhuma library madura e mantida existe para tributos federais BR |
| Cálculo puro TS | ✅ Usar | Fórmulas simples; implementar em `src/lib/tax/index.ts` com funções puras e testáveis |
| Zod schemas | ✅ Usar | Validar o JSONB de config por regime com discriminated union |
| date-fns | Irrelevante | Sem cálculo de período neste módulo |

```typescript
// src/lib/tax/index.ts
export type TaxRegime =
  | { regime: "simples"; aliquota_efetiva: number }
  | { regime: "lucro_presumido"; pis: number; cofins: number; irpj_efetiva: number; csll_efetiva: number }
  | { regime: "lucro_real"; pis_debito: number; cofins_debito: number; pis_credito: number; cofins_credito: number };

export function calcTax(config: TaxRegime, price: number): { value: number; pct: number } {
  // ... per-regime calculation
}
```

---

## Schema Recommendations

```sql
CREATE TABLE public.ml_tax_config (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ml_user_id      text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  regime          text NOT NULL CHECK (regime IN ('simples', 'lucro_presumido', 'lucro_real')),
  config          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ml_user_id, organization_id)
);
```

**JSONB config shape por regime:**
```json
// simples
{ "aliquota_efetiva": 12.5 }

// lucro_presumido
{ "pis": 0.65, "cofins": 3.0, "irpj_efetiva": 4.8, "csll_efetiva": 2.88 }

// lucro_real
{ "pis_debito": 1.65, "cofins_debito": 7.6, "pis_credito": 0.8, "cofins_credito": 3.2 }
```

**Fallback:** `ml_product_costs.tax_rate` (por produto, manual) permanece como fallback quando loja não tem `ml_tax_config`.

---

## Confidence

| Recomendação | Confiança | Notas |
|---|---|---|
| Fórmulas Simples/LP | Alta | Taxas fixadas em lei; amplamente documentadas |
| Fórmulas Lucro Real (PIS/COFINS) | Alta | Regime não-cumulativo bem documentado; simplificação de IRPJ/CSLL é razoável para v1 |
| Sem biblioteca JS/TS | Alta | Nenhum pacote npm relevante e mantido encontrado |
| Schema JSONB | Média-Alta | Flexível para variações futuras; discriminated union Zod garante type safety |
| Simples com % manual | Alta | Abordagem usada por ferramentas similares; DAS já traz o % efetivo |
