# Phase 49 — VALIDAÇÃO PENDENTE (Wesley)

**Criado:** 2026-06-18 (fim de sessão)
**Status:** Implementação completa e deployada; AGUARDA validação de dados do Wesley.
**Branch:** `preview/phase-49-fluxo-caixa` (nada em prod Vercel ainda) · Supabase `ckcdevcxgvueywivefgx`

Wesley quer validar duas coisas antes de fechar a Phase 49:
1. **O fluxo de caixa está correto mesmo?**
2. **A projeção de 15 dias (2ª linha) está correta?**

## Como validar (1) — Fluxo de caixa base
- Card "Quanto tenho hoje?" (saldo inicial + entradas − saídas do dia): conferir contra o caixa real.
  - `initial_balance` vem de `financial_settings` (editável no botão "Ajustar saldo de hoje"). Confirmar que o valor configurado bate com o saldo real da conta hoje.
- **Entradas** = liberações reais do Mercado Pago (`cash_inflows`, EF `sync-mp-releases`). ⚠️ Risco conhecido: cash_inflows só tem dado de ~ontem pra frente (sem histórico). Validar se as liberações futuras agendadas batem com o extrato MP.
- **Saídas** = contas a pagar do Tiny (`cash_outflows`, EF `sync-tiny-payables`), QUALQUER status, por data (fix desta sessão). Conferir se as contas agendadas/pagas futuras batem com o Tiny.
- Total saídas 120d hoje = R$1.015.116,79; pessimista −R$1.003.445; data crítica 29/06. Conferir se faz sentido.

## Como validar (2) — Projeção média 15d
- Linha tracejada verde = `initial + Σ(média_diária − saídas_reais)`.
- **Média diária atual = R$4.884,74/dia** (orders.receita_liquida últimos 15d ÷ 15; 439 pedidos).
  - Conferir: esse valor representa bem o "recebimento médio" real? Se Wesley achar que deveria ser bruto, é R$8.419,60/dia (trocar `receita_liquida`→`receita_bruta` na migration).
- Pergunta de design em aberto: a média deve continuar sendo **líquida** (consistente c/ linha confirmada que é net MP) ou **bruta**?
- Verificar se a linha média fica coerente (acima/abaixo da confirmada) e se a inclinação reflete o ritmo de vendas.

## Pontos técnicos a revisar se algo não bater
- `cash_inflows` sem histórico → afeta tanto o card de entradas quanto qualquer SMA baseado nele (por isso o SMA veio de `orders`). Avaliar backfill histórico de MP releases se o card de entradas estiver incompleto.
- `receita_liquida` em orders: confirmar o que ela já desconta (fees? CMV? frete?) — define se é boa proxy de "dinheiro recebido".
- Frete/CMV/impostos: já há bug histórico de custo não chegando em orders (ver memória garment) — pode afetar receita_liquida.

## Arquivos/commits desta sessão
- Gráfico em branco fix + horizonte 120d: `744d58db`
- RPCs qualquer status: `5652ebfa` + migration `20260618210000` (aplicada)
- 2ª linha média 15d: `fe19611d` + migrations `20260618220000` / `20260618230000` (aplicada a final)
- Quick tasks: `260618-sum` (status fix), `260618-sma` (2ª linha — este doc)
