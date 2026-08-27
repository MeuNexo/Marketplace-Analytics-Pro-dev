// ============================================================================
// 233-02 — Confiança da previsão de SALDO, de 0 a 100%
//
// 🔴 A MEDIDA É SOBRE O SALDO, e isso é decisão do Wesley (27/08/2026):
// *"a margem de erro eu quero sobre o fluxo de caixa diário, o saldo"*.
//
// ⚠️ Isto NÃO viola a regra da Fase 224. Lá se proíbe COMBINAR as margens de erro
// de entradas e saídas num número — somadas, elas se cancelam NO CÁLCULO e
// produzem um saldo que parece quase certo e está errado dos dois lados
// (224-CURVA.md, resposta 3). Aqui o erro do saldo é medido DIRETAMENTE: previsto
// congelado contra o saldo declarado. O cancelamento, se houver, aconteceu na
// REALIDADE — e é exatamente isso que precisa ser sabido.
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA. A escala é `100 − erro` e nada além disso. O
// corte entre "confiável" e "não confiável" é do Wesley e ele não o deu — D-6 do
// 224-CONTEXT.
//
// 🔴 SEM AMOSTRA, A RESPOSTA É `nao_medido` — nunca 0%, que diria "erra tudo",
// nem 100%, que diria "é perfeita". Mesma régua de `frasePrevisao.ts` e do
// critério 4 na Fase 231.
// ============================================================================

/** Piso de pares para publicar um percentual. Herdado da régua da Fase 224. */
export const N_MINIMO_PARA_PUBLICAR = 1;

/**
 * 🔴 O horizonte 0 fica FORA por construção, e não é escolha estética.
 * O cron do snapshot roda às 04h; a declaração do saldo vem de tarde. O snapshot
 * do próprio dia declarado foi congelado ANTES da correção — compará-lo mediria
 * a CORREÇÃO, não a previsão (M-01 do 233-MEDICOES).
 */
export const HORIZONTE_MINIMO = 1;

export type EstadoDaConfianca = "medido" | "amostra_insuficiente" | "nao_medido";

export interface PontoDeConfianca {
  horizonte: number;
  /** `null` sempre que o estado não for `medido`. Nunca 0 por omissão. */
  confianca_pct: number | null;
  erro_pct: number | null;
  n_pares: number;
  estado: EstadoDaConfianca;
  primeiro_alvo: string | null;
  ultimo_alvo: string | null;
}

export interface LinhaRpcConfianca {
  horizon_days: number | string;
  n_pares: number | string;
  erro_pct: number | string | null;
  confianca_pct: number | string | null;
  primeiro_alvo?: string | null;
  ultimo_alvo?: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Converte as linhas da RPC em pontos da curva, com o estado nomeado.
 *
 * Nunca lança: entrada nula, lista vazia e horizonte sem par são estados, não
 * exceções — o mesmo contrato de `frasePrevisao.ts`.
 */
export function confiancaDoSaldo(linhas: LinhaRpcConfianca[] | null | undefined): PontoDeConfianca[] {
  if (linhas == null || !Array.isArray(linhas)) return [];

  return linhas
    .filter((l) => l != null)
    .map((l): PontoDeConfianca => {
      const horizonte = num(l.horizon_days) ?? 0;
      const n = num(l.n_pares) ?? 0;
      const erro = num(l.erro_pct);
      const conf = num(l.confianca_pct);

      if (n <= 0 || erro == null || conf == null) {
        return {
          horizonte, confianca_pct: null, erro_pct: null, n_pares: n,
          estado: "nao_medido",
          primeiro_alvo: l.primeiro_alvo ?? null, ultimo_alvo: l.ultimo_alvo ?? null,
        };
      }
      if (n < N_MINIMO_PARA_PUBLICAR) {
        return {
          horizonte, confianca_pct: null, erro_pct: erro, n_pares: n,
          estado: "amostra_insuficiente",
          primeiro_alvo: l.primeiro_alvo ?? null, ultimo_alvo: l.ultimo_alvo ?? null,
        };
      }
      return {
        // Piso em zero e teto em cem: erro de 150% vira confiança 0, nunca
        // negativa — e negativo na tela não significa nada para quem lê.
        horizonte,
        confianca_pct: Math.max(0, Math.min(100, conf)),
        erro_pct: erro,
        n_pares: n,
        estado: "medido",
        primeiro_alvo: l.primeiro_alvo ?? null,
        ultimo_alvo: l.ultimo_alvo ?? null,
      };
    })
    .sort((a, b) => a.horizonte - b.horizonte);
}

/**
 * O resumo que vira frase. Devolve o horizonte MAIS LONGO cuja confiança ainda
 * está acima da do dia seguinte — ou seja, onde a curva começa a desandar.
 *
 * ⚠️ Isto NÃO é um limiar de tolerância: não há "acima de X é confiável". É a
 * descrição da forma da curva medida, e a leitura do que fazer com ela é do
 * Wesley (D-6 do 224).
 */
export function resumoDaConfianca(pontos: PontoDeConfianca[]): {
  melhor: PontoDeConfianca | null;
  pior: PontoDeConfianca | null;
  n_horizontes_medidos: number;
  total_pares: number;
} {
  const medidos = (pontos ?? []).filter((p) => p.estado === "medido" && p.confianca_pct != null);
  if (medidos.length === 0) {
    return { melhor: null, pior: null, n_horizontes_medidos: 0, total_pares: 0 };
  }
  const ordenado = [...medidos].sort((a, b) => (b.confianca_pct ?? 0) - (a.confianca_pct ?? 0));
  return {
    melhor: ordenado[0],
    pior: ordenado[ordenado.length - 1],
    n_horizontes_medidos: medidos.length,
    total_pares: medidos.reduce((s, p) => s + p.n_pares, 0),
  };
}

/**
 * 🔴 O SELO DE PROVISÓRIO diz a DIREÇÃO do viés, não só que é provisório.
 *
 * Enquanto a série de declarações for curta, a curva é uma leitura de poucos
 * dias — e o 224 mediu que a amostra reconstruída SUBESTIMA o erro (estorno
 * parcial e remanejo de data não deixam vestígio). Um selo que diz "provisório"
 * sem dizer para que lado ensina a ler o número como se fosse conservador.
 */
export function seloDeProvisorio(totalPares: number, dias: number): string | null {
  if (totalPares >= 20 && dias >= 15) return null;
  return (
    `Amostra provisória: ${totalPares} ${totalPares === 1 ? "par observado" : "pares observados"} ` +
    `em ${dias} ${dias === 1 ? "dia" : "dias"} de série. O número real tende a ser PIOR, ` +
    `não melhor — a amostra curta subestima o erro.`
  );
}
