# Phase 62 — Reposição Server-Side (Compra Recomendada correta)

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Source:** Brainstorm com Wesley (sessão 2026-06-25, recuperada após queda de sessão)

> Projeto Supabase correto = **ckcdevcxgvueywivefgx** (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md).
> org Pé Vermeio = `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, ml_user_id 1639558873.

<domain>
## Phase Boundary

Substituir o motor de "Compra Recomendada" atual — que calcula **no front** (`src/lib/analysis/compraUtils.ts`), com estoque **digitado à mão** e venda/dia vinda da **curva de preço simulada** (`priceCurve` do snapshot), sem lead time, estoque de segurança, gatilho, MOQ ou custo — por uma **RPC `get_replenishment` server-side** que faz o cálculo correto a partir de dados reais.

**Dentro do escopo (v1):**
- Sugestão **por anúncio** (não por tamanho/variação ainda).
- Estoque atual = tudo no ML (`ml_inventory_cache`: Full + anúncios).
- Venda/dia real (janela default 30d).
- Modelo de ponto de reposição (lead time + meta de cobertura + estoque de segurança) com gatilho.
- MOQ + múltiplo de embalagem.
- Tratamento de custo nulo e item sem giro.
- Parâmetros global + override por marca/fornecedor.
- Tela `/estoque` (`CompraRecomendadaPanel`) consumindo a RPC (colunas read-only da fonte).

**Fora do escopo (v1):**
- Reposição por tamanho/variação (evolução natural p/ calçado).
- Descontar compras "a chegar" (OC/trânsito) — apenas exibir aviso de que não considera.
- Snapshot materializado / histórico de sugestão (abordagem C; evolução futura).
</domain>

<decisions>
## Implementation Decisions (travadas com Wesley via brainstorm)

### Onde calcular
- **Abordagem B — RPC `get_replenishment` no banco.** `SECURITY INVOKER`, escopada por org (sem `org_id` em parâmetro — evita o IDOR já caçado nas Phases 43/48), paginável via `.range()`. Mesmo padrão validado nas Phases 59/60 (`get_cashflow`). NÃO calcular no front (abordagem A — causa da lentidão do antigo). Snapshot materializado (abordagem C) fica para evolução futura.

### Estoque atual
- = `ml_inventory_cache` (**tudo no ML: Full + anúncios**). Read-only da fonte; **não** digitado pelo usuário. Sem sync novo necessário.

### "A chegar" (OC/trânsito)
- v1 **NÃO desconta** compras em trânsito. A tela exibe **aviso explícito** dessa limitação.

### Venda/dia
- Média de **vendas REAIS** numa janela (default 30d) — NÃO a `priceCurve` simulada do snapshot.

### Parâmetros
- Tabela `replenishment_params`: lead_time, meta_cobertura, safety, MOQ, pack. Configuração **global + override por marca/fornecedor**. Precedência: **marca > fornecedor > global** (assumido na brainstorm; confirmar se Wesley preferir fornecedor primeiro).

### Fórmula (ponto de reposição)
```
venda_dia        = média de vendas reais na janela (default 30d)
demanda_lead     = venda_dia × lead_time_dias
estoque_seg      = venda_dia × safety_days
ponto_reposicao  = demanda_lead + estoque_seg
estoque_atual    = ml_inventory_cache (Full + anúncios)
alvo             = venda_dia × meta_cobertura_dias + estoque_seg

GATILHO: só sugere se estoque_atual ≤ ponto_reposicao   (resolve "sugerir o que já tem")
necessidade      = max(0, alvo − estoque_atual)
compra_sugerida  = arredonda_pra_cima(necessidade, pack_multiple), respeitando MOQ
valor_estimado   = compra_sugerida × custo_unit          (ou "custo ausente")
```

### Custo nulo / sem giro
- **Custo nulo:** sugere a quantidade mesmo assim; marca `custo_ausente`; não calcula valor R$. (Causa conhecida: marcas de revenda sem custo no Tiny — ver `project_garment_custo_unit_diagnostico`.)
- **Sem giro:** `venda_dia = 0` na janela → compra 0 + flag `sem_giro` se houver estoque.

### Tela
- `/estoque` → `CompraRecomendadaPanel` passa a consumir a RPC. Colunas **read-only da fonte** (substituem os inputs digitados): produto/marca, venda/dia, estoque atual (Full+anúncios), cobertura atual, ponto de reposição, sugestão de compra (com MOQ), valor estimado (ou "custo ausente"), flags (`sem_giro`, `custo_ausente`, "não considera a chegar"), e os parâmetros usados com origem (global/marca).

### Claude's Discretion
- Esquema exato de colunas de `replenishment_params` e da assinatura da RPC.
- Fonte exata da agregação de venda real (provável `ml_product_daily_cache`; o pattern-mapper/researcher confirma).
- Como resolver o "fornecedor" por item (hoje `supplier` só existe nas OCs — descoberta da Phase 60; pode exigir join/heurística por marca no v1).
- Forma de aplicar MOQ vs pack_multiple quando ambos > 1.
</decisions>

<bugs_do_sistema_antigo>
## 10 bugs reconstruídos do código (a corrigir) — relido de `compraUtils.ts` + `CompraRecomendadaPanel.tsx`

> Reconstruídos relendo o código (a lista original viveu só na conversa). Confirmar com Wesley se bate.

1. **Estoque morto / sem giro** — venda=0 não é tratado como "não comprar"; sugestão FULL zera sem sinalizar. → gatilho de giro + flag `sem_giro`.
2. **Custo nulo** — não há custo no cálculo. → traz custo; se null, sugere qtd mas marca `custo_ausente`.
3. **MOQ / múltiplo de embalagem** — sugere quantidade quebrada. → `moq` + `pack_multiple`, arredonda pra cima.
4. **Estoque digitado à mão** (`StockInputs`) — fonte de verdade frágil. → vem do `ml_inventory_cache`.
5. **Venda/dia da curva simulada** (`priceCurve` por estratégia de preço), não real. → média de vendas reais na janela.
6. **Fallback silencioso** — `getVendaDiaria` retorna `dailyAvg:0, fallback:true` → "(usando GMV)" e sugere 0 quando faltam dados. → erro/limitação explícita, sem sugerir 0 silenciosamente.
7. **Sem lead time** — só um campo único "dias de cobertura". → parâmetro próprio.
8. **Sem estoque de segurança.** → `safety_days`.
9. **Sem gatilho** — `compraRecomendada = max(0, ceil(coberturaAlvo) - estoqueTotal)` sugere mesmo com estoque acima do alvo. → só sugere abaixo do ponto de reposição.
10. **Cálculo no front, refeito a cada render, sem histórico.** → RPC server-side.
</bugs_do_sistema_antigo>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sistema antigo (a substituir)
- `src/lib/analysis/compraUtils.ts` — fórmula atual (COMP-03/COMP-04), `getVendaDiaria`/`getPctFull`/`calcularCompra`, `StockInputs`.
- `src/lib/analysis/compraUtils.test.ts` — testes existentes da fórmula (espelhar estilo nos novos testes).
- `src/components/mercadolivre/analise/CompraRecomendadaPanel.tsx` — UI atual (inputs digitados a substituir).
- `src/pages/mercadolivre/MLEstoque.tsx` — página `/estoque` que monta o painel.
- `src/hooks/useMLCoverage.ts` + `src/components/mercadolivre/CoverageSettingsPopover.tsx` / `CoverageAlerts.tsx` — cobertura/alertas existentes.

### Fontes de dados / padrões server-side
- `ml_inventory_cache` — estoque atual (Full + anúncios). Ver Phase 58 (estoque consolidado/veracidade).
- `ml_product_daily_cache` — provável fonte da venda real por produto (confirmar no research).
- Phase 59/60: `supabase/migrations/20260619*` e `get_cashflow` — padrão de RPC `SECURITY INVOKER` + `REVOKE`/`GRANT` + aplicação via MCP `apply_migration` no `ckcdevcxgvueywivefgx`.
- RLS org-first: `is_org_member`/`get_org_role` (Phase 43). RPC = `SECURITY INVOKER`, NUNCA DEFINER com org em parâmetro.

### Convenções do projeto
- `./CLAUDE.md` — stack (React+TS+shadcn+Supabase, Vite, vitest), aplicar migrations via MCP no `ckcdevcxgvueywivefgx` (CLI linkado no projeto errado — nunca `db push`).
- types.ts atualizado manualmente (não regen do schema).
</canonical_refs>

<specifics>
## Specific Ideas
- Multiplicador de campanha (×1.0/1.2/1.5/2.0) já existe no painel antigo — manter como ajuste de demanda sobre `meta_cobertura`/venda, se fizer sentido no v1.
- Janela de venda configurável (default 30d) — possível 30/60d no futuro.
</specifics>

<deferred>
## Deferred Ideas
- Reposição por tamanho/variação (caminho natural p/ calçado).
- Descontar "a chegar" (OC/trânsito).
- Snapshot materializado + histórico/auditoria da sugestão ao longo do tempo (abordagem C).
</deferred>

---

*Phase: 62-reposicao-server-side*
*Context gathered: 2026-06-25 via brainstorm (recuperação de sessão)*
