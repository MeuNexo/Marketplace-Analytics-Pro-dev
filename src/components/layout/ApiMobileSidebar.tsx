import {
  Target,
  ArrowLeft,
  Banknote,
  Calculator,
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
  Settings2,
  Handshake,
  ShoppingBag,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const sections = [
  {
    label: "Dashboard",
    items: [
      { icon: TrendingUp,  label: "Vendas",      path: "/"            },
      { icon: Lightbulb,   label: "Consultor",   path: "/consultor"   },
      { icon: Megaphone,   label: "Publicidade", path: "/publicidade" },
      { icon: Receipt,     label: "Margem",      path: "/financeiro" },
    ],
  },
  {
    label: "Operações",
    items: [
      { icon: ShoppingBag,   label: "Anúncios",     path: "/anuncios"      },
      { icon: Package,       label: "Estoque",      path: "/estoque"       },
      { icon: ClipboardList, label: "Pedidos",      path: "/pedidos"       },
      { icon: Calculator,    label: "Precificação", path: "/precificacao"  },
      { icon: Banknote,      label: "Fluxo de Caixa", path: "/fluxo-de-caixa" },
    ],
  },
  {
    label: "Pós-venda",
    items: [
      { icon: Star,          label: "Reputação",  path: "/reputacao"  },
      { icon: PackageX,      label: "Devoluções", path: "/devolucoes" },
      { icon: MessageCircle, label: "Mensagens",  path: "/perguntas"  },
    ],
  },
  {
    label: "Configurações",
    items: [
      { icon: Target,   label: "Metas",       path: "/metas"       },
      { icon: Users,    label: "Sellers",     path: "/sellers"     },
      { icon: Plug,     label: "Integrações", path: "/integracoes" },
      { icon: FileText, label: "Fiscal",      path: "/fiscal"      },
    ],
  },
];

export function ApiMobileSidebar() {
  const location = useLocation();

  return (
    <nav className="flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-y-auto">
      <div className="px-5 py-5">
        <h2 className="text-lg font-semibold tracking-tight">Analytics Pro</h2>
        <p className="text-xs text-sidebar-foreground/60">Marketplace</p>
      </div>

      <div className="flex-1 px-3 space-y-4">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-4 border-t border-sidebar-border/40">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all"
        >
          <ArrowLeft className="h-5 w-5 shrink-0" />
          Voltar ao painel
        </Link>
      </div>
    </nav>
  );
}
