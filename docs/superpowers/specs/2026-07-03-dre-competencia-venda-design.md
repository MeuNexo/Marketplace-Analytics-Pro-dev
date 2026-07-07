# DRE por Competência de Venda (método Tiny) — Design

**Data:** 2026-07-03
**Autor:** Nexo (sessão com Wesley)
**Página alvo:** `/vendas` → card `MLCostCard` (DRE do Mês)
**Supabase:** `ckcdevcxgvueywivefgx` (projeto real do garment; NÃO o do CLAUDE.md)

## Problema

A DRE do Mês aloca as tarifas do Mercado Livre pela **data de cobrança do ML** (`charge_date` /
lançamento na fatura), não pela **data da venda** que originou a tarifa. Isso causa dois defeitos:

1. **Descasamento de timing.** Um pedido vendido em junho e cancelado em julho tem a tarifa
   original (`C*`) em junho e o estorno (`B*`) em julho. O mês de junho carrega a tarifa cheia de
   uma venda que não gerou receita → o lucro do mês fica distorcido (hoje, conservador/subestimado).
2. **Estornos que somem.** A EF `sync-ml-billing` (`aggregateInvoice()`) **descarta** estornos de
   venda cujo `sale_date` cai fora da janela da fatura (regra `within`, para o total bater com o
   `total_amount` oficial da fatura). Esses estornos nunca entram na DRE.

Wesley quer a DRE operando **igual ao método da página "custos ecommerce" do Tiny**: escolhe-se o
mês e ele traz os dados **daquele mês por competência da venda**, independentemente de quando o ML
cobrou. Decisão: **mesmo método** (a DRE continua calculando do ML; Tiny é só a referência de
método, não a fonte de dados).

## Descoberta habilitadora

O endpoint ML `/billing/integration/.../details` **já entrega, em cada movimento**, a data da venda
original em `sales_info[].sale_date_time`. A EF já lê esse campo (`saleDate`,
`sync-ml-billing/index.ts:136`) mas o usa apenas para a regra `within` e depois **agrega por
`charge_date` e o descarta**. Portanto **não é necessário cruzar com a tabela `orders`** nem
heurística: a competência da venda está na origem.

## Decisões travadas com Wesley

- **Regime:** competência de venda para **TODAS** as tarifas (não só o estorno). (Abordagem A.)
- **Backfill:** re-sync das faturas de **2026** (ano corrente).
- **Seletor de mês:** **dropdown** de seleção direta no `MLCostCard` (hoje só há setas ◄ ►).
- **Fonte:** cálculo continua no ML; Tiny é referência de método.
- **Efeitos aceitos:** meses fechados se remexem; a DRE (competência) deixa de bater linha-a-linha
  com a fatura ML (por lançamento) — de propósito; estornos de venda antiga passam a contar.

## Arquitetura da mudança

### 1. Schema — `ml_billing_daily`

Nova coluna `competence_date date`:
- `competence_date` = `sale_date_time` do movimento quando existe;
- **fallback** `charge_date` quando o movimento não tem venda associada (mensalidade, ads `PADS`,
  tarifas de conta).

`charge_date` **permanece** (é o vínculo com a fatura oficial do ML, usado pela reconciliação
`ml_billing_monthly`). Grão de agregação passa de `(charge_date, charge_type)` para
`(competence_date, charge_date, charge_type)` por `source_invoice_key`.

Migration DROP/ALTER via MCP `apply_migration` no `ckcdevcxgvueywivefgx`. Backfill inicial da coluna:
`competence_date := charge_date` nas linhas existentes (até o re-sync sobrescrever com a venda real).

### 2. EF `sync-ml-billing` — `aggregateInvoice()`

- Agrega por `competence_date` (= `saleDate ?? charge_date`) além de `charge_date`.
- **Remove a exclusão `within`** na trilha de competência: todo movimento conta, alocado ao mês da
  sua venda. Sinal mantido (bonus/`B*` = negativo).
- A trilha de **fatura** (`ml_billing_monthly`, com `within`) permanece intacta — continua sendo a
  visão "igual à fatura ML" para reconciliação.
- Payload de gravação inclui `competence_date`. Delete-by-`source_invoice_key` + insert continua
  garantindo idempotência; a competência de um mês pode receber linhas de múltiplas faturas.
- Deploy via MCP `deploy_edge_function` (manter `verify_jwt=false` — auth própria).

### 3. DRE — `useMLBillingDaily` (`src/hooks/useMLBilling.ts`)

Trocar o filtro do range mensal de `charge_date` para `competence_date`:
`.gte("competence_date", from).lte("competence_date", to)`. Nenhuma outra mudança de UI na soma.
O guard de sync travado/parcial (`useMLBillingDailyWithSync`) permanece.

### 4. UI — dropdown de mês no `MLCostCard`

Adicionar um seletor `<Select>` (shadcn) de mês/ano ao lado das setas atuais, populado dos meses de
2026 até o mês corrente (trava no futuro, igual `canGoNext`). Selecionar um mês dispara a mesma
troca de período que as setas já fazem (`onPrevMonth`/`onNextMonth` → novo handler `onSelectMonth`).
Setas continuam funcionando. Estilo alinhado ao método Tiny ("pega o mês que quero").

### 5. Backfill 2026

Re-sync das faturas de jan/2026 → mês corrente (a EF roda por `source_invoice_key`; re-processa e
regrava com `competence_date`). Disparo via `net.http_post` lendo `service_role_key` do vault
(Pattern B), fan-out multi-conta, conforme padrão da sessão 2026-07-03.

## Reconciliação e validação

- **Duas visões, de propósito:** `ml_billing_daily` (competência de venda, a DRE) vs.
  `ml_billing_monthly` (por lançamento, = fatura ML). Não batem por mês — regimes diferentes.
- **Invariante de auditoria:** a soma de `amount` de `ml_billing_daily` sobre **todos os meses de
  competência** deve igualar a soma dos mesmos movimentos por lançamento **acrescida dos estornos
  antes descartados** (a correção). Verificar num script de smoke que nenhum movimento é perdido nem
  duplicado (dedup por `detail_id` na EF permanece).
- **Anti-IDOR:** a RPC/consulta continua escopada por `organization_id`/`ml_user_id`; smoke prova 0
  linhas cross-org.
- **Reconciliação ao centavo** de um mês de referência (ex.: junho/Pé Vermeio) contra o esperado.

## Fora de escopo

- Migrar `data_pedido` de `orders` para `timestamptz` (melhoria separada).
- Mudar a metodologia de receita/CMV/impostos (já corretas, vindas de `orders`).
- Alterar `ml_billing_monthly` / a reconciliação com a fatura ML.

## Riscos

- **Movimentos sem `sale_date`** mal classificados → fallback explícito para `charge_date`; testar
  `PADS`/mensalidade.
- **Re-sync reabrindo meses** → esperado e aprovado; comunicar no PR quais meses mudaram e quanto.
- **Perda/duplicação de movimento** na mudança de agregação → smoke de invariante obrigatório.
