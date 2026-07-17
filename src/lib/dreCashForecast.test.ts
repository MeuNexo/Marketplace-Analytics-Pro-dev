// ============================================================================
// dreCashForecast.test.ts — Phase 100 Plan 02, Task 1 (TDD)
// Testa a função pura que monta o painel "Fechar o mês" a partir das linhas
// cruas da RPC get_dre_cash_forecast (Plano 100-01): gap de caixa, meta
// client-side, venda necessária, dia-limite, ritmo/semáforo e alertas de
// recorrência suspeita (guarda anti-fantasma, BEC-04).
//
// Espelho estrutural de src/lib/dreCashCascade.test.ts (Phase 99): helpers de
// row por seção, particionamento ANTES de qualquer soma, null-safety em
// todos os campos, arredondamento a 2 casas.
//
// Cenário real (jul/2026, dependencies_state do 100-02-PLAN — números
// medidos em produção pelo 100-01): usado além dos sintéticos, para garantir
// que a lib não quebra com magnitudes/arredondamentos reais.
// ============================================================================

import { describe, it, expect } from "vitest";
import { buildDreCashForecast, type DreCashForecastRow } from "./dreCashForecast";

// Helper de construção de row por seção — espelho de entradaRow/saidaRow do
// dreCashCascade.test.ts.
function row(secao: string, categoria: string, total: number | null, n = 1): DreCashForecastRow {
  return { secao, categoria, total, n };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

describe("buildDreCashForecast — Test 1: composição do gap (D-02)", () => {
  it("saidasPrevistas.total soma os 5 componentes; entradasGarantidas.total soma os 2; gap = saídas − entradas, sem projeção de vendas novas", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 30000),
      row("saida_prevista", "estornos_ocorridos", 4000),
      row("saida_prevista", "saidas_pendentes", 25000),
      row("saida_prevista", "estornos_previstos", 1500),
      row("saida_prevista", "imposto_previsto_restante", 2500),
      row("entrada", "entradas_liberadas", 40000),
      row("entrada", "entradas_agendadas", 10000),
      row("taxa", "taxa_venda_para_caixa", 0.678),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 5000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.saidasPrevistas.pagas).toBe(30000);
    expect(f.saidasPrevistas.estornosOcorridos).toBe(4000);
    expect(f.saidasPrevistas.pendentes).toBe(25000);
    expect(f.saidasPrevistas.estornosPrevistos).toBe(1500);
    expect(f.saidasPrevistas.impostoPrevistoRestante).toBe(2500);
    expect(f.saidasPrevistas.total).toBe(63000);

    expect(f.entradasGarantidas.liberadas).toBe(40000);
    expect(f.entradasGarantidas.agendadas).toBe(10000);
    expect(f.entradasGarantidas.total).toBe(50000);

    // Ritmo real (vendas_7d_media_diaria) NUNCA soma no gap — só entra em ritmoReal7d.
    expect(f.gap).toBe(63000 - 50000);
    expect(f.gap).toBe(13000);

    // Cascata narrativa (Phase 100 fix): mesma matemática, intermediários novos.
    expect(f.placarHoje).toBe(round2(40000 - (30000 + 4000)));
    expect(f.placarHoje).toBe(6000);
    expect(f.aindaVaiSair).toBe(round2(25000 + 1500 + 2500));
    expect(f.aindaVaiSair).toBe(29000);
    // gap = -placarHoje + aindaVaiSair - agendadas (identidade da cascata).
    expect(f.gap).toBe(round2(-f.placarHoje + f.aindaVaiSair - f.entradasGarantidas.agendadas));
  });
});

describe("buildDreCashForecast — Test 2: meta client-side (D-04)", () => {
  it("meta 20000 sobre gap 0 vira gapComMeta 20000 e vendaNecessaria = gapComMeta ÷ taxaVendaParaCaixa; mudar meta não toca nas rows", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 50000),
      row("entrada", "entradas_liberadas", 50000),
      row("taxa", "taxa_venda_para_caixa", 0.678),
    ];
    const semMeta = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(semMeta.gap).toBe(0);
    expect(semMeta.gapComMeta).toBe(0);

    const comMeta = buildDreCashForecast(rows, { meta: 20000, hoje: new Date(2026, 6, 17) });
    expect(comMeta.gap).toBe(0);
    expect(comMeta.gapComMeta).toBe(20000);
    expect(comMeta.vendaNecessaria).toBe(round2(20000 / 0.678));

    // Rows originais intocadas — a mesma referência de array pode ser
    // reutilizada para as duas chamadas sem efeito colateral.
    expect(rows[0].total).toBe(50000);
  });
});

describe("buildDreCashForecast — Test 3: mês já fecha na meta (D-05)", () => {
  it("gapComMeta ≤ 0 → semáforo neutro, vendaNecessaria 0, ritmoNecessario null", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 15000),
      row("taxa", "taxa_venda_para_caixa", 0.678),
      row("ritmo", "vendas_7d_media_diaria", 3000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.gap).toBe(-5000);
    expect(f.gapComMeta).toBe(-5000);
    expect(f.semaforo).toBe("neutro");
    expect(f.vendaNecessaria).toBe(0);
    expect(f.ritmoNecessario).toBeNull();
  });
});

describe("buildDreCashForecast — Test 4: null-safety da taxa (D-03)", () => {
  it("taxa_venda_para_caixa ausente ou ≤ 0 → vendaNecessaria null, sem divisão por zero nem NaN em nenhum campo", () => {
    const rowsSemTaxa: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 20000),
      row("entrada", "entradas_liberadas", 5000),
    ];
    const fSemTaxa = buildDreCashForecast(rowsSemTaxa, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(fSemTaxa.taxaVendaParaCaixa).toBeNull();
    expect(fSemTaxa.gap).toBe(15000);
    expect(fSemTaxa.vendaNecessaria).toBeNull();
    expect(fSemTaxa.ritmoNecessario).toBeNull();
    expect(Number.isNaN(fSemTaxa.vendaNecessaria as unknown as number)).toBe(false);

    const rowsTaxaZero: DreCashForecastRow[] = [
      ...rowsSemTaxa,
      row("taxa", "taxa_venda_para_caixa", 0),
    ];
    const fTaxaZero = buildDreCashForecast(rowsTaxaZero, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(fTaxaZero.vendaNecessaria).toBeNull();

    const rowsTaxaNegativa: DreCashForecastRow[] = [
      ...rowsSemTaxa,
      row("taxa", "taxa_venda_para_caixa", -0.1),
    ];
    const fTaxaNegativa = buildDreCashForecast(rowsTaxaNegativa, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(fTaxaNegativa.vendaNecessaria).toBeNull();

    // Nenhum campo numérico do resultado é NaN.
    for (const [key, value] of Object.entries(fSemTaxa)) {
      if (typeof value === "number") {
        expect(Number.isNaN(value), `${key} não pode ser NaN`).toBe(false);
      }
    }
  });
});

describe("buildDreCashForecast — Test 5: dia-limite (D-03)", () => {
  it("hoje 2026-07-17, lag 14 → diaLimite 17/07 (31/07 − 14d), diasRestantes 0, prazoEsgotado true (gap aberto)", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 1000),
      row("taxa", "lag_liberacao_dias", 14),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.lagLiberacaoDias).toBe(14);
    expect(f.diaLimite.getFullYear()).toBe(2026);
    expect(f.diaLimite.getMonth()).toBe(6); // julho (0-indexed)
    expect(f.diaLimite.getDate()).toBe(17);
    expect(f.diasRestantes).toBe(0);
    expect(f.gapComMeta).toBeGreaterThan(0);
    expect(f.prazoEsgotado).toBe(true);
  });

  it("hoje 2026-07-17, lag 7 → diaLimite 24/07 (31/07 − 7d), diasRestantes 7", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 1000),
      row("taxa", "lag_liberacao_dias", 7),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.diaLimite.getDate()).toBe(24);
    expect(f.diaLimite.getMonth()).toBe(6);
    expect(f.diasRestantes).toBe(7);
    expect(f.prazoEsgotado).toBe(false);
  });

  it("lag_liberacao_dias ausente → fallback 14 (mesmo fallback documentado na RPC)", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 1000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.lagLiberacaoDias).toBe(14);
  });
});

describe("buildDreCashForecast — Test 6: semáforo do ritmo (D-05)", () => {
  it("ritmoReal7d ≥ ritmoNecessario → verde", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 50000),
      row("entrada", "entradas_liberadas", 10000),
      row("taxa", "taxa_venda_para_caixa", 0.678),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 100000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.ritmoNecessario).not.toBeNull();
    expect(f.ritmoReal7d).toBeGreaterThanOrEqual(f.ritmoNecessario as number);
    expect(f.semaforo).toBe("verde");
  });

  it("ritmoReal7d abaixo do necessário → vermelho", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 50000),
      row("entrada", "entradas_liberadas", 10000),
      row("taxa", "taxa_venda_para_caixa", 0.678),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 100),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.semaforo).toBe("vermelho");
  });
});

describe("buildDreCashForecast — Test 7: alertas de recorrência (D-06/BEC-04)", () => {
  it("linhas secao alerta_recorrencia viram alertasRecorrencia ordenadas por valor desc", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 1000),
      row("entrada", "entradas_liberadas", 1000),
      row("alerta_recorrencia", "ADS Mercado Livre", 5000, 3),
      row("alerta_recorrencia", "Prestação de serviço do Mercado Envios Full", 16958.57, 12),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.alertasRecorrencia).toHaveLength(2);
    expect(f.alertasRecorrencia[0]).toEqual({
      categoria: "Prestação de serviço do Mercado Envios Full",
      valor: 16958.57,
      mesesFuturos: 12,
    });
    expect(f.alertasRecorrencia[1]).toEqual({
      categoria: "ADS Mercado Livre",
      valor: 5000,
      mesesFuturos: 3,
    });
  });

  it("sem linhas de alerta_recorrencia → []", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 1000),
      row("entrada", "entradas_liberadas", 1000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.alertasRecorrencia).toEqual([]);
  });
});

describe("buildDreCashForecast — Test 8: rows vazio", () => {
  it("rows [] → hasData false, gap 0, semáforo neutro, nenhum NaN", () => {
    const f = buildDreCashForecast([], { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.hasData).toBe(false);
    expect(f.gap).toBe(0);
    expect(f.gapComMeta).toBe(0);
    expect(f.semaforo).toBe("neutro");
    expect(f.alertasRecorrencia).toEqual([]);
    expect(f.vendaNecessaria).toBe(0);
    expect(f.ritmoNecessario).toBeNull();
    expect(f.ritmoReal7d).toBe(0);

    for (const [key, value] of Object.entries(f)) {
      if (typeof value === "number") {
        expect(Number.isNaN(value), `${key} não pode ser NaN`).toBe(false);
      }
    }
  });
});

describe("buildDreCashForecast — Test 9: arredondamento a 2 casas", () => {
  it("todos os valores monetários batem com Math.round(x*100)/100", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 30000.333),
      row("saida_prevista", "estornos_ocorridos", 4000.111),
      row("entrada", "entradas_liberadas", 20000.666),
      row("taxa", "taxa_venda_para_caixa", 0.6783333),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.saidasPrevistas.pagas).toBe(round2(30000.333));
    expect(f.saidasPrevistas.estornosOcorridos).toBe(round2(4000.111));
    expect(f.entradasGarantidas.liberadas).toBe(round2(20000.666));
    expect(f.gap).toBe(round2(f.saidasPrevistas.total - f.entradasGarantidas.total));
    if (f.vendaNecessaria !== null) {
      expect(f.vendaNecessaria).toBe(round2(f.vendaNecessaria));
    }
  });
});

describe("buildDreCashForecast — cenário real (jul/2026, RPC em produção — 100-01)", () => {
  it("números medidos em produção não quebram a lib nem geram NaN, e o gap bate com a soma manual", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 129647.65, 28),
      row("saida_prevista", "estornos_ocorridos", 17123.43, 70),
      row("saida_prevista", "saidas_pendentes", 118714.13, 31),
      row("saida_prevista", "estornos_previstos", 6645.22),
      row("saida_prevista", "imposto_previsto_restante", 7891.52, 3),
      row("entrada", "entradas_liberadas", 131679.54, 672),
      row("entrada", "entradas_agendadas", 51880.7, 223),
      row("taxa", "taxa_liquido_bruto", 0.778),
      row("taxa", "taxa_estornos", 0.128),
      row("taxa", "taxa_venda_para_caixa", 0.678),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 8122.78, 178),
      row("alerta_recorrencia", "ADS Mercado Livre", 4200, 5),
      row("alerta_recorrencia", "Prestação de serviço do Mercado Envios Full", 1600, 4),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    const saidasTotalEsperado = round2(129647.65 + 17123.43 + 118714.13 + 6645.22 + 7891.52);
    const entradasTotalEsperado = round2(131679.54 + 51880.7);
    expect(f.saidasPrevistas.total).toBe(saidasTotalEsperado);
    expect(f.entradasGarantidas.total).toBe(entradasTotalEsperado);
    expect(f.gap).toBe(round2(saidasTotalEsperado - entradasTotalEsperado));
    expect(f.hasData).toBe(true);
    expect(f.alertasRecorrencia).toHaveLength(2);
    expect(f.ritmoReal7d).toBe(8122.78);

    // Cascata narrativa (Phase 100 fix 2026-07-17) — cenário real de julho
    // reportado pelo dono no checkpoint visual: placar já realizado, ainda
    // vai sair, e a identidade com o gap existente (mesma matemática).
    expect(f.placarHoje).toBe(round2(131679.54 - (129647.65 + 17123.43)));
    expect(f.placarHoje).toBe(-15091.54);
    expect(f.aindaVaiSair).toBe(round2(118714.13 + 6645.22 + 7891.52));
    expect(f.aindaVaiSair).toBe(133250.87);
    expect(f.gap).toBe(round2(-f.placarHoje + f.aindaVaiSair - f.entradasGarantidas.agendadas));
    expect(f.gap).toBe(96461.71);

    for (const [key, value] of Object.entries(f)) {
      if (typeof value === "number") {
        expect(Number.isNaN(value), `${key} não pode ser NaN`).toBe(false);
      }
    }
  });
});

describe("buildDreCashForecast — Test 10: resultadoProjetado (manchete Phase 100 fix 2026-07-17)", () => {
  it("cenário real: gap 55123.02, ritmo 9186.33, taxa 0.6576, 7 dias → resultadoProjetado = -gap + ritmo×dias×taxa (independe da meta client-side)", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 55123.02),
      row("entrada", "entradas_liberadas", 0),
      row("taxa", "taxa_venda_para_caixa", 0.6576),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 9186.33),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.gap).toBe(55123.02);
    expect(f.diasRestantes).toBe(7);
    const esperado = round2(-f.gap + f.ritmoReal7d * f.diasRestantes * (f.taxaVendaParaCaixa as number));
    expect(f.resultadoProjetado).toBe(esperado);
    expect(f.resultadoProjetado).toBeCloseTo(-12836.51, 1);

    // Independe da meta: mudar meta não deve alterar resultadoProjetado (usa gap, não gapComMeta).
    const comMeta = buildDreCashForecast(rows, { meta: 20000, hoje: new Date(2026, 6, 17) });
    expect(comMeta.resultadoProjetado).toBe(f.resultadoProjetado);
  });

  it("mês já fecha bem (gap negativo/sobra) → resultadoProjetado positivo, reforçando o ritmo bom", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 20000),
      row("taxa", "taxa_venda_para_caixa", 0.6576),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 5000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });

    expect(f.gap).toBe(-10000);
    expect(f.resultadoProjetado).not.toBeNull();
    expect(f.resultadoProjetado as number).toBeGreaterThan(0);
  });

  it("taxaVendaParaCaixa ausente → resultadoProjetado null (sem prova matemática, D-05)", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 1000),
      row("taxa", "lag_liberacao_dias", 7),
      row("ritmo", "vendas_7d_media_diaria", 5000),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.taxaVendaParaCaixa).toBeNull();
    expect(f.resultadoProjetado).toBeNull();
  });

  it("linha de ritmo (vendas_7d_media_diaria) ausente da RPC → resultadoProjetado null (não estima com ritmo desconhecido)", () => {
    const rows: DreCashForecastRow[] = [
      row("saida_prevista", "saidas_pagas", 10000),
      row("entrada", "entradas_liberadas", 1000),
      row("taxa", "taxa_venda_para_caixa", 0.6576),
      row("taxa", "lag_liberacao_dias", 7),
    ];
    const f = buildDreCashForecast(rows, { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.ritmoReal7d).toBe(0);
    expect(f.resultadoProjetado).toBeNull();
  });

  it("rows vazio → resultadoProjetado null", () => {
    const f = buildDreCashForecast([], { meta: 0, hoje: new Date(2026, 6, 17) });
    expect(f.resultadoProjetado).toBeNull();
  });
});
