// ============================================================================
// 🔴 PORTÃO — a tela diz que a fila está desligada E o que a ligaria
//
// O CEO, depois de usar /conciliacao em produção (04/09/2026):
//
//   "na página fala sobre a fila de repasse menor estar desligada… mas n vejo
//    onde ligar"
//
// Ele está certo, e a lacuna é de comunicação, não de funcionalidade. O aviso
// declarava o estado e parava ali: não dizia POR QUE, não dizia O QUE FALTA, e
// não dizia QUEM LIGA. Quem lê fica sabendo que existe um interruptor e sem
// saber onde ele está.
//
// 🔴 A correção NÃO é adicionar um interruptor. `acusar_valor_a_menor` é um
// PORTÃO DE EVIDÊNCIA, não uma preferência: ele só deve se mover quando a
// medição de aderência ao centavo melhorar. Um switch nesta tela transformaria
// uma decisão que precisa de prova numa que precisa de um clique. A tela
// EXPLICA; não oferece.
// ============================================================================
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilaDesligadaAviso } from "./FilaDesligadaAviso";

describe("🔴 PORTÃO — o aviso responde as três perguntas que faltavam", () => {
  /**
   * A procedência fica atrás de um disclosure — o padrão da casa, o mesmo de
   * `BlocoRecolhido`. Abrir aqui prova que ela é ALCANÇÁVEL: o rótulo do
   * gatilho é o que responde "onde eu vejo isso", e o conteúdo é o que
   * responde por quê / o que falta / quem liga.
   */
  function textoDoAviso() {
    render(<FilaDesligadaAviso acusarValorAMenor={false} />);
    const gatilho = screen.getByText(/o que falta para ligar e quem liga/i);
    fireEvent.click(gatilho);
    return document.body.textContent ?? "";
  }

  it("1 — POR QUE: nomeia a aderência ao centavo que reprovou a calibração", () => {
    expect(textoDoAviso()).toContain("55,3%");
  });

  it("2 — O QUE FALTA: a conta pende para o lado contrário ao da acusação", () => {
    const texto = textoDoAviso();
    // O vazamento líquido da janela é NEGATIVO enquanto o lado que acusaria
    // mostraria crédito a cobrar. Ligar a fila exibiria dinheiro a receber num
    // período que, no total, foi de perda.
    expect(texto, "o vazamento líquido medido").toContain("14.221,84");
    expect(texto, "o que o lado acusador mostraria").toContain("3.752,44");
  });

  it("3 — QUEM LIGA: a linha de configuração, no banco, e não esta tela", () => {
    const texto = textoDoAviso();
    expect(texto).toContain("acusar_valor_a_menor");
    expect(texto).toContain("conciliacao_config");
  });

  it("4 — nenhum interruptor é renderizado: é portão de evidência, não preferência", () => {
    render(<FilaDesligadaAviso acusarValorAMenor={false} />);
    expect(screen.queryByRole("switch"), "switch na tela").toBeNull();
    expect(screen.queryByRole("checkbox"), "checkbox na tela").toBeNull();
    // Um botão de disclosure é permitido (é o padrão da casa para procedência);
    // um botão que ESCREVE, não. O que se proíbe é o rótulo IMPERATIVO — o que
    // promete executar a ação —, não a palavra "ligar" dentro de uma frase
    // que explica quem liga e onde.
    for (const b of screen.queryAllByRole("button")) {
      expect(b.textContent ?? "", `botão prometendo ligar: ${b.textContent}`).not.toMatch(
        /^\s*(ligar|ativar|habilitar)\b/i,
      );
    }
  });
});

describe("o aviso só existe no estado que ele descreve", () => {
  it("5 — some quando a fila está LIGADA", () => {
    const { container } = render(<FilaDesligadaAviso acusarValorAMenor={true} />);
    expect(container.textContent).toBe("");
  });

  it("6 — some quando a régua é DESCONHECIDA — nulo não é `desligada`", () => {
    // A RPC devolve o campo como veio. Nulo é "não sei", e afirmar
    // "está desligada" sobre um não-sei é a classe de mentira que a fase mata.
    const { container } = render(<FilaDesligadaAviso acusarValorAMenor={null} />);
    expect(container.textContent).toBe("");
  });
});
