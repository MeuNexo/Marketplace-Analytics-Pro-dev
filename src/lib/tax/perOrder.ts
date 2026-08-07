// A fórmula não mora mais aqui (Fase 220, TAX-01) — reexport fino de
// supabase/functions/_shared/orderTaxRate.ts, a fonte única compartilhada
// pelas duas Edge Functions e pelo frontend.
export {
  computeOrderTaxRate,
  type OrderTaxConfig,
  type AliquotaPedido,
  type MotivoAliquota,
} from "../../../supabase/functions/_shared/orderTaxRate.ts";
