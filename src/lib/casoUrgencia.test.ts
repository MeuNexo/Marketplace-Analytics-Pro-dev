// ============================================================================
// 225-03 Task 1 — a régua de urgência do monitor de conciliação
//
// 🔴 POR QUE ESTE ARQUIVO EXISTE ANTES DO MÓDULO
//
// Esta tela é o ÚNICO canal (D-225-11: o Wesley recusou Telegram). O relógio de
// 30 dias corre sozinho e, se o rótulo do prazo mentir, o caso expira em
// silêncio — que é exatamente a falha que D-225-16 proíbe.
//
// ⚠️ O módulo NÃO recalcula prazo. `dias_restantes` chega pronto da RPC
// `get_casos_conciliacao` (225-02). Duas réguas para o mesmo número foi como o
// saldo quebrou na fase 233; aqui a régua mora no banco e a tela só rotula.
//
// ⚠️ Os limiares NÃO são os de `claimStatus.ts`. Lá a régua é o
// `action_due_date` do claim; aqui é a janela de ressarcimento de 30 dias do
// ML (D-225-01). O que se copiou de lá foi a FORMA (função pura, nulo tratado
// explicitamente), nunca os números.
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  acharCasoSelecionado,
  chaveDeLista,
  compararPorPrazo,
  compararPorValor,
  rotuloEstado,
  rotuloMotivo,
  rotuloTipoCaso,
  rotuloUrgencia,
  valorEmReais,
} from "./casoUrgencia";

describe("rotuloUrgencia — as fronteiras da janela de 30 dias", () => {
  it("nulo devolve o estado neutro sem badge, sem lançar e sem 'NaN'", () => {
    const r = rotuloUrgencia(null);
    expect(r.badge).toBe(false);
    expect(r.tom).toBe("neutro");
    expect(r.texto).not.toMatch(/NaN|undefined|null/);
    expect(r.texto.length).toBeGreaterThan(0);
  });

  it("undefined e NaN caem no mesmo estado neutro — ausência não é zero", () => {
    expect(rotuloUrgencia(undefined).badge).toBe(false);
    expect(rotuloUrgencia(Number.NaN).badge).toBe(false);
    expect(rotuloUrgencia(Number.NaN).texto).not.toMatch(/NaN/);
  });

  it("-1 → 'Expirado', tom dessaturado, sem badge (não é 'mais um vermelho')", () => {
    const r = rotuloUrgencia(-1);
    expect(r.texto).toBe("Expirado");
    expect(r.tom).toBe("expirado");
    expect(r.badge).toBe(false);
  });

  it("0 → 'Expira hoje', destructive, peso forte", () => {
    const r = rotuloUrgencia(0);
    expect(r.texto).toBe("Expira hoje");
    expect(r.tom).toBe("destructive");
    expect(r.badge).toBe(true);
    expect(r.forte).toBe(true);
  });

  it("1 → singular 'Expira em 1 dia' (nunca '1 dias')", () => {
    const r = rotuloUrgencia(1);
    expect(r.texto).toBe("Expira em 1 dia");
    expect(r.tom).toBe("destructive");
    expect(r.badge).toBe(true);
  });

  it("7 → ainda destructive: é o limite da urgência que abre o banner", () => {
    const r = rotuloUrgencia(7);
    expect(r.texto).toBe("Expira em 7 dias");
    expect(r.tom).toBe("destructive");
    expect(r.badge).toBe(true);
  });

  it("8 e 14 → warning, com badge", () => {
    expect(rotuloUrgencia(8).tom).toBe("warning");
    expect(rotuloUrgencia(8).badge).toBe(true);
    expect(rotuloUrgencia(14).tom).toBe("warning");
    expect(rotuloUrgencia(14).badge).toBe(true);
  });

  it("🔴 15 e 30 → neutro e SEM badge: o estado normal não recebe cor", () => {
    // 87,7% dos repasses liberam em 7–14 dias (research Q3). Cor usada no
    // estado normal deixa de significar qualquer coisa.
    expect(rotuloUrgencia(15).tom).toBe("neutro");
    expect(rotuloUrgencia(15).badge).toBe(false);
    expect(rotuloUrgencia(30).tom).toBe("neutro");
    expect(rotuloUrgencia(30).badge).toBe(false);
  });

  it("tom é sempre um dos quatro nomes do UI-SPEC, nunca uma classe Tailwind", () => {
    const nomes = ["destructive", "warning", "neutro", "expirado"];
    for (const d of [null, -5, -1, 0, 1, 3, 7, 8, 14, 15, 30, 99]) {
      const r = rotuloUrgencia(d as number | null);
      expect(nomes).toContain(r.tom);
      expect(r.tom).not.toMatch(/text-|bg-|hsl\(/);
    }
  });
});

describe("compararPorPrazo — D-225-03: prazo manda, valor nunca", () => {
  const caso = (d: number | null) => ({ dias_restantes: d });

  it("ordena crescente por dias restantes", () => {
    const fila = [caso(20), caso(2), caso(9)].sort(compararPorPrazo);
    expect(fila.map((c) => c.dias_restantes)).toEqual([2, 9, 20]);
  });

  it("🔴 nulo vai para o fim nos DOIS sentidos — a simetria é a prova", () => {
    // Um comparador assimétrico produz ordem dependente da ordem de entrada,
    // e a fila muda sozinha entre dois renders com os mesmos dados.
    expect(compararPorPrazo(caso(null), caso(5))).toBeGreaterThan(0);
    expect(compararPorPrazo(caso(5), caso(null))).toBeLessThan(0);
    expect(compararPorPrazo(caso(null), caso(null))).toBe(0);
  });

  it("dois nulos e vários finitos: os nulos ficam todos no fim", () => {
    const fila = [caso(null), caso(30), caso(null), caso(1)].sort(compararPorPrazo);
    expect(fila.slice(0, 2).map((c) => c.dias_restantes)).toEqual([1, 30]);
    expect(fila.slice(2).every((c) => c.dias_restantes === null)).toBe(true);
  });

  it("negativo (expirado) vem antes de qualquer prazo vivo", () => {
    const fila = [caso(3), caso(-2), caso(0)].sort(compararPorPrazo);
    expect(fila.map((c) => c.dias_restantes)).toEqual([-2, 0, 3]);
  });
});

describe("compararPorValor — a fila 'Nosso erro' não tem prazo", () => {
  const caso = (v: number | null) => ({ diferenca: v });

  it("ordena por valor absoluto decrescente", () => {
    const fila = [caso(10), caso(500), caso(-900)].sort(compararPorValor);
    expect(fila.map((c) => c.diferenca)).toEqual([-900, 500, 10]);
  });

  it("nulo vai para o fim nos dois sentidos", () => {
    expect(compararPorValor(caso(null), caso(1))).toBeGreaterThan(0);
    expect(compararPorValor(caso(1), caso(null))).toBeLessThan(0);
    expect(compararPorValor(caso(null), caso(null))).toBe(0);
  });
});

describe("chaveDeLista — 🔴 ml_order_id NUNCA é key de React", () => {
  it("usa caso_id quando ele existe", () => {
    expect(chaveDeLista({ caso_id: "uuid-1", ml_order_id: "MLB9", tipo_caso: "repasse_ausente" }))
      .toBe("uuid-1");
  });

  it("sem caso_id, combina pedido + tipo — a mesma venda com dois tipos não colide", () => {
    const a = chaveDeLista({ caso_id: null, ml_order_id: "200", tipo_caso: "repasse_ausente" });
    const b = chaveDeLista({ caso_id: null, ml_order_id: "200", tipo_caso: "repasse_a_menor" });
    expect(a).not.toBe(b);
  });

  it("🔴 pedido nulo ainda devolve string não vazia — cai no payment_id", () => {
    // `ml_order_id` é NULO em entrada que não é venda do ML (aporte, rendimento)
    // e não é único por split payment (2,39% dos pedidos têm >1 pagamento).
    const k = chaveDeLista({
      caso_id: null,
      ml_order_id: null,
      tipo_caso: "entrada_sem_origem",
      payment_ids: ["PAY-77"],
    });
    expect(k).toContain("PAY-77");
    expect(k.length).toBeGreaterThan(0);
  });

  it("pedido nulo e sem payment_id ainda devolve string não vazia", () => {
    const k = chaveDeLista({ caso_id: null, ml_order_id: null, tipo_caso: null });
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
    expect(k).not.toMatch(/null|undefined/);
  });

  it("caso_id vazio não é aceito como chave — cai no fallback", () => {
    const k = chaveDeLista({ caso_id: "", ml_order_id: "300", tipo_caso: "repasse_ausente" });
    expect(k).toContain("300");
  });
});

describe("acharCasoSelecionado — 🔴 o painel não pode fechar sozinho ao gravar", () => {
  // ────────────────────────────────────────────────────────────────────────
  // 🔴 O DEFEITO QUE ISTO FECHA, e ele é do tipo que não pisca em lugar nenhum.
  //
  // A seleção do painel é uma STRING guardada na página. Enquanto o caso é só
  // pré-visualização da RPC, `chaveDeLista` devolve `pedido:tipo`. No instante
  // em que a primeira escrita cria a linha em `conciliacao_casos` — a
  // conferência no Mercado Pago, ou o "marcar como contestado" —, a RPC passa a
  // devolver `caso_id` e a chave da MESMA linha vira o UUID. A busca exata
  // falha, `casoSelecionado` vira nulo e o painel FECHA.
  //
  // Fecha exatamente no momento em que o usuário precisa continuar: conferiu no
  // MP, o caso acabou de virar acionável, e o botão de contestar apareceria
  // agora. Ele some junto com o painel, e a tela não diz por quê.
  //
  // ⚠️ A chave de React continua sendo `chaveDeLista` (com o UUID): identidade
  // de reconciliação e identidade de seleção são coisas diferentes, e é por
  // confundir as duas que o defeito existe.
  // ────────────────────────────────────────────────────────────────────────

  const previa = {
    caso_id: null,
    ml_order_id: "2000017817648050",
    tipo_caso: "repasse_ausente",
  };
  const persistido = { ...previa, caso_id: "uuid-recem-criado" };

  it("acha pela chave exata quando nada mudou", () => {
    expect(acharCasoSelecionado([previa], chaveDeLista(previa))).toBe(previa);
    expect(acharCasoSelecionado([persistido], chaveDeLista(persistido))).toBe(persistido);
  });

  it("🔴 acha a MESMA linha depois que ela ganhou caso_id — o painel não fecha", () => {
    const chaveDeAntes = chaveDeLista(previa);
    expect(chaveDeLista(persistido)).not.toBe(chaveDeAntes);
    expect(acharCasoSelecionado([persistido], chaveDeAntes)).toBe(persistido);
  });

  it("não confunde os dois casos do mesmo pedido", () => {
    const outroTipo = { ...persistido, tipo_caso: "repasse_a_menor", caso_id: "uuid-outro" };
    expect(acharCasoSelecionado([outroTipo, persistido], chaveDeLista(previa))).toBe(persistido);
  });

  it("chave nula ou não encontrada devolve null, nunca a primeira linha", () => {
    expect(acharCasoSelecionado([persistido], null)).toBeNull();
    expect(acharCasoSelecionado([persistido], "")).toBeNull();
    expect(acharCasoSelecionado([persistido], "uuid-que-nao-existe")).toBeNull();
    expect(acharCasoSelecionado(null, "qualquer")).toBeNull();
  });

  it("a entrada sem pedido continua achável pelo pagamento", () => {
    const entrada = {
      caso_id: null,
      ml_order_id: null,
      tipo_caso: "entrada_sem_origem",
      payment_ids: ["PAY-77"],
    };
    expect(acharCasoSelecionado([entrada], chaveDeLista(entrada))).toBe(entrada);
  });
});

describe("rotuloTipoCaso — código desconhecido devolve o próprio código", () => {
  it("traduz os três tipos do contrato da RPC", () => {
    expect(rotuloTipoCaso("repasse_ausente")).toBe("Repasse ausente");
    expect(rotuloTipoCaso("repasse_a_menor")).toBe("Repasse a menor");
    expect(rotuloTipoCaso("entrada_sem_origem")).toBe("Entrada sem origem");
  });

  it("desconhecido devolve o código, nunca string vazia", () => {
    expect(rotuloTipoCaso("tipo_que_o_banco_inventou")).toBe("tipo_que_o_banco_inventou");
    expect(rotuloTipoCaso(null)).not.toBe("");
  });
});

describe("rotuloMotivo — a ausência diz o motivo REAL", () => {
  it("cobre os códigos de pedido emitidos pela RPC, sem string vazia", () => {
    const codigos = [
      "abaixo_do_piso",
      "aguardando_liberacao",
      "sem_captura_cobranca",
      "fora_da_janela_de_ingestao",
      "fora_do_escopo",
      "divergencia_da_nossa_base",
      "possivel_carrinho",
      "ausencia_a_verificar",
      "sem_repasse_confirmado",
      "repasse_a_menor_confirmado",
      "regua_nao_liberada",
    ];
    for (const c of codigos) {
      const t = rotuloMotivo(c);
      expect(t.length, `motivo sem texto: ${c}`).toBeGreaterThan(10);
      expect(t, `motivo não traduzido: ${c}`).not.toBe(c);
    }
  });

  it("cobre os quatro motivos de entrada sem origem (D-225-10)", () => {
    for (const c of [
      "repasse_de_frete",
      "pedido_nao_ingerido",
      "entrada_fora_do_marketplace",
      "venda_sem_chave",
    ]) {
      expect(rotuloMotivo(c), `entrada sem texto: ${c}`).not.toBe(c);
    }
  });

  it("🔴 fora_da_janela_de_ingestao nomeia a DATA — nunca 'sem dados'", () => {
    expect(rotuloMotivo("fora_da_janela_de_ingestao")).toContain("28/01/2026");
    expect(rotuloMotivo("fora_da_janela_de_ingestao")).toMatch(/não é repasse ausente/);
  });

  it("a data vem da RPC quando informada — o front não guarda régua própria", () => {
    // `ingestao_inicio` é um dos 26 campos de `get_conciliacao_resumo`. O
    // literal só existe como espelho do default da config (D-225-15 EMENDA).
    expect(rotuloMotivo("fora_da_janela_de_ingestao", { ingestaoInicio: "2025-12-01" }))
      .toContain("01/12/2025");
  });

  it("🔴 regua_nao_liberada diz que a régua reprovou, não que o caso está pendente", () => {
    const t = rotuloMotivo("regua_nao_liberada");
    expect(t).toMatch(/régua|calibra/i);
    expect(t).not.toMatch(/abrir chamado|cobrar do ML/i);
  });

  it("🔴 ausencia_a_verificar diz que falta VERIFICAR — 5/5 eram chargeback", () => {
    const t = rotuloMotivo("ausencia_a_verificar");
    expect(t).toMatch(/verific/i);
  });

  it("desconhecido devolve o próprio código, nunca string vazia", () => {
    expect(rotuloMotivo("motivo_novo_do_banco")).toBe("motivo_novo_do_banco");
    expect(rotuloMotivo(null).length).toBeGreaterThan(0);
  });
});

describe("rotuloEstado — os desfechos do caso", () => {
  it("traduz os seis estados do contrato", () => {
    for (const e of ["aberto", "contestado", "ganho", "negado", "resolvido_sozinho", "expirado"]) {
      const r = rotuloEstado(e);
      expect(r.texto.length, `estado sem texto: ${e}`).toBeGreaterThan(0);
      expect(["neutro", "warning", "success", "destructive", "expirado"]).toContain(r.tom);
    }
  });

  it("desconhecido devolve o próprio código em tom neutro", () => {
    expect(rotuloEstado("estado_novo").texto).toBe("estado_novo");
    expect(rotuloEstado(null).texto.length).toBeGreaterThan(0);
  });
});

describe("valorEmReais — 🔴 NULO nunca vira R$ 0,00", () => {
  it("zero é uma afirmação e sai como R$ 0,00", () => {
    expect(valorEmReais(0)).toMatch(/R\$\s*0,00/);
  });

  it("nulo é a ausência da afirmação e NUNCA sai como R$ 0,00", () => {
    // `nosso_erro_soma` e `fora_escopo_soma` vêm NULOS quando não há valor
    // mensurável. A onda 2 removeu o coalesce que os transformava em zero;
    // reintroduzi-lo na camada de UI teria o mesmo efeito na tela.
    expect(valorEmReais(null)).not.toMatch(/0,00/);
    expect(valorEmReais(undefined)).not.toMatch(/0,00/);
    expect(valorEmReais(Number.NaN)).not.toMatch(/0,00/);
    expect(valorEmReais(null)).toBe("não apurado");
  });

  it("formata em pt-BR com duas casas", () => {
    expect(valorEmReais(1234.5)).toMatch(/1\.234,50/);
    expect(valorEmReais(-14221.84)).toMatch(/14\.221,84/);
  });

  it("aceita um rótulo de ausência próprio", () => {
    expect(valorEmReais(null, "—")).toBe("—");
  });
});

describe("🔴 PORTÃO — o módulo é puro", () => {
  it("não conhece React, Supabase nem CSS", () => {
    // O gate de verdade é o grep do plano (`^import` = 0). Este teste guarda o
    // outro lado: nenhum tom devolvido pode ser uma classe do Tailwind, senão o
    // módulo passa a conhecer o design system e a página perde a decisão.
    for (const d of [0, 5, 10, 20]) {
      expect(rotuloUrgencia(d).tom).not.toContain("-");
    }
  });
});

// ─── 225-06: os rótulos da terceira régua (frete prometido × frete cobrado) ──

describe("225-06 — rótulos do frete prometido", () => {
  it("o tipo novo tem rótulo e não devolve o código cru", () => {
    expect(rotuloTipoCaso("frete_a_maior")).toBe("Frete cobrado acima do publicado");
  });

  it("🔴 o rótulo do tipo não afirma a hipótese do Wesley", () => {
    // "é sempre a mais" é o que a fase existe para TESTAR. A tela nomeia a
    // comparação; quem diz de que lado o número caiu é o motivo.
    expect(rotuloTipoCaso("frete_a_maior").toLowerCase()).not.toContain("sempre");
  });

  it("os sete motivos de frete têm texto, nenhum devolve o próprio código", () => {
    const motivos = [
      "frete_multi_item",
      "frete_sem_cobranca_registrada",
      "frete_sem_vigencia_na_venda",
      "frete_abaixo_do_piso",
      "frete_a_menor_medido",
      "regua_frete_nao_liberada",
      "frete_a_maior_confirmado",
    ];
    for (const m of motivos) {
      const texto = rotuloMotivo(m);
      expect(texto).not.toBe(m);
      expect(texto.length).toBeGreaterThan(20);
    }
  });

  it("🔴 o lado que NÃO acusa existe e se declara como medição, não como caso", () => {
    const texto = rotuloMotivo("frete_a_menor_medido");
    expect(texto).toContain("ABAIXO");
    expect(texto).toContain("Não é caso");
  });

  it("o retroativo se declara diagnóstico, e diz por quê", () => {
    const texto = rotuloMotivo("frete_sem_vigencia_na_venda");
    expect(texto).toContain("diagnóstico");
    expect(texto).toContain("réguas diferentes");
  });

  it("ausência de cobrança de frete NUNCA é lida como frete grátis presumido", () => {
    const texto = rotuloMotivo("frete_sem_cobranca_registrada");
    expect(texto).toContain("não presumimos zero");
  });

  it("motivo de frete desconhecido continua devolvendo o próprio código", () => {
    // Um motivo novo no banco tem que aparecer feio na tela, não sumir dela.
    expect(rotuloMotivo("frete_invencao_nova")).toBe("frete_invencao_nova");
  });
});
