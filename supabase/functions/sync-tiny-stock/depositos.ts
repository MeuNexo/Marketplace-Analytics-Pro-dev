// ============================================================================
// Fase 214 — Task 3: extracao pura de saldo por deposito.
//
// Modulo PURO: nao fala com rede, nao lê banco, nao decide compra. Recebe a
// resposta crua de GET /estoque/{id} do Tiny e devolve saldos por deposito.
// ============================================================================

export interface SaldoDeposito {
  deposito: string;
  saldo: number;
  disponivel: number;
}

const SEM_DEPOSITO = "(sem deposito)";

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza a resposta de GET /estoque/{id} do Tiny em saldos por deposito.
 *
 * FORMA MEDIDA em 2026-08-04 (docs/superpowers/plans/tiny-shape-medicao.md):
 * `depositos[]` e `saldo` vivem na RAIZ da resposta, e cada item do array JA E
 * o deposito. O envelope `estoque` e o wrapper `{ deposito: {...} }` do desenho
 * original sao aceitos como fallback, caso a API varie entre versoes.
 *
 * Depositos com `desconsiderar = true` sao descartados: nao sao vendaveis
 * (medido em `Magazine Luiza Fullfilment`).
 *
 * Valores negativos sao PRESERVADOS (medidos: `disponivel` -1 e -20). O piso em
 * zero (D-6) e responsabilidade de quem decide compra, na RPC — nao deste
 * modulo. Um extrator que arredonda esconde da tela que a origem esta negativa.
 */
export function extrairDepositos(resposta: unknown): SaldoDeposito[] {
  if (!resposta || typeof resposta !== "object") return [];

  const raiz = resposta as Record<string, unknown>;
  // A raiz e a fonte medida; `estoque` e fallback para o envelope antigo.
  const envelope = raiz.estoque && typeof raiz.estoque === "object"
    ? (raiz.estoque as Record<string, unknown>)
    : raiz;

  const temListaDepositos = Array.isArray(envelope.depositos);
  const lista = temListaDepositos ? (envelope.depositos as unknown[]) : [];

  const saldos: SaldoDeposito[] = [];
  for (const item of lista) {
    // Forma medida: o item JA e o deposito. Forma antiga: vem sob `.deposito`.
    const d = (item as Record<string, unknown>)?.deposito ?? item;
    if (!d || typeof d !== "object") continue;
    const dep = d as Record<string, unknown>;
    if (dep.desconsiderar === true) continue;
    const nome = typeof dep.nome === "string" ? dep.nome.trim() : "";
    if (!nome) continue;
    saldos.push({
      deposito: nome,
      saldo: num(dep.saldo),
      disponivel: dep.disponivel === undefined ? num(dep.saldo) : num(dep.disponivel),
    });
  }

  // Fallback para o saldo de topo APENAS quando a resposta nao trouxe lista de
  // depositos. Se a lista veio e esvaziou no filtro, o resultado e vazio de
  // verdade: cair no topo aqui somaria justamente o estoque que a origem
  // marcou como `desconsiderar`.
  if (saldos.length === 0 && lista.length === 0 && envelope.saldo !== undefined) {
    return [{
      deposito: SEM_DEPOSITO,
      saldo: num(envelope.saldo),
      disponivel: envelope.disponivel === undefined
        ? num(envelope.saldo)
        : num(envelope.disponivel),
    }];
  }

  return saldos;
}
