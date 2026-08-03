import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";

const mockSignOut = vi.fn();
const mockUseAuth = vi.fn();
const mockUseOrganization = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: () => mockUseOrganization(),
}));

function renderProtectedAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Tela de login</div>} />
        <Route path="/admin" element={<div>Painel admin</div>} />
        <Route path="/criar-organizacao" element={<div>Tela de criar organização</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Conteúdo protegido</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute — SEC-09 (T-209-13)", () => {
  beforeEach(() => {
    mockSignOut.mockClear();
  });

  it("autenticado, sem organização, não super-admin → navega para /criar-organizacao, e signOut não é chamado", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, role: "editor", loading: false, signOut: mockSignOut });
    mockUseOrganization.mockReturnValue({ currentOrg: null, loading: false });

    renderProtectedAt("/");

    await waitFor(() => expect(screen.getByText("Tela de criar organização")).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("autenticado, com organização → renderiza o conteúdo protegido", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, role: "editor", loading: false, signOut: mockSignOut });
    mockUseOrganization.mockReturnValue({ currentOrg: { id: "org-1" }, loading: false });

    renderProtectedAt("/");

    await waitFor(() => expect(screen.getByText("Conteúdo protegido")).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("super-admin sem organização → continua indo para /admin", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "user-1" }, role: "admin", loading: false, signOut: mockSignOut });
    mockUseOrganization.mockReturnValue({ currentOrg: null, loading: false });

    renderProtectedAt("/");

    await waitFor(() => expect(screen.getByText("Painel admin")).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("não autenticado → continua indo para /login", async () => {
    mockUseAuth.mockReturnValue({ user: null, role: null, loading: false, signOut: mockSignOut });
    mockUseOrganization.mockReturnValue({ currentOrg: null, loading: false });

    renderProtectedAt("/");

    await waitFor(() => expect(screen.getByText("Tela de login")).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
