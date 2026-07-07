export const routeTitles: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Vendas", subtitle: "" },
  "/estoque": { title: "Estoque", subtitle: "Gestão de estoque dos seus anúncios" },
  "/anuncios": { title: "Anúncios", subtitle: "Catálogo de produtos e anúncios ativos" },
  "/pedidos": { title: "Pedidos", subtitle: "Acompanhamento de pedidos e envios" },
  "/publicidade": { title: "Publicidade", subtitle: "Gestão e performance de publicidade" },
  "/financeiro":   { title: "Margem",   subtitle: "Análise de taxas, comissões e custo de frete" },
  "/reputacao":    { title: "Reputação",    subtitle: "Avaliações, reputação e histórico de feedback" },
  "/devolucoes":   { title: "Reclamações",   subtitle: "Gestão de devoluções e reclamações" },
  "/perguntas":    { title: "Perguntas",    subtitle: "Perguntas e mensagens dos compradores" },
  "/perfil": { title: "Perfil", subtitle: "Gerencie suas informações pessoais" },
  "/sellers": { title: "Sellers", subtitle: "Gerencie sellers e marketplaces ativos" },
  "/integracoes": {
    title: "Integrações",
    subtitle: "Conecte suas contas de marketplaces para sincronizar dados automaticamente",
  },
  "/fiscal": {
    title: "Configuração Fiscal",
    subtitle: "Configure o regime tributário de cada conta Mercado Livre",
  },
  "/metas": { title: "Metas", subtitle: "Defina metas mensais por loja e acompanhe no card de Vendas" },
  "/consultor": { title: "Consultor", subtitle: "O que fazer agora — alertas e saúde do negócio" },
  "/precificacao": { title: "Precificação", subtitle: "Simulador e ferramentas para definir preço de venda" },
  "/fluxo-de-caixa": { title: "Fluxo de Caixa", subtitle: "Como meu dinheiro vai evoluir?" },
  "/usuarios": { title: "Usuários", subtitle: "Gerencie usuários e permissões do sistema" },
  "/monitoramento": { title: "Monitoramento", subtitle: "Estatísticas de banco de dados e capacidade do sistema" },
};

export function getRouteMeta(pathname: string) {
  return routeTitles[pathname] ?? { title: "Dashboard", subtitle: "" };
}
