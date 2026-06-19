---
phase: 46-ux-para-leigos
plan: 04
type: execute
wave: 3
depends_on: ["46-02", "46-03", "46-05"]
files_modified:
  - src/lib/kpi-glossary.ts
autonomous: false
requirements: [UX-01, UX-02, UX-03, UX-04]
user_setup: []

must_haves:
  truths:
    - "A cobertura UX-01 está enumerada: grep lista todos os consumidores de <KPICard> e cada um reachable mapeável tem glossário (exceções intencionais documentadas)."
    - "Wesley revisou e aprovou a redação leiga das ~26 definições do glossário (D-03)."
    - "Wesley confirmou visualmente que tooltips abrem por hover e por tap, empty states orientam ação, tabelas viram cards em mobile e o dark mode não está quebrado nas 6 páginas incl. /precificacao (UX-01..04)."
  artifacts:
    - path: "src/lib/kpi-glossary.ts"
      provides: "Glossário com redação final aprovada por Wesley (se houver ajustes)"
      contains: "KPI_GLOSSARY"
  key_links:
    - from: "checkpoint visual"
      to: "src/lib/kpi-glossary.ts"
      via: "ajustes de redação solicitados por Wesley aplicados ao Record"
      pattern: "KPI_GLOSSARY"
---

<objective>
Fechar a Fase 46 com a verificação humana exigida por D-03 (Wesley revisa a redação do glossário) e pela diretriz de checkpoint visual do projeto (Wesley aprova o look do dashboard). Este plano roda depois que os planos 02, 03 e 05 entregaram todo o wiring — é o gate de evidência de cobertura + qualidade editorial e visual antes do fechamento da fase.

Purpose: D-03 determina explicitamente "agentes redigem; Wesley revisa". As ~26 definições foram redigidas no plano 01 como melhor esforço; aqui Wesley valida o tom leigo e o look geral (tooltips, empty states, mobile, dark mode nas 6 páginas incl. /precificacao), e quaisquer ajustes de redação são aplicados ao glossário. Antes do checkpoint, a Task 1 enumera todos os sites de KPICard para dar evidência de cobertura total (UX-01) ao verifier.
Output: enumeração de cobertura + aprovação registrada + (se necessário) ajustes de redação em `src/lib/kpi-glossary.ts`.
</objective>

<execution_context>
@/root/.claude/gsd-core/workflows/execute-plan.md
@/root/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/46-ux-para-leigos/46-CONTEXT.md
@.planning/phases/46-ux-para-leigos/46-01-SUMMARY.md
@.planning/phases/46-ux-para-leigos/46-02-SUMMARY.md
@.planning/phases/46-ux-para-leigos/46-03-SUMMARY.md
@.planning/phases/46-ux-para-leigos/46-05-SUMMARY.md
@src/lib/kpi-glossary.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enumerar cobertura de KPICard (UX-01) + tsc/build/lint limpos</name>
  <files>(nenhum — comandos de verificação)</files>
  <read_first>
    - Os quatro SUMMARYs (01/02/03/05) para saber o que foi entregue e onde testar, incluindo a lista de "KPIs sem termo de glossário" registrada pelos planos 02/03/05.
  </read_first>
  <action>
    Antes de chamar Wesley: (1) COBERTURA UX-01 — rodar `grep -rl "KPICard" src --include='*.tsx'` para listar TODOS os consumidores de KPICard, e para cada arquivo (exceto o próprio KPICard.tsx) confirmar que recebe tooltip do glossário OU consta na lista de "KPIs sem termo de glossário (sem tooltip por design)" dos SUMMARYs dos planos 02/03/05. Registrar a tabela de cobertura final no SUMMARY deste plano (arquivo → KPICards com glossário / exceções documentadas), dando evidência auditável ao verifier. Se algum consumidor reachable mapeável ficou sem tooltip e sem justificativa, é um gap — sinalizar para correção antes do checkpoint. (2) INTEGRIDADE — rodar `npx tsc --noEmit`, `npm run build` e `npm run lint` e resolver qualquer erro remanescente dos planos 01-03/05. Subir o dev server (`npm run dev`, porta 8080) para a validação visual. Preparar um resumo curto das ~26 definições do glossário para Wesley revisar termo a termo.
  </action>
  <verify>
    <automated>grep -rl "KPICard" src --include='*.tsx' && npx tsc --noEmit && npm run build 2>&1 | tail -3</automated>
  </verify>
  <acceptance_criteria>
    - A enumeração `grep -rl "KPICard" src --include='*.tsx'` foi executada e a tabela de cobertura (glossário vs exceção documentada) consta no SUMMARY.
    - Nenhum consumidor reachable mapeável ficou sem tooltip e sem justificativa.
    - `npx tsc --noEmit` sem erros; `npm run build` conclui; dev server em :8080.
  </acceptance_criteria>
  <done>Cobertura UX-01 enumerada e auditável; build limpo; ambiente pronto e lista de definições preparada para Wesley.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Checkpoint Wesley — redação do glossário + look do dashboard (D-03)</name>
  <files>(nenhum — verificação humana)</files>
  <action>
    Apresentar a Fase 46 a Wesley para verificação humana (D-03: agentes redigem, Wesley revisa). Com o dev server em :8080, conduzir Wesley pela checklist de `<how-to-verify>` cobrindo os 4 entregáveis (glossário, tooltip hover+tap, empty states, tabelas mobile, dark mode/tokens nas 6 páginas incl. /precificacao). Coletar quaisquer pedidos de reescrita de redação ou ajuste visual e registrá-los para a Task 3. Não fechar a fase sem o sinal explícito de aprovação.
  </action>
  <what-built>
    Fase 46 completa: (UX-01) glossário central de ~26 KPIs com gatilho "?" hover+tap em TODOS os sites reachable de KPICard (MLKPIGrid + 3 páginas-tabela + /publicidade /relatorios /reputacao /metas /tv /integracoes); exceções sem termo documentadas; (UX-02) componente EmptyState aplicado em ~8 empty states com instrução de ação específica; (UX-03) tabelas de /anuncios, /pedidos e /financeiro viram cards empilhados abaixo de 768px; (UX-04) cores semânticas migradas para tokens kpi nas 6 páginas principais (incl. /precificacao), com dark mode preservado.
  </what-built>
  <how-to-verify>
    Com o dev server em http://localhost:8080:
    1. GLOSSÁRIO (D-03): revisar a lista das ~26 definições leigas (apresentada no resumo). Para cada termo, confirmar que está em linguagem de lojista (sem jargão), 1 frase, com exemplo quando ajuda. Anotar quaisquer reescritas desejadas.
    2. TOOLTIP HOVER (UX-01, desktop): em /vendas (dashboard ML), passar o mouse sobre o "?" de um KPI → o popover com a definição abre.
    3. TOOLTIP TAP (UX-01, mobile): no DevTools com viewport 375px (modo touch), tocar no "?" de um KPI → o popover abre ao toque (não só no hover).
    4. EMPTY STATES (UX-02): visitar uma página sem dados (ex.: /estoque desconectado, ou um filtro sem resultado em /anuncios) → o empty state mostra ícone + título + instrução de ação específica (e CTA quando aplicável).
    5. MOBILE TABLES (UX-03): em viewport 375px, abrir /anuncios, /pedidos e /financeiro → a tabela vira lista de cards empilhados, sem scroll horizontal quebrado; em ≥768px a tabela volta ao normal.
    6. DARK MODE / TOKENS (UX-04): alternar para dark mode e percorrer /anuncios, /pedidos, /financeiro, /estoque, dashboard ML e /precificacao (Simulador + Análise) → valores positivos (verde) e negativos (vermelho) legíveis; nenhum elemento quebrado; cores de status/charts intactas.
  </how-to-verify>
  <verify>
    <human-check>Wesley percorre a checklist de how-to-verify e responde "approved" ou lista ajustes.</human-check>
  </verify>
  <resume-signal>Digite "approved" para fechar a fase, ou liste os ajustes de redação/visual desejados.</resume-signal>
  <done>Wesley aprovou (ou listou ajustes para a Task 3) a redação do glossário e o look das 6 páginas.</done>
</task>

<task type="auto">
  <name>Task 3: Aplicar ajustes de redação solicitados por Wesley (se houver)</name>
  <files>src/lib/kpi-glossary.ts</files>
  <read_first>
    - Os ajustes anotados por Wesley no checkpoint da Task 2.
    - src/lib/kpi-glossary.ts — entradas a reescrever.
  </read_first>
  <action>
    Se Wesley pediu reescritas, aplicá-las ao `KPI_GLOSSARY` em `src/lib/kpi-glossary.ts` (texto de `definition`/`example`), mantendo as chaves e a estrutura tipada intactas. Como o glossário é fonte única (D-01), o ajuste propaga automaticamente para todos os sites de KPI — não há mais nada a editar. Se Wesley aprovou sem ajustes, esta task é no-op (registrar "sem ajustes" no SUMMARY). Não introduzir mudanças fora do que Wesley pediu.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | grep -i "kpi-glossary" ; test -z "$(npx tsc --noEmit 2>&1 | grep -i kpi-glossary)" && echo OK</automated>
  </verify>
  <acceptance_criteria>
    - Ajustes de redação de Wesley aplicados apenas em `definition`/`example` (chaves/tipos intactos).
    - Se sem ajustes: SUMMARY registra a aprovação direta.
    - `npx tsc --noEmit` limpo.
  </acceptance_criteria>
  <done>Redação final do glossário reflete a aprovação de Wesley; tsc limpo; fase pronta para fechar.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (nenhuma nova) | Plano de verificação/edição de texto estático. Sem fluxo de dados, auth ou input novo. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-46-07 | Tampering (XSS) | Texto do glossário renderizado nos popovers | mitigate | Edições são literais de string no Record, renderizados como texto puro (garantia herdada do KPICard/EmptyState do plano 01). Nenhum HTML bruto. |
| T-46-08 | (S/R/I/D/E) | — | accept | Nenhuma superfície nova; checkpoint humano + ajuste editorial. Risco residual desprezível. |
</threat_model>

<verification>
- Enumeração `grep -rl "KPICard" src --include='*.tsx'` executada; tabela de cobertura no SUMMARY.
- `npx tsc --noEmit`, `npm run build` e `npm run lint` limpos.
- Wesley confirmou redação + look das 6 páginas (resume-signal "approved").
- Ajustes de redação (se houver) aplicados só no glossário.
</verification>

<success_criteria>
- Cobertura UX-01 enumerada e auditável (todo KPICard reachable mapeável com glossário; exceções documentadas).
- Wesley aprovou a redação leiga das ~26 definições (D-03) e o look das 6 páginas incl. /precificacao (UX-01..04).
- Glossário reflete a redação final aprovada.
- Fase 46 pronta para fechar com os 4 critérios de sucesso do ROADMAP atendidos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 04)

**Sem novos arquivos.**
- Tabela de cobertura de KPICard registrada no SUMMARY (evidência UX-01).
- Aprovação visual/editorial de Wesley registrada no SUMMARY.
- (Condicional) ajustes de redação aplicados a `src/lib/kpi-glossary.ts`.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-04-SUMMARY.md` when done.
</output>
