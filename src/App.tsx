import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApiLayout } from "@/components/layout/ApiLayout";
import { SellerProvider } from "@/contexts/SellerContext";
import { MLInventoryProvider } from "@/contexts/MLInventoryContext";
import { MLStoreProvider } from "@/contexts/MLStoreContext";
import { HeaderScopeProvider } from "@/contexts/HeaderScopeContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { MenuVisibilityProvider } from "@/contexts/MenuVisibilityContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { RoleRoute } from "@/components/auth/RoleRoute";
import { AdminProtectedRoute } from "@/components/auth/AdminProtectedRoute";
import { TVRoleGuard } from "@/components/auth/TVRoleGuard";
import { OAuthCodeRedirect } from "@/components/auth/OAuthCodeRedirect";
import { PageLoader } from "@/components/ui/PageLoader";
import React, { Suspense } from "react";

const MercadoLivre       = React.lazy(() => import("./pages/MercadoLivre"));
const MLEstoque          = React.lazy(() => import("./pages/mercadolivre/MLEstoque"));
const NexoMemoria        = React.lazy(() => import("./pages/nexo/NexoMemoria"));
const MLAnuncios         = React.lazy(() => import("./pages/mercadolivre/MLAnuncios"));
const MLPedidos          = React.lazy(() => import("./pages/mercadolivre/MLPedidos"));
const MLPublicidade      = React.lazy(() => import("./pages/mercadolivre/MLPublicidade"));
const MLFinanceiro       = React.lazy(() => import("./pages/mercadolivre/MLFinanceiro"));
const MLReputacao        = React.lazy(() => import("./pages/mercadolivre/MLReputacao"));
const MLDevolucoes       = React.lazy(() => import("./pages/mercadolivre/MLDevolucoes"));
const MLPerguntas        = React.lazy(() => import("./pages/mercadolivre/MLPerguntas"));
const MLMetas            = React.lazy(() => import("./pages/mercadolivre/MLMetas"));
const MLPrecificacao     = React.lazy(() => import("./pages/mercadolivre/MLPrecificacao"));
const MLFiscal           = React.lazy(() => import("./pages/mercadolivre/MLFiscal"));
const MLConsultor        = React.lazy(() => import("./pages/mercadolivre/MLConsultor"));
const MLFluxoCaixa       = React.lazy(() => import("./pages/mercadolivre/MLFluxoCaixa"));
const MLDreCaixa         = React.lazy(() => import("./pages/mercadolivre/MLDreCaixa"));
const MLCompras          = React.lazy(() => import("./pages/mercadolivre/MLCompras"));
const MLProdutosVendidos = React.lazy(() => import("./pages/mercadolivre/MLProdutosVendidos"));
const MLAnalisePrecos    = React.lazy(() => import("./pages/mercadolivre/MLAnalisePrecos"));
const TVModeVendas       = React.lazy(() => import("./pages/TVModeVendas"));
const Sellers            = React.lazy(() => import("./pages/Sellers"));
const Profile            = React.lazy(() => import("./pages/Profile"));
const Integrations       = React.lazy(() => import("./pages/Integrations"));
const AdminMonitoring    = React.lazy(() => import("./pages/AdminMonitoring"));
const OrgSettings        = React.lazy(() => import("./pages/org/OrgSettings"));
const AcceptInvite       = React.lazy(() => import("./pages/AcceptInvite"));
const Login              = React.lazy(() => import("./pages/Login"));
const ResetPassword      = React.lazy(() => import("./pages/ResetPassword"));
const NotFound           = React.lazy(() => import("./pages/NotFound"));

const AdminLayout        = React.lazy(() => import("./components/admin/AdminLayout").then(m => ({ default: m.AdminLayout })));
const AdminLogin         = React.lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard     = React.lazy(() => import("./pages/admin/AdminDashboard"));
const AdminOrganizations = React.lazy(() => import("./pages/admin/AdminOrganizations"));
const AdminUsers         = React.lazy(() => import("./pages/admin/AdminUsers"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OAuthCodeRedirect>
        <Suspense fallback={<PageLoader />}>
          <Routes>

            {/* ── PAINEL ADMIN — auth stack separado, sem org ── */}
            {/* AdminAuthProvider encapsula apenas as rotas /admin/*.        */}
            {/* O admin não pertence a nenhuma org e não passa pelo          */}
            {/* ProtectedRoute / OrganizationContext do app principal.       */}
            <Route
              path="/admin/login"
              element={
                <AdminAuthProvider>
                  <AdminLogin />
                </AdminAuthProvider>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminAuthProvider>
                  <AdminProtectedRoute />
                </AdminAuthProvider>
              }
            >
              <Route element={<ErrorBoundary fallbackTitle="Erro no painel admin"><AdminLayout /></ErrorBoundary>}>
                <Route index element={<AdminDashboard />} />
                <Route path="organizacoes" element={<AdminOrganizations />} />
                <Route path="usuarios" element={<AdminUsers />} />
              </Route>
            </Route>

            {/* ── APP PRINCIPAL — auth com org obrigatória ── */}
            <Route
              path="*"
              element={
                <AuthProvider>
                  <OrganizationProvider>
                  <MenuVisibilityProvider>
                  <SellerProvider>
                    <SettingsProvider>
                      <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/aceitar-convite" element={<AcceptInvite />} />
                        <Route element={<ProtectedRoute />}>
                          {/* Modo TV */}
                          <Route path="/tv" element={<TVRoleGuard><ErrorBoundary fallbackTitle="Erro no Modo TV"><TVModeVendas /></ErrorBoundary></TVRoleGuard>} />

                          {/* Marketplaces */}
                          <Route element={<HeaderScopeProvider><MLStoreProvider><MLInventoryProvider><ApiLayout /></MLInventoryProvider></MLStoreProvider></HeaderScopeProvider>}>
                            <Route path="/perfil" element={<Profile />} />
                            <Route path="/" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Vendas"><MercadoLivre /></ErrorBoundary></RoleRoute>} />
                            <Route path="/estoque" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Estoque"><MLEstoque /></ErrorBoundary></RoleRoute>} />
                            <Route path="/anuncios" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Anúncios"><MLAnuncios /></ErrorBoundary></RoleRoute>} />
                            <Route path="/pedidos" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Pedidos"><MLPedidos /></ErrorBoundary></RoleRoute>} />
                            <Route path="/publicidade" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Publicidade"><MLPublicidade /></ErrorBoundary></RoleRoute>} />
                            <Route path="/financeiro" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página Financeiro"><MLFinanceiro /></ErrorBoundary></RoleRoute>} />
                            <Route path="/reputacao" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Reputação"><MLReputacao /></ErrorBoundary></RoleRoute>} />
                            <Route path="/devolucoes" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Devoluções"><MLDevolucoes /></ErrorBoundary></RoleRoute>} />
                            <Route path="/perguntas" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Perguntas"><MLPerguntas /></ErrorBoundary></RoleRoute>} />
                            <Route path="/metas" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Metas"><MLMetas /></ErrorBoundary></RoleRoute>} />
                            <Route path="/precificacao" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página de Precificação"><MLPrecificacao /></ErrorBoundary></RoleRoute>} />
                            <Route path="/precos-custos" element={<Navigate to="/precificacao" replace />} />
                            <Route path="/sellers" element={<RoleRoute><Sellers /></RoleRoute>} />
                            <Route path="/integracoes" element={<RoleRoute><Integrations /></RoleRoute>} />
                            <Route path="/fiscal" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na página Fiscal"><MLFiscal /></ErrorBoundary></RoleRoute>} />
                            <Route path="/consultor" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro no Consultor"><MLConsultor /></ErrorBoundary></RoleRoute>} />
                            <Route path="/fluxo-de-caixa" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro no Fluxo de Caixa"><MLFluxoCaixa /></ErrorBoundary></RoleRoute>} />
                            <Route path="/dre-caixa" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na DRE Caixa"><MLDreCaixa /></ErrorBoundary></RoleRoute>} />
                            <Route path="/compras" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro em Compras"><MLCompras /></ErrorBoundary></RoleRoute>} />
                            <Route path="/produtos-vendidos" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro em Produtos Vendidos"><MLProdutosVendidos /></ErrorBoundary></RoleRoute>} />
                            <Route path="/analise-precos" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro em Análise de Preços"><MLAnalisePrecos /></ErrorBoundary></RoleRoute>} />
                            <Route path="/nexo-memoria" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro na Memória do Nexo"><NexoMemoria /></ErrorBoundary></RoleRoute>} />
                            <Route path="/organizacao" element={<RoleRoute><OrgSettings /></RoleRoute>} />
                            <Route path="/usuarios" element={<Navigate to="/organizacao" replace />} />
                            <Route path="/monitoramento" element={<RoleRoute><ErrorBoundary fallbackTitle="Erro no Monitoramento"><AdminMonitoring /></ErrorBoundary></RoleRoute>} />
                          </Route>
                        </Route>
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </SettingsProvider>
                  </SellerProvider>
                  </MenuVisibilityProvider>
                  </OrganizationProvider>
                </AuthProvider>
              }
            />

          </Routes>
        </Suspense>
        </OAuthCodeRedirect>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
