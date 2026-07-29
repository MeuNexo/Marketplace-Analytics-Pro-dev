# Phase 106: Consultor com memória persistente — Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Task Boundary

Hoje o Consultor (`supabase/functions/nexo-chat/`) é **amnésico por decisão de projeto**
(Phase 57, `NEXO-04`): o histórico vive apenas no estado React do `useNexoChat`, sem
tabela e sem localStorage. Um F5 apaga a conversa; cada sessão começa do zero; ele não
sabe nada sobre Wesley nem sobre decisões já travadas.

Wesley (2026-07-29) pediu memória "como funciona no Claude". O paralelo correto NÃO é RAG
— no Claude Code a memória são duas coisas: a sessão que continua, e um conjunto de
**fatos curtos e curados** carregados no início de cada conversa.

Escopo desta phase = **conversas persistidas + memória de fatos**. RAG (Fase 2 da
milestone Consultor CCO) fica fora: exigiria embeddings/pgvector e uma base documental
que ainda não existe no garment.

</domain>

<decisions>
## Implementation Decisions (LOCKED — respondidas por Wesley em 2026-07-29)

### Escopo
- **Conversas persistidas + memória de fatos.** RAG explicitamente adiado.

### Curadoria da memória
- **O Consultor PROPÕE, Wesley APROVA.** Nada entra na memória sem clique humano.
- Extração automática sem aprovação foi **rejeitada** — risco de fato errado/velho
  contaminando análise futura, descoberto só quando a resposta sai torta.

### Regras travadas na conversa de origem
1. **Fato numérico envelhece.** "Lead time da Pralana = 78 dias" é verdade hoje e erro em
   seis meses. Fatos com número entram marcados como "verificar na tool antes de afirmar":
   o Nexo usa como pista, NUNCA cita como número atual. Espelha a regra de recall do
   Claude Code (memória reflete o que era verdade quando foi escrita).
2. **Memória não vira escrita no ML.** `propose_memory` escreve só na própria tabela de
   memória. O contrato read-only do Consultor sobre o Mercado Livre permanece intacto
   (T-57-12).
3. **Teto de injeção.** O system prompt já tem ~49 KB (persona + 5 playbooks). A memória
   entra com limite (~30 fatos) para não inflar o turno.

### Claude's Discretion
- Nomes exatos de tabela/coluna, formato do bloco de memória no prompt, e layout da tela
  de gestão.

</decisions>

<specifics>
## Specific Ideas

Ganho colateral relevante: hoje o front reenvia a conversa **inteira** a cada turno
(`useNexoChat` monta `nextMessages` e manda tudo). Isso cresce sem limite e é superfície
de injeção — o cliente é a autoridade do histórico. Carregar o histórico do banco pelo
`conversation_id` corrige os dois problemas de uma vez.

Tipos de fato que já existem e mereceriam memória (exemplos reais):
- Decisões travadas: "CMV = cheio", "Receita = data do pedido", "imposto real ≠ bruto"
- Contexto de operação: "meta de MCO de 7% pode ser irreal (histórico −0,2 / 0,9 / 2,6%)"
- Preferências: tom direto, português, número sempre com fonte

</specifics>

<canonical_refs>
## Canonical References

- `docs/superpowers/specs/2026-07-28-consultor-cco-completo-design.md` — spec da milestone
  (Fase 1 tools+playbooks FEITA; Fase 2 RAG adiada por esta decisão)
- Phase 57 (`NEXO-04`) — decisão original de histórico efêmero, que esta phase revê
- Padrão anti-IDOR do projeto: RPC tenant = SECURITY INVOKER; `is_org_member` na EF

</canonical_refs>
