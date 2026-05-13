import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useMLStore } from "@/contexts/MLStoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useSeller } from "@/contexts/SellerContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { SellerMarketplaceBar } from "@/components/layout/SellerMarketplaceBar";
import { KPICard } from "@/components/dashboard/KPICard";
import { Seller } from "@/types/seller";
import { supabase } from "@/integrations/supabase/client";
import { getMarketplaceBrand, SELLER_TO_MP_ID } from "@/config/marketplaceConfig";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Link2Off,
  RefreshCw,
  ShieldCheck,
  Zap,
  DollarSign,
  ShoppingCart,
  Tag,
  TrendingUp,
  Store,
  Pencil,
  Check as CheckIcon,
  X,
  Building2,
} from "lucide-react";

interface MarketplaceIntegration {
  id: string;
  name: string;
  logo: string;
  description: string;
  status: "connected" | "disconnected" | "expired";
  authType: "oauth" | "api_key";
  docsUrl: string;
  features: string[];
}

const MARKETPLACE_INTEGRATIONS: MarketplaceIntegration[] = [
  {
    id: "ml",
    name: "Mercado Livre",
    logo: "🟡",
    description: "Sincronize pedidos, vendas e métricas diretamente da sua conta do Mercado Livre.",
    status: "disconnected",
    authType: "oauth",
    docsUrl: "https://developers.mercadolivre.com.br",
    features: ["Pedidos", "Vendas", "Métricas", "Anúncios"],
  },
];

const statusConfig = {
  connected: {
    label: "Conectado",
    variant: "default" as const,
    icon: CheckCircle2,
    color: "text-emerald-500",
  },
  disconnected: {
    label: "Desconectado",
    variant: "secondary" as const,
    icon: Link2Off,
    color: "text-muted-foreground",
  },
  expired: {
    label: "Token expirado",
    variant: "destructive" as const,
    icon: AlertCircle,
    color: "text-destructive",
  },
};

export default function Integrations() {
  const { selectedSeller, refreshSellers } = useSeller();
  const { currentOrg } = useOrganization();
  const { stores: mlStores, refresh: refreshMLStores } = useMLStore();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [integrations, setIntegrations] = useState(() => {
    const saved = localStorage.getItem("ml_integration_status");
    if (saved) {
      const statuses = JSON.parse(saved) as Record<string, string>;
      return MARKETPLACE_INTEGRATIONS.map((i) => ({
        ...i,
        status: (statuses[i.id] as MarketplaceIntegration["status"]) || i.status,
      }));
    }
    return MARKETPLACE_INTEGRATIONS;
  });
  const [connectDialog, setConnectDialog] = useState<MarketplaceIntegration | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [mlCodeDialog, setMlCodeDialog] = useState(false);
  const [mlCodeInput, setMlCodeInput] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [disconnectPassword, setDisconnectPassword] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editingStoreName, setEditingStoreName] = useState("");
  const [mlMetrics, setMlMetrics] = useState<{
    total_revenue: number;
    approved_revenue: number;
    total_orders: number;
    cancelled_orders: number;
    shipped_orders: number;
    active_listings: number;
    avg_ticket: number;
    period: string;
  } | null>(() => {
    const saved = localStorage.getItem("ml_metrics");
    return saved ? JSON.parse(saved) : null;
  });
  const [mlUser, setMlUser] = useState<{ nickname: string } | null>(() => {
    const saved = localStorage.getItem("ml_user");
    return saved ? JSON.parse(saved) : null;
  });

  // Persist integration statuses
  const updateIntegrationStatus = (id: string, status: MarketplaceIntegration["status"]) => {
    setIntegrations((prev) => {
      const updated = prev.map((i) => (i.id === id ? { ...i, status } : i));
      const statuses: Record<string, string> = {};
      updated.forEach((i) => (statuses[i.id] = i.status));
      localStorage.setItem("ml_integration_status", JSON.stringify(statuses));
      return updated;
    });
  };

  // Helper: save ML tokens to Supabase only (no localStorage for tokens)
  const saveMLTokens = async (tokenData: { access_token: string; refresh_token: string; expires_in: number; user_id: string }) => {
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    localStorage.removeItem("ml_pkce_code_verifier");
    // Clean up legacy localStorage tokens
    localStorage.removeItem("ml_tokens");

    // Upsert to Supabase ml_tokens table using (user_id, ml_user_id) constraint
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;
      const mlUserId = String(tokenData.user_id);

      // Use persisted seller from before OAuth redirect as fallback
      const sellerId = selectedSeller?.id || localStorage.getItem("ml_oauth_seller_id") || null;
      // Clean up the persisted seller
      localStorage.removeItem("ml_oauth_seller_id");

      const organizationId = currentOrg?.id ?? null;

      const { error: upsertErr } = await supabase.from("ml_tokens").upsert(
        {
          user_id: userId,
          organization_id: organizationId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          ml_user_id: mlUserId,
          token_type: "bearer",
          seller_id: sellerId,
        },
        { onConflict: "user_id,ml_user_id" },
      );

      if (upsertErr) {
        console.error("Failed to upsert ml_tokens:", upsertErr);
        throw new Error(`Erro ao salvar token: ${upsertErr.message}`);
      }

      // Sync seller_stores.external_id so the header store filter works.
      if (sellerId) {
        const { data: existing } = await supabase
          .from("seller_stores")
          .select("id")
          .eq("seller_id", sellerId)
          .eq("marketplace", "ml")
          .eq("external_id", mlUserId)
          .maybeSingle();

        if (!existing) {
          const { data: unclaimed } = await supabase
            .from("seller_stores")
            .select("id")
            .eq("seller_id", sellerId)
            .eq("marketplace", "ml")
            .is("external_id", null)
            .limit(1)
            .maybeSingle();

          if (unclaimed) {
            await supabase
              .from("seller_stores")
              .update({ external_id: mlUserId })
              .eq("id", unclaimed.id);
          } else {
            await supabase.from("seller_stores").insert({
              seller_id: sellerId,
              marketplace: "ml",
              external_id: mlUserId,
              store_name: `Loja ML ${mlUserId}`,
              is_active: true,
            });
          }
          await refreshSellers();
        }
      }
    } catch (e) {
      console.error("Failed to save ML tokens to DB:", e);
      throw e; // propaga para o chamador mostrar o erro ao usuário
    }
  };

  // Helper: refresh token via ml-oauth and update DB + localStorage
  const refreshMLToken = async (refreshToken: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke("ml-oauth", {
        body: { action: "refresh_token", refresh_token: refreshToken },
      });
      if (error || !data?.success) {
        console.error("ML token refresh failed:", data?.error || error?.message);
        return false;
      }
      await saveMLTokens(data);
      updateIntegrationStatus("ml", "connected");
      return true;
    } catch (e) {
      console.error("ML token refresh error:", e);
      return false;
    }
  };

  // Check for existing ML tokens on mount (DB only, no localStorage)
  useEffect(() => {
    const checkTokens = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: dbTokens } = await supabase
          .from("ml_tokens")
          .select("ml_user_id, expires_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const firstToken = dbTokens?.[0];
        if (!firstToken) {
          updateIntegrationStatus("ml", "disconnected");
          return;
        }

        const expiresAt = firstToken.expires_at ? new Date(firstToken.expires_at).getTime() : 0;
        if (expiresAt > Date.now()) {
          updateIntegrationStatus("ml", "connected");
        } else {
          updateIntegrationStatus("ml", "expired");
        }
      } catch (e) { /* ignore */ }
    };
    checkTokens();
  }, []);

  // Handle ML OAuth callback
  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;

    setMlCodeInput(code);
    setMlCodeDialog(true);

    const exchangeCode = async () => {
      setConnecting(true);
      const redirectUri = "https://analytics.alcavie.com/integracoes";
      const codeVerifier = localStorage.getItem("ml_pkce_code_verifier") || undefined;

      const { data, error } = await supabase.functions.invoke("ml-oauth", {
        body: { action: "exchange_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier },
      });

      if (error || !data?.success) {
        toast({
          title: "Erro ao conectar Mercado Livre",
          description: data?.error || error?.message || "Falha na troca do código.",
          variant: "destructive",
        });
        setConnecting(false);
        return;
      }

      await saveMLTokens(data);
      updateIntegrationStatus("ml", "connected");
      toast({ title: "Mercado Livre conectado!", description: `Conta conectada com sucesso (User ID: ${data.user_id}).` });
      setSearchParams({}, { replace: true });
      setMlCodeDialog(false);
      setMlCodeInput("");
      setConnecting(false);
    };

    exchangeCode();
  }, [searchParams, setSearchParams, toast]);

  const handleConnect = async (integration: MarketplaceIntegration) => {
    if (integration.id === "ml") {
      const redirectUri = "https://analytics.alcavie.com/integracoes";
      const { data, error } = await supabase.functions.invoke("ml-oauth", {
        body: { action: "get_auth_url", redirect_uri: redirectUri },
      });

      if (error || !data?.success) {
        toast({
          title: "Erro",
          description: "Não foi possível gerar a URL de autorização.",
          variant: "destructive",
        });
        return;
      }

      if (data.code_verifier) {
        localStorage.setItem("ml_pkce_code_verifier", data.code_verifier);
      }

      // Persist selected seller so it survives the OAuth redirect
      if (selectedSeller?.id) {
        localStorage.setItem("ml_oauth_seller_id", selectedSeller.id);
      }

      window.location.href = data.auth_url;
      return;
    }


    // Other marketplaces: show dialog
    setConnectDialog(integration);
    setApiKeyInput("");
  };

  const handleDisconnect = async (integrationId: string) => {
    if (integrationId === "ml") {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("ml_tokens").delete().eq("user_id", user.id);
          await supabase.from("ml_user_cache").delete().eq("user_id", user.id);
        }
      } catch (e) {
        console.error("Failed to delete ML tokens from DB:", e);
      }
      // Clean up any legacy localStorage
      localStorage.removeItem("ml_tokens");
      localStorage.removeItem("ml_metrics");
      localStorage.removeItem("ml_user");
      setMlMetrics(null);
      setMlUser(null);
    }
    updateIntegrationStatus(integrationId, "disconnected");
    toast({
      title: "Marketplace desconectado",
      description: "A integração foi removida com sucesso.",
    });
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectTarget || !disconnectPassword.trim()) return;
    setDisconnecting(true);
    setDisconnectError("");

    try {
      // Verify password by re-authenticating
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setDisconnectError("Não foi possível verificar o usuário.");
        setDisconnecting(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: disconnectPassword,
      });

      if (error) {
        setDisconnectError("Senha incorreta. Tente novamente.");
        setDisconnecting(false);
        return;
      }

      // Password verified, proceed with disconnect
      await handleDisconnect(disconnectTarget);
      setDisconnectTarget(null);
      setDisconnectPassword("");
    } catch (e) {
      setDisconnectError("Erro ao verificar senha.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConfirmConnect = async () => {
    if (!connectDialog) return;
    setConnecting(true);

    // Simulate connection for non-ML marketplaces
    await new Promise((resolve) => setTimeout(resolve, 1500));

    updateIntegrationStatus(connectDialog.id, "connected");

    setConnecting(false);
    setConnectDialog(null);
    toast({
      title: "Marketplace conectado!",
      description: `${connectDialog.name} foi integrado com sucesso para ${selectedSeller?.name ?? "o seller ativo"}.`,
    });
  };

  const handleSyncML = async () => {
    setSyncing(true);
    try {
      // Use ml_user_id from MLStoreContext instead of access_token from localStorage
      const firstStore = mlStores[0];
      if (!firstStore) {
        toast({
          title: "Erro",
          description: "Nenhuma conta do Mercado Livre conectada. Conecte-se primeiro.",
          variant: "destructive",
        });
        return;
      }

      const today = new Date().toISOString().substring(0, 10);
      const { data, error } = await supabase.functions.invoke("mercado-libre-integration", {
        body: { ml_user_id: firstStore.ml_user_id, date_from: today, date_to: today, seller_id: selectedSeller?.id || null },
      });

      if (error || !data?.success) {
        toast({
          title: "Erro ao sincronizar",
          description: data?.error || error?.message || "Falha ao buscar dados do Mercado Livre.",
          variant: "destructive",
        });
      } else {
        setMlMetrics(data.metrics);
        setMlUser(data.user);
        toast({
          title: "Sincronização concluída!",
          description: `Dados do Mercado Livre importados com sucesso.`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Erro inesperado na sincronização.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleManualCodeExchange = async () => {
    if (!mlCodeInput.trim()) return;
    setConnecting(true);
    const redirectUri = "https://analytics.alcavie.com/integracoes";
    const codeVerifier = localStorage.getItem("ml_pkce_code_verifier") || undefined;

    const { data, error } = await supabase.functions.invoke("ml-oauth", {
      body: { action: "exchange_code", code: mlCodeInput.trim(), redirect_uri: redirectUri, code_verifier: codeVerifier },
    });

    if (error || !data?.success) {
      toast({
        title: "Erro ao trocar código",
        description: data?.error || error?.message || "Falha na troca do código de autorização.",
        variant: "destructive",
      });
    } else {
      await saveMLTokens(data);
      updateIntegrationStatus("ml", "connected");
      toast({
        title: "Mercado Livre conectado!",
        description: `Conta conectada com sucesso (User ID: ${data.user_id}).`,
      });
    }

    setConnecting(false);
    setMlCodeDialog(false);
    setMlCodeInput("");
  };

  const handleRenameStore = async (mlUserId: string) => {
    if (!editingStoreName.trim()) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const newName = editingStoreName.trim();
      // Update custom_name in ml_user_cache
      await supabase
        .from("ml_user_cache")
        .update({ custom_name: newName })
        .eq("user_id", user.id)
        .eq("ml_user_id", Number(mlUserId));
      // Also update store_name in seller_stores so the header selector reflects the change
      if (selectedSeller?.id) {
        await supabase
          .from("seller_stores")
          .update({ store_name: newName })
          .eq("seller_id", selectedSeller.id)
          .eq("marketplace", "ml")
          .eq("external_id", mlUserId);
      }
      setEditingStoreId(null);
      setEditingStoreName("");
      await refreshMLStores();
      await refreshSellers();
      toast({ title: "Nome atualizado!", description: "O nome da loja foi alterado com sucesso." });
    } catch (e) {
      toast({ title: "Erro", description: "Não foi possível renomear a loja.", variant: "destructive" });
    }
  };

  const handleResetStoreName = async (mlUserId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Reset custom_name in ml_user_cache
      await supabase
        .from("ml_user_cache")
        .update({ custom_name: null })
        .eq("user_id", user.id)
        .eq("ml_user_id", Number(mlUserId));
      // Also reset store_name in seller_stores to the nickname
      if (selectedSeller?.id) {
        const { data: cacheRow } = await supabase
          .from("ml_user_cache")
          .select("nickname")
          .eq("user_id", user.id)
          .eq("ml_user_id", Number(mlUserId))
          .maybeSingle();
        const fallbackName = cacheRow?.nickname || `Loja ML ${mlUserId}`;
        await supabase
          .from("seller_stores")
          .update({ store_name: fallbackName })
          .eq("seller_id", selectedSeller.id)
          .eq("marketplace", "ml")
          .eq("external_id", mlUserId);
      }
      await refreshMLStores();
      await refreshSellers();
      toast({ title: "Nome resetado!", description: "O nome voltou ao padrão do Mercado Livre." });
    } catch (e) {
      toast({ title: "Erro", description: "Não foi possível resetar o nome.", variant: "destructive" });
    }
  };

  const sellerMarketplaces = [...new Set((selectedSeller?.stores ?? []).map((s) => s.marketplace))].filter((id) => id !== "total");
  const filteredIntegrations = integrations.filter((i) => sellerMarketplaces.includes(i.id));
  const connectedCount = filteredIntegrations.filter((i) => i.status === "connected").length;
  const connectedMarketplaceIds = new Set(filteredIntegrations.filter((i) => i.status === "connected").map((i) => i.id));
  const connectedStoresCount = (selectedSeller?.stores ?? []).filter((s) => connectedMarketplaceIds.has(s.marketplace)).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Integrações</h1>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Conecte suas contas de marketplaces para sincronizar dados automaticamente
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KPICard
          title="Marketplaces conectados"
          value={String(connectedCount)}
          icon={<Link2 className="w-4 h-4" />}
          variant="minimal"
          size="compact"
        />
        <KPICard
          title="Lojas conectadas"
          value={String(connectedStoresCount)}
          icon={<Store className="w-4 h-4" />}
          variant="minimal"
          size="compact"
        />
        <KPICard
          title="Disponíveis"
          value={String(filteredIntegrations.length - connectedCount)}
          icon={<Building2 className="w-4 h-4" />}
          variant="minimal"
          size="compact"
        />
        <KPICard
          title="Autenticação"
          value="OAuth 2.0"
          subtitle="Segura"
          icon={<ShieldCheck className="w-4 h-4" />}
          variant="minimal"
          size="compact"
        />
      </div>

      {/* Seller info + selector */}
      {selectedSeller && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted/50 border border-border text-sm flex-wrap">
          <span className="font-medium">Seller ativo:</span>
          <Badge variant="outline">{selectedSeller.name}</Badge>
          <span className="text-muted-foreground">— As integrações abaixo serão vinculadas a este seller.</span>
          <div className="ml-auto">
            <SellerMarketplaceBar showStores={false} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredIntegrations.map((integration) => {
          const statusInfo = statusConfig[integration.status];
          const StatusIcon = statusInfo.icon;
          const isConnected = integration.status === "connected";

          return (
            <Card
              key={integration.id}
              className={`transition-all duration-300 ease-in-out rounded-xl border shadow-sm hover:shadow-md ${
                isConnected ? "border-primary/40 bg-primary/[0.02]" : "border-border"
              }`}
            >
              <CardHeader className="pb-2">
                 <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {(() => {
                      const brand = getMarketplaceBrand(integration.id);
                      if (brand) {
                        const BrandIcon = brand.icon;
                        return (
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${brand.gradient}`}>
                            <BrandIcon className="h-5 w-5 text-white" />
                          </div>
                        );
                      }
                      return <span className="text-3xl">{integration.logo}</span>;
                    })()}
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-medium text-foreground truncate">{integration.name}</CardTitle>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <StatusIcon className={`w-3 h-3 ${statusInfo.color}`} />
                        <span className={`text-[11px] ${statusInfo.color}`}>{statusInfo.label}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5 font-normal shrink-0">
                    {integration.authType === "oauth" ? "OAuth" : "API Key"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription className="text-xs leading-relaxed">
                  {integration.description}
                </CardDescription>

                <div className="flex flex-wrap gap-1.5">
                  {integration.features.map((feature) => (
                    <Badge key={feature} variant="secondary" className="text-[10px] font-normal h-5">
                      {feature}
                    </Badge>
                  ))}
                </div>

                {/* ML connected stores list with rename */}
                {integration.id === "ml" && isConnected && mlStores.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground">Lojas conectadas ({mlStores.length})</p>
                    {mlStores.map((store) => (
                      <div key={store.ml_user_id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${getMarketplaceBrand("ml")?.gradient ?? "from-[#e6b422] to-[#c9981a]"}`}>
                          <Store className="h-3 w-3 text-white" />
                        </div>
                        {editingStoreId === store.ml_user_id ? (
                          <>
                            <Input
                              value={editingStoreName}
                              onChange={(e) => setEditingStoreName(e.target.value)}
                              className="h-7 text-xs flex-1"
                              placeholder="Nome da loja"
                              onKeyDown={(e) => e.key === "Enter" && handleRenameStore(store.ml_user_id)}
                              autoFocus
                            />
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRenameStore(store.ml_user_id)}>
                              <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingStoreId(null)}>
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-medium flex-1 truncate">
                              {store.displayName}
                              {store.custom_name && store.nickname && (
                                <span className="text-muted-foreground font-normal ml-1">({store.nickname})</span>
                              )}
                            </span>
                            {store.custom_name && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleResetStoreName(store.ml_user_id)}
                                title="Voltar ao nome padrão"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingStoreId(store.ml_user_id);
                                setEditingStoreName(store.custom_name || store.nickname || "");
                              }}
                              title="Renomear loja"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  {isConnected ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => { setDisconnectTarget(integration.id); setDisconnectPassword(""); setDisconnectError(""); }}
                      >
                        <Link2Off className="w-4 h-4 mr-1.5" />
                        Desconectar
                      </Button>
                      {integration.id === "ml" && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleConnect(integration)} title="Adicionar outra loja ML">
                            <Store className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleSyncML} disabled={syncing} title="Sincronizar pedidos e vendas">
                            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleConnect(integration)}
                      >
                        <Link2 className="w-4 h-4 mr-1.5" />
                        Conectar
                      </Button>
                      {(integration.id === "ml") && (
                        <Button variant="outline" size="sm" onClick={() => setMlCodeDialog(true)} title="Colar código manualmente">
                          📋
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" asChild>
                        <a href={integration.docsUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Connect Dialog */}
      <Dialog open={!!connectDialog} onOpenChange={(open) => !open && setConnectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">{connectDialog?.logo}</span>
              Conectar {connectDialog?.name}
            </DialogTitle>
            <DialogDescription>
              {connectDialog?.authType === "oauth"
                ? `Você será redirecionado para autorizar o acesso à sua conta do ${connectDialog?.name}. Nenhuma senha será armazenada.`
                : `Insira sua chave de API do ${connectDialog?.name} para habilitar a sincronização de dados.`}
            </DialogDescription>
          </DialogHeader>

          {connectDialog?.authType === "api_key" && (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label htmlFor="api-key">Chave de API</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="Cole sua chave de API aqui..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sua chave será armazenada de forma segura e criptografada no servidor.
              </p>
            </div>
          )}

          {connectDialog?.authType === "oauth" && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
              <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Autenticação segura via OAuth 2.0</p>
                <p className="text-muted-foreground mt-0.5">
                  Seus dados de login nunca passam pelo nosso sistema.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialog(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmConnect}
              disabled={connecting || (connectDialog?.authType === "api_key" && !apiKeyInput.trim())}
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  Conectando...
                </>
              ) : connectDialog?.authType === "oauth" ? (
                <>
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  Autorizar acesso
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-1.5" />
                  Salvar e conectar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={!!disconnectTarget} onOpenChange={(open) => { if (!open) { setDisconnectTarget(null); setDisconnectPassword(""); setDisconnectError(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Confirmar desconexão
            </DialogTitle>
            <DialogDescription>
              Para desconectar esta integração, digite sua senha para confirmar. Todos os tokens e dados de cache serão removidos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="disconnect-password">Senha</Label>
              <Input
                id="disconnect-password"
                type="password"
                placeholder="Digite sua senha..."
                value={disconnectPassword}
                onChange={(e) => { setDisconnectPassword(e.target.value); setDisconnectError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && disconnectPassword.trim()) handleConfirmDisconnect(); }}
              />
              {disconnectError && (
                <p className="text-xs text-destructive">{disconnectError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectTarget(null)} disabled={disconnecting}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDisconnect}
              disabled={disconnecting || !disconnectPassword.trim()}
            >
              {disconnecting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  Verificando...
                </>
              ) : (
                <>
                  <Link2Off className="w-4 h-4 mr-1.5" />
                  Desconectar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ML Manual Code Dialog */}
      <Dialog open={mlCodeDialog} onOpenChange={setMlCodeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              🟡 Colar código do Mercado Livre
            </DialogTitle>
            <DialogDescription>
              Cole o código de autorização que apareceu na URL após autorizar o acesso no Mercado Livre (parâmetro <code>?code=</code>).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="ml-code">Código de autorização</Label>
              <Input
                id="ml-code"
                placeholder="TG-xxxxx..."
                value={mlCodeInput}
                onChange={(e) => setMlCodeInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMlCodeDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleManualCodeExchange}
              disabled={connecting || !mlCodeInput.trim()}
            >
              {connecting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  Trocando...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-1.5" />
                  Trocar por token
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
