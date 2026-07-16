# Phase 98: INSS de folha na DRE deve seguir a régua M+1 — Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Source:** Conversa ao vivo com Wesley durante validação mês-a-mês (março/abril) da DRE, pós-Phase 96/97

<domain>
## Phase Boundary

Hoje o bloco "Pessoal" da DRE (`get_dre_operational_by_competence`, categoria `Pessoal - INSS`) usa o valor de INSS **do mesmo mês de competência** (`p_month`), sem nenhum deslocamento — ao contrário de ICMS/PIS/COFINS, que já usam a régua M+1 (a guia de venda do mês M sai/é paga no mês M+1, via `useImpostoGuiaReal` + RPC `get_imposto_guia_by_competence`).

Wesley confirmou (2026-07-16, ao vivo): o INSS de folha funciona com a MESMA lógica de apuração — "ele apura no mês atual, mas é referente ao mês anterior". Ou seja: a guia de INSS que sai/vence em abril é o encargo sobre a folha de **março** (mesmíssimo padrão de ICMS/PIS/COFINS, dia de vencimento ~21).

Esta phase estende a régua M+1 (já implementada e testada para os 3 impostos de venda) para também cobrir o INSS de folha, dentro do bloco "Pessoal" (que hoje soma Salários + INSS sem distinção de régua).

**Fora de escopo:** Salários continuam no mesmo mês (sem deslocamento) — só o INSS muda. Não mexer em `get_dre_operational_by_competence` nem em `get_imposto_guia_by_competence` (RPCs vivas, múltiplos consumidores — mesmo guardrail já documentado em `dreRegime.ts`/`useImpostoGuiaReal.ts`).

</domain>

<decisions>
## Implementation Decisions

### Regra de negócio (LOCKED — decisão do Wesley)
- **Opção A confirmada:** o INSS de folha usa a régua M+1, exatamente como ICMS/PIS/COFINS. A DRE de competência M mostra o INSS da guia com `competence_date = M+1`.
- Mesma semântica de status já usada pelo `resolveDreRegime` pros impostos de venda: `'cancelled'` = crédito, não soma nem bloqueia; `'paid'`/`'pending'` somam (régua de competência); guia **ausente** bloqueia o fechamento do mês (mesmo padrão do C6/C7).
- Wesley pediu explicitamente para **planejar e mostrar o plano antes de aplicar** — não implementar direto.

### Arquitetura (mesmo padrão não-invasivo do imposto de venda, já mapeado nesta sessão)
- **NUNCA modificar `get_dre_operational_by_competence`** (RPC 87) nem `get_imposto_guia_by_competence` — ambas vivas, múltiplas telas consomem (mesmo guardrail já em `dreRegime.ts`:21).
- O mecanismo existente pra impostos de venda é a referência EXATA a clonar:
  - `src/lib/dreRegime.ts` — `IMPOSTO_VENDA_CATEGORIES`, `monthPlusOne()`, `resolveDreRegime()` (filtra `status !== 'cancelled'` antes de somar, trata "todas canceladas" como 0 não-null).
  - `src/hooks/useImpostoGuiaReal.ts` — `useImpostoGuiaReal(saleMonth)` chama a RPC com `p_competence = monthPlusOne(saleMonth)`.
  - RPC `get_imposto_guia_by_competence(p_org_id, p_competence)` — filtra `category IN (3 categorias fixas)`, agrupa por `category, status`, soma `amount`.
  - `src/lib/dreCascade.ts` — `buildDreCascade(rows, margemContribuicao)` soma as `DreOperationalRow[]` por bloco (`pessoal` inclui hoje Salários + INSS, ambos do mesmo `p_month`, sem distinção).
  - `src/pages/MercadoLivre.tsx:280-346` — onde `guiaReal`/`resolveDreRegime`/`buildDreCascade` são orquestrados hoje.
- **Caminho recomendado (mirror do padrão de imposto):**
  1. Nova RPC `get_inss_guia_by_competence(p_org_id, p_competence)` — clone de `get_imposto_guia_by_competence`, mas `category = 'Pessoal - INSS'` (única categoria, não 3). Retorna `{category, total, status, n}`.
  2. Novo hook `useInssGuiaReal(saleMonth)` (mesmo arquivo `useImpostoGuiaReal.ts` ou um novo `useInssGuiaReal.ts`) — chama a RPC nova com `p_competence = monthPlusOne(saleMonth)`.
  3. Nova função pura (mirror de `resolveDreRegime`, ou extensão dela) que resolve o total de INSS real a partir do array retornado — mesma regra `status !== 'cancelled'` soma, ausente = null.
  4. `buildDreCascade` (ou o chamador em `MercadoLivre.tsx`) precisa: (a) **filtrar fora** a linha `category === 'Pessoal - INSS'` das `rows` cruas do bloco `pessoal` (que vêm sem deslocamento da RPC 87), e (b) **somar o INSS real (M+1)** no total do bloco `pessoal` no lugar dela. Isso pode virar um parâmetro extra em `buildDreCascade` (ex.: `inssReal: number | null`) em vez de mexer nas `rows` — decisão de design fica pro planner, mas a saída observável tem que ser: bloco Pessoal = Salários (mês corrente, sem deslocar) + INSS (M+1).
  5. Gate de fechamento (`dreCloseGate`/`resolveCloseGate`, `useCmvCheioGate`): decidir se guia de INSS ausente também **bloqueia fechar o mês** (mesmo padrão do C6/C7 pra impostos de venda) — **PERGUNTA ABERTA pro planner levantar como checkpoint com o Wesley**, não assumir. O achado que disparou esta phase foi justamente março travado por COFINS ausente; réplica do mesmo comportamento pro INSS é o padrão mais consistente, mas não foi confirmado explicitamente.

### Dado real observado nesta sessão (pra validar a implementação)
- Org Pé Vermeio `7f615df7-7bac-45e5-8a93-827fb9ddeec7`, seller ML `1639558873`.
- `Pessoal - INSS` competência 2026-03-01 = R$1.550,00 `paid` (guia de fevereiro).
- `Pessoal - INSS` competência 2026-04-01 = R$1.550,00 `cancelled` (guia de março — crédito, Wesley confirmou "PIS e COFINS foram cancelados... só teve ICMS", e o mesmo vale pro INSS desse mês).
- Existe uma 2ª linha "Guia INSS" (R$2.652,31, `paid`) ainda sem categoria/competência atribuída pelo pipeline de enrich (`cat_backfill_queue`) no momento da escrita deste contexto — comportamento de sincronização, não faz parte do escopo de código desta phase (mas o planner deve saber que o dado de teste em prod pode estar parcialmente não-classificado até o cron de reenrich rodar).
- Padrão de vencimento: guias de imposto/INSS saem tipicamente dia 21 do mês (mesmo padrão do "empurrãozinho" `shouldNudgeClose`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning ou implementando.**

### Padrão a clonar (imposto de venda M+1)
- `src/lib/dreRegime.ts` — resolver puro, `IMPOSTO_VENDA_CATEGORIES`, `monthPlusOne()`, `resolveDreRegime()` (regra cancelled/paid/pending)
- `src/hooks/useImpostoGuiaReal.ts` — hooks `useImpostoGuiaReal`/`useImpostoGuiaNudge`, padrão de chamada RPC com `p_competence = monthPlusOne(saleMonth)`
- RPC `get_imposto_guia_by_competence` (ver definição via `pg_get_functiondef` — não há migration deste arquivo no repo local pro que já está em prod; conferir `list_migrations` antes de numerar nova)

### Cascata/consumo
- `src/lib/dreCascade.ts` — `buildDreCascade()`, tipos `DreBloco`/`DreOperationalRow`/`OPERACIONAL_BLOCOS`, bloco `pessoal`
- `src/hooks/useDreOperational.ts` — hook que chama a RPC 87 (`get_dre_operational_by_competence`) com `p_month` sem deslocamento
- `src/pages/MercadoLivre.tsx:280-346` — orquestração de `guiaReal`, `resolveDreRegime`, `closeGate`, `buildDreCascade` pro card do DRE

### Gate de fechamento (referência pra decisão do INSS ausente bloquear ou não)
- `src/lib/dreRegime.ts` (resolveCloseGate — se existir separado, senão localizar via grep) + `useCmvCheioGate` — mesmo padrão "ausente bloqueia, cancelada não bloqueia" já usado pro C6 (CMV cheio) e C7 (imposto de venda)

### Testes existentes (mirror de cobertura)
- `src/lib/dreRegime.ts` já tem teste companion (localizar `dreRegime.test.ts` se existir) cobrindo a regra cancelled/paid/pending — a nova função pro INSS deve ter cobertura equivalente
- `src/lib/dreCascade.test.ts` — testes da cascata, vão precisar de casos novos pro bloco `pessoal` com INSS deslocado

Nenhuma migration nova deve ser numerada sem antes conferir `max(version)` vivo em prod via MCP `list_migrations` (lição recorrente do projeto — `project_garment_cashflow_confianca_20260713`).

</canonical_refs>

<specifics>
## Specific Ideas

- Nome sugerido pra nova RPC: `get_inss_guia_by_competence` (simetria com `get_imposto_guia_by_competence`).
- Nome sugerido pro novo hook: `useInssGuiaReal` (simetria com `useImpostoGuiaReal`).
- Considerar se vale generalizar em vez de duplicar (uma RPC/hook parametrizado por categoria) — mas o padrão do projeto até agora é 1 RPC dedicada por grupo de categoria (impostos de venda = 3 categorias juntas porque sempre aparecem juntas na régua; INSS é uma categoria isolada com sua própria régua, então uma RPC nova e pequena é consistente com o estilo do repo, não obrigatório generalizar).
- Testes devem cobrir: mês com INSS pago, cancelado, ausente; mês fechado vs aberto (regime previsão nunca desloca — só apuração usa M+1, mesmo padrão do imposto).

</specifics>

<deferred>
## Deferred Ideas

- Nenhuma — escopo é estritamente o deslocamento M+1 do INSS no bloco Pessoal.
- Fora do código: o item de R$2.852,77 (COFINS abril) e R$2.652,31 (INSS) presos no `cat_backfill_queue`/429 do Tiny — problema de sincronização em produção, não faz parte desta phase (Phase 97 já cobre o pipeline de sync).

</deferred>

---

## Decisão pós-revisão do plano (2026-07-16)

Wesley revisou os 3 planos (98-01/02/03) e respondeu à pergunta em aberto (checkpoint `Task 1` do 98-03):

**Opção A confirmada — o gate de fechamento (`resolveCloseGate`/`canApurarImposto`) TAMBÉM deve bloquear "marcar mês como apurado" quando a guia de INSS (competência M+1) estiver ausente**, mesmo padrão do C6 (CMV cheio)/C7 (imposto de venda). Guia cancelada não bloqueia (crédito); guia ausente bloqueia.

**Importante:** os 3 planos atuais (98-01/02/03) só CAPTURAM essa decisão — não implementam a extensão do gate (por desenho, ver `98-03-PLAN.md` Task 1). A implementação de `canApurarInss` em `dreCloseGate.ts` (mirror de `canApurarImposto`) fica pendente para uma **phase futura dedicada** (candidata a Phase 99), a ser aberta após a Phase 98 fechar. Registrar como pendência explícita no STATE.md/ROADMAP.md quando a Phase 98 for encerrada.

---

*Phase: 98-inss-de-folha-na-dre-deve-seguir-a-regua-m-1-competencia-igu*
*Context gathered: 2026-07-16 via conversa direta com o dono (sem discuss-phase formal — decisão já estava fechada)*
