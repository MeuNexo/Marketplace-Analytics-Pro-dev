# Consultor de IA — "CCO Completo" (Fase 1) + RAG (Fase 2)

**Data:** 2026-07-28
**Status:** Design aprovado por Wesley (brainstorming). Fase 1 aprovada para execução via GSD.
**Contexto de branch:** o código atualizado do `nexo-chat` vive no branch `gsd/phase-99-dre-caixa-mp` (150 commits à frente de `main`). As fases GSD desta milestone partem do HEAD atual desse branch, não de `main`.

---

## 1. Objetivo

Evoluir o Consultor de IA (`supabase/functions/nexo-chat/`) de um agente forte em vendas/margem/ads
para um **CCO completo** que:

1. Responde **análises de compra vs venda** (o pedido original do Wesley): o que comprar agora, micos/capital
   parado, "comprei certo?" (retrospectiva), e caixa vs compras.
2. Enxerga **todos os dados relevantes da conta** que abriu o chat — fechando os ~18 buracos de ferramenta
   identificados na auditoria de cobertura (seção 3).
3. Sinaliza dado ausente/incompleto (regra já existente na persona — VERACIDADE/FRESCURA — estendida às novas fontes).
4. Apoia-se num **framework validado** (playbooks já embutidos, ampliados nesta fase).
5. **Fase 2 (depois):** migrar a base de conhecimento para RAG quando ela crescer além do que cabe confortável no prompt.

Decisão de arquitetura (Wesley): **híbrido faseado** — Fase 1 fecha tools + amplia playbooks inline; RAG fica para a Fase 2.

## 2. Estado atual (o que já existe — NÃO refazer)

- **Persona** (`prompt.ts`): COO focado em lucro líquido; regras anti-invenção de número; VERACIDADE/FRESCURA/SEMÂNTICA
  (rotular parcial, declarar limitação, sinalizar frescura); DADOS-SÃO-INFORMAÇÃO (anti prompt-injection); READ-ONLY.
- **Playbooks** (`playbooks.ts`, ~49KB): framework validado (ML Central, Nubimetrics, Sebrae, Olist, Conecta Ads),
  organizado por 4 analistas — Laura (ads), Gabriel (financeiro), Estela (estoque/reposição), Rafael (competitivo)
  + break-even, lifecycle, TACoS guard-rail, funil, lances, ads×orgânico.
- **Ferramentas** (`tools.ts`, 25 tools): read-only, escopadas por org/mlUserIds do servidor (anti-IDOR), cap 50 linhas/tool.
- **Loop** agêntico (`loop.ts`) + `index.ts` (JWT real do usuário via `ctx.userJwt`, nunca logado/exposto).
- DB alvo do nexo-chat: `ckcdevcxgvueywivefgx` (NÃO o `gionpsuunfkkzzjdubfy` do CLAUDE.md).

## 3. Auditoria de cobertura (oferta × demanda)

Cruzamento das 25 tools contra todas as fontes que as páginas consomem. Buracos (dado que o dashboard usa e o
Consultor NÃO alcança hoje), por severidade:

### 🔴 CRÍTICO — Compra vs Venda (0% coberto)
| Fonte | Entrega | Página |
|---|---|---|
| `get_replenishment_by_sku` (RPC) | compra sugerida, gatilho, venda/dia × estoque, cobertura, micos (sem giro), custo ausente, OC em trânsito (qtd_a_caminho + data_proxima_chegada), alvo, valor estimado | `/compras` |
| `get_purchase_order_suppliers` (RPC) | fornecedores para montar a ordem de compra | `/compras` |

### 🟠 ALTO — DRE real & caixa
| Fonte | Entrega | Página |
|---|---|---|
| `get_dre_operational_by_competence` (RPC) | DRE de resultado por competência (lucro real validado nas Phases 84–100) | `/` `/financeiro` |
| `get_dre_cash` + `_history` + `_items` + `_forecast` (RPCs) | DRE regime de caixa (página `/dre-caixa` inteira invisível hoje) | `/dre-caixa` |
| `get_projected_balance_summary` (RPC) | saldo projetado 3 cenários (otimista/realista/pessimista) | `/fluxo-de-caixa` |
| `get_imposto_guia_by_competence` + `get_inss_guia_by_competence` (RPCs) | imposto e INSS reais por guia | `/` |
| `get_daily_balance` (RPC) | saldo do dia | painel |

### 🟡 MÉDIO — Preços, MCO e competitivo
| Fonte | Entrega | Página |
|---|---|---|
| `orders_sold_products_agg` (RPC) + `ml_mco_targets` (tabela) | preço praticado × meta de MCO | `/analise-precos` |
| `ml-precos-custos` (edge fn, modo `references`/`costs`) | sugestão competitiva de preço + calculadora de comissão (único dado competitivo real → acende o pilar Rafael) | `/anuncios` |
| `commercial_analysis_snapshots` (tabela) | snapshots de análise comercial de preços | `/precificacao` |
| `ml-products-aggregated` (edge fn) | top produtos por unidades vendidas | `/` |
| `get_cancelled_revenue` (RPC) | receita cancelada | `/` |

### ⚪ BAIXO — completude
`get_cmv_cheio_gaps` (quais SKUs sem custo — hoje só a contagem via `get_no_cost_count`),
`get_dre_nao_classificado_items`, `proposed_actions`, `financial_settings`.

### Dois achados estratégicos
1. **Pilar "Inteligência Competitiva" é fantasma:** a persona promete concorrentes/preço total/Buy Box e existe o
   playbook do Rafael, mas nenhuma tool traz dado competitivo real. `get_competitive_price` corrige isso.
2. **O Consultor não sabe o lucro real:** o DRE operacional por competência e a DRE de caixa (o que o Wesley validou)
   não têm tool. "Qual foi meu lucro em junho?" hoje responde por `get_margin_summary` (base pagos), não pelo DRE fechado.

## 4. Escopo da Fase 1 (aprovado: Grupos 1–4 + playbooks + persona)

### A) Novas ferramentas
Todas seguem o padrão vigente de `tools.ts`: declaração Gemini SEM param de org/seller; `dispatchTool` injeta
`p_org_id=orgId` e (quando aplicável) `p_user_ids=mlUserIds` do servidor; cap `MAX_ROWS`; selects diretos exigem
`.eq('organization_id', orgId)` (+ `.in('ml_user_id', mlUserIds)`); rótulos de limitação/frescura no retorno.
As assinaturas exatas das RPCs serão confirmadas via grep nas migrations no `RESEARCH` de cada fase GSD.

**Grupo 1 — Compra vs Venda** 🔴
- `get_replenishment` → RPC `get_replenishment_by_sku`. Retorno rotulado: compra sugerida/valor a investir é
  **projeção** baseada em velocidade; estoque considerado; `custo_ausente=true` ⇒ valor incompleto; OC em trânsito.
- `get_purchase_suppliers` → RPC `get_purchase_order_suppliers`.

**Grupo 2 — DRE real & caixa** 🟠
- `get_dre_result` → RPC `get_dre_operational_by_competence` (param: competência YYYY-MM). Rótulo: competência ≠ pagos.
- `get_dre_cash` → RPC `get_dre_cash` (+ opcional `get_dre_cash_forecast` para previsão). Rótulo: regime de caixa
  (recebimento MP) ≠ competência.
- `get_projected_balance` → RPC `get_projected_balance_summary`. Rótulo: 3 cenários; projeção, não realizado.
- `get_taxes_paid` → RPCs `get_imposto_guia_by_competence` + `get_inss_guia_by_competence`. Rótulo: guia real (com créditos), não imposto cheio.

**Grupo 3 — Preços & competitivo** 🟡
- `get_price_practiced` → RPC `orders_sold_products_agg` + tabela `ml_mco_targets` (preço praticado × meta MCO).
- `get_competitive_price` → edge fn `ml-precos-custos` (modo `references`). Rótulo: sugestão competitiva, não garantia;
  requer JWT real do usuário (padrão `ctx.userJwt` como em `get_reputation`) se a EF exigir.

**Grupo 4 — Completude** ⚪
- `get_cost_gaps` → RPC `get_cmv_cheio_gaps` (quais SKUs sem custo, não só a contagem).
- `get_cancelled_revenue` → RPC `get_cancelled_revenue`.

### B) Ampliar playbooks inline (`playbooks.ts`)
- **Estela / Compras (novo bloco):** mix de compra, capital parado/micos (giro < 1x), MOQ × giro, ponto de pedido com
  fator sazonal, priorização ABC de compra, OC em trânsito, raciocínio **compra × venda** (comprei o mix certo?).
- **Gabriel / DRE:** DRE de resultado (competência) vs DRE de caixa (recebimento), competência vs pagos, break-even de
  caixa do mês, imposto guia real vs imposto cheio.
- **Rafael / Competitivo:** agora com dado real — preço total (preço + frete), sugestão competitiva, quando reagir a
  concorrente vs manter margem.

### C) Atualizar a persona (`prompt.ts`)
- Ensinar o raciocínio **compra × venda** (cruzar velocidade de venda × estoque × cobertura × caixa).
- Ampliar a seção "USO DAS FERRAMENTAS" apontando as novas tools e quando usá-las.
- Estender "VERACIDADE/FRESCURA/SEMÂNTICA" com os rótulos novos:
  compra sugerida = projeção; DRE competência ≠ pagos ≠ caixa; preço competitivo = sugestão; imposto guia ≠ imposto cheio.

### D) Testes
Espelhar `tools.test.ts` e `prompt.test.ts`: para cada tool nova — anti-IDOR (org/seller do servidor, args ignorados),
cap de linhas, presença de rótulo de limitação; para a persona — greps que provam as novas regras no prompt real.

## 5. Fora de escopo (Fase 1)
- RAG / embeddings / busca semântica → **Fase 2**.
- Qualquer mutação (o Consultor permanece estritamente read-only; recomenda e encaminha para aprovação).
- Novas RPCs/migrations de dados: as RPCs já existem; se alguma exigir ajuste, entra como desvio na fase GSD.

## 6. Fase 2 (esboço — não implementar agora)
Migrar `playbooks.ts` de "tudo colado no prompt" para RAG: chunking dos playbooks + embeddings + recuperação por
similaridade no turno, injetando só os trechos relevantes. Gatilho: base de conhecimento crescer a ponto de o prompt
ficar caro/grande demais, ou quando quisermos adicionar muito material setorial validado.

## 7. Estrutura de fases GSD proposta
- **Phase 103** — Consultor: Ferramentas de Compra vs Venda (Grupo 1) + playbook Estela ampliado + persona compra×venda. *(entrega o pedido original)*
- **Phase 104** — Consultor: DRE real & caixa (Grupo 2) + playbook Gabriel.
- **Phase 105** — Consultor: Preços & competitivo + completude (Grupos 3 e 4) + playbook Rafael + persona final + testes de integração.

Cada fase é independentemente entregável (novas tools + testes + deploy da EF `nexo-chat`).
Deploy da edge function é feito pelo orquestrador (via MCP Supabase / CLI com token), não pelo gsd-executor.
