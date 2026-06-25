# Phase 57: Nexo Conversacional (Chat Consultor) - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Source:** Decisões travadas com Wesley nesta sessão (equivalente a discuss-phase)

<domain>
## Phase Boundary

Evoluir o Consultor v2 de saídas one-shot (resumo COO + "Explicar", Phase 53 — já em produção) para um **chat conversacional multi-turno** com o **Nexo**: um consultor COO especialista do negócio, acessível de qualquer tela, que raciocina sobre os dados ao vivo da conta atual e responde calibrado por TODOS os playbooks da metodologia.

**Entrega:** painel de chat flutuante "Nexo" (todas as telas) + EF `nexo-chat` (Gemini 2.5 Pro com function-calling read-only). Conversa efêmera. Read-only — não muta o ML (sugere e encaminha pro pipeline de aprovação da Phase 54).

**NÃO faz parte:** persistência de conversa (tabela de mensagens), execução de mutação pelo chat, multi-loja drill-down (Phase 55), notificações.
</domain>

<decisions>
## Implementation Decisions

### Modelo / LLM
- Chat usa **Gemini 2.5 Pro** (`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`, header `x-goog-api-key`). Se truncar resposta, aplicar `thinkingConfig.thinkingBudget=0` (lição da Phase 53 com 2.5-flash).
- Modelo configurável via `consultor_config.llm_model` (já existe a coluna). Resumo/Explicar da 53 continuam no Flash.
- `GEMINI_API_KEY` lida do vault via RPC `get_app_secret('GEMINI_API_KEY')` (SECURITY DEFINER, service_role only) — mesmo padrão da EF `consultor-llm`.

### Persona + Playbooks (habilidades completas)
- Persona = **Nexo, COO/consultor sênior** (PT-BR, foco em lucro líquido; "faturamento é vaidade"). Reúne num só agente as competências dos 4 analistas: Gabriel (financeiro), Laura (ads/SEO/conversão), Estela (estoque), Rafael (competitivo).
- **TODOS os playbooks embutidos no system prompt** (~49KB ≈ 13K tokens, cabe folgado no Gemini). Fontes na skill Nexo: `/root/.claude/skills/nexo/references/strategic_playbooks.md` + `/root/.claude/skills/nexo/references/ads/` (playbooks: break_even, lifecycle, tacos_guardrail, funnel_structure, bidding_strategy, ads_x_organic, inventory_runway; benchmarks by_category + by_lifecycle; pitfalls; glossary).
- **CRÍTICO:** a EF Deno NÃO tem acesso a `/root/.claude`. O plano DEVE copiar esses arquivos para dentro do repo (ex: `supabase/functions/nexo-chat/playbooks.ts` exportando as strings, ou `_shared/playbooks/`). O conteúdo é versionado no repo.
- Respostas citam o playbook usado, formato `[playbook: X]`, quando aplicável.
- Barra de qualidade: **especialista de verdade** — raciocínio analítico multi-passo, não respostas rasas.

### Function-calling read-only (dados ao vivo)
- O Nexo consulta dados sob demanda via tools (function declarations do Gemini). Conjunto inicial sugerido (mapear a RPCs/queries JÁ existentes em ckcdevcxgvueywivefgx — o researcher deve inventariar o que existe):
  - margem por SKU (ex: RPC de margem/MCO por item — a mesma da Phase 48)
  - velocidade de venda / sales velocity
  - ads (gasto, ROAS, TACoS, campanhas) — ml_ads_products_cache
  - estoque crítico / cobertura / ruptura
  - KPIs do dia (MCO, faturamento, etc.)
  - insights ativos do consultor (tabela insights)
  - DRE / billing mensal
- **ANTI-IDOR (inviolável):** cada tool executa server-side e filtra SEMPRE por `organization_id` derivado do JWT do usuário — NUNCA por org que o modelo forneça nos argumentos da tool. O modelo nunca recebe nem escolhe org/seller. Padrão SECURITY INVOKER ou service-role + filtro explícito por org (ver `feedback_supabase_security_invoker`).
- Loop de tool-calling na EF: Gemini pede tool → EF executa (escopada) → devolve resultado → Gemini → resposta final. **Cap de tool-calls por turno** (ex: 5) + timeout, para conter custo/latência.

### Conversa / UI
- **Painel flutuante** "Nexo" — botão no canto, abre/fecha sobre qualquer página. Só aparece com ML conectado.
- **Efêmero:** histórico mantido no estado do cliente (React) e reenviado a cada turno para a EF. SEM tabela de mensagens nova.
- Render do texto como parágrafos (sem markdown renderer / sem dangerouslySetInnerHTML — React escapa; mesma postura anti-XSS da 53).
- Estados: enviando (spinner/typing), erro (toast sonner), kill-switch desligado → painel indisponível.

### Segurança / reuso
- Reusar a base da EF `consultor-llm`: auth por JWT do usuário (`getUser` + `is_org_member`), `verify_jwt=true`, kill-switch `consultor_config.llm_enabled`, vault `get_app_secret`.
- **Read-only:** o chat NÃO chama nenhuma mutação ML. Quando recomenda uma ação concreta (baixar lance, mudar preço, pausar anúncio), encaminha para o pipeline de aprovação da Phase 54 (não dispara).
- Anti-invenção de número: instrução estrita de só usar números vindos de tool-results/contexto (filosofia do numericGuard da 53; em chat é via instrução forte + grounding, não regex pós-hoc obrigatório).

### Claude's Discretion
- Estrutura exata dos arquivos de playbook no repo (single bundle vs múltiplos).
- Nomes/assinaturas exatas das function declarations e mapeamento fino para RPCs (o researcher inventaria o que já existe).
- Componentes de UI (FAB + Sheet/Dialog do shadcn já disponível) e gestão de estado do chat.
- Formato do streaming (pode ser non-streaming numa v1, igual à 53).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### EF de referência (reusar padrões)
- `supabase/functions/consultor-llm/index.ts` — auth JWT + is_org_member, vault get_app_secret, kill-switch, Gemini call, CORS, verify_jwt=true. Base direta da nova EF.
- `supabase/functions/consultor-actions/index.ts` — padrão anti-IDOR (token/dados por org), pre-flight, audit (referência de como escopar por org com segurança).

### Frontend de referência
- `src/hooks/useConsultorInsights.ts` — invoke de EF via supabase.functions.invoke com org_id; padrão de query/mutation.
- `src/components/mercadolivre/ConsultorLLMSummary.tsx` + `src/components/mercadolivre/ConsultorCard.tsx` — render de texto LLM (parágrafos, sem markdown), shadcn Card/Button.
- `src/contexts/OrganizationContext.tsx` — `currentOrg.id` (org do JWT no cliente).

### Playbooks (copiar para o repo)
- `/root/.claude/skills/nexo/references/strategic_playbooks.md`
- `/root/.claude/skills/nexo/references/ads/playbooks/*.md`, `ads/benchmarks/*.md`, `ads/pitfalls.md`, `ads/glossary.md`

### Dados / RPCs existentes (o researcher inventaria as RPCs reais para as tools)
- Tabelas/RPCs do consultor: `insights`, `consultor_config` (llm_enabled, llm_model), `consultor_health_snapshots`.
- Margem/MCO por SKU: RPC da Phase 48 (`get_margin_*` / ads-aware) — confirmar nome.
- Ads: `ml_ads_products_cache`. Estoque/cobertura, DRE/billing: confirmar fontes em uso pelo dashboard.

### Decisões de plataforma
- `.planning/REQUIREMENTS.md` (NEXO-01..07 + nota de reversão do "chat aberto").
- `.planning/ROADMAP.md` (Phase 57 — decisões travadas).
</canonical_refs>

<specifics>
## Specific Ideas

- A reversão do "chat aberto" do Out of Scope é deliberada e mitigada: domínio restrito + ancorado + read-only + anti-invenção. O planner deve tratar grounding e anti-IDOR como requisitos de segurança de primeira classe (threat model).
- "Especialista de verdade": o system prompt deve instruir raciocínio passo-a-passo, cruzar domínios (ex: ads × margem × estoque), e citar playbook. Considerar few-shot curto no prompt.
- Cap de tool-calls + timeout é guardrail de custo (Gemini Pro é ~10x Flash).
</specifics>

<deferred>
## Deferred Ideas

- Persistência de conversa (histórico salvo, retomar depois) — v2.
- Streaming de resposta token-a-token — pode ser non-streaming na v1.
- Nexo disparar ação direto (sem aprovação) — proibido por regra de plataforma; sempre via Phase 54.
- Drill-down por loja dentro do chat — depende da Phase 55.
- Notificação proativa do Nexo (Telegram/push) — fora de escopo.
</deferred>

---

*Phase: 57-nexo-conversacional-chat-consultor*
*Context gathered: 2026-06-24 (decisões travadas com Wesley)*
