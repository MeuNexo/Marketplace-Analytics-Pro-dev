# Registrar o webhook no painel do Mercado Livre

Para as notificações em tempo real (perguntas, reclamações, pedidos) começarem a
chegar, a URL de callback precisa ser registrada **uma vez** no painel da aplicação ML.

## URL de callback

```
https://ckcdevcxgvueywivefgx.supabase.co/functions/v1/ml-webhook/<SECRET>
```

> O `<SECRET>` é entregue separadamente (não fica versionado no git). Está guardado no
> vault do Supabase como `ml_webhook_secret` e é lido pela EF via RPC `get_ml_webhook_secret`.
> Se precisar rotacionar: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='ml_webhook_secret'), '<novo>');`
> e re-registrar a URL nova no ML (o cache do secret na EF zera no próximo cold start).

## Passos (developers.mercadolivre.com.br)

1. Acesse **Suas aplicações** e selecione a aplicação da Pé Vermeio.
2. Vá em **Notificações / Webhooks** (ou "Configurar notificações").
3. No campo **URL de retorno de chamada (callback)**, cole a URL acima (com o secret).
4. Marque os tópicos:
   - **questions** (perguntas)
   - **claims** (reclamações / mediações)
   - **orders_v2** (pedidos)
5. Salve. O ML envia uma notificação de teste — a EF responde `200`.

## Como conferir que está entrando

- Em **/monitoramento** (acesso owner), veja o painel **"Webhook ML — últimos eventos"**:
  cada notificação aparece com tópico, status (Recebido → Processado) e horário.
- Nas telas **/perguntas** e **/devolucoes**, o badge **"Tempo real ativo · há X"** no
  cabeçalho mostra o tempo desde o último evento.
- Teste real: faça uma pergunta de teste num anúncio (ou peça para alguém fazer) — ela
  deve aparecer como `Processado` em segundos.

## Rede de segurança (polling)

O polling **não foi removido** — continua rodando com frequência reduzida como
reconciliação, caso alguma notificação se perca:
- perguntas: de hora em hora (era 15 min)
- reclamações: a cada 2 h (era 30 min)
- retry de eventos presos: a cada 10 min (`reprocess-webhook-events`)

Se o webhook falhar em produção, é reversível: basta reagendar os crons antigos
(15 min / 30 min) — 1 linha cada.
