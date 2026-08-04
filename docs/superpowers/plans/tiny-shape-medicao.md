# Medição da forma dos SKUs e depósitos no Tiny

**Data:** 2026-08-04 ~21:45 UTC
**Task:** 1 do plano `2026-08-04-reposicao-fonte-unica.md` (risco declarado da spec §8)
**Método:** API Tiny v3 ao vivo, via `net.http_get` no Supabase `ckcdevcxgvueywivefgx`,
com o token de `ml_tokens.tiny_access_token` do `ml_user_id = 1639558873` (Pé Vermeio).
Token nunca ecoado.

---

## Conclusões exigidas pela Task 1

### 1. `NIVEL_DO_SKU` = **variação** ❌ (o plano NÃO segue como está)

O SKU da operação vive no registro de **variação** (`tipoVariacao = "V"`), não no pai.

Evidência direta, primeira página de `/produtos?situacao=A&limit=100&offset=0`:

| id | sku | tipo | tipoVariacao |
|---|---|---|---|
| 791619098 | `11011273` | V | **P** (pai — SKU base, sem tamanho/cor) |
| 791634264 | `11011273-PTO3360P` | S | **V** |
| 791634268 | `11011273-PTO3360M` | S | **V** |
| 791634272 | `11011273-PTO3360G` | S | **V** |

O filtro `tipoVariacao === "P"` do sync de referência do nexo-mcp **descartaria exatamente o
nível que a reposição precisa**.

**Proporção medida** (duas amostras de 100, catálogo com `paginacao.total = 771` ativos):

| Amostra | pais (P) | variações (V) |
|---|---|---|
| offset 0 | 16 | 84 |
| offset 400 | 16 | 82 |

→ **~84% do catálogo é variação.**

**Atenuante importante:** as variações vêm como **itens de topo** da listagem `/produtos`,
não aninhadas dentro do pai. A varredura **não precisa descer** nas variações — basta
**não filtrar** por `tipoVariacao`. O impacto é de volume, não de estrutura.

**Terceiro valor de `tipoVariacao`:** existe `"N"` além de `P` e `V`
(id 828560917, SKU `K6CBS2345SORG3`). O filtro tem que ser por exclusão explícita do pai,
não por igualdade a um valor esperado.

### 2. `DEPOSITO_CD` — o nome existe, mas **D-5 aponta para o depósito errado** ❌

Os quatro depósitos, nomes exatos (de `/estoque/{id}`, campo `depositos[].nome`):

| id | nome (string exata) | desconsiderar |
|---|---|---|
| 829490646 | `CD Expedição` | false |
| 790617378 | `Centro de distribuição` | false |
| 824998628 | `Magazine Luiza Fullfilment` | **true** |
| 795686359 | `Mercado Livre Fullfilment` | false |

**D-5 diz "só o depósito CD Expedição". A medição mostra que isso perde estoque real.**

Amostra de 6 SKUs entre os campeões de giro de 90 dias:

| SKU | saldo total | CD Expedição | Centro de distribuição | ML Full |
|---|---|---|---|---|
| `K6CBS2345SORG3` | 337 | **242** | 0 | 95 |
| `K3CR1303PMSSORGG` | 25 | **25** | 0 | 0 |
| `12011666PTO3360M` | 33 | 0 | **32** | 1 |
| `18012849BRA3315M` | 16 | 0 | 0 | 16 |
| `18012849BRA3315G` | 10 | 0 | 0 | 10 |
| `K9PMCMS7000SOR3943` | 0 | 0 | 0 | 0 |

Estoque próprio da amostra (fora do Full): **267 em CD Expedição, 32 em Centro de
distribuição** — ou seja, **~11% do estoque próprio vive no depósito que D-5 excluiria**,
e ele está no `12011666PTO3360M`, **3º maior giro de 90 dias (126 unidades)**.

Implementar D-5 literalmente faria o sistema ver estoque 0 nesse SKU e **mandar comprar 32
unidades que já estão no armazém.**

---

## Achados adicionais (não previstos pela spec)

### 3. A estrutura do JSON de estoque difere do que o plano assumiu

O plano (Task 1, Step 3 e Task 3) fala em `estoque.depositos[]` e `estoque.saldo` de topo.
A resposta real de `/estoque/{id}` traz **`depositos[]` e `saldo` na raiz**, sem envelope
`estoque`:

```json
{"id":791634272,"nome":"...","codigo":"11011273-PTO3360G","unidade":"Un",
 "saldo":0,"reservado":0,"disponivel":0,"localizacao":"P882A/B",
 "depositos":[{"id":829490646,"nome":"CD Expedição","desconsiderar":false,
               "saldo":0,"reservado":0,"disponivel":0,"empresa":"wesleypevermeio"}, ...]}
```

O campo que carrega o SKU em `/estoque/{id}` chama-se **`codigo`**, não `sku`
(em `/produtos` chama-se `sku`).

### 4. SKU duplicado no Tiny — quebra chave única

`K6CBS2345SORG3` retorna **dois registros** com ids diferentes:

| tiny_id | tipoVariacao | saldo total | CD Expedição | ML Full |
|---|---|---|---|---|
| 821961382 | V | 337 | 242 | 95 |
| 828560917 | N | -1 | 0 | -1 |

Um upsert com chave única em `sku` gravaria um ou outro conforme a ordem da varredura —
podendo persistir **-1** no lugar de 337. A Task 2 precisa de chave em `tiny_id` e de uma
regra explícita de desempate por SKU.

### 5. Saldos negativos existem

`disponivel = -1` (CD Expedição) e `-20` (ML Full) no `12011666PTO3360M`; `saldo = -1` no
registro duplicado acima. A extração precisa decidir entre `saldo` e `disponivel` e tratar
negativo (provavelmente `greatest(x, 0)` para efeito de compra) — a spec não diz qual usar.

### 6. Rate limit confirmado na prática

12 requisições disparadas sem espaçamento → **7 responderam HTTP 429**. Confirma que
`RATE_MS = 1100` serializado é obrigatório e que não dá para paralelizar. Com 771 produtos
ativos a 1,1 s por chamada de detalhe, **uma volta completa leva ~14 minutos** — viável, e
melhor do que a spec temia.

### 7. `/estoque/{id}` funciona no id da variação ✅

Testado em 791634272 e 807451772: retorna o `codigo` da variação e seus depósitos.
Não é preciso passar pelo pai. Boa notícia para o desenho.

### 8. O SKU do Tiny casa exatamente com o do ML ✅

`12011666PTO3360M` (campeão de giro, tabela `orders`) foi encontrado no Tiny com o mesmo
string exato. Os formatos variam entre produtos (`11011273-PTO3360P` com hífen,
`12011666PTO3360M` sem), mas o valor é idêntico dos dois lados — **o join por SKU funciona,
sem normalização.**

### 9. `/produtos?codigo=<sku>` faz busca exata ✅

Retorna `paginacao.total = 1` para o SKU exato. Útil para a Task 8 (provas pontuais) sem
varrer o catálogo.

---

## Veredito (Step 5)

**`NIVEL_DO_SKU = variacao` → PARAR E REPORTAR.** Conforme instrução do próprio plano, não
improvisar: o desenho volta para revisão antes de qualquer código.

**Tasks impactadas:**

| Task | Impacto |
|---|---|
| 2 (tabelas) | Chave por `tiny_id`, não por `sku` (achado 4). Coluna `tipo_variacao`. |
| 3 (depósitos) | Ler `depositos[]` da raiz, não de `estoque.depositos[]` (achado 3). Campo `codigo`. Tratar negativo (achado 5). Somar **dois** depósitos, não um. |
| 5 (EF) | Não filtrar `tipoVariacao='P'`. Volume 771 e não ~130 → ~14 min/volta (achado 6). |
| 7 (RPC v2) | **D-5 precisa mudar**: `CD Expedição` + `Centro de distribuição`, não só o primeiro. |

**Decisões que dependem do Wesley:**

1. **D-5 revisada** — somar `CD Expedição` **e** `Centro de distribuição`? (A medição diz que
   sim: senão o 3º maior giro aparece zerado.) `Magazine Luiza Fullfilment` fica de fora por
   `desconsiderar: true`; `Mercado Livre Fullfilment` fica de fora por D-2 (Full vem do ML).
2. **`saldo` ou `disponivel`?** — `disponivel` desconta reservado; num SKU deu `-1` contra
   `saldo` 0. Para decidir compra, o mais conservador é `disponivel`, piso em 0.
3. **SKU duplicado** — qual registro vence? Proposta: o de maior `saldo`, ou o `tipoVariacao`
   ≠ `N`. Precisa de regra explícita.
