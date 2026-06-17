---
phase: 46-ux-para-leigos
plan: 04
type: execute
wave: 3
depends_on: ["46-02", "46-03"]
files_modified:
  - src/lib/kpi-glossary.ts
autonomous: false
requirements: [UX-01, UX-02, UX-03, UX-04]
user_setup: []

must_haves:
  truths:
    - "Wesley revisou e aprovou a redação leiga das ~26 definições do glossário (D-03)."
    - "Wesley confirmou visualmente que tooltips abrem por hover e por tap, empty states orientam ação, tabelas viram cards em mobile e o dark mode não está quebrado nas 6 páginas (UX-01..04)."
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
Fechar a Fase 46 com a verificação humana exigida por D-03 (Wesley revisa a redação do glossário) e pela diretriz de checkpoint visual do projeto (Wesley aprova o look do dashboard). Este plano roda depois que os planos 02 e 03 entregaram todo o wiring — é o gate de qualidade editorial e visual antes do fechamento da fase.

Purpose: D-03 determina explicitamente "agentes redigem; Wesley revisa". As ~26 definições foram redigidas nos planos 01-03 como melhor esforço; aqui Wesley valida o tom leigo e o look geral (tooltips, empty states, mobile, dark mode), e quaisquer ajustes de redação são aplicados ao glossário.
Output: aprovação registrada + (se necessário) ajustes de redação em `src/lib/kpi-glossary.ts`.
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
@src/lib/kpi-glossary.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Preparar o ambiente para validação visual + tsc/build/lint limpos</name>
  <files>(nenhum — comandos de verificação)</files>
  <read_first>
    - Os três SUMMARYs (01/02/03) para saber o que foi entregue e onde testar.
  </read_first>
  <action>
    Antes de chamar Wesley, garantir que o conjunto da fase está íntegro: rodar `npx tsc --noEmit`, `npm run build` e `npm run lint` e resolver quaisquer erros remanescentes introduzidos pelos planos 01-03. Subir o dev server (`npm run dev`, porta 8080) para a validação visual. Preparar um resumo curto das ~26 definições do glossário (extraídas de `src/lib/kpi-glossary.ts`) para Wesley revisar a redação termo a termo.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npm run build 2>&1 | tail -3</automated>
  </verify>
  <acceptance_criteria>
    - `npx tsc --noEmit` sem erros.
    - `npm run build` conclui com sucesso.
    - Dev server disponível em :8080 para a validação visual.
  </acceptance_criteria>
  <done>Build limpo e ambiente pronto; lista de definições do glossário preparada para revisão de Wesley.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Checkpoint Wesley — redação do glossário + look do dashboard (D-03)</name>
  <files>(nenhum — verificação humana)</files>
  <action>
    Apresentar a Fase 46 a Wesley para verificação humana (D-03: agentes redigem, Wesley revisa). Com o dev server em :8080, conduzir Wesley pela checklist de `<how-to-verify>` cobrindo os 4 entregáveis (glossário, tooltip hover+tap, empty states, tabelas mobile, dark mode/tokens). Coletar quaisquer pedidos de reescrita de redação ou ajuste visual e registrá-los para a Task 3. Não fechar a fase sem o sinal explícito de aprovação.
  </action>
  <what-built>
    Fase 46 completa: (UX-01) glossário central de ~26 KPIs com gatilho "?" hover+tap em todos os ~16 sites de KPI; (UX-02) componente EmptyState aplicado em ~8 empty states com instrução de ação específica; (UX-03) tabelas de /anuncios, /pedidos e /financeiro viram cards empilhados abaixo de 768px; (UX-04) cores semânticas migradas para tokens kpi nas 6 páginas principais, com dark mode preservado.
  </what-built>
  <how-to-verify>
    Com o dev server em http://localhost:8080:
    1. GLOSSÁRIO (D-03): revisar a lista das ~26 definições leigas (apresentada no resumo). Para cada termo, confirmar que está em linguagem de lojista (sem jargão), 1 frase, com exemplo quando ajuda. Anotar quaisquer reescritas desejadas.
    2. TOOLTIP HOVER (UX-01, desktop): em /vendas (dashboard ML), passar o mouse sobre o "?" de um KPI → o popover com a definição abre.
    3. TOOLTIP TAP (UX-01, mobile): no DevTools com viewport 375px (modo touch), tocar no "?" de um KPI → o popover abre ao toque (não só no hover).
    4. EMPTY STATES (UX-02): visitar uma página sem dados (ex.: /estoque desconectado, ou um filtro sem resultado em /anuncios) → o empty state mostra ícone + título + instrução de ação específica (e CTA quando aplicável).
    5. MOBILE TABLES (UX-03): em viewport 375px, abrir /anuncios, /pedidos e /financeiro → a tabela vira lista de cards empilhados, sem scroll horizontal quebrado; em ≥768px a tabela volta ao normal.
    6. DARK MODE / TOKENS (UX-04): alternar para dark mode e percorrer /anuncios, /pedidos, /financeiro, /estoque, dashboard ML, /precificacao → valores positivos (verde) e negativos (vermelho) legíveis; nenhum elemento quebrado; cores de status/charts intactas.
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
- `npx tsc --noEmit`, `npm run build` e `npm run lint` limpos.
- Wesley confirmou redação + look (resume-signal "approved").
- Ajustes de redação (se houver) aplicados só no glossário.
</verification>

<success_criteria>
- Wesley aprovou a redação leiga das ~26 definições (D-03) e o look das 6 páginas (UX-01..04).
- Glossário reflete a redação final aprovada.
- Fase 46 pronta para fechar com os 4 critérios de sucesso do ROADMAP atendidos.
</success_criteria>

<artifacts_produced>
## Artifacts this phase produces (Plano 04)

**Sem novos arquivos.**
- Aprovação visual/editorial de Wesley registrada no SUMMARY.
- (Condicional) ajustes de redação aplicados a `src/lib/kpi-glossary.ts`.
</artifacts_produced>

<output>
Create `.planning/phases/46-ux-para-leigos/46-04-SUMMARY.md` when done.
</output>
