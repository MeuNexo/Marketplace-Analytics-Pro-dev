# Phase 100: Break-even de caixa do mês - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Source:** Conversa de aprovação da Phase 99 (Wesley, 2026-07-17) — decisões capturadas ao vivo; autonomia concedida ("segue tudo, pare apenas se tiver dúvidas muito específicas")

<domain>
## Phase Boundary

Painel de previsão no topo da página `/dre-caixa` (mês corrente) respondendo: **"quanto falta entrar para o mês fechar no zero (ou na meta), e quanto preciso VENDER até que dia para isso acontecer?"** É a camada de PREVISÃO da DRE Caixa (Phase 99, recém-fechada) — informativa, nunca altera os números apurados.

**Fora do escopo:** alterar a cascata/apuração; mexer no Fluxo de Caixa; metas persistidas em banco (meta é client-side nesta phase); notificações.

</domain>

<decisions>
## Implementation Decisions

### A pergunta do painel (LOCKED — palavras do dono)
"Uma previsão para eu entender em que ponto a conta fecha, para saber que número preciso correr atrás — inicialmente ficar no zero a zero pelo menos."

### Matemática do gap (LOCKED)
```
SAÍDAS PREVISTAS DO MÊS
  já pagas (cash_outflows paid, outflow_date no mês)
+ a pagar até fim do mês (cash_outflows pending, outflow_date entre hoje e fim do mês; cancelled NUNCA)
+ previsão de estornos do restante do mês (taxa histórica de estornos × entradas previstas restantes)
+ previsão de imposto restante (usar a MESMA lógica/linha imposto_previsto da get_dre_cash — se a guia do mês ainda não foi paga, considerar o previsto; se já paga, zero adicional)

ENTRADAS
  já liberadas (cash_inflows net>0 por release_date ≤ hoje) — base cheia, igual Phase 99
+ agendadas a liberar até fim do mês (cash_inflows release_date > hoje e ≤ fim do mês) — dado REAL do MP (sync traz 45d)
+ projeção de vendas novas que ainda liberam no mês (ver conversão abaixo)

GAP = saídas previstas − entradas garantidas (sem a projeção de vendas novas)
VENDA NECESSÁRIA = gap ÷ taxa_venda_para_caixa, exibida com o DIA-LIMITE
```

### Conversão venda→caixa (LOCKED em conceito; calibração = medir dos dados)
- `taxa_venda_para_caixa` = (líquido/bruto médio dos últimos 60-90d de cash_inflows) × (1 − taxa de estornos histórica). Referências reais medidas na Phase 99: líquido/bruto ≈ 78%; estornos ≈ 10-15% do líquido. MEDIR na RPC, não hardcodar.
- `lag de liberação` (dias entre venda e liberação): estimar dos dados — na ausência de data da venda em cash_inflows, aproximar comparando a curva de liberações vs pedidos (orders.data_pedido) OU usar mediana simples configurável; entregar como constante calculada na RPC com método documentado. Dia-limite = último dia do mês − lag. Aviso no painel: "vendas a partir de {dia} só viram caixa no mês seguinte".

### Meta (LOCKED)
- Default = zero a zero. Campo editável no painel (client-side, ex. "sobrar R$ 20.000") que recalcula gap/venda necessária na hora. SEM persistência em banco nesta phase.

### Ritmo (LOCKED)
- "Ritmo necessário": venda bruta necessária ÷ dias restantes até o dia-limite.
- "Ritmo real": média diária de vendas brutas dos últimos 7 dias (orders paid/shipped/delivered por data_pedido).
- Semáforo: verde se ritmo real ≥ necessário; vermelho caso contrário; neutro se gap ≤ 0 ("mês já fecha na meta").

### Guarda anti-fantasma (LOCKED — BEC-04, lição de 2026-07-17)
Pendentes recorrentes idênticos (mesma categoria+valor repetidos em meses futuros) quase poluíram a projeção (recorrência acidental de ads/full no Tiny, 16.958,57/mês até jun/2027). O painel deve: (a) considerar só pendentes com vencimento DENTRO do mês corrente; (b) exibir aviso quando detectar padrão de recorrência suspeita entre os pendentes do mês (mesma dupla categoria+valor que também aparece em ≥2 meses futuros).

### Backend (LOCKED)
- 1 RPC nova: `get_dre_cash_forecast(p_org_id uuid, p_month date)` → linhas (categoria text, total numeric, n int) ou shape similar de single-row com colunas nomeadas — planner decide o shape, mas TUDO num round-trip. Padrão obrigatório idêntico à Phase 99: LANGUAGE sql STABLE SECURITY INVOKER SET search_path='public', REVOKE PUBLIC/anon + GRANT authenticated, CTEs MATERIALIZED, ZERO subquery correlacionada (timeout 8s do authenticated). Meta NÃO vai na RPC (aplicada client-side sobre o gap).
- Zero tabela/EF/cron novos. Migration única, apply via MCP pelo orquestrador (checkpoint), com provas: authenticated <8s + anti-IDOR org Thales real (SELECT id,name FROM organizations antes — NUNCA UUID de memória).

### Frontend (LOCKED)
- Card/painel "Fechar o mês" no TOPO da `/dre-caixa` (acima ou logo abaixo do badge), só para o mês corrente (mês passado selecionado → painel oculto).
- Lib pura `src/lib/dreCashForecast.ts` (matemática: gap, meta, venda necessária, dia-limite, ritmos, semáforo, guarda anti-fantasma) com testes vitest — mesmo padrão de dreCashCascade.ts.
- Hook `useDreCashForecast.ts` (TanStack Query, padrão dos irmãos).
- Linguagem para leigos: "Faltam R$ X para fechar no zero" / "Você precisa vender ~R$ Y até dia D" / "Ritmo atual: R$ Z/dia · Necessário: R$ W/dia".

### Separações (LOCKED — herdadas da Phase 99)
- NÃO ler saldo/initial_balance/get_cashflow/get_treasury_panel. DRE por faturamento intocada. Previsão nunca altera a cascata apurada.

### Claude's Discretion
- Shape exato do retorno da RPC; composição visual do card (reutilizar KPICard/padrões financeiros); método exato da estimativa de lag (documentar no SQL); microcopy final.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Padrões a clonar (Phase 99 — acabou de fechar nesta branch)
- `supabase/migrations/20260717030000_cash_inflows_refund_date.sql` — versão VIVA das RPCs get_dre_cash/get_dre_cash_history (cabeçalho canônico, CTEs, régua de entradas cheias/estornos por refund_date) — a forecast compõe com essas réguas
- `src/lib/dreCashCascade.ts` + `src/lib/dreCashCascade.test.ts` — padrão de lib pura + testes
- `src/hooks/useDreCash.ts` — padrão de hook RPC
- `src/pages/mercadolivre/MLDreCaixa.tsx` — página onde o card entra (ver estrutura de seções e o seletor de mês/selo "mês em andamento")
- `.planning/phases/99-*/99-CONTEXT.md` — decisões da Phase 99 (réguas de caixa) que esta phase compõe

### Dados
- `cash_inflows`: release_date, net_amount (negativo=estorno), gross_amount, refund_date (novo), a_liberar = release_date > hoje (sync 45d à frente)
- `cash_outflows`: outflow_date, amount, category, status paid/pending/cancelled; helper `public.dre_bloco_for_category(text)`
- `orders`: receita_bruta, data_pedido TEXT (usar `data_pedido::date`, WHERE idêntico ao das RPCs da 99), status IN ('paid','shipped','delivered')

### Orgs para provas
- Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7` (user impersonação `ce8c797c-f984-4abb-b5f1-3e2f2eecbb73`); anti-IDOR contra Thales `e4150d57-1349-48c9-9a89-82b1774857b0` (confirmar ao vivo antes)

</canonical_refs>

<specifics>
## Specific Ideas

- Números reais de referência (jul/2026 parcial, medidos hoje): entradas 120.848,36 · saídas 146.771,08 · resultado −25.922,72 — o painel de julho nasceria mostrando gap positivo a cobrir.
- O dado "a liberar" é o diferencial do produto (nenhuma planilha tem): dinheiro de vendas já feitas com data certa de liberação.
- Wesley validou a Phase 99 hoje linha a linha contra planilha e extrato MP — o painel herda essa confiança; qualquer número novo precisa ser explicável na mesma qualidade (drill/tooltip com a composição do cálculo).

</specifics>

<deferred>
## Deferred Ideas

- Meta persistida por org (banco) + histórico de metas.
- Notificação (Telegram/ClickUp) quando o ritmo real ficar abaixo do necessário por N dias.
- Break-even por SKU/campanha (ligação com MCO).

</deferred>

---

*Phase: 100-break-even-de-caixa-do-m-s-quanto-falta-vender-para-fechar-n*
*Context gathered: 2026-07-17 via decisões ao vivo com o dono*
