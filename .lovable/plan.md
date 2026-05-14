## Objetivo

Adicionar um botão **Atualizar** no cabeçalho da página `/` (Vendas do Mercado Livre), seguindo o mesmo padrão visual dos botões já existentes em `MLAnuncios` e `MLEstoque`, para que o usuário consiga disparar a sincronização manualmente quando aparecer a mensagem "Nenhum dado no cache".

## Mudanças

**Arquivo:** `src/pages/MercadoLivre.tsx`

1. Importar `RefreshCw` de `lucide-react`.
2. No header sticky (logo após o `TabsList` em ~linha 433), adicionar um `Button` `variant="ghost"` `size="sm"` idêntico ao de `MLAnuncios.tsx` (linhas 291–302):
   - `onClick={() => syncFromAPI()}`
   - `disabled={syncing || !connected}`
   - Ícone `RefreshCw` com `animate-spin` quando `syncing`
   - Label "Atualizar" / "Atualizando..." (oculto em mobile)
3. Atualizar a mensagem do empty-state (linha 444) trocando "Clique em **Sincronizar**" por "Clique em **Atualizar**" para refletir o novo nome do botão.

Sem alterações em lógica de sync, contextos ou backend — apenas UI.
