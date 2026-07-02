import { Activity, Bell, Check, ChevronDown, LogOut, Menu, Settings, Store, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSeller } from "@/contexts/SellerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { SellerMarketplaceBar } from "./SellerMarketplaceBar";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { ThemeToggle } from "./ThemeToggle";

interface HeaderProps {
  title: string;
  subtitle?: string;
  showSellerSwitcher?: boolean;
  showSellerMarketplaceBar?: boolean;
  hideStores?: boolean;
  onMenuClick?: () => void;
}

export function Header({ title, subtitle, showSellerSwitcher = true, showSellerMarketplaceBar = false, hideStores = false, onMenuClick }: HeaderProps) {
  const { selectedSeller, setSelectedSeller, activeSellers } = useSeller();
  const { profile, signOut, role: appRole } = useAuth();
  const { orgRole } = useOrganization();
  const navigate = useNavigate();

  const profilePath = "/perfil";
  const orgPath = "/organizacao";
  const displayName = profile?.full_name || "Usuário";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const roleLabel =
    orgRole === "owner" ? "Owner" :
    orgRole === "admin" ? "Admin" :
    orgRole === "member" ? "Member" : "Viewer";
  const isOrgAdmin = orgRole === "owner" || orgRole === "admin";

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-3 md:px-8 py-2.5 md:py-4 gap-2">
      <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1 overflow-hidden">
        {onMenuClick && (
          <Button variant="ghost" size="icon" className="shrink-0 rounded-xl hover:bg-secondary/50 md:hidden" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <div className="shrink-0 max-w-[140px] sm:max-w-none">
          <OrganizationSwitcher />
        </div>
        {showSellerMarketplaceBar && !hideStores ? (
          <div className="min-w-0 shrink-0 overflow-hidden">
            <SellerMarketplaceBar showStores />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 md:gap-3 shrink-0">
        {showSellerSwitcher && !showSellerMarketplaceBar && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 md:h-10 gap-2 md:gap-2.5 rounded-xl border-0 bg-secondary/50 px-2 md:px-3 hover:bg-secondary"
              >
                {selectedSeller?.logo_url ? (
                  <img
                    src={selectedSeller.logo_url}
                    alt={selectedSeller.name}
                    className="h-6 w-6 md:h-7 md:w-7 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    className="flex h-6 w-6 md:h-7 md:w-7 items-center justify-center rounded-lg text-[10px] md:text-[11px] font-bold text-accent-foreground"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    {selectedSeller?.initials ?? selectedSeller?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="hidden sm:inline text-sm font-medium text-foreground">{selectedSeller?.name ?? "Seller"}</span>
                <ChevronDown className="ml-0.5 h-3.5 w-3.5 text-muted-foreground mx-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
              <DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Store className="h-3.5 w-3.5" />
                Trocar Seller
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {activeSellers.map((seller) => {
                const isActive = seller.id === selectedSeller?.id;

                return (
                  <DropdownMenuItem
                    key={seller.id}
                    onClick={() => setSelectedSeller(seller.id)}
                    className={`cursor-pointer gap-2.5 rounded-lg px-2 py-2 hover:bg-muted focus:bg-muted ${isActive ? "bg-muted" : ""}`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg overflow-hidden ${
                        isActive && !seller.logo_url ? "text-accent-foreground" : !seller.logo_url ? "bg-secondary text-secondary-foreground" : ""
                      }`}
                      style={isActive && !seller.logo_url ? { background: "var(--gradient-primary)" } : undefined}
                    >
                      {seller.logo_url ? (
                        <img src={seller.logo_url} alt={seller.name} className="h-7 w-7 rounded-lg object-cover" />
                      ) : (
                        <span className="text-[11px] font-bold">{seller.initials ?? seller.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "?"}</span>
                      )}
                    </div>
                    <span className={`flex-1 text-sm ${isActive ? "font-semibold" : "font-medium"}`}>
                      {seller.name}
                    </span>
                    {isActive && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <ThemeToggle />

        <Button variant="ghost" size="icon" className="relative rounded-xl hover:bg-secondary/50">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 md:gap-3 rounded-xl pl-2 pr-2 md:pr-4 hover:bg-secondary/50 hover:text-foreground">
              <Avatar className="h-8 w-8">
                <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
                <AvatarFallback className="bg-accent text-sm font-medium text-accent-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground font-normal">Minha Conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate(profilePath)} className="rounded-lg px-2 py-2 text-sm hover:bg-muted focus:bg-muted">
              <User className="mr-2 h-4 w-4 text-muted-foreground" />
              Perfil
            </DropdownMenuItem>
            {isOrgAdmin && (
              <DropdownMenuItem onClick={() => navigate(orgPath)} className="rounded-lg px-2 py-2 text-sm hover:bg-muted focus:bg-muted">
                <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
                Organização
              </DropdownMenuItem>
            )}
            {isOrgAdmin && (
              <DropdownMenuItem onClick={() => navigate("/monitoramento")} className="rounded-lg px-2 py-2 text-sm hover:bg-muted focus:bg-muted">
                <Activity className="mr-2 h-4 w-4 text-muted-foreground" />
                Monitoramento
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg px-2 py-2 text-sm text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
