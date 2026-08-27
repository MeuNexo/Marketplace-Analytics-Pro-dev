// ============================================================================
// 233-02/233-04 — "Ao longo do tempo, quanto posso confiar?" (Wesley, 27/08/2026)
//
// 🔴 A confiança é do SALDO, medida contra o saldo que o Wesley DECLARA — não o
// `initial_balance` nem o valor que a tela exibe.
//
// 🔴 NENHUM LIMIAR DE TOLERÂNCIA e NENHUMA COR QUE SIGNIFIQUE "confiável". A
// escala é `100 − erro` e o corte é do Wesley — D-6 do 224-CONTEXT. A cor aqui é
// gradiente contínuo, não semáforo: semáforo é limiar disfarçado.
//
// ── 233-04 ──────────────────────────────────────────────────────────────────
// 🔴 O DEFEITO CORRIGIDO AQUI: a versão da 233-02 reduzia a lista aos pontos
// medidos ANTES de renderizar, e D+7..D+30 sumiam sem palavra. O cabeçalho já
// declarava a intenção certa — lacuna declarada, nunca zero — e o código cumpria
// só metade: não virava barra, mas também não era declarada. Somado à RPC, que
// só emitia horizonte com par, isso afirmava o que ninguém escreveu: *"o sistema
// só sabe prever 6 dias"*.
//
// 🔵 A ORDEM DO BLOCO É A DECISÃO, e ela vem da 230: veredito em texto primeiro
// (é ele que dispara ação), medidos depois, calendário por último. A parede densa
// que o Wesley rejeitou na 230 era uma tabela SEM veredito; o que ele pediu agora
// é ALCANCE — e alcance se entrega com uma frase de resumo mais uma faixa
// declarada, não com trinta colunas.
//
// 🔴 AS DUAS AUSÊNCIAS TÊM TEXTOS DIFERENTES, e a diferença importa:
//   idade da série     → *"ficam medíveis a partir de 28/08"*. É calendário, e o
//                        Wesley não precisa fazer nada.
//   falta de declaração→ *"sem declaração de saldo nesse dia"*. Aqui ele FAZ algo:
//                        corrigir o saldo cria o ponto.
//
// 🔴 D4 — enquanto houver UMA observação por horizonte, o bloco diz isso em
// palavras e não desenha nada que sugira tendência: sem linha ligando pontos, sem
// interpolação. O sobe-desce 66→50→78→93→95→85 é ruído com forma de curva, e
// afirmar que D+4 é mais confiável que D+1 é conclusão que uma observação não
// sustenta. Isso NÃO é limiar de tolerância — é declarar o tamanho da amostra.
//
// ⚠️ A CHAVE DE LISTA É O HORIZONTE, que existe em toda linha da faixa. Campo que
// pode vir nulo (as datas de alvo) nunca vira chave: com `strictNullChecks: false`
// o erro não aparece na compilação e o agrupamento quebra em silêncio
// (`feedback_garment_key_nulavel_react`).
// ============================================================================
import { Skeleton } from "@/components/ui/skeleton";
import { useConfiancaDoSaldo, type ConfiancaDoSaldoData } from "@/hooks/useConfiancaDoSaldo";
import type { EstadoDaConfianca, MotivoAusencia, PontoDeConfianca } from "@/lib/confiancaDoSaldo";

/** "2026-08-28" → "28/08". Fatiado à mão: `new Date` em ISO puro é UTC e o
 *  fuso local empurraria a data um dia para trás em quase todo o Brasil. */
const diaMes = (iso: string | null): string => {
  if (iso == null || iso.length < 10) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

/** A data em que a série começou, DEDUZIDA do que a RPC mandou: `medivel_em`
 *  é o primeiro snapshot mais o horizonte, então subtrair o horizonte devolve
 *  o primeiro snapshot. Nada de constante escrita à mão na tela. */
const inicioDaSerie = (medivelEm: string | null, horizonte: number): string | null => {
  if (medivelEm == null || medivelEm.length < 10) return null;
  const [a, m, d] = medivelEm.split("-").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(a, m - 1, d - horizonte)).toISOString().slice(0, 10);
};

const rotuloDaFaixa = (de: number, ate: number): string =>
  de === ate ? `D+${de}` : `D+${de} a D+${ate}`;

interface BlocoDeAusencia {
  estado: EstadoDaConfianca;
  de: number;
  ate: number;
  horizontes: number[];
  medivel_em: string | null;
  /** O motivo CRU que a RPC devolveu, sem tradução. Ele vai para o DOM em
   *  `data-motivo`: quando a tela for auditada, o que se lê é o que o banco
   *  disse — não a interpretação que o front deu a ele. */
  motivo_ausencia: MotivoAusencia | null;
}

/** Agrupa horizontes ausentes CONTÍGUOS e de mesmo estado numa faixa só. É o que
 *  evita as 24 barras vazias que a 230 rejeitaria. */
function agruparAusencias(pontos: PontoDeConfianca[]): Array<PontoDeConfianca | BlocoDeAusencia> {
  const saida: Array<PontoDeConfianca | BlocoDeAusencia> = [];
  let atual: BlocoDeAusencia | null = null;

  const fechar = () => {
    if (atual != null) saida.push(atual);
    atual = null;
  };

  for (const p of pontos) {
    if (p.estado === "medido") {
      fechar();
      saida.push(p);
      continue;
    }
    const contiguo = atual != null && atual.estado === p.estado && atual.ate + 1 === p.horizonte;
    if (!contiguo) fechar();
    if (atual == null) {
      atual = {
        estado: p.estado, de: p.horizonte, ate: p.horizonte,
        horizontes: [p.horizonte], medivel_em: p.medivel_em,
        motivo_ausencia: p.motivo_ausencia,
      };
    } else {
      atual.ate = p.horizonte;
      atual.horizontes.push(p.horizonte);
      // A data da faixa é a MAIS CEDO do grupo: é quando ela começa a abrir.
      if (atual.medivel_em == null || (p.medivel_em != null && p.medivel_em < atual.medivel_em)) {
        atual.medivel_em = atual.medivel_em ?? p.medivel_em;
      }
    }
  }
  fechar();
  return saida;
}

/**
 * O texto de cada ausência. ⚠️ `medivel_em` é a data mais CEDO em que o par
 * PODERIA existir — por isso "ficam medíveis a partir de", nunca "terão medição
 * em": a medição também depende de haver declaração naquele dia.
 */
function textoDaAusencia(bloco: BlocoDeAusencia): string {
  const faixa = rotuloDaFaixa(bloco.de, bloco.ate);
  const plural = bloco.de !== bloco.ate;

  if (bloco.estado === "serie_curta") {
    const inicio = inicioDaSerie(bloco.medivel_em, bloco.de);
    const quando = diaMes(bloco.medivel_em);
    const desde = inicio != null ? ` — a série de previsões congeladas começou em ${diaMes(inicio)}` : "";
    return `${faixa} ${plural ? "ficam medíveis" : "fica medível"} a partir de ${quando}${desde}.`;
  }
  if (bloco.estado === "sem_declaracao") {
    return `${faixa}: sem declaração de saldo nesse dia. Corrigir o saldo do dia cria o ponto.`;
  }
  if (bloco.estado === "sem_serie") {
    return `${faixa}: a série de previsões congeladas ainda não existe nesta conta.`;
  }
  return `${faixa}: o banco não devolveu este prazo — sem medição e sem motivo declarado.`;
}

/** O veredito. É ele que responde "até onde posso confiar" sem expandir nada. */
function textoDoVeredito(pontos: PontoDeConfianca[]): string {
  const medidos = pontos.filter((p) => p.estado === "medido" && p.confianca_pct != null);
  if (medidos.length === 0) {
    return (
      "Ainda não há confiança medida para nenhum prazo: nenhuma previsão congelada foi " +
      "confrontada contra um saldo declarado."
    );
  }
  const ultimo = medidos[medidos.length - 1];
  const pares = ultimo.n_pares;
  const base =
    `Há medição até D+${ultimo.horizonte} — ${Math.round(ultimo.confianca_pct as number)}% ` +
    `de confiança nesse prazo, sobre ${pares} ${pares === 1 ? "observação" : "observações"}.`;

  // 🔴 D4: uma observação por horizonte não sustenta a leitura de tendência.
  const raso = medidos.every((p) => p.n_pares <= 1);
  if (!raso) return base;
  return (
    `${base} Cada prazo tem uma observação só: o sobe-desce entre os dias ainda ` +
    `não é tendência, é a primeira leitura.`
  );
}

export interface CurvaDeConfiancaViewProps {
  data: ConfiancaDoSaldoData | null | undefined;
  isLoading?: boolean;
  error?: unknown;
}

/** A parte apresentacional: recebe tudo por props e por isso é testável por FORMA. */
export function CurvaDeConfiancaView({ data, isLoading, error }: CurvaDeConfiancaViewProps) {
  if (isLoading) return <Skeleton className="h-24 w-full" />;

  if (error) {
    return (
      <p className="text-xs text-destructive">
        Não foi possível carregar a confiança da previsão.
      </p>
    );
  }

  const pontos = data?.pontos ?? [];
  const blocos = agruparAusencias(pontos);
  const medidos = pontos.filter((p) => p.estado === "medido");

  return (
    <div className="space-y-2" data-curva-confianca>
      <div className="flex items-baseline justify-between gap-2">
        {/* 🔴 O rótulo diz a palavra SALDO. O card hospeda duas medidas — o erro
            das ENTRADAS e a confiança do SALDO — e um rótulo errado aqui produz
            a conclusão errada com precisão decimal. */}
        <span className="text-xs font-medium text-foreground">
          Confiança da previsão de saldo
        </span>
        <span className="text-[11px] text-muted-foreground">
          {/* 🔴 n SEMPRE ao lado do percentual: 84% sobre 2 pares não é a mesma
              afirmação que 84% sobre 50. */}
          {data?.totalPares ?? 0} {(data?.totalPares ?? 0) === 1 ? "par" : "pares"} ·{" "}
          {data?.diasDeSerie ?? 0} {(data?.diasDeSerie ?? 0) === 1 ? "dia" : "dias"} de série
        </span>
      </div>

      {/* ── 1. O VEREDITO, primeiro. É ele que dispara ação (régua da 230). ── */}
      <p
        data-testid="veredito-confianca"
        className="text-sm leading-snug text-foreground"
      >
        {textoDoVeredito(pontos)}
      </p>

      {/* ── 2. Os medidos, individualmente. ── */}
      {medidos.length > 0 && (
        <div className="flex items-end gap-1">
          {pontos
            .filter((p) => p.estado === "medido")
            .map((p) => {
              const pct = p.confianca_pct ?? 0;
              return (
                // A chave é o HORIZONTE — nunca uma data, que pode vir nula.
                <div
                  key={p.horizonte}
                  data-horizontes={String(p.horizonte)}
                  data-estado="medido"
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(pct)}%
                  </span>
                  <div
                    className="w-full rounded-sm bg-primary"
                    style={{
                      // Altura proporcional e opacidade contínua: sem semáforo,
                      // que seria limiar de tolerância disfarçado de cor.
                      height: `${Math.max(4, (pct / 100) * 48)}px`,
                      opacity: 0.35 + (pct / 100) * 0.65,
                    }}
                    title={`D+${p.horizonte}: ${pct}% de confiança · erro ${p.erro_pct}% · ${p.n_pares} par(es)`}
                  />
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    D+{p.horizonte}
                  </span>
                  <span className="text-[9px] tabular-nums text-muted-foreground/70">
                    n {p.n_pares}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {/* ── 3. As lacunas, DECLARADAS. Uma faixa por motivo, com a data quando o
             motivo é calendário. Nunca 24 barras vazias — altura zero LÊ como
             "confiança zero", e a 230 rejeitou a parede densa. ── */}
      {blocos.some((b) => !("confianca_pct" in b)) && (
        <div className="space-y-1 border-t border-border/40 pt-2">
          {blocos.map((b) => {
            if ("confianca_pct" in b) return null;
            const bloco = b as BlocoDeAusencia;
            return (
              <p
                key={bloco.de}
                data-horizontes={bloco.horizontes.join(",")}
                data-estado={bloco.estado}
                data-motivo={bloco.motivo_ausencia ?? undefined}
                className="text-[11px] leading-snug text-muted-foreground"
              >
                {textoDaAusencia(bloco)}
              </p>
            );
          })}
        </div>
      )}

      {data?.selo && (
        // 🔴 O selo diz a DIREÇÃO do viés. "Provisório" sozinho ensina a ler o
        // número como se fosse conservador — e ele é otimista.
        <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-500">
          ⚠️ {data.selo}
        </p>
      )}
    </div>
  );
}

/** O invólucro: liga o hook e entrega os dados à parte apresentacional. */
export function CurvaDeConfianca() {
  const { data, isLoading, error } = useConfiancaDoSaldo();
  return <CurvaDeConfiancaView data={data} isLoading={isLoading} error={error} />;
}
