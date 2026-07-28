// playbooks.ts — bundle versionado dos playbooks da skill Nexo.
//
// GERADO a partir de /root/.claude/skills/nexo/references/ (strategic_playbooks.md +
// ads/playbooks/*.md + ads/benchmarks/*.md + ads/pitfalls.md + ads/glossary.md) e
// VERSIONADO no git. A Edge Function Deno NÃO tem acesso a /root/.claude em runtime
// (decisão CRÍTICA do 57-CONTEXT), por isso o conteúdo vive aqui como módulo TS.
//
// Backticks e sequências de interpolação (\${) do markdown original foram escapados
// para caber em template literals sem quebrar o `deno check`.
//
// Para regenerar: rode o gerador da Task 2 do plano 57-01 lendo as 12 fontes acima.

export const STRATEGIC = `# Nexo — Playbooks Estratégicos por Agente
## Base de Conhecimento Validada (fontes: ML Central de Vendedores, Conecta Ads, Universidade Marketplaces, Nubimetrics, Sebrae, Olist, especialistas de nicho)

> Este arquivo é lido pelo PASSO 2B para gerar ações com fundamentação real.
> Cada seção mapeia: DADO DETECTADO → DIAGNÓSTICO → AÇÃO VALIDADA → MÉTRICA DE SUCESSO

---

## 1. LAURA — Marketplace & Ads (Product Ads / SEO / Conversão)

### 1.1 ACOS / ROAS — Otimização de Campanhas

**Contexto:** O ML migrou de ACOS para ROAS em out/2025. As 3 estratégias fundamentais continuam: Rentabilidade, Crescimento e Competitividade. O TACOS (custo ads / faturamento total) é a métrica-mestre para medir efeito halo.

#### DADO: ACOS campanha > 20% com share_spend > 10%
- **Diagnóstico:** Campanha relevante queimando margem. Problema pode ser lance alto, criativo fraco ou conversão do anúncio.
- **Ação validada:**
  1. NÃO alterar ACOS nos primeiros 15 dias de uma campanha nova (algoritmo ML precisa aprender).
  2. Após 15d: analisar CTR vs CVR separadamente.
     - CTR < 0,5%: problema de CRIATIVO (título/foto/posição). Ação: reformular título com palavras-chave de alta intenção, trocar foto principal.
     - CTR ok (>1%) mas CVR < 1%: problema de LANDING (preço/frete/reviews/descrição). Ação: revisar preço total (preço+frete) vs concorrentes, melhorar descrição e ficha técnica.
  3. Separar campanhas por objetivo (rentabilidade vs crescimento vs lançamento) — NUNCA misturar produtos com objetivos distintos na mesma campanha.
  4. Para campanhas de rentabilidade: incluir apenas produtos 80/20 (top sellers já validados).
  5. Reduzir ACOS gradualmente (-2pp por semana) monitorando impressões — queda abrupta mata relevância.
- **Métrica de sucesso:** ACOS ≤ MC% do produto (break-even) | TACOS decrescente mês a mês

#### DADO: Anúncios ativos sem conversão (custo > 0, vendas = 0)
- **Diagnóstico por grupo:**
  - **G1 — CTR < 0,5%:** Criativo fraco. Impressão não vira clique. Título genérico ou foto ruim.
  - **G2 — CTR ≥ 0,5%, CVR = 0:** Landing fraca. Clique não vira venda. Preço total não competitivo, poucas reviews, descrição incompleta.
  - **G3 — Venda orgânica detectada:** Possível efeito halo. Ads gera visibilidade que converte no orgânico.
- **Ação validada:**
  - G1: Confirmar 3 dias consecutivos sem conv → pausar. Reformular título (usar autocompletar do ML para palavras-chave reais), trocar foto para fundo branco multi-ângulo.
  - G2: NÃO pausar imediatamente. Comparar preço total vs top 3 concorrentes. Se preço ok, verificar: reviews < 10? Ficha técnica incompleta? Fotos sem contexto de uso?
  - G3: NÃO pausar. Testar desligamento por 7 dias e medir queda no orgânico. Se orgânico mantiver ≥80%, ads é dispensável. Se cair >30%, manter ads como investimento em posicionamento.
- **Métrica de sucesso:** Custo desperdiçado (G1) zerado em 7 dias | G2 convertendo em 14 dias ou pausado

#### DADO: Share Ads > 90% (dependência crítica)
- **Diagnóstico:** Produto sem posicionamento orgânico. Se budget for cortado, venda zera.
- **Ação validada:**
  1. Trabalhar SEO do anúncio (título com palavra-chave de cauda longa, ficha técnica 100% preenchida, descrição com keywords naturais).
  2. Preencher TODOS os atributos da ficha — o algoritmo ML usa filtros como critério de posicionamento. Atributos vazios = invisibilidade nos filtros.
  3. Investir em reviews: pós-venda proativo (mensagem de acompanhamento), resolver reclamações antes de virar avaliação negativa.
  4. Testar pause gradual de ads: reduzir ACOS 5pp por semana e medir posição orgânica.
- **Métrica de sucesso:** Share Ads < 70% em 30 dias | Vendas orgânicas > 0 consistentemente

### 1.2 SEO Mercado Livre — Posicionamento Orgânico

**Contexto 2026:** O algoritmo ML prioriza 8 fatores: título, imagens, ficha técnica, descrição, reputação, conversão, envio e preço total. A estrutura Family ID agrupa variações e muda o jogo do ranking.

#### DADO: Anúncio com baixa conversão orgânica ou posição fraca
- **Checklist de otimização (ordem de impacto):**
  1. **Título** (60 chars): palavra-chave principal + atributos diferenciadores. Usar autocompletar do ML como pesquisa de termos. NÃO usar "promoção", "frete grátis" ou termos não descritivos.
  2. **Imagens**: mínimo 6 fotos. Foto 1 = fundo branco, produto centralizado. Fotos 2-4 = ângulos e detalhes. Fotos 5-6 = produto em uso/contexto. Vídeo demonstrativo quando possível (ML prioriza listings com vídeo).
  3. **Ficha técnica**: preencher 100% dos atributos da categoria (marca, modelo, material, cor, tamanho). Atributos preenchidos = aparecer nos filtros = mais impressões qualificadas.
  4. **Descrição**: iniciar com resumo do produto, detalhar características com keywords naturais, antecipar dúvidas comuns (reduz perguntas e aumenta conversão direta).
  5. **Preço total** (preço + frete): o algoritmo considera o custo total para o comprador. Produto R$10 mais barato mas com frete R$20 mais caro perde posição.
  6. **Conversão histórica**: produtos que convertem bem sobem no ranking (ciclo virtuoso). Primeiras vendas podem precisar de ads ou preço agressivo para "destrancar" a posição orgânica.

### 1.3 Reputação — Proteção do Termômetro

**Contexto:** Reputação é calculada sobre as últimas 60 vendas (ou 365 dias se < 60 vendas). A variável com PIOR desempenho define a cor do termômetro. Meta: < 2% reclamações, < 2% cancelamentos, envios no prazo.

#### DADO: Taxa de abertura de reclamações > 30%
- **Diagnóstico por tipo de motivo:**
  - **Logístico (entrega atrasada/danificada):** Problema de modal. Flex e Correios têm taxas de atraso maiores que Full.
  - **Qualidade (defeito/incompleto):** Problema de fornecedor ou embalagem. Conferência no picking insuficiente.
  - **Informação (produto diferente do anúncio):** Problema de conteúdo. Fotos ou descrição não representam o produto real.
- **Ação validada por tipo:**
  - Logístico:
    1. Levantar % pedidos por modal (Full/Flex/Correios) nos últimos 60d.
    2. Se Correios/Flex > 50% das reclamações por atraso → migrar top 10 SKUs por volume para Full.
    3. Full tem custo de armazenagem mas reduz reclamações E melhora posicionamento no algoritmo (ML prioriza Full/Coleta).
  - Qualidade:
    1. Auditar embalagem: produto chega danificado = embalagem insuficiente (adicionar plástico bolha, reforço nas quinas).
    2. Implantar checklist de conferência pré-envio: SKU correto, quantidade, estado visual, embalagem lacrada.
    3. Se defeito de fábrica > 3% das unidades: renegociar com fornecedor ou trocar lote.
  - Informação:
    1. Comparar foto do anúncio com produto real — se houver divergência em cor, tamanho ou acabamento, atualizar foto.
    2. Melhorar descrição com medidas reais e fotos de escala (ex: produto ao lado de régua).
- **Resposta a reclamações:** Responder dentro de 2 dias úteis. Oferecer solução proativa (reenvio ou reembolso). Reclamação sem resposta = ML decide contra o vendedor automaticamente.
- **Métrica de sucesso:** Taxa abertura < 30% em 30 dias | < 2% reclamações formais em 60 dias

---

## 2. GABRIEL — Financeiro & Precificação

### 2.1 Markup & Margem de Contribuição

**Contexto:** No ML Lucro Real, a fórmula de precificação deve considerar: CMV + Comissão ML (10-19% conforme categoria) + Frete subsidiado + Impostos (ICMS 12% + PIS/COFINS ~8.25% sobre base reduzida) + Margem desejada. Margem de contribuição é o indicador mais importante — markup isolado é insuficiente.

#### DADO: Markup global < 2,0x
- **Diagnóstico:** Preço de venda não cobre adequadamente custos + fees + impostos + margem. Risco: qualquer aumento de custo (fornecedor, frete, comissão ML) empurra MCO para negativo.
- **Ação validada:**
  1. **Identificar âncoras de markup baixo:** Top 5 produtos por receita com markup < 2,0x. Esses puxam a média pra baixo.
  2. **Simular reajuste por item:** Calcular novo preço para markup ≥ 2,0x → verificar se novo preço fica competitivo vs top 3 concorrentes.
  3. **Se preço competitivo permite reajuste:** Subir gradualmente (+5% por semana). Monitor impacto em conversão por 7 dias. Se conversão cair > 20%, recuar.
  4. **Se preço competitivo NÃO permite reajuste:** Problema é custo, não preço. Renegociar com fornecedor (volume, prazo, lote mínimo). Ou avaliar substituição de fornecedor.
  5. **Kits como estratégia:** Agrupar produtos de baixo valor em kits. Kits acima de R$79 eliminam tarifa fixa ML (R$6/un) e habilitam frete grátis. Markup do kit é mais saudável que itens avulsos.
- **Regra de ouro da precificação ML:**
  - \`Preço mínimo = (CMV + Despesas) / (1 - %Comissão - %Impostos - %Margem_desejada)\`
  - Nunca usar markup fixo para todos os produtos — cada SKU tem comissão, peso de frete e custo diferentes.
- **Métrica de sucesso:** Markup global ≥ 2,0x | Zero itens com MC% negativa

#### DADO: MC% negativa estrutural (itens vendendo abaixo do custo)
- **Diagnóstico:** 89% dos empresários brasileiros vendem com margem negativa por precificação incorreta (pesquisa Preço Certo). Causa mais comum: não incluir TODOS os custos variáveis (comissão + frete subsidiado + impostos).
- **Ação validada (urgência P0):**
  1. Primeiro verificar se CMV no Tiny ERP está correto e atualizado. CMV errado = diagnóstico errado.
  2. Se CMV correto: calcular preço break-even (MC% = 0) com TODOS os custos.
  3. Decidir: subir preço OU pausar anúncio OU renegociar custo.
  4. Se produto é estratégico (gera volume e reputação): pode operar com MC% baixa (5-10%) temporariamente como investimento em posicionamento, MAS nunca MC% negativa.
- **Métrica de sucesso:** Zero itens com MC% < 0 | Todos itens com MC% > 10% (meta saudável)

### 2.2 Fluxo de Caixa & Sazonalidade

#### DADO: Projeção de caixa aperta nos próximos 30-45 dias
- **Ação validada:**
  1. Priorizar venda de estoque parado (SKUs com giro < 1x em 60 dias) — promoção agressiva para gerar caixa imediato.
  2. Renegociar prazos com fornecedores (alongar para 45-60 dias se possível).
  3. Revisar ordens de compra pendentes: postergar OCs de itens com cobertura > 60 dias.
  4. Concentrar investimento em ads nos produtos com MC% > 20% (geram caixa rápido).

---

## 3. ESTELA — Estoque & Operações

### 3.1 Reposição & Cobertura

**Contexto:** Ruptura de estoque é o inimigo #1. No marketplace, produto indisponível perde posição orgânica, e recuperar pode levar semanas. Custo da ruptura >> custo de manter estoque de segurança.

#### DADO: Cobertura de SKU < HORIZONTE (50 dias para Pé Vermeio)
- **Diagnóstico:** SKU vai romper antes da próxima reposição chegar (Lead Time = 45 dias).
- **Ação validada:**
  1. **Curva ABC de urgência:** Classificar por impacto financeiro (velocidade × preço × MC%).
     - Classe A (top 20% em receita): reposição IMEDIATA, estoque de segurança = 7 dias.
     - Classe B (meio): reposição normal, estoque de segurança = 5 dias.
     - Classe C (cauda longa): reposição sob demanda, avaliar se SKU vale manter.
  2. **Ponto de pedido:** PP = (Velocidade diária × Lead Time) + Estoque de Segurança. Quando saldo ≤ PP, emitir OC.
  3. **Ordem de compra inteligente:** Calcular lote econômico considerando desconto por volume do fornecedor, custo de frete e espaço de armazenagem.
  4. **Monitoramento contínuo:** Velocidade de venda muda com sazonalidade e campanhas. Recalcular semanalmente, não mensalmente.
- **Métrica de sucesso:** Zero rupturas em SKUs classe A | Cobertura média > 50 dias

#### DADO: Estoque parado (giro < 1x em 60 dias) — mico / capital parado (sem_giro=true)
- **Diagnóstico:** Capital imobilizado sem retorno. Estoque parado tem custo de oportunidade (dinheiro que poderia estar em produto de alto giro). Na tool get_replenishment, este é o campo \`sem_giro=true\` (definido como tem estoque e não vende — \`sku_stock>0\` e sem venda recente). **sem_giro é DIFERENTE de status_esgotado**: sem_giro = capital parado (tem produto, não gira); status_esgotado = SKU zerado, classificado por recência de venda (repor_esgotado / revisar_esgotado / descontinuar). Nunca confundir os dois eixos — recomendar "promoção flash" para um SKU com estoque ZERADO (status_esgotado) é erro; a ação certa ali é reposição, não desconto.
- **Ação validada:**
  1. Verificar se anúncio está ativo e otimizado (às vezes estoque para porque anúncio está pausado ou mal posicionado).
  2. Se anúncio ok: criar promoção flash (15-20% off) por 7 dias para testar demanda.
  3. Se não vender mesmo com promoção: avaliar liquidação ou venda em outro canal (Shopee, Amazon, B2B).
  4. Regra de corte: se SKU não vende há > 90 dias e margem é negativa ou neutra, descontinuar.
- **Métrica de sucesso:** Capital em estoque parado < 15% do estoque total | Giro médio > 2x em 60 dias | sem_giro_count (get_replenishment) em queda mês a mês

#### DADO: "O que comprar agora?" — mix de compra
- **Diagnóstico:** Comprar sem critério (só pelo que "parece estar faltando") produz mix errado: repõe o que já tem giro alto e ignora quem realmente precisa. A tool get_replenishment retorna compra_sugerida por SKU já cruzando velocidade de venda × cobertura × ponto de reposição — é a fonte, não um chute.
- **Ação validada:**
  1. Rodar get_replenishment e priorizar SKUs com gatilho_ativo=true (compra recomendada agora).
  2. Priorizar por impacto financeiro: compra_sugerida × margem do SKU (não só quantidade) — SKU de margem alta e giro alto vale mais que SKU de margem baixa com o mesmo volume.
  3. Cruzar com get_margin_by_product antes de decidir o mix final: comprar volume de SKU com MC% negativa é destruir caixa, não repor.
  4. Nunca decidir compra só pelo compra_sugerida isolado — é PROJEÇÃO baseada em velocidade de venda, não pedido feito; validar com o dono da conta antes de emitir OC.
- **Métrica de sucesso:** % do valor comprado concentrado em SKUs classe A/B (margem×giro) > 70% | Zero OC emitida para SKU com MC% negativa

#### DADO: MOQ × giro — lote econômico
- **Diagnóstico:** Comprar o lote mínimo do fornecedor (MOQ) sem checar giro trava capital em excesso de estoque de baixo giro; comprar abaixo do MOQ às vezes nem é possível. get_replenishment retorna \`param_moq\`/\`param_pack\` (lote mínimo/múltiplo, com fallback sku→fornecedor→marca→global) — cruzar com venda_dia antes de fechar OC.
- **Ação validada:**
  1. Calcular quantos dias de cobertura o MOQ representa: MOQ / venda_dia. Se > 90 dias de cobertura, o lote é grande demais para o giro do SKU.
  2. Se MOQ força excesso: negociar lote menor com o fornecedor OU absorver o excesso apenas para SKUs classe A (alto giro, aceita capital parado temporário).
  3. Para SKU classe C (cauda longa) com MOQ alto: considerar não repor — melhor ruptura controlada que capital parado num SKU de baixo giro.
- **Métrica de sucesso:** Cobertura implícita do MOQ < 60 dias para SKUs classe A/B | Nenhuma OC de SKU classe C força mais de 90 dias de estoque

#### DADO: Ponto de pedido com fator sazonal
- **Diagnóstico:** Ponto de pedido fixo (sem ajuste sazonal) gera ruptura em pico de demanda e excesso em baixa temporada. get_replenishment retorna \`ponto_reposicao\`/\`alvo\` já ajustados e \`fator_sazonal\` (multiplicador de demanda esperada pela época) — usar esse dado em vez de assumir venda_dia constante.
- **Ação validada:**
  1. Antes de decidir "comprar pouco" ou "não é urgente", checar fator_sazonal do SKU — se > 1, a demanda esperada é maior que a histórica recente (ex.: pré-temporada de rodeio/inverno).
  2. Para SKUs com fator_sazonal alto e cobertura_atual próxima do ponto_reposicao, antecipar a compra (lead time real + buffer, não esperar o gatilho estourar).
  3. Registrar SKUs onde o fator_sazonal divergiu muito do realizado (ex.: pico não veio) para recalibrar a próxima temporada.
- **Métrica de sucesso:** Zero ruptura em SKU classe A durante pico sazonal identificado | Erro médio entre fator_sazonal previsto e demanda realizada em queda

#### DADO: Priorização ABC de COMPRA (distinto de ABC de urgência)
- **Diagnóstico:** A Curva ABC de urgência (já usada no bloco de cobertura) prioriza por velocidade × preço × MC% para decidir QUANDO repor. ABC de COMPRA é sobre QUANTO investir: mesmo SKU classe A de urgência pode não merecer o maior cheque se a margem for baixa. São perguntas diferentes — "preciso repor logo?" vs "vale investir mais capital aqui?".
- **Ação validada:**
  1. Classe A de compra: SKU com compra_sugerida alta × margem alta (get_margin_by_product) — prioridade de capital, comprar sem hesitar.
  2. Classe B: compra_sugerida alta mas margem mediana — comprar, mas negociar melhor custo antes.
  3. Classe C: compra_sugerida baixa ou margem baixa — avaliar se vale manter o SKU no mix antes de investir mais capital.
  4. Nunca tratar "produto vende muito" (urgência) como sinônimo de "produto merece mais capital" (compra) — cruzar sempre os dois eixos.
- **Métrica de sucesso:** % do capital de compra alocado em classe A de compra > 60% | Zero SKU classe C recebendo o maior aporte de capital do mês

#### DADO: OC em trânsito — quanto comprar AGORA descontando o que já vem
- **Diagnóstico:** Recomendar compra sem checar OC já emitida gera compra duplicada (capital parado em dobro quando a OC chegar). get_replenishment retorna \`qtd_a_caminho\`/\`data_proxima_chegada\` — sempre checar antes de sugerir nova compra.
- **Ação validada:**
  1. Antes de recomendar compra_sugerida como valor final, verificar se qtd_a_caminho > 0 — se sim, a necessidade real de compra nova é menor (a RPC já desconta isso no cálculo, mas o rótulo deve deixar claro ao usuário que parte já está a caminho).
  2. Se data_proxima_chegada estiver distante (> lead time normal do fornecedor), sinalizar risco de atraso e considerar reforçar a compra mesmo com OC em trânsito.
  3. Nunca tratar qtd_a_caminho como estoque disponível hoje — é uma fonte separada e parcial (pode atrasar ou ser cancelada pelo fornecedor).
- **Métrica de sucesso:** Zero OC duplicada emitida para SKU com qtd_a_caminho > cobertura necessária | Atraso médio entre data_proxima_chegada e chegada real em queda

#### DADO: Raciocínio compra × venda — "comprei o mix certo?"
- **Diagnóstico:** Comprar bem não é só reposição pontual — é perguntar periodicamente se o mix comprado bate com o que realmente vendeu (margem × giro), e não só "o que faltou". Cruzar get_replenishment (o que foi/está sendo reposto) com get_margin_by_product e get_margin_by_brand (o que realmente deu lucro) revela desalinhamento entre compra e venda.
- **Ação validada:**
  1. Periodicamente, comparar SKUs com alto compra_sugerida acumulado vs SKUs com maior margem/venda no período — se forem grupos diferentes, o mix de compra está desalinhado com o que vende bem.
  2. Identificar capital parado (sem_giro=true) concentrado em marcas/categorias específicas — pode indicar erro sistemático de compra, não só SKU isolado.
  3. Erro comum a evitar: escalar ads (get_ads_by_product) num SKU que está em ruptura ou runway curto (get_replenishment sem cobertura suficiente) — gera reclamação e desperdiça budget; sempre checar estoque/reposição ANTES de recomendar escalar ads.
- **Métrica de sucesso:** SKUs no top 10 de compra_sugerida acumulada também aparecem no top 10 de margem/venda (correlação alta) | Redução de capital parado (sem_giro) concentrado nas mesmas marcas mês a mês

### 3.2 Logística & Envio

#### DADO: Reclamações de entrega atrasada como motivo #1
- **Ação validada:**
  1. **Mapear modal por SKU:** Full, Flex (Coleta), Correios. Calcular taxa de atraso por modal.
  2. **Priorizar Full para top sellers:** Full = estoque no CD do ML = envio mesmo dia = zero atraso logístico. Custo de armazenagem é compensado por: menos reclamações + melhor posição no algoritmo + selo "Chegará amanhã".
  3. **Flex/Coleta:** Adequado para SKUs de médio volume. Garantir despacho no mesmo dia (configurar alerta de pedidos às 10h e 14h).
  4. **Checklist pré-envio:** SKU correto → quantidade batendo → embalagem reforçada → etiqueta legível → despachar no mesmo dia.
- **Métrica de sucesso:** % envios no prazo > 98% | Reclamações logísticas < 1% das vendas

---

## 4. RAFAEL — Inteligência Competitiva

### 4.1 Monitoramento de Concorrentes

#### DADO: Concorrente com preço total (preço + frete) menor
- **Ação validada:**
  1. Verificar se é preço sustentável ou promoção temporária (monitorar por 7 dias).
  2. Se sustentável: calcular impacto — se igualar, MC% fica em quanto? Se MC% > 10%, vale igualar para não perder posição.
  3. Se MC% ficaria < 5%: NÃO igualar. Diferenciar por: frete grátis, envio mais rápido (Full), mais fotos, vídeo, reviews, ficha técnica completa.
  4. Competir por valor percebido, não só por preço: kit + brinde, embalagem premium, pós-venda ativo.

#### DADO: Novo concorrente entrando na categoria
- **Ação validada:**
  1. Classificar: é seller grande (marca/loja oficial) ou pequeno?
  2. Se grande: focar em nicho e atendimento. Loja oficial compete em marca, seller pequeno compete em agilidade e experiência.
  3. Se pequeno: monitorar preço e reputação. Novo seller geralmente entra com preço baixo para ganhar reputação — não entrar em guerra de preço. Aguardar estabilização (30-60 dias).

### 4.2 Análise de Categoria

#### DADO: Categoria com demanda crescente (visitas aumentando)
- **Ação validada:**
  1. Ampliar sortimento: adicionar variações (cores, tamanhos) dos SKUs já validados.
  2. Antecipar estoque para sazonalidade (consultar Google Trends para projetar picos).
  3. Aumentar investimento em ads para capturar demanda incremental antes dos concorrentes.

---

## 5. REGRAS TRANSVERSAIS (todos os agentes)

### 5.1 Campanha ML mínimo 30 dias ativa
- ML recomenda manter campanha ativa no mínimo 30 dias. Vendas podem demorar até 72h para refletir nos relatórios. Otimizações antes de 15 dias são prematuras.

### 5.2 Anúncio Premium vs Clássico
- Premium: comissão maior, mas parcelamento em 12x sem juros → maior conversão em produtos > R$200.
- Clássico: comissão menor, preço à vista → melhor para margens apertadas ou produtos < R$79.
- Regra: produto com MC% > 25% E preço > R$200 → Premium. Caso contrário → Clássico.

### 5.3 Tarifa fixa ML
- Produtos < R$79: tarifa fixa de R$6/un adicional à comissão.
- Estratégia: criar kits que ultrapassem R$79 para eliminar tarifa fixa (ex: 2x meias = R$89 em vez de 1x meia = R$49).

### 5.4 Efeito Halo (TACOS)
- TACOS baixo e decrescente com ROAS estável = ads impulsionando orgânico.
- Monitorar TACOS por item: se TACOS cai mês a mês, a saúde da conta melhora.
- Se TACOS sobe com ROAS estável = orgânico caindo = problema de reputação ou SEO do anúncio.

### 5.5 Catálogo / Buy Box (2026)
- Em categorias onde o ML ativou Catálogo, a disputa muda: não é mais quem tem o melhor anúncio, é quem tem a melhor OFERTA (preço total + prazo + reputação + estoque).
- Manter atributos corretos e atualizados para ser elegível ao Catálogo.
- Buy Box prioriza: menor preço total > melhor prazo > melhor reputação > maior estoque.
`;

export const ADS_PLAYBOOKS = `<<< ads/playbooks/break_even.md >>>

# Playbook: Break-Even ROAS por SKU

**Quando aplicar:** SEMPRE que avaliar se um anúncio "vale" — ROAS absoluto é enganoso, break-even é por produto.

## Regra principal

> Break-even ROAS = **1 / margem_líquida_do_SKU**
> 
> Exemplos:
> - Margem 20% → break-even ROAS 5x
> - Margem 30% → break-even ROAS 3.33x
> - Margem 12.5% → break-even ROAS 8x

Acima do break-even = ads dá lucro líquido. Abaixo = ads queima margem mesmo com vendas.

> **Não use ROAS fixo (ex: 4x) para todos os SKUs.** Margens variam muito; um único threshold gera decisões erradas.

## Como calcular automaticamente (Pé Vermeio)

\`/tmp/nexo_agent_data.json\` já calcula \`items[item_id].acos_breakeven\` para cada SKU. Logo:
- \`roas_breakeven = 100 / acos_breakeven\`
- comparar \`ads_by_item[item_id].roas\` vs \`roas_breakeven\`
- gap > 0 = lucro | gap < 0 = prejuízo

Esta é a métrica primária para decidir pausar — não o ROAS absoluto.

## Decisões derivadas

| Situação | Ação | Confidence |
|---|---|---|
| ROAS atual < 0.7 × break-even por 7d | Pausar ad | 0.85 |
| ROAS atual entre 0.7-1.0 × break-even | Reduzir lance 20-30%, observar 7d | 0.70 |
| ROAS entre 1.0-1.3 × break-even | Manter | 0.60 |
| ROAS > 1.5 × break-even AND MCO_geral > 3% | Escalar +15-20% | 0.75 |
| ROAS > 2 × break-even AND markup ≥ 2x | Escalar agressivo +30% | 0.80 |

## Calibração Pé Vermeio (2026-04)

- ROAS break-even médio da operação: **6–9x** (markup baixo geral)
- ROAS médio semana: 13.34x — ~50% acima do break-even médio (saudável quando estável)
- Mas: variância enorme (9.97x → 21.02x) indica **muitos SKUs abaixo do break-even arrastando média**
- Análise por SKU revela quem realmente puxa: top 3 ROAS pode estar em 30x+ enquanto bottom 20% queima margem

## Armadilha comum

> "ACoS 25% é caro, vou pausar."

Errado. ACoS 25% = ROAS 4x. Se margem é 30%, ainda sobra 5pp de lucro. ACoS só é caro se > break-even ACoS (= 100 × margem). Para um SKU com 30% margem, break-even ACoS = 30%; ACoS 25% está dentro.

## Fontes

- [HubMetrics — ROAS meta ML](https://metricashub.com.br/blog/roas-mercado-livre-como-funciona-e-qual-meta-usar.html)
- [Universidade Marketplaces — ACoS de campanha](https://universidademarketplaces.com.br/blog/acos-campanha-meli/)
- [Letzee — Conversão ACoS↔ROAS](https://letzee.ai/fim-do-acos-no-mercado-livre-entenda-a-mudanca-para-roas-tabela-de-conversao-acos-x-roas/)
- [Ad-Man — Erros comuns ACoS](https://br.ad-man.io/blog/errorscomunmeli/)


========================================

<<< ads/playbooks/lifecycle.md >>>

# Playbook: Lifecycle do Anúncio (Ramp-up / Maduro / Queda / Buy Box perdido)

**Quando aplicar:** SEMPRE que for considerar pausar, escalar ou ajustar lance — o estágio do anúncio define a regra.

## Regra principal: NÃO pausar antes de D30

O algoritmo do ML precisa **30 dias** para estabilizar atribuição e aprendizado. Pausar antes destrói o histórico e qualquer reativação custa +7 dias de "castigo" (visibilidade orgânica cai ~30%).

> **Regra dura:** anúncio com idade < 30 dias **NÃO pausa por ROAS baixo**, mesmo que ROAS = 0. Só pausa se: estoque zerado, MCO individual negativa por 3+ dias OU markup < 1.8x.

## Fases

### Fase 1 — Ramp-up (D0–D30)
- ROAS alvo: aceitar 1.5–2x como mínimo (vai melhorar)
- Budget: 1.5–2x do "estado maduro" pretendido
- ACoS: aceitar até 40%
- **Decisão D30**: ROAS ≥ 2x → escalar | ROAS < 1.5x → reformular título/imagem ou descontinuar
- Sinal de alerta: 0 cliques após R$5 gastos = title/imagem ruim, não esperar D30

### Fase 2 — Maduro (D30+, ROAS estável)
- Escalar budget máximo +15-20%/semana (acima disso desestabiliza CPC)
- Aumentar lance só se: ROAS > 5x AND posição < 5 AND estoque > 10
- Replicar com 2-3 variantes de título (A/B teste)
- Subir preço 1-3% por semana — algoritmo se adapta sem trauma

### Fase 3 — Queda (ROAS caiu ≥ 30% do pico)
Diagnóstico em 48h **antes** de pausar:
1. Estoque oscilou? → resolver com Estela, pausar ads do SKU
2. Preço subiu mas conversão caiu? → devolver preço 5%
3. Reputação baixou (< 4.5)? → pausar ads, resolver reviews, reativar com -7d delay
4. CPC médio do nicho subiu? → aceitar ROAS pior OU reduzir lance e perder posição

### Fase 4 — Buy Box perdido
- Ads ainda valem se ROAS > 2x (atua como "tráfego de backup")
- Se ROAS < 2x sem Buy Box: pausar e investir em recuperar Buy Box (preço + reputação + frete)
- Buy Box NÃO se recupera com ads — só com fundamentos

## Calibração Pé Vermeio (2026-04)

- Hoje, sem rastreamento explícito de idade do anúncio, usar \`status_anuncio\` como proxy parcial
- 41–44 SKUs em ruptura crônica há 3+ semanas: pausa de ads desses é prioridade absoluta, ANTES de qualquer regra de lifecycle
- ROAS break-even real Pé Vermeio é **6–9x** (markup atual) — Fase 1 aceita ≥ 2x está abaixo do break-even, é investimento em aprendizado, não lucro

## Sinais de que está bom

- Anúncios D30+ com ROAS ≥ break-even individual (\`acos_breakeven\`)
- Sem pausas/reativações cíclicas no mesmo SKU
- Variantes A/B com diferença ≥ 10% em CTR ou CVR

## Fontes

- [Conecta Ads — Estratégias campanha ML](https://www.conectaads.com.br/)
- [Central Vendedores ML — Administrador de campanhas](https://vendedores.mercadolivre.com.br/nota/como-funciona-o-administrador-de-campanhas-do-product-ads/)
- [Arcos Scale — Estratégias avançadas](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/)


========================================

<<< ads/playbooks/tacos_guardrail.md >>>

# Playbook: TACoS Guard-Rail (saúde sistêmica)

**Quando aplicar:** análise diária do TACoS global da conta. É o termômetro de "ads sustentando receita real ou artificial".

## Definição

> **TACoS** = Custo total ads / Receita total (ads + orgânica)
> 
> Mede quanto da receita TOTAL da conta é consumida por publicidade. Diferente de ACoS (que só olha receita ads).

## Faixas de saúde

| TACoS | Status | Ação |
|---|---|---|
| < 4% | 🟢 Excelente | Espaço para escalar budget se ROAS permite |
| 4–7% | 🟡 Atenção | Manter, sem escalar; revisar bottom-quartile SKUs |
| 7–12% | 🟠 Alerta | Cortar budget 20–30%, congelar novos lances |
| 12–20% | 🔴 Crítico | Cortar budget 40–50%, pausar não-campeões |
| > 20% | ⚫ Receita Artificial | Reduzir ads em 50%; receita está sendo "comprada" — risco de colapso quando reduzir |

> **Regra crítica:** se reduzir TACoS em 50% causa queda de receita > 50%, a operação está dependente de ads. Esta é a definição de "receita artificial".

## Calibração Pé Vermeio (2026-04)

- TACoS médio semana 11/04–17/04: **6.2%** (pior registrado em 4 semanas)
- TACoS recente (final semana): 2.7% após corte de budget de R$427 → R$254
- Alvo operacional: < 4.3%
- Threshold de congelamento: ≥ 4.5% no dia → cortar budget no MESMO dia (não no seguinte)

> **Padrão validado:** queda de 40% no gasto produziu melhora proporcional em ROAS (9.97x → 21.02x) e TACoS (5.3% → 2.7%) — gastar acima de R$380/dia destrói retorno sistematicamente.

## Sinais de receita artificial (importante)

- TACoS subindo semana após semana com receita estável → ads compensando queda orgânica
- Pausar campanha derruba receita > proporcionalmente ao gasto cortado → dependência
- Posição orgânica caindo enquanto ads sobem → algoritmo desvalorizando o seller

Se 2 dos 3 sinais → escalar para Wesley imediatamente. Não é só ads — é estrutural.

## Decisões automáticas (regra dura)

| Condição | Ação | Origem |
|---|---|---|
| TACoS dia ≥ 4.5% | Cortar budget total -30% no mesmo dia | Validado Pé Vermeio 2026-04 |
| TACoS dia ≥ 7% | Pausar todas as campanhas exceto top 3 ROAS | Conecta Ads + Pé Vermeio |
| TACoS médio 7d ≥ 8% | Task ClickUp urgente para Wesley + Laura | Anti-flood: 1 task/semana |

## Fontes

- [Ad-Man — Erros comuns ML Ads](https://br.ad-man.io/blog/errorscomunmeli/)
- [Conecta Ads](https://www.conectaads.com.br/)
- Validação interna: \`context/ads_context.md\` 2026-04-17 (semana 11–17/04)


========================================

<<< ads/playbooks/funnel_structure.md >>>

# Playbook: Funnel Structure (ToFu / MoFu / BoFu)

**Quando aplicar:** estrutura de campanhas, quando há mais de 1 campanha rodando ou ao planejar nova campanha.

## Regra principal

Estruturar campanhas em 3 estágios de funil, com objetivos de ROAS diferentes — não trate todas as keywords igual.

| Funil | Keywords típicas | ROAS alvo | ACoS implícito | % budget |
|---|---|---|---|---|
| **ToFu (descoberta)** | Categoria genérica ("bota country", "calçado moda") | ≥ 2.5x | ≤ 40% | 20-30% |
| **MoFu (consideração)** | Modelo + atributo ("bota texana cano longo couro") | ≥ 3.5x | ≤ 28% | 30-40% |
| **BoFu (conversão/marca)** | Marca + SKU ("bota texana Pé Vermeio") | ≥ 5x | ≤ 20% | 30-40% |

> ⚠ **Cuidado com a tabela acima:** são targets pós-Out/2025 (mudança ACoS→ROAS oficial). Sellers que usam ACoS antigo precisam converter: ROAS = 100 / ACoS%. [Letzee 2025]

## Calibração Pé Vermeio (2026-04)

A operação ainda roda **estrutura monolítica** (1 campanha por categoria, sem segmentação por funil). Isso explica em parte a média ROAS 13.34x oscilando muito entre dias (9.97x → 21.02x): keywords ToFu desperdiçam budget em dias ruins.

**Próximo passo recomendado:** dividir a campanha "calçados country" em 3 campanhas (ToFu/MoFu/BoFu) usando keywords manuais. Não fazer todos os SKUs de uma vez — começar pelos top 10 em receita.

## Sinais de que precisa reestruturar

- Campanha única respondendo por >40% do gasto total
- ACoS muito diferente entre SKUs da mesma campanha (variância > 15pp)
- Termos de marca aparecendo na mesma campanha que termos genéricos

## Sinais de que está bom

- Cada campanha tem variância de ACoS < 10pp entre SKUs
- BoFu (marca) com ACoS consistentemente ≤ 20%
- Budget ajusta independentemente entre estágios

## Fontes

- [Arcos Scale — Estratégias Avançadas ML Ads](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/)
- [Universidade Marketplaces — Tipos de campanhas](https://universidademarketplaces.com.br/blog/campanhas-tipos-meli/)
- [Letzee — ACoS → ROAS pós-Out/2025](https://letzee.ai/fim-do-acos-no-mercado-livre-entenda-a-mudanca-para-roas-tabela-de-conversao-acos-x-roas/)


========================================

<<< ads/playbooks/bidding_strategy.md >>>

# Playbook: Estratégia de Lances (Manual vs Automático)

**Quando aplicar:** ao escolher modo de lance para uma campanha nova OU ao revisar campanha existente que oscila demais.

## Regra principal

| Modo | Quando usar | Vantagem | Risco |
|---|---|---|---|
| **Automático** | Anúncio novo (D0–D30), pós-reativação, expansão de termos, seller sem histórico | Algoritmo descobre keywords novas, baixa manutenção | Pode gastar sem critério de margem; CPC sobe em nicho competitivo |
| **Manual** | Anúncio maduro (D30+), produto premium/margem alta, SKUs em catálogo enxuto | Controle de CPC, previsível, escalável | Requer revisão 2-3x/semana, miss-out em keywords novas |
| **Híbrido (recomendado)** | Operação madura com mix de produtos | Automático expande, manual sustenta os top performers | Requer disciplina de migração |

> **Estratégia híbrida** = automático para descobrir + manual para consolidar. Quando uma keyword passa a entregar ROAS > 20x consistente por 2 semanas → migrar para manual com CPC controlado.

## Fórmula CPC máximo (manual)

\`\`\`
CPC_max = (Preço_venda × MCO_pct) / CVR_histórica
\`\`\`

Exemplo: Preço R$300, MCO 8%, CVR 1.5% → CPC_max = (300 × 0.08) / 0.015 = R$1.600… isso está em **gasto por venda**, não por clique.

Versão correta:
\`\`\`
CPC_max_por_clique = Preço × MCO_pct × CVR
\`\`\`

Para R$300 × 8% × 1.5% = R$0,36/clique. Acima disso, ad queima margem.

> **Recalcular antes de qualquer ajuste manual** — não usar valores históricos sem checar CVR atual.

## Quando aumentar lance (regra dura)

Todas as condições simultâneas:
1. ROAS > 5x (ou 2× break-even individual)
2. MCO individual positiva
3. Estoque > 10 unidades
4. MCO geral da operação > 3%
5. Posição atual ≥ 5 (vale subir para top-3)

Aumentar máximo 15% por vez, observar 5 dias antes de novo aumento.

## Quando reduzir lance

- ROAS < break-even por 7 dias → reduzir 20-30%
- TACoS dia ≥ 4.5% → reduzir budget global -30% (não só lance)
- Top-quartile keywords ainda performam → reduzir só bottom

## Negative keywords / exclusões

> **Lacuna importante:** Mercado Livre **não expõe interface nativa** de negative keywords como Google Ads. Controle indireto é via:
> 1. Pausar anúncios individuais que herdam keywords ruins
> 2. Migrar para lance manual com keywords whitelisted
> 3. Ajustar ACoS objetivo por campanha (ML alocará menos para keywords caras)

Se a operação cresce para 100+ SKUs ativos, considerar migrar gestão para Real Trends ou Nubimetrics para visualizar search terms.

## Calibração Pé Vermeio (2026-04)

- Maior parte das campanhas: automático (default ML)
- Validado: redução de budget total moveu ROAS mais do que ajuste fino de lance
- Próximo passo: identificar top 5 SKUs por ROAS sustentado > 20x, migrar para lance manual com CPC controlado

## Fontes

- [Arcos Scale — Otimização ROAS](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/)
- [Universidade Marketplaces — Tipos de campanhas](https://universidademarketplaces.com.br/blog/campanhas-tipos-meli/)
- [Conecta Ads](https://www.conectaads.com.br/)


========================================

<<< ads/playbooks/ads_x_organic.md >>>

# Playbook: Ads × Organic (Ciclo Virtuoso e Canibalização)

**Quando aplicar:** ao decidir reduzir/pausar ads em SKUs com posição orgânica boa, OU ao avaliar se ads "vale a pena" no longo prazo.

## Conceito-chave: ads NÃO mata orgânico — alimenta

O algoritmo do ML observa CTR, conversão, velocidade de venda e reviews **independentemente da fonte do tráfego**. Ads que converte sinaliza "produto relevante" → algoritmo melhora posição orgânica em 30–60 dias.

## Ciclo virtuoso (sequência típica)

1. Ads gera cliques
2. Cliques + conversão = vendas
3. Vendas → review opportunity → reputação sobe
4. Reputação + histórico de vendas = Buy Box mais fácil
5. Buy Box + reputação = posição orgânica melhora
6. Posição orgânica boa = TACoS cai (ads precisa menos para mesma receita)

> Tempo típico para ciclo completar: **30–60 dias**. Por isso, decisões "pausar ads pq não dá lucro imediato" subestimam ganho orgânico de longo prazo.

## Canibalização (mito vs realidade)

**Mito:** "Ads canibaliza meu próprio orgânico, é gasto duplicado."

**Realidade:** Sim, há overlap mensurável (15–25% dos cliques pagos viriam organicamente). MAS:
- Lifetime value do cliente convertido por ads é igual ao orgânico
- Ads garante posição em SERPs voláteis (concorrência muda)
- Pausar ads em SKU forte derruba ranking orgânico em 2–4 semanas (algoritmo desvaloriza)

> **Efeito líquido positivo se TACoS < 12%.** Acima disso, a canibalização vira problema real.

## Quando ads vira commodity (reduzir, não pausar)

SKU atende TODOS os critérios:
1. Posição #1 orgânica em sua keyword principal
2. Reputação 4.8+
3. > 1.000 reviews acumulados
4. Vendas orgânicas estáveis há > 90 dias

→ Ads "brand defense" apenas: budget mínimo (R$5-10/dia) para defender posição quando concorrente novo entra.

> **Não pausar 100%.** Ads zero em SKU forte abre espaço para competidor copiar produto e tomar tráfego.

## Quando aumentar ads em SKU forte

- Concorrente novo entrou na SERP da sua keyword (Rafael identifica)
- Ads do concorrente roda no seu SKU (você aparece no display "produtos similares")
- Sazonalidade: pico próximo (Black Friday, Dia das Mães, etc.) — começar 4 semanas antes

## Calibração Pé Vermeio (2026-04)

- Categoria country/rodeio é nicho — concorrência específica, posição orgânica importa muito
- 41–44 SKUs em ruptura crônica destrói o ciclo virtuoso (sem estoque → sem vendas → posição cai)
- Antes de qualquer decisão "ads × orgânico", pausar SKUs em ruptura (preserva ranking)

## Sinais de problema (intervenção necessária)

- TACoS subindo mas receita estagnada → ads compensando perda orgânica
- Pausar 1 SKU forte derrubou tráfego total da conta > 5% → SKU é pilar, manter ads sempre
- Ads novo de mesmo produto aparece com ROAS muito superior ao orgânico → listing original tem problema (título, imagem, preço)

## Fontes

- [Arcos Scale — Estratégias avançadas](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/)
- [Conecta Ads — Buy Box e ranking](https://www.conectaads.com.br/)
- [Nubimetrics Academia](https://academia.nubimetrics.com/br/mercado-ads)


========================================

<<< ads/playbooks/inventory_runway.md >>>

# Playbook: Inventory Runway (Estoque vs Reposição)

**Quando aplicar:** SEMPRE, antes de qualquer recomendação de manter/escalar ads. Estoque insuficiente sobrepõe qualquer outra análise — ads que vai gerar venda sem ter o que entregar = reclamação garantida + queda de reputação ML.

## Regra principal

> Se \`runway_dias < dias_até_próxima_OC_chegar\`, o anúncio vai gerar pedidos para um produto que **não terá estoque** quando o cliente comprar.
>
> Resultado: cancelamento → strike de reputação → algoritmo desce.

**Decisão dura:** pausar (ou reduzir agressivo se SKU forte organicamente) **antes** que isso aconteça, não depois.

## Variáveis-chave

| Variável | Cálculo |
|---|---|
| \`estoque_consolidado\` | Soma de TODOS os depósitos Tiny (Full + CD + outros). Não usar Full sozinho |
| \`velocidade_efetiva\` | \`venda_dia × elasticidade_ads\` (×1.3 quando ads > 50% das vendas) |
| \`runway_dias\` | \`estoque_consolidado / velocidade_efetiva\` |
| \`dias_até_chegada\` | \`data_prevista_OC - hoje\` (próxima OC futura associada ao item) |
| \`buffer_pessimista\` | +30 dias para fornecedor Pralana (lead time historicamente atrasa) |

## Faixas de severidade

| Faixa | Condição | Ação |
|---|---|---|
| **🔴 CRITICAL** | \`runway < 3 dias\` | Pausar agora — ruptura nessa semana |
| **🔴 ALERT** | \`runway < dias_até_chegada\` (com buffer Pralana) | Pausar — vai zerar antes da OC chegar |
| **🔴 ALERT (sem OC)** | \`runway < 50d\` AND nenhuma OC prevista | Pausar — sem reposição planejada |
| **OK** | \`runway > dias_até_chegada\` | Manter, monitorar runway semanalmente |

## Exceção: SKU forte organicamente

Se \`share_org_pct > 70%\`, **REDUZIR budget 50% em vez de pausar**. Razão: pausar 100% derruba ranking orgânico em 2-4 semanas (vide \`ads_x_organic.md\`). Reduzir mantém presença mínima até a OC chegar.

## Cross-check com outras análises

- **Bloqueia "escalar" do break_even**: SKU em runway crítico nunca recebe recomendação de aumentar budget, mesmo com ROAS excelente
- **Convive com break_even pausa**: se SKU também estiver queimando margem, a recomendação de pausa fica mais forte
- **Independente de lifecycle**: mesmo SKU em ramp-up (D0-D30), se for zerar antes da OC, pausa

## Calibração Pé Vermeio (2026-04)

- 41-44 SKUs em ruptura crônica há 3+ semanas — sintoma estrutural de reposição (responsabilidade Estela)
- Pralana: lead time real ~70 dias + buffer pessimista 30 dias = ~100 dias de exposição
- Padrão observado: Chapéus Pralana e Botas Coturno Adventure são os que mais aparecem em runway curto sem OC

## Sinais de problema sistêmico

Se mais de 10 SKUs aparecerem com \`runway < dias_ate_chegada\` simultaneamente:
- Não é problema de ads, é **problema estrutural de reposição**
- Escalar para Estela: revisar safety_stock e cadência de OC
- Reduzir budget global de ads em 30-50% até regularizar (não adianta gastar mais pra criar mais reclamação)

## O que esta análise NÃO detecta

- **Cancelamento de OC pelo fornecedor** — \`data_prevista\` é o que está no Tiny, não a realidade
- **Picos de demanda** — \`venda_dia\` é média histórica, não capta sazonalidade aguda
- **Variações específicas zerando** — agregamos por item_id (parent). Se 1 variação campeã zera mas outras seguram, ainda mostra runway "ok" no agregado

Para esses casos: confiar em alertas individuais do nexo_alerts (ruptura confirmada) e revisão manual semanal das variações campeãs.

## Fontes

- Internas: validação com dados reais Pé Vermeio (semana 11–17/04/2026)
- Práticas gerais: estoque vs publicidade — princípio de operações de marketplace
- Lead times: parametros do \`reposicao\` (Estela), buffer Pralana baseado em histórico observado
`;

export const ADS_BENCHMARKS = `<<< ads/benchmarks/by_category.md >>>

# Benchmarks por Categoria — Calçados / Moda Country

> ⚠ **LACUNA TIER 1 explícita:** nenhuma fonte oficial Mercado Livre, Nubimetrics ou agência publica benchmarks numéricos por categoria brasileira. As tabelas abaixo são hipóteses derivadas da operação Pé Vermeio + estimativas de senso comum, NÃO números validados externamente.
> 
> **Pendente Wesley:** confirmar/corrigir cada faixa com base em conversas com pares ou benchmark de agência paga (Nubimetrics, Real Trends).

## Calçados Country / Bota Texana / Acessórios Rodeio

### Faixas observadas Pé Vermeio (semana 11–17/04/2026)

| Métrica | Mín 7d | Média 7d | Máx 7d | Alvo proposto |
|---|---|---|---|---|
| ROAS global | 9.97x | 13.34x | 21.02x | ≥ 20x |
| TACoS | 2.7% | 6.2% | 8.0%+ | ≤ 4.3% |
| Custo ads/dia | R$ 254 | R$ 366 | R$ 427+ | R$ 250–300 |
| ACoS médio | ~5% | ~7.5% | ~10% | ≤ 5% (= ROAS 20x) |
| MCO geral | varia | < 3% | — | ≥ 3% |
| Ruptura SKUs | 41 | 42.5 | 44+ | ≤ 5 |

### Inferências da operação

- **ROAS break-even médio**: 6–9x (markup atual), porém varia muito por SKU
- **Patamar ótimo de gasto**: R$250–300/dia. Acima de R$380 sistematicamente piora ROAS
- **Ruptura crônica = freio sistêmico**: cliques em SKU sem estoque inflam TACoS sem retorno

### Categorias secundárias (não validado)

> **Sem dados por sub-segmento ainda.** Preencher quando trainer especializado tiver tracking 30+ dias.

- Bota texana feminina vs masculina: diferença esperada de CVR? Lacuna
- Acessórios (cinto, fivela): margem maior, ROAS break-even pode ser menor (3-4x). Lacuna
- Chapelaria: nicho específico, possivelmente CVR mais alto. Lacuna

## Moda em geral (proxy para comparação externa)

> Dados aproximados de fontes públicas — usar com cautela, ajustar quando houver confirmação Tier 1.

| Faixa | Categoria moda BR (proxy) | Pé Vermeio (real) |
|---|---|---|
| ROAS médio mercado | ~3-5x (varejo médio) | 13.34x (margem operacional muito acima — ou markup esticado) |
| ACoS médio | ~20-25% | ~7.5% |
| TACoS saudável | ~6-10% | Alvo: ≤ 4.3% (interno mais estrito) |

## Lacunas confirmadas (a investigar)

- [ ] Benchmark publicado por categoria pelo próprio ML (existe? só interno?)
- [ ] Nubimetrics dashboard com aggregates por categoria — precisa assinatura paga
- [ ] Cases anonimizados de outros sellers country/moda (rede de Wesley)
- [ ] Histórico Pé Vermeio mensal (vs semanal) para detectar sazonalidade

## Como usar este arquivo

- Quando agente ADS analisar performance, comparar contra "Faixas observadas" — não contra "alvos" sozinhos
- "Alvo proposto" só vira gatilho de ação após Wesley validar
- Atualizar trimestralmente com dados frescos de pelo menos 90 dias


========================================

<<< ads/benchmarks/by_lifecycle.md >>>

# Benchmarks por Estágio do Anúncio (Lifecycle)

> Combinar com \`playbooks/lifecycle.md\` para ações.

## Métricas-alvo por fase

| Fase | Idade | ROAS aceito | ACoS aceito | CTR esperado | CVR esperado |
|---|---|---|---|---|---|
| **Ramp-up** | D0–D30 | ≥ 1.5x | ≤ 40% | ≥ 0.5% | ≥ 1% |
| **Maduro** | D30–D180 | ≥ break-even individual | ≤ 100×margem | ≥ 1% | ≥ 1.5% |
| **Estabilizado** | D180+ | ≥ 1.5× break-even | ≤ 70×margem | ≥ 1.5% | ≥ 2% |
| **Em queda** | Pós-pico, ROAS -30% | Diagnóstico em 48h | — | Comparar com pico | Comparar com pico |
| **Brand defense** | Top orgânico estável | ≥ break-even | — | ≥ 2% | ≥ 3% |

## Sinais por fase

### Ramp-up (D0–D30)
- 0 cliques após R$5 → título/imagem ruim, reformular antes de continuar
- 0 vendas após 50 cliques → CVR ruim, listing problema (preço, descrição, imagem)
- ROAS > 3x já no D7 → escala antecipada possível, mas observar variância

### Maduro (D30–D180)
- Variância semanal ROAS > 50% → keywords mistas, considerar reestruturação funnel
- ACoS estável mas vendas caem → competidor entrou (verificar com Rafael)
- ACoS sobe + vendas estáveis → CPC do nicho aumentou (mercado, não algoritmo)

### Estabilizado (D180+)
- "Caça ao centavo": ajustes finos de lance valem
- Replicação saudável: 2-3 variantes de título testadas trimestralmente
- ROAS começa a cair após 12+ meses → produto saturando, preparar substituto

### Em queda
Roteiro 48h:
1. Estoque OK?
2. Preço subiu nos últimos 14d?
3. Reputação SKU está ok?
4. CPC médio do nicho subiu (Rafael)?
5. Apenas após 1-4 negativos: pausar e reformular

### Brand defense
- Budget micro: R$5-10/dia, lance manual
- Foco: keyword de marca + top 1 keyword do produto
- Sucesso: posição orgânica preservada, não conversão direta

## Tempo para decisões

| Decisão | Janela mínima de observação |
|---|---|
| Pausar por 0 vendas | 30 dias (lifecycle) ou 7 dias com gasto > R$10 + ruptura |
| Pausar por ROAS baixo | 7 dias consecutivos < 70% break-even |
| Escalar | 5 dias consistentes acima de targets |
| Reformular título/imagem | 14 dias com CTR < 0.5% |
| Trocar lance manual ↔ automático | 14 dias após mudança anterior |

## Notas

- Calibração Pé Vermeio: idade do anúncio não vem direto em \`agent_data.json\`. Usar \`status_anuncio\` + data primeira venda como proxy até trainer adicionar tracking explícito.
- Para SKUs em ruptura: lifecycle pausa, decisões só voltam após reposição.
`;

export const ADS_PITFALLS = `# Pitfalls — 5 Mitos e Armadilhas Validadas

> Cada item: mito popular, realidade, fonte, e como evitar na operação Pé Vermeio.

## 1. "Quanto maior o lance, mais venda"

**Realidade:** Lance alto não compra conversão. Algoritmo otimiza CPC × ad-score (relevância + histórico). Acima de um ponto ótimo, ROAS piora porque você compete com você mesmo.

**Como detectar:** ROAS cai quando lance médio sobe (correlação inversa em janela 7d).

**Fonte:** [Arcos Scale](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/), validação Pé Vermeio (custo R$427 = ROAS 9.97 × custo R$254 = ROAS 21).

---

## 2. "Todos os SKUs devem ter ads"

**Realidade:** Apenas SKUs com (a) reputação ≥ 4.6, (b) histórico de vendas orgânicas e (c) margem > break-even merecem ads. SKUs ruins puxam o ad-score da conta inteira para baixo.

**Como detectar:** Lista os SKUs com gasto > R$5 e ROAS < 1x — esses queimam reputação de conta.

**Fonte:** [Conecta Ads](https://www.conectaads.com.br/), [Universidade Marketplaces](https://universidademarketplaces.com.br/blog/acos-campanha-meli/).

---

## 3. "ACoS baixo = sucesso"

**Realidade:** ACoS 10% pode ser fracasso (margem 8% = você perde 2pp). ACoS 35% pode ser excelente (margem 50% = sobra 15pp). Olhar break-even por SKU, não absoluto.

**Como detectar:** SKU com ACoS baixo + MCO negativa = preço baixo, ads não é o problema, repricing é.

**Fonte:** [Ad-Man](https://br.ad-man.io/blog/errorscomunmeli/), [Mamba Digital](https://mambadigital.com.br/blog/o-que-e-acos-no-mercado-livre/).

---

## 4. "Ads canibaliza orgânico, é desperdício"

**Realidade:** Ads alimenta o algoritmo (CTR + conversão sinalizam relevância). Pausar 100% em SKU forte derruba ranking orgânico em 2–4 semanas. Efeito líquido positivo até TACoS ~12%. Acima disso, vira problema.

**Como detectar:** TACoS > 15% por 2 semanas + posição orgânica caindo = receita artificial.

**Fonte:** [Arcos Scale](https://blog.arcosscale.com.br/estrategias-avancadas-mercado-livre-ads-otimizando-roas-lucratividade/), [Nubimetrics](https://academia.nubimetrics.com/br/mercado-ads).

---

## 5. "Pausar antes de 30 dias economiza"

**Realidade:** Algoritmo precisa 30 dias para estabilizar atribuição. Pausa antes destrói histórico. Reativar custa +7 dias de penalty (visibilidade orgânica cai ~30%).

**Como detectar:** padrão de pausar/reativar mesmo SKU em ciclos < 21 dias = você está sabotando o aprendizado.

**Fonte:** [Conecta Ads](https://www.conectaads.com.br/), [Central Vendedores ML](https://vendedores.mercadolivre.com.br/nota/como-funciona-o-administrador-de-campanhas-do-product-ads/).

---

## Bonus: armadilhas específicas Pé Vermeio (2026-04)

### "Tolerar 41 SKUs em ruptura crônica com ads ativos"
3ª semana consecutiva. Cada clique em SKU sem estoque é desperdício direto. Antes de qualquer ajuste de lance, pausar esses SKUs (responsabilidade Estela).

### "Esperar o algoritmo se auto-corrigir quando ROAS abre em 9x"
ROAS < 12x exige intervenção MANUAL no mesmo dia. Algoritmo ML não auto-limita quando margem está negativa.

### "Final de semana bom = saúde do mês"
ROAS 21x no domingo + ROAS 9x no resto da semana = média 13x. Wesley olha para o pico, mas a média manda no fluxo de caixa.
`;

export const ADS_GLOSSARY = `# Glossário ML Ads

## Métricas

**ROAS** (Return on Advertising Spend)
- Fórmula: Receita gerada por ads / Investimento em ads
- Lê-se como multiplicador: ROAS 5x = cada R$1 em ads gera R$5 em vendas
- **Métrica primária pós-Out/2025** (substituiu ACoS no painel oficial ML)

**ACoS** (Advertising Cost of Sales)
- Fórmula: Investimento em ads / Receita gerada por ads × 100
- Inverso do ROAS: ACoS 20% = ROAS 5x
- Tabela: 5%=20x | 7%=14.3x | 10%=10x | 20%=5x | 25%=4x | 33%=3x

**TACoS** (Total Advertising Cost of Sales)
- Fórmula: Investimento em ads / Receita TOTAL (ads + orgânica) × 100
- Termômetro de saúde sistêmica — diferente de ACoS porque inclui receita orgânica
- Saudável: < 7% | Alerta Pé Vermeio: ≥ 4.5%

**Break-even ROAS**
- Fórmula: 1 / margem_líquida
- ROAS mínimo para ads não destruir margem
- Pé Vermeio: 6–9x médio (markup atual)

**CVR** (Conversion Rate)
- Fórmula: Vendas / Cliques × 100
- Saudável ML moda: > 1.5%

**CTR** (Click-Through Rate)
- Fórmula: Cliques / Impressões × 100
- Saudável ML moda: > 0.5%

**CPC** (Custo por Clique)
- Lance pago efetivamente por clique
- Calcular máximo: Preço × MCO_pct × CVR

**MCO** (Margem de Contribuição Operacional)
- Receita - CMV - Comissão - Frete - Impostos - Custo Ads
- "Lucro real" antes de despesas fixas
- Pé Vermeio meta: > 3%

**Ad-score**
- Score interno do ML por anúncio (não exposto)
- Influenciado por: CTR histórico, CVR, conversão pós-clique, reputação SKU
- Pode ser inferido: anúncios com ad-score alto pagam menos por posição

## Posicionamento e algoritmo

**Buy Box**
- "Vendedor principal" exibido na página do produto (catálogo)
- Critérios: preço + reputação + frete + estoque
- NÃO se compra com ads — só com fundamentos

**SOV** (Share of Voice)
- % de impressões do nicho que seu anúncio capturou
- Disponível em \`agent_data.json\` como \`sov\` por item

**Posição** (organic rank)
- Posição do anúncio na SERP da keyword
- Top-3 = sweet spot ROAS/visibilidade
- Top-1 = volume máximo, mas CPC desproporcional

## Tipos de campanha

**Product Ads**
- Anúncios de produto individual nas SERPs e categorias
- Maioria dos sellers usa só este

**Brand Ads**
- Banners premium em homepage/categoria (catálogo grande, marca consolidada)
- Mínimo viável: 300+ SKUs, R$5-10k/mês

**Display Ads**
- Banners gráficos em pages
- Ideal para sazonalidade e remarketing

**Mercado Shops**
- Loja própria integrada ao ML, ads próprios
- Sellers Platinum+ ganham visibilidade extra

## Modos de lance

**Automático**
- ML decide CPC com base em ACOS objetivo
- Bom para descoberta e novatos

**Manual**
- Você define CPC máximo por keyword
- Bom para SKUs maduros e premium

**Híbrido**
- Automático para descobrir + manual para consolidar top performers

## Estágios de funil

**ToFu** (Top of Funnel) — descoberta
- Keywords genéricas ("bota country")
- ROAS aceito: ≥ 2.5x | ACoS: ≤ 40%

**MoFu** (Middle of Funnel) — consideração
- Keywords específicas ("bota texana cano longo couro")
- ROAS aceito: ≥ 3.5x | ACoS: ≤ 28%

**BoFu** (Bottom of Funnel) — conversão/marca
- Keywords de marca ou SKU exato
- ROAS aceito: ≥ 5x | ACoS: ≤ 20%
`;
