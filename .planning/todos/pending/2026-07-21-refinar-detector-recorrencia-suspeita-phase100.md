---
created: 2026-07-21T00:00:00
title: Refinar detector de recorrência suspeita (Phase 100, BEC-04)
area: dre-caixa
files:
  - src/lib/dreCashForecast.ts
  - supabase functions: get_dre_cash_forecast (CTE recorrencia_suspeita)
---

## Problem

O detector de "recorrência suspeita" da Phase 100 (`get_dre_cash_forecast`, CTE
`recorrencia_suspeita`) dispara um alerta sempre que a mesma combinação
categoria+valor aparece em `cash_outflows` pendente em >= 2 meses futuros. A
regra foi criada como guarda anti-fantasma (BEC-04), motivada pelo caso real
de 2026-07-16: uma recorrência de ADS/Full cancelada por engano no Tiny
(pendente todo mês, ago/2026→jun/2027, sem nota fiscal nenhuma) poluindo a
projeção de caixa.

Validado em produção em 2026-07-21 (org Pé Vermeio): o card de julho trouxe 8
alertas na categoria "Fornecedores", TODOS falsos positivos — são
parcelamentos reais de compra vindos do Tiny, cada um com NF própria e padrão
"parcela X/Y" na description (FOUR ALL PRIME NF 2781/2782/2783/2784, CENTRO
DESENV. TÊXTIL NF 4407, PRALANA NF 184663/185494, ZEBU NF 37534). O usuário
teve que checar manualmente os 8 pra descartar.

A causa raiz: um parcelamento legítimo em 3x/4x tem, por definição, o mesmo
valor repetido em vários meses seguidos na mesma categoria — exatamente a
assinatura que o detector usa pra sinalizar "fantasma". O caso real de
fantasma (ads/full) não tinha NF nem padrão de parcela; os falsos positivos
sempre têm.

## Solution

Diferenciar parcelamento real de lançamento fantasma usando um sinal mais
forte que categoria+valor. Ideias levantadas na sessão (não validadas com o
Wesley ainda):

- Se `document_number`/NF estiver presente e for igual entre os meses → não é
  suspeito (é parcela da mesma compra).
- Se a `description` seguir o padrão "parcela X/Y" com X incrementando mês a
  mês → não é suspeito.
- Só alertar quando NÃO há NF/document_number associado E o valor se repete
  idêntico sem nenhum padrão de parcela — esse é o padrão real do caso
  ads/full.

TBD: confirmar com o Wesley se o Tiny sempre grava NF nas parcelas de compra
(parece que sim, pelos 8 casos observados) antes de decidir a heurística
final.
