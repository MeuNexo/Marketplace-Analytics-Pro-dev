// ============================================================================
// MargemTeoricaCatalogo — Fase 213, Plano 07, Task 2 (RE-05)
//
// Régua desta tela, em uma frase: margem TEÓRICA — preço de tabela de hoje menos
// custo, comissão e imposto. Ela responde "se eu vender por X, quanto sobra",
// que é pergunta de PRECIFICAÇÃO. Por isso mudou de endereço: vivia em
// `/anuncios`, que é catálogo operacional e cadastro de custo, e passou a viver
// aqui, onde se decide preço.
//
// O que ela NÃO é: a margem das vendas reais. Aquela vem da RPC
// `get_margin_with_ads_by_product` e continua em `/anuncios` (Mg. Op. e
// Mg. Pós-Ads) e em `/resultado` (MCO). Esta aqui não conhece pedido nenhum e
// não desconta publicidade — se as duas forem lidas como a mesma coisa, o MCO
// de `/resultado` passa a "divergir" de um número que nunca mediu a mesma coisa.
// Daí a nota de régua fixa no topo da tela.
//
// A fórmula NÃO é redigitada aqui. Ela vem inteira de
// `calcularMargensDoAnuncio` (`@/lib/anuncioMargens`), o mesmo helper que
// alimenta as colunas de comissão e imposto de `/anuncios`. Recriar a conta no
// destino seria recriar exatamente a divergência que o plano 213-03 matou (duas
// margens teóricas com fórmulas diferentes na mesma casa). Se esta tela algum
// dia precisar de algo que o helper não expõe, o certo é estender o helper, não
// calcular por fora.
//
// As ENTRADAS do helper também são resolvidas do mesmo jeito que em
// `/anuncios`, e isso é parte do contrato: custo por `item_id` com queda para
// `seller_sku` (sync do Tiny), alíquota efetiva da loja via `ml_tax_config` com
// queda para a alíquota gravada no próprio custo, e comissão real da API de
// listing costs quando o cache já respondeu. Mudar qualquer uma dessas
// resoluções aqui faria os dois lugares mostrarem números diferentes para o
// mesmo anúncio — que é o defeito, não a feature.
//
// Preço promocional: esta tela usa sempre o preço de TABELA, nunca o
// promocional. É a mesma coisa que `/anuncios` mostra com a caixa "Preço
// promocional" desmarcada, que é o estado padrão dela. Promoção é evento de
// campanha; margem teórica é a régua do preço publicado.
// ============================================================================

import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { Search, Package, Plug, Info, ShoppingBag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMLInventory } from "@/contexts/MLInventoryContext";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useMLProductCosts } from "@/hooks/useMLProductCosts";
import { useMLTaxConfig } from "@/hooks/useMLTaxConfig";
import { useMLPrecosCustos } from "@/hooks/useMLPrecosCustos";
import { currencyFmt, mlListingUrl } from "@/components/mercadolivre/anuncios/listingHelpers";
// A fonte única da margem teórica do catálogo (CR-08). Ver o cabeçalho acima.
import {
  calcularMargensDoAnuncio,
  difalPctReferencia,
  JANELA_DIFAL_REFERENCIA_DIAS,
} from "@/lib/anuncioMargens";
import {
  McoDoisCenarios,
  McoDoisCenariosCabecalho,
} from "@/components/mercadolivre/McoDoisCenarios";
import type { McoColorRole } from "@/lib/mcoHealth";
import {
  DIFAL_ESTIMATIVA_LABEL,
  regimeAplicaDifalNasLojas,
  resolveLinhaCenarios,
} from "@/lib/mcoLinhaCenarios";
import { useMLDifalSummary } from "@/hooks/useMLDifalSummary";
import { format, subDays } from "date-fns";
// AV-03: sem CMV não existe margem — e uma tabela inteira de margem teórica numa
// conta sem custo é ficção completa, não uma célula com traço.
import { contarSemCusto } from "@/lib/custoFaltante";
import { AvisoCustoFaltante } from "@/components/mercadolivre/AvisoCustoFaltante";

type Ordenacao =
  | "margem_liq_asc"
  | "margem_liq_desc"
  | "margem_bruta_asc"
  | "margem_bruta_desc"
  | "preco_desc"
  | "preco_asc"
  | "titulo_asc";

const ORDENACOES: { value: Ordenacao; label: string }[] = [
  { value: "margem_liq_asc",     label: "Menor margem líquida" },
  { value: "margem_liq_desc",    label: "Maior margem líquida" },
  { value: "margem_bruta_asc",   label: "Menor margem bruta" },
  { value: "margem_bruta_desc",  label: "Maior margem bruta" },
  { value: "preco_desc",         label: "Maior preço" },
  { value: "preco_asc",          label: "Menor preço" },
  { value: "titulo_asc",         label: "Título (A–Z)" },
];

/** Cores das faixas — as MESMAS de `/anuncios`, para que a leitura não mude de sentido ao trocar de tela. */
const corMargemBruta = (v: number | null) =>
  v == null ? "" : v >= 50 ? "text-emerald-600" : v >= 30 ? "text-amber-600" : "text-red-600";
const corMargemLiquida = (v: number | null) =>
  v == null ? "" : v >= 30 ? "text-emerald-600" : v >= 10 ? "text-amber-600" : "text-red-600";

/**
 * [222-15-R2] As MESMAS faixas acima, em papel de cor semântico — o componente
 * único do par de cenários recebe o papel, nunca a classe. 🔴 O papel é
 * decidido sobre o cenário SEM DIFAL: mudar a base de uma cor é decisão de
 * negócio que ninguém tomou.
 */
const corMargemLiquidaRole = (v: number | null): McoColorRole =>
  v == null ? "neutral" : v >= 30 ? "good" : v >= 10 ? "warning" : "critical";

/**
 * Ordena mantendo o indefinido SEMPRE no fim, nos dois sentidos.
 *
 * Sem isto, "menor margem líquida" traria no topo os anúncios sem custo — que
 * não têm margem baixa, têm margem desconhecida. Ausência não é o pior caso: é
 * a ausência de caso.
 */
const cmpComNuloNoFim = (a: number | null, b: number | null, asc: boolean) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return asc ? a - b : b - a;
};

export function MargemTeoricaCatalogo() {
  const { items, loading, hasToken } = useMLInventory();
  const { resolvedMLUserIds } = useMLStore();
  const { currentOrg } = useOrganization();
  const orgId = currentOrg?.id ?? null;
  const isMobile = useIsMobile();

  const { costs, costsBySku } = useMLProductCosts();
  const { data: taxMap } = useMLTaxConfig(resolvedMLUserIds, orgId ?? "");
  const { fetchCosts } = useMLPrecosCustos();

  // ── [222-15-R2] A alíquota de REFERÊNCIA do DIFAL ─────────────────────────
  //
  // 🔴 Esta tela não conhece pedido nenhum: ela usa a alíquota INTRAESTADUAL, e
  // operação intraestadual NÃO TEM DIFAL. Não existe "o DIFAL deste anúncio"
  // porque não existe destino. O segundo cenário é uma alíquota MEDIDA na
  // mistura de estados realmente vendidos numa janela fixa e declarada — e a
  // nota de régua diz as duas coisas em palavras, senão o número aparenta uma
  // precisão por anúncio que ele não tem.
  const janelaReferencia = useMemo(() => {
    const hoje = new Date();
    return {
      from: format(subDays(hoje, JANELA_DIFAL_REFERENCIA_DIAS - 1), "yyyy-MM-dd"),
      to: format(hoje, "yyyy-MM-dd"),
    };
  }, []);
  const { data: difalResumo } = useMLDifalSummary(janelaReferencia.from, janelaReferencia.to);

  // Efeito LÍQUIDO do DIFAL (o custo real): o calculado menos a queda do débito
  // de PIS/COFINS que ele mesmo provoca. Somar o DIFAL cheio superestimaria o
  // acréscimo — é o defeito de R$ 3,85/pedido do 222-06-R/07-R, aqui em forma
  // de pontos percentuais.
  const difalPctRef = useMemo(() => {
    if (!difalResumo) return null;
    const efeitoLiquido =
      difalResumo.difal_calculado - (difalResumo.reducao_pc_por_difal ?? 0);
    return difalPctReferencia(efeitoLiquido, difalResumo.receita_base);
  }, [difalResumo]);

  const regimeAplicaDifal = useMemo(
    () =>
      taxMap
        ? regimeAplicaDifalNasLojas(resolvedMLUserIds.map((id) => taxMap.get(id)?.regime ?? null))
        : undefined,
    [taxMap, resolvedMLUserIds],
  );

  const [busca, setBusca] = useState("");
  const [marca, setMarca] = useState("all");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("margem_liq_asc");

  // Cache da comissão REAL por anúncio (ML Listing Costs API). Mesma fonte e
  // mesma prioridade de `/anuncios`: quando o cache respondeu, ele vence a
  // tabela estática por tipo de anúncio.
  const [commCache, setCommCache] = useState<Map<string, { pct: number }>>(new Map());

  const marcas = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.brand) set.add(i.brand); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Custo por `item_id`, com queda para `seller_sku` — o custo pode ter sido
  // digitado por MLB (manual) ou ter vindo do Tiny por SKU. Resolução idêntica
  // à de `/anuncios`.
  const custoDe = useMemo(
    () => (itemId: string, sku: string | null) =>
      costs.get(itemId) ?? (sku ? costsBySku.get(sku) : undefined),
    [costs, costsBySku],
  );

  /** Anúncios que passam pelos filtros da tela, já com as margens calculadas. */
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return items
      .filter((item) => {
        if (marca !== "all" && (item.brand || "") !== marca) return false;
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          (item.seller_custom_field ?? "").toLowerCase().includes(q)
        );
      })
      .map((item) => {
        const sku = item.seller_custom_field || null;
        const productCost = custoDe(item.id, sku);
        const custo = productCost?.cost ?? null;
        const taxEntry = item._ml_user_id ? taxMap?.get(item._ml_user_id) : undefined;
        const aliquota = taxEntry != null
          ? Math.max(0, taxEntry.effective_rate)
          : (productCost?.tax_rate ?? null);
        const margens = calcularMargensDoAnuncio({
          precoTabela: item.price,
          // Margem teórica é sobre o preço PUBLICADO — ver cabeçalho.
          precoPromocional: null,
          usarPromocao: false,
          custo,
          aliquotaEfetivaPct: aliquota,
          comissaoRealPct: commCache.get(item.id)?.pct ?? null,
          tipoAnuncio: item.listing_type_id,
          difalPctReferencia: difalPctRef,
        });
        return {
          id: item.id,
          title: item.title,
          thumbnail: item.thumbnail,
          sku,
          marca: item.brand || "Sem marca",
          preco: item.price,
          custo,
          aliquota,
          margens,
        };
      });
  }, [items, busca, marca, custoDe, taxMap, commCache, difalPctRef]);

  const linhasOrdenadas = useMemo(() => {
    const arr = [...linhas];
    switch (ordenacao) {
      case "margem_liq_asc":
        return arr.sort((a, b) => cmpComNuloNoFim(a.margens.margemLiquida, b.margens.margemLiquida, true));
      case "margem_liq_desc":
        return arr.sort((a, b) => cmpComNuloNoFim(a.margens.margemLiquida, b.margens.margemLiquida, false));
      case "margem_bruta_asc":
        return arr.sort((a, b) => cmpComNuloNoFim(a.margens.margemBruta, b.margens.margemBruta, true));
      case "margem_bruta_desc":
        return arr.sort((a, b) => cmpComNuloNoFim(a.margens.margemBruta, b.margens.margemBruta, false));
      case "preco_desc":
        return arr.sort((a, b) => b.preco - a.preco);
      case "preco_asc":
        return arr.sort((a, b) => a.preco - b.preco);
      default:
        return arr.sort((a, b) => a.title.localeCompare(b.title));
    }
  }, [linhas, ordenacao]);

  // AV-03: a contagem é sobre o conjunto EXIBIDO, nunca sobre o catálogo
  // inteiro — a mesma disciplina de `/anuncios`. E a fonte de "tem custo" é a
  // mesma que alimenta o helper: `custo != null` (custo zero é custo válido).
  const contagemCusto = useMemo(
    () => contarSemCusto(linhasOrdenadas.map((l) => ({ temCusto: l.custo != null }))),
    [linhasOrdenadas],
  );

  // Chave estável do conjunto exibido — evita refazer a busca de comissão a
  // cada re-render que não mudou quais anúncios estão na tela.
  const chaveItens = useMemo(
    () => linhas.map((l) => l.id).sort().join(","),
    [linhas],
  );

  // Comissão real, em blocos de 5. Sem os blocos, um catálogo grande dispara
  // centenas de chamadas simultâneas à API do ML a cada troca de filtro (risco
  // de 429 degradando o token da conta inteira) — mesma proteção de `/anuncios`.
  useEffect(() => {
    if (!chaveItens) return;
    const pendentes = items.filter((i) => !commCache.has(i.id));
    if (pendentes.length === 0) return;
    let cancelado = false;
    const BLOCO = 5;
    (async () => {
      for (let i = 0; i < pendentes.length && !cancelado; i += BLOCO) {
        const bloco = pendentes.slice(i, i + BLOCO);
        await Promise.allSettled(bloco.map(async (item) => {
          const custos = await fetchCosts({
            price: item.price,
            categoryId: item.category_id ?? undefined,
            logisticType: item.logistic_type ?? undefined,
          });
          if (!custos.length || cancelado) return;
          const lt = item.listing_type_id ?? "";
          const match =
            custos.find((c) => c.listing_type_id === lt) ??
            custos.find((c) => lt.includes(c.listing_type_id) || c.listing_type_id.includes(lt)) ??
            custos[0];
          if (!match) return;
          setCommCache((prev) => new Map(prev).set(item.id, { pct: match.percentage_fee }));
        }));
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveItens]);

  if (hasToken === false) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Plug className="w-12 h-12 mb-4 text-muted-foreground/40" />
          <h3 className="text-lg font-semibold mb-2">Conta não conectada</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Conecte sua conta do Mercado Livre para calcular a margem teórica do catálogo.
          </p>
          <Button asChild><Link to="/integracoes">Ir para Integrações</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Nota de régua ──
          Fixa e não descartável: sem ela, esta tabela é lida como "a margem" e
          passa a ser confrontada com o MCO de `/resultado`, que mede outra
          coisa (venda real, com publicidade descontada). */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-start gap-2.5 text-xs">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-medium text-primary">Margem teórica — preço de tabela de hoje</p>
          <p className="text-foreground/80">
            Estes números respondem <strong>“se eu vender por este preço, quanto sobra”</strong>:
            preço publicado menos custo, comissão do Mercado Livre e imposto. Não há
            pedido nenhum nesta conta, e <strong>publicidade não é descontada</strong>.
            A margem das vendas que realmente aconteceram — com ads na régua da fatura —
            está em <Link to="/resultado" className="underline font-medium">Resultado</Link>{" "}
            e nas colunas Mg. Op. e Mg. Pós-Ads de{" "}
            <Link to="/anuncios" className="underline font-medium">Anúncios</Link>.
          </p>
          {/* [222-15-R2] As DUAS frases que o segundo cenário desta tela exige.
              Sem elas o número aparenta uma precisão por anúncio que ele não
              tem: aqui não existe destino, logo não existe DIFAL do anúncio. */}
          <p className="text-foreground/80">
            A coluna <strong>Mg. Líq. com DIFAL</strong> é{" "}
            <strong>{DIFAL_ESTIMATIVA_LABEL}</strong>: ela usa uma{" "}
            <strong>alíquota de referência medida na mistura de estados realmente
            vendidos</strong>, não a alíquota do destino de um pedido — esta tela não
            conhece destino, e operação dentro do estado não tem DIFAL.{" "}
            {difalPctRef != null ? (
              <>
                Referência medida nos últimos <strong>{JANELA_DIFAL_REFERENCIA_DIAS} dias</strong>{" "}
                ({janelaReferencia.from.split("-").reverse().join("/")} a{" "}
                {janelaReferencia.to.split("-").reverse().join("/")}):{" "}
                <strong>{difalPctRef.toFixed(2)} p.p.</strong> sobre o preço.
              </>
            ) : (
              <>
                Não há venda medida nos últimos <strong>{JANELA_DIFAL_REFERENCIA_DIAS} dias</strong>{" "}
                — sem receita na janela a referência não existe, e a coluna com DIFAL
                fica vazia (não é zero).
              </>
            )}
          </p>
        </div>
      </div>

      {/* AV-03 — quantos dos anúncios EXIBIDOS estão sem CMV. */}
      <AvisoCustoFaltante contagem={contagemCusto} destinoCadastro="/anuncios" />

      <Card>
        <div className="px-4 pt-4 pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Margem Teórica do Catálogo</span>
            <div className="flex items-center gap-1.5 w-full sm:w-auto flex-wrap">
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar por título, MLB ou SKU..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-8 h-8 text-xs w-full"
                />
              </div>

              <Select value={marca} onValueChange={setMarca}>
                <SelectTrigger className="w-full sm:w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {marcas.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={ordenacao} onValueChange={(v) => setOrdenacao(v as Ordenacao)}>
                <SelectTrigger className="w-full sm:w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDENACOES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <CardContent className="p-0">
          {loading && items.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : linhasOrdenadas.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title={busca || marca !== "all" ? "Nenhum anúncio encontrado" : "Nenhum anúncio ativo"}
              description={busca || marca !== "all"
                ? "Nenhum anúncio corresponde ao filtro atual. Tente limpar os filtros."
                : "Você não tem anúncios ativos no Mercado Livre."}
              size="compact"
            />
          ) : isMobile ? (
            /* ── Mobile: cartões empilhados ── */
            <div className="space-y-2 p-2">
              {linhasOrdenadas.map((l) => (
                <div key={l.id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
                  <p className="text-xs font-medium line-clamp-2">{l.title}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{l.sku || l.id}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {([
                      ["Preço",     currencyFmt(l.preco)],
                      ["Custo",     l.custo != null ? currencyFmt(l.custo) : "—"],
                      ["Imposto",   l.margens.impostoValor != null ? currencyFmt(l.margens.impostoValor) : "—"],
                      ["Comissão",  `−${currencyFmt(l.margens.comissaoValor)}`],
                      ["Mg. Bruta", l.margens.margemBruta != null ? `${l.margens.margemBruta.toFixed(1)}%` : "—"],
                      /* [222-15-R2] Mesma régua do ramo de mesa — ligar um ramo
                         só deixaria metade da tela num cenário diferente. */
                      ["Mg. Líq.",
                        l.margens.margemLiquida != null
                          ? `${l.margens.margemLiquida.toFixed(1)}%`
                          : "—"],
                      ["Mg. Líq. c/ DIFAL",
                        l.margens.margemLiquidaComDifal != null
                          ? `${l.margens.margemLiquidaComDifal.toFixed(1)}% (${DIFAL_ESTIMATIVA_LABEL})`
                          : difalPctRef == null
                            ? "sem venda medida na janela"
                            : "—"],
                    ] as [string, string][]).map(([rotulo, valor]) => (
                      <div key={rotulo}>
                        <span className="text-muted-foreground">{rotulo} </span>
                        <span className="font-mono tabular-nums">{valor}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Desktop: tabela ── */
            <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-12" />
                    <TableHead className="text-xs">Anúncio</TableHead>
                    <TableHead className="text-xs w-24">SKU</TableHead>
                    <TableHead className="text-xs text-right w-24">Preço</TableHead>
                    <TableHead className="text-xs text-right w-24">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Custo</span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[220px]">
                          Custo do produto (CMV). O cadastro é feito em Anúncios, na coluna Custo.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-xs text-right w-28">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Imposto</span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[240px]">
                          Estimativa pela alíquota efetiva do regime configurado em Fiscal. Sem regime
                          configurado a margem líquida fica indefinida — nunca calculada com imposto zero.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-xs text-right w-28">Comissão ML</TableHead>
                    <TableHead className="text-xs text-right w-28">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-muted-foreground/40">Mg. Bruta</span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[240px]">
                          (preço − custo) ÷ preço. Indefinida sem custo cadastrado.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="text-xs text-right w-28">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-muted-foreground/40">
                            {/* [222-15-R2] A ressalva de estimativa aparece UMA
                                vez, aqui — não repetida por linha. */}
                            <McoDoisCenariosCabecalho titulo="Mg. Líq." />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[240px]">
                          (preço − custo − comissão − imposto) ÷ preço. Não desconta publicidade nem frete.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhasOrdenadas.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="p-2">
                        {l.thumbnail ? (
                          <img
                            src={l.thumbnail.replace("http://", "https://")}
                            alt=""
                            className="w-10 h-10 rounded object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <Package className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <a
                          href={mlListingUrl(l.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium line-clamp-2 leading-tight hover:underline hover:text-primary transition-colors"
                        >
                          {l.title}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <p className="text-xs text-muted-foreground font-mono">{l.id}</p>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{l.marca}</Badge>
                        </div>
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {l.sku || <span className="text-muted-foreground/40">—</span>}
                      </TableCell>

                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {currencyFmt(l.preco)}
                      </TableCell>

                      <TableCell className="text-right">
                        {l.custo != null ? (
                          <span className="text-xs font-mono tabular-nums">{currencyFmt(l.custo)}</span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground/40 cursor-help">—</span>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[220px]">
                              Sem custo cadastrado — a margem deste anúncio é indefinida, não zero.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {l.aliquota != null ? (
                          <span className="text-xs font-mono tabular-nums">
                            {currencyFmt(l.margens.impostoValor ?? 0)}{" "}
                            ({l.aliquota.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <span className="text-xs text-destructive font-mono tabular-nums">
                          −{currencyFmt(l.margens.comissaoValor)}
                        </span>
                        {l.margens.comissaoReal
                          ? <span className="text-[10px] text-muted-foreground ml-1">({l.margens.comissaoPct.toFixed(1)}%)</span>
                          : <span className="text-[10px] text-muted-foreground ml-1 animate-pulse">…</span>}
                      </TableCell>

                      <TableCell className="text-right">
                        {l.margens.margemBruta != null ? (
                          <span className={`text-xs font-bold tabular-nums ${corMargemBruta(l.margens.margemBruta)}`}>
                            {l.margens.margemBruta.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {l.margens.margemLiquida != null ? (
                          /* [222-15-R2] O par de cenários pelo componente único.
                             O valor em R$ é a margem por unidade vendida a este
                             preço — valor E percentual, como manda a casa. */
                          <McoDoisCenarios
                            cenarios={resolveLinhaCenarios({
                              semDifal: {
                                valor: l.preco * (l.margens.margemLiquida / 100),
                                pct: l.margens.margemLiquida,
                              },
                              comDifal:
                                l.margens.margemLiquidaComDifal != null
                                  ? {
                                      valor: l.preco * (l.margens.margemLiquidaComDifal / 100),
                                      pct: l.margens.margemLiquidaComDifal,
                                    }
                                  : null,
                              difalEfeito:
                                l.margens.impostoValorComDifal != null &&
                                l.margens.impostoValor != null
                                  ? l.margens.impostoValorComDifal - l.margens.impostoValor
                                  : null,
                              regimeAplicaDifal,
                            })}
                            densidade="celula"
                            role={corMargemLiquidaRole(l.margens.margemLiquida)}
                            ressalvaNoCabecalho
                            rotuloSemDifal=""
                            rotuloComDifal="c/ DIFAL"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {linhasOrdenadas.length > 0 && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground">
              Exibindo {linhasOrdenadas.length} de {items.length} anúncios
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
