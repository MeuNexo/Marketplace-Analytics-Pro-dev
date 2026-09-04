// ============================================================================
// 225-05 — o texto do dossiê, montado por função pura
//
// 🔴 ESTE TEXTO SAI DO SISTEMA. Ele é copiado pelo CEO e colado dentro de um
// chamado de suporte do Mercado Livre. Por isso ele é uma função pura testada
// e não um `template string` solto dentro do componente:
//
//   · um `undefined` no meio dele não é um bug de tela — é uma credencial
//     queimada com o suporte, e D-225-07 diz que o custo não é o valor do
//     caso, é a credibilidade do PRÓXIMO chamado;
//   · cada número precisa dizer DE ONDE veio (D-225-12), senão o ML devolve;
//   · a acusação é ML contra ML — `retido_de_fato` (o que o Mercado Pago
//     efetivamente reteve) contra `cobranca_declarada` (o que a fatura por
//     pedido do próprio ML registra). Nenhum cadastro nosso entra na coluna
//     que acusa.
//
// 🔴 MÓDULO PURO: sem React, sem Supabase, sem `@/components`. A única
// importação é `casoUrgencia`, que também é pura e é a régua ÚNICA de rótulo e
// de dinheiro desta fase. Há grep no plano que reprova o contrário.
//
// ⚠️ NADA é recalculado aqui. Todos os valores chegam prontos da RPC
// `get_casos_conciliacao` (225-02). Este módulo só FORMATA — uma segunda régua
// para o mesmo número foi exatamente como o saldo quebrou na fase 233.
//
// ⚠️ TEXTO SIMPLES, sem markdown: o campo de chamado do ML não renderiza.
// ============================================================================

import { rotuloMotivo, rotuloTipoCaso, rotuloUrgencia, valorEmReais } from "./casoUrgencia";

// ─── Os nomes das duas fontes. Exportados de propósito ──────────────────────
//
// A tela e o texto copiado usam a MESMA constante. Se os dois nomes divergirem,
// o Wesley lê um rótulo na tela e cola outro no chamado — e a primeira pergunta
// do suporte é justamente de onde veio o número.

export const FONTE_MERCADO_PAGO = "Mercado Pago (retido de fato)";
export const FONTE_FATURA_ML = "Fatura do Mercado Livre (cobrança declarada)";

/** O que cada fonte significa, para quem lê o chamado do outro lado. */
export const EXPLICACAO_MERCADO_PAGO =
  "o que o Mercado Pago efetivamente reteve neste pedido: valor bruto do pagamento " +
  "menos o valor líquido creditado na conta.";
export const EXPLICACAO_FATURA_ML =
  "o que a fatura por pedido do Mercado Livre registra ter cobrado, já líquida de estorno.";

/**
 * A procedência do "esperado", palavra por palavra do Copywriting Contract do
 * `225-UI-SPEC.md`.
 *
 * ⚠️ Ela existe para o dia em que alguém do ML perguntar como o número foi
 * obtido — e para a nossa própria memória: `orders.comissao` é POR UNIDADE
 * enquanto `receita_bruta` é TOTAL, e subtrair uma da outra sem multiplicar
 * pela quantidade é bug ATIVO desta base (Fase 234). O esperado desta fase
 * roteia em volta dele.
 */
export const LINHA_PROCEDENCIA_ESPERADO =
  "Esperado = receita bruta − tarifas registradas por pedido " +
  "(nunca a comissão por unidade × 1 — ver nota técnica)";

/**
 * 🔴 OBRIGATÓRIA EM TODO DOSSIÊ DE AUSÊNCIA. Omiti-la é assinar uma acusação
 * que pode ser falsa.
 *
 * Medido em `225-CALIBRACAO.md` C-06, sonda ao vivo contra a API do Mercado
 * Pago: os 5 únicos pedidos sem nenhuma linha de repasse em 75 dias voltaram
 * 5 de 5 `charged_back` / `reimbursed`, somando R$ 2.278,22. `cash_inflows`
 * não guarda esse status (a Edge Function só aceita cinco, e ele não é um
 * deles), então "sem linha de repasse" NÃO prova ausência de repasse.
 *
 * O número está no texto de propósito: número torna o aviso acionável, em vez
 * de decorativo.
 */
export const AVISO_CONTESTACAO_CARTAO =
  "Antes de abrir o chamado, confira este pagamento no painel do Mercado Pago. " +
  "Este monitor não enxerga contestação de cartão (chargeback): esse status não entra " +
  "na tabela de repasses, então a falta de repasse aqui não prova, sozinha, que o " +
  "Mercado Livre reteve o dinheiro. Na amostra da calibração, 5 de 5 pedidos sem " +
  "repasse em 75 dias eram contestação de cartão do comprador (R$ 2.278,22), não " +
  "retenção do Mercado Livre.";

// ─── Ausências nomeadas ─────────────────────────────────────────────────────
//
// 🔴 Campo ausente NUNCA sai como vazio, `undefined` ou `null`. Ele sai com a
// palavra que nomeia a ausência. Um campo em branco num chamado é lido como
// desleixo; a palavra é lida como honestidade.

const AUSENTE_TEXTO = "não informado";
const AUSENTE_DATA = "não informada";
const AUSENTE_VALOR = "não apurado";

/** Texto utilizável, ou a palavra que nomeia a ausência. */
export function textoOuAusente(valor: unknown, ausente: string = AUSENTE_TEXTO): string {
  if (typeof valor === "string") {
    const t = valor.trim();
    return t.length > 0 ? t : ausente;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return ausente;
}

/**
 * `2026-08-07` → `07/08/2026`. Aceita `Date` (lida pelos componentes LOCAIS,
 * nunca por `toISOString`, que desloca o dia em qualquer fuso negativo — e o
 * Brasil é um deles).
 *
 * ⚠️ Data ISO crua nunca vaza para dentro do chamado: quem lê do outro lado
 * usa dd/mm/aaaa, e uma data em formato estrangeiro num documento de cobrança
 * é mais um motivo para o número ser questionado.
 */
export function dataEmBR(valor: string | Date | null | undefined, ausente = AUSENTE_DATA): string {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return ausente;
    const dia = String(valor.getDate()).padStart(2, "0");
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${valor.getFullYear()}`;
  }
  if (typeof valor !== "string") return ausente;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ausente;
}

/**
 * Dinheiro: a régua é a MESMA de `casoUrgencia.valorEmReais`, e é ela porque
 * `formatCurrency` de `@/lib/formatters` devolve "R$ 0,00" para nulo.
 *
 * 🔴 A onda 2 removeu esse `coalesce` do SQL de propósito. Reintroduzi-lo aqui
 * escreveria "R$ 0,00" dentro de um chamado quando a verdade é "não sei" —
 * exatamente a mentira que esta fase inteira existe para matar. Zero é uma
 * afirmação; nulo é a ausência dela.
 *
 * O único ajuste é trocar o espaço rígido do `Intl` por espaço comum: o campo
 * de texto do chamado do ML já colou U+00A0 como caractere estranho antes.
 */
function dinheiro(valor: number | null | undefined): string {
  return valorEmReais(valor, AUSENTE_VALOR).replace(/\u00a0/g, " ");
}

// ─── O caso, como ele chega da RPC ──────────────────────────────────────────
//
// Estruturalmente compatível com `CasoConciliacaoRow` de `useConciliacao.ts`,
// com todos os campos opcionais: o dossiê tem que sair legível mesmo de uma
// linha incompleta, porque é justamente a linha incompleta que gera dúvida.

export interface CasoDossie {
  caso_id?: string | null;
  /** 🔴 Falso na esmagadora maioria hoje: só DOIS motivos abrem caso (225-02). */
  acionavel?: boolean | null;
  ml_order_id?: string | null;
  tipo_caso?: string | null;
  motivo?: string | null;
  estado?: string | null;
  titulo?: string | null;
  sku?: string | null;
  quantidade?: number | null;
  /** ML contra ML — a ponta que acusa: soma(gross) − soma(net) do Mercado Pago. */
  retido_de_fato?: number | null;
  /** ML contra ML — a outra ponta: soma de `detail_amount`, líquida de estorno. */
  cobranca_declarada?: number | null;
  residuo_ml?: number | null;
  esperado_nosso?: number | null;
  recebido?: number | null;
  residuo_nosso?: number | null;
  diferenca?: number | null;
  data_pedido?: string | null;
  data_evento?: string | null;
  dias_restantes?: number | null;
  n_pagamentos?: number | null;
  payment_ids?: string[] | null;
  release_date_max?: string | null;
  valor_estimado?: boolean | null;
}

export interface OpcoesDossie {
  /**
   * 🔴 A data de montagem entra por PARÂMETRO, com padrão — igual ao `now`
   * injetável de `dueDateLabel`. Função que lê o relógio sozinha não tem teste
   * determinístico, e a VPS desta casa já marcou três dias à frente do banco.
   */
  montadoEm?: string | Date;
  /** `ingestao_inicio` do resumo — a régua do motivo é do banco, não daqui. */
  ingestaoInicio?: string | null;
}

/** Rótulo à esquerda, preenchido com pontos até a coluna do valor. */
function linha(rotulo: string, valor: string, largura = 44): string {
  const base = rotulo.length >= largura ? rotulo : rotulo + " " + ".".repeat(largura - rotulo.length - 1);
  return `${base}: ${valor}`;
}

/** Identificadores de pagamento: TODOS, e no plural certo. */
function blocoPagamentos(caso: CasoDossie): string[] {
  const ids = Array.isArray(caso?.payment_ids)
    ? caso.payment_ids.filter((p) => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
    : [];

  const declarado =
    typeof caso?.n_pagamentos === "number" && Number.isFinite(caso.n_pagamentos)
      ? Math.trunc(caso.n_pagamentos)
      : ids.length;
  // O que se afirma é o que se consegue listar; se a contagem da RPC divergir
  // da lista, a lista manda — é ela que o suporte vai conferir.
  const n = Math.max(declarado, ids.length);

  if (n <= 0 || ids.length === 0) {
    // ⚠️ 2,39% dos pedidos têm mais de um pagamento e a entrada pode nem ser
    // venda. Dizer "nenhum" com todas as letras é melhor que uma lista vazia.
    return [
      "Pagamentos no Mercado Pago: nenhum pagamento identificado para este pedido.",
      "  (sem identificador de pagamento, o suporte não consegue rastrear o repasse —",
      "   confira o pedido no painel antes de enviar)",
    ];
  }

  const cabecalho =
    n === 1
      ? "Pagamentos no Mercado Pago: 1 pagamento neste pedido"
      : `Pagamentos no Mercado Pago: ${n} pagamentos neste pedido (pagamento dividido)`;

  return [cabecalho, ...ids.map((id) => `  - ${id}`)];
}

/**
 * Monta o bloco de texto que vai para dentro do chamado do Mercado Livre.
 *
 * Determinístico: mesma entrada, mesmo texto. Sem relógio, sem locale variável
 * além do `Intl` de moeda (fixo em pt-BR), sem markdown.
 */
export function montarDossie(caso: CasoDossie, opcoes?: OpcoesDossie): string {
  const c = caso ?? {};
  const tipo = rotuloTipoCaso(c.tipo_caso);
  const ausencia = c.tipo_caso === "repasse_ausente";
  const estimado = c.valor_estimado === true;
  const prazo = rotuloUrgencia(c.dias_restantes);

  const montadoEm = opcoes?.montadoEm ?? new Date();

  const l: string[] = [];

  l.push(`DOSSIÊ DE CONCILIAÇÃO — ${tipo}`);
  l.push(`Montado em ${dataEmBR(montadoEm)} pelo painel de conciliação do vendedor.`);
  l.push("");

  // 🔴 O bloco que impede este texto de virar acusação falsa fora da tela.
  // Um dossiê copiado circula sozinho: sai do sistema, entra num chamado, e
  // ninguém que o lê depois sabe se a linha era acionável no dia em que foi
  // copiada. `acionavel` é FALSO na esmagadora maioria dos casos de hoje — a
  // régua de valor a menor está desligada por calibração reprovada e a
  // ausência de repasse nasce a verificar. Dizer isso DENTRO do bloco é o que
  // separa "evidência em preparação" de "acusação assinada" (D-225-07).
  if (c.acionavel !== true) {
    l.push("SITUAÇÃO DESTE CASO");
    l.push(
      "Este caso AINDA NÃO É ACIONÁVEL: não envie este bloco como chamado antes " +
        "de resolver o ponto abaixo.",
    );
    l.push(`Motivo: ${rotuloMotivo(c.motivo, { ingestaoInicio: opcoes?.ingestaoInicio })}`);
    l.push("");
  }

  l.push("PEDIDO");
  l.push(linha("Pedido no Mercado Livre", textoOuAusente(c.ml_order_id)));
  l.push(linha("Produto", textoOuAusente(c.titulo)));
  l.push(linha("SKU", textoOuAusente(c.sku)));
  l.push(linha("Quantidade", textoOuAusente(c.quantidade)));
  l.push(linha("Data da venda", dataEmBR(c.data_pedido)));
  l.push(linha("Data do evento", dataEmBR(c.data_evento)));
  l.push(linha("Prazo de ressarcimento", prazo.texto));
  l.push("");

  // ── A peça central: ML contra ML, cada fonte NOMEADA ─────────────────────
  l.push("AS DUAS FONTES, LADO A LADO");
  l.push("(as duas leituras abaixo são do próprio Mercado Livre, não da nossa base)");
  l.push(linha(FONTE_MERCADO_PAGO, dinheiro(c.retido_de_fato)));
  l.push(`  ${EXPLICACAO_MERCADO_PAGO}`);
  l.push(linha(FONTE_FATURA_ML, dinheiro(c.cobranca_declarada)));
  l.push(`  ${EXPLICACAO_FATURA_ML}`);
  l.push(linha("Diferença entre as duas fontes", dinheiro(c.residuo_ml)));
  l.push("");

  const sufixoEstimativa = estimado
    ? " (valor apresentado como estimativa — a apuração ao centavo ainda não fechou)"
    : "";
  l.push(`DIFERENÇA APONTADA: ${dinheiro(c.diferenca)}${sufixoEstimativa}`);
  l.push("");

  l.push(...blocoPagamentos(c));
  l.push(linha("Liberação prevista até", dataEmBR(c.release_date_max)));
  l.push("");

  // ── A leitura da nossa base entra NOMEADA como nossa (D-225-12) ──────────
  l.push("LEITURA DA NOSSA BASE (contexto — a acusação acima não depende dela)");
  l.push(linha("Esperado", dinheiro(c.esperado_nosso)));
  l.push(linha("Recebido", dinheiro(c.recebido)));
  l.push(linha("Diferença contra a nossa base", dinheiro(c.residuo_nosso)));
  l.push(LINHA_PROCEDENCIA_ESPERADO);

  if (ausencia) {
    l.push("");
    l.push("ANTES DE ENVIAR ESTE CHAMADO");
    l.push(AVISO_CONTESTACAO_CARTAO);
  }

  return l.join("\n");
}
