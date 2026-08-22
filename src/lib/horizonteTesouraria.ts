// ============================================================================
// horizonteTesouraria — Fase 230 Plano 02, Task 1 (CX-03)
//
// A janela da pergunta "vai faltar dinheiro?". Treze semanas é o padrão de
// tesouraria (o rolling 13-week cash forecast de Bragg e do material da AFP):
// é o horizonte em que uma decisão de caixa — prorrogar, antecipar, segurar
// compra — ainda cabe, e curto o bastante para a agenda de fornecedor já
// estar quase toda conhecida.
//
// 🔴 AMPLIAR A JANELA DA PERGUNTA NÃO AMPLIA A VALIDADE DA MEDIÇÃO. O pior
// caso continua publicado só até `ULTIMO_HORIZONTE_COMPARAVEL`
// (`src/hooks/useForecastErrorCurve.ts`), porque de D+10 em diante a projeção
// deixa de ler a agenda do Mercado Pago e passa a usar a média de 15 dias como
// piso — coisa que o backtest não modela (224-CURVA.md, C-02: a cobertura da
// agenda cai de 102,4% para 66,8% entre D+9 e D+10). Uma janela de 13 semanas
// com banda de 9 dias é assimétrica de propósito, e quem exibe a janela tem a
// obrigação de escrever a assimetria na tela.
//
// Existe como arquivo próprio porque a constante é lida por dois donos
// diferentes — a tabela de faltas e a página de fluxo de caixa. Duplicar o
// número é exatamente como as duas telas divergem sobre a mesma pergunta.
// ============================================================================

/** A janela da pergunta, em semanas. */
export const HORIZONTE_TESOURARIA_SEMANAS = 13;

/** A mesma janela em dias — derivada, nunca digitada duas vezes. */
export const HORIZONTE_TESOURARIA_DIAS = HORIZONTE_TESOURARIA_SEMANAS * 7;
