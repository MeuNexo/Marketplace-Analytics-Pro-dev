# Phase 51: Painel de Tesouraria (Fluxo de Caixa) - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Substituir os 3 cards atuais da aba "Caixa Real" da pagina de Fluxo de Caixa
(`MLFluxoCaixa.tsx`) por um painel de tesouraria orientado a saude de caixa e
exposicao a fornecedores. Entregaveis:

- **12 KPIs** em 3 faixas (Saude de Caixa, Realizado, Exposicao a Fornecedor)
- **3 graficos**: Saldo Projetado (reuso do `CashFlowChart`), Composicao de
  Custos por Mes (por categoria), Exposicao por Fornecedor (30/60/90d)

A aba "Simulador" (Phase 50) e **preservada e intocada**. O card "Posso comprar
mais estoque?" (`CapacityCard`) e **removido**. Os cards "Caixa Hoje"
(`TodayBalanceCard`) e "Projecao Futura" (`ProjectedBalanceCard`) tambem saem —
os 12 KPIs os substituem (decisao D-01).

**Out of scope:** novas fontes de dados (tudo ja existe em cash_inflows /
cash_outflows / orders), mudancas no Simulador, novas integracoes ML/Tiny.
</domain>

<decisions>
## Implementation Decisions

### Substituicao de cards
- **D-01:** Os 12 KPIs substituem os **3 cards atuais** (Caixa Hoje, Projecao
  Futura, Capacidade de Compra). Painel identico a referencia visual do Wesley.
  Remover `TodayBalanceCard`, `ProjectedBalanceCard`, `CapacityCard` da pagina.

### Definicao dos 12 KPIs (3 faixas)
Faixa 1 — **Saude de Caixa**:
- **D-02 Saldo Atual:** saldo de caixa corrente (`current_balance` do
  `get_projected_balance_summary`, ja existente).
- **D-03 Runway (meses):** `Saldo Atual / Burn Rate`. Validado na referencia:
  19.155 / 124.942 = 0,15 meses.
- **D-04 Saldo Minimo (90d):** menor saldo projetado nos proximos **90 dias**
  (hoje a projecao e 120d — usar horizonte 90d para este KPI). Mostra valor +
  a data (`min_balance` + `critical_date`, ajustar horizonte para 90d).
- **D-05 Data do Saldo Minimo:** data em que o saldo minimo de 90d ocorre.
- **D-06 Alerta:** mensagem "saldo vai abaixo de R$X em DD/MM/AAAA" quando a
  projecao cruza o limite configuravel (ver D-10).

Faixa 2 — **Realizado**:
- **D-07 Entrada/Saida/Resultado Real:** janela = **ultimos 30 dias**
  (escolha explicita do Wesley). Entrada = somatorio de cash_inflows realizados
  nos ultimos 30d; Saida = somatorio de cash_outflows pagos nos ultimos 30d;
  Resultado = Entrada - Saida.
- **D-08 Burn Rate:** **media mensal das saidas dos ultimos 3 meses** (mantem a
  definicao do rotulo "D/O medio em 3 meses"). Deliberadamente NAO usa a janela
  de 30d do bloco Realizado — se usasse, Burn Rate ficaria identico a "Saida
  Real" (KPI duplicado). **>>> PONTO A CONFIRMAR COM WESLEY no checkpoint: ele
  marcou "30 dias" para o bloco que incluia Burn Rate; mantivemos Burn em 3m
  para evitar duplicidade. Se ele preferir Burn em 30d, ajustar (e aceitar que
  Burn == Saida Real).**

Faixa 3 — **Exposicao a Fornecedor**:
- **D-09 Fornec 30/60/90d:** somatorio cumulativo de contas a pagar a
  **fornecedores** (cash_outflows com `supplier` preenchido, status `pending`)
  vencendo em <=30d, <=60d, <=90d respectivamente. Referencia: 133k / 226k / 311k.
- **D-09b Total Exposicao:** **soma de TODAS as contas a pagar pendentes a
  fornecedores** (supplier preenchido, status pending), inclusive vencimentos
  alem de 90d. Referencia: 671k (> Fornec 90d de 311k). Escolha do Wesley:
  "so fornecedores, todos vencimentos".

### Limite do Alerta
- **D-10:** Limite **configuravel**, novo campo em `financial_settings`
  (sugerido `alert_threshold numeric`), **default R$30.000** (bate com a
  referencia). Editavel depois sem deploy. NAO reusar `safety_margin` (R$10k).

### Graficos
- **D-11 Saldo Projetado:** reusar o `CashFlowChart` existente (linha verde
  confirmada + ambar SMA). Sem reescrever.
- **D-12 Composicao de Custos por Mes:** barras empilhadas por mes, segmentadas
  por `cash_outflows.category` (Fornecedores, Salarios, Impostos/taxas,
  Alugueis/condominio, Contabilidade, Cartao de credito, Agua/luz, Servicos
  gerais, Emprestimo). Horizonte multi-mes (passado + futuro proximo, ~abr..dez).
- **D-13 Exposicao por Fornecedor:** barras agrupadas por `supplier`, 3 series
  (30/60/90d), ordenadas por exposicao desc. Top N fornecedores.

### Claude's Discretion
- Layout fino dos KPIs (grid 4 colunas x 3 linhas como na referencia),
  componentes shadcn/recharts a reusar, RPC de agregacao (provavel 1 RPC nova
  `get_treasury_panel` SECURITY INVOKER) — definir no planning/research.
- Numero exato de fornecedores no Top N do grafico de exposicao.
- Horizonte exato do grafico de composicao de custos.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Pagina e componentes atuais (a modificar)
- `src/pages/mercadolivre/MLFluxoCaixa.tsx` — pagina host, 2 abas (Caixa Real | Simulador). Aba Caixa Real e reformulada; aba Simulador intocada.
- `src/components/financial/TodayBalanceCard.tsx` — REMOVER da pagina.
- `src/components/financial/ProjectedBalanceCard.tsx` — REMOVER da pagina.
- `src/components/financial/CapacityCard.tsx` — REMOVER da pagina.
- `src/components/financial/CashFlowChart.tsx` — REUSAR (grafico Saldo Projetado).
- `src/components/financial/CashFlowSimulator.tsx` + `SimulatorVerdictCard.tsx` — NAO TOCAR (Phase 50).

### Hooks e libs existentes
- `src/hooks/useProjectedBalance.ts` — `get_projected_balance_summary` (current_balance, min_balance, critical_date). Base para Saldo Atual / Saldo Min / Data Min.
- `src/hooks/useCashFlowData.ts` — `get_cashflow` (serie diaria). Base do CashFlowChart.
- `src/hooks/useTodayBalance.ts` — `get_daily_balance`. Pode ser descartado se nenhum KPI novo usar saldo do dia.
- `src/hooks/useFinancialSettings.ts` — `financial_settings` (initial_balance, safety_margin). Estender para `alert_threshold` (D-10).
- `src/lib/brDate.ts` — `brToday()` fuso America/Sao_Paulo (usar em qualquer corte de data).

### Backend (Supabase)
- `supabase/migrations/20260618100000_cash_flow_tables.sql` — schema cash_inflows / cash_outflows (supplier, category, status, outflow_date) / financial_settings.
- `supabase/migrations/20260618120000_cash_flow_rpcs.sql` + `20260619020000_cashflow_brt_timezone.sql` — RPCs existentes (get_cashflow, get_daily_balance, get_projected_balance_summary). Padrao SECURITY INVOKER, SMA via orders por org, sem truncamento (paginacao).
- `supabase/functions/sync-tiny-payables/index.ts` — alimenta cash_outflows (supplier/category/status do Tiny).
- `supabase/functions/sync-mp-releases/index.ts` — alimenta cash_inflows (MP).

### Decisoes de dominio (reuso)
- RPC nova de tesouraria DEVE ser **SECURITY INVOKER** com org via RLS (nunca DEFINER + org_id por param — risco IDOR). Ver `feedback_supabase_security_invoker`.
- PostgREST/RPC trunca em 1000 linhas — paginar com `.range()` se aplicavel.
- **Supabase project ID:** validar no planning — CLAUDE.md diz `gionpsuunfkkzzjdubfy`, mas memoria/codigo de fluxo de caixa apontam `ckcdevcxgvueywivefgx`. Confirmar qual hospeda cash_inflows/cash_outflows antes de aplicar migration/RPC.

### Referencia visual
- Painel de referencia enviado por Wesley (2026-06-19, imagem no chat de discussao). Valores-ancora para validacao centavo-a-centavo:
  - Saldo Atual 19.155,15 | Runway 0,15 | Saldo Min 90d 11.715,85 | Data Min 23/06/2026 | Alerta < 30.000 em 23/06/2026
  - Entrada Real 363.839,39 | Saida Real 374.826,73 | Resultado -10.987,34 | Burn Rate 124.942,24
  - Fornec 30d 133.026,48 | 60d 226.591,77 | 90d 311.477,86 | Total Expo 671.096,11
  - (Os valores de Entrada/Saida na imagem refletem janela ~3m; com D-07 = 30d os numeros mudam — a imagem e referencia de LAYOUT e de formula, nao de valor absoluto da janela de 30d.)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CashFlowChart` (ComposedChart recharts): pronto para o grafico Saldo Projetado, sem mudanca.
- `useProjectedBalance` / `get_projected_balance_summary`: ja entrega Saldo Atual, Saldo Minimo e data critica — so falta parametrizar horizonte 90d.
- `financial_settings` + `useFinancialSettings`: padrao de settings por org pronto para receber `alert_threshold`.
- Tokens de design `kpi.positive/negative/neutral` ja existem para colorir KPIs (verde/vermelho).
- recharts ja e a lib de charts do projeto (BarChart empilhado para Composicao; BarChart agrupado para Exposicao).

### Established Patterns
- RPCs SECURITY INVOKER + RLS org-first (Phase 43/48). Toda agregacao nova segue isso.
- Hooks TanStack Query v5 com queryKey `["cashflow", ...]` e staleTime 2-3min.
- Cards financeiros em `src/components/financial/`.

### Integration Points
- Nova RPC (provavel `get_treasury_panel`) consumida por novo hook `useTreasuryPanel`, renderizada em novo container de KPIs dentro da aba "Caixa Real" de `MLFluxoCaixa.tsx`.
- Migration nova: coluna `alert_threshold` em `financial_settings` (default 30000).
</code_context>

<specifics>
## Specific Ideas

- Layout deve espelhar a referencia visual do Wesley: grid de KPIs em 3 faixas
  rotuladas (cabecalhos coloridos: amarelo Saude, laranja Exposicao no mockup),
  com os 3 graficos numa linha abaixo (Saldo Projetado | Composicao de Custos |
  Exposicao por Fornecedor).
- Cores dos KPIs seguem semantica: Resultado negativo em vermelho, Alerta com
  icone de atencao, etc.
</specifics>

<deferred>
## Deferred Ideas

- **Drill-down por fornecedor** (clicar numa barra e ver as contas a pagar
  daquele fornecedor) — possivel fase futura, fora do escopo agora.
- **Configuracao do horizonte de projecao** (90/120/180d) pela UI — por ora
  fixo em 90d para o Saldo Minimo.
- None alem disso — discussao ficou dentro do escopo da fase.
</deferred>

---

*Phase: 51-painel-de-tesouraria-fluxo-de-caixa*
*Context gathered: 2026-06-19*
