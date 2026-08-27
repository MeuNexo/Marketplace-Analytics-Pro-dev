// ============================================================================
// 233-07 Task 3 — o portão do D-14: os três avisos que NÃO colapsam
//
// 🔴 A LISTA (233-TEXTO.md, "Os avisos que NÃO podem colapsar"): três avisos
// são obrigatórios e varridos por `data-aviso`. Sem eles a página volta a
// mentir com número grande:
//
//   `card-vs-grafico`  — `SaldoAgoraCard` — sem ele, 37.430,00 (card) e
//                         33.758,27 (gráfico) aparecem juntos sem ninguém
//                         saber qual é qual (D-11; o 233-05/06 gastaram duas
//                         ondas resolvendo).
//   `vies-provisorio`  — `CurvaDeConfianca` — "provisório" sozinho ensina a
//                         ler o número como conservador, e ele é otimista.
//   `fronteira-agenda` — `SaldoEConfiancaPorDia` — sem ele a tabela publica
//                         −R$ 68 mil em 15/09 como previsão, quando é a
//                         RECEITA sumindo do cálculo (M-10).
//
// 🔴 O TESTE RENDERIZA CADA COMPONENTE NO ESTADO INICIAL, sem clicar em nada,
// e afirma que os três marcadores estão no DOM. É a forma que exprime
// "visível sem clique": um `Collapsible` do Radix DESMONTA o conteúdo
// fechado — um aviso empurrado para dentro dele some da árvore e a asserção
// reprova.
//
// 🔴 O MARCADOR É ATRIBUTO DE DADO, NÃO O TEXTO: uma revisão de redação não
// pode derrubar o portão, e mover o bloco para dentro do expansor tem que
// derrubar. Este arquivo prova a PRESENÇA; a prova de que o portão REPROVA
// quando o defeito volta foi feita por MUTAÇÃO manual durante o
// desenvolvimento (mover um dos três avisos para dentro de um
// `CollapsibleContent` fechado, rodar a suíte, confirmar vermelho, desfazer)
// — o resultado dos dois lados está registrado no SUMMARY do plano
// (233-03 ensinou que teste que só prova que o texto existe não protege
// nada).
//
// Usa as partes APRESENTACIONAIS (`*View`) — mesmo padrão de
// `CurvaDeConfiancaView`/`SaldoEConfiancaPorDiaView`: sem `QueryClientProvider`,
// sem mocar rede.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SaldoAgoraCardView } from "../SaldoAgoraCard";
import { CurvaDeConfiancaView } from "../CurvaDeConfianca";
import { SaldoEConfiancaPorDiaView } from "../SaldoEConfiancaPorDia";
import type { TodayBalanceData } from "@/hooks/useTodayBalance";
import type { ConfiancaDoSaldoData } from "@/hooks/useConfiancaDoSaldo";
import type { PontoDeConfianca } from "@/lib/confiancaDoSaldo";

const SALDO_DE_HOJE: TodayBalanceData = {
  saldo_inicial: 33_758.27,
  entradas_hoje: 5_000,
  saidas_hoje: 1_328.27,
  saldo_final_previsto: 37_430,
  saldo_agora: 37_430,
  entradas_liquidadas: 5_000,
  saidas_pagas: 1_328.27,
  entradas_pendentes: 0,
  saidas_canceladas: 0,
  entradas_estado_desconhecido: 0,
  saidas_estado_desconhecido: 0,
};

const CONFIANCA_COM_SELO: ConfiancaDoSaldoData = {
  pontos: Array.from({ length: 30 }, (_, i) => ({
    horizonte: i + 1,
    confianca_pct: null,
    erro_pct: null,
    n_pares: 0,
    estado: "nao_medido",
    primeiro_alvo: null,
    ultimo_alvo: null,
    motivo_ausencia: null,
    medivel_em: null,
  })) as PontoDeConfianca[],
  melhor: null,
  pior: null,
  totalPares: 0,
  diasDeSerie: 1,
  selo: "Amostra provisória: 6 pares observados em 1 dia de série. O número real tende a ser PIOR, não melhor.",
};

describe("🔴 Os três avisos que NÃO colapsam (233-07 Task 3, D-14)", () => {
  it("`card-vs-grafico` — SaldoAgoraCard, sem clicar em nada", () => {
    const { container } = render(<SaldoAgoraCardView data={SALDO_DE_HOJE} />);
    const aviso = container.querySelector('[data-aviso="card-vs-grafico"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toMatch(/gráfico/);
    expect(aviso?.textContent).toMatch(/abertura do dia/);
  });

  it("`vies-provisorio` — CurvaDeConfianca, sem clicar em nada", () => {
    const { container } = render(<CurvaDeConfiancaView data={CONFIANCA_COM_SELO} />);
    const aviso = container.querySelector('[data-aviso="vies-provisorio"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toMatch(/PIOR/);
  });

  it("`fronteira-agenda` — SaldoEConfiancaPorDia, sem clicar em nada", () => {
    const { container } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={[]} hoje="2026-08-27" />,
    );
    const aviso = container.querySelector('[data-aviso="fronteira-agenda"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toMatch(/não enxerga mais/);
  });

  it("os TRÊS aparecem juntos, na mesma passada — nenhum depende de abrir o outro", () => {
    const { container: c1 } = render(<SaldoAgoraCardView data={SALDO_DE_HOJE} />);
    const { container: c2 } = render(<CurvaDeConfiancaView data={CONFIANCA_COM_SELO} />);
    const { container: c3 } = render(
      <SaldoEConfiancaPorDiaView serie={[]} pontos={[]} hoje="2026-08-27" />,
    );
    const encontrados = [
      c1.querySelector('[data-aviso="card-vs-grafico"]'),
      c2.querySelector('[data-aviso="vies-provisorio"]'),
      c3.querySelector('[data-aviso="fronteira-agenda"]'),
    ];
    expect(encontrados.every((el) => el != null)).toBe(true);
  });
});
