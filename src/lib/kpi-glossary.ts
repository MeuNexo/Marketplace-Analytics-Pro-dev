export type GlossaryKey =
  | "receita_total"
  | "pedidos"
  | "ticket_medio"
  | "visitas"
  | "conversao"
  | "compradores"
  | "unidades_vendidas"
  | "markup"
  | "custo_operacional"
  | "impostos"
  | "cffe"
  | "comissao_ml"
  | "cfonpn"
  | "cmv"
  | "receita_bruta"
  | "receita_liquida"
  | "lucro_bruto"
  | "publicidade"
  | "roas"
  | "acos"
  | "tacos"
  | "cobertura"
  | "ruptura"
  | "margem_bruta"
  | "margem_liquida"
  | "margem_operacional"
  | "margem_pos_ads";

export interface GlossaryEntry {
  /** Rótulo técnico exibido no KPI (ex: "CFFE"). */
  term: string;
  /** Definição em 1 frase, linguagem de lojista leigo. */
  definition: string;
  /** Exemplo concreto quando ajuda a entender (opcional). */
  example?: string;
}

/**
 * Glossário central de KPIs — fonte única de verdade (D-01).
 *
 * Consumidores fazem o lookup e passam a string pronta para a
 * prop `tooltip` do KPICard.  Tom: linguagem de lojista leigo,
 * 1 frase, sem jargão ML não explicado (D-03).
 *
 * Wesley revisa a redação final no checkpoint visual do Plano 04.
 */
export const KPI_GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  receita_total: {
    term: "Receita Total",
    definition:
      "Tudo que entrou de vendas no período, antes de descontar qualquer custo.",
  },
  pedidos: {
    term: "Pedidos",
    definition: "Número de compras realizadas no período selecionado.",
  },
  ticket_medio: {
    term: "Ticket Médio",
    definition: "Valor médio de cada pedido no período selecionado.",
  },
  visitas: {
    term: "Visitas",
    definition:
      "Número de vezes que alguém acessou qualquer um dos seus anúncios.",
  },
  conversao: {
    term: "Conversão",
    definition:
      "De cada 100 pessoas que visitaram seus anúncios, quantas compraram.",
    example: "Ex: 2% = 2 compradores a cada 100 visitas.",
  },
  compradores: {
    term: "Compradores",
    definition:
      "Clientes únicos que compraram no período — cada pessoa conta uma vez.",
  },
  unidades_vendidas: {
    term: "Unidades Vendidas",
    definition:
      "Total de itens vendidos (um pedido pode ter mais de um item).",
  },
  markup: {
    term: "Markup",
    definition:
      "Quantas vezes o preço de venda é maior que o custo do produto.",
    example: "Ex: Markup 3x = você vende por 3x o que pagou.",
  },
  custo_operacional: {
    term: "Custo Operacional",
    definition:
      "Soma de todos os custos do Mercado Livre: frete (CFFE) + comissão + publicidade.",
  },
  impostos: {
    term: "Impostos",
    definition:
      "Estimativa dos impostos sobre a venda, calculada pelo regime tributário configurado.",
  },
  cffe: {
    term: "CFFE",
    definition:
      "O frete que o Mercado Livre te cobra por cada venda — aparece na sua fatura mensal.",
    example: "Ex: numa venda de R$100, o ML pode cobrar ~R$14 de frete.",
  },
  comissao_ml: {
    term: "Comissão ML",
    definition:
      "A parte que o Mercado Livre fica de cada venda (depende do tipo de anúncio).",
    example: "Ex: anúncio Clássico: ~11% da venda.",
  },
  cfonpn: {
    term: "CFONPN / Parcelamento",
    definition:
      "Custo de parcelamento: quando o comprador parcela, o ML desconta uma taxa do repasse.",
  },
  cmv: {
    term: "CMV",
    definition:
      "Custo do produto — quanto você pagou para ter o item em estoque.",
    example: "Ex: se comprou por R$30 e vendeu por R$100, o CMV é R$30.",
  },
  receita_bruta: {
    term: "Receita Bruta",
    definition: "Total de vendas sem descontar nenhum custo.",
  },
  receita_liquida: {
    term: "Receita Líquida",
    definition:
      "O que sobra após descontar comissão, frete e custos do produto.",
  },
  lucro_bruto: {
    term: "Lucro Bruto",
    definition:
      "Receita menos todos os custos: produto, frete, comissão, imposto e publicidade.",
  },
  publicidade: {
    term: "Publicidade",
    definition:
      "Quanto foi gasto em anúncios pagos no Mercado Livre (Product Ads).",
  },
  roas: {
    term: "ROAS",
    definition:
      "Retorno sobre o gasto de publicidade — quantos reais de venda para cada R$1 em ads.",
    example: "Ex: ROAS 5x = R$5 de venda para cada R$1 gasto.",
  },
  acos: {
    term: "ACoS",
    definition:
      "Percentual da receita que foi para publicidade (menor é melhor).",
    example: "Ex: ACoS 20% = de cada R$100 vendidos, R$20 foram para ads.",
  },
  tacos: {
    term: "TACoS",
    definition:
      "Igual ao ACoS mas calculado sobre toda a receita da conta (não só a atribuída a ads).",
  },
  cobertura: {
    term: "Cobertura",
    definition:
      "Quantos dias de estoque você tem com base no ritmo de vendas atual.",
    example: "Ex: cobertura 15 dias = estoque acaba em 15 dias no ritmo atual.",
  },
  ruptura: {
    term: "Ruptura",
    definition:
      "Produto com estoque zero — anúncio pausado automaticamente pelo ML.",
  },
  margem_bruta: {
    term: "Margem Bruta",
    definition:
      "Percentual que sobra da receita após descontar comissão e frete do ML.",
  },
  margem_liquida: {
    term: "Margem Líquida",
    definition:
      "Percentual que sobra após comissão, frete e custo do produto.",
  },
  margem_operacional: {
    term: "Mg. Op.",
    definition:
      "Margem calculada com base nas vendas reais do período selecionado (sem ads).",
  },
  margem_pos_ads: {
    term: "Mg. Pós-Ads",
    definition:
      "Margem após descontar o gasto de publicidade atribuído ao produto.",
  },
};
