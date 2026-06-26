import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type AppRole = "owner" | "admin" | "member" | "viewer";

const STORAGE_KEY = "menu-visibility-config";

/** Routes that are HIDDEN per role (empty array = all visible) */
export type MenuVisibilityConfig = Record<AppRole, string[]>;

const DEFAULT_CONFIG: MenuVisibilityConfig = { owner: [], admin: [], member: [], viewer: [] };

/** All configurable menu items grouped by section — mirrors ApiSidebar */
export const MENU_SECTIONS = [
  {
    label: "Dashboard",
    items: [
      { label: "Vendas",      path: "/" },
      { label: "Publicidade", path: "/publicidade" },
      { label: "Margem",      path: "/financeiro" },
    ],
  },
  {
    label: "Operações",
    items: [
      { label: "Anúncios", path: "/anuncios" },
      { label: "Estoque",  path: "/estoque" },
      { label: "Compras",  path: "/compras" },
      { label: "Pedidos",  path: "/pedidos" },
      { label: "Precificação", path: "/precificacao" },
    ],
  },
  {
    label: "Pós-venda",
    items: [
      { label: "Reputação",  path: "/reputacao" },
      { label: "Devoluções", path: "/devolucoes" },
      { label: "Mensagens",  path: "/perguntas" },
    ],
  },
  {
    label: "Configurações",
    items: [
      { label: "Metas",       path: "/metas" },
      { label: "Sellers",     path: "/sellers" },
      { label: "Integrações", path: "/integracoes" },
    ],
  },
] as const;

function loadConfig(): MenuVisibilityConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_CONFIG;
}

interface MenuVisibilityContextType {
  config: MenuVisibilityConfig;
  isMenuItemVisible: (path: string, role: AppRole | null) => boolean;
  saveConfig: (config: MenuVisibilityConfig) => void;
}

const MenuVisibilityContext = createContext<MenuVisibilityContextType | undefined>(undefined);

export function MenuVisibilityProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<MenuVisibilityConfig>(loadConfig);

  const isMenuItemVisible = useCallback(
    (path: string, role: AppRole | null): boolean => {
      if (!role) return true; // no role = show everything (auth guards handle access)
      return !config[role].includes(path);
    },
    [config]
  );

  const saveConfig = useCallback((next: MenuVisibilityConfig) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setConfig(next);
  }, []);

  return (
    <MenuVisibilityContext.Provider value={{ config, isMenuItemVisible, saveConfig }}>
      {children}
    </MenuVisibilityContext.Provider>
  );
}

export function useMenuVisibility() {
  const ctx = useContext(MenuVisibilityContext);
  if (!ctx) throw new Error("useMenuVisibility must be used within MenuVisibilityProvider");
  return ctx;
}
