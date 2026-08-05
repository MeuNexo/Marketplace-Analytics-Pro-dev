// ============================================================================
// migrationSecurityLint.baseline.ts — Fase 209 Plano 03, Task 1
// A linha de base dos achados HERDADOS e aceitos — é ela que faz
// `migrationSecurityLint.ts` falhar só por objeto NOVO, e não por reconferir
// o passado. Cada entrada precisa de motivo; vetor tipado em vez de JSON
// porque adicionar entrada passa a exigir motivo por TIPO, não por
// disciplina de quem editou por último.
//
// Levantada varrendo `supabase/migrations/` (207 arquivos em 2026-08-03,
// pós SEC-07/08 do 209-01): 0 tabelas sem RLS no estado final, 9 funções
// `SECURITY DEFINER` sem `REVOKE` em nenhum arquivo do histórico. Bem abaixo
// do teto de esforço de 20 entradas — nenhum agrupamento foi necessário.
//
// `check_quota` e `can_member_access_route` foram consertados no 209-01
// (SEC-08) e NÃO constam aqui: objeto consertado não vira exceção aceita.
// ============================================================================

import type { BaselineEntry } from "./migrationSecurityLint";

export const migrationSecurityBaseline: BaselineEntry[] = [
  {
    classe: "definer_sem_revoke",
    objeto: "is_org_member",
    motivo:
      "PROIBIDO revogar — não é aceito, é vedado. Chamada de dentro das expressões " +
      "USING/WITH CHECK de dezenas de policies de RLS do banco (é o alicerce do " +
      "controle de membro por organização). Revogar EXECUTE dela derruba as 143 " +
      "policies do banco de uma vez, porque a policy roda com o privilégio de quem " +
      "consulta e passa a falhar ao tentar chamar a função. Ver 20260414200325.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "get_org_role",
    motivo:
      "PROIBIDO revogar — não é aceito, é vedado. Mesma razão de is_org_member: " +
      "chamada de dentro de dezenas de policies (controle de owner/admin/member), " +
      "roda com o privilégio de quem consulta. Revogar EXECUTE derruba as 143 " +
      "policies do banco de uma vez. Ver 20260414200325.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "has_org_role",
    motivo:
      "Herdado — zero chamadores no código (nenhuma policy, RPC ou frontend a " +
      "referencia; foi criada em 20260423153544 e nunca usada). Revogável, mas não " +
      "urgente — sem chamador não há caminho de exploração ativo hoje. Ver DEBT-08.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "bootstrap_org_once_invoke",
    motivo:
      "Herdado — bootstrap de execução única (organização Pé Vermeio), sem " +
      "parâmetro de organização e sem chamador em runtime além da própria migration " +
      "que a criou (20260512193118). Revogável, mas não urgente; ver DEBT-08.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "claim_next_sync_job",
    motivo:
      "Herdado — sem parâmetros; devolve o próximo job da fila de sync_jobs para " +
      "quem chamar. Revogável mas não urgente (risco de enumeração de fila, não de " +
      "leitura de tabela por organização alheia); ver DEBT-08.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "dispatch_inventory_jobs",
    motivo:
      "Herdado — sem parâmetros; despacha jobs de sincronização de inventário para " +
      "o pg_cron processar. Revogável mas não urgente; ver DEBT-08.",
  },
  // dispatch_orders_jobs SAIU desta lista em 2026-08-05: ao corrigir o sync do
  // dia corrente, a função ganhou REVOKE de PUBLIC/anon/authenticated e GRANT
  // só para service_role. A dívida DEBT-08 deixou de existir para ela.
  {
    classe: "definer_sem_revoke",
    objeto: "dispatch_sales_jobs",
    motivo:
      "Herdado — sem parâmetros; despacha jobs de sincronização de vendas para o " +
      "pg_cron processar. Revogável mas não urgente; ver DEBT-08.",
  },
  {
    classe: "definer_sem_revoke",
    objeto: "dispatch_sync_jobs",
    motivo:
      "Herdado — sem parâmetros; despacha jobs de sincronização genéricos para o " +
      "pg_cron processar. Revogável mas não urgente; ver DEBT-08.",
  },
];
