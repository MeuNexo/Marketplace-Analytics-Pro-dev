---
status: resolved
trigger: "DRE ainda mostra cartão de crédito com billing ML duplicado, mesmo depois do Wesley corrigir os lançamentos no Tiny para o ano todo"
created: 2026-07-16
updated: 2026-07-16
---

## Symptoms

- **Expected:** após Wesley corrigir as faturas do cartão no Tiny (remover a parte que é billing ML, ano inteiro), a DRE deveria mostrar só o custo real não-ML (maio ≈ 2.202,63).
- **Actual:** DRE segue mostrando os valores antigos (maio = 22.752,76, com os 20.550,13 de billing ML dentro).
- **Errors:** nenhum erro visível; dado apenas não muda.
- **Timeline:** Phase 96 (C9) expôs o double_count_risk em 07-15; Wesley corrigiu no Tiny (data/hora exata a confirmar com ele).
- **Reproduction:** abrir DRE (/vendas) em qualquer mês de 2026 → linha Cartão de crédito com valor antigo.

## Evidence

- `2026-07-16 ~15:40Z` — **Sync não está parado:** `cash_outflows` org Pé Vermeio: max(synced_at) = 2026-07-16 09:00:26 UTC, 2.124 linhas. Cron de 6h vivo.
- `2026-07-16 ~15:45Z` — **Valores por mês (categoria ~cartão):** maio/2026 = 22.752,76 (1 linha) — INALTERADO. Todas as linhas com updated_at = synced_at = hoje 09:00 UTC (o upsert reescreve todas as linhas da janela a cada run). Meses futuros 2026-08..2027-06 espelham valores de 2025 (provável recorrência/previsão do Tiny).
- `2026-07-16 ~15:50Z` — **EF viva `sync-tiny-payables` v6 lida (MCP get_edge_function):**
  - Janela de busca: `dataVencimentoInicial = hoje−90d`, `dataVencimentoFinal = hoje+90d` → hoje: **2026-04-17 → 2026-10-14**.
  - **Fatura com vencimento antes de 17/04/2026 NUNCA é re-buscada** → correção no Tiny não chega ao banco (órfã).
  - Upsert `onConflict (organization_id, tiny_payable_id)`, `ignoreDuplicates:false` → atualiza valor/status de quem ESTÁ na janela; **não remove** linha cujo lançamento foi deletado no Tiny (sem reconciliação por ausência — mesma classe do bug das claims).
  - `category`/`supplier` NÃO são gravados por esta EF ("enriquecimento-detalhe é a fonte única, CASHFIX-07") → existe outra EF de enriquecimento; se a correção do Wesley foi recategorização, depende dela.

## Current Focus

- **hypothesis:** A correção do Wesley no Tiny não chega ao banco por combinação de: (a) janela de 90d da EF exclui faturas com vencimento < 17/04/2026 (jan–abr órfãs pra sempre); (b) para meses DENTRO da janela, ou ele corrigiu após o sync das 09:00 UTC (basta re-sync), ou corrigiu por deleção (upsert não remove órfãs), ou por recategorização (depende da EF de enriquecimento-detalhe).
- **test:** (1) disparar sync agora e re-medir maio/junho/julho; (2) perguntar ao Wesley COMO e QUANDO corrigiu no Tiny.
- **expecting:** se maio mudar após o re-sync → meses na janela OK, resta órfãos jan–abr (fix = backfill de janela ampla). Se maio NÃO mudar → correção foi por deleção/recategorização → fix = reconciliação por ausência e/ou enriquecimento.
- **next_action:** rodar sync + re-medir + coletar respostas do Wesley.

## Eliminated

- hypothesis: "Sync congelado (como em 18–25/06)" — eliminada: synced_at = hoje 09:00 UTC.
- hypothesis: "RPC/frontend lendo fonte errada" — improvável como causa primária: o valor antigo está NA TABELA `cash_outflows`; a RPC reflete a tabela. (Ainda não 100% eliminada para category drift.)

## Resolution

- root_cause: |
    DUPLA, ambas de caminho de dado (não de código da DRE):
    (1) CARTÃO/VALORES: Wesley editou as faturas no Tiny HOJE depois das 06:00 BRT — depois do último cron (09:00 UTC). Os re-syncs manuais disparados em seguida falharam SILENCIOSAMENTE com `Tiny 429 rate limit`: o cron `treasury_cat_tick` (jobid 25) roda `enrich_payable_step(6)` A CADA 15 SEGUNDOS e consome o rate limit do Tiny (~100 req/min) continuamente; a paginação do sync-tiny-payables (600ms/página, 21 páginas) colide e estoura. A EF aborta a loja inteira no primeiro 429 (sem retry/backoff, sem progresso parcial). PROVA: com o tick pausado (autorizado pelo Wesley), o mesmo sync completou 2.032/2.032 contas, 0 erros.
    (2) NÃO CLASSIFICADO/CATEGORIAS: `enrich_enqueue_new()` só enfileira linhas com category NULL/vazia — lançamento RECATEGORIZADO no Tiny (ex.: Outros→Fornecedores) nunca é re-enfileirado, então a categoria local fica fossilizada.
- fix: |
    (a) Sync re-executado com tick pausado → cartão 2026 inteiro corrigido (maio 22.752,76 → 1.143,40; jan 1.819,48 / fev 1.210,80 / mar 2.361,22 / abr 1.160,50 / jun 2.200,63 / jul 2.245,07). Tick religado em seguida.
    (b) 45 lançamentos 'Outros' re-enfileirados manualmente em cat_backfill_queue (status='todo') p/ re-enriquecimento das categorias.
    (c) BONUS SKUs sem custo (gate maio): TXC = grafia divergente anúncio (PTOBRAN*) × Tiny (PTOBRANCO*) → 4 SKUs criados/completados em ml_product_costs (83,76/104,90, valores do Wesley) + 73 linhas de orders preenchidas (médio+cheio). Pralana MLB3818741753 = custo manual do Wesley (168,08 médio, por item_id, sem SKU/cheio) → 175 linhas de orders receberam o médio; CHEIO ainda pendente. Gate maio: 5 SKUs/R$4.693 → 2 SKUs/R$436 (Pralana NATP falta cheio + Sandrini K2CR1303PMSPTOM sem custo).
- verification: cartão por mês re-medido em prod (valores acima); debug-sync diag 2032/2032/0 erros; gate get_cmv_cheio_gaps maio = 2 SKUs restantes.
- files_changed: nenhum arquivo de código — só dados em prod (ml_product_costs, orders, cash_outflows via EF, cat_backfill_queue) e pausa/religada do cron 25.

## Estado final do não classificado (maio, pós re-enriquecimento 13:16Z)

- Textile Xtra 4.627,04 → RECLASSIFICADA ✓ (saiu do não classificado)
- NF 181834 parcela 3/4 (maio, 2.852,77) → Fornecedores ✓
- **Resta 1 em maio: NF 182280 parcela 2/4 (04/05, 3.329,39) — ainda "Outros" NO TINY.** Padrão observado: nas 2 NFs Pralana, só as parcelas 3/4 e 4/4 viraram Fornecedores; as parcelas 1/4 e 2/4 seguem Outros na fonte (recategorização parcial no Tiny — cada parcela é uma conta separada). Ação: Wesley confere essas parcelas no Tiny; o tick re-enriquece sozinho após novo re-enqueue (categoria preenchida não re-enfileira sozinha — follow-up 3).

## Fechamento dos custos (07-16, valores do Wesley na conversa)

- TXC: Wesley CORRIGIU O SKU NO ANÚNCIO ML → grafia passa a bater com o Tiny daqui pra frente (fix na fonte).
- Pralana MLB3818741753: cheio 210,47 aplicado (175 pedidos) + 8 linhas por SKU em ml_product_costs (168,08/210,47).
- Sandrini família K2CR1303PMS (PTOM/PTOG/PTOGG): 27,16/34,01 → 36 pedidos preenchidos.
- **Gate: maio 0 SKUs ✓ · junho 0 ✓ · julho restam 3** (Pralana 12963NAT331561 R$577,99 · Rossi KPA6MMCB460PTO R$419,97 · TXC CTXCB19737VING R$124,59) — aguardando custos/cadastro do Wesley.

## Follow-ups estruturais (para phase/quick task — NÃO corrigidos)

1. **429 sistêmico:** sync-tiny-payables sem retry/backoff em 429 e perde tudo no 1º erro; treasury_cat_tick a cada 15s compete pelo rate limit do Tiny. Opções: backoff+retry na EF, coordenação (pausar tick durante sync), ou espaçar tick.
2. **Falha silenciosa:** o cron recebe 202 e o runSync engole o 429 no catch — `synced_at` congela sem alerta (de novo; mesmo modo do 18–25/06). Alerta de staleness já foi aprovado na sessão 07-13 (dado-velho).
3. **Recategorização nunca re-sincroniza:** enrich_enqueue_new ignora linhas com categoria preenchida. Precisa de re-enrich periódico (ex.: re-enfileirar 'Outros' e/ou linhas com updated_at recente) ou tick que confie no synced_at.
4. **Janela 90d:** fatura com vencimento < hoje−90d nunca é re-buscada (edição histórica no Tiny não chega). Hoje não mordeu (vencimentos 2026 dentro da janela), mas é bomba-relógio p/ correções históricas.
