# Phase 96 — Plan Check (pré-execução)

**Veredito: PASS** (com 2 warnings, nenhum blocker)

## Metodologia

Lidos: 96-CONTEXT.md, 96-RESEARCH.md (corpo + ADENDO de banco vivo), ROADMAP.md §Phase 96, os 8 planos completos.
Confrontado o texto dos planos com o código real em `main`/branch atual (`src/hooks/useMLBilling.ts`, `src/pages/MercadoLivre.tsx`, `src/components/mercadolivre/MLCostCard.tsx`, `src/lib/dreRegime.ts`) via leitura direta — não apenas confiando na prosa do RESEARCH.
Sem acesso a MCP Supabase nesta sessão de verificação (tool não disponível) — os achados de banco vivo do ADENDO foram aceitos como fonte (já rodados em prod, datados de hoje), e os checkpoints de aplicação de migration (96-03/04/07/08) já preveem a verificação live pelo orquestrador antes de aplicar.

## 1. Cobertura dos 6 Success Criteria

| SC | Coberto por | Veredito |
|---|---|---|
| SC1 (swing 52.496,21) | 96-01 (tarifas), 96-03 (CMV), 96-06+96-08 (cartão/nao_class expostos) | OK — ver nota abaixo |
| SC2 (tarifas 63.878,37) | 96-01 Task 1 (TDD, fixture exata) | OK |
| SC3 (gate impede 39 SKUs) | 96-03 (RPC gaps) + 96-06 (fiação do botão) | OK |
| SC4 (gate imposto por status) | 96-02 Task 1 (TDD, 10 casos) | OK |
| SC5 (previsão byte-a-byte) | 96-02/96-06 (resolveDreRegime intocado, 18/18 testes) | OK, com ressalva de escopo — ver Warning 1 |
| SC6 (INSS no bloco Pessoal) | 96-02 Task 2 (teste de não-mudança) | OK |

**Nota sobre SC1 e as 2 parcelas "não entregues por código" (cartão, não_classificado):** confirmado no 96-08 (linhas 100-105) que o planner registra essas 2 parcelas explicitamente como "identificadas e expostas pelo sistema, correção pendente do dono" — não como FAIL. Isso é coerente com o CONTEXT §[C9] e §[C8], que dizem literalmente "Wesley corrige na fonte" / "só informar". A soma das 4 parcelas (11.248,96 + 9.887,92 + 20.550,13 + 10.809,20 = 52.496,21) é matematicamente provada por query no checkpoint do 96-08, mas 2 delas só fecham de fato depois que o Wesley editar o Tiny. Isso é uma decisão de escopo correta e documentada — **não é um furo de coerência**, é exatamente o que o CONTEXT autorizou.

## 2. Achado da tripla duplicação — CONFIRMADO no código real

Verifiquei linha a linha em `src/pages/MercadoLivre.tsx` (branch atual):
- Linha 252: `const { groups: gruposTarifas, totalTarifas } = useMemo(() => groupBillingCharges(...))` — `totalTarifas` é destructurado e **nunca mais referenciado** no arquivo (`grep -n` confirma zero outros usos).
- Linhas 337-357: `gruposTarifasEfetivos` e `totalTarifasEfetivo = gruposTarifasEfetivos.reduce((s,g) => s + g.amount, 0)` — **re-soma o array**, ignorando a exclusão do parcelamento.
- Linha 861: `totalTarifas={totalTarifasEfetivo}` no `<MLCostCard>` — é o `totalTarifasEfetivo` (a re-soma) que chega à tela, não o `totalTarifas` do hook.
- Linha 365: `margemContribuicao = receitaMes - totalTarifasEfetivo - ...` — mesma fonte errada.
- `src/components/mercadolivre/MLCostCard.tsx:112-117`: `const lucro = receitaMes - totalTarifas - (cmvMes ?? 0) - (impostosMes ?? 0)` — **segunda fórmula de margem**, independente da de `MercadoLivre.tsx:364-367`.

**Confirmado: corrigir só `groupBillingCharges` (96-01) NÃO move a tela.** O plano 96-05 Task 3 endereça isso corretamente: unifica os dois memos num só (`{ groups, totalTarifas }` vindo direto de `groupBillingCharges` quando há billing real), remove a re-soma (`gruposTarifasEfetivos.reduce` vira gate de grep = 0), e o 96-05 Task 1/2 elimina a segunda fórmula (`lucro`) do `MLCostCard.tsx`, substituindo por uma única fonte pura (`computeMargemContribuicao`). Os 3 pontos de duplicação têm gate de grep na `acceptance_criteria`. **Sem furo — o plano fecha exatamente o achado.**

## 3. SC5 × SC2/SC4/SC5(código) — tensão real, mas não é blocker

`resolveDreRegime` (`src/lib/dreRegime.ts:99-133`) só decide CMV (médio×cheio) e imposto (estimado×guia real) — nunca lê tarifas. Confirmado por leitura direta: o branch `!isClosed` não referencia `totalTarifas`/billing em nenhum ponto.

Só que `groupBillingCharges`/`useMLBillingDaily` (96-01, C2/C4/C5) são consumidos **independente do regime** — a correção do parcelamento e da competência vale para o mês aberto também. Isso significa que **as tarifas exibidas num mês "previsão" VÃO mudar** depois da phase (caem quando o parcelamento sai do total; podem mudar de valor pelo troca de `charge_date`→`competence_date`).

O ROADMAP diz literalmente: *"Previsão (mês aberto) permanece byte-a-byte igual à atual — zero regressão da Phase 88/94."* Lido ao pé da letra, isso conflitaria com a mudança de tarifas em mês aberto. Mas:
- O RESEARCH (linhas 286-293, 442) já interpreta o SC5 como escopado ao **resolver de regime** (CMV/imposto), não a tudo que aparece na tela — é "zero regressão **da Phase 88/94**", e Phase 88/94 tratou especificamente do par médio/cheio + estimado/guia-real, não de tarifas.
- O 96-08 checkpoint (item 7 da validação visual) pede para conferir explicitamente **"CMV e Impostos continuam iguais ao de antes"** num mês aberto — e **omite tarifas** dessa verificação, o que é coerente com "tarifas mudam de propósito, CMV/Impostos não".
- Isso é o comportamento CORRETO pretendido pelo Wesley: o parcelamento não ser custo é um fato válido para qualquer mês, não só os fechados.

**WARNING (não blocker):** a tensão entre a redação literal do SC5 do ROADMAP e o comportamento pretendido não está documentada em nenhum lugar dos 8 planos nem do CONTEXT. Isso é inofensivo para a execução (o design está certo), mas pode gerar confusão no checkpoint do 96-08 quando o Wesley notar que as tarifas do mês corrente (aberto) mudaram de valor e perguntar "isso não devia ser byte-a-byte igual?". Recomendação: adicionar 1 frase ao checkpoint do 96-08 (item 7) deixando explícito que "tarifas mudam em qualquer mês, byte-a-byte só vale para CMV/Impostos (o regime da Phase 88/94)" — evita a pergunta na hora da validação.

## 4. get_cmv_cheio_gaps espelhar o WHERE do waterfall

96-03 Task 1 exige textualmente "o WHERE desta RPC (fora a condição do custo cheio nulo) tem que ser IDÊNTICO ao do get_cost_waterfall — mesmo filtro de org, mesmo ml_user_id, mesmo status IN(...), mesmo cast de data_pedido. Copie o predicado do corpo vivo, não reescreva de memória." O checkpoint da Task 2 tem um PASSO 6 dedicado exatamente a provar coerência (cmv_cheio do waterfall vs SUM(receita) dos gaps, mesmos 126574.59/23828.31). **Coberto e com prova automatizável no checkpoint.**

## 5. Ordem das waves

Wave 4 (96-06, fiação do gate) roda ANTES da Wave 5 (96-07, backfill) — confirmado nos `depends_on`. O SC3 (39 SKUs) é medido no checkpoint do 96-03 (wave 2), que roda antes do backfill (wave 5) — a ordem de medição está correta. `96-07` Task 1 é um checkpoint que decide inclusive se o backfill é necessário, e Task 4 reordena explicitamente "deploy EF → re-sync → backfill" com aviso de que inverter vira no-op silencioso. **Ordem correta.**

**Pequena inconsistência de bookkeeping (WARNING, não blocker):** `96-04` tem `depends_on: []` mas `wave: 2`. Pela regra "depends_on: [] = Wave 1", deveria estar na wave 1. Não é um erro funcional — `96-04` realmente não depende de nada e rodar em wave 1 ou 2 dá o mesmo resultado; parece uma escolha deliberada de agrupar os 2 planos com checkpoint de migration (96-03 e 96-04) na mesma wave para o orquestrador rodar os dois checkpoints de banco em sequência. Mas viola a regra declarada de numeração de wave — vale corrigir a wave para 1 ou documentar a razão da exceção.

## 6. Riscos de banco / IDOR / perf

- Todas as RPCs novas (`get_cmv_cheio_gaps`, `get_cancelled_revenue`, `get_dre_nao_classificado_items`) declaram `SECURITY INVOKER` explicitamente + `SET search_path TO 'public'` + `REVOKE FROM PUBLIC, anon` + `GRANT TO authenticated` — confirmado nos 3 planos de migration.
- Prova anti-IDOR obrigatória em cada checkpoint (impersonar JWT Pé Vermeio contra org Thales, esperar 0 linhas, com prova de controle da própria org) — presente nos 3 checkpoints de migration (96-03 Task 2 PASSO 7, 96-04 Task 2 PASSO 6).
- Subquery correlacionada: nenhuma das 3 RPCs novas usa subquery correlacionada — todas são `GROUP BY` simples ou `SELECT` direto. O plano 96-03 registra explicitamente o cuidado ("sem subquery correlacionada — essas estouram o statement_timeout de 8s").
- `orders.data_pedido` é TEXT — os planos herdam o cast já usado no waterfall vivo em vez de reescrever, e o 96-03 threat model (T-96-09) já prevê fallback (comparação por string ISO) se o timeout aparecer.
- `get_cost_waterfall` (DROP+CREATE): plano exige preservar as 6 colunas restantes byte-a-byte (prova antes/depois no checkpoint, PASSO 2 vs PASSO 4) — mitigação correta ao risco dos 6 consumidores documentado no RESEARCH.

**Sem furo encontrado nesta dimensão.**

## 7. Numeração de migration

Nenhum dos 4 arquivos de migration é numerado estaticamente no plano — todos usam nome provisório em disco e são renomeados no checkpoint, DEPOIS de `SELECT max(version) FROM supabase_migrations.schema_migrations` rodado ao vivo (96-03 Task 2 PASSO 0, 96-04 Task 2 PASSO 0, 96-07 Task 1 PASSO 4). Isso é o design correto para não confiar em `ls` do repo desatualizado (o RESEARCH já documentou que o repo está ~19 dias atrás do banco). Não consegui rodar a query eu mesmo nesta sessão de verificação (sem MCP disponível), mas o design é robusto a qualquer valor atual de `max(version)` — **não é um risco de plano, é um risco operacional que os checkpoints já mitigam corretamente.**

## 8. Escopo

- C10 (separar juros/principal do empréstimo, REJEITADO): busquei menção em todos os 8 planos — nenhum toca o bloco financeiro/empréstimo além do C9 (alerta de double-count, que é outra coisa). **Não reaberto.**
- C8 (não classificado): 96-04/96-06 são explícitos e repetidos — "nunca auto-corrigir", "não altere o valor da linha, não subtraia, não esconda". **Sem auto-correção.**
- `paid_revenue`: 96-03/96-04 tratam isso como restrição dura, com gate de grep e prova de não-regressão no checkpoint (PASSO 2 vs PASSO 4 idênticos nas outras 6 colunas) — os 6 consumidores documentados no RESEARCH (`/financeiro`, MCO, GoalsCard, Nexo, useAutoRecalc, o próprio card) não são tocados; C1 usa uma RPC nova e isolada (`get_cancelled_revenue`) em vez de mudar o significado da existente. **`paid_revenue` preservado.**

## 9. Qualidade de task

32 blocos `<read_first>` distribuídos pelos 8 planos, cada task com `<files>`/`<action>`/`<verify>`/`<acceptance_criteria>`/`<done>`. `grep` não encontrou nenhum critério subjetivo ("parece correto", "configurado corretamente", "deve funcionar"). Todos os `<acceptance_criteria>` são verificáveis por comando (grep de contagem, `npx vitest run`, `npx tsc --noEmit`, diff de arquivo). **Sem furo.**

---

## Resumo dos achados

| # | Severidade | Descrição | Plano | Ação recomendada |
|---|---|---|---|---|
| 1 | WARNING | SC5 do ROADMAP diz "byte-a-byte igual" para mês aberto, mas C2/C4/C5 mudam tarifas em qualquer mês (incluindo abertos) — tensão real, mas o comportamento é o pretendido pelo dono e o RESEARCH já escopa SC5 a CMV/imposto. Não documentado explicitamente em nenhum plano. | Todos (implícito) | Adicionar 1 frase ao checkpoint do 96-08 (item 7) explicando que "byte-a-byte" do SC5 cobre CMV/Impostos, não tarifas — evita confusão do Wesley na validação visual |
| 2 | WARNING | `96-04` tem `depends_on: []` mas `wave: 2` — inconsistente com a regra "depends_on: [] = Wave 1" | 96-04 | Corrigir a wave para 1, ou documentar no plano que é agrupamento deliberado com 96-03 (2 checkpoints de banco na mesma wave) |

**Nenhum blocker encontrado.** A cobertura dos 6 SC é completa, a tripla duplicação de tarifas/margem (o risco mais sério de "plano completo mas não move a tela") está corretamente endereçada no 96-05, as RPCs novas têm INVOKER + anti-IDOR provado em checkpoint, a ordem das waves está correta para o SC3 medir antes do backfill, e nenhum plano reabre C10 ou tenta auto-corrigir C8/tocar `paid_revenue`.

**Recomendação: liberar para execução.** Os 2 warnings são de documentação/bookkeeping, não de código ou lógica — podem ser corrigidos durante a execução (ex.: o executor do 96-08 já pode incluir a frase de esclarecimento no checkpoint) sem precisar voltar ao planner.
