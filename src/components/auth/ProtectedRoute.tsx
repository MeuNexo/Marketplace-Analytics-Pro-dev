import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { PageLoader } from "@/components/ui/PageLoader";

export function ProtectedRoute() {
  const { user, role, loading: authLoading, signOut } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrganization();
  const revokingAccessRef = useRef(false);

  const isSuperAdmin = role === "admin";

  useEffect(() => {
    // Super-admins have no org — don't sign them out; redirect to /admin instead.
    if (authLoading || orgLoading || !user || currentOrg || isSuperAdmin || revokingAccessRef.current) {
      return;
    }

    revokingAccessRef.current = true;
    void signOut();
  }, [authLoading, currentOrg, isSuperAdmin, orgLoading, signOut, user]);

  if (authLoading || orgLoading) {
    return <PageLoader />;
  }

  if (!user) return <Navigate to="/login" replace />;

  // Super-admin accessing a main-app route → send to admin panel
  if (isSuperAdmin && !currentOrg) {
    return <Navigate to="/admin" replace />;
  }

  if (!currentOrg) {
    return <PageLoader />;
  }

  return <Outlet />;
}
