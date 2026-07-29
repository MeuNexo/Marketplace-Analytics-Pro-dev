---
phase: 106
plan: "106-01"
status: complete
date: 2026-07-29
---

# 106-01 — SUMMARY (schema aplicado em prod)

## Entregue

Duas migrations aplicadas em `ckcdevcxgvueywivefgx` via MCP `apply_migration`:

- `20260729180000_nexo_conversations.sql` — `nexo_conversations` + `nexo_messages`
- `20260729180100_nexo_memories.sql` — `nexo_memories`

RLS clonada de `ml_mco_targets`, com **um aperto**: conversa é **pessoal**
(`user_id = auth.uid()` além do `is_org_member`) — um membro não lê o chat do outro.
`nexo_messages` não tem policy de UPDATE de propósito: mensagem gravada é registro.
`nexo_memories` nasce `status='pending'` por default — a tool nunca cria `active`.

Estado em prod: 4 policies em `nexo_conversations`, 3 em `nexo_messages` (sem UPDATE),
4 em `nexo_memories`; `relrowsecurity=true` nas três.

## Provas (org Pé Vermeio `7f615df7-…` × org Thales `e4150d57-…`)

| Prova | Resultado |
|---|---|
| Dono (Wesley, `ce8c797c-…`) vê a própria conversa | **1** ✅ |
| Usuário da org Thales (`4aed4678-…`) vê a conversa da Pé Vermeio | **0** ✅ anti-IDOR |
| CHECK `scope='user'` sem `user_id` | **barrou** (`check_violation`) ✅ |
| Advisors de segurança após DDL | **nenhum item novo** das tabelas `nexo_*` ✅ |
| Seed de prova removido | `nexo_conversations` = 0 linhas ✅ |

## ⚠️ Lição de método — a técnica de impersonação anterior dava FALSO NEGATIVO

A primeira prova indicou que a org Thales enxergava a conversa da Pé Vermeio. **Não era
falha de RLS** — era a técnica de prova.

`SET LOCAL ROLE` + `LATERAL` na **mesma statement** não prova RLS em SELECT direto:
as policies são resolvidas na fase de **planejamento**, que já aconteceu com o role
`postgres` (que tem `rolbypassrls=true`). Trocar o role em runtime não replaneja — nem
forçando dependência entre as LATERALs.

**Técnica correta** (plano montado em runtime, depois do `set_config`):

```sql
select
  (select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true)) is not null,
  (select set_config('role','authenticated',true)),
  ((xpath('/row/c/text()', query_to_xml('select count(*) as c from public.<tabela>', false,true,'')))[1])::text::int;
```

O padrão LATERAL registrado na Phase 79 continua válido **para chamar RPC** (a função
planeja o corpo em runtime) — o falso negativo só aparece em SELECT direto na tabela.
