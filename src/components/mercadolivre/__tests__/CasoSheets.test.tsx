// ============================================================================
// 225-05 Task 3 — o portão que o `grep` não consegue ser
//
// Três proibições deste plano são sobre AUSÊNCIA de elemento renderizado, e
// ausência não se prova com busca de texto no arquivo: o botão pode estar
// escrito no código e não ser renderizado, ou estar renderizado num ramo que o
// grep não distingue. Estas asserções montam o componente de verdade e
// perguntam à árvore acessível o que existe na tela.
//
// O que está sendo protegido, em uma frase cada:
//   · caso NÃO acionável não pode oferecer caminho para virar chamado — hoje é
//     quase todo caso (régua de valor a menor desligada, ausência a verificar);
//   · "resolvido sozinho" não é botão em lugar nenhum;
//   · a fila "Nosso erro" não tem dossiê nem desfecho nem prazo.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { CasoConciliacaoRow } from "@/hooks/useConciliacao";

const marcarDesfecho = vi.fn();
let podeEscrever = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCasoDesfecho", async () => {
  const real = await vi.importActual<typeof import("@/hooks/useCasoDesfecho")>(
    "@/hooks/useCasoDesfecho",
  );
  return {
    ...real,
    useCasoDesfecho: () => ({
      marcarDesfecho,
      podeEscrever,
      papel: podeEscrever ? "owner" : "viewer",
      ocupado: false,
      erro: null,
    }),
  };
});

import { CasoConciliacaoSheet } from "../CasoConciliacaoSheet";
import { CasoNossoErroSheet } from "../CasoNossoErroSheet";

const CASO: CasoConciliacaoRow = {
  caso_id: null,
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_a_menor",
  fila: "ml",
  acionavel: true,
  motivo: "repasse_a_menor_confirmado",
  estado: "aberto",
  titulo: "Chapéu Country Pralana Aba 10",
  sku: "PRL-CH-0010",
  quantidade: 2,
  retido_de_fato: 123.45,
  cobranca_declarada: 100.4,
  residuo_ml: 23.05,
  esperado_nosso: 420.5,
  recebido: 397.45,
  residuo_nosso: 23.05,
  diferenca: 23.05,
  data_pedido: "2026-08-07",
  data_evento: "2026-08-10",
  dias_restantes: 5,
  n_pagamentos: 2,
  payment_ids: ["172656733528", "171656032162"],
  release_date_max: "2026-08-25",
  valor_estimado: false,
};

function abrir(caso: Partial<CasoConciliacaoRow>) {
  render(
    <CasoConciliacaoSheet
      caso={{ ...CASO, ...caso } as CasoConciliacaoRow}
      ingestaoInicio="2026-01-28"
      onOpenChange={() => {}}
    />,
  );
}

const ROTULOS_DE_DESFECHO = [
  /Marcar como contestado/i,
  /Marcar como ganho/i,
  /Marcar como negado/i,
];

function nenhumBotaoDeDesfecho() {
  for (const r of ROTULOS_DE_DESFECHO) {
    expect(screen.queryByRole("button", { name: r })).toBeNull();
  }
}

beforeEach(() => {
  podeEscrever = true;
  marcarDesfecho.mockReset();
  cleanup();
});

describe("🔴 o dossiê oferece ação SÓ no caso acionável", () => {
  it("1 — caso acionável e aberto oferece contestar e o dossiê", () => {
    abrir({});
    expect(screen.getByRole("button", { name: /Marcar como contestado/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar dossiê/i })).toBeTruthy();
  });

  it("2 — caso contestado troca para ganho e negado, e some o contestar", () => {
    abrir({ estado: "contestado" });
    expect(screen.getByRole("button", { name: /Marcar como ganho/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Marcar como negado/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Marcar como contestado/i })).toBeNull();
  });

  it("3 — 🔴 caso NÃO acionável não tem NENHUM botão de desfecho, e diz o motivo", () => {
    // Hoje é quase todo caso: os 5 candidatos a ausência em 75 dias eram 5/5
    // contestação de cartão, e a régua de valor a menor está desligada.
    abrir({ acionavel: false, motivo: "ausencia_a_verificar", tipo_caso: "repasse_ausente" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/ainda não é acionável/i)).toBeTruthy();
    // O aviso medido em C-06 aparece na tela, não só no texto copiado.
    expect(screen.getByText(/5 de 5 pedidos sem repasse/i)).toBeTruthy();
  });

  it("4 — caso da régua desligada também não oferece ação", () => {
    abrir({ acionavel: false, motivo: "regua_nao_liberada" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/55,3%/)).toBeTruthy();
  });

  it("5 — sem permissão de escrita não há botão de desfecho, mas o dossiê fica", () => {
    podeEscrever = false;
    abrir({});
    nenhumBotaoDeDesfecho();
    expect(screen.getByRole("button", { name: /Copiar dossiê/i })).toBeTruthy();
  });
});

describe("🔴 'resolvido sozinho' e 'expirado' são do sistema — nunca botão", () => {
  it("6 — resolvido sozinho: sem ações, com a nota explicativa", () => {
    abrir({ estado: "resolvido_sozinho" });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/fechado automaticamente/i)).toBeTruthy();
  });

  it("7 — em NENHUM estado existe um botão que crie 'resolvido sozinho'", () => {
    for (const estado of ["aberto", "contestado", "ganho", "negado", "expirado"]) {
      cleanup();
      abrir({ estado });
      expect(
        screen.queryByRole("button", { name: /resolvido sozinho/i }),
        `estado ${estado} ofereceu 'resolvido sozinho' como ação`,
      ).toBeNull();
    }
  });

  it("8 — expirado: sem ações, e visualmente distinto de 'ainda dá tempo'", () => {
    abrir({ estado: "expirado", dias_restantes: -3 });
    nenhumBotaoDeDesfecho();
    expect(screen.getByText(/janela de ressarcimento deste caso fechou/i)).toBeTruthy();
  });
});

describe("🔴 cada ícone de copiar tem rótulo acessível NOMEANDO o campo", () => {
  it("9 — todo botão de copiar tem nome, e há mais de um campo copiável", () => {
    abrir({});
    const botoes = screen.getAllByRole("button", { name: /^Copiar / });
    expect(botoes.length).toBeGreaterThanOrEqual(4);
    for (const b of botoes) {
      const nome = b.getAttribute("aria-label") ?? b.textContent ?? "";
      expect(nome.trim().length, "ícone de copiar mudo").toBeGreaterThan("Copiar ".length);
    }
  });

  it("10 — os dois identificadores de pagamento aparecem, não só o primeiro", () => {
    abrir({});
    expect(screen.getByText("172656733528")).toBeTruthy();
    expect(screen.getByText("171656032162")).toBeTruthy();
  });

  it("11 — as duas fontes aparecem NOMEADAS na tela", () => {
    abrir({});
    expect(screen.getByText(/Mercado Pago \(retido de fato\)/)).toBeTruthy();
    expect(screen.getByText(/Fatura do Mercado Livre \(cobrança declarada\)/)).toBeTruthy();
  });

  it("12 — valor nulo aparece como 'não apurado', nunca como R$ 0,00", () => {
    abrir({ retido_de_fato: null, cobranca_declarada: null, diferenca: null });
    expect(screen.getAllByText(/não apurado/).length).toBeGreaterThan(0);
    expect(screen.queryByText("R$ 0,00")).toBeNull();
  });
});

describe("🔴 a fila 'Nosso erro' não tem caminho para virar chamado", () => {
  function abrirNosso(caso: Partial<CasoConciliacaoRow> = {}) {
    render(
      <CasoNossoErroSheet
        caso={
          {
            ...CASO,
            fila: "nosso",
            acionavel: false,
            motivo: "divergencia_da_nossa_base",
            ...caso,
          } as CasoConciliacaoRow
        }
        ingestaoInicio="2026-01-28"
        onOpenChange={() => {}}
      />,
    );
  }

  it("13 — sem dossiê e sem nenhum botão de desfecho", () => {
    abrirNosso();
    expect(screen.queryByRole("button", { name: /Copiar dossiê/i })).toBeNull();
    nenhumBotaoDeDesfecho();
  });

  it("14 — sem selo de prazo: aqui não corre relógio de ressarcimento", () => {
    abrirNosso({ dias_restantes: 3 });
    expect(screen.queryByText(/Expira em/i)).toBeNull();
    expect(screen.queryByText(/Expira hoje/i)).toBeNull();
  });

  it("15 — diz, com todas as letras, que nada sai daqui", () => {
    abrirNosso();
    expect(screen.getByText(/Nada aqui é enviado para fora/i)).toBeTruthy();
  });
});

// ============================================================================
// 225-07 (G-01) — a CHAVE do portão, exercida na árvore acessível
//
// 🔴 O que estas asserções protegem, e por que grep não alcança:
//
// A fase inventou `conciliacao_casos.verificado_no_mp` em 225-02 (achado C-06:
// os 5 únicos pedidos sem repasse em 75 dias eram 5/5 contestação de cartão) e
// a cascata da RPC LÊ a coluna — é ela que separa `ausencia_a_verificar`, que
// não acusa, de `sem_repasse_confirmado`, que vira chamado. Nenhuma linha do
// produto escrevia a coluna. O `grep` provava a ausência do texto; só a árvore
// renderizada prova que existe um CAMINHO — e que ele some onde deve sumir.
//
// A cadeia inteira, em uma frase: conferir no Mercado Pago → registrar o que se
// viu → a RPC re-deriva o motivo → o portão de `acionavel` que já existia abre
// sozinho. A chave não abre uma porta nova; abre a que a fase deixou trancada.
// ============================================================================

const registrarVerificacao = vi.fn();
let verificacaoAtual: {
  caso_id: string | null;
  verificado_no_mp: boolean;
  status_mp_verificado: string | null;
  verificado_em: string | null;
} | null = null;

vi.mock("@/hooks/useVerificacaoMp", async () => {
  const real = await vi.importActual<typeof import("@/hooks/useVerificacaoMp")>(
    "@/hooks/useVerificacaoMp",
  );
  return {
    ...real,
    useVerificacaoMp: () => ({
      verificacao: verificacaoAtual,
      carregando: false,
      registrarVerificacao,
      podeEscrever,
      ocupado: false,
      erro: null,
    }),
  };
});

/** O pedido de R-09, medido em produção: `ausencia_a_verificar`, R$ 439,25. */
const AUSENCIA: Partial<CasoConciliacaoRow> = {
  tipo_caso: "repasse_ausente",
  motivo: "ausencia_a_verificar",
  acionavel: false,
  estado: "aberto",
  diferenca: 439.25,
};

const ROTULO_CONFERIR = /Conferi no Mercado Pago/i;
const ROTULO_DESFAZER = /Desfazer verificação/i;

beforeEach(() => {
  registrarVerificacao.mockReset();
  verificacaoAtual = null;
});

describe("🔴 G-01 — a ausência a verificar ganha caminho para ser verificada", () => {
  it("16 — o caso `ausencia_a_verificar` oferece registrar a conferência", () => {
    abrir(AUSENCIA);
    expect(screen.getByRole("button", { name: ROTULO_CONFERIR })).toBeTruthy();
    // E continua SEM caminho para virar chamado: verificar não é contestar.
    nenhumBotaoDeDesfecho();
  });

  it("17 — o painel pergunta O QUE foi visto: os quatro status do banco, e só eles", () => {
    abrir(AUSENCIA);
    fireEvent.click(screen.getByRole("button", { name: ROTULO_CONFERIR }));

    const opcoes = screen.getAllByRole("radio");
    expect(opcoes.length, "os quatro status que a régua do banco lê").toBe(4);

    // 🔴 O texto de cada opção é o que o usuário vê no painel do MP, não o
    // código do banco. Código na tela transfere a tradução para quem clica.
    // ⚠️ Os recortes são estreitos de propósito: o aviso de C-06, que já era
    // renderizado antes desta correção, também fala em "contestação de cartão".
    // Um matcher largo aqui passaria SEM o bloco novo existir.
    expect(screen.getByText(/O pagamento está aprovado e o repasse não chegou/i)).toBeTruthy();
    expect(
      screen.getByText(/^Contestação de cartão do comprador \(chargeback\)$/i),
    ).toBeTruthy();
    expect(screen.getByText(/O pagamento aparece cancelado/i)).toBeTruthy();
    expect(screen.getByText(/O pagamento foi estornado ao comprador/i)).toBeTruthy();
    // Nenhum código de banco vaza para a tela.
    for (const codigo of ["approved", "charged_back", "cancelled", "refunded"]) {
      expect(screen.queryByText(codigo), `codigo cru na tela: ${codigo}`).toBeNull();
    }
  });

  it("18 — 🔴 confirmar sem escolher status é impossível: conferência sem conteúdo não decide nada", () => {
    abrir(AUSENCIA);
    fireEvent.click(screen.getByRole("button", { name: ROTULO_CONFERIR }));

    const confirmar = screen.getByRole("button", { name: /^Confirmar$/i });
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmar);
    expect(registrarVerificacao).not.toHaveBeenCalled();
  });

  it("19 — escolher e confirmar grava o status escolhido, com pedido e tipo", () => {
    abrir(AUSENCIA);
    fireEvent.click(screen.getByRole("button", { name: ROTULO_CONFERIR }));
    fireEvent.click(screen.getAllByRole("radio")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar$/i }));

    expect(registrarVerificacao).toHaveBeenCalledTimes(1);
    const args = registrarVerificacao.mock.calls[0][0];
    expect(args.ml_order_id).toBe("2000017817648050");
    expect(args.tipo_caso).toBe("repasse_ausente");
    expect(args.verificado).toBe(true);
    expect(args.status_mp).toBe("approved");
  });
});

describe("🔴 G-01 — a verificação é REVERSÍVEL: clique errado não acusa para sempre", () => {
  it("20 — verificado, a tela diz o que foi conferido, quando, e oferece desfazer", () => {
    verificacaoAtual = {
      caso_id: "uuid-do-caso",
      verificado_no_mp: true,
      status_mp_verificado: "charged_back",
      verificado_em: "2026-09-04",
    };
    abrir({ ...AUSENCIA, motivo: "fora_do_escopo", fila: "nenhuma" });

    expect(
      screen.getByText(/Conferido em 04\/09\/2026: contestação de cartão do comprador/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: ROTULO_DESFAZER })).toBeTruthy();
    // Registrar de novo por cima não existe: primeiro desfaz, depois registra.
    expect(screen.queryByRole("button", { name: ROTULO_CONFERIR })).toBeNull();
  });

  it("21 — desfazer grava a reversão SEM status: desfazer é apagar, não afirmar outra coisa", () => {
    verificacaoAtual = {
      caso_id: "uuid-do-caso",
      verificado_no_mp: true,
      status_mp_verificado: "approved",
      verificado_em: "2026-09-04",
    };
    abrir({ ...AUSENCIA, motivo: "sem_repasse_confirmado", acionavel: true });

    fireEvent.click(screen.getByRole("button", { name: ROTULO_DESFAZER }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar$/i }));

    expect(registrarVerificacao).toHaveBeenCalledTimes(1);
    const args = registrarVerificacao.mock.calls[0][0];
    expect(args.verificado).toBe(false);
    expect(args.status_mp ?? null).toBeNull();
  });

  it("22 — 🔴 a confirmação de desfazer NÃO promete irreversibilidade", () => {
    // As três confirmações de desfecho dizem "não pode ser desfeito", e é
    // verdade. Copiar essa frase aqui seria mentir sobre a única ação da tela
    // que É reversível — e mentira de confirmação treina o usuário a não ler.
    verificacaoAtual = {
      caso_id: "uuid-do-caso",
      verificado_no_mp: true,
      status_mp_verificado: "approved",
      verificado_em: "2026-09-04",
    };
    abrir({ ...AUSENCIA, motivo: "sem_repasse_confirmado", acionavel: true });
    fireEvent.click(screen.getByRole("button", { name: ROTULO_DESFAZER }));

    expect(screen.queryByText(/não pode ser desfeito/i)).toBeNull();
  });
});

describe("🔴 G-01 — o caminho existe SÓ onde a régua do banco o lê", () => {
  it("23 — `repasse_a_menor` não tem bloco de verificação: a régua dele é outra", () => {
    abrir({ tipo_caso: "repasse_a_menor", motivo: "regua_nao_liberada", acionavel: false });
    expect(screen.queryByRole("button", { name: ROTULO_CONFERIR })).toBeNull();
    expect(screen.queryByRole("button", { name: ROTULO_DESFAZER })).toBeNull();
  });

  it("24 — sem permissão de escrita não há botão de conferir", () => {
    podeEscrever = false;
    abrir(AUSENCIA);
    expect(screen.queryByRole("button", { name: ROTULO_CONFERIR })).toBeNull();
  });

  it("25 — caso já contestado não oferece conferência: ela mexeria embaixo de um desfecho", () => {
    abrir({ ...AUSENCIA, motivo: "sem_repasse_confirmado", acionavel: true, estado: "contestado" });
    expect(screen.queryByRole("button", { name: ROTULO_CONFERIR })).toBeNull();
    expect(screen.queryByRole("button", { name: ROTULO_DESFAZER })).toBeNull();
  });

  it("25b — pedido sem número não oferece conferência: não há o que abrir no painel do MP", () => {
    abrir({ ...AUSENCIA, ml_order_id: null });
    expect(screen.queryByRole("button", { name: ROTULO_CONFERIR })).toBeNull();
  });

  it("26 — 🔴 A CADEIA INTEIRA: verificado como `approved`, o caso vira acionável e ganha o desfecho", () => {
    // Este é o teste que a fase não tinha. A RPC re-deriva o motivo para
    // `sem_repasse_confirmado` e `acionavel` para verdadeiro; o portão que já
    // existia na Sheet abre sozinho. A chave não abre porta nova.
    verificacaoAtual = {
      caso_id: "uuid-do-caso",
      verificado_no_mp: true,
      status_mp_verificado: "approved",
      verificado_em: "2026-09-04",
    };
    abrir({
      ...AUSENCIA,
      motivo: "sem_repasse_confirmado",
      acionavel: true,
      fila: "ml",
      dias_restantes: 5,
    });

    expect(screen.getByRole("button", { name: /Marcar como contestado/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: ROTULO_DESFAZER })).toBeTruthy();
    expect(screen.queryByText(/ainda não é acionável/i)).toBeNull();
  });
});

// ============================================================================
// 239-01 — o slot do meio diz o que o número É
//
// 🔴 POR QUE ISTO É PORTÃO DE ÁRVORE, E NÃO GREP: o rótulo "Recebido" está
// escrito no arquivo nos dois casos — o que muda é qual ramo renderiza. Só a
// árvore acessível responde "o que este card mostra para uma linha de frete".
//
// A régua do frete compara a FICHA do anúncio com a FATURA do ML. Nenhum
// dinheiro entra nessa conta: o valor do meio é o que o ML COBROU. Chamá-lo de
// "Recebido" inverte o sinal da leitura — e agora que a migration deste plano
// faz o número aterrissar no slot (era nulo em 1.200 de 1.200), o rótulo errado
// deixaria de ser inofensivo e passaria a mentir 970 vezes.
// ============================================================================

describe("🔴 239-01 — no frete o slot do meio é cobrança, no dinheiro é recebimento", () => {
  const FRETE: Partial<CasoConciliacaoRow> = {
    tipo_caso: "frete_a_maior",
    motivo: "frete_sem_vigencia_na_venda",
    fila: "nenhuma",
    acionavel: false,
    esperado_nosso: null,
    recebido: 27.05,
    residuo_nosso: null,
    diferenca: null,
  };

  function abrirNossoErro(caso: Partial<CasoConciliacaoRow>) {
    render(
      <CasoNossoErroSheet
        caso={{ ...CASO, fila: "nosso", acionavel: false, ...caso } as CasoConciliacaoRow}
        ingestaoInicio="2026-01-28"
        onOpenChange={() => {}}
      />,
    );
  }

  it("27 — linha de frete: o slot do meio se chama 'Cobrado pelo ML', e 'Recebido' não aparece", () => {
    abrir(FRETE);
    expect(screen.getByRole("group", { name: "Cobrado pelo ML" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Recebido" })).toBeNull();
  });

  it("28 — o valor cobrado aparece no slot, não some por causa do rótulo novo", () => {
    abrir(FRETE);
    const slot = screen.getByRole("group", { name: "Cobrado pelo ML" });
    expect(slot.textContent).toContain("27,05");
  });

  it("29 — linha de dinheiro: o slot do meio continua 'Recebido'", () => {
    abrir({ tipo_caso: "repasse_a_menor" });
    expect(screen.getByRole("group", { name: "Recebido" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Cobrado pelo ML" })).toBeNull();
  });

  it("30 — o tipo em aberto usa o mesmo vocabulário de cobrança", () => {
    abrir({ ...FRETE, tipo_caso: "frete_em_aberto" });
    expect(screen.getByRole("group", { name: "Cobrado pelo ML" })).toBeTruthy();
  });

  it("31 — 🔴 a fila 'Nosso erro' também recebe linha de frete, e lá o rótulo vale igual", () => {
    // Carrinho (49) e frete sem cobrança registrada (14) saem com fila `nosso`:
    // 63 das 1.200 linhas de frete abrem NESTE sheet, não no outro.
    abrirNossoErro({ ...FRETE, motivo: "possivel_carrinho" });
    expect(screen.getByRole("group", { name: "Cobrado pelo ML" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Recebido" })).toBeNull();
  });

  it("32 — e no dinheiro daquela fila o rótulo do meio não muda", () => {
    abrirNossoErro({ tipo_caso: "repasse_a_menor", motivo: "divergencia_da_nossa_base" });
    expect(screen.getByRole("group", { name: "Recebido" })).toBeTruthy();
  });
});
