// ============================================================================
// 225-12 — A PÁGINA RENDERIZA. Prova que faltava à fase inteira.
//
// 🔴 POR QUE ESTE ARQUIVO EXISTE. A fase 225 provou o DADO — censo de 438
// linhas, 26 pedidos recuperados, 38 compras fora do caixa, 16 funções
// recriadas — e nunca provou a TELA. `MLConciliacao.tsx` tem 925 linhas e
// zero teste que a monte. O Wesley cobrou exatamente isso em 04/09: as
// correções entraram e ninguém abriu a página.
//
// 🔴 O ESTADO AQUI É O ESTADO REAL, medido no banco em 04/09/2026 14h05 UTC
// como o usuário `ce8c797c…` (org Pé Vermeio), com `set local role
// authenticated` — não é um payload inventado para o teste passar. É o que a
// tela do Wesley recebe hoje:
//
//   acionaveis_n = 0        ← as duas réguas de acusação estão DESLIGADAS
//   a_verificar_n = 5       ← os sem repasse, aguardando verificação
//   vazamento_total = -34.731,58  ← NEGATIVO; não é dinheiro a cobrar
//   linhas_total = 2.550 · teto_da_lista = 1.000
//
// 🔴 O ESTADO DE FILA VAZIA É O QUE MAIS PRECISA DE TESTE, não o menos. Uma
// tela que só foi olhada com dado cheio quebra no dia em que a fila zera — e
// a fila desta tela nasceu zerada por decisão medida (D-225: os dois portões
// de acusação saíram desligados). Se `acionaveis_n = 0` produzisse tela
// branca, o Wesley concluiria que a página está quebrada, e estaria certo.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CasoConciliacaoRow, ConciliacaoResumoRow } from "@/hooks/useConciliacao";

// O caso VIVO medido em 04/09: pedido pago de 07/08, R$ 439,25, sem nenhum
// repasse, com cobrança do ML lançada, 2 dias para expirar a janela de 30.
const CASO_VIVO: Partial<CasoConciliacaoRow> = {
  caso_id: null,
  ml_order_id: "2000017817648050",
  tipo_caso: "repasse_ausente",
  fila: "ml",
  acionavel: false,
  motivo: "ausencia_a_verificar",
  estado: "aberto",
  titulo: "Chapéu Pralana Arena Felt Country Sertanejo Preto Aba 11 Preto - 3360 G - 59",
  sku: "12011598-PTO3360G",
  quantidade: 1,
  retido_de_fato: null,
  cobranca_declarada: 156.45,
  residuo_ml: null,
  esperado_nosso: 282.8,
  recebido: null,
  residuo_nosso: null,
  diferenca: 439.25,
  data_pedido: "2026-08-07",
  data_evento: "2026-08-07",
  dias_restantes: 2,
  n_pagamentos: 0,
  payment_ids: null,
  release_date_max: null,
  valor_estimado: false,
};

const RESUMO_VIVO: Partial<ConciliacaoResumoRow> = {
  casos_urgentes: 0,
  soma_urgente: 0,
  proximo_prazo_dias: null,
  acionaveis_n: 0,
  vazamento_total: -34731.58,
  sub_piso_n: 896,
  sub_piso_soma: -37919.09,
  nosso_erro_n: 134,
  nosso_erro_soma: -407.79,
  fora_escopo_n: 11,
  fora_escopo_soma: null,
  entradas_sem_origem_n: 11,
  entradas_sem_origem_soma: 6180.26,
  a_verificar_n: 5,
  a_verificar_soma: 2278.22,
  recuperado_total: 0,
  saidas_auditadas: true,
  ingestao_inicio: "2026-01-28",
  piso_materialidade: 5.0,
  acusar_valor_a_menor: false,
  dias_aguardando: 15,
  dias_ausente: 22,
  ultima_sync: "2026-09-04T12:00:40.99+00:00",
  linhas_total: 2550,
  teto_da_lista: 1000,
  valor_desconhecido_n: 1267,
};

const casosMock = vi.fn();
const resumoMock = vi.fn();

vi.mock("@/hooks/useConciliacao", () => ({
  useCasosConciliacao: (...args: unknown[]) => casosMock(...args),
  useConciliacaoResumo: (...args: unknown[]) => resumoMock(...args),
}));

// Os Sheets só montam com caso selecionado, mas o hook de escrita é chamado no
// corpo deles; mocamos para não exigir sessão nem rede.
// Mock PARCIAL de propósito: `importOriginal` preserva as constantes que a
// tela lê (TIPO_VERIFICAVEL, rótulos), e só a parte que fala com a rede é
// trocada. Mock total apagaria os exports e o teste reprovaria por causa do
// próprio teste — foi o que aconteceu na primeira corrida deste arquivo.
vi.mock("@/hooks/useCasoDesfecho", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCasoDesfecho: () => ({ marcarDesfecho: vi.fn(), podeEscrever: false, ocupado: false }),
}));
vi.mock("@/hooks/useVerificacaoMp", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVerificacaoMp: () => ({ data: null, isLoading: false, error: null }),
}));

import MLConciliacao from "../MLConciliacao";

function montar(linhas: Partial<CasoConciliacaoRow>[], resumo: Partial<ConciliacaoResumoRow> | null) {
  casosMock.mockReturnValue({
    data: { linhas, truncadoNoTeto: false, completoAtePrazo: true },
    isLoading: false,
    error: null,
  });
  resumoMock.mockReturnValue({ data: resumo, isLoading: false, error: null });
  return render(<MLConciliacao />);
}

describe("225-12 — /conciliacao renderiza com o estado real de 04/09/2026", () => {
  beforeEach(() => {
    casosMock.mockReset();
    resumoMock.mockReset();
  });

  it("monta a página inteira sem lançar, com a fila de ação vazia", () => {
    expect(() => montar([CASO_VIVO], RESUMO_VIVO)).not.toThrow();
    // O título da tela — se ele não está no DOM, nada está. É "Protetor do
    // caixa", o nome pelo qual o Wesley chama a tela, não o da rota.
    expect(screen.getByText("Protetor do caixa")).toBeTruthy();
    // A sinc que a tela mostra vem do resumo, não de um relógio local.
    expect(screen.getByText(/Última sinc:/i)).toBeTruthy();
  });

  it("o banner acima da dobra aparece MESMO sem caso urgente (D-225-16)", () => {
    montar([CASO_VIVO], RESUMO_VIVO);
    // A ausência de urgência tem que ser tão visível quanto a presença: é o
    // que torna "nenhum caso expira sem eu ter olhado" verificável.
    expect(screen.getByText(/Nenhum caso urgente hoje/i)).toBeTruthy();
  });

  it("vazamento NEGATIVO é rotulado como não-cobrável, não exibido como dívida", () => {
    montar([CASO_VIVO], RESUMO_VIVO);
    expect(screen.getByText(/negativo, não é dinheiro a cobrar/i)).toBeTruthy();
  });

  it("os 5 sem repasse aparecem como aguardando verificação, não somem", () => {
    montar([CASO_VIVO], RESUMO_VIVO);
    expect(screen.getByText(/5 sem repasse encontrado/i)).toBeTruthy();
  });

  it("resumo ausente não derruba a página — o pior estado possível", () => {
    // Se a RPC do resumo falhar, a tela ainda tem que montar. Sem este caso,
    // um erro de rede vira tela branca e o Wesley não sabe se é falta de caso
    // ou falta de página.
    expect(() => montar([], null)).not.toThrow();
  });
});
