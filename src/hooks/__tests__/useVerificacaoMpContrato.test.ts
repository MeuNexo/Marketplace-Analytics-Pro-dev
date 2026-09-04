// ============================================================================
// 225-07 Task 1 (RED) — a CHAVE do portão que a fase construiu e nunca abriu
//
// 🔴 O QUE ESTÁ SENDO CONSERTADO (G-01 do `225-VERIFICATION.md`):
//
// A onda 2 criou `conciliacao_casos.verificado_no_mp` como resposta a um achado
// próprio (C-06: os 5 únicos pedidos sem repasse em 75 dias eram 5/5
// contestação de cartão). A cascata de motivo da RPC LÊ a coluna — é ela que
// separa `ausencia_a_verificar` (não acusa) de `sem_repasse_confirmado`
// (acusa). R-09 provou o portão nos DOIS sentidos contra produção.
//
// E `grep -rn "verificado_no_mp" src/` devolvia ZERO. Nenhuma linha do produto
// escrevia a coluna. Consequência concreta: o Wesley confere no painel do
// Mercado Pago, vê que o repasse sumiu de fato, abre o chamado — e o sistema
// não registra nada. D-225-13 existe exatamente para medir isso.
//
// 🔴 DUAS PROVAS, porque nenhuma sozinha basta:
//
//   · COMPORTAMENTO — as funções puras (`validarVerificacao`, `tiraDoEscopo`,
//     `rotuloStatusMp`) são exercidas de verdade. Elas são o portão que roda
//     ANTES do banco;
//   · FORMA — o arquivo é lido como texto para provar o que exigiria uma
//     sessão autenticada: `organization_id` explícito no caminho de escrita, as
//     três consultas invalidadas, e — a mais importante — que a escrita de
//     verificação NÃO toca nenhuma coluna de desfecho.
//
// ⚠️ Comentários são removidos antes de contar: a prosa que documenta um padrão
// proibido não pode reprovar o arquivo que ela explica (lição do 231-04,
// repetida no 225-03 e no 225-05).
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), auth: { getUser: async () => ({ data: { user: null } }) } },
}));

import {
  STATUS_MP_ACEITOS,
  STATUS_MP_FORA_DO_ESCOPO,
  TIPO_VERIFICAVEL,
  rotuloStatusMp,
  tiraDoEscopo,
  validarVerificacao,
  type EntradaVerificacao,
} from "../useVerificacaoMp";

const CAMINHO = join(__dirname, "..", "useVerificacaoMp.ts");

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

const CODIGO = semComentarios(readFileSync(CAMINHO, "utf-8"));

/** O pedido de R-09, medido em produção: 5/5 chargeback em 75 dias. */
const BASE: EntradaVerificacao = {
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_ausente",
  verificado: true,
  status_mp: "approved",
};

// ─── 1. Os quatro status, e só eles ─────────────────────────────────────────

describe("🔴 PORTÃO — os status são os QUATRO que o banco conhece, nem um a mais", () => {
  it("1/8 — os aceitos espelham o comentário de `status_mp_verificado`", () => {
    expect([...STATUS_MP_ACEITOS].sort()).toEqual([
      "approved",
      "cancelled",
      "charged_back",
      "refunded",
    ]);
  });

  it("1b/8 — os três que tiram o caso do escopo são exatamente os do CASE da RPC", () => {
    // `when not x.tem_repasse and verificado_no_mp
    //       and status_mp_verificado in ('charged_back','cancelled','refunded')
    //  then 'fora_do_escopo'`
    expect([...STATUS_MP_FORA_DO_ESCOPO].sort()).toEqual([
      "cancelled",
      "charged_back",
      "refunded",
    ]);
    for (const s of STATUS_MP_FORA_DO_ESCOPO) {
      expect(STATUS_MP_ACEITOS as readonly string[]).toContain(s);
      expect(tiraDoEscopo(s)).toBe(true);
    }
  });

  it("1c/8 — 🔴 `approved` é o ÚNICO que torna a ausência acionável", () => {
    // É a assimetria inteira do portão: três status dizem "o dinheiro não foi
    // retido pelo ML" e um diz "foi". Se `approved` também tirasse do escopo,
    // nenhuma ausência viraria chamado nunca — o portão seria uma parede.
    const acusam = STATUS_MP_ACEITOS.filter((s) => !tiraDoEscopo(s));
    expect(acusam).toEqual(["approved"]);
  });

  it("1d/8 — status inventado é recusado, e não é lido como fora do escopo", () => {
    expect(validarVerificacao({ ...BASE, status_mp: "quase_aprovado" })).toBeTruthy();
    expect(tiraDoEscopo("quase_aprovado")).toBe(false);
    expect(tiraDoEscopo(null)).toBe(false);
  });

  it("1e/8 — todo status tem rótulo em português, e o desconhecido devolve o próprio código", () => {
    for (const s of STATUS_MP_ACEITOS) {
      const r = rotuloStatusMp(s);
      expect(r.length).toBeGreaterThan(s.length);
      expect(r).not.toBe(s);
    }
    // Código novo no banco tem que aparecer FEIO na tela, nunca sumir dela.
    expect(rotuloStatusMp("status_novo_do_mp")).toBe("status_novo_do_mp");
    expect(rotuloStatusMp(null)).toMatch(/não informado/i);
  });
});

// ─── 2. Verificar é uma AFIRMAÇÃO sobre realidade externa ───────────────────

describe("🔴 PORTÃO — verificar exige dizer O QUE foi visto", () => {
  it("2/8 — registrar verificação sem status é recusado", () => {
    expect(validarVerificacao({ ...BASE, status_mp: null })).toBeTruthy();
    expect(validarVerificacao({ ...BASE, status_mp: "   " })).toBeTruthy();
  });

  it("2b/8 — com status válido, passa", () => {
    for (const s of STATUS_MP_ACEITOS) {
      expect(validarVerificacao({ ...BASE, status_mp: s }), `status ${s}`).toBeNull();
    }
  });

  it("2c/8 — 🔴 desfazer NÃO carrega status: desfazer é apagar, não afirmar outra coisa", () => {
    expect(validarVerificacao({ ...BASE, verificado: false, status_mp: null })).toBeNull();
    expect(validarVerificacao({ ...BASE, verificado: false, status_mp: "approved" })).toBeTruthy();
  });

  it("2d/8 — `verificado` ausente ou não booleano é recusado", () => {
    expect(validarVerificacao({ ...BASE, verificado: null })).toBeTruthy();
    expect(validarVerificacao({ ml_order_id: "200", tipo_caso: "repasse_ausente" })).toBeTruthy();
  });
});

// ─── 3. A chave, e o único tipo de caso que a verificação decide ────────────

describe("🔴 PORTÃO — a verificação só decide a AUSÊNCIA de repasse", () => {
  it("3/8 — sem pedido, recusa", () => {
    expect(validarVerificacao({ ...BASE, ml_order_id: null })).toBeTruthy();
    expect(validarVerificacao({ ...BASE, ml_order_id: "  " })).toBeTruthy();
  });

  it("3b/8 — o tipo verificável é `repasse_ausente`, e é o único", () => {
    expect(TIPO_VERIFICAVEL).toBe("repasse_ausente");
    for (const t of ["repasse_a_menor", "entrada_sem_origem", "frete_a_maior"]) {
      const erro = validarVerificacao({ ...BASE, tipo_caso: t });
      expect(erro, `tipo ${t} deveria ser recusado`).toBeTruthy();
    }
  });

  it("3c/8 — sem tipo, recusa (a chave é pedido MAIS tipo)", () => {
    expect(validarVerificacao({ ...BASE, tipo_caso: null })).toBeTruthy();
  });
});

// ─── 4. A escrita não pode encostar em desfecho ─────────────────────────────

describe("🔴 PORTÃO (forma) — verificar NÃO é decidir o caso", () => {
  it("4/8 — escreve as três colunas de verificação", () => {
    for (const col of ["verificado_no_mp", "status_mp_verificado", "verificado_em"]) {
      expect(CODIGO, `coluna ${col} não é escrita`).toContain(col);
    }
  });

  it("4b/8 — 🔴 NÃO escreve nenhuma coluna de desfecho", () => {
    // Uma verificação que zerasse `contestado_em` destruiria a distinção entre
    // "contestei e ganhei" e "resolveu sozinho" — que é o motivo inteiro de
    // D-225-13 existir. O mesmo raciocínio que fez a mutação de desfecho ser
    // atualizar-ou-criar em vez de upsert vale aqui, ao contrário.
    for (const col of ["contestado_em", "desfecho_em", "valor_recuperado"]) {
      expect(CODIGO, `verificação encosta em ${col}`).not.toContain(col);
    }
  });

  it("4c/8 — 🔴 não escreve `estado`: verificar não decide o desfecho do caso", () => {
    expect(/\bestado\b\s*:/.test(CODIGO), "verificação atribui `estado`").toBe(false);
  });

  it("4d/8 — a reversão apaga as três colunas juntas, nunca só a flag", () => {
    // Deixar `status_mp_verificado` para trás faria a tela dizer "não
    // verificado" enquanto o banco guarda uma acusação órfã.
    expect(CODIGO).toMatch(/status_mp_verificado:\s*\w+\s*\?[^,]*:\s*null/);
    expect(CODIGO).toMatch(/verificado_em:\s*\w+\s*\?[^,]*:\s*null/);
  });
});

// ─── 5. Organização, autoria e invalidação ─────────────────────────────────

describe("🔴 PORTÃO (forma) — a escrita carrega organização e autoria", () => {
  it("5/8 — escreve na tabela do modelo de caso da 225-02", () => {
    expect(CODIGO).toContain("conciliacao_casos");
  });

  it("5b/8 — `organization_id` aparece no caminho de escrita ao menos duas vezes", () => {
    const n = (CODIGO.match(/organization_id/g) ?? []).length;
    expect(n, "escrita sem organização explícita").toBeGreaterThanOrEqual(2);
  });

  it("5c/8 — quem verificou fica registrado (não-repúdio)", () => {
    // Verificação é uma AFIRMAÇÃO do usuário sobre realidade externa. Sem autor
    // ela vira um fato anônimo que o sistema não consegue devolver a ninguém.
    expect(CODIGO).toContain("criado_por");
  });

  it("5d/8 — o papel decide se a escrita sai (espelho da policy owner/admin)", () => {
    expect(CODIGO).toContain("podeEscreverDesfecho");
  });

  it("6/8 — o sucesso invalida a lista, o resumo E a própria verificação", () => {
    // A verificação muda `motivo` e `acionavel` na RPC. Invalidar só a lista
    // deixaria o rodapé do resumo contando um `a_verificar_n` que já não existe.
    for (const chave of ["conciliacao-casos", "conciliacao-resumo", "conciliacao-verificacao"]) {
      expect(CODIGO, `consulta ${chave} não é invalidada`).toContain(chave);
    }
    expect(CODIGO).toMatch(/invalidateQueries/);
  });

  it("6b/8 — o erro do banco sobe com a mensagem original", () => {
    expect(CODIGO).toMatch(/throw new Error\(/);
    expect(CODIGO).toMatch(/error\.message|erro\.message/);
  });
});

// ─── 6. A leitura: a tela lê exatamente o que ela escreve ──────────────────

describe("🔴 PORTÃO (forma) — o estado de verificação vem do BANCO, nunca do motivo", () => {
  it("7/8 — lê as três colunas de `conciliacao_casos`, não infere de `motivo`", () => {
    // Inferir "está verificado" a partir de `motivo = 'fora_do_escopo'` seria
    // uma SEGUNDA RÉGUA para o mesmo fato — exatamente o padrão que quebrou o
    // saldo na fase 233. A tela lê a coluna que ela mesma escreve.
    expect(CODIGO).toMatch(/\.select\(/);
    expect(CODIGO).not.toMatch(/fora_do_escopo/);
    expect(CODIGO).not.toMatch(/ausencia_a_verificar/);
  });

  it("7b/8 — a organização entra na queryKey da CONSULTA (IDOR de cache entre lojas)", () => {
    // ⚠️ Só as chaves de DEFINIÇÃO (`as const`, convenção do repositório) são
    // exigidas com organização. As de `invalidateQueries` são PREFIXO de
    // propósito: invalidar com a chave inteira deixaria de pé a entrada da
    // outra loja, que é exatamente o cache que o usuário vê ao trocar de conta.
    const definicoes = CODIGO.match(/queryKey:\s*\[[^\]]*\]\s*as const/g) ?? [];
    expect(definicoes.length, "nenhuma queryKey de consulta encontrada").toBeGreaterThanOrEqual(1);
    for (const k of definicoes) {
      expect(k, `queryKey sem organização: ${k}`).toMatch(/orgId|organization/i);
    }
  });

  it("7c/8 — a invalidação é por PREFIXO, e são exatamente as três consultas", () => {
    const invalidacoes = CODIGO.match(/invalidateQueries\(\{[^}]*\}\)/g) ?? [];
    expect(invalidacoes.length, "invalidação faltando ou sobrando").toBe(3);
    for (const i of invalidacoes) {
      expect(i, `invalidação com chave completa: ${i}`).not.toMatch(/orgId/);
    }
  });

  it("8/8 — nenhuma régua do banco é reescrita aqui", () => {
    // Piso, cortes de dias e janela moram em `conciliacao_config` e viajam na
    // RPC. Nenhum número deles pode aparecer neste arquivo.
    expect(CODIGO).not.toMatch(/piso_materialidade/);
    expect(CODIGO).not.toMatch(/\bdias_ausente\b/);
    expect(CODIGO).not.toMatch(/acusar_valor_a_menor/);
  });
});
