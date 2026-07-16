# DRE Caixa — apuração por recebimento do Mercado Pago

**Data:** 2026-07-16 · **Autor:** Wesley + Claude · **Status:** aprovado em conversa, aguardando revisão da spec

## 1. Problema e objetivo

A DRE atual (página Vendas) parte do **faturamento** (pedidos por `data_pedido`) e abate comissão, frete, tarifas ML, ads e despesas de forma sistêmica. Isso nunca é conferido contra o dinheiro que **realmente entrou** no Mercado Pago — pode inflar ou esconder inconsistência.

**Pergunta que a DRE Caixa precisa responder, em destaque, todo mês:**

> "O que entrou no mês pagou as contas do mês, ou tive que tirar dinheiro de outro lugar?"

A DRE por faturamento **não é alterada nem removida** — fica na página Vendas como instrumento de confronto futuro (detectar tarifas ML divergentes do configurado). O "monitor de venda" (tarifa configurada por anúncio × cobrada por venda) é plano futuro, fora desta spec.

## 2. Decisões travadas (conversa 2026-07-16)

| Decisão | Valor |
|---|---|
| Base de entradas | Recebimento **líquido** MP (`cash_inflows.net_amount`) por **`release_date`** (data de liberação) |
| Tarifas ML | NÃO abatidas de novo — já vêm retidas na fonte dentro do net. Diferença bruto−líquido exibida como informativo |
| Régua de saídas | **Caixa puro**: `cash_outflows` com `status='paid'`, pela data de pagamento (`outflow_date`), no mês |
| Imposto | Guia **paga no mês** entra como saída real. Além disso, linha **informativa** de previsão: % médio (guias pagas ÷ faturamento) dos últimos 3 meses fechados × faturamento do mês corrente, com alerta de desvio |
| Escopo de entradas | **Só Mercado Pago** (vendas ML). Aportes/cofrinho continuam excluídos pelo sync. Sem entradas manuais nesta fase |
| Blocos de categoria | Reaproveitar o mapa categoria→bloco existente (`dre_bloco_for_category`): impostos_venda, pessoal, estrutura, servicos, operacional, financeiro, nao_classificado, excluido |
| UI | **Página nova dedicada** `/dre-caixa`, desenhada para evoluir a dashboard financeiro no futuro |
| Separação do Fluxo de Caixa | A DRE Caixa **não lê nem confronta** saldo, `initial_balance`, projeções ou qualquer número da página /fluxo-de-caixa. São coisas distintas: lá é posição/projeção de caixa; aqui é apuração de resultado do mês. Compartilham apenas as tabelas-fonte (`cash_inflows`/`cash_outflows`) |
| Refunds | `net_amount` já vem negativo — a base já desconta; linha informativa "dos quais devoluções" só dá visibilidade |

## 3. Dados — tudo já existe em produção

- **`cash_inflows`** (Phase 49): payment-level MP, `release_date`, `net_amount`, `gross_amount`, `status_mp`, `synced_at`. Sync: EF `sync-mp-releases` a cada 3h, janela histórica 30d + **futura 45d** (liberações agendadas). Filtra `order.type='mercadolibre'`.
- **`cash_outflows`**: contas do Tiny (EF `sync-tiny-payables`, 3h), `outflow_date`, `status` (pending/paid/cancelled), `category`, `supplier`, `competence_date`.
- **`orders`**: faturamento por `data_pedido` (para o denominador da previsão de imposto).
- Nenhuma tabela, EF ou cron novos.

## 4. Cascata do mês

```
Recebimento bruto MP .................... informativo (Σ gross_amount)
(−) Descontos na fonte .................. informativo (bruto − líquido)
    dos quais devoluções/refunds ........ informativo (Σ net_amount onde status_mp='refunded')
= RECEBIMENTO LÍQUIDO MP ................ Σ net_amount, release_date no mês, release_date ≤ hoje

(−) Impostos (guias pagas no mês)
(−) Pessoal
(−) Estrutura
(−) Serviços
(−) Operacional
(−) Não classificado .................... gate visual (mesma regra da DRE atual)
= RESULTADO OPERACIONAL DE CAIXA

(−) Financeiro (empréstimos etc. pagos)
= RESULTADO DE CAIXA DO MÊS
```

**Informativos (não somam no resultado):**
- Previsão de imposto do mês (fórmula da seção 2) × guia real paga, com alerta de desvio.
- "Ainda a liberar no mês": Σ net_amount com release_date > hoje e ≤ fim do mês.

## 5. Backend — 3 RPCs

Padrão obrigatório: `LANGUAGE sql STABLE SECURITY INVOKER SET search_path='public'`, 1º arg `p_org_id uuid`, RLS decide acesso, `REVOKE FROM PUBLIC, anon; GRANT TO authenticated`. Sem subquery correlacionada (lição do timeout 8s do role authenticated — pré-carregar lookups em CTE).

1. **`get_dre_cash(p_org_id uuid, p_month date)`** → linhas `(secao text, bloco text, categoria text, total numeric, n int)`. Seções: `entrada` (bruto, descontos_fonte, refunds, liquido, a_liberar), `saida` (por bloco+categoria, só paid no mês), `previsao` (imposto_previsto, imposto_guia_paga, faturamento_mes). Cascata e totais montados no frontend (lib pura).
2. **`get_dre_cash_items(p_org_id uuid, p_month date, p_bloco text)`** → lançamentos individuais do bloco (`outflow_date, supplier, category, amount`) para o drill-down, sob demanda.
3. **`get_dre_cash_history(p_org_id uuid, p_months int)`** → por mês (até 12): `(mes date, entradas numeric, saidas numeric, resultado numeric)`.

Previsão de imposto (dentro da RPC 1): para cada um dos 3 meses fechados anteriores, `taxa_m = guias pagas no mês (bloco impostos_venda) ÷ faturamento do mês (orders paid/shipped/delivered)`; previsão = média(taxa_m) × faturamento do mês corrente. Se não houver 3 meses com dados, usar os que existirem; se nenhum, previsão = null (frontend mostra "—").

## 6. Frontend — página `/dre-caixa`

Rota lazy + RoleRoute + item no menu (grupo financeiro, junto de Fluxo de Caixa).

Layout (topo → baixo):
1. **Header**: seletor de mês + **badge-resposta**: verde "As entradas do mês pagaram as contas — sobrou R$ X" / vermelho "Faltou R$ X — esse dinheiro saiu de outro lugar". Mês corrente ganha selo "mês em andamento".
2. **KPI row** (4 tiles): Entradas líquidas MP · Saídas pagas · Resultado do mês · Previsão imposto × guia (com alerta de desvio).
3. **Cascata detalhada** com drill-down: bloco → categorias → lançamentos (`get_dre_cash_items` sob clique).
4. **Evolução 12 meses**: gráfico entradas × saídas × resultado (embrião do dashboard futuro).
5. **Tabela histórico mensal** (12 meses, resultado por mês).
6. **Banner de dado velho**: se `max(synced_at)` de `cash_inflows` > 6h, alerta (lição de 2026-07-13).

Código novo:
- `src/pages/mercadolivre/MLDreCaixa.tsx` (página)
- `src/hooks/useDreCash.ts`, `useDreCashItems.ts`, `useDreCashHistory.ts` (TanStack Query, padrão dos demais)
- `src/lib/dreCashCascade.ts` — **lib pura** que transforma as linhas da RPC na cascata + badge (testada com vitest, espelho de `dreCascade.ts`)
- Componentes visuais reutilizam padrões de `src/components/financial/` e do `MLCostCard`

## 7. Erros e edge cases

- Mês sem dados → cascata zerada, badge neutro "sem movimentação".
- Mês corrente: entradas só até hoje; "a liberar" separado; nunca apresentar resultado parcial como final.
- Refunds atravessando mês (venda em M, refund liberado em M+1): entra no mês do `release_date` do refund — é caixa, está correto por definição.
- Saídas `cancelled` sempre excluídas (regra já existente).
- `nao_classificado` > 0 → mesmo aviso visual da DRE atual.
- Divergência sync: banner de dado velho cobre inflows; outflows dependem do token Tiny (falha conhecida de 07-13 — o banner também exibe `max(synced_at)` de outflows).

## 8. Testes e provas (gate de fechamento)

1. Vitest na lib pura `dreCashCascade.ts` (cascata, badge, mês vazio, previsão null).
2. Provas SQL executadas como **role `authenticated`** (nunca só postgres), incluindo tempo < 8s.
3. **Anti-IDOR**: RPC chamada impersonando usuário da org A contra org B **real existente** (`SELECT id, name FROM organizations` — nunca completar UUID de cabeça) → 0 linhas.
4. **Reconciliação**: total de entradas de um mês fechado × extrato/painel MP, conferido pelo Wesley antes de fechar.
5. Ok visual do Wesley na página.

## 9. Fora de escopo (futuro)

- Confronto automático DRE faturamento × DRE caixa (o "confere").
- Monitor de venda: tarifa configurada por anúncio × cobrada por venda.
- Entradas manuais (Bradesco, aportes).
- Evolução da página para dashboard financeiro completo.
