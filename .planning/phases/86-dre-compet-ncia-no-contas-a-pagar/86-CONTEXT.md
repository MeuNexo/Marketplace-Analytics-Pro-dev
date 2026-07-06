# Phase 86: DRE — Competência no Contas a Pagar - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning
**Source:** Discussão extensa com Wesley (CEO) sobre a DRE de Resultado — decisões consolidadas na memória do orquestrador.

<domain>
## Phase Boundary

Esta fase adiciona **competência** (`dataCompetencia` do Tiny) às linhas de `cash_outflows`, para que a DRE (Phases 87/88) leia custos por **mês de competência**, não por vencimento/caixa. É a fase 1 de 3 do milestone "DRE de Resultado".

**Faz parte desta fase:** coluna `competence_date`, gravação dela no pipeline de enriquecimento existente (`enrich_harvest`, Phase 61), backfill de 2026, índice.

**NÃO faz parte desta fase (fica para Phase 87/88):** a RPC de agregação da DRE, o mapa categoria→linha da DRE, a separação juro/principal do empréstimo (SAC), e o frontend. Aqui só habilitamos o dado de competência.
</domain>

<decisions>
## Implementation Decisions (LOCKED com Wesley)

### Fonte do dado
- A competência vem do campo **`dataCompetencia`** do DETALHE `/contas-pagar/{id}` da API Tiny v3 (formato **"YYYY-MM"**, ex.: `"2026-06"`). A LISTAGEM `/contas-pagar` NÃO traz competência — só o detalhe traz. O filtro de competência na API é IGNORADO (não usar para filtrar; puxar detalhe).
- O pipeline `enrich_harvest` (Phase 61) JÁ lê esse detalhe e grava `category = categoria.descricao` e `supplier = contato.nome`. **Estender esse mesmo ponto** para gravar também a competência — não criar um novo sync.

### Modelagem
- Nova coluna **`competence_date` (date)** em `cash_outflows`. Como `dataCompetencia` é ano-mês, materializar como **primeiro dia do mês** (ex.: `"2026-06"` → `2026-06-01`).
- `competence_date` COEXISTE com `outflow_date` (que é vencimento/caixa e serve à DFC/Phase 60). NÃO substituir nem alterar `outflow_date`.
- Índice em **`(organization_id, competence_date, category)`** para a leitura da DRE por mês+categoria.

### Fonte única / não sobrescrever (regra herdada da Phase 61)
- A gravação de `competence_date` segue o MESMO padrão ON CONFLICT da Phase 61: o `sync-tiny-payables` NÃO deve sobrescrever `competence_date` (nem `category`/`supplier`); o enriquecimento é a fonte única. Um `sync` após o backfill não pode zerar linhas já enriquecidas.

### Backfill
- Backfill de **2026 inteiro** (alinha com o histórico que Wesley quer e com o backfill da Phase 84). Meta: **≥90%** das linhas com competência em 2026 com `competence_date` não-nulo.
- Reusar a fila/mecanismo de backfill de categoria já existente na Phase 61 (`cat_backfill_queue` / `enrich_drain`) — re-harvest para capturar o novo campo, em vez de um script novo.

### Não-regressão (crítico)
- **Zero regressão na DFC / Phase 60.** `outflow_date` intacto, `get_cashflow` inalterado, reconciliação da DFC preservada. `competence_date` é aditivo.
- Anti-IDOR / RLS: respeitar `organization_id` (padrão do projeto; RPC/consultas por org).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Infra existente a reusar (Phases 59 e 61)
- `.planning/phases/59-fluxo-caixa-correcoes/59-CONTEXT.md` — sync `sync-tiny-payables` → `cash_outflows` (padrão `EdgeRuntime.waitUntil`, cron).
- Seção da Phase 61 no `.planning/ROADMAP.md` — pipeline `enrich_harvest`/`enrich_drain`, fila `cat_backfill_queue`, regra "enriquecimento é fonte única; sync não sobrescreve category/supplier" (ON CONFLICT preserva).
- Edge functions e migrations do projeto: `supabase/functions/sync-tiny-payables/*`, `supabase/functions/` relativos ao enriquecimento (localizar `enrich_harvest`/`enrich_drain`), `supabase/migrations/*` de `cash_outflows`.

### Dados
- Supabase garment = **`ckcdevcxgvueywivefgx`** (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md — pegadinha conhecida).
- Schema atual `cash_outflows`: `id, organization_id, outflow_date, amount, description, supplier, category, status, document_number, source, tiny_payable_id, synced_at, created_at, updated_at` (SEM competência/juros hoje).
- API Tiny v3: base `https://api.tiny.com.br/public-api/v3`; detalhe `/contas-pagar/{id}` retorna `dataCompetencia`, `categoria{id,descricao}`, `juros`, `dataVencimento`, `dataLiquidacao`, `valor`, `situacao`. Cliente de referência (padrão de auth/token): `nexo-mcp/tiny_client.py`.
</canonical_refs>

<specifics>
## Specific Ideas

- Deploy de edge function no garment é só via MCP Supabase (`deploy_edge_function`) — não há token para CLI. Migrations via `apply_migration` (MCP).
- `dataCompetencia` pode vir vazio em algum lançamento antigo — nesse caso `competence_date` fica null (o backfill mira ≥90%, não 100%).
- Validar com um mês real: junho/2026, seller Pé Vermeio (org `7f615df7`), onde já reconciliamos os dados.
</specifics>

<deferred>
## Deferred Ideas (fora desta fase)

- Coluna `juros` e separação juro/principal do empréstimo (SAC R$6.666,67/parcela) → **Phase 87**.
- Mapa categoria→linha da DRE e RPC de agregação → **Phase 87**.
- Frontend da DRE em `/vendas` → **Phase 88**.
- IRPJ/CSLL e FGTS → fora de escopo (empresa não recolhe / não tem).
</deferred>

---

*Phase: 86-dre-compet-ncia-no-contas-a-pagar*
*Context gathered: 2026-07-06 via discussão consolidada (orquestrador)*
