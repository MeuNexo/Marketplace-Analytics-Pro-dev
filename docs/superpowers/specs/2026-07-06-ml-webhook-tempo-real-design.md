# Phase 86 — Webhook ML (tempo real): perguntas, reclamações e pedidos

**Data:** 2026-07-06
**Projeto:** garment-glow-test (Supabase `ckcdevcxgvueywivefgx` — NÃO o do CLAUDE.md)
**Milestone:** v8.0
**Status:** Design aprovado por Wesley (2026-07-06)

Esta é a **Phase A** de uma sequência de 4 (A→B→C→D) que resolve as dores de
atendimento ML no dashboard:

| # | Phase | Entrega | Depende de |
|---|-------|---------|------------|
| **A** | **Webhook (tempo real)** ← *esta* | Notificações ML chegam em segundos | nada |
| B | Responder reclamações + ações | EF `reply-ml-claim`, agir por dashboard | independe, brilha com A |
| C | Central unificada (inbox) | Fila priorizada perguntas+reclamações | A + B |
| D | IA (sugestão de resposta) | Sugestão de resposta (coordenar com n8n `nexo-ml-qa`) | B + C |

B/C/D estão **fora do escopo** desta phase.

---

## Goal

Substituir a latência do polling (perguntas 15min, claims 30min) por **notificações
em tempo real** do Mercado Livre. Quando um comprador faz uma pergunta, abre uma
reclamação/mediação ou fecha um pedido, o dashboard reflete isso em **segundos**,
sem redesenhar as telas existentes (`/perguntas`, `/devolucoes`, caixa/pedidos).

O polling **não é removido** — passa a rodar com frequência reduzida como rede de
segurança (reconciliação de eventos perdidos).

Sucesso = um evento real do ML aparece na tabela correta (`ml_questions` /
`ml_claims` / `orders`) em poucos segundos, com trilha de auditoria de cada
notificação recebida.

---

## Contexto (estado atual, verificado)

- **Perguntas:** `sync-ml-questions` (cron `*/15`), upsert em `ml_questions`
  (onConflict `organization_id,ml_user_id,question_id`). Página `/perguntas`.
- **Reclamações:** `sync-ml-claims` (cron `*/30`), upsert em `ml_claims`
  (`tipo` = `mediations` reclamação / `returns` devolução). Página `/devolucoes` (só leitura).
- **Pedidos:** `sync-ml-orders`, upsert em `orders`.
- **Mapeamento seller:** tabela `ml_tokens` tem `ml_user_id` (id numérico ML do seller),
  `user_id`, `organization_id`, `seller_id`, `refresh_token`. Os syncs iteram
  `ml_tokens` e resolvem token por seller (refresh automático).
- **Config ML:** `ML_APP_ID` / `ML_CLIENT_SECRET` já existem como env das EFs.
- **NÃO existe** webhook receiver nem tabela de eventos de webhook.
- **Pattern B** (Bearer service_role_key via `vault.decrypted_secrets`) é o padrão de
  cron/EF interno. Deploy de EF/migration **só via MCP** (sem token CLI).

### Como funciona a notificação ML (fatos que guiam o design)

- ML faz `POST` para uma URL de callback registrada no painel da aplicação, com corpo:
  ```json
  { "topic": "questions", "resource": "/questions/123456",
    "user_id": 456, "application_id": 789, "attempts": 1,
    "sent": "2026-07-06T12:00:00Z", "received": "2026-07-06T12:00:00Z" }
  ```
- ML espera **HTTP 200 em ~500ms**; senão **reenvia** (múltiplos `attempts`).
- ML **não assina** a mensagem (sem HMAC). Validação é responsabilidade nossa.
- O corpo **não traz o dado** — traz o `resource`. É preciso buscar
  `GET https://api.mercadolibre.com{resource}` com o token do seller.
- Tópicos desta phase: `questions`, `claims`, `orders_v2` (resource `/orders/{id}`).

---

## Arquitetura

**1 EF pública nova (`ml-webhook`) + 1 tabela de auditoria (`ml_webhook_events`).**

```
ML ──POST /functions/v1/ml-webhook/<secret>──► EF ml-webhook (verify_jwt=false)
                                                  │
   (síncrono, < 500ms)                            │ 1. valida: secret no path + user_id ∈ ml_tokens
                                                  │ 2. INSERT ml_webhook_events (raw, status=received)
                                                  │ 3. responde 200  ◄── sempre, mesmo em rejeição
                                                  │
   (assíncrono via EdgeRuntime.waitUntil)         │ 4. resolve token do seller (ml_user_id)
                                                  │ 5. GET {resource} no ML
                                                  │ 6. upsert em ml_questions | ml_claims | orders
                                                  │ 7. UPDATE ml_webhook_events.status = processed | error
                                                  ▼
                        /perguntas · /devolucoes · caixa atualizam em segundos
```

**Princípio de confiabilidade (auditoria antes de automação):** grava o evento cru
**primeiro**, responde 200, e só então processa. Se o processamento falhar, o evento
fica salvo com `status=error` + `error_msg` e é reprocessável. Nenhuma notificação se perde.

### Componentes

- **`ml-webhook/index.ts`** (EF pública, `verify_jwt=false`) — recebe, valida, grava, responde 200, processa em `waitUntil`.
- **`_shared/webhook-resource.ts`** (módulo Deno) — dado `(topic, resource, sellerRow)`, busca no ML e faz upsert na tabela certa. Reutiliza a **mesma normalização** dos syncs existentes (question row, claim row, order row) — extração/compartilhamento para não duplicar regra.
- **`ml_webhook_events`** (tabela) — trilha de auditoria + fila de retry.
- **Migration de cron** — desacelera polling e agenda reprocessamento de eventos `error`/`received` presos.
- **UI mínima** — linha de saúde "tempo real ativo · último evento há X" + painel de eventos em `AdminMonitoring`.

---

## Modelo de dados — `ml_webhook_events`

```
id              uuid pk default gen_random_uuid()
topic           text not null                     -- questions | claims | orders
resource        text not null                     -- /questions/123
ml_user_id      text                              -- user_id da notificação (numérico ML, como texto)
organization_id uuid                              -- resolvido via ml_tokens (null se rejeitado)
status          text not null default 'received'  -- received | processed | error | rejected
attempts        int  not null default 0           -- nº de tentativas de PROCESSAMENTO nosso
error_msg       text
raw             jsonb not null                    -- corpo cru da notificação
sent_at         timestamptz                       -- campo "sent" do ML (dedup)
received_at     timestamptz not null default now()
processed_at    timestamptz
```

- **RLS org-first:** SELECT permitido a membros da `organization_id`; INSERT/UPDATE
  só service_role (a EF usa service key). Super-admin vê tudo. Segue o padrão RLS
  das outras tabelas ML do projeto.
- **Dedup / idempotência:** índice único parcial em `(topic, resource, sent_at)`.
  Reenvio do ML com mesmo `sent` não cria linha nova (ON CONFLICT DO NOTHING);
  o processamento em si é upsert (reprocessar é inofensivo).
- **Índices:** `(status)` para o retry-cron; `(organization_id, received_at desc)` para o painel admin.

---

## EF `ml-webhook` — fluxo detalhado

1. **CORS/OPTIONS** — responde preflight.
2. **Valida secret** no path (`/ml-webhook/<token>`), comparado a env `ML_WEBHOOK_SECRET`
   com comparação de tempo constante. Secret errado → 200 + log (não grava evento; evita flood).
3. **Parse do corpo.** Extrai `topic`, `resource`, `user_id`, `sent`.
4. **Resolve seller:** `SELECT ... FROM ml_tokens WHERE ml_user_id = user_id`.
   Não encontrado → grava `status=rejected` e responde 200 (não vira retry infinito do ML).
5. **Grava evento** `status=received` (ON CONFLICT (topic,resource,sent) DO NOTHING).
6. **Responde 200** imediatamente.
7. **`EdgeRuntime.waitUntil(processEvent(...))`:**
   - Resolve token válido do seller (refresh se necessário — mesma lógica dos syncs).
   - `GET https://api.mercadolibre.com{resource}` (para orders, normaliza `orders_v2` → `/orders/{id}`).
   - Normaliza + upsert na tabela do tópico (reuso de `webhook-resource.ts`).
   - `UPDATE ml_webhook_events SET status='processed', processed_at=now()`; em falha
     `status='error', error_msg=...`, `attempts = attempts + 1`.

**Roteamento por tópico (extensível):**

| topic (ML)          | ação de processamento | destino |
|---------------------|-----------------------|---------|
| `questions`         | `GET /questions/{id}` → normaliza → upsert | `ml_questions` (`organization_id,ml_user_id,question_id`) |
| `claims`            | `GET /claims/{id}` → normaliza → upsert | `ml_claims` (`organization_id,ml_user_id,claim_id`) |
| `orders_v2`/`orders`| **cutuca** o `sync-ml-orders` (janela = hoje BRT, aquele seller) — reusa todo o enriquecimento (frete/imposto/custo/marca/shipment) | `orders` (via EF existente) |

**Por que orders "cutuca" em vez de upsert direto:** o `expandOrder` do `sync-ml-orders`
cruza 5 fontes (shipment address, custo, imposto por UF, marca, custo por SKU).
Reimplementar isso no webhook seria muito código e risco de gravar linha incompleta.
Decisão Wesley (2026-07-06): o webhook de pedido dispara o sync existente numa janela
curta (hoje). **Debounce:** se já houve evento de order **processado** para o mesmo
`ml_user_id` nos últimos **60s**, o webhook só marca `processed` sem redisparar (evita
martelar o sync em rajada de pedidos). Quase-tempo-real (~segundos), risco baixo.

Tópico desconhecido → grava `status=received` sem processar (aceita futuro sem quebrar).

---

## Mudança no polling (rede de segurança)

Migration atualiza os crons:

- `sync-ml-questions`: `*/15` → `0 * * * *` (de hora em hora).
- `sync-ml-claims`: `*/30` → `0 */2 * * *` (a cada 2h).
- **Novo cron `reprocess-webhook-events`** (`*/10`): reprocessa eventos
  `status IN ('received','error') AND attempts < 5` presos há mais de ~5 min
  (cobre falha transitória de rede/token no `waitUntil`). Após 5 tentativas o
  evento fica `error` definitivo (visível no painel admin para inspeção manual).

Frequências reduzidas são reversíveis por 1 linha se o webhook falhar em produção.

---

## UI (mínima, sem redesenhar telas)

- **Sinal de saúde:** componente pequeno "Tempo real ativo · último evento há X"
  (deriva de `MAX(received_at)` em `ml_webhook_events` da org). Aparece no cabeçalho
  de `/perguntas` e `/devolucoes` (reuso de `MLPageHeader` ou badge próximo).
  Se nenhum evento há > 24h → estado neutro "aguardando eventos" (não alarme).
- **Painel admin:** em `AdminMonitoring`, tabela dos últimos N eventos
  (topic, status, received_at, org) para auditoria — recebidos / processados / erro / rejeitados.

Nenhuma mudança de layout nas telas de dados.

---

## Dependência externa (ação do Wesley, fora do código)

O webhook só recebe eventos reais após a **URL de callback ser registrada no painel
da aplicação ML** (developers.mercadolivre → sua app → Notificações), com os tópicos
`questions`, `claims`, `orders_v2` marcados.

Entregável do agente: a **URL exata** (`https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<secret>`)
+ passo a passo. Wesley cola no painel. Até lá, a validação é feita por **POST simulado**
com corpos reais de exemplo.

---

## Provas de aceite (testes obrigatórios)

1. **Happy path (por tópico):** POST simulado `questions`/`claims`/`orders_v2` com
   corpo real → evento gravado, 200 < 500ms, upsert correto na tabela do tópico.
2. **Rejeição — seller desconhecido:** `user_id` fora de `ml_tokens` → `status=rejected`,
   sem processar, 200.
3. **Rejeição — secret errado:** path sem secret válido → 200 sem gravar evento.
4. **Idempotência:** mesmo evento (mesmo `sent`) 2x → 1 linha, 1 processamento efetivo.
5. **Anti-IDOR:** evento do seller da org A só grava/upserta dados com `organization_id`
   da org A; RLS impede org B de ler eventos da org A.
6. **Multi-conta:** os 3 tópicos resolvem o token certo por `ml_user_id` (4 sellers).
7. **Retry:** evento forçado a `error` é repescado pelo cron `reprocess-webhook-events`
   e vira `processed`.
8. **Reconciliação:** `tsc` 0, `vitest` verde (lógica pura de roteamento/normalização
   testada), build ok, advisors sem issue novo, deploy via MCP.

---

## Decisões travadas (Wesley, 2026-07-06)

- Decomposição A→B→C→D aceita; entregar **A (webhook)** primeiro.
- Tópicos desta phase: **questions + claims + orders**. EF genérica aceita novos tópicos.
- Gravar evento cru **antes** de responder; processar em `waitUntil`; auditoria em `ml_webhook_events`.
- Validação: **secret no path + user_id ∈ ml_tokens** (ML não assina).
- **Polling não é removido** — só desacelera como rede de segurança.
- Sinal de saúde discreto nas telas + painel em `AdminMonitoring`. Sem redesenho.
- Registro da URL no painel ML é ação manual do Wesley (o agente entrega URL + passo a passo).

## Fora de escopo (viram B/C/D)

- Responder reclamação/mediação pelo dashboard (Phase B).
- Inbox unificado perguntas+reclamações (Phase C).
- IA / sugestão de resposta (Phase D — coordenar com n8n `nexo-ml-qa`).
- Tópicos `messages`, `shipments`, `items` (a EF aceita, mas não processa nesta phase).
- Remoção do polling.
