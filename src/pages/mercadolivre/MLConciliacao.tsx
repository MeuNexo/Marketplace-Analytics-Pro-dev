import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  Layers,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { CasoConciliacaoSheet } from "@/components/mercadolivre/CasoConciliacaoSheet";
import { CasoNossoErroSheet } from "@/components/mercadolivre/CasoNossoErroSheet";
import { FilaDesligadaAviso } from "@/components/mercadolivre/FilaDesligadaAviso";
import {
  useCasosConciliacao,
  useConciliacaoResumo,
  type CasoConciliacaoRow,
  type ConciliacaoResumoRow,
} from "@/hooks/useConciliacao";
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
  type TomUrgencia,
} from "@/lib/casoUrgencia";

// ============================================================================
// 225-03 — "Protetor do caixa": a tela onde o relógio fica visível
//
// 🔴 ESTA TELA É O ÚNICO CANAL. D-225-11: o Wesley recusou alerta no Telegram e
// aceitou o risco declarado. Com a janela de 30 dias de D-225-01 correndo a
// partir do EVENTO, um caso pode expirar sem ninguém ver. O banner acima da
// dobra é o preço dessa escolha — e por isso ele é renderizado SEMPRE, também
// quando não há caso urgente: "nenhum caso urgente hoje" é informação, e
// D-225-16 ("nenhum caso expira sem eu ter olhado") só é verificável se a
// ausência de urgência for tão visível quanto a presença.
//
// 🔴 NADA AQUI RECALCULA RÉGUA. Piso, dias restantes, fila, motivo e estado
// vêm prontos das duas RPCs da 225-02. A tela decide o que aparece primeiro,
// nunca quanto vale. Duas réguas para o mesmo número foi como o saldo quebrou
// na fase 233.
//
// 🔴 NULO NÃO É ZERO. `nosso_erro_soma` e `fora_escopo_soma` vêm NULOS da RPC
// quando não há valor mensurável — a onda 2 removeu o `coalesce` de propósito.
// Por isso esta página usa `valorEmReais` (que devolve "não apurado") e NUNCA
// `formatCurrency` (que devolve "R$ 0,00") em campo nulável.
// ============================================================================

// ─── Tom → classe. O módulo puro não conhece CSS; a tradução mora aqui. ─────

const CLASSE_BADGE: Record<TomUrgencia, string> = {
  destructive: "text-destructive bg-destructive/10 border-destructive/30",
  warning: "text-warning bg-warning/10 border-warning/30",
  neutro: "text-muted-foreground",
  expirado: "text-destructive/70 bg-transparent border-destructive/20",
};

const CLASSE_ESTADO: Record<string, string> = {
  neutro: "text-muted-foreground border-border",
  warning: "text-warning bg-warning/10 border-warning/30",
  success: "text-success bg-success/10 border-success/30",
  destructive: "text-destructive bg-destructive/10 border-destructive/30",
  expirado: "text-destructive/70 border-destructive/20",
};

/**
 * Urgente = acionável E dentro da faixa que pede atenção.
 * ⚠️ A faixa vem de `rotuloUrgencia`, não de um número escrito aqui: os dois
 * tons que a lib marca como atenção (`destructive` e `expirado`) são
 * exatamente os `dias_restantes <= 7` que a RPC usa em `casos_urgentes`.
 */
const TONS_URGENTES: TomUrgencia[] = ["destructive", "expirado"];

function ehUrgente(c: CasoConciliacaoRow): boolean {
  return !!c.acionavel && TONS_URGENTES.includes(rotuloUrgencia(c.dias_restantes).tom);
}

function BadgeUrgencia({ dias }: { dias: number | null }) {
  const r = rotuloUrgencia(dias);
  if (!r.badge) {
    // 🔴 15 dias ou mais não recebe badge colorido: 87,7% dos repasses liberam
    // em 7–14 dias, e cor no estado normal apaga o sinal dos dois estados que
    // realmente pedem atenção.
    return <span className={`text-xs ${CLASSE_BADGE[r.tom]} whitespace-nowrap`}>{r.texto}</span>;
  }
  return (
    <Badge
      variant="outline"
      className={`${CLASSE_BADGE[r.tom]} ${r.forte ? "font-bold" : ""} whitespace-nowrap gap-1`}
    >
      <Clock className="w-3 h-3" />
      {r.texto}
    </Badge>
  );
}

function BadgeEstado({ estado }: { estado: string | null }) {
  const r = rotuloEstado(estado);
  return (
    <Badge variant="outline" className={`${CLASSE_ESTADO[r.tom]} whitespace-nowrap text-xs`}>
      {r.texto}
    </Badge>
  );
}

// ─── O banner que substitui o Telegram recusado ─────────────────────────────

interface PropsBanner {
  carregando: boolean;
  erro: boolean;
  resumo: ConciliacaoResumoRow | null;
  maisUrgente: CasoConciliacaoRow | null;
  onVerUrgentes: () => void;
}

/**
 * 🔴 SEMPRE devolve um `Alert`. Nunca `null`, nunca atrás de um `&&` que o
 * suprima. É o substituto declarado do canal que o Wesley recusou.
 */
function BannerUrgencia({ carregando, erro, resumo, maisUrgente, onVerUrgentes }: PropsBanner) {
  if (erro) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Não foi possível verificar os prazos agora</AlertTitle>
        <AlertDescription className="text-sm">
          Esta tela é o único aviso de prazo que existe. Enquanto ela não carrega, nenhum caso
          está sendo vigiado — recarregue antes de fechar.
        </AlertDescription>
      </Alert>
    );
  }

  if (carregando || resumo == null) {
    return (
      <Alert>
        <RefreshCw className="h-4 w-4 animate-spin" />
        <AlertTitle>Verificando prazos</AlertTitle>
        <AlertDescription className="text-sm">
          Lendo os repasses da janela para saber o que expira esta semana.
        </AlertDescription>
      </Alert>
    );
  }

  const urgentes = resumo.casos_urgentes ?? 0;

  if (urgentes > 0) {
    const plural = urgentes > 1;
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle className="text-base font-semibold">
          {urgentes} caso{plural ? "s" : ""} expira{plural ? "m" : ""} em até 7 dias —{" "}
          {valorEmReais(resumo.soma_urgente)} em jogo
        </AlertTitle>
        <AlertDescription className="text-sm">
          {maisUrgente ? (
            <>
              O mais urgente: {maisUrgente.titulo ?? maisUrgente.ml_order_id ?? "sem título"} —{" "}
              {rotuloUrgencia(maisUrgente.dias_restantes).texto.toLowerCase()}.
            </>
          ) : (
            <>O caso mais urgente não está na página carregada — abra a fila para vê-lo.</>
          )}
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={onVerUrgentes}>
              Ver casos urgentes
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-success/30 bg-success/5">
      <CheckCircle2 className="h-4 w-4 text-success" />
      <AlertTitle className="text-base font-semibold">Nenhum caso urgente hoje</AlertTitle>
      <AlertDescription className="text-sm">
        {resumo.proximo_prazo_dias == null
          ? "Nenhum caso em aberto."
          : `O mais próximo do prazo expira em ${resumo.proximo_prazo_dias} dias.`}
      </AlertDescription>
    </Alert>
  );
}

// ─── Uma linha da fila, nas duas apresentações ──────────────────────────────

interface PropsLinha {
  caso: CasoConciliacaoRow;
  ingestaoInicio: string | null;
  /** A fila "Nosso erro" não tem prazo de ressarcimento — nem badge. */
  comPrazo: boolean;
  selecionado: boolean;
  onSelecionar: () => void;
}

function LinhaTabela({ caso, ingestaoInicio, comPrazo, selecionado, onSelecionar }: PropsLinha) {
  const acionavel = !!caso.acionavel;
  return (
    <tr
      onClick={onSelecionar}
      className={`cursor-pointer transition-colors ${
        selecionado ? "bg-muted/60" : "hover:bg-muted/40"
      }`}
    >
      <td className="px-4 py-3 max-w-[240px]">
        <div className="truncate text-sm">{caso.titulo ?? "Sem título"}</div>
        <div className="text-xs text-muted-foreground truncate">
          {caso.sku ?? caso.ml_order_id ?? "—"}
        </div>
      </td>
      <td className="px-3 py-3">
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {rotuloTipoCaso(caso.tipo_caso)}
        </Badge>
      </td>
      <td className="px-3 py-3 max-w-[280px]">
        <span className="text-xs text-muted-foreground line-clamp-2">
          {rotuloMotivo(caso.motivo, { ingestaoInicio })}
        </span>
      </td>
      {/* 🔴 Valor usa PESO, nunca cor. A cor desta tela é do prazo. */}
      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
        {valorEmReais(caso.diferenca)}
      </td>
      <td className="px-3 py-3">
        <BadgeEstado estado={caso.estado} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {comPrazo ? <BadgeUrgencia dias={caso.dias_restantes} /> : <span className="text-xs text-muted-foreground">—</span>}
        {comPrazo && !acionavel ? (
          <div className="text-[11px] text-muted-foreground mt-1">Sem ação liberada</div>
        ) : null}
      </td>
    </tr>
  );
}

function CardMobile({ caso, ingestaoInicio, comPrazo, selecionado, onSelecionar }: PropsLinha) {
  return (
    <button
      type="button"
      onClick={onSelecionar}
      className={`w-full text-left min-h-[44px] px-4 py-3 border-b border-border transition-colors ${
        selecionado ? "bg-muted/60" : "hover:bg-muted/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Ordem de leitura = ordem de prioridade: o prazo primeiro. */}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">{valorEmReais(caso.diferenca)}</div>
          <div className="text-sm truncate mt-0.5">{caso.titulo ?? "Sem título"}</div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[11px]">
              {rotuloTipoCaso(caso.tipo_caso)}
            </Badge>
            <BadgeEstado estado={caso.estado} />
          </div>
          <div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
            {rotuloMotivo(caso.motivo, { ingestaoInicio })}
          </div>
        </div>
        {comPrazo ? (
          <div className="shrink-0">
            <BadgeUrgencia dias={caso.dias_restantes} />
          </div>
        ) : null}
      </div>
    </button>
  );
}

interface PropsFila {
  casos: CasoConciliacaoRow[];
  ingestaoInicio: string | null;
  comPrazo: boolean;
  colunaPrazo: string;
  selecionado: string | null;
  onSelecionar: (c: CasoConciliacaoRow) => void;
}

function FilaDeCasos({
  casos,
  ingestaoInicio,
  comPrazo,
  colunaPrazo,
  selecionado,
  onSelecionar,
}: PropsFila) {
  return (
    <>
      {/* Desktop: tabela sem rolagem horizontal — ela esconderia justamente a
          coluna de dias restantes, que é o campo mais importante da tela. */}
      <div className="hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Produto</th>
              <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Tipo</th>
              <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Motivo</th>
              <th className="text-right px-3 py-3 text-xs text-muted-foreground font-medium">Diferença</th>
              <th className="text-left px-3 py-3 text-xs text-muted-foreground font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">{colunaPrazo}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {casos.map((c) => {
              const chave = chaveDeLista(c);
              return (
                <LinhaTabela
                  key={chave}
                  caso={c}
                  ingestaoInicio={ingestaoInicio}
                  comPrazo={comPrazo}
                  selecionado={selecionado === chave}
                  onSelecionar={() => onSelecionar(c)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards empilhados. O Wesley confere no celular. */}
      <div className="sm:hidden">
        {casos.map((c) => {
          const chave = chaveDeLista(c);
          return (
            <CardMobile
              key={chave}
              caso={c}
              ingestaoInicio={ingestaoInicio}
              comPrazo={comPrazo}
              selecionado={selecionado === chave}
              onSelecionar={() => onSelecionar(c)}
            />
          );
        })}
      </div>
    </>
  );
}

/** Bloco recolhido: aparece no total, não ocupa a atenção. */
function BlocoRecolhido({
  rotulo,
  explicacao,
  casos,
  ingestaoInicio,
}: {
  rotulo: string;
  explicacao: string;
  casos: CasoConciliacaoRow[];
  ingestaoInicio: string | null;
}) {
  if (casos.length === 0) return null;
  return (
    <Collapsible className="border-t border-border px-4 py-3">
      <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground text-left">
        {rotulo}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-xs text-muted-foreground mt-2 mb-2 max-w-2xl">{explicacao}</p>
        <div className="divide-y divide-border/60">
          {casos.map((c) => (
            <div
              key={chaveDeLista(c)}
              className="flex items-start justify-between gap-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate">{c.titulo ?? c.ml_order_id ?? "—"}</div>
                <div className="text-muted-foreground truncate">
                  {rotuloMotivo(c.motivo, { ingestaoInicio })}
                </div>
              </div>
              <div className="font-medium whitespace-nowrap">{valorEmReais(c.diferenca)}</div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── A página ───────────────────────────────────────────────────────────────

type FiltroEstado = "abertos" | "aberto" | "contestado" | "resolvido";

const SEM_CASOS: CasoConciliacaoRow[] = [];

const ESTADOS_RESOLVIDOS = ["ganho", "negado", "resolvido_sozinho", "expirado"];

export default function MLConciliacao() {
  // 🔴 A abertura lê só a primeira página — a que tem os casos com prazo
  // correndo. Eram 14 idas ao banco (≈15,1 s) para trazer 2.604 linhas, das
  // quais 1.241 são linhas de frete sem valor apurado. Ver `useConciliacao.ts`.
  const [listaCompleta, setListaCompleta] = useState(false);
  const casosQuery = useCasosConciliacao({ apenasAcionaveis: false, completo: listaCompleta });
  const resumoQuery = useConciliacaoResumo();

  const [fila, setFila] = useState<"ml" | "nosso">("ml");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("abertos");
  const [soUrgentes, setSoUrgentes] = useState(false);
  // 🔴 A seleção guarda a CHAVE, não o objeto. Guardar o objeto congelaria um
  // instantâneo: depois de marcar um desfecho, a invalidação refaz a leitura e
  // o Sheet continuaria mostrando o estado anterior — a tela diria "aberto"
  // sobre um caso que o banco já tem como contestado.
  const [chaveSelecionada, setChaveSelecionada] = useState<string | null>(null);

  const resumo = resumoQuery.data ?? null;
  // Referência estável: `?? []` cria um array novo a cada render e faria o
  // `useMemo` dos baldes recomputar sempre — 1.351 linhas reordenadas por
  // render enquanto a query não resolve.
  const linhas = casosQuery.data?.linhas ?? SEM_CASOS;
  const truncadoNoTeto = casosQuery.data?.truncadoNoTeto ?? false;
  // 🔴 Conferido pelo hook a cada leitura, não suposto: verdadeiro quando toda
  // linha COM prazo já está carregada. É a garantia de D-225-16 sobrevivendo à
  // leitura parcial — sem ele, "carregou menos" e "pode haver caso invisível"
  // seriam a mesma frase, e a tela gritaria sempre ou nunca.
  const prazoCoberto = casosQuery.data?.prazoCoberto ?? false;
  const listaJaCompleta = casosQuery.data?.completo ?? false;
  const carregando = casosQuery.isLoading || resumoQuery.isLoading;
  // `placeholderData` mantém a lista na tela enquanto o restante chega — o
  // indicador precisa vir do fetch, não do `isLoading`, que fica falso aí.
  const buscandoRestante = listaCompleta && !listaJaCompleta && casosQuery.isFetching;
  const erro = casosQuery.isError || resumoQuery.isError;
  const ingestaoInicio = resumo?.ingestao_inicio ?? null;
  const nuncaSincronizou = resumo != null && resumo.ultima_sync == null;

  const ultimaSync = useMemo(() => {
    if (!resumo?.ultima_sync) return null;
    const d = new Date(resumo.ultima_sync);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [resumo?.ultima_sync]);

  // ── Os baldes. A classificação é da RPC; aqui só se separa por ela. ───────
  const baldes = useMemo(() => {
    const ml: CasoConciliacaoRow[] = [];
    const nosso: CasoConciliacaoRow[] = [];
    const subPiso: CasoConciliacaoRow[] = [];
    const medidosSemAcao: CasoConciliacaoRow[] = [];

    for (const c of linhas) {
      if (c.motivo === "abaixo_do_piso") subPiso.push(c);
      else if (c.fila === "ml") ml.push(c);
      else if (c.fila === "nosso") nosso.push(c);
      else if (c.motivo !== "fora_do_escopo") medidosSemAcao.push(c);
    }

    return {
      ml: [...ml].sort(compararPorPrazo),
      // Erro nosso não tem prazo de ressarcimento — ordena por tamanho.
      nosso: [...nosso].sort(compararPorValor),
      subPiso: [...subPiso].sort(compararPorValor),
      medidosSemAcao: [...medidosSemAcao].sort(compararPorValor),
    };
  }, [linhas]);

  const maisUrgente = useMemo(() => baldes.ml.find(ehUrgente) ?? null, [baldes.ml]);

  // 🔴 `acharCasoSelecionado`, e não `find` por chave exata: `caso_id` NASCE no
  // meio da sessão. A primeira escrita em `conciliacao_casos` — a conferência
  // no Mercado Pago (225-07) ou o "marcar como contestado" — faz a RPC passar a
  // devolver o UUID, a chave da MESMA linha muda e o painel fecharia sozinho no
  // instante em que o usuário precisa continuar. Ver `casoUrgencia.chaveLogica`.
  const casoSelecionado = useMemo<CasoConciliacaoRow | null>(
    () => acharCasoSelecionado(linhas, chaveSelecionada),
    [linhas, chaveSelecionada],
  );

  const filaVisivel = useMemo(() => {
    if (fila === "nosso") return baldes.nosso;

    return baldes.ml.filter((c) => {
      // 🔴 Um caso urgente NUNCA fica escondido atrás de um filtro de estado.
      if (ehUrgente(c)) return true;
      if (soUrgentes) return false;
      const e = c.estado ?? "aberto";
      if (filtroEstado === "abertos") return e === "aberto" || e === "contestado";
      if (filtroEstado === "resolvido") return ESTADOS_RESOLVIDOS.includes(e);
      return e === filtroEstado;
    });
  }, [fila, baldes.ml, baldes.nosso, filtroEstado, soUrgentes]);

  // 🔴 A lista trunca: 1.351 linhas medidas em 30 dias contra teto de 1.000 do
  // PostgREST. Sem esta comparação a tela mostraria 1.000 e o usuário acharia
  // que são todos — o caso da linha 1.001 nunca seria olhado, que reprova
  // D-225-16 direto.
  const totalReal = resumo?.linhas_total ?? null;
  const faltamLinhas =
    totalReal != null && linhas.length > 0 && linhas.length < totalReal
      ? totalReal - linhas.length
      : 0;

  const urgentesN = resumo?.casos_urgentes ?? 0;
  const saidasAuditadas = resumo?.saidas_auditadas === true;
  const vazamento = resumo?.vazamento_total ?? null;
  const vazamentoNegativo = typeof vazamento === "number" && vazamento < 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MLPageHeader title="Protetor do caixa" lastUpdated={ultimaSync} />
        <Button
          variant="outline"
          size="sm"
          disabled={carregando}
          onClick={() => {
            casosQuery.refetch();
            resumoQuery.refetch();
          }}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* 🔴 Bloco 2 — sempre renderizado, nos dois estados. É o substituto
          declarado do alerta de Telegram que D-225-11 recusou. */}
      <BannerUrgencia
        carregando={carregando}
        erro={erro}
        resumo={resumo}
        maisUrgente={maisUrgente}
        onVerUrgentes={() => {
          setFila("ml");
          setSoUrgentes(true);
        }}
      />

      {/* Bloco 3 — os quatro KPIs. O de prazo é o primeiro que o olho encontra. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Expiram em ≤7 dias"
          value={String(urgentesN)}
          variant="minimal"
          size="compact"
          icon={<Clock className="w-4 h-4" />}
          iconClassName={
            urgentesN === 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          }
          subtitle={valorEmReais(resumo?.soma_urgente)}
        />
        <KPICard
          title="Vazamento total"
          value={valorEmReais(vazamento)}
          variant="minimal"
          size="compact"
          icon={<TrendingDown className="w-4 h-4" />}
          iconClassName="bg-muted text-muted-foreground"
          // ⚠️ Duas honestidades no mesmo rótulo: o monitor cobre uma ponta só
          // enquanto `saidas_auditadas` for falso, e o vazamento medido hoje é
          // NEGATIVO — chamar isso de "dinheiro a cobrar" seria acusação falsa
          // em escala.
          subtitle={`${saidasAuditadas ? "Entradas e saídas" : "Só entradas"}${
            vazamentoNegativo ? " · negativo, não é dinheiro a cobrar" : ""
          }`}
        />
        <KPICard
          title="Casos a cobrar"
          value={String(resumo?.acionaveis_n ?? 0)}
          variant="minimal"
          size="compact"
          icon={<ShieldCheck className="w-4 h-4" />}
          iconClassName="bg-muted text-muted-foreground"
          subtitle="Passaram pelos dois portões"
        />
        <KPICard
          title="Recuperado"
          value={valorEmReais(resumo?.recuperado_total)}
          variant="minimal"
          size="compact"
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconClassName="bg-accent/10 text-accent"
          subtitle="Casos marcados como ganhos"
        />
      </div>

      {/* Blocos 7 e 8 — o que está fora do escopo é NOMEADO, nunca some. */}
      {resumo ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {(resumo.fora_escopo_n ?? 0) > 0 ? (
            <p>
              + {resumo.fora_escopo_n} em mediação ou contestação de cartão — fora deste monitor
              (política interna). Soma: {valorEmReais(resumo.fora_escopo_soma)}.
            </p>
          ) : null}
          {(resumo.entradas_sem_origem_n ?? 0) > 0 ? (
            <p>
              + {resumo.entradas_sem_origem_n} entradas sem origem identificada, somando{" "}
              {valorEmReais(resumo.entradas_sem_origem_soma)} — aparecem na fila “Nosso erro”.
            </p>
          ) : null}
          {(resumo.a_verificar_n ?? 0) > 0 ? (
            <p>
              + {resumo.a_verificar_n} sem repasse encontrado, aguardando verificação no Mercado
              Pago antes de virar chamado. Os casos medidos até aqui eram contestação de cartão do
              comprador, não retenção do ML.
            </p>
          ) : null}
          {(resumo.valor_desconhecido_n ?? 0) > 0 ? (
            <p>
              {resumo.valor_desconhecido_n} linhas sem valor apurado — elas não somam em nenhum
              total, e por isso aparecem como “não apurado” e nunca como R$ 0,00.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Bloco 4 — a limitação declarada. A condição é DADO da RPC: este alerta
          some sozinho quando o plano 04 ingerir as saídas, sem tocar em código. */}
      {resumo && !saidasAuditadas ? (
        <Alert>
          <Layers className="h-4 w-4" />
          <AlertTitle className="text-sm">Este monitor cobre hoje só uma ponta</AlertTitle>
          <AlertDescription className="text-sm">
            Este monitor cobre hoje as ENTRADAS (repasses). As SAÍDAS da conta (tarifas
            debitadas, saques) ainda não são auditadas — endpoint em validação.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* A régua de valor a menor está desligada por calibração reprovada — e
          agora a tela diz também o que a ligaria. O CEO em 04/09/2026: "fala
          sobre a fila de repasse menor estar desligada… mas n vejo onde ligar".
          🔴 A resposta é explicação, não interruptor: ver `FilaDesligadaAviso`. */}
      <FilaDesligadaAviso acusarValorAMenor={resumo?.acusar_valor_a_menor ?? null} />

      {/* 🔴 Truncamento — o total real vem contado SEM teto pela RPC.
          A condição NÃO é "carregou menos que o total": a abertura carrega
          menos DE PROPÓSITO. O alarme é para o único estado que reprova
          D-225-16 — a última linha lida ainda tem prazo, então pode haver caso
          a expirar fora da lista. Um alerta que dispara sempre é ruído; este
          dispara quando há caso invisível com relógio correndo. */}
      {truncadoNoTeto || (faltamLinhas > 0 && !prazoCoberto) ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm">Pode haver caso com prazo fora desta lista</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              {truncadoNoTeto
                ? `A leitura parou no teto de páginas com ${linhas.length} linhas.`
                : `Foram carregadas ${linhas.length} de ${totalReal} linhas, e a última carregada ainda tem prazo correndo — as ${faltamLinhas} que faltam podem conter caso a expirar.`}
            </p>
            {!truncadoNoTeto ? (
              <Button
                size="sm"
                variant="outline"
                disabled={buscandoRestante}
                onClick={() => setListaCompleta(true)}
              >
                {buscandoRestante ? (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : null}
                Carregar as {faltamLinhas} linhas restantes
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Leitura parcial DELIBERADA, e ela se declara. Tom neutro: não é falha
          nem risco — o que falta vem depois de tudo que tem prazo. */}
      {faltamLinhas > 0 && prazoCoberto && !truncadoNoTeto ? (
        <Alert>
          <Layers className="h-4 w-4" />
          <AlertTitle className="text-sm">
            Carregadas {linhas.length} de {totalReal} linhas da janela
          </AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              A lista é ordenada por prazo e as {faltamLinhas} linhas que faltam vêm depois de
              todas as que têm prazo correndo — <strong>nenhum caso pode expirar sem aparecer
              aqui</strong>. Até você pedir o restante, os contadores das abas e dos blocos
              recolhidos descrevem só o que está carregado; os totais do rodapé e dos cartões
              continuam vindo do resumo, que conta a janela inteira.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={buscandoRestante}
              onClick={() => setListaCompleta(true)}
            >
              {buscandoRestante ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Carregar as {faltamLinhas} restantes
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Blocos 5 e 6 — duas filas em Tabs, nunca um filtro: filtro é estado
          que se esquece ligado, tab é lugar diferente. É a fronteira que
          protege a credibilidade do próximo chamado (D-225-07). */}
      <Card>
        <CardContent className="p-0">
          <Tabs value={fila} onValueChange={(v) => setFila(v as "ml" | "nosso")}>
            <div className="px-4 sm:px-6 pt-3 pb-0 border-b border-border">
              <TabsList className="h-9 bg-transparent p-0 gap-4">
                <TabsTrigger
                  value="ml"
                  className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                >
                  A cobrar do ML ({baldes.ml.length})
                </TabsTrigger>
                <TabsTrigger
                  value="nosso"
                  className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                >
                  {/* ⚠️ Conta o que a lista MOSTRA, não `resumo.nosso_erro_n`:
                      aquele campo exclui `entrada_sem_origem` de propósito, e
                      essas linhas aparecem aqui (D-225-10). Um contador que
                      não bate com a própria lista é a classe de mentira que
                      esta fase existe para matar. */}
                  Nosso erro ({baldes.nosso.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="ml" className="mt-0">
              <div className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-muted-foreground">
                  Ordenada por prazo, nunca por valor
                </span>
                <div className="flex items-center gap-2">
                  {soUrgentes ? (
                    <Button size="sm" variant="ghost" onClick={() => setSoUrgentes(false)}>
                      <Eye className="w-3.5 h-3.5 mr-1.5" />
                      Ver todos
                    </Button>
                  ) : null}
                  <Select
                    value={filtroEstado}
                    onValueChange={(v) => setFiltroEstado(v as FiltroEstado)}
                  >
                    <SelectTrigger className="h-8 text-xs w-44">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abertos">Aberto + Contestado</SelectItem>
                      <SelectItem value="aberto">Só aberto</SelectItem>
                      <SelectItem value="contestado">Só contestado</SelectItem>
                      <SelectItem value="resolvido">Resolvido (histórico)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 🔴 Os três estados de ausência, nunca um "sem dados" genérico. */}
              {erro ? (
                <EmptyState
                  icon={XCircle}
                  title="Não foi possível carregar os casos agora."
                  description="A leitura falhou. Tente de novo — enquanto isso, nenhum prazo está sendo vigiado."
                  actionLabel="Tentar de novo"
                  onAction={() => {
                    casosQuery.refetch();
                    resumoQuery.refetch();
                  }}
                />
              ) : carregando ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <RefreshCw className="w-10 h-10 opacity-30 animate-spin" />
                  <p className="text-sm">Lendo os repasses da janela...</p>
                </div>
              ) : nuncaSincronizou ? (
                <EmptyState
                  icon={RefreshCw}
                  title="Sincronizando repasses"
                  description="A primeira captura ainda está rodando. Volte em alguns minutos."
                />
              ) : filaVisivel.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nenhum caso a cobrar do Mercado Livre"
                  description={
                    baldes.medidosSemAcao.length > 0 || baldes.subPiso.length > 0
                      ? "Não é “sem dados” nem “está tudo certo”: há diferenças medidas na janela, e nenhuma delas passou pelos dois portões que existem hoje. Elas estão nos blocos recolhidos abaixo."
                      : "Toda venda da janela foi cobrada e repassada certinho. Não há caso para abrir hoje."
                  }
                />
              ) : (
                <FilaDeCasos
                  casos={filaVisivel}
                  ingestaoInicio={ingestaoInicio}
                  comPrazo
                  colunaPrazo="Prazo"
                  selecionado={chaveSelecionada}
                  onSelecionar={(c) => setChaveSelecionada(chaveDeLista(c))}
                />
              )}

              {/* D-225-06: mostra tudo, age em alguns. O que não vira caso fica
                  recolhido — nunca ausente, porque some do total se sumir. */}
              <BlocoRecolhido
                rotulo={`Ver diferenças medidas sem caso aberto (${baldes.medidosSemAcao.length}${
                  resumo?.acusar_valor_a_menor === false ? ", régua não liberada" : ""
                })`}
                explicacao="Diferenças que a RPC mediu e classificou, mas que não viram chamado hoje: ou a régua de valor a menor está desligada pela calibração, ou o repasse ainda está dentro do prazo normal de liberação. Elas somam no vazamento total e não pedem ação."
                casos={baldes.medidosSemAcao}
                ingestaoInicio={ingestaoInicio}
              />
              <BlocoRecolhido
                rotulo={`Ver diferenças abaixo do piso (${resumo?.sub_piso_n ?? baldes.subPiso.length}, somando ${valorEmReais(resumo?.sub_piso_soma)})`}
                explicacao="Centavos sistemáticos, abaixo do piso de materialidade que vem da configuração. Somam no vazamento total; não são casos individuais de ação."
                casos={baldes.subPiso}
                ingestaoInicio={ingestaoInicio}
              />
            </TabsContent>

            <TabsContent value="nosso" className="mt-0">
              <div className="px-4 sm:px-6 py-3 space-y-1">
                <p className="text-xs text-muted-foreground max-w-2xl">
                  Correção interna: nada aqui vai para o Mercado Livre. Por isso não há prazo, não
                  há contador de urgência e não há dossiê — o que existe é cadastro ou ingestão
                  nossa para arrumar.
                </p>
                {/* Duas somas, porque a RPC as separa: `nosso_erro_soma` NÃO
                    inclui as entradas sem origem. Somar as duas aqui inventaria
                    um terceiro número que o banco não calculou. */}
                <p className="text-xs text-muted-foreground">
                  Erros de cadastro e de ingestão: {valorEmReais(resumo?.nosso_erro_soma)}
                  {(resumo?.entradas_sem_origem_n ?? 0) > 0
                    ? ` · entradas sem origem: ${valorEmReais(resumo?.entradas_sem_origem_soma)}`
                    : ""}
                  . Ordenada por tamanho do erro, sem prazo.
                </p>
              </div>

              {erro ? (
                <EmptyState
                  icon={XCircle}
                  title="Não foi possível carregar os casos agora."
                  description="A leitura falhou. Tente de novo."
                  actionLabel="Tentar de novo"
                  onAction={() => {
                    casosQuery.refetch();
                    resumoQuery.refetch();
                  }}
                />
              ) : carregando ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <RefreshCw className="w-10 h-10 opacity-30 animate-spin" />
                  <p className="text-sm">Lendo os repasses da janela...</p>
                </div>
              ) : nuncaSincronizou ? (
                <EmptyState
                  icon={RefreshCw}
                  title="Sincronizando repasses"
                  description="A primeira captura ainda está rodando. Volte em alguns minutos."
                />
              ) : filaVisivel.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nenhuma divergência nossa na janela"
                  description="Nada de cadastro ou de ingestão nossa apareceu como divergência nesta janela."
                />
              ) : (
                <FilaDeCasos
                  casos={filaVisivel}
                  ingestaoInicio={ingestaoInicio}
                  comPrazo={false}
                  colunaPrazo="—"
                  selecionado={chaveSelecionada}
                  onSelecionar={(c) => setChaveSelecionada(chaveDeLista(c))}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 🔴 Dois Sheets, montados sempre e controlados pela seleção. Qual deles
          abre é decidido pela FILA que a RPC classificou, nunca pela tab ativa:
          a fronteira que impede um erro nosso de virar chamado contra o ML tem
          que valer também quando a seleção sobrevive a uma troca de aba. */}
      <CasoConciliacaoSheet
        caso={casoSelecionado != null && casoSelecionado.fila !== "nosso" ? casoSelecionado : null}
        ingestaoInicio={ingestaoInicio}
        onOpenChange={(aberto) => {
          if (!aberto) setChaveSelecionada(null);
        }}
      />
      <CasoNossoErroSheet
        caso={casoSelecionado != null && casoSelecionado.fila === "nosso" ? casoSelecionado : null}
        ingestaoInicio={ingestaoInicio}
        onOpenChange={(aberto) => {
          if (!aberto) setChaveSelecionada(null);
        }}
      />
    </div>
  );
}
