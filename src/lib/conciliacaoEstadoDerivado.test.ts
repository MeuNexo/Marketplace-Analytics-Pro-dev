/**
 * conciliacaoEstadoDerivado.test.ts — auditoria estática da correção da cascata
 * de `estado` em `conciliacao_base_linhas` (Fase 225, plano 225-05, tarefa extra).
 *
 * 🔴 O QUE ESTÁ SENDO CONSERTADO, e por que importa mais que um bug de SQL:
 *
 * D-225-13 existe para responder "quanto o ML devolveu de fato, e que tipo de
 * caso ele aceita". A resposta depende de distinguir DUAS vitórias diferentes:
 *   · "contestei e o ML me pagou"  → `ganho`, com valor recuperado;
 *   · "o dinheiro só chegou atrasado" → `resolvido_sozinho`, sem mérito nosso.
 * Somar as duas como se fossem a mesma coisa inventa uma taxa de sucesso de
 * contestação que não existe. O front já preserva essa distinção (a mutação de
 * desfecho recusa o `upsert` que apagaria `contestado_em`), mas ela morre na
 * ORIGEM do dado se a RPC nunca emitir `resolvido_sozinho`.
 *
 * 🔴 TRÊS DEFEITOS COMPOSTOS foram medidos na cascata aplicada
 * (`20260903140000_conciliacao_acl_e_totais.sql`, linhas 287-292):
 *
 *   case
 *     when k.estado is null                                    then 'aberto'      -- (1)
 *     when k.estado = 'aberto' and l.tem_aprovado
 *          and l.tipo_calc = 'repasse_ausente'                 then 'resolvido_sozinho'  -- (2)
 *     when k.estado = 'aberto' and l.dias_restantes < 0        then 'expirado'
 *     else k.estado
 *   end
 *
 * (1) CURTO-CIRCUITO: caso sem linha persistida cai no primeiro ramo e nunca
 *     chega às derivações. `conciliacao_casos` tem ZERO linha hoje, então isso
 *     vale para TODOS os casos da janela.
 *
 * (2) CONTRADIÇÃO POR CONSTRUÇÃO: `tipo_calc = 'repasse_ausente'` é definido
 *     como `not tem_repasse`, e `tem_repasse` é `(r.ml_order_id is not null)`
 *     do agregado de `cash_inflows`. Sem linha em `cash_inflows`,
 *     `tem_aprovado = coalesce(r.tem_aprovado, false)` é obrigatoriamente
 *     FALSO. `tem_aprovado AND tipo_calc='repasse_ausente'` é uma conjunção que
 *     não pode ser verdadeira — nem com o curto-circuito (1) removido.
 *
 * (3) O JOIN PERDE O CASO NO ÚNICO MOMENTO QUE INTERESSA: `k` casa por
 *     `k.tipo_caso = l.tipo_calc`. Quando o repasse chega, `tipo_calc` vira
 *     `repasse_a_menor` e o caso persistido como `repasse_ausente` deixa de
 *     casar. `k.estado` volta NULO exatamente quando o dinheiro apareceu.
 *
 * ⚠️ POR QUE LER O `.sql` DO DISCO: aplicar migration é portão do orquestrador
 * nesta fase — o executor não alcança `ckcdevcxgvueywivefgx`. Esta auditoria
 * prova a FORMA. A prova de COMPORTAMENTO vai no lote de sondas devolvido ao
 * orquestrador (225-05-SONDAS-ESTADO.md).
 *
 * Molde: `src/lib/conciliacaoSqlAudit.test.ts` (225-02) — comentários `--` são
 * removidos antes de qualquer contagem, para que a prosa que explica o padrão
 * proibido não seja contada como se FOSSE o padrão proibido.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARQ = "supabase/migrations/20260904120000_conciliacao_estado_derivado.sql";

/** As duas migrations JÁ APLICADAS. Elas não se editam — o que está no ar só
 *  muda por migration nova. Estão aqui para provar que continuam intactas. */
const APLICADAS = [
  "supabase/migrations/20260903130000_conciliacao_modelo_e_rpcs.sql",
  "supabase/migrations/20260903140000_conciliacao_acl_e_totais.sql",
];

function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

/** Colapsa espaço em branco: a asserção é sobre a LÓGICA, não sobre a
 *  indentação, que um `prettier` de SQL poderia mudar sem mudar o sentido. */
function normalizado(sql: string): string {
  return semComentarios(sql).replace(/\s+/g, " ").toLowerCase();
}

const bruto = readFileSync(resolve(process.cwd(), ARQ), "utf8");
const corpo = semComentarios(bruto);
const plano = normalizado(bruto);

describe("🔴 a migration nova existe e NÃO edita o que já está aplicado", () => {
  it("1 — é migration nova, com data posterior às duas aplicadas", () => {
    expect(ARQ).toMatch(/20260904/);
    expect(bruto.length).toBeGreaterThan(500);
  });

  it("2 — as duas migrations aplicadas continuam com a cascata ORIGINAL", () => {
    // Se alguém "consertar" editando a migration já aplicada, o banco em
    // produção não muda e o repositório passa a mentir sobre o que está no ar.
    const acl = normalizado(
      readFileSync(resolve(process.cwd(), APLICADAS[1]), "utf8"),
    );
    expect(acl, "a migration aplicada foi editada").toContain(
      "when k.estado is null then 'aberto'",
    );
    for (const a of APLICADAS) {
      expect(readFileSync(resolve(process.cwd(), a), "utf8").length).toBeGreaterThan(1000);
    }
  });

  it("3 — usa CREATE OR REPLACE, nunca DROP FUNCTION", () => {
    // 🔴 `DROP FUNCTION` apaga a ACL (feedback_drop_function_apaga_acl). A
    // assinatura não muda, então `create or replace` basta e o grant sobrevive.
    expect(plano).toContain("create or replace function public.conciliacao_base_linhas");
    expect(plano, "DROP apagaria a ACL e fecharia a porta da tela").not.toMatch(
      /drop\s+function/,
    );
  });
});

describe("🔴 defeito 1 — o curto-circuito do NULO foi removido", () => {
  it("4 — `k.estado is null` não é mais o PRIMEIRO ramo da cascata", () => {
    const i = plano.indexOf("when k.estado is null then 'aberto'");
    if (i !== -1) {
      const iResolvido = plano.indexOf("'resolvido_sozinho'");
      const iExpirado = plano.indexOf("'expirado'");
      expect(
        i > iResolvido && i > iExpirado,
        "o ramo do nulo continua antes das derivações e as curto-circuita",
      ).toBe(true);
    }
  });

  it("5 — as derivações toleram caso sem linha persistida", () => {
    // `conciliacao_casos` tem zero linha hoje: sem `coalesce`, nenhuma
    // derivação alcança um único caso da janela.
    expect(plano).toContain("coalesce(k.estado, 'aberto') = 'aberto'");
  });
});

describe("🔴 defeito 2 — a conjunção impossível foi desfeita", () => {
  it("6 — `tem_aprovado` não é mais exigido junto de `tipo_calc = repasse_ausente`", () => {
    // Sem linha em cash_inflows não há aprovado; com aprovado o tipo já não é
    // ausente. A conjunção não pode ser verdadeira em nenhum estado do mundo.
    expect(
      plano,
      "a conjunção impossível continua na cascata",
    ).not.toMatch(/tem_aprovado and l\.tipo_calc = 'repasse_ausente'/);
    expect(plano).not.toMatch(/l\.tipo_calc = 'repasse_ausente' and l\.tem_aprovado/);
  });

  it("7 — `resolvido_sozinho` passa a exigir que o repasse TENHA chegado", () => {
    const i = plano.indexOf("'resolvido_sozinho'");
    expect(i, "a cascata não produz mais resolvido_sozinho").toBeGreaterThan(-1);
    const ramo = plano.slice(Math.max(0, i - 320), i);
    expect(ramo, "resolvido_sozinho sem exigir repasse chegado").toMatch(
      /tem_repasse/,
    );
    expect(ramo).toMatch(/tem_aprovado/);
  });
});

describe("🔴 defeito 3 — o caso de ausência é buscado por tipo LITERAL", () => {
  it("8 — há um lookup próprio com `tipo_caso = 'repasse_ausente'` literal", () => {
    // O join principal casa por `l.tipo_calc`, que MUDA quando o repasse chega.
    // O lookup literal é o mesmo padrão já provado em produção pelo `kv` da
    // cascata de motivo — 1:1 pela chave única (org, pedido, tipo), sem fan-out.
    const lookups = plano.match(/tipo_caso = 'repasse_ausente'/g) ?? [];
    expect(lookups.length, "sem lookup literal o caso somem quando o dinheiro chega").
      toBeGreaterThanOrEqual(2);
  });

  it("9 — o lookup novo tem alias próprio e não substitui o join principal", () => {
    expect(plano).toContain("k.tipo_caso = l.tipo_calc");
  });
});

describe("🔴 o desfecho registrado pelo usuário nunca é sobrescrito", () => {
  it("10 — contestado/ganho/negado são resolvidos ANTES de qualquer derivação", () => {
    const iUsuario = plano.indexOf("'contestado', 'ganho', 'negado'");
    expect(iUsuario, "os estados do usuário não têm ramo próprio").toBeGreaterThan(-1);
    expect(iUsuario).toBeLessThan(plano.indexOf("'resolvido_sozinho'"));
    expect(iUsuario).toBeLessThan(plano.indexOf("'expirado'"));
  });

  it("11 — `expirado` só alcança a fila que TEM prazo de ressarcimento", () => {
    // A fila "Nosso erro" não tem janela de ressarcimento. Marcar uma correção
    // de cadastro como "Expirado — prazo perdido" seria afirmar que um prazo
    // que nunca existiu foi perdido.
    const i = plano.indexOf("'expirado'");
    const ramo = plano.slice(Math.max(0, i - 400), i);
    expect(ramo).toContain("sem_repasse_confirmado");
    expect(ramo).toContain("ausencia_a_verificar");
    expect(ramo).toMatch(/dias_restantes < 0/);
  });
});

describe("🔴 a ACL é reemitida, com `anon` NOMEADO", () => {
  it("12 — revoga de `anon` explicitamente, não só de PUBLIC", () => {
    // Revogar de PUBLIC não desfaz o grant DIRETO que o default privilege do
    // Supabase grava em toda função nova do schema public — R-08(c) reprovou
    // exatamente isso nesta fase.
    expect(plano).toMatch(
      /revoke all on function public\.conciliacao_base_linhas\(uuid, ?int\) from anon/,
    );
  });

  it("13 — reemite o grant para `authenticated`", () => {
    expect(plano).toMatch(
      /grant execute on function public\.conciliacao_base_linhas\(uuid, ?int\) to authenticated/,
    );
  });

  it("14 — continua SECURITY INVOKER; DEFINER com parâmetro de org é IDOR", () => {
    expect(plano).toContain("security invoker");
    expect(plano).not.toContain("security definer");
  });
});

describe("🔴 a migration falha ALTO em vez de aplicar pela metade", () => {
  it("15 — tem bloco de guarda que levanta exceção", () => {
    expect(corpo).toMatch(/do \$\$/i);
    expect(plano).toContain("raise exception");
  });

  it("16 — a guarda confere `anon` e `authenticated` na função corrigida", () => {
    expect(plano).toContain("has_function_privilege('anon'");
    expect(plano).toContain("has_function_privilege('authenticated'");
  });
});
