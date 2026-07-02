# Phase 72: Aba Quality Score + Issues — Research

**Pesquisado:** 2026-06-29
**Domínio:** API ML de saúde de anúncio (Deno Edge Function + React hook on-demand)
**Confiança:** MEDIUM

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Busca ao vivo, on-demand:** a EF é invocada quando o modal abre (lazy, só para o anúncio aberto), com estados loading/erro/vazio. NÃO há sync em lote, tabela nova nem cron.
- **Só no modal:** issues aparecem só na aba Indicadores; nada na tabela de catálogo nesta fase.
- **API ML:** EF chama `GET https://api.mercadolibre.com/item/{id}/performance` com **fallback** `GET https://api.mercadolibre.com/items/{id}/health`. Espelha a `fetch-ml-listing-health` do projeto antigo (referência: `supabase/functions/fetch-ml-listing-health/index.ts` no repo `nexointeligence`, que converte `goals[]` → actions/issues e usa `health`/`level`).
- **Token ML + multi-conta:** resolver token org-scoped seguindo o padrão das EFs existentes do projeto (`supabase/functions/ml-inventory/index.ts`, `ml-token-refresh/index.ts`). Conta vinculada exige `ml_account_id`/seller; conta principal sem. Anti-IDOR: nunca retornar saúde de anúncio fora da org/seller do chamador.
- **Resiliência:** se a API ML falhar/expirar, a EF retorna estado explícito e o modal NÃO quebra; o quality score já existente (de `ProductItem.health`) continua aparecendo.
- **UI:** estender o `ListingIndicatorsTab` (Phase 71) com a seção de issues, reusando/estendendo `ListingQualityScore` ou um subcomponente novo isolado em `src/components/mercadolivre/anuncios/`. Issues em PT-BR, como lista acionável.

### Claude's Discretion
- Nome exato da EF (sugestão: `ml-listing-health`, seguindo o padrão `ml-*` do projeto), forma do payload de retorno, nome do hook (`useMLListingHealth`?), micro-componentes da lista de issues, cópia/tradução exata dos issues.

### Deferred Ideas (OUT OF SCOPE)
- Cache/sync dos issues, badge na tabela de catálogo, e as demais abas — fases futuras.
</user_constraints>

---

## Sumário

A Phase 72 adiciona um fetch on-demand de saúde do anúncio ao modal já entregue na Phase 71. A EF nova (`ml-listing-health`) segue exatamente o padrão já estabelecido em `ml-reputation` e `ml-inventory`: validação JWT via service role, busca de token na tabela `ml_tokens` por `ml_user_id`, guard `is_org_member`, chamada à API ML com Bearer token. O front chama a EF via `supabase.functions.invoke` no mount do `ListingIndicatorsTab` (quando `item` está disponível) usando `useState + useEffect`.

A API ML tem dois endpoints: o atual `/item/{id}/performance` (score 0–100, buckets/variables/rules) e o legado `/items/{id}/health` (health 0–1, goals[]). O projeto-antigo já validou que o `/performance` pode falhar para alguns anúncios — o fallback para `/health` com conversão PT-BR é necessário. A EF normaliza a saída para um shape único (`score` 0–1, `issues[]` em PT-BR) antes de retornar ao front.

O principal landmine é o campo `_ml_user_id?: string` ser opcional em `ProductItem` — a EF deve receber `ml_user_id` obrigatório e o front deve guardar contra `undefined` antes de invocar.

**Recomendação primária:** EF `ml-listing-health` (POST body `{ item_id, ml_user_id }`), hook `useMLListingHealth` co-localizado no `ListingIndicatorsTab`, retorno normalizado com `score` 0–1 + `issues[]`.

---

## Mapa de Responsabilidade Arquitetural

| Capacidade | Tier Primário | Tier Secundário | Rationale |
|------------|---------------|-----------------|-----------|
| Busca de saúde do anúncio | Backend (EF Deno) | — | Token ML não pode vazar para o browser; guard IDOR exige acesso ao DB |
| Resolução de token ML org-scoped | Backend (EF Deno) | — | Idêntico a ml-inventory e ml-reputation |
| Anti-IDOR (verificar que item pertence à org) | Backend (EF Deno) | — | RPC `is_org_member` só acessível server-side com service role |
| Normalização PT-BR dos issues | Backend (EF Deno) | — | Mantém o front puro; mapeamento reutilizável do projeto-antigo |
| Estado de loading/erro/vazio | Browser (React hook) | — | Estado efêmero, co-localizado no componente que o consome |
| Renderização da lista de issues | Browser (React component) | — | Subcomponente isolado dentro de `anuncios/` |
| Score ao vivo (atualização do card existente) | Browser (React) | — | O hook retorna `score` normalizado; `ListingQualityScore` recebe o valor |

---

## API ML de Saúde do Anúncio

### Endpoint 1 — Atual (preferido)

```
GET https://api.mercadolibre.com/item/{ITEM_ID}/performance
Authorization: Bearer {access_token_ml}
```

**Observação de nomenclatura:** o caminho usa `item` (singular), não `items`. O projeto-antigo (`fetch-ml-listing-health/index.ts` linha 257) confirma isso com `fetch(\`https://api.mercadolibre.com/item/${itemId}/performance\`, ...)`.

**Shape de resposta (confirmado via projeto-antigo + docs ML):** [CITED: developers.mercadolibre.com.ar/en_us/listings-quality + global-selling.mercadolibre.com/devsite/listings-quality-gs]

```json
{
  "entity_type": "ITEM",
  "entity_id": "MLB123456789",
  "score": 69,
  "level": "Good",
  "level_wording": "Profesional",
  "calculated_at": "2024-11-01T12:00:00.000Z",
  "buckets": [
    {
      "key": "CHARACTERISTICS",
      "type": "...",
      "status": "PENDING",
      "score": 45,
      "title": "Dados do produto",
      "calculated_at": "...",
      "variables": [
        {
          "key": "GTIN",
          "status": "PENDING",
          "score": 0,
          "calculated_at": "...",
          "title": "Código de produto",
          "rules": [
            {
              "key": "ADD_GTIN",
              "status": "PENDING",
              "progress": 0,
              "progress_max": 1,
              "mode": "OPPORTUNITY",
              "wordings": {
                "title": "Adicione o código GTIN ao seu anúncio",
                "label": "Produtos com GTIN têm melhor exposição"
              }
            }
          ]
        }
      ]
    },
    {
      "key": "OFFER",
      "status": "COMPLETED",
      "...": "..."
    }
  ]
}
```

**Issues acionáveis** = rules onde `mode === "OPPORTUNITY"` (ou equivalentemente `status === "PENDING"` na rule).

**`score` retornado:** inteiro 0–100 (diferente do `ProductItem.health` que é float 0–1). A EF deve normalizar dividindo por 100.

### Endpoint 2 — Legado (fallback)

```
GET https://api.mercadolibre.com/items/{ITEM_ID}/health
Authorization: Bearer {access_token_ml}
```

**Observação de nomenclatura:** usa `items` (plural). Confirmado na linha 289 do projeto-antigo.

**Shape de resposta:** [CITED: developers.mercadolibre.com.ar/en_us/listings-quality]

```json
{
  "item_id": "MLB123456789",
  "health": 0.69,
  "level": "standard",
  "goals": [
    { "id": "price",                  "name": "Preço",          "progress": 0, "progress_max": 1, "apply": true },
    { "id": "free_shipping",          "name": "Frete grátis",   "progress": 1, "progress_max": 1, "apply": true },
    { "id": "technical_specification","name": "Ficha técnica",  "progress": 0, "progress_max": 1, "apply": true },
    { "id": "picture",                "name": "Fotos",          "progress": 1, "progress_max": 1, "apply": true },
    { "id": "video",                  "name": "Vídeo",          "progress": 0, "progress_max": 1, "apply": true },
    { "id": "catalog_product_id",     "name": "Catálogo",       "progress": 0, "progress_max": 1, "apply": true },
    { "id": "title",                  "name": "Título",         "progress": 0, "progress_max": 1, "apply": true },
    { "id": "description",            "name": "Descrição",      "progress": 0, "progress_max": 1, "apply": true },
    { "id": "me2",                    "name": "Mercado Envios", "progress": 1, "progress_max": 1, "apply": false },
    { "id": "financing",              "name": "Parcelamento",   "progress": 0, "progress_max": 1, "apply": true }
  ]
}
```

**Issues acionáveis** = goals onde `apply === true && progress < progress_max`.

**`health` retornado:** float 0–1 — escala já compatível com `ProductItem.health`, sem conversão.

### Quando usar o fallback

A `/performance` retorna não-200 para anúncios que ainda não foram migrados para o novo sistema de qualidade do ML (o projeto-antigo valida essa necessidade nas linhas 256–310). Usar o mesmo padrão: tentar `/performance` primeiro; se não-200, tentar `/health`; se ambos falharem, retornar `{ source: "unavailable" }`. [VERIFIED: codebase — fetch-ml-listing-health/index.ts]

### Rate Limits e Erros Relevantes

| Status | Causa | Ação recomendada |
|--------|-------|-----------------|
| 200 | Sucesso | Processar normalmente |
| 401 | Token expirado | EF retorna 401; front mostra "Dados indisponíveis" |
| 403 | Token sem permissão | EF retorna 403; front mostra "Dados indisponíveis" |
| 404 | Item não encontrado na conta | EF retorna 404; front mostra "Anúncio não encontrado" |
| 429 | Rate limit excedido (>1500 req/min/seller) | [ASSUMED] On-demand por anúncio = risco baixo; apenas um request por abertura de modal |
| 503 | API ML indisponível | EF retorna `source: "unavailable"`; modal não quebra |

**Risco de rate limit:** para uso on-demand (1 request por abertura de modal), o limite de 1500/min representa risco praticamente nulo. [ASSUMED — baseado em 1500 req/min conforme rollout.com/integration-guides/mercado-libre/api-essentials]

---

## Padrão de EF do Projeto Atual

### Como `ml-inventory` e `ml-reputation` resolvem o token (padrão canônico)

[VERIFIED: codebase — supabase/functions/ml-inventory/index.ts + ml-reputation/index.ts]

```
1. Validar JWT via supabaseAdmin.auth.getUser(token)
2. SELECT access_token, organization_id FROM ml_tokens
     WHERE ml_user_id = $ml_user_id
     AND access_token IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1
3. if tokenRow.organization_id → RPC is_org_member(_user_id, _org_id) → 403 se false
4. Chamar ML API com Bearer tokenRow.access_token
```

Diferença entre as EFs: `ml-inventory` aceita `ml_user_id` no body POST; `ml-reputation` aceita como query string GET. Para `ml-listing-health`, usar **POST body** (consistente com `ml-inventory`, mais seguro por não expor item_id em logs de URL).

### Assinatura proposta da EF `ml-listing-health`

**Input (Zod validado):**
```typescript
const BodySchema = z.object({
  item_id:     z.string().min(1, "item_id is required"),
  ml_user_id:  z.string().min(1, "ml_user_id is required"),
});
```

**Output normalizado (sempre retorna este shape ou erro HTTP):**
```typescript
interface HealthResult {
  item_id:       string;
  score:         number;        // 0.0–1.0 (normalizado — compatível com ProductItem.health)
  level:         string;        // "basic" | "standard" | "bronze" | "silver" | "gold" | "professional"
  level_wording: string;        // PT-BR: "Básica" | "Satisfatória" | "Bronze" | "Prata" | "Ouro" | "Profissional"
  issues:        Issue[];       // lista de problemas acionáveis em PT-BR
  source:        "performance_api" | "health_api" | "unavailable";
}

interface Issue {
  id:            string;        // rule key ou goal id (ex: "LOWER_PRICE", "ADD_VIDEO")
  category:      string;        // bucket title PT-BR (ex: "Condições de venda")
  title:         string;        // ação principal PT-BR (ex: "Baixe o preço para recuperar a exposição")
  action_label:  string;        // texto curto do CTA (ex: "Ajuste o preço")
  progress:      number;        // progresso atual
  progress_max:  number;        // alvo
}
```

**Normalização de `score`:**
- De `/performance`: `score_normalized = performanceData.score / 100`
- De `/health`: `score_normalized = healthData.health` (já está em 0–1)

### Anti-IDOR

O guard `is_org_member` na EF garante que o usuário autenticado pertence à organização dona do `ml_user_id` informado. Isso é suficiente porque:
- `ProductItem._ml_user_id` é preenchido a partir de `ml_inventory_cache.ml_user_id`, que é inserido pelo `sync-ml-inventory` (EF autenticada) com o `ml_user_id` da organização;
- Um usuário de outra organização não teria como obter um `ml_user_id` válido para uma org à qual não pertence sem ter acesso ao token daquela org.

Não é necessário verificar se o `item_id` pertence ao `ml_user_id` via ML API (economiza 1 round-trip). A verificação `is_org_member` é suficiente. [ASSUMED — raciocínio análogo ao ml-reputation]

### Estrutura de arquivo

```
supabase/functions/ml-listing-health/
└── index.ts    # EF Deno completa
```

Padrão Deno: `std@0.168.0`, `@supabase/supabase-js@2` via `esm.sh`, `zod@v3.22.4` via `deno.land/x/zod`. [VERIFIED: codebase — CLAUDE.md + ml-inventory/index.ts]

---

## Wiring no Front

### Hook `useMLListingHealth`

**Localização recomendada:** `src/components/mercadolivre/anuncios/useMLListingHealth.ts`

Manter co-localizado com o componente consumidor (dentro de `anuncios/`), seguindo o padrão de hooks feature-specific do projeto (ex: `useMLAds.ts`, `useMLReputation.ts`).

**Padrão:** `useState + useEffect` (não TanStack Query). Justificativa:
- Fetch de vida útil igual à abertura do modal (efêmero, não precisa de cache entre montagens)
- `supabase.functions.invoke` retorna `{ data, error }` — pattern simples, sem necessidade de `queryFn`
- Consistente com outros hooks de EF on-demand do projeto (ex: `useMLReputation.ts` usa `useState + useEffect + fetch` manual — [VERIFIED: codebase])

```typescript
// Exemplo de shape do hook (decisão de implementação para o planner)
function useMLListingHealth(item: ProductItem | null) {
  type Status = 'idle' | 'loading' | 'success' | 'error' | 'unavailable';
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData]     = useState<HealthResult | null>(null);

  useEffect(() => {
    if (!item?.id || !item._ml_user_id) {
      setStatus('idle');
      setData(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    supabase.functions
      .invoke('ml-listing-health', {
        body: { item_id: item.id, ml_user_id: item._ml_user_id },
      })
      .then(({ data: d, error: e }) => {
        if (cancelled) return;
        if (e) { setStatus('error'); return; }
        if (d?.source === 'unavailable') { setStatus('unavailable'); return; }
        setData(d as HealthResult);
        setStatus('success');
      });
    return () => { cancelled = true; };   // cleanup: evita setState em modal desmontado
  }, [item?.id, item?._ml_user_id]);

  return { status, data };
}
```

**Onde invocar:** no `ListingIndicatorsTab` (já recebe `item` como prop). Alternativa: no `ListingDetailModal` (passando resultado como prop adicional ao tab). A opção mais simples é invocar dentro do `ListingIndicatorsTab` — o componente já controla toda a lógica visual da aba.

**Estados a renderizar:**

| Status | UI |
|--------|-----|
| `idle` | Nada (não mostrar seção) |
| `loading` | Skeleton/spinner dentro da seção de issues |
| `success` + issues.length > 0 | Lista de issues acionáveis |
| `success` + issues.length === 0 | Card "Nenhum problema encontrado" (anúncio saudável) |
| `unavailable` | Inline: "Dados de saúde indisponíveis no momento" |
| `error` | Inline: "Não foi possível carregar os problemas" |

**Onde plugar sem regredir:** o `ListingIndicatorsTab` tem `rightCol` com `ListingQualityScore` + KPIs + Informações. A seção de issues entra após `ListingQualityScore` (mesma coluna direita, `md:col-span-3`), separada por um novo `Card`. O `ListingQualityScore` existente continua recebendo `item.health` (dado do cache) — nunca quebra por causa do fetch ao vivo.

**Atualização do score ao vivo (opcional — decisão aberta):** se o fetch retorna `source !== "unavailable"`, o `score` normalizado pode substituir `item.health` no `ListingQualityScore`. Porém isso adiciona um `useState` para `liveHealth` e pode confundir o usuário se o score ao vivo diferir muito do score da tabela. **Recomendação:** na Phase 72, não atualizar o score — mostrar apenas os issues. O score ao vivo pode ser adicionado na Phase 73+ se Wesley pedir. Isso mantém o escopo simples.

---

## Mapeamento Goal IDs → PT-BR (para o fallback `/health`)

Copiado do projeto-antigo `fetch-ml-listing-health/index.ts` (linhas 18–108), já validado em produção. A EF nova deve incorporar este mapeamento. [VERIFIED: codebase — fetch-ml-listing-health/index.ts]

| Goal ID | Categoria | Título da ação | Label do CTA |
|---------|-----------|----------------|--------------|
| `price` | Condições de venda | Baixe o preço para recuperar a exposição do seu anúncio | Ajuste o preço para melhorar sua competitividade |
| `financing` | Condições de venda | Ofereça parcelamento sem juros para que seu anúncio seja mais competitivo | Configure parcelamento sem juros |
| `free_shipping` | Condições de venda | Ofereça frete grátis para aumentar suas vendas | Ative frete grátis no seu anúncio |
| `me2` | Condições de venda | Use Mercado Envios 2 para melhorar a experiência de entrega | Ative Mercado Envios 2 |
| `technical_specification` | Dados do produto | Complete a ficha técnica do seu produto | Preencha os atributos faltantes |
| `picture` | Dados do produto | Adicione mais fotos ao seu anúncio | Inclua imagens adicionais de qualidade |
| `video` | Dados do produto | Adicione um vídeo ao seu anúncio | Vídeos aumentam as conversões |
| `catalog_product_id` | Dados do produto | Vincule seu anúncio ao catálogo do Mercado Livre | Associe ao produto do catálogo |
| `title` | Dados do produto | Melhore o título do seu anúncio | Use palavras-chave relevantes |
| `description` | Dados do produto | Melhore a descrição do seu anúncio | Adicione mais detalhes sobre o produto |

**Mapeamento de `level` → `level_wording` PT-BR:**

| level (raw) | level_wording |
|-------------|---------------|
| `professional` | Profissional |
| `gold` | Ouro |
| `silver` | Prata |
| `bronze` | Bronze |
| `standard` | Satisfatória |
| `basic` | Básica |

Para issues do `/performance`, os `wordings.title` e `wordings.label` já chegam em espanhol da API ML. A EF pode:
- Usar os `wordings` da API diretamente (podem estar em ES), ou
- Aplicar o mapeamento estático similar ao do projeto-antigo para as issues conhecidas

**Recomendação (Claude's discretion):** para `/performance`, usar os `wordings` da API mas com fallback ao mapeamento estático quando a chave `rule.key` for conhecida. Garante PT-BR para os casos mapeados e não quebra para novas rules que a API venha a adicionar.

---

## Não Construir do Zero

| Problema | Não construir | Usar em vez | Por quê |
|----------|---------------|-------------|---------|
| Resolução de token ML | Lógica própria de token/OAuth | Padrão `ml_tokens` + `is_org_member` de `ml-inventory` | Já testado em prod com multi-conta; evitar duplicação |
| Mapeamento goals → PT-BR | Nova tabela/configuração | Constante `GOAL_TO_PERFORMANCE_MAP` do projeto-antigo | Validado em prod, cobrindo os 10 goal IDs conhecidos |
| Conversão `/health` → shape unificado | Nova lógica de conversão | `convertHealthToPerformance()` do projeto-antigo (adaptar) | Lógica validada; reduz chance de bug no mapeamento de campos |
| Estados loading/error na UI | Componente customizado | `Skeleton` do shadcn/ui para loading; texto inline para error | Padrão do projeto (sem nova dependência) |
| Spinner de loading | `react-spinners` ou similar | `Skeleton` do `@/components/ui/skeleton` | Já no projeto; zero deps extras |

---

## Riscos e Landmines

### Landmine 1: `_ml_user_id` é opcional em `ProductItem`

**O que dá errado:** `ProductItem._ml_user_id` é tipado como `string | undefined` (linha 38 de `MLInventoryContext.tsx`). Se `undefined`, a EF recebe body inválido → Zod rejeita com 400 → o hook entra em `error`.

**Por que acontece:** itens carregados antes do campo `ml_user_id` existir no schema, ou items cujo `rowToItem` recebe `row.ml_user_id = undefined`.

**Como evitar:** no hook, checar `item?.id && item?._ml_user_id` antes de invocar. Se `_ml_user_id` for undefined, setar `status = 'idle'` e não mostrar a seção (silencioso, sem erro visível).

### Landmine 2: Escala de score incompatível

**O que dá errado:** `/performance` retorna `score: 69` (inteiro 0–100). `ProductItem.health` e `ListingQualityScore` esperam `health: number` em escala 0–1 (ex: `0.69`). Se a EF retornar `score` sem normalizar, o `qualityScoreBand(0.69) → "Boa"` mas `qualityScoreBand(69) → "Boa"` (porque 69 > 0.8 em float — errado!).

**Como evitar:** a EF normaliza `score` para 0–1 antes de retornar (`score_normalized = rawScore / 100`). O campo do retorno se chama `score` (0–1), compatível com `ProductItem.health`.

### Landmine 3: Modal fechado antes do fetch completar

**O que dá errado:** o hook resolve o Promise depois que o componente desmontou → `setState` em componente desmontado → warning no React 18 (ou memory leak em React < 18).

**Como evitar:** padrão `let cancelled = true` no cleanup do `useEffect` (mostrado no exemplo do hook acima). Já é o padrão do projeto em outros hooks de fetch.

### Landmine 4: Endpoint `/performance` com URL singular "item" (não "items")

**O que dá errado:** escrever `https://api.mercadolibre.com/items/{id}/performance` (plural) retorna 404 imediatamente, fazendo a EF ir direto para o fallback sem tentar o endpoint correto.

**Como evitar:** confirmar na implementação que o path é `/item/{id}/performance` (singular). [VERIFIED: codebase — fetch-ml-listing-health/index.ts linha 258]

### Landmine 5: A EF `ml-listing-health` não deve chamar `ml-token-refresh`

**O que dá errado:** a EF não deve tentar fazer refresh de token inline (geraria latência + ciclo de dependência). O refresh é responsabilidade do cron `ml-token-refresh`.

**Como evitar:** se o token estiver expirado, a chamada à ML API retornará 401. A EF simplesmente retorna `{ error: "ML token expired" }` com status 401. O front mostra "Dados indisponíveis". O cron cuida do refresh na próxima janela.

### Landmine 6: Issues em `/performance` chegam em espanhol da API

**O que dá errado:** `wordings.title` da API `/performance` pode estar em espanhol (a API ML serve conteúdo baseado em locale do app, não do seller). Sem mapeamento estático, o usuário veria issues em ES.

**Como evitar:** aplicar o mapeamento estático (igual ao do projeto-antigo) para as rule keys conhecidas. Para rule keys desconhecidas, usar o `wordings.title` da API (é melhor que não mostrar nada). Documentar como decisão de Claude's discretion.

---

## Exemplo de Código — Padrão de EF do Projeto

### Estrutura base (espelha `ml-reputation/index.ts`)

```typescript
// supabase/functions/ml-listing-health/index.ts
// Source: codebase — supabase/functions/ml-reputation/index.ts (padrão canônico)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, ...",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 1. Validar JWT
  const authHeader = req.headers.get("Authorization");
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: authData } = await supabaseAdmin.auth.getUser(
    authHeader!.replace("Bearer ", "")
  );
  if (!authData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

  // 2. Validar body
  const BodySchema = z.object({
    item_id:    z.string().min(1),
    ml_user_id: z.string().min(1),
  });
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return jsonResponse({ error: "Invalid input" }, 400);

  // 3. Buscar token + is_org_member (padrão ml-inventory linha 88-115)
  const { data: tokenRow } = await supabaseAdmin
    .from("ml_tokens")
    .select("access_token, organization_id")
    .eq("ml_user_id", parsed.data.ml_user_id)
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow?.access_token) return jsonResponse({ error: "No ML token" }, 404);

  if (tokenRow.organization_id) {
    const { data: isMember } = await supabaseAdmin.rpc("is_org_member", {
      _user_id: authData.user.id, _org_id: tokenRow.organization_id,
    });
    if (!isMember) return jsonResponse({ error: "Forbidden" }, 403);
  }

  // 4. Tentar /performance → fallback /health
  // ... (lógica de fetch + normalização)
});
```

### Invocação no front (padrão `supabase.functions.invoke`)

```typescript
// Source: codebase — src/hooks/useConsultorInsights.ts + MLInventoryContext.tsx
const { data, error } = await supabase.functions.invoke("ml-listing-health", {
  body: { item_id: item.id, ml_user_id: item._ml_user_id },
});
```

---

## Auditoria de Pacotes (Package Legitimacy Audit)

Esta fase não instala nenhum novo pacote npm. Todas as dependências são as já existentes no projeto:

- Front: `@supabase/supabase-js@2` (já instalado), componentes shadcn/ui (já instalados)
- EF: `deno.land/std@0.168.0`, `esm.sh/@supabase/supabase-js@2`, `deno.land/x/zod@v3.22.4` (todos já usados pelas EFs existentes)

**Nenhum pacote novo a auditar.**

---

## Estado da Arte

| Abordagem antiga | Abordagem atual | Quando mudou | Impacto |
|------------------|-----------------|--------------|---------|
| `/items/{id}/health` com `goals[]` | `/item/{id}/performance` com `buckets[]`/`variables[]`/`rules[]` | ~2023–2024 (ML migração) | O novo endpoint agrega tudo; mais detalhado; porém tem menos cobertura de anúncios (ainda em rollout) |
| Score como float 0–1 (`health`) | Score como int 0–100 (`score`) | Com migração `/performance` | Normalização necessária na EF para manter compatibilidade com `ProductItem.health` |
| Token com criptografia AES-GCM (projeto nexointeligence) | Token plain text em `ml_tokens` (projeto garment-glow-test) | Diferença de projetos | **NÃO copiar** a lógica de decrypt do projeto-antigo — não se aplica aqui |

**Deprecated/desatualizado:**
- Lógica de `ENCRYPTION_KEY` + decrypt AES-GCM do projeto-antigo (`fetch-ml-listing-health/index.ts` linhas 238–253): **não se aplica** ao projeto garment-glow-test, onde `ml_tokens.access_token` é plain text (confirmado em `ml-inventory` e `ml-reputation`, que lêem o campo diretamente sem decrypt).

---

## Questões Abertas

1. **Atualizar o score card com valor ao vivo?**
   - O que sabemos: a EF retorna `score` normalizado 0–1; o `ListingQualityScore` aceita `health: number | null`
   - O que está em aberto: substituir `item.health` pelo `data.score` ao vivo cria UX mais rica mas pode confundir (score do cache vs. score ao vivo podem diferir se o anúncio foi editado)
   - Recomendação: **não substituir na Phase 72** — mostrar apenas os issues; adicionar score ao vivo em fase futura se Wesley pedir

2. **Mapeamento PT-BR para `/performance` rules novas (não mapeadas)**
   - O que sabemos: o projeto-antigo mapeia 10 goal IDs do `/health`; o `/performance` pode ter rules adicionais (ex: `ADD_GTIN`, etc.)
   - O que está em aberto: usar `wordings.title` da API (em ES) para rules não mapeadas, ou omitir?
   - Recomendação: usar `wordings.title` da API como fallback (melhor mostrar em ES do que ocultar uma issue real)

3. **Onde chamar o hook: `ListingIndicatorsTab` ou `ListingDetailModal`?**
   - `ListingIndicatorsTab`: mais simples, hook co-localizado com consumidor
   - `ListingDetailModal`: fetch começa no momento em que o modal abre (antes da aba ser renderizada), potencialmente reduzindo latência percebida
   - Recomendação: chamar no `ListingIndicatorsTab` (Phase 72 é simples; otimização de pré-fetch pode ser Phase 73+)

---

## Constraints do Projeto (de CLAUDE.md)

| Diretiva | Impacto nesta fase |
|----------|--------------------|
| EF Deno usa `std@0.168.0`, `@supabase/supabase-js@2` via `esm.sh`, `zod@v3.22.4` | Import paths fixos na EF nova |
| Supabase project ID real = `ckcdevcxgvueywivefgx` (não o do CLAUDE.md `gionpsuunfkkzzjdubfy`) | Deploy via MCP `deploy_edge_function` com projeto correto |
| Deploy de EF via MCP `deploy_edge_function` (não Supabase CLI push) | O planner deve incluir task de deploy via MCP |
| React 18 SPA + TypeScript — sem novas deps de fetch | Usar `supabase.functions.invoke` + `useState`/`useEffect` |
| Nenhuma nova dependência npm para cálculo/validação simples | Sem novos pacotes |
| `SUPABASE_SERVICE_ROLE_KEY` = vault Pattern B (`sb_secret_*`) | EF usa `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` — já disponível via Supabase vault |

---

## Log de Hipóteses

| # | Hipótese | Seção | Risco se errada |
|---|----------|-------|-----------------|
| A1 | `ml_tokens.access_token` é plain text neste projeto (sem criptografia AES-GCM) | EF nova | Se for criptografado, a EF precisaria de lógica de decrypt igual ao projeto-antigo |
| A2 | `is_org_member` RPC existe e aceita `(_user_id, _org_id)` | Anti-IDOR | Erro de compilação/runtime na EF se a assinatura for diferente |
| A3 | O endpoint `/performance` pode retornar `wordings.title` em espanhol para contas BR | Issues PT-BR | Issues exibidas em ES para rules não mapeadas; degradação de UX (não breaking) |
| A4 | Rate limit de 1500 req/min é compartilhado entre todas as EFs do projeto para o mesmo seller | Rate limits | Se compartilhado, abrir muitos modais rapidamente pode impactar outros syncs |

---

## Disponibilidade de Ambiente

Fase é puro código + EF Deno + deploy via MCP. Nenhuma dependência de infra nova.

| Dependência | Requerida por | Disponível | Versão | Fallback |
|------------|---------------|------------|--------|----------|
| Supabase MCP `deploy_edge_function` | Deploy da EF | Confirmado em uso nas phases anteriores | — | — |
| ML API `/item/{id}/performance` | Issues live | Disponível (on-demand, sem cron) | — | `/items/{id}/health` |
| `ml_tokens` table | Token ML | Existe em prod | — | 404 se não conectado |
| `is_org_member` RPC | Anti-IDOR | Existe em prod (usado por ml-inventory, ml-reputation) | — | — |

---

## Fontes

### Primárias (verificado no codebase)
- `supabase/functions/fetch-ml-listing-health/index.ts` (nexointeligence, projeto-antigo) — endpoints, mapeamento de goals, lógica de fallback [VERIFIED: codebase]
- `supabase/functions/ml-inventory/index.ts` — padrão de token resolution + is_org_member [VERIFIED: codebase]
- `supabase/functions/ml-reputation/index.ts` — padrão on-demand fetch com GET query string [VERIFIED: codebase]
- `src/components/mercadolivre/anuncios/ListingIndicatorsTab.tsx` — ponto de integração [VERIFIED: codebase]
- `src/components/mercadolivre/anuncios/ListingQualityScore.tsx` — componente a estender [VERIFIED: codebase]
- `src/contexts/MLInventoryContext.tsx` — tipo `ProductItem` com `_ml_user_id?: string` [VERIFIED: codebase]

### Secundárias (documentação ML via search)
- [Listings quality — global-selling.mercadolibre.com](https://global-selling.mercadolibre.com/devsite/listings-quality-gs) — shape do `/performance` [CITED]
- [Listings quality — developers.mercadolibre.com.ar](https://developers.mercadolibre.com.ar/en_us/listings-quality) — shape do `/health` goals [CITED]
- [Mercado Libre API Essential Guide — rollout.com](https://rollout.com/integration-guides/mercado-libre/api-essentials) — rate limits 1500/min [CITED]

---

## Metadados

**Breakdown de confiança:**
- Padrão de EF (token, IDOR, Deno): HIGH — verificado no codebase em múltiplas EFs existentes
- API ML endpoints e shapes: MEDIUM — docs ML confirmados via search + projeto-antigo validado em prod
- Rate limits ML: LOW — única fonte terceira (rollout.com), não confirmado em docs oficiais
- Mapeamento goals→PT-BR: HIGH — código do projeto-antigo validado em produção

**Data da research:** 2026-06-29
**Válido até:** 2026-07-29 (API ML de saúde é estável; shape do `/performance` é o atual)
