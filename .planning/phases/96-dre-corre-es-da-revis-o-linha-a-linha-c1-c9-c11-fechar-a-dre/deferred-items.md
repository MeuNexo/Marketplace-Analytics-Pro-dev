# Phase 96 — Deferred Items

Achados fora do escopo, encontrados durante a execução. **Não corrigidos** — registrados
para decisão futura.

---

## [96-07] `deno check` de `sync-ml-orders` falha — PRÉ-EXISTENTE

**Encontrado durante:** Task 1 do 96-07 (Trava C), ao rodar o `deno check` de verificação.

**Erro:**
```
TS2345 [ERROR]: Argument of type 'string | null' is not assignable to parameter of type 'string'.
  Type 'null' is not assignable to type 'string'.
    at supabase/functions/sync-ml-orders/index.ts:574:53
```

É o argumento `userId` (tipado `string | null` no escopo do handler) sendo passado para o
parâmetro `userId: string` de `expandOrder`.

**Por que NÃO foi corrigido:** é pré-existente e não tem relação com este plano. Provado:

```bash
git stash && deno check supabase/functions/sync-ml-orders/index.ts   # 1 erro, linha 555:53
git stash pop && deno check supabase/functions/sync-ml-orders/index.ts # 1 erro, linha 574:53
```

Mesmo erro, mesma causa, mesma chamada — só deslocado de :555 para :574 pelas linhas que o
96-07 adicionou. Diff dos erros normalizados (sem número de linha): **idêntico, zero erros
novos introduzidos**. A EF roda em prod com esse erro há tempo (o bundle do Supabase Edge
não bloqueia por erro de tipo).

**Impacto:** nenhum em runtime — `userId` null é um caso real e tratado (service role / cron,
onde `costOr` já ramifica em `userId ? ... : ...`). É só o tipo do parâmetro que está
estrito demais.

**Fix quando alguém pegar:** trocar a assinatura de `expandOrder` para `userId: string | null`
(é o que o corpo já assume) e conferir se `user_id` no record aceita null — `batch_upsert_orders`
faz `NULLIF(r->>'user_id', '')::uuid`, então aceita.

**Consequência para o 96-07:** o `<verify>` do plano pede "`deno check` limpo". Para
`sync-ml-orders` isso **nunca foi verdade** — o critério aplicável é "zero erros novos",
que foi provado por diff normalizado. `recalc-order-costs` e `sync-tiny-costs` estão
limpas de verdade.
