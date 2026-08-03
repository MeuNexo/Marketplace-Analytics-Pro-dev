import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import CreateOrganization from "./CreateOrganization";

// Prova por execução (não por leitura) de que refreshOrgs() é aguardado
// ANTES da navegação: se a ordem se inverter, o ProtectedRoute (T-209-13)
// veria "autenticado sem organização" na primeira renderização de "/" e
// mandaria de volta para /criar-organizacao — o laço que o comentário sobre
// effectiveLoading em OrganizationContext.tsx descreve.
const callOrder: string[] = [];

const mockCreateOrganization = vi.fn(async () => {
  callOrder.push("createOrganization");
  return { ok: true as const, organizationId: "org-novo" };
});

vi.mock("@/lib/createOrganization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/createOrganization")>("@/lib/createOrganization");
  return {
    ...actual,
    createOrganization: (...args: unknown[]) => mockCreateOrganization(...(args as [])),
  };
});

const mockRefreshOrgs = vi.fn(async () => {
  callOrder.push("refreshOrgs");
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: () => ({ refreshOrgs: mockRefreshOrgs }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockNavigate = vi.fn((...args: unknown[]) => {
  callOrder.push("navigate");
});
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("CreateOrganization — ordem refreshOrgs → navigate (SEC-09)", () => {
  beforeEach(() => {
    callOrder.length = 0;
    mockCreateOrganization.mockClear();
    mockRefreshOrgs.mockClear();
    mockNavigate.mockClear();
    mockToast.mockClear();
  });

  it("aguarda refreshOrgs() resolver antes de chamar navigate('/'), sem laço", async () => {
    render(
      <MemoryRouter initialEntries={["/criar-organizacao"]}>
        <Routes>
          <Route path="/criar-organizacao" element={<CreateOrganization />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Loja Nova" } });
    fireEvent.click(screen.getByRole("button", { name: /criar organização/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));

    expect(mockRefreshOrgs).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["createOrganization", "refreshOrgs", "navigate"]);
  });

  it("em falha, mostra toast nomeando o passo e NÃO navega", async () => {
    mockCreateOrganization.mockImplementationOnce(async () => {
      callOrder.push("createOrganization");
      return {
        ok: false as const,
        error: { step: "organization_members" as const, recoverable: true, message: "erro de teste" },
      };
    });

    render(
      <MemoryRouter initialEntries={["/criar-organizacao"]}>
        <Routes>
          <Route path="/criar-organizacao" element={<CreateOrganization />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Loja Nova" } });
    fireEvent.click(screen.getByRole("button", { name: /criar organização/i }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    expect(mockToast.mock.calls[0][0].title).toMatch(/organization_members/);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRefreshOrgs).not.toHaveBeenCalled();
  });
});
