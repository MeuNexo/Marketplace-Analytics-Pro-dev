# Pitfalls Research — Tributação BR E-Commerce

_Contexto: módulo fiscal para analytics — NÃO é emissor/SPED_

---

## Summary

- **Simples Nacional é enganosamente simples**: vendedores confundem a alíquota nominal da tabela do Anexo com a alíquota efetiva real — que pode ser 30–50% menor após a fórmula de dedução do DAS. Usar a taxa nominal superestima sistematicamente o imposto.
- **Lucro Presumido tem armadilha de PIS/COFINS**: o regime é cumulativo por obrigação legal, mas vendedores que migraram do Lucro Real mentalizam créditos não-cumulativos, produzindo subavaliação que "parece certa" mas está errada.
- **Créditos do Lucro Real são um campo minado**: itens não-creditáveis (alimentação de funcionários, entretenimento, veículos não-frete) são frequentemente incluídos no pool de créditos, fazendo a estimativa parecer melhor que a realidade.
- **Exposição legal é real mas gerenciável**: um aviso proeminente de que a plataforma é um estimador — não um sistema fiscal — mais bloqueio de alteração acidental de regime e um campo "última atualização", cobre o risco principal sem over-engineering.
- **Scope creep é o maior risco do projeto**: DIFAL, Substituição Tributária e ISS parecem um checkbox num formulário, mas representam meses de complexidade regulatória — a abstração "alíquota efetiva por loja" deve ser mantida como barreira rígida.

---

## Calculation Pitfalls

### Simples Nacional

**Pitfall 1 — Taxa Nominal vs. Efetiva**

A tabela do Simples Nacional (Anexos I–V, Resolução CGSN 140/2018) publica uma alíquota *nominal* por faixa de receita. A taxa real do DAS usa:

```
Alíquota Efetiva = (RBT12 × Alíquota Nominal − PD) / RBT12
```

Exemplo (Anexo I, faixa 4 — R$360k–R$540k/ano):
- Nominal: 10,70% | PD: R$22.500 | Com RBT12 = R$450k → Efetiva = **5,70%**
- Um sistema usando a taxa nominal superestima impostos em ~88% nessa faixa.

**Pitfall 2 — DAS já cobre tudo**

Vendedores às vezes somam ICMS ou ISS por cima do DAS. O DAS já unifica 8 tributos. Exibir uma "linha ICMS" junto com a taxa DAS duplica o imposto e alarma desnecessariamente.

**Pitfall 3 — Anexo errado por NCM/Atividade**

Um CNPJ com receitas mistas (mercadorias + serviços) pode abranger múltiplos Anexos. Sem NCM por produto (fora do escopo v1), a plataforma não consegue determinar o Anexo correto.

---

### Lucro Presumido

**Pitfall 4 — Aplicar PIS/COFINS Não-Cumulativo**

Lucro Presumido usa obrigatoriamente *PIS/COFINS cumulativo*: PIS 0,65% + COFINS 3,00%. Taxas não-cumulativas (1,65% + 7,60%) se aplicam apenas ao Lucro Real. Um vendedor entrando com taxas não-cumulativas superestima esses dois impostos em ~2,4×.

**Pitfall 5 — Base de Presunção do IRPJ Errada**

- Comércio: base de presunção = 8% da receita → IRPJ 15% → efetivo **1,2%**
- Serviços: base de presunção = 32% → IRPJ 15% → efetivo **4,8%**

Um vendedor de mercadorias usando a taxa de serviços superestima o IRPJ em 4×.

**Pitfall 6 — Esquecer a CSLL**

CSLL para comércio (Lucro Presumido) = 12% base × 9% = **1,08%** efetivo. Frequentemente omitida.

---

### Lucro Real

**Pitfall 7 — Creditando Insumos Não-Creditáveis**

Itens comumente creditados de forma incorreta (IN RFB 2.121/2022): alimentação/uniformes de funcionários, entretenimento, combustível para veículos não-frete, serviços de fornecedores do Simples Nacional. Incluir todas as compras como crédito pode subestimar o PIS/COFINS líquido em 20–40%.

**Pitfall 8 — Ignorar Ajustes de IRPJ/CSLL**

IRPJ no Lucro Real é apurado sobre o lucro ajustado (LALUR), não sobre a receita. Sem dados contábeis completos, um % flat sobre receita pode errar por um fator de 2–10×.

**Pitfall 9 — Crédito de ICMS é Específico por Par de Estados**

A taxa líquida efetiva de ICMS depende de estado de origem, estado de destino, NCM e convênios aplicáveis. Uma taxa ICMS flat por loja é aproximação apenas.

---

## Legal / Compliance Risks

**Aviso obrigatório** (aba Fiscal + tooltip da coluna Impostos):

> "Os valores de impostos exibidos são estimativas para análise de margem e não constituem apuração fiscal oficial. Não use estes dados para emissão de guias, SPED, NF-e ou declarações à Receita Federal. Consulte seu contador para apuração correta."

**Proteções obrigatórias de UX:**

1. Dialog de confirmação na troca de regime (evita sobrescrever acidentalmente durante período de vendas ativo)
2. Limites de sanidade com erros hard: Simples 0,5%–19,5%; Lucro Presumido comércio 4,5%–16%; Lucro Real −5% a +30%
3. Badge "última validação" na config — aviso âmbar se > 6 meses sem atualizar
4. `ml_tax_config` jamais exposto via endpoints públicos/não-autenticados

---

## UX Pitfalls

**Confusão 1 — "Minha alíquota está na DANFE"**
Vendedores pegam o ICMS de uma NF-e de compra e digitam no campo. Esse é imposto de entrada em compra, não alíquota de saída sobre vendas. Fix: "Este campo é a alíquota sobre suas *receitas de venda*, não sobre notas de compra."

**Confusão 2 — "Simples é simples, não preciso de contador"**
A alíquota efetiva muda toda vez que a receita acumulada 12 meses cruza uma faixa — pode acontecer mensalmente para vendedores em crescimento acelerado no ML. Fix: campo "Última atualização" visível; aviso se > 90 dias sem atualizar.

**Confusão 3 — "Coluna Impostos = meu custo total de tributos"**
Vendedores ignoram que ST pode já estar paga pelo fornecedor, ou que têm créditos de PIS/COFINS nas compras. Fix: tooltip "sem considerar créditos de entrada — consulte seu contador para o imposto líquido real."

**Confusão 4 — "Uma taxa cobre todos os meus produtos"**
Vendedores com NCMs mistos (vestuário + eletrônicos) têm exposições de ST e IPI diferentes por produto. Fix: documentar a limitação; permitir override manual por produto em MLProdutos.

---

## Data / Technical Pitfalls

**Taxas desatualizadas**: alíquotas brasileiras mudam via Portaria/IN/Resolução CGSN sem calendário fixo. ICMS mudou em vários estados em 2022–2023. Armazenar `updated_at` na config; revisão trimestral é SLA operacional.

**Fallback ausente**: nunca exibir `0%` quando não configurado — parece produto isento de impostos. Exibir `—` ou badge "Não configurado".

**Gaps de RLS multi-tenant**:
- `ml_tax_config` deve incluir `organization_id`; política RLS escopo por org
- Edge functions com SERVICE_ROLE bypassam RLS — leituras fiscais devem usar JWT/anon key + RLS
- Role viewer consegue back-calcular a taxa a partir do valor exibido — decisão consciente, documentar

**Edge cases técnicos**:
- Taxa efetiva negativa (Lucro Real com créditos grandes): limitar exibição em 0%; exibir badge "Crédito"
- Armazenar taxas como `NUMERIC(6,4)`, não FLOAT — evitar drift de ponto flutuante
- Arredondar apenas o valor final exibido, nunca intermediário: `Math.round(price * rate * 100) / 100`
- Produtos com preço zero (kits/bundles ML): imposto = R$0,00 é correto, sem tratamento especial

---

## Scope Creep Traps

| Feature | Por que parece pequena | Por que é grande | Estimativa |
|---|---|---|---|
| **DIFAL** | "Diferença entre ICMS de origem e destino" | Requer estado de destino por pedido; Simples tem fórmula GNRE separada; EC 87/2015 + ADC 49 em litígio | 6–10 semanas |
| **Substituição Tributária** | "Flag por produto" | Requer NCM + estado de origem + destino simultaneamente; pautas mudam frequentemente; tratamento ST pelo ML como marketplace não consolidado | 12–20 semanas |
| **ISS** | "Vendedores de serviços pagam ISS" | Imposto municipal — 5.570 municípios, cada um com alíquota própria (2%–5%); Simples já inclui ISS no DAS | 4–8 semanas (simplificado) |
| **Integração NF-e** | "Sincronizar linhas de imposto da NF-e" | SEFAZ SOAP + certificado; schemas v3.10–v4.00; integração com provedor terceiro; modelo por pedido incompatível com config por produto | 16–24 semanas |
| **Simulador comparativo de regimes** | "Mostrar 3 regimes lado a lado" | Requer dados completos de custo do Lucro Real; pode ser interpretado como consultoria tributária; risco de responsabilidade profissional | 3–5 semanas UI + revisão legal indefinida |

---

## Prevention Strategies

| Pitfall | Estratégia |
|---|---|
| Taxa nominal vs. efetiva (Simples) | Aceitar apenas taxa efetiva digitada pelo vendedor; nunca calcular internamente a partir da faixa de receita |
| PIS/COFINS errado (Lucro Presumido) | Pré-preencher 0,65%/3,00% como defaults; exigir confirmação para override |
| Base IRPJ errada (Lucro Presumido) | Seletor de tipo de atividade; exibir faixa esperada; alertar fora do range |
| Insumos não-creditáveis no Lucro Real | Aceitar apenas taxa efetiva líquida; sem cálculo de crédito a partir de despesas |
| Taxas desatualizadas | `updated_at` na config; aviso âmbar se > 6 meses; SLA de revisão trimestral |
| Fallback ausente | Exibir `—` nunca `0%`; badge "Não configurado" no card da loja |
| Leak cross-tenant (RLS) | `organization_id` em `ml_tax_config`; RLS com `is_org_member`; evitar SERVICE_ROLE para leituras fiscais |
| Taxa negativa (display) | Limitar em 0%; badge "Crédito" com tooltip |
| Drift de ponto flutuante | `NUMERIC(6,4)` no DB; arredondar apenas no display final |
| Vendedor inserindo imposto de compra | Helper text: "alíquota sobre vendas, não sobre compras" |
| Troca de regime acidental | Dialog de confirmação; logar troca com timestamp e valor anterior |
| Scope creep (DIFAL/ST/ISS/NF-e) | Limites rígidos no PROJECT.md; size-label todos os pedidos antes de discutir |
| Sem cobertura de testes para cálculo fiscal | Testes unitários para cada fórmula de regime — CONCERNS.md item 13 registra zero testes atualmente |

---

_Referências: LC 123/2006, LC 155/2016, Resolução CGSN 140/2018, Lei 9.718/1998, Lei 10.637/2002, Lei 10.833/2003, IN RFB 2.121/2022, RIR/2018 (Decreto 9.580/2018), EC 87/2015, ADC 49/STF (2021)._
