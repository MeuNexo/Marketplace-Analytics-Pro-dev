export type OrgRole = "owner" | "admin" | "member" | "viewer";
// Backwards-compat alias for any remaining imports
export type AppRole = OrgRole;

const ALL: OrgRole[] = ["owner", "admin", "member", "viewer"];
const OPERATIONAL: OrgRole[] = ["owner", "admin", "member"];
const ORG_ADMIN: OrgRole[] = ["owner", "admin"];
const OWNER_ONLY: OrgRole[] = ["owner"];

export const roleAccess: Record<string, OrgRole[]> = {
  "/": ALL,
  "/estoque": ALL,
  "/anuncios": ALL,
  "/publicidade": ALL,
  "/financeiro": ALL,
  "/reputacao": ALL,
  "/perfil": ALL,
  "/pedidos": OPERATIONAL,
  "/perguntas": OPERATIONAL,
  "/devolucoes": OPERATIONAL,
  "/metas": OPERATIONAL,
  "/precificacao": OPERATIONAL,
  "/compras": OPERATIONAL,
  "/consultor": OPERATIONAL,
  "/fluxo-de-caixa": OPERATIONAL,
  "/organizacao": ORG_ADMIN,
  "/sellers": OWNER_ONLY,
  "/integracoes": OWNER_ONLY,
  "/fiscal": OWNER_ONLY,
  "/monitoramento": OWNER_ONLY,
};

/**
 * Routes that can be individually toggled for viewers by owner/admin.
 * Viewers get DEFAULT-DENY: no access until owner/admin explicitly grants.
 * /perfil is always allowed for everyone (not in this list).
 */
export const VIEWER_ELIGIBLE_ROUTES: { path: string; label: string }[] = [
  // Vendas
  { path: "/", label: "Vendas" },
  { path: "/publicidade", label: "Publicidade" },
  { path: "/financeiro", label: "Margem" },
  // Catálogo
  { path: "/anuncios", label: "Anúncios" },
  { path: "/estoque", label: "Estoque" },
  { path: "/pedidos", label: "Pedidos" },
  { path: "/precificacao", label: "Precificação" },
  // Atendimento
  { path: "/reputacao", label: "Reputação" },
  { path: "/devolucoes", label: "Devoluções" },
  { path: "/perguntas", label: "Mensagens" },
  // Crescimento
  { path: "/metas", label: "Metas" },
];

const VIEWER_ELIGIBLE_SET = new Set(VIEWER_ELIGIBLE_ROUTES.map((r) => r.path));

export function canAccess(role: OrgRole | null, path: string): boolean {
  if (!role) return false;
  const allowed = roleAccess[path];
  if (!allowed) return false; // default-deny
  return allowed.includes(role);
}

/**
 * Access check that respects per-viewer custom permissions.
 * For viewers: route must be eligible AND explicitly granted in viewerPermissions.
 * For other roles: falls back to standard canAccess.
 */
export function canAccessWithViewer(
  role: OrgRole | null,
  path: string,
  viewerPermissions: Set<string>
): boolean {
  if (!role) return false;
  if (role !== "viewer") return canAccess(role, path);
  // Viewer: /perfil always allowed
  if (path === "/perfil") return true;
  // Must be eligible AND explicitly granted
  if (!VIEWER_ELIGIBLE_SET.has(path)) return false;
  return viewerPermissions.has(path);
}
