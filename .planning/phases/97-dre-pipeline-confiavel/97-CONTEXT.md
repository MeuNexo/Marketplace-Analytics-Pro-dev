# Phase 97 — DRE: pipeline Tiny→dash confiável

**Objetivo:** Wesley precisa confiar na DRE do dash mês a mês sem contraprova manual. A sessão de debug `dre-cartao-billing-ml-persiste` (2026-07-16) provou que os NÚMEROS da DRE estão certos quando os dados chegam — o problema é o **caminho do dado falhar em silêncio**.

**Autorização:** Wesley, 2026-07-16: *"eu quero que a gente feche sobre essa dre hoje ainda na proxima phase no maximo... se tiver necessidade, use todo o seu poder de fogo com outros modelos"*.

## Causas-raiz corrigidas (backend, JÁ EM PROD)

1. **429 silencioso** — `treasury_cat_tick` (enriquecimento a cada 15s) consumia o rate limit do Tiny; `sync-tiny-payables` perdia TUDO no 1º 429 e o cron recebia 202 "ok". Prova da causa: tick pausado → 2.032/2.032 contas, 0 erros.
   - **Fix A:** EF `sync-tiny-payables` **v7** — `tinyGetRetry` com backoff de 61s e orçamento global de 3 retries por execução. Deployada via MCP.
   - **Fix B:** tick espaçado **15s → 30s** (migration `20260716150000`).
2. **Recategorização fossilizada** — `enrich_enqueue_new()` só enfileira categoria NULL/vazia; correção do dono no Tiny (Outros→Fornecedores) nunca chegava ao dash.
   - **Fix C:** `enrich_reenqueue_outros()` + cron diário 05:00 UTC (migration `20260716150000`) — re-enfileira o balde 'Outros' (pequeno/decrescente) para re-leitura diária do detalhe.

## Prova exigida (SC)

- SC1: sync com tick ATIVO completa (synced_at avança; diag sem fatalError). ✅/❌ registrar.
- SC2: cron `enrich-reenqueue-outros-daily` agendado e ativo. ✅ (verificado via cron.job)
- SC3: `deno check` limpo na EF v7. ✅

## Restante da phase (frontend, DEPOIS do merge da 96 — mesmo arquivo MercadoLivre.tsx)

- **Alerta de dado velho (staleness):** banner na DRE/fluxo quando `max(cash_outflows.synced_at)` > 26h — já aprovado por Wesley na sessão 07-13. Sem isso, falha nova volta a ser invisível.
- (Follow-up, não bloqueia): janela 90d do payables — edição em fatura vencida há >90d nunca re-sincroniza; avaliar re-scan mensal de 365d.

## Decisões do dono registradas hoje

- Planilha manual: será mantida como contraprova por 2–3 fechamentos, depois aposentada.
- Aluguel de maio: Tiny diz PAGO 15/05 (R$ 3.367,70) — Wesley verifica se é recorrência fantasma.
- ICMS abril: Tiny 12.000 × planilha 18.783,19 — Wesley confere a guia real.
