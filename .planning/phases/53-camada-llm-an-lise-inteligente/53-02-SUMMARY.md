# 53-02 SUMMARY — UI da camada LLM (resumo COO + Explicar)

**Status:** código completo (tsc + build + 112 testes verdes). Checkpoint visual de Wesley pendente.
**Data:** 2026-06-24

## O que foi entregue

### Backend (EF `consultor-llm` v3, ACTIVE em prod ckcdevcxgvueywivefgx)
- Adicionado modo **`explain`** (`mode:'explain'`, `insight_id`): grounding de UM insight (regra/severidade/categoria/título/detalhe/impacto), `prompt_version='explain:'+insight_id` (cache por insight/dia), numericGuard, fallback determinístico (usa `body` do insight) em erro/guard reprovado.
- Helper `callGemini()` extraído e reusado por `summary` e `explain` (config travada: gemini-2.5-flash, `thinkingBudget=0`).
- `summary` agora cai pro fallback determinístico em erro de rede/Gemini (antes 502); `force_refresh` aceito além de `refresh`.
- Smoke-test prod: `explain` HTTP 200, fallback=false, explicação ancorada; 2ª chamada `cached=true`.

### Frontend
- **`useConsultorInsights`** estendido (API antiga intacta): query `summary` (mode summary, staleTime 12h, retry:false), `refreshSummary()` (force_refresh → grava no cache via setQueryData), `explain(id)`. Expõe `summaryText/summaryDisabled/summaryFallback/summaryStale/summaryLoading/summaryRefreshing`.
- **`ConsultorLLMSummary.tsx`** (novo): prosa COO no topo de /vendas (split por `\n`, sem markdown renderer — React escapa, T-53-11). Skeleton no load; `disabled`/`fallback`/vazio → não renderiza (cai pro v1, LLM-05/07); botão "Atualizar análise" (LLM-04) com spinner; badge "análise desatualizada — clique para atualizar" quando `stale` (LLM-06); erro de refresh → toast sonner.
- **`MercadoLivre.tsx`**: `<ConsultorLLMSummary />` renderizado acima do `<ConsultorCard>` (aditivo); passa `onExplain` ao card.
- **`ConsultorCard.tsx`** + **`MLConsultor.tsx`**: botão "Explicar" por insight (prop `onExplain?`), spinner durante, explicação inline; 2ª abertura same-day vem cacheada (EF); erro → toast. Dismiss/score/ação intactos.

## Requisitos cobertos
LLM-01 (resumo COO), LLM-02 (Explicar cacheado/insight/dia), LLM-03 (prosa PT-BR), LLM-04 (Atualizar análise), LLM-05 (fallback→v1), LLM-06 (badge stale), LLM-07 (kill-switch esconde).

## Pendente
- **Checkpoint visual de Wesley** (Task 4 do plano, blocking): validar resumo no topo de /vendas, Explicar, badge stale, kill-switch, números não-divergentes. Preview Vercel.
- Blindar/remover o `smoke_token` backdoor antes de produção real (hoje gated no vault).
- ⚠️ Rotacionar `GEMINI_API_KEY` (exposta no transcript).

## Arquivos
- supabase/functions/consultor-llm/index.ts (modo explain)
- src/hooks/useConsultorInsights.ts
- src/components/mercadolivre/ConsultorLLMSummary.tsx (novo)
- src/components/mercadolivre/ConsultorCard.tsx
- src/pages/MercadoLivre.tsx
- src/pages/mercadolivre/MLConsultor.tsx
