# Auditoria Mobile-First — Grupo C: Pós-venda, Configurações e Shell
**Fase:** 78 — Revisão Mobile-First  
**Data:** 2026-07-01  
**Viewport de referência:** 360–430 px  
**Método:** Análise de código (sem dev server ativo)  
**Baseline:** Checklist de 10 pontos de 78-CONTEXT.md

---

## Sumário executivo

O shell (LayoutShell + EnvironmentSidebar + Header) já tem uma base razoável: o drawer de menu mobile existe, o botão de hambúrguer abre-o corretamente e os grupos colapsáveis têm lógica defensiva para não fechar ao expandir um grupo. No entanto há lacunas sérias:

- O **OrganizationSwitcher fica completamente inacessível no mobile**: está dentro de `hidden sm:block` no Header e não existe nenhum caminho alternativo no teclado/touch para ele.
- O **MLPeriodPicker renderiza dois meses de calendário** (`numberOfMonths={2}`) dentro de um `<PopoverContent className="w-auto">`, o que estoura horizontalmente qualquer viewport < 680 px.
- Tabelas em **Devoluções** não têm largura mínima garantida com wrapper de scroll, causando risco de overflow silencioso em 360 px.
- A página **Organização** tem uma `<TabsList>` horizontal sem scroll ou wrap que é truncada em viewports estreitos.
- O **card de membro em OrgMembersTab** empilha até 4 botões de ação em linha com o avatar e o nome numa única `div` sem wrap/responsividade, tornando a linha impraticável em mobile.

---

## Findings

---

### [C-01] OrganizationSwitcher invisível no mobile — zero acesso a troca de org

- **Página:** shell (todas as rotas)
- **Arquivo:** `src/components/layout/Header.tsx:58–60`
- **Severidade:** BLOCKER
- **Evidência:**
  ```tsx
  <div className="hidden sm:block shrink-0">
    <OrganizationSwitcher />
  </div>
  ```
  Em viewports < 640 px (todos os celulares) o `OrganizationSwitcher` some completamente. Não existe nenhum outro ponto de acesso à troca de organização — nem no drawer do menu lateral nem no dropdown do avatar (que só lista "Perfil", "Organização", "Sair"). Usuário com múltiplas orgs fica preso na org ativa sem conseguir trocar no celular.
- **Fix sugerido:** Remover `hidden sm:block` e tratar overflow com `max-w-[140px] truncate` (já presente no `<span>` interno do switcher). Alternativamente adicionar o switcher como primeiro item fixo dentro do Sheet do menu mobile em `LayoutShell.tsx:56`.

---

### [C-02] Calendário duplo do MLPeriodPicker estoura viewport em mobile

- **Página:** qualquer página que use `MLPeriodPicker` (Devoluções, Pedidos, Fluxo de Caixa…)
- **Arquivo:** `src/components/mercadolivre/MLPeriodPicker.tsx:89–103`
- **Severidade:** BLOCKER
- **Evidência:**
  ```tsx
  <Calendar
    mode="range"
    numberOfMonths={2}
    ...
  />
  ```
  `numberOfMonths={2}` com `PopoverContent className="w-auto"` produz um calendário com ~640–700 px de largura. Em 360 px ele é cortado pelo overflow do popover, que não tem `overflow-x-auto` — o usuário não consegue selecionar o mês da direita e não existe scroll. O componente inteiro fica parcialmente obscurecido pela borda da tela.
- **Fix sugerido:**
  ```tsx
  <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-3" align="start">
    {/* ... */}
    <Calendar numberOfMonths={isMobile ? 1 : 2} ... />
  ```
  Usar `useIsMobile()` (já importado em LayoutShell) ou breakpoint CSS. O padrão análogo do projeto usa `hidden sm:inline` para ocultar elementos no mobile; aqui: `numberOfMonths={window.innerWidth < 640 ? 1 : 2}` (ou hook).

---

### [C-03] Tabela de Devoluções sem min-width: overflow silencioso

- **Página:** `/devolucoes`
- **Arquivo:** `src/pages/mercadolivre/MLDevolucoes.tsx:205–238`
- **Severidade:** MAJOR
- **Evidência:**
  ```tsx
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th ... >Data</th>        {/* px-6 */}
          <th ... >Produto</th>     {/* max-w-[180px] */}
          <th ... >Tipo</th>
          <th ... >Motivo</th>      {/* campo texto livre */}
          <th ... >Valor</th>
          <th ... >Status</th>     {/* badge com whitespace-nowrap */}
        </tr>
  ```
  Há 6 colunas com paddings `px-6` e `px-3`. A coluna "Motivo" exibe texto livre sem truncar. A tabela usa `w-full` mas sem `min-w-[600px]` ou similar: em 360 px o `overflow-x-auto` no wrapper funciona, mas a coluna "Produto" (`max-w-[180px] truncate`) e a coluna "Motivo" ainda comprimem as outras colunas de forma que a badge "Status" e o valor ficam espremidos/cortados. O header da tabela não tem sticky, então ao rolar horizontalmente perde-se o contexto.
- **Fix sugerido:** Adicionar `min-w-[640px]` à `<table>`. Trocar coluna "Motivo" por `max-w-[120px] truncate` igual a "Produto". Padrão já usado em outras tabelas do projeto (ex.: MLPedidos).

---

### [C-04] OrgSettings TabsList sem scroll/wrap — abas cortadas em mobile

- **Página:** `/organizacao`
- **Arquivo:** `src/pages/org/OrgSettings.tsx:37–43`
- **Severidade:** MAJOR
- **Evidência:**
  ```tsx
  <TabsList className="mb-6">
    <TabsTrigger value="geral">Geral</TabsTrigger>
    <TabsTrigger value="membros">Membros</TabsTrigger>
    <TabsTrigger value="convites">Convites</TabsTrigger>
    <TabsTrigger value="audit">Audit log</TabsTrigger>
  </TabsList>
  ```
  A `<TabsList>` padrão do shadcn/ui não tem `overflow-x-auto` nem wrap: em 360 px as 4 abas em linha não cabem. As abas "Convites" e "Audit log" serão cortadas ou comprimidas a ponto de ficarem ilegíveis. Não há nenhuma classe de responsividade.
- **Fix sugerido:**
  ```tsx
  <TabsList className="mb-6 flex-wrap sm:flex-nowrap w-full">
  ```
  Ou envolver em `<div className="overflow-x-auto -mx-4 px-4">` para dar scroll horizontal controlado. Padrão análogo: MLPerguntas usa `TabsList` simples, mas ela só tem 2 abas (cabe em 360 px).

---

### [C-05] OrgMembersTab — linha de membro empilha 4 botões sem wrap

- **Página:** `/organizacao` → aba Membros
- **Arquivo:** `src/components/org/OrgMembersTab.tsx:186–272`
- **Severidade:** MAJOR
- **Evidência:**
  ```tsx
  <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border ...">
    <Avatar ... />          {/* 36px */}
    <div className="flex-1 min-w-0">  {/* nome */}
    {/* isMemberOwner → span */}
    {/* canManage → <Select w-28> */}
    {/* viewer → <Button "Acesso"> */}
    {/* isOwner → <Button "Transferir"> */}
    {/* canManage → <Button Trash> */}
  </div>
  ```
  Para um membro viewer gerenciado pelo owner, a linha conterá: Avatar + nome + Select(w-28) + Button "Acesso" + Button "Transferir" + Button Trash. São ~360 px só nos botões. Em 360 px a linha não vai caber e o `flex` vai comprimir tudo sem quebrar linha. O `flex-1 min-w-0` no nome ajuda mas os botões de ação não têm `shrink-0` limitado, e o Select tem `w-28` fixo.
- **Fix sugerido:** Separar ações em segunda linha com `flex-wrap` ou mover ações de gerenciamento para um `DropdownMenu` por item (padrão já usado em `/sellers` com os ícones Pencil/Trash no CardHeader). Exemplo mínimo: substituir os botões inline por um único `<DropdownMenu>` com `...` trigger.

---

### [C-06] OrgInvitesTab — formulário de convite em `flex-row` sem wrap em sm: pode comprimir no breakpoint intermediário

- **Página:** `/organizacao` → aba Convites
- **Arquivo:** `src/components/org/OrgInvitesTab.tsx:104–122`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <div className="flex flex-col md:flex-row gap-3 items-end">
    <div className="flex-1 space-y-2 w-full"> {/* email */}
    <div className="space-y-2 w-full md:w-40"> {/* cargo */}
    <Button>Enviar convite</Button>  {/* sem largura responsiva */}
  </div>
  ```
  No breakpoint `sm` (640–767 px) o layout já está em coluna (`flex-col`), mas no breakpoint `md` (768+) o botão de "Enviar convite" não tem `w-full sm:w-auto`: em telas entre 640–768 px o botão fica com largura auto em coluna, que é justo. O problema real é que o botão não tem `w-full` na coluna mobile, podendo ficar menor que o touch target recomendado em alguns themes.
- **Fix sugerido:** Adicionar `className="w-full md:w-auto"` ao `<Button>` de envio.

---

### [C-07] Tooltip de ações em Sellers depende de hover — inacessível no touch

- **Página:** `/sellers`
- **Arquivo:** `src/pages/Sellers.tsx:203–214`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <Tooltip>
    <TooltipTrigger asChild>
      <Button ... onClick={() => toggleSellerActive(seller.id)}>
        <Power ... />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{seller.is_active ? "Desativar" : "Ativar"}</TooltipContent>
  </Tooltip>
  ```
  Os botões de ação do card de seller (Power, Pencil, Trash) têm `h-7 w-7` = 28 px — abaixo do mínimo recomendado de ~40 px para touch targets. A tooltip que explica a ação de ligar/desligar só aparece no hover (padrão Radix/shadcn), não no tap. Em mobile o usuário não sabe o que o botão faz antes de apertar.
- **Fix sugerido:** Aumentar os botões de ação para `h-9 w-9` (36 px) ou `h-10 w-10` (40 px). Opcional: adicionar label visível para o botão Power em mobile (`<span className="sr-only">`) para acessibilidade de screen readers.

---

### [C-08] Botão "Renomear/Resetar loja" em Integrações só tem `title` (hover)

- **Página:** `/integracoes`
- **Arquivo:** `src/pages/Integrations.tsx:980–999`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <Button variant="ghost" size="sm" onClick={...} title="Voltar ao nome padrão">
    <X className="w-4 h-4" />
  </Button>
  <Button variant="ghost" size="sm" onClick={...} title="Renomear loja">
    <Pencil className="w-4 h-4" />
  </Button>
  ```
  Dois botões icon-only cuja função é comunicada apenas via `title` HTML, que não dispara no touch. O usuário mobile não sabe distinguir o X (resetar nome) do Pencil (editar nome) sem clicar.
- **Fix sugerido:** Envolver em `<Tooltip>` do shadcn (igual ao padrão de `/sellers`) ou adicionar label de texto junto ao ícone com `hidden sm:inline`.

---

### [C-09] Avatar de upload em Profile usa `group-hover:opacity-100` — inacessível no touch

- **Página:** `/perfil`
- **Arquivo:** `src/pages/Profile.tsx:93–108`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <div className="relative group">
    <Avatar className="w-24 h-24">...</Avatar>
    <button
      className="absolute inset-0 ... opacity-0 group-hover:opacity-100 ..."
      onClick={() => fileInputRef.current?.click()}
    >
      <Camera ... />
    </button>
  </div>
  <p className="text-xs text-muted-foreground">Clique na foto para alterar</p>
  ```
  O overlay de câmera usa `opacity-0 group-hover:opacity-100` — no mobile (sem hover real) o overlay fica permanentemente invisível. O texto "Clique na foto para alterar" indica ao usuário que é clicável, mas o botão sobreposto é invisível, o que pode causar confusão ou parecer que não funcionou.
- **Fix sugerido:** Adicionar `group-active:opacity-100` ou substituir por `opacity-0 sm:group-hover:opacity-100 active:opacity-100`. Em mobile, exibir o ícone Camera sempre visível (exemplo: badge permanente no canto do avatar), padrão common em apps mobile.

---

### [C-10] Sticky header de páginas de configuração usa offsets negativos hardcoded que conflitam com o header mobile

- **Página:** `/metas`, `/sellers`, `/integracoes`, `/fiscal`, `/organizacao`, `/perfil`
- **Arquivo:** múltiplos, ex. `src/pages/mercadolivre/MLMetas.tsx:165`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20
    -mx-4 md:-mx-6 lg:-mx-8
    -mt-4 md:-mt-6 lg:-mt-8
    px-4 md:px-6 lg:px-8
    pb-4 pt-4 bg-background/95 ...">
  ```
  O header usa `sticky` com `-top-4` (mobile), `-top-6` (md), `-top-8` (lg). Estes valores devem compensar o padding interno do `<main>` (`p-4 md:p-6 lg:p-8` em `LayoutShell.tsx:72`). A matemática está correta — o sticky sobe colando ao topo da janela de conteúdo. Porém em 360 px a altura do Header fixo do app (≈ 52 px) não é descontada: a sticky bar de página aparece **embaixo** do Header do app, o que é correto, mas ao rolar a página, o sticky pode sobrepor o Header nativo do app em alguns browsers mobile que mudam a altura da barra de endereços dinamicamente. Isto é borderline MINOR.
- **Fix sugerido:** Adicionar `scroll-mt-[52px]` ou `top-[52px]` ao sticky header de cada página para garantir que fica abaixo do Header do app. Alternativamente: usar `position: sticky; top: 0` e deixar o scroll natural da viewport mobile resolver — requer testar no browser real.

---

### [C-11] MLFiscal: Dialog de config com grid 3-colunas de inputs em 360 px (LucroReal)

- **Página:** `/fiscal`
- **Arquivo:** `src/pages/mercadolivre/MLFiscal.tsx:349–362`
- **Severidade:** MAJOR
- **Evidência:**
  ```tsx
  <div className="grid grid-cols-3 gap-3">
    <div>Intra-estadual<PercentInput /></div>
    <div>Inter S/SE<PercentInput /></div>
    <div>Inter N/NE/CO/ES<PercentInput /></div>
  </div>
  ```
  O Dialog tem `max-w-md` (~448 px), que em 360 px abre em quase tela cheia. O grid de 3 colunas fixas com 3 inputs numéricos dentro de um Dialog já estreito vai comprimir cada coluna para ≈ 130 px (com gap). Os labels "Inter N/NE/CO/ES" e "Intra-estadual" são longos e vão truncar ou estoura a coluna. A grade acima (`grid grid-cols-2`) está OK.
- **Fix sugerido:** Mudar o grid de ICMS por destino para `grid grid-cols-1 sm:grid-cols-3` (colunas colapsam em mobile). Ou manter 3 colunas mas encurtar os labels para "Intra", "S/SE", "N/NE".

---

### [C-12] Dialog de configuração fiscal sem scroll interno em dispositivos muito curtos

- **Página:** `/fiscal`
- **Arquivo:** `src/pages/mercadolivre/MLFiscal.tsx:562–637`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
    <DialogContent className="max-w-md">
      <Tabs>
        <TabsList className="w-full grid grid-cols-3">
        <TabsContent value="lucro_real">
          {/* UF select + LucroRealForm com ~10 inputs */}
  ```
  O `LucroRealForm` sozinho tem aproximadamente 10 inputs mais o bloco de ICMS por destino. Em um celular com 667 px de altura (iPhone SE) e teclado virtual ativo, o Dialog pode ficar sem scroll interno. O `<DialogContent>` do shadcn tem `max-h-[calc(100dvh-2rem)] overflow-y-auto` por padrão, o que na maioria das versões resolve, mas a aba "Lucro Real" é a única que excede a altura garantida.
- **Fix sugerido:** Adicionar `overflow-y-auto max-h-[70dvh]` ao container de conteúdo interno do Dialog (dentro de `<TabsContent>`) para garantir scroll mesmo quando o `<DialogContent>` nativo não o fizer. Verificar no browser real.

---

### [C-13] Perguntas — textarea de resposta sem ajuste de altura mínima para teclado virtual

- **Página:** `/perguntas`
- **Arquivo:** `src/pages/mercadolivre/MLPerguntas.tsx:321–332`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <Textarea
    rows={3}
    className="text-sm resize-none"
    ...
  />
  ```
  Quando o teclado virtual abre no mobile, a viewport encolhe. A textarea com `rows={3}` e o par de botões "Cancelar / Responder" abaixo dela ficam posicionados logo após o texto da pergunta, dentro de um `<div class="px-6 py-4">`. Em 360 px com teclado virtual, o usuário precisa rolar manualmente para enxergar os botões de ação. Não há `scrollIntoView` automático nem `autofocus` com `scrollIntoViewIfNeeded`.
- **Fix sugerido:** Adicionar `autoFocus` ao `<Textarea>` (já presente no input de renomear loja em Integrações como modelo). Isso aciona `scrollIntoView` automático na maioria dos browsers mobile. Opcional: adicionar `rows={2}` no mobile para economizar altura.

---

### [C-14] Seletor de período em Devoluções: botões de quick range sem flex-wrap

- **Página:** `/devolucoes` e qualquer página com `MLPeriodPicker`
- **Arquivo:** `src/components/mercadolivre/MLPeriodPicker.tsx:73–87`
- **Severidade:** MINOR
- **Evidência:**
  ```tsx
  <div className="flex gap-1 mb-3">
    {QUICK_RANGES.map((opt) => (
      <Button key={opt.value} size="sm" className="h-7 px-3 text-xs">
        {opt.label}
      </Button>
    ))}
  </div>
  ```
  Os botões de quick range ficam num `flex` sem `flex-wrap`. Se `QUICK_RANGES` tiver 4+ itens com labels como "7d / 30d / 90d / Este mês", eles cabem. Mas se o PopoverContent em mobile tiver largura reduzida (após o fix do C-02), os botões podem ficar apertados.
- **Fix sugerido:** Adicionar `flex-wrap` ao container: `<div className="flex flex-wrap gap-1 mb-3">`.

---

## Tabela-resumo

| ID | Título | Severidade | Página |
|----|--------|-----------|--------|
| C-01 | OrganizationSwitcher invisível no mobile | BLOCKER | Shell (todas as rotas) |
| C-02 | Calendário duplo estoura viewport em mobile | BLOCKER | MLPeriodPicker (múltiplas páginas) |
| C-03 | Tabela Devoluções sem min-width: overflow silencioso | MAJOR | /devolucoes |
| C-04 | OrgSettings TabsList sem scroll/wrap em mobile | MAJOR | /organizacao |
| C-05 | OrgMembersTab linha de membro empilha 4 botões sem wrap | MAJOR | /organizacao (Membros) |
| C-06 | OrgInvitesTab botão sem w-full em mobile | MINOR | /organizacao (Convites) |
| C-07 | Botões de ação em Sellers com h-7 w-7 (< 40px touch) | MINOR | /sellers |
| C-08 | Botões icon-only de loja em Integrações sem tooltip/label touch | MINOR | /integracoes |
| C-09 | Upload de avatar usa group-hover — invisível no touch | MINOR | /perfil |
| C-10 | Sticky header de config pode sobrepor header nativo mobile | MINOR | /metas, /sellers, /integracoes, /fiscal, /organizacao, /perfil |
| C-11 | Grid 3-colunas ICMS no Dialog fiscal em 360 px | MAJOR | /fiscal |
| C-12 | Dialog fiscal sem scroll interno garantido (LucroReal) | MINOR | /fiscal |
| C-13 | Textarea de resposta sem autoFocus/scroll para teclado virtual | MINOR | /perguntas |
| C-14 | Quick ranges sem flex-wrap no MLPeriodPicker | MINOR | MLPeriodPicker (múltiplas páginas) |

---

## Contagem por severidade

| Severidade | Quantidade |
|-----------|-----------|
| BLOCKER | 2 |
| MAJOR | 4 |
| MINOR | 8 |
| **Total** | **14** |

---

## Notas adicionais

**O que está bem no Grupo C:**
- O drawer do menu mobile (`LayoutShell.tsx`) tem a lógica correta de fechar somente ao clicar em `<a>` (não em botões de grupo colapsável) — previne o bug clássico de grupos inacessíveis.
- Todas as páginas de configuração têm sticky header com backdrop-blur que funciona no scroll.
- Sellers usa cards responsivos (`sm:grid-cols-2 lg:grid-cols-3`) que colapsam corretamente.
- OrgMembersTab e OrgInvitesTab têm estados de loading e empty bem tratados.
- MLReputacao, MLPerguntas: layouts de card com `space-y-6` fluem bem em mobile; charts com `ResponsiveContainer` estão corretos.
- MLMetas: formulário de KPIs em `grid-cols-1 sm:grid-cols-2` colapsa adequadamente.
- MLFiscal: Dialog de configuração tem `max-w-md` que limita a largura corretamente; o grid 2-colunas de inputs LP está OK.

**Prioridade de correção sugerida:**
1. C-01 (BLOCKER — func. inacessível)
2. C-02 (BLOCKER — filtro de data inutilizável)
3. C-04 (MAJOR — abas cortadas)
4. C-05 (MAJOR — linha de membro transborda)
5. C-11 (MAJOR — grid fiscal estoura dialog)
6. C-03 (MAJOR — tabela devoluções)
7. Demais MINOR em ordem de impacto visual
