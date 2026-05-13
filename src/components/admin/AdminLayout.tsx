import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AreaChart, Building2, LayoutDashboard, LogOut, ShieldCheck, Users,
} from "lucide-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { to: "/admin",              label: "Visão geral",  icon: LayoutDashboard, end: true },
  { to: "/admin/organizacoes", label: "Organizações", icon: Building2 },
  { to: "/admin/usuarios",     label: "Usuários",     icon: Users },
];

export function AdminLayout() {
  const { signOut }  = useAdminAuth();
  const location     = useLocation();
  const navigate     = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex w-full bg-background">

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">

        {/* Brand */}
        <div className="flex items-center gap-3 overflow-hidden px-6 py-6">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
            <AreaChart className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="overflow-hidden whitespace-nowrap">
            <h1 className="text-base font-semibold tracking-tight">Analytics Pro</h1>
            <p className="text-xs text-sidebar-foreground/60 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              Super Admin
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4 gap-0.5 pt-2">
          {navItems.map((item) => {
            const isActive = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);

            return (
              <Tooltip key={item.to} delayDuration={0}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-glow"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <item.icon className="h-4.5 w-4.5 flex-shrink-0 h-5 w-5" />
                    {item.label}
                  </NavLink>
                </TooltipTrigger>
              </Tooltip>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 border-t border-sidebar-border/40 pt-3">
          <button
            onClick={handleSignOut}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Sair
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
