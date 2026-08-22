// ============================================================================
// frasePrevisao — Fase 230 Plano 02, Task 1 (CX-05)
//
// Reduz a curva de erro do backtest a UMA frase: até que dia confiar na
// previsão, e de quanto ela costuma errar. Módulo puro — sem React, sem rede,
// sem date-fns. Quem exibe (`ForecastErrorCard`) recebe o resultado já
// decidido e nunca monta texto por conta própria, no mesmo desenho de
// `seloPromo.ts` → `SeloPromo.tsx`.
//
// 🔴 NENHUM PERCENTUAL DE VIÉS ESCRITO À MÃO. O número sai do `fator` da curva
// medida. A frase que o Wesley leu na conversa de 21/08 trazia um percentual
// ilustrativo; o valor real muda quando a amostra cresce, e um literal aqui
// congelaria uma medição de um dia como se fosse a régua.
//
// 🔴 A FRASE FALA DE ENTRADAS, E DIZ A PALAVRA. Entradas e saídas erram em
// direções opostas — as entradas superestimam no curto prazo, as saídas
// subestimam 2 a 3% de ponta a ponta — e somadas produzem um saldo
// aparentemente quase certo que está errado dos dois lados (224-CURVA.md,
// resposta 3). Uma frase que dissesse "a previsão erra X%" sem qualificar o
// escopo reintroduziria exatamente esse número proibido.
//
// 🔴 O SINAL VEM DO FATOR, NUNCA DO ARREDONDAMENTO. Um viés de −0,2% arredonda
// para zero, e escrever "0%" ali trocaria uma direção medida por um zero que
// ninguém mediu. Abaixo do dígito exibível a frase diz "menos de 1%" e mantém
// a direção.
//
// 🔴 FATOR IGUAL A 1 NÃO É "ERRO ZERO". O viés é razão de somas: ele não mede
// dispersão. Uma previsão que erra R$ 10 mil para cima num dia e R$ 10 mil
// para baixo no outro tem fator 1 e erro grande nos dois dias.
//
// Ausência sempre nomeada, nunca zero mudo — a regra da casa de
// `rebateLinhaCenarios.ts` (`fraseMotivoSemRebate`).
// ============================================================================

import { type PontoDaCurva } from "./forecastErrorCurve";

export type EstadoFrase = "medido" | "provisorio" | "nao_medido";

export interface FrasePrevisao {
  estado: EstadoFrase;
  /** O horizonte que a frase descreve, em dias. */
  horizonte: number;
  /** Viés em pontos percentuais (`fator` − 1). Positivo = a agenda prometeu a mais. Null é não medido. */
  viesPct: number | null;
  /** Quantos pares (corte, alvo) sustentam o número. Zero quando não há ponto. */
  n: number;
  /** A frase que vai para a tela. */
  texto: string;
  /** O tooltip: o que não cabe na frase, e sempre nomeia o motivo real. */
  titulo: string;
}

export interface EntradaFrasePrevisao {
  /** A curva de ENTRADAS, variante corrigida (look-ahead des-aplicado). */
  curvaEntradas: PontoDaCurva[];
  /** Até que dia a banda descreve a projeção da tela — `ULTIMO_HORIZONTE_COMPARAVEL`. */
  horizonteLimite: number;
  /** Piso de amostra para o ponto deixar de ser provisório — `N_MINIMO_PARA_PUBLICAR`. */
  nMinimo: number;
}

/**
 * O menor dígito que o arredondamento em ponto percentual inteiro consegue
 * mostrar. Abaixo dele não existe número a exibir — existe uma direção.
 * Não é limiar de tolerância: é a precisão da própria exibição.
 */
const PISO_EXIBIVEL_PP = 1;

/** O rodapé do tooltip: o que a curva é, e por que ela erra para baixo. */
const PROCEDENCIA =
  "A curva é reconstruída do histórico e provisória: ela subestima o erro, " +
  "porque estorno parcial sobrescreve o valor sem deixar vestígio e o Mercado " +
  "Pago remaneja datas sem guardar histórico. Acima de 1 a agenda prometeu a " +
  "mais do que entrou; abaixo de 1, a menos.";

function ausente(horizonte: number, texto: string, titulo: string): FrasePrevisao {
  return { estado: "nao_medido", horizonte, viesPct: null, n: 0, texto, titulo };
}

/** O trecho de desvio, já com o sinal preservado fora do arredondamento. */
function trechoDesvio(viesPct: number): string {
  const direcao = viesPct > 0 ? "a mais" : "a menos";
  const magnitude = Math.round(Math.abs(viesPct));
  return magnitude < PISO_EXIBIVEL_PP
    ? `promete ${direcao} do que entra, por menos de ${PISO_EXIBIVEL_PP}%`
    : `costuma prometer ${magnitude}% ${direcao} do que de fato entra`;
}

/**
 * Reduz a curva de erro a uma frase. Nunca lança: entrada nula, curva vazia e
 * horizonte não observado são estados nomeados, não exceções.
 */
export function resolveFrasePrevisao(entrada: EntradaFrasePrevisao): FrasePrevisao {
  const horizonte = entrada?.horizonteLimite ?? 0;
  const curva = entrada?.curvaEntradas;

  if (curva == null || !Array.isArray(curva) || curva.length === 0) {
    return ausente(
      horizonte,
      "Ainda não há histórico de erro da previsão de entradas nesta conta — o backtest " +
        "precisa de dias de agenda já vencidos para comparar o previsto com o realizado.",
      "Nenhum par (corte, alvo) foi observado. Isso não é erro de leitura nem previsão " +
        "perfeita: é ausência de amostra, e ela some sozinha conforme os dias vencem.",
    );
  }

  const ponto = curva.find((p) => p != null && p.horizonte === horizonte) ?? null;

  if (ponto == null) {
    return ausente(
      horizonte,
      `A margem de erro da previsão de entradas não foi medida no dia ${horizonte}: o ` +
        "backtest não tem par observado nesse horizonte.",
      "O horizonte existe na régua da tela, mas não na curva medida. Nenhum percentual é " +
        "publicado aqui, porque não há número medido a publicar. " +
        PROCEDENCIA,
    );
  }

  const fator = ponto.fator;
  if (fator == null || typeof fator !== "number" || !Number.isFinite(fator)) {
    return ausente(
      horizonte,
      `A margem de erro da previsão de entradas não foi medida no dia ${horizonte}: houve ` +
        "pares observados, mas nada entrou no período para servir de comparação.",
      `Pares observados: ${ponto.n ?? 0}. Sem realizado no denominador o viés não existe — ` +
        "e ausência de medição jamais é publicada como acerto. " +
        PROCEDENCIA,
    );
  }

  const viesPct = (fator - 1) * 100;
  const n = ponto.n ?? 0;
  const nMinimo = entrada?.nMinimo ?? 0;
  const provisorio = n < nMinimo;

  const abertura = `Confie até o dia ${horizonte}.`;
  const corpo =
    fator === 1
      ? "A previsão de entradas não mostra viés sistemático medido — o que não quer dizer " +
        "que ela acerte todo dia."
      : `A previsão de entradas ${trechoDesvio(viesPct)}.`;

  const texto = provisorio
    ? `${abertura} ${corpo} Amostra pequena: o número ainda vai mudar.`
    : `${abertura} ${corpo}`;

  const sustentacao = provisorio
    ? `Medido sobre ${n} pares (corte, alvo) em D+${horizonte} — menos que os ${nMinimo} ` +
      "observações do mínimo para publicar, então o ponto sai marcado."
    : `Medido sobre ${n} pares (corte, alvo) do backtest de entradas em D+${horizonte}.`;

  return {
    estado: provisorio ? "provisorio" : "medido",
    horizonte,
    viesPct,
    n,
    texto,
    titulo: `${sustentacao} ${PROCEDENCIA}`,
  };
}
