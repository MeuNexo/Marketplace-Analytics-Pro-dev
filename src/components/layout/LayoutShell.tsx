import { ReactNode, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { getRouteMeta } from "./routeMeta";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useOrganization } from "@/contexts/OrganizationContext";
import { PageLoader } from "@/components/ui/PageLoader";

interface LayoutShellProps {
  sidebar: ReactNode;
  mobileSidebar?: ReactNode;
  showSellerSwitcher?: boolean;
  showSellerMarketplaceBar?: boolean;
}

const HIDE_SELLER_SWITCHER_ROUTES = ["/sellers", "/integracoes"];
const HIDE_STORES_ROUTES: string[] = [];

export function LayoutShell({ sidebar, mobileSidebar, showSellerSwitcher = true, showSellerMarketplaceBar = false }: LayoutShellProps) {
  const location = useLocation();
  const { title, subtitle } = getRouteMeta(location.pathname);
  const hideSwitcher = HIDE_SELLER_SWITCHER_ROUTES.includes(location.pathname);
  const hideStores = HIDE_STORES_ROUTES.includes(location.pathname);
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { loading: orgLoading, currentOrg } = useOrganization();

  // Only show the full-screen loader on the very first load (when we don't
  // have an organization yet). Subsequent reloads of org data (e.g. after a
  // silent auth token refresh) keep the current UI visible to avoid a jarring
  // "Carregando…" flash every time the tab regains focus.
  if (orgLoading && !currentOrg) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      {!isMobile && sidebar}

      {/* Mobile sidebar drawer */}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-64 [&>button]:hidden">
            {/* Fecha o drawer apenas quando um LINK de navegação (<a>) é tocado.
                Tocar no trigger de um grupo colapsável (<button>, ex. "Operações")
                NÃO fecha — senão os itens aninhados (ex. Fluxo de Caixa) ficam
                inacessíveis no mobile, pois o grupo nunca consegue expandir. */}
            <div
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
              }}
              className="h-full"
            >
              {mobileSidebar ?? sidebar}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          subtitle={subtitle}
          showSellerSwitcher={!hideSwitcher && showSellerSwitcher}
          showSellerMarketplaceBar={(!hideSwitcher || hideStores) && showSellerMarketplaceBar}
          hideStores={hideStores}
          onMenuClick={isMobile ? () => setMobileOpen(true) : undefined}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
