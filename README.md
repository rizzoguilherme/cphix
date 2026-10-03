# CPhix

**O Pix move o dinheiro. A Solana faz o dinheiro cumprir regras.**

CPhix é um bot de Telegram e WhatsApp que divide a conta de um grupo e segura o dinheiro num cofre até todos pagarem.

## O problema

Rachar a conta em grupo exige que alguém adiante o valor, cobre os outros por semanas e, no fim, ninguém sabe ao certo quem pagou.

## O que o CPhix faz

1. Alguém cria o rateio no grupo, por exemplo `/rateio 120 churrasco 4 30m`. Quem cria é o responsável.
2. Os amigos entram com `/participar` (no Telegram, também pelo botão Participar). A divisão é igual e exata em centavos.
3. Cada um paga a sua parte com `/simular_pix`. O Pix é simulado, e cada pessoa ganha uma carteira Solana criada pelo bot, sem precisar saber o que é Solana.
4. O dinheiro fica retido num cofre (escrow) na Solana devnet até o último pagamento.
5. Quando todos pagam, o cofre libera o total ao responsável. O bot envia o link do Solana Explorer e um comprovante em imagem, lido da própria rede.

Se o prazo acabar antes de todos pagarem, o responsável escolhe entre `/prorrogar` (mais tempo) e `/cancelar` (o dinheiro volta a quem já pagou).

### Comandos

| Comando | O que faz |
| --- | --- |
| `/rateio <valor> <descrição> [pessoas] [prazo]` | Cria a conta. Ex.: `/rateio 120 churrasco 4 30m`. Prazo: `30m`, `2h` ou `1d` (padrão 60m). Sem o número de pessoas, a divisão é entre quem entrar. |
| `/participar` | Entra no rateio aberto. |
| `/simular_pix` | Paga a sua parte (Pix simulado). |
| `/status` | Mostra quem já pagou, as vagas e o prazo. |
| `/cobrar` | Lista quem ainda falta pagar. |
| `/prorrogar <prazo>` | O responsável dá mais tempo. Ex.: `/prorrogar 30m`. |
| `/cancelar` | O responsável cancela e o dinheiro volta a quem já pagou. |
| `/historico` | Últimos rateios liberados, com o link de cada transação. |
| `/ajuda` | Lista os comandos. |

Só pode haver um rateio aberto por grupo.

## Demonstração

Três pessoas no mesmo grupo; A é o responsável.

| Passo | Quem | Ação |
| --- | --- | --- |
| 1 | A | `/rateio 120 churrasco` |
| 2 | B, C | Entram com Participar ou `/participar` |
| 3 | A, B, C | `/simular_pix`, cada um |
| 4 | bot | Libera o total ao responsável e envia o comprovante |
| 5 | A | Abre o link do Solana Explorer e confere a transação |

## Arquitetura

```
Telegram / WhatsApp
        |
   adaptadores (telegram.ts, whatsapp.ts)   só traduzem mensagens e enviam respostas
        |
   commands.ts   interpreta os comandos
        |
   service.ts    orquestra o fluxo (fila por grupo)
     |      |         |
 rateio.ts  store.ts  Escrow (escrow.ts)   ReceiptMaker (receipt.ts)
 regras     db.json   cofre na Solana      comprovante em PNG
```

| Módulo | Responsabilidade |
| --- | --- |
| `src/rateio.ts` | Regras puras: divisão em centavos, prazo, vagas. Sem rede nem disco. |
| `src/store.ts` | Persistência em `data/db.json`, com nova tentativa quando o Windows segura o arquivo. |
| `src/service.ts` | Fluxo do rateio: criar, entrar, pagar, liberar, prorrogar, cancelar e reembolsar. |
| `src/commands.ts` | Comandos de texto, iguais para qualquer canal. |
| `src/wallet.ts` | Carteira Solana custodial de cada usuário. |
| `src/escrow.ts` | Cofre: depósito, liberação e reembolso, com a tesouraria pagando as taxas. |
| `src/txDetails.ts`, `src/receipt.ts`, `src/brand.ts` | Leitura da transação na rede e comprovante em imagem. |
| `src/telegram.ts`, `src/whatsapp.ts`, `src/waParse.ts`, `src/channels.ts` | Canais. |
| `src/app.ts`, `src/index.ts` | Montagem do serviço e inicialização dos canais escolhidos. |

## Como rodar

Requisitos: Node 22.

```bash
npm install
cp .env.example .env          # no Windows (PowerShell): Copy-Item .env.example .env
npx tsx scripts/setup-devnet.ts   # cria a tesouraria e o token de teste; copie TREASURY_SECRET e MINT_ADDRESS para o .env
```

1. Crie o bot no `@BotFather` (Telegram), desative o modo de privacidade com `/setprivacy` e coloque o token em `TELEGRAM_TOKEN`.
2. Escolha os canais em `CHANNEL`: `telegram`, `whatsapp` ou `telegram,whatsapp`.
3. Para o WhatsApp, use um número descartável. No primeiro uso rode `npx tsx scripts/wa-login.ts`: abre uma página com o QR code para escanear em *Aparelhos conectados*. A sessão fica salva em `WA_AUTH_DIR`.
4. Inicie o bot:

```bash
npm run dev
```

Verificações:

```bash
npm test
npx tsc --noEmit
```

Para ver o comprovante da última liberação sem esperar o bot: `npx tsx scripts/preview-receipt.ts` (salva em `data/receipt-preview.png`).

### Variáveis de ambiente

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `TELEGRAM_TOKEN` | Token do bot, dado pelo `@BotFather`. | |
| `RPC_URL` | Endpoint RPC da Solana. | `https://api.devnet.solana.com` |
| `BRL_PER_TOKEN` | Quantos reais vale 1 token de teste (conversão simulada). | `5` |
| `DATA_DIR` | Pasta do `db.json`. | `./data` |
| `TREASURY_SECRET` | Chave secreta da tesouraria (base58), gerada pelo `setup-devnet`. | |
| `MINT_ADDRESS` | Endereço do token de teste, gerado pelo `setup-devnet`. | |
| `CHANNEL` | Canais ligados: `telegram`, `whatsapp` ou os dois, separados por vírgula. | `telegram` |
| `WA_AUTH_DIR` | Pasta da sessão do WhatsApp. | `./data/wa-auth` |

## O que é simulado e o que é real

- **Simulado:** o Pix e a conversão de reais para token.
- **Real:** o token é de teste na devnet, e as transações de depósito, liberação e reembolso são reais na rede e verificáveis no Solana Explorer.
- **Aviso de segurança:** as carteiras dos usuários são custodiais e ficam em `data/db.json` (fora do git), e a chave da tesouraria fica no `.env`. Não use com dinheiro real nem publique esses arquivos.

## Em ambiente real

- O cofre seria um programa on-chain (Anchor), em vez de uma carteira intermediária: nenhuma chave humana moveria o dinheiro.
- WhatsApp pela API oficial da Meta, no lugar da biblioteca não oficial.
- Carteiras vinculadas pelo próprio usuário, por assinatura.
- Pix por um parceiro regulado.

## Limitações conhecidas

- O WhatsApp usa uma biblioteca não oficial (Baileys) e um número descartável. O bot só entra num grupo se o número estiver salvo nos contatos de quem cria o grupo.
- O prazo é verificado quando alguém usa um comando; o bot não avisa sozinho que o prazo acabou.
- O reembolso devolve tokens à carteira custodial de cada pessoa, não ao Pix.
- Num rateio criado sem número de pessoas, o `/cancelar` depois de um pagamento é recusado, porque a cota muda a cada entrada.
- Um rateio por grupo, e valor máximo de R$ 10.000,00 por rateio.
