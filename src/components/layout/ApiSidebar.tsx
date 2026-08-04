import {
  BarChart2,
  Banknote,
  Target,
  ClipboardList,
  FileBarChart,
  FileText,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Package,
  PackageSearch,
  PackageX,
  Plug,
  Receipt,
  Calculator,
  Settings2,
  Handshake,
  ShoppingBag,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { EnvironmentSidebar, type SidebarNavSection } from "./EnvironmentSidebar";

const apiSections: SidebarNavSection[] = [
  {
    items: [
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        path: "/",
        noSelfLink: true,
        children: [
          // Resultado no TOPO: é a tela que responde à primeira pergunta do
          // negócio — em que eu ganho e em que eu perco dinheiro (Fase 213).
          { icon: PackageSearch, label: "Resultado",   path: "/resultado"   },
          { icon: TrendingUp,  label: "Vendas",      path: "/"            },
          { icon: Lightbulb,   label: "Consultor",   path: "/consultor"   },
          { icon: Megaphone,   label: "Publicidade", path: "/publicidade" },
          { icon: Receipt,       label: "Margem",             path: "/financeiro"       },
        ],
      },
      {
        icon: Layers,
        label: "Operações",
        path: "/estoque",
        noSelfLink: true,
        children: [
          { icon: ShoppingBag,   label: "Anúncios", path: "/anuncios" },
          // Análise de Preços saiu de Dashboard: é ferramenta de operação de
          // preço, não painel de resultado. Ao lado de Anúncios ela diz o que
          // faz; ao lado de Publicidade não dizia nada (Fase 213).
          { icon: BarChart2,     label: "Análise de Preços", path: "/analise-precos" },
          { icon: Package,       label: "Estoque",  path: "/estoque"  },
          { icon: ShoppingCart,  label: "Compras",  path: "/compras"  },
          { icon: ClipboardList, label: "Pedidos",  path: "/pedidos"  },
          { icon: Calculator,    label: "Precificação", path: "/precificacao" },
          { icon: Banknote,     label: "Fluxo de Caixa", path: "/fluxo-de-caixa" },
          { icon: FileBarChart, label: "DRE Caixa", path: "/dre-caixa" },
        ],
      },
      {
        icon: Handshake,
        label: "Pós-venda",
        path: "/reputacao",
        noSelfLink: true,
        children: [
          { icon: Star,          label: "Reputação",  path: "/reputacao"  },
          { icon: PackageX,      label: "Reclamações", path: "/devolucoes" },
          { icon: MessageCircle, label: "Perguntas",  path: "/perguntas"  },
        ],
      },
      {
        icon: Settings2,
        label: "Configurações",
        path: "/metas",
        noSelfLink: true,
        children: [
          { icon: Target,   label: "Metas",          path: "/metas"          },
          { icon: Users,    label: "Sellers",        path: "/sellers"        },
          { icon: Plug,     label: "Integrações",    path: "/integracoes"    },
          { icon: FileText, label: "Fiscal",          path: "/fiscal"         },
        ],
      },
    ],
  },
];

export function ApiSidebar() {
  return <EnvironmentSidebar sections={apiSections} />;
}

