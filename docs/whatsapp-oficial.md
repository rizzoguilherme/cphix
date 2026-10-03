# WhatsApp pela API oficial (Cloud API da Meta)

Canal `whatsapp-cloud`. Alternativa ao canal `whatsapp` (Baileys, não oficial).

## Limitação importante: grupos
O CPhix divide a conta **de um grupo**. A Cloud API só entrega mensagens de grupo pela **Groups API**, que a Meta libera apenas para contas comerciais elegíveis (verificadas, com limite de mensagens alto). Sem isso, o bot só conversa 1:1: o criador consegue abrir um rateio, mas os outros participantes não entram no mesmo chat. O código já trata `group_id` e `recipient_type: "group"`; quando a conta tiver a Groups API, nada muda.
Para a demo em grupo, continue com `CHANNEL=whatsapp` (Baileys).

## Passo a passo
1. https://developers.facebook.com/apps: criar app tipo **Business** e adicionar o produto **WhatsApp**.
2. Em *WhatsApp > API Setup*: copiar o **Phone number ID** e gerar um **token** (o temporário dura 24 h; para mais tempo, crie um *System User* com token permanente). Cadastrar os números de teste que podem receber mensagens.
3. Expor a porta do bot com URL pública HTTPS: `ngrok http 3000`.
4. Em *WhatsApp > Configuration*: Callback URL `https://<seu-ngrok>/webhook`, Verify token igual ao do `.env`, e assinar o campo **messages**.
5. Preencher o `.env`:
   ```
   CHANNEL=whatsapp-cloud
   WA_CLOUD_TOKEN=...
   WA_CLOUD_PHONE_ID=...
   WA_CLOUD_VERIFY_TOKEN=uma-frase-qualquer
   WA_CLOUD_APP_SECRET=...   # App settings > Basic > App secret (valida a assinatura do webhook)
   WA_CLOUD_PORT=3000
   ```
6. `npm run dev`. Mande uma mensagem ao número de teste.

## Regras da Meta que afetam o bot
- Só dá para responder livremente até 24 h depois da última mensagem do usuário (depois disso, só template aprovado).
- O botão **Participar** é um *reply button*; o clique volta como `/participar`.
- Comprovante: a imagem é enviada via `/media` e depois como mensagem de imagem com legenda.