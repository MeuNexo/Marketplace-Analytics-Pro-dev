# Phase 103: Consultor CCO — Ferramentas de Compra vs Venda - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Source:** Brainstorming + spec docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md

<domain>
## Phase Boundary

Esta fase adiciona ao Consultor de IA (edge function `supabase/functions/nexo-chat/`) a
capacidade de responder **análises de compra vs venda** — o pedido original do Wesley:
o que comprar agora, micos/capital parado, "comprei certo?" e caixa vs compras.

**Entrega (Grupo 1 do spec):**
1. 2 novas tools read-only em `nexo-chat/tools.ts`: `get_replenishment` e `get_purchase_suppliers`.
2. Playbook Estela ampliado em `nexo-chat/playbooks.ts` (compras).
3. Persona em `nexo-chat/prompt.ts` ensinando o raciocínio compra × venda + rótulos de veracidade novos.
4. Testes espelhando `tools.test.ts` e `prompt.test.ts`.
5. Deploy da EF `nexo-chat` (feito pelo orquestrador via MCP Supabase / CLI, NÃO pelo executor).

**FORA de escopo nesta fase:** DRE/caixa (Phase 104), preços/competitivo/completude (Phase 105), RAG (Fase 2),
qualquer mutação (Consultor é estritamente read-only).
</domain>

<decisions>
## Implementation Decisions

### Tool: get_replenishment
- Envolve a RPC `get_replenishment_by_sku` (mesma que a página `/compras` usa via hook `useReplenishmentBySku`).
- Confirmar a assinatura EXATA da RPC via grep nas migrations (params `p_org_id`, `p_user_ids`?, params de reposição).
- Retorna por SKU: compra_sugerida, valor_estimado, gatilho_ativo, venda_dia/venda_inteligente, sku_stock,
  cobertura_atual, ponto_reposicao, alvo, sem_giro (micos), custo_ausente, qtd_a_caminho, data_proxima_chegada.
- Anti-IDOR OBRIGATÓRIO: `p_org_id=orgId` e (se a RPC aceitar) `p_user_ids=mlUserIds`, ambos do servidor;
  args de org/seller vindos do modelo IGNORADOS. Se select direto, `.eq('organization_id', orgId)` + `.in('ml_user_id', mlUserIds)`.
- Cap `MAX_ROWS` (50). Retorno rotulado: compra sugerida/valor é PROJEÇÃO baseada em velocidade de venda;
  `custo_ausente=true` ⇒ valor incompleto; OC em trânsito é parcial.
- Parâmetros opcionais do modelo: nenhum sensível; possivelmente um filtro "só gatilho ativo" se a RPC suportar (senão filtrar em memória).

### Tool: get_purchase_suppliers
- Envolve a RPC `get_purchase_order_suppliers` (usada por `usePurchaseOrderSuppliers` no dialog de OC).
- Mesmo padrão anti-IDOR e cap. Confirmar assinatura via grep.

### Playbook Estela (ampliar bloco existente "3. ESTELA — Estoque & Operações" em playbooks.ts)
- Adicionar: mix de compra; capital parado/micos (giro < 1x em 60 dias → ação); MOQ × giro (lote econômico);
  ponto de pedido com fator sazonal; priorização ABC de compra (A/B/C); leitura de OC em trânsito (qtd_a_caminho);
  raciocínio compra × venda (comprei o mix certo? o que sobrou/faltou vs o que vendeu).
- Manter o estilo dos playbooks existentes (DADO → Diagnóstico → Ação → Métrica de sucesso) e citar fontes.

### Persona prompt.ts
- Na string PERSONA, adicionar orientação de raciocínio compra × venda (cruzar velocidade de venda × estoque ×
  cobertura × caixa; escalar ads em SKU em ruptura é erro).
- Ampliar a seção "USO DAS FERRAMENTAS" citando `get_replenishment` e `get_purchase_suppliers` e quando usá-las.
- Estender "VERACIDADE, FRESCURA E SEMÂNTICA" com o rótulo novo: compra sugerida = PROJEÇÃO, não pedido feito;
  estoque considerado pode ser Full/parcial; custo ausente ⇒ valor de compra incompleto.
- NÃO quebrar os testes existentes de prompt (greps que provam regras). Adicionar, não remover.

### Testes
- Espelhar `nexo-chat/tools.test.ts`: para cada tool nova — prova anti-IDOR (org/seller do servidor, args ignorados),
  cap de linhas, presença de rótulo. Mockar o supabase client como os testes atuais fazem.
- Espelhar `nexo-chat/prompt.test.ts`: greps que provam as novas regras/rótulos no prompt real (buildSystemPrompt()).

### Claude's Discretion
- Nomes exatos dos parâmetros das tools (from/to/filtros) conforme o que a RPC realmente aceita.
- Redação final dos playbooks e da persona (desde que siga o estilo e não remova regras existentes).
- Formato do objeto de retorno (rótulos, agregações leves) desde que caiba no cap e seja read-only.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec da milestone
- `docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` — auditoria de cobertura completa,
  contratos das tools, decisão híbrido-faseado, estrutura de fases.

### Código do Consultor (a modificar)
- `supabase/functions/nexo-chat/tools.ts` — 25 tools atuais + `dispatchTool` (padrão anti-IDOR, cap MAX_ROWS).
- `supabase/functions/nexo-chat/prompt.ts` — PERSONA + buildSystemPrompt().
- `supabase/functions/nexo-chat/playbooks.ts` — base de conhecimento (bloco Estela em "3. ESTELA").
- `supabase/functions/nexo-chat/tools.test.ts` e `prompt.test.ts` — padrões de teste a espelhar.

### Fonte de dados (referência de contrato)
- `src/hooks/useReplenishmentBySku.ts` — consome `get_replenishment_by_sku` (schema `ReplenishmentSkuRow`).
- `src/hooks/usePurchaseOrderSuppliers.ts` — consome `get_purchase_order_suppliers`.
- `src/pages/mercadolivre/MLCompras.tsx` — página `/compras` (semântica dos campos).
- `supabase/migrations/` — grep para a assinatura EXATA das RPCs (params, INVOKER vs DEFINER).
</canonical_refs>

<specifics>
## Specific Ideas
- DB alvo do nexo-chat: `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md).
- Contas garment: org "Pé Vermeio" tem custos; org "Thales" é revenda com custo ausente → `custo_ausente=true` é
  comum e legítimo (não é bug). O rótulo da tool deve deixar isso claro.
- OC em trânsito (`qtd_a_caminho`, `data_proxima_chegada`) importa para "preciso comprar quanto AGORA?".
</specifics>

<deferred>
## Deferred Ideas
- DRE real & caixa, projeção de saldo, impostos por guia → Phase 104.
- Preço praticado × MCO, preço competitivo, completude → Phase 105.
- RAG / embeddings da base de conhecimento → Fase 2.
</deferred>

---

*Phase: 103-consultor-cco-ferramentas-de-compra-vs-venda*
*Context gathered: 2026-07-28 via brainstorming + spec*
