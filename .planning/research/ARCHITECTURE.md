# Architecture Research — Tax Config Integration

## Summary

- Usar tabela dedicada `ml_tax_config` com colunas normalizadas por regime (não JSONB, não colunas em `ml_tokens`): schema queryável, constraint `CHECK` no `regime`, sem misturar domínio fiscal com autenticação ML
- Armazenar `effective_rate` como coluna derivada calculada por trigger no save — evita recomputação em toda leitura; o path de consumo no catálogo vira um simples read de coluna
- Consumo no frontend segue o pattern existente (`useMLProductCosts`): hook `useMLTaxConfig` com Supabase client direto, escopo por `ml_user_id` — sem nova camada de contexto
- A coluna Impostos no catálogo deriva o valor no frontend: `taxAmount = price × effectiveRate` — o hook fornece a taxa; `MLProdutos.tsx` já tem a aritmética; fallback para `ml_product_costs.tax_rate` é um null-coalesce simples
- RLS deve usar `organization_id` + `is_org_member` (padrão adotado desde a migration de 20260423), não `auth.uid() = user_id` (padrão antigo ainda presente em `ml_product_costs`)

---

## Recommended Schema

```sql
CREATE TYPE public.tax_regime AS ENUM (
  'simples_nacional',
  'lucro_presumido',
  'lucro_real'
);

CREATE TABLE public.ml_tax_config (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ml_user_id           text        NOT NULL,
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  regime               public.tax_regime NOT NULL,

  -- Simples Nacional
  sn_aliquota_efetiva  numeric(6, 4) DEFAULT NULL,

  -- Lucro Presumido
  lp_pis               numeric(6, 4) DEFAULT NULL,  -- padrão 0.65
  lp_cofins            numeric(6, 4) DEFAULT NULL,  -- padrão 3.00
  lp_irpj              numeric(6, 4) DEFAULT NULL,
  lp_csll              numeric(6, 4) DEFAULT NULL,

  -- Lucro Real
  lr_pis_debito        numeric(6, 4) DEFAULT NULL,  -- padrão 1.65
  lr_pis_credito       numeric(6, 4) DEFAULT NULL,  -- padrão 0
  lr_cofins_debito     numeric(6, 4) DEFAULT NULL,  -- padrão 7.60
  lr_cofins_credito    numeric(6, 4) DEFAULT NULL,  -- padrão 0
  lr_icms_debito       numeric(6, 4) DEFAULT NULL,
  lr_icms_credito      numeric(6, 4) DEFAULT NULL,

  -- Derivado pelo trigger no save
  effective_rate       numeric(6, 4) NOT NULL DEFAULT 0,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ml_tax_config_unique UNIQUE (ml_user_id, organization_id)
);
```

**Trigger calcula `effective_rate`:**
- Simples: `sn_aliquota_efetiva`
- Lucro Presumido: `lp_pis + lp_cofins + lp_irpj + lp_csll`
- Lucro Real: `(lr_pis_debito + lr_cofins_debito + COALESCE(lr_icms_debito,0)) - (lr_pis_credito + lr_cofins_credito + COALESCE(lr_icms_credito,0))`

---

## Data Flow

```
[Aba Fiscal — owner]
     │ upsert ml_tax_config
     ▼
[DB trigger] → calcula effective_rate, persiste
     │
     │ SELECT * FROM ml_tax_config WHERE ml_user_id = ANY(...)
     ▼
[useMLTaxConfig hook] → retorna Map<ml_user_id, effective_rate>
     │
     │ por linha do catálogo:
     ▼
taxRate  = taxConfigMap.get(item._ml_user_id)
         ?? productCost?.tax_rate        ← fallback manual existente
         ?? null
taxValue = taxRate != null ? item.price × (taxRate / 100) : null
     │
     ▼
[Coluna Impostos] exibe "R$ X,XX (Y,Y%)" ou "—"
```

Sem edge function. Sem DB view. Aritmética trivial no frontend.

---

## RLS Strategy

```sql
ALTER TABLE public.ml_tax_config ENABLE ROW LEVEL SECURITY;

-- Todos os membros leem (necessário para coluna do catálogo)
CREATE POLICY "ml_tax_config select"
  ON public.ml_tax_config FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Apenas owner escreve
CREATE POLICY "ml_tax_config insert"
  ON public.ml_tax_config FOR INSERT TO authenticated
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) = 'owner');

CREATE POLICY "ml_tax_config update"
  ON public.ml_tax_config FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

CREATE POLICY "ml_tax_config delete"
  ON public.ml_tax_config FOR DELETE TO authenticated
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');
```

Membros não-owner precisam de SELECT para popular a coluna de impostos no catálogo.

---

## Migration Strategy

`ml_product_costs.tax_rate` é preservado como está — continua sendo o fallback. Nenhuma migração de dados é necessária.

**Cadeia de fallback:**

| Loja tem `ml_tax_config`? | Produto tem `tax_rate` manual? | Coluna exibe |
|---|---|---|
| ✅ Sim | Qualquer | `effective_rate` do regime configurado |
| ❌ Não | ✅ Sim | `tax_rate` manual (comportamento atual inalterado) |
| ❌ Não | ❌ Não | `—` (comportamento atual inalterado) |

Taxas manuais por produto não são migradas: são por-produto, não por-loja, e não há regime a inferir delas.

---

## Build Order

| # | Tarefa | Arquivo | Depende de |
|---|---|---|---|
| 1 | DB migration: enum + tabela + trigger + RLS | `supabase/migrations/YYYYMMDD_ml_tax_config.sql` | — |
| 2 | Regenerar tipos TS | `src/integrations/supabase/types.ts` | 1 |
| 3 | Hook `useMLTaxConfig` | `src/hooks/useMLTaxConfig.ts` | 2 |
| 4 | Adicionar rota `/fiscal` em `roleAccess.ts` | `src/lib/roleAccess.ts` | — |
| 5 | Página `MLFiscal.tsx` | `src/pages/mercadolivre/MLFiscal.tsx` | 2, 3, 4 |
| 6 | Rota em `App.tsx` | `src/App.tsx` | 5 |
| 7 | Item no sidebar (owner only) | `src/components/layout/Sidebar.tsx` | 6 |
| 8 | Integração em `MLProdutos.tsx` | `src/pages/mercadolivre/MLProdutos.tsx` | 2, 3 |
