import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { PageLoader } from "@/components/ui/PageLoader";

export function ProtectedRoute() {
  const { user, role, loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrganization();

  const isSuperAdmin = role === "admin";

  if (authLoading || orgLoading) {
    return <PageLoader />;
  }

  if (!user) return <Navigate to="/login" replace />;

  // Super-admin accessing a main-app route → send to admin panel
  if (isSuperAdmin && !currentOrg) {
    return <Navigate to="/admin" replace />;
  }

  // Authenticated, no org, not super-admin → send to the self-service
  // creation screen instead of signing them out (T-209-13). Signing out is
  // exactly what made any creation screen unreachable — it re-enters this
  // same branch on next login, in a loop, until an org is created out of
  // band. `/criar-organizacao` is a sibling route outside this guard.
  if (!currentOrg) {
    return <Navigate to="/criar-organizacao" replace />;
  }

  return <Outlet />;
}
