// ============================================================================
// 🔴 PORTÃO — a carga inicial de /conciliacao custa UMA ida ao banco
//
// O defeito que este portão fecha, medido em produção (04/09/2026):
//
//   get_casos_conciliacao roda em  231 ms como `postgres`
//                          e em 1.079 ms como `authenticated` (4,7×, RLS
//                          avaliada linha a linha).
//   A janela tem 2.604 linhas. O hook paginava de 200 em 200 → ceil(2604/200)
//   = 14 chamadas SEQUENCIAIS, cada uma reexecutando a função inteira:
//   14 × 1.079 ms ≈ 15,1 s toda vez que o CEO abre a tela.
//
// ⚠️ A correção NÃO pode ser voltar a truncar. O 225-07 fechou exatamente esse
// buraco: a RPC trunca em 1.000 e um caso na linha 1.001 nunca seria olhado,
// o que reprova D-225-16 ("nenhum caso expira sem eu ter olhado") direto.
//
// A forma da correção, e o que este portão prova:
//
//   1. a página passa a ser o TETO DURO do PostgREST (1.000), não 200 — a
//      mesma função executa uma vez em vez de cinco para o mesmo pedaço;
//   2. a abertura lê só a PRIMEIRA página, e a primeira página é a que decide,
//      porque a RPC ordena por `dias_restantes asc NULLS LAST` (225-07 deu
//      ordem total a esse ORDER BY);
//   3. a garantia de completude vira uma INVARIANTE VERIFICÁVEL EM TEMPO DE
//      EXECUÇÃO, não uma suposição: com nulos no fim, se a última linha
//      carregada já não tem prazo, então TODA linha com prazo está carregada.
//      É isso que `prazoCoberto` afirma;
//   4. o resto continua alcançável — `completo: true` varre a janela inteira.
//
// Este arquivo prova COMPORTAMENTO (cliente falso, sem banco), ao contrário do
// `useConciliacaoContrato.test.ts`, que prova forma. Os dois portões coexistem:
// forma pega o padrão proibido, comportamento pega a conta de ida e volta.
// ============================================================================
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(() => ({ currentOrg: { id: "org-conciliacao-teste" } })),
}));

vi.mock("@/contexts/MLStoreContext", () => ({
  useMLStore: vi.fn(() => ({ resolvedMLUserIds: ["1639558873"] })),
}));

import { useCasosConciliacao } from "@/hooks/useConciliacao";

function envolver() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

// ─── A janela medida: 2.604 linhas, e a ordem que a RPC garante ─────────────
//
// 1.363 com prazo (as que decidem) vêm primeiro; 1.241 sem prazo — as linhas
// de frete, que entram como VOLUME e não como dinheiro apurado — vêm depois,
// porque `NULLS LAST`.

const COM_PRAZO = 1363;
const SEM_PRAZO = 1241;
const JANELA = COM_PRAZO + SEM_PRAZO; // 2.604

function janelaOrdenada(comPrazo = COM_PRAZO, semPrazo = SEM_PRAZO) {
  const linhas: Array<Record<string, unknown>> = [];
  for (let i = 0; i < comPrazo; i++) {
    linhas.push({ ml_order_id: `p-${i}`, tipo_caso: "repasse_ausente", dias_restantes: i % 30 });
  }
  for (let i = 0; i < semPrazo; i++) {
    linhas.push({ ml_order_id: `f-${i}`, tipo_caso: "frete_a_maior", dias_restantes: null });
  }
  return linhas;
}

/** Serve fatias da janela por `p_offset`/`p_limite`, como a RPC faria. */
function servir(linhas: Array<Record<string, unknown>>) {
  return vi.fn(async (_fn: string, args: Record<string, unknown>) => {
    const offset = Number(args.p_offset ?? 0);
    const limite = Number(args.p_limite ?? 1000);
    return { data: linhas.slice(offset, offset + limite), error: null };
  });
}

async function ler(opcoes?: { completo?: boolean }) {
  const { supabase } = await import("@/integrations/supabase/client");
  const { result } = renderHook(() => useCasosConciliacao({ apenasAcionaveis: false, ...opcoes }), {
    wrapper: envolver(),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  return { dados: result.current.data, rpc: supabase.rpc as ReturnType<typeof vi.fn> };
}

describe("🔴 PORTÃO — abrir a tela custa UMA ida ao banco, não catorze", () => {
  beforeEach(async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.clearAllMocks();
    (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(servir(janelaOrdenada()));
  });

  it("1 — a abertura faz exatamente 1 chamada (eram 14)", async () => {
    const { dados, rpc } = await ler();
    expect(rpc.mock.calls.length, "cada chamada reexecuta a função inteira").toBe(1);
    expect(dados?.paginasLidas).toBe(1);
  });

  it("2 — a única chamada pede o teto duro do PostgREST, não 200", async () => {
    const { rpc } = await ler();
    expect(rpc.mock.calls[0][1].p_limite).toBe(1000);
    expect(rpc.mock.calls[0][1].p_offset).toBe(0);
  });

  it("3 — a leitura parcial se declara parcial, nunca se passa por completa", async () => {
    const { dados } = await ler();
    expect(dados?.linhas.length).toBe(1000);
    expect(dados?.completo).toBe(false);
    // Teto de segurança do laço é outra coisa: aqui a parada foi deliberada.
    expect(dados?.truncadoNoTeto).toBe(false);
  });
});

describe("🔴 PORTÃO — completude não regride: nenhum caso com prazo fica invisível", () => {
  beforeEach(async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.clearAllMocks();
    (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(servir(janelaOrdenada()));
  });

  it("4 — `prazoCoberto` é FALSO enquanto a cauda carregada ainda tem prazo", async () => {
    // 1.363 linhas com prazo contra uma página de 1.000: a linha 1.001 TEM
    // prazo e ficou fora. A tela precisa gritar — é o caso D-225-16.
    const { dados } = await ler();
    expect(dados?.prazoCoberto).toBe(false);
  });

  it("5 — `prazoCoberto` é VERDADEIRO quando a cauda carregada já não tem prazo", async () => {
    // Com 800 linhas com prazo, a página de 1.000 cruza a fronteira dos nulos:
    // como a RPC ordena `NULLS LAST`, cruzar a fronteira PROVA que toda linha
    // com prazo está carregada. Invariante verificada, não suposta.
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(servir(janelaOrdenada(800, 1804)));
    const { dados } = await ler();
    expect(dados?.linhas.length).toBe(1000);
    expect(dados?.completo).toBe(false);
    expect(dados?.prazoCoberto).toBe(true);
  });

  it("6 — `completo: true` varre a janela inteira, sem teto de 1.000", async () => {
    const { dados, rpc } = await ler({ completo: true });
    expect(dados?.linhas.length).toBe(JANELA);
    expect(dados?.completo).toBe(true);
    expect(dados?.prazoCoberto).toBe(true);
    expect(dados?.truncadoNoTeto).toBe(false);
    // 2.604 linhas → 1.000 + 1.000 + 604. Eram 14 chamadas para o mesmo dado.
    expect(rpc.mock.calls.length).toBe(3);
  });

  it("7 — janela que cabe numa página não paga segunda ida", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(servir(janelaOrdenada(120, 80)));
    const { dados, rpc } = await ler({ completo: true });
    expect(rpc.mock.calls.length).toBe(1);
    expect(dados?.completo).toBe(true);
    expect(dados?.prazoCoberto).toBe(true);
  });
});

describe("erro da RPC continua virando exceção, nunca lista vazia silenciosa", () => {
  it("8 — falha na primeira página não devolve `nenhuma divergência`", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.clearAllMocks();
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: "permission denied for function get_casos_conciliacao" },
    });
    const { result } = renderHook(() => useCasosConciliacao(), { wrapper: envolver() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("permission denied");
  });
});
