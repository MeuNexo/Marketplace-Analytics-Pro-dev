import {
  Banknote,
  Target,
  ClipboardList,
  FileText,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Package,
  PackageX,
  Plug,
  Receipt,
  Calculator,
  Settings2,
  Handshake,
  ShoppingBag,
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
          { icon: TrendingUp,  label: "Vendas",      path: "/"            },
          { icon: Lightbulb,   label: "Consultor",   path: "/consultor"   },
          { icon: Megaphone,   label: "Publicidade", path: "/publicidade" },
          { icon: Receipt,     label: "Margem",      path: "/financeiro" },
        ],
      },
      {
        icon: Layers,
        label: "Operações",
        path: "/estoque",
        noSelfLink: true,
        children: [
          { icon: ShoppingBag,   label: "Anúncios", path: "/anuncios" },
          { icon: Package,       label: "Estoque",  path: "/estoque"  },
          { icon: ClipboardList, label: "Pedidos",  path: "/pedidos"  },
          { icon: Calculator,    label: "Precificação", path: "/precificacao" },
          { icon: Banknote,     label: "Fluxo de Caixa", path: "/fluxo-de-caixa" },
        ],
      },
      {
        icon: Handshake,
        label: "Pós-venda",
        path: "/reputacao",
        noSelfLink: true,
        children: [
          { icon: Star,          label: "Reputação",  path: "/reputacao"  },
          { icon: PackageX,      label: "Devoluções", path: "/devolucoes" },
          { icon: MessageCircle, label: "Mensagens",  path: "/perguntas"  },
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

