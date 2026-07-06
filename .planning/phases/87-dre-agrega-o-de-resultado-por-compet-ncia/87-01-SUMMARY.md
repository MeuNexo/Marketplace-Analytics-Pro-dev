# 87-01 SUMMARY — RPC get_dre_operational_by_competence (aplicada em prod)

**Status:** ✅ COMPLETE — RPC aplicada e smoke-tested em produção (ckcdevcxgvueywivefgx), 2026-07-06.

## O que foi feito
- `supabase/migrations/20260687000000_get_dre_operational_by_competence.sql` aplicado via MCP apply_migration → `{success:true}`.
- RPC `public.get_dre_operational_by_competence(p_org_id uuid, p_month date)` → TABLE(bloco, category, total, n, financeiro_is_approximate). `LANGUAGE sql STABLE SECURITY INVOKER`, agregado plano por `competence_date` (sem subquery correlacionada → sem risco de timeout).

## Grafia das categorias (confirmada no banco vivo, mitiga bug Phase 85)
- **impostos_venda:** Imposto Venda - ICMS / PIS / COFINS
- **pessoal:** Salários, Pessoal - INSS
- **estrutura:** Aluguéis e condomínio, Água, luz, Telecomunicação, internet
- **servicos:** Contabilidade, Insumos, Itens do CD
- **financeiro:** Empréstimo (financeiro_is_approximate=TRUE)
- **excluido:** Fornecedores, Previsões de compra, Aporte, ADS Mercado Livre, Prestação de serviço do Mercado Envios Full, ADS Shopee, Ads Magazine Luiza, Vendas Mercado Livre, Vendas Magalu
- **outros_operacionais (bucket p/ Wesley classificar — NÃO dropado):** Serviços gerais (60), Impostos, taxas (113 residual), Cartão de crédito (38), Outros (38), Reembolso cliente (5), Veículos, transportes (2)

## Verificação
- Smoke 2025-05 (mês já backfillado): agregou por bloco (estrutura R$5.566,96; pessoal R$752; excluido R$49.861,42; outros_operacionais R$14.255,72). Estrutura correta.
- Privilégio: anon EXECUTE=false, authenticated=true, prosecdef=false (INVOKER). ✓

## Pendências (não fechadas de propósito — precisam do Wesley)
1. **Financeiro/juro:** RPC retorna Empréstimo com flag `financeiro_is_approximate=TRUE`; o juro NÃO foi separado do principal (SAC frágil na carência). Pendente tabela de amortização do banco.
2. **outros_operacionais (R$14k+/mês):** categorias ambíguas a classificar (esp. Serviços gerais, Impostos-taxas residual).
3. **87-02 (reconciliação junho/2026):** BLOQUEADA até o backfill da Phase 86 chegar a ≥90% de cobertura de competência de 2026 (drenando).

## SC (parcial)
- SC-1 (RPC agrega por competência + mapa): ✅ estrutural + smoke.
- SC-2 (exclusões + só ML): ✅ no CASE.
- SC-3 (sem IRPJ/CSLL/FGTS): ✅ (não existem no mapa).
- SC-4 (anti-IDOR + reconciliação): ⏳ 87-02 (INVOKER pronto; prova empírica pendente backfill).
