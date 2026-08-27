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
//
// ── 233-04 ──────────────────────────────────────────────────────────────────
// 🔴 SÃO DUAS ESCASSEZES DIFERENTES, e a tela precisa distingui-las por NOME:
//
//   `serie_curta`    — a série de snapshots começou em 21/08/2026, então D+7 só
//                      é medível a partir de 28/08. É CALENDÁRIO, e ele carrega
//                      a data em que abre. Ninguém precisa fazer nada.
//   `sem_declaracao` — a série já alcançou o prazo, mas não houve declaração de
//                      saldo naquele dia. NÃO tem data: esperar não resolve —
//                      declarar resolve. É o gancho direto para o 233-03.
//   `sem_serie`      — a organização não tem snapshot nenhum de `saldo_projetado`.
//
// Confundir as duas primeiras faz a tela mentir sobre o que destrava a medição.
//
// ⚠️ `medivel_em` é a data mais CEDO em que o par PODERIA existir. Não é promessa
// de que ele vai existir: também depende de haver declaração naquele dia.
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

/**
 * 🔴 Os motivos vêm da RPC, que é quem sabe a data do primeiro snapshot e se há
 * declaração. O front NÃO recalcula calendário: ele nomeia o que recebeu.
 */
export type MotivoAusencia = "serie_curta" | "sem_declaracao" | "sem_serie";

const MOTIVOS: readonly MotivoAusencia[] = ["serie_curta", "sem_declaracao", "sem_serie"] as const;

export type EstadoDaConfianca =
  | "medido"
  | "amostra_insuficiente"
  | MotivoAusencia
  /** A RPC não disse nada sobre este horizonte — inclusive quando ela o OMITIU
   *  e `preencherFaixa` o trouxe de volta. Ausência sem motivo continua sendo
   *  ausência declarada; nunca vira 0%. */
  | "nao_medido";

export interface PontoDeConfianca {
  horizonte: number;
  /** `null` sempre que o estado não for `medido`. Nunca 0 por omissão. */
  confianca_pct: number | null;
  erro_pct: number | null;
  n_pares: number;
  estado: EstadoDaConfianca;
  primeiro_alvo: string | null;
  ultimo_alvo: string | null;
  /** Nulo em todo ponto medido, e nulo também quando esperar não resolve. */
  motivo_ausencia: MotivoAusencia | null;
  /** Só existe para `serie_curta`: a data mais cedo em que o par pode nascer. */
  medivel_em: string | null;
}

export interface LinhaRpcConfianca {
  horizon_days: number | string;
  n_pares: number | string;
  erro_pct: number | string | null;
  confianca_pct: number | string | null;
  primeiro_alvo?: string | null;
  ultimo_alvo?: string | null;
  motivo_ausencia?: string | null;
  medivel_em?: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Motivo fora do contrato NÃO vira estado inventado — vira ausência sem nome. */
const motivoDe = (v: unknown): MotivoAusencia | null =>
  typeof v === "string" && (MOTIVOS as readonly string[]).includes(v) ? (v as MotivoAusencia) : null;

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

      const motivo = motivoDe(l.motivo_ausencia);

      if (n <= 0 || erro == null || conf == null) {
        return {
          horizonte, confianca_pct: null, erro_pct: null, n_pares: n,
          // O motivo da RPC É o estado. Sem motivo reconhecido, `nao_medido`.
          estado: motivo ?? "nao_medido",
          primeiro_alvo: l.primeiro_alvo ?? null, ultimo_alvo: l.ultimo_alvo ?? null,
          motivo_ausencia: motivo,
          // Só `serie_curta` tem data: nas outras duas, esperar não resolve.
          medivel_em: motivo === "serie_curta" ? (l.medivel_em ?? null) : null,
        };
      }
      if (n < N_MINIMO_PARA_PUBLICAR) {
        return {
          horizonte, confianca_pct: null, erro_pct: erro, n_pares: n,
          estado: "amostra_insuficiente",
          primeiro_alvo: l.primeiro_alvo ?? null, ultimo_alvo: l.ultimo_alvo ?? null,
          motivo_ausencia: null, medivel_em: null,
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
        // Horizonte com par ignora motivo, venha ele ou não da RPC.
        motivo_ausencia: null,
        medivel_em: null,
      };
    })
    .sort((a, b) => a.horizonte - b.horizonte);
}

/**
 * 🔴 CINTO E SUSPENSÓRIO DECLARADOS (233-04).
 *
 * Devolve SEMPRE `max − min + 1` pontos, para qualquer entrada. Horizonte que a
 * RPC omitir volta como `nao_medido` — some, nunca.
 *
 * O motivo de isto existir tem data: até 27/08/2026 a RPC só emitia horizonte
 * COM par e a tela descartava o resto, e as duas coisas somadas afirmavam o que
 * ninguém escreveu — *"o sistema só sabe prever 6 dias"*. Mesmo depois de a RPC
 * passar a emitir a faixa inteira, esta função garante que uma regressão no
 * banco não volte a encolher a tela em silêncio.
 *
 * A chave é o HORIZONTE, que existe em toda linha da faixa. Campo que pode vir
 * nulo (as datas de alvo) nunca vira chave: com `strictNullChecks: false` o erro
 * não aparece na compilação e o agrupamento quebra sem aviso.
 */
export function preencherFaixa(
  pontos: PontoDeConfianca[] | null | undefined,
  minimo: number,
  maximo: number,
): PontoDeConfianca[] {
  if (!Number.isFinite(minimo) || !Number.isFinite(maximo) || maximo < minimo) return [];

  const porHorizonte = new Map<number, PontoDeConfianca>();
  for (const p of pontos ?? []) {
    if (p == null) continue;
    // Horizonte fora da faixa pedida é descartado: ele não pode empurrar o
    // tamanho da saída, ou o tamanho deixaria de ser a faixa.
    if (p.horizonte < minimo || p.horizonte > maximo) continue;
    porHorizonte.set(p.horizonte, p);
  }

  const cheia: PontoDeConfianca[] = [];
  for (let h = minimo; h <= maximo; h += 1) {
    cheia.push(
      porHorizonte.get(h) ?? {
        horizonte: h,
        confianca_pct: null,
        erro_pct: null,
        n_pares: 0,
        estado: "nao_medido",
        primeiro_alvo: null,
        ultimo_alvo: null,
        motivo_ausencia: null,
        medivel_em: null,
      },
    );
  }
  return cheia;
}

/**
 * O resumo que vira frase. Devolve o horizonte MAIS LONGO cuja confiança ainda
 * está acima da do dia seguinte — ou seja, onde a curva começa a desandar.
 *
 * ⚠️ Isto NÃO é um limiar de tolerância: não há "acima de X é confiável". É a
 * descrição da forma da curva medida, e a leitura do que fazer com ela é do
 * Wesley (D-6 do 224).
 */
// ── 233-07 ──────────────────────────────────────────────────────────────────
// 🔴 EXTRAÍDO de `CurvaDeConfianca.tsx` (233-04), SEM mudar nenhuma frase — é
// a mesma régua da tabela `SaldoEConfiancaPorDia`: uma segunda implementação
// do texto de ausência divergiria da primeira, e a divergência apareceria
// como frase errada na tela, não como erro. Ver `233-TEXTO.md`.

/** "2026-08-28" → "28/08". Fatiado à mão: `new Date` em ISO puro é UTC e o
 *  fuso local empurraria a data um dia para trás em quase todo o Brasil. */
function diaMes(iso: string | null): string {
  if (iso == null || iso.length < 10) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** A data em que a série começou, DEDUZIDA do que a RPC mandou: `medivel_em`
 *  é o primeiro snapshot mais o horizonte, então subtrair o horizonte devolve
 *  o primeiro snapshot. Nada de constante escrita à mão na tela. */
function inicioDaSerie(medivelEm: string | null, horizonte: number): string | null {
  if (medivelEm == null || medivelEm.length < 10) return null;
  const [a, m, d] = medivelEm.split("-").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(a, m - 1, d - horizonte)).toISOString().slice(0, 10);
}

function rotuloDaFaixa(de: number, ate: number): string {
  return de === ate ? `D+${de}` : `D+${de} a D+${ate}`;
}

export interface ParametrosTextoDaAusencia {
  estado: EstadoDaConfianca;
  de: number;
  ate: number;
  medivel_em: string | null;
}

/**
 * O texto de uma ausência (ou faixa contígua de ausências), por estado.
 * ⚠️ `medivel_em` é a data mais CEDO em que o par PODERIA existir — por isso
 * "ficam medíveis a partir de", nunca "terão medição em": a medição também
 * depende de haver declaração naquele dia.
 */
export function textoDaAusencia({ estado, de, ate, medivel_em }: ParametrosTextoDaAusencia): string {
  const faixa = rotuloDaFaixa(de, ate);
  const plural = de !== ate;

  if (estado === "serie_curta") {
    const inicio = inicioDaSerie(medivel_em, de);
    const quando = diaMes(medivel_em);
    const desde = inicio != null ? ` — a série de previsões congeladas começou em ${diaMes(inicio)}` : "";
    return `${faixa} ${plural ? "ficam medíveis" : "fica medível"} a partir de ${quando}${desde}.`;
  }
  if (estado === "sem_declaracao") {
    return `${faixa}: sem declaração de saldo nesse dia. Corrigir o saldo do dia cria o ponto.`;
  }
  if (estado === "sem_serie") {
    return `${faixa}: a série de previsões congeladas ainda não existe nesta conta.`;
  }
  return `${faixa}: o banco não devolveu este prazo — sem medição e sem motivo declarado.`;
}

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
