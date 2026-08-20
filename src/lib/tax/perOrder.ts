// A fórmula não mora mais aqui (Fase 220, TAX-01) — reexport fino de
// supabase/functions/_shared/orderTaxRate.ts, a fonte única compartilhada
// pelas duas Edge Functions e pelo frontend.
//
// `ehPosicaoCredora` e `liquidoSemDifalBruto` entram aqui no Quick 260820-ikj:
// a TELA precisa dizer quando o imposto foi lançado como zero por posição
// credora, e precisa fazer isso chamando o MESMO dono da conta
// "débitos − créditos" que a fórmula usa. Uma segunda cópia da subtração na UI
// é exatamente o que criou a Fase 220 — três cópias divergentes da mesma
// fórmula. O reexport é o que dá à tela um caminho por `@/lib/tax/perOrder`
// em vez de alcançar `supabase/functions/` direto.
export {
  computeOrderTaxRate,
  ehPosicaoCredora,
  liquidoSemDifalBruto,
  creditosQueAbatem,
  type OrderTaxConfig,
  type AliquotaPedido,
  type MotivoAliquota,
  type ComponentesFiscais,
} from "../../../supabase/functions/_shared/orderTaxRate.ts";
