import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageLoader } from "@/components/ui/PageLoader";

/**
 * Guard exclusivo para /admin/*.
 * Exige apenas: sessão ativa + user_roles.role = 'admin'.
 * Não requer org membership. Redireciona para /admin/login se não autenticado.
 */
export function AdminProtectedRoute() {
  const { admin, loading } = useAdminAuth();

  if (loading) return <PageLoader />;
  if (!admin) return <Navigate to="/admin/login" replace />;

  return <Outlet />;
}
