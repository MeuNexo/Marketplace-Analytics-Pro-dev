# Features Research — UI Fiscal

## Summary

- Simples Nacional precisa apenas da alíquota efetiva persistida, mas exibir tabela de referência Anexo/faixa inline é essencial para gerar confiança no número digitado
- Lucro Presumido tem taxas fixadas em lei (PIS 0,65%, COFINS 3%, IRPJ 1,2–4,8%, CSLL 1,08–4,32%) mas variam por tipo de atividade (Comércio vs. Serviços) — dropdown de atividade com auto-preenchimento de defaults é table stakes
- Lucro Real é complexo demais para o perfil de vendedor no nível de crédito/débito; v1 deve usar uma alíquota efetiva única com toggle opcional para breakdown avançado
- Tab-por-regime é o UX pattern correto (não dropdown + campos condicionais) porque os conjuntos de campos são completamente disjuntos
- DIFAL pós-RE 1287019/2021 e retenção de ICMS pelo ML como marketplace são as armadilhas mais perigosas específicas do ML; v1 precisa ao mínimo de um banner de aviso

---

## Table Stakes (v1 must-have)

### Simples Nacional
- [ ] Campo de alíquota efetiva (%) com label clara: "Alíquota efetiva do DAS"
- [ ] Tooltip explicando que o número vem do PGDAS-D ou do contador
- [ ] Tabela de referência de anexos (I–V) colapsável para o vendedor confirmar em qual se enquadra

### Lucro Presumido
- [ ] Dropdown de tipo de atividade: Comércio, Indústria, Serviços (define base de cálculo do IRPJ/CSLL)
- [ ] Campos PIS (%) e COFINS (%) — pré-preenchidos com 0,65% e 3,00%, editáveis
- [ ] Campos IRPJ efetivo (%) e CSLL efetivo (%) — pré-preenchidos com defaults por atividade
- [ ] Alíquota total calculada em tempo real: `PIS + COFINS + IRPJ + CSLL`

### Lucro Real
- [ ] Campos de débito: PIS débito (%) e COFINS débito (%) — pré-preenchidos com 1,65% e 7,60%
- [ ] Campos de crédito: PIS crédito (%) e COFINS crédito (%) — padrão 0%, vendedor preenche
- [ ] Alíquota líquida calculada em tempo real: `(débitos − créditos)`
- [ ] Aviso: "Estes valores são para fins de análise gerencial. Consulte seu contador."

### Geral
- [ ] Seleção de regime com indicação de qual está ativo por loja
- [ ] Botão Salvar com feedback de sucesso/erro
- [ ] Indicação visual de "não configurado" para lojas sem regime definido
- [ ] Fallback visível: quando não configurado, coluna Impostos usa o valor manual existente

---

## Differentiators (v2+)

- **Tabelas automáticas Simples Nacional**: calcular alíquota efetiva a partir de Anexo + faixa de faturamento anual (elimina dependência do contador para um número simples)
- **IRPJ/CSLL detalhado no Lucro Real**: separar estimativa de IRPJ e CSLL sobre lucro real estimado
- **Histórico de alterações**: log de quando o regime foi alterado e por quem (auditoria)
- **Alerta de mudança de faixa**: aviso quando faturamento acumulado se aproxima da próxima faixa do Simples
- **Comparativo entre regimes**: simulação lado a lado do impacto de cada regime nos anúncios atuais

---

## Anti-Features (deliberately exclude)

| Feature | Motivo |
|---|---|
| Geração de DARF / guias | Plataforma é analytics, não fiscal — escopo completamente diferente |
| Integração com SPED / EFD | Complexidade de compliance fora do objetivo do produto |
| Cálculo de DIFAL por produto | Depende de NCM, estado de destino, IE do comprador — inviável sem NFe |
| Substituição Tributária (ST) | Requer NCM + MVA por produto — fora do v1 |
| Regime por produto individual | Config é por loja; diferenciação por produto é v3+ |
| Cálculo de ISS | Relevante apenas para serviços — ML vende produtos |

---

## UX Patterns

### Estrutura da aba Fiscal

```
Minha Conta → Fiscal
  └── Lista de lojas ML conectadas
       └── Cada loja: card com
            - Nome da loja
            - Regime selecionado (badge) ou "Não configurado"
            - Botão "Configurar" / "Editar"
            - Drawer ou seção expansível com formulário por regime
```

### Formulário por regime
- **Tabs** por regime (Simples / Lucro Presumido / Lucro Real) — não dropdown com campos condicionais
- Tab ativa = regime selecionado para aquela loja
- Trocar de tab = trocar o regime (com confirmação se já havia config salva)
- Campos numéricos com sufixo `%`, `step="0.01"`, `min="0"`, `max="100"`
- Preview em tempo real: "Imposto estimado em um anúncio de R$ 100,00: **R$ 12,50 (12,5%)**"

### Estado vazio
- Loja sem configuração mostra banner amarelo em Catálogo de Anúncios: "Configure o regime tributário desta loja para calcular impostos automaticamente → [link para Fiscal]"

---

## Validation Rules

| Campo | Regime | Regra |
|---|---|---|
| Alíquota efetiva | Simples | `0 < x ≤ 28` (teto máximo do Simples) |
| PIS | LP | `0 ≤ x ≤ 1` (0,65% fixo; permitir override pequeno) |
| COFINS | LP | `0 ≤ x ≤ 4` (3% fixo; idem) |
| IRPJ efetivo | LP | `0 ≤ x ≤ 15` |
| CSLL efetivo | LP | `0 ≤ x ≤ 12` |
| PIS débito | LR | `0 ≤ x ≤ 3` |
| COFINS débito | LR | `0 ≤ x ≤ 10` |
| PIS crédito | LR | `0 ≤ pis_credito ≤ pis_debito` |
| COFINS crédito | LR | `0 ≤ cofins_credito ≤ cofins_debito` |
| Total LP | LP | `PIS+COFINS+IRPJ+CSLL ≤ 40` (sanity check) |

---

## ML Seller Gotchas

| Risco | Descrição | Mitigação v1 |
|---|---|---|
| ICMS retido pelo ML | ML retém ICMS como marketplace facilitator em alguns estados — vendedor pode estar contando em dobro | Banner: "O ML pode reter ICMS na fonte. Verifique com seu contador se este crédito já está deduzido." |
| DIFAL | Pós-RE 1287019/2021, vendedor pode dever diferencial de alíquota para estado do comprador | Fora do v1; nota no tooltip do Lucro Real |
| Transição de faixa Simples | Alíquota muda ao cruzar faixas anuais — % manual fica desatualizado | Tooltip: "Atualize esta alíquota sempre que seu faturamento acumulado mudar de faixa" |
| MEI vendendo no ML | MEI tem DAS fixo — alíquota efetiva é quase zero; % manual = 0% | Aceitar 0% como valor válido |
| Substituição Tributária | Alguns segmentos têm ST — ICMS já está na NF de compra | Fora do v1; documentar como limitação conhecida |
