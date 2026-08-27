// ============================================================================
// 233-01 — o `this` perdido em `supabase.rpc`
//
// 🔴 A raiz do defeito que o Wesley viu na tela de fluxo de caixa em 27/08/2026:
//
//   Não foi possível carregar o histórico de erro da previsão.
//   Cannot read properties of undefined (reading 'rest')
//
// `@supabase/supabase-js@2.98` implementa:
//
//   rpc(fn, args = {}, options = {...}) { return this.rest.rpc(fn, args, options); }
//
// Os hooks atribuíam o método `rpc` do client a uma variável local, o que
// ⚠️ A linha acima NÃO escreve o padrão proibido literalmente, de propósito: o
// portão do fim deste arquivo e o grep de verificação varrem por FORMA, e prosa
// que reproduz o padrão faz o portão reprovar o comentário que o explica
// (mesma lição do 231-04: prosa cede ao portão).
// DESACOPLA o método do objeto. Em módulo ESM (strict mode) o `this` de uma
// função desacoplada é `undefined` — e `this.rest` estoura exatamente a
// mensagem acima.
//
// ⚠️ Consertar as duas linhas de hoje NÃO é a entrega. O `package.json` fixa
// `^2.98.0` e o caret permite minor automático; o padrão volta em qualquer hook
// novo que desacople um método do client. Por isso existe o portão do fim deste
// arquivo, que varre `src/hooks/` pela FORMA e não pelas duas linhas atuais.
// ============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR_HOOKS = join(__dirname, "..");

/** Um objeto com a MESMA forma do client: método que depende de `this`. */
function clientDeMentira() {
  return {
    rest: { rpc: (fn: string) => ({ fn, ok: true }) },
    rpc(fn: string) {
      // @ts-expect-error — reproduzindo a implementação real do supabase-js
      return this.rest.rpc(fn);
    },
  };
}

describe("o `this` perdido em supabase.rpc", () => {
  it("reproduz o defeito: método desacoplado do objeto estoura em `rest`", () => {
    const client = clientDeMentira();
    const chamar = client.rpc; // ← exatamente o que os hooks faziam

    expect(() => chamar("get_forecast_backtest_curve")).toThrowError(
      /reading 'rest'|of undefined/,
    );
  });

  it("prova a correção: com `.bind(client)` a chamada funciona", () => {
    const client = clientDeMentira();
    const chamar = client.rpc.bind(client);

    expect(chamar("get_forecast_backtest_curve")).toEqual({
      fn: "get_forecast_backtest_curve",
      ok: true,
    });
  });

  it("o objeto intacto nunca teve o problema — o defeito é o desacoplamento", () => {
    const client = clientDeMentira();
    expect(client.rpc("x")).toEqual({ fn: "x", ok: true });
  });
});

describe("🔴 PORTÃO — nenhum hook pode desacoplar supabase.rpc do client", () => {
  /**
   * Pega a FORMA, não as duas linhas de hoje: qualquer atribuição de
   * `supabase.rpc` a uma variável sem `.bind` reprova. Um portão que só
   * conhecesse os dois arquivos atuais não protegeria o terceiro.
   */
  it("varre src/hooks/ e reprova `supabase.rpc` atribuído sem bind", () => {
    const arquivos = readdirSync(DIR_HOOKS).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    const ofensores: string[] = [];

    for (const nome of arquivos) {
      const fonte = readFileSync(join(DIR_HOOKS, nome), "utf-8");
      for (const linha of fonte.split("\n")) {
        // `= supabase.rpc` (com ou sem cast) e SEM `.bind` na mesma linha
        if (/=\s*supabase\.rpc\b/.test(linha) && !linha.includes(".bind")) {
          ofensores.push(`${nome}: ${linha.trim()}`);
        }
      }
    }

    expect(ofensores,
      "supabase.rpc depende de `this` (`return this.rest.rpc(...)`). Atribuí-lo a uma " +
      "variável sem `.bind(supabase)` faz `this` virar undefined em ESM strict e estoura " +
      "`Cannot read properties of undefined (reading 'rest')` em produção.",
    ).toEqual([]);
  });
});
