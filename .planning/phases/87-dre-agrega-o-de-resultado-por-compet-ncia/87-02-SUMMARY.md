# 87-02 SUMMARY — Reconciliação DRE operacional de junho/2026

**Status:** ✅ COMPLETE — 2026-07-06. RPC reconciliada; **Phase 87 fechada** (exceto 2 pendências do Wesley).

## Total-closed (junho/2026, org 7f615df7, por competência)
- Σ RPC (todos blocos) = Σ `cash_outflows` competência junho = **R$210.460,56**; **delta R$0,00** ✅ — toda linha classificada, nada dropado.

## Blocos de junho/2026 (competência)
| bloco | R$ | linhas |
|---|---|---|
| excluido (CMV/Fornecedores/etc) | 139.968,41 | 35 |
| **pessoal** | 27.852,19 | 4 |
| **financeiro** (aprox.) | 20.027,82 | 2 |
| **outros_operacionais** | 15.865,69 | 2 |
| impostos_venda (guias) | 4.793,23 | 3 |
| **servicos** | 1.953,22 | 1 |
| **estrutura** | 0,00 | 0 |

## Anti-IDOR (SC-4)
- RLS `cash_outflows_select` = `is_org_member(auth.uid(), organization_id)` + RPC `SECURITY INVOKER` → caller só vê a própria org, independente de `p_org_id`. Prova estrutural pela política (impersonação empírica deferida).

## Achado p/ o Wesley (foto do resultado de junho)
- "Lucro antes" (DRE atual, Phase 84) = **+R$20.888** (receita 261.987 − CMV 110.613 − impostos est. 53.327 − tarifas ML 77.159).
- Custos operacionais NOVOS (fora do DRE atual): pessoal 27.852 + servicos 1.953 + estrutura 0 + financeiro(aprox) 20.028 + outros 15.866.
- **Só pessoal+serviços já leva junho a −R$8.917 (PREJUÍZO).** All-in fica mais negativo. **Junho fechou no vermelho após custos operacionais.**

## Pendências (bloqueiam número FINAL — Wesley)
1. **Financeiro aproximado:** R$20.028 inclui PRINCIPAL do empréstimo (2 linhas). Só o juro é custo. Pendente tabela de amortização do banco → juro real bem menor (~R$6-13k).
2. **outros_operacionais R$15.866:** categorias ambíguas (Serviços gerais, Impostos-taxas residual, Cartão de crédito) a classificar.
3. Nota: impostos_venda (guias R$4.793) NÃO somado à foto (o DRE atual já subtrai impostos estimados R$53.327 — timing de competência das guias difere; reconciliar impostos é trabalho à parte).
