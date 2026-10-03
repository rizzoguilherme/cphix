# Proposta de contrato: cofre na rede e carteira com passkey

Proposta do Dev 1 para o "Passo 0" da divisão de tarefas. Nada aqui entra na `main` antes da apresentação. Tudo é **opcional e compatível**: o `IntermediaryEscrow` atual, os scripts e o `app.ts` continuam compilando e funcionando sem mudança. Dev 2: o que você quiser diferente, a gente ajusta antes de você programar.

## 1. `Escrow` ganha um `open` opcional

```ts
// Cria o cofre do rateio na rede, com os participantes, as cotas (sharesCents) e o responsável.
// Devolve o endereço do cofre, para qualquer um conferir no Explorer.
open?(rateio: Rateio): Promise<string>;
```

- **Quando é chamado:** no primeiro `/simular_pix` do rateio, dentro da fila do chat, antes do primeiro `deposit`. A partir daí os participantes ficam congelados: quem tentar `/participar` recebe *"Os pagamentos já começaram. Não dá para entrar neste rateio."* (é a regra A que já tinha sido proposta, aqui ela vira obrigatória: um cofre na rede tem a lista fixa).
- **Sem `open` (o `IntermediaryEscrow` de hoje):** nada muda no fluxo.
- **Por que opcional:** o núcleo usa o tipo `Escrow & { open?(...) }` só no `service.ts`. Quando a `AnchorEscrow` existir, a gente move o `open` para a interface em `escrow.ts` (arquivo seu).

`deposit`, `release` e `refund` continuam com as mesmas assinaturas. No modo cofre, `release(rateioId, toUserId)` manda para o endereço cadastrado em `db.addresses[toUserId]` (a `AnchorEscrow` lê isso do `db`, que ela já recebe no construtor).

## 2. `Rateio` ganha o endereço do cofre

```ts
vaultAddress?: string; // preenchido depois do open; o /status mostra o link dele no Explorer
```

## 3. O banco ganha endereços e links de cadastro

```ts
export type DB = {
  rateios: Rateio[];
  wallets: Record<string, string>;            // como hoje (custodial). Sai quando a passkey estiver pronta.
  addresses?: Record<string, string>;         // id do usuário -> endereço PÚBLICO da carteira com passkey
  walletLinks?: Record<string, { userId: string; expiresAt: number }>; // token de cadastro -> dono, validade
};
```

O `wallets` **não** muda de significado agora, para não quebrar o `getOrCreateWallet` e o `IntermediaryEscrow`. Quando a carteira com passkey estiver pronta, você tira o uso dele e a gente apaga as chaves numa migração no `normalizeDb`.

## 4. Fluxo novo no bot

1. O responsável manda `/carteira` **no privado** com o bot (no grupo o bot recusa, porque o link é pessoal). Recebe um link de cadastro que vale 15 minutos e só serve uma vez.
2. A página de cadastro (tarefa 4 do Dev 1, depende do SDK que você escolher) cria a passkey e chama `service.registerWallet(token, endereço)`.
3. Quando todos pagam, se o responsável ainda não tem carteira cadastrada, **o dinheiro fica no cofre** e o bot pede o cadastro. Depois do cadastro, qualquer um manda `/liberar` no grupo.

## Respostas do Dev 2 (2026-10-03): contrato aceito

- [x] **`open(rateio): Promise<string>`** devolvendo o endereço do cofre: aceito. Fica opcional no `service.ts`; quando a `AnchorEscrow` estiver pronta, o Dev 2 move o `open` para a interface em `escrow.ts`.
- [x] **Destino da liberação:** `release(rateioId, toUserId)` da `AnchorEscrow` busca `db.addresses[toUserId]`. `vaultAddress`, `addresses` e `walletLinks` ficam como propostos; `wallets` fica como está até a migração.
- [x] **SDK de passkey:** LazorKit, pacote `@lazorkit/wallet` 3.4.0 (React). Pela [documentação de redes](https://docs.lazorkit.com/networks), o protocolo v2 está ativo na devnet e só ele cria carteiras novas; na mainnet o v2 ainda não foi publicado.

## Página de cadastro (tarefa 4, feita)

`src/walletPage.ts`, servidor `http` do Node, sem dependência nova:

| Rota | O que faz |
| --- | --- |
| `GET /carteira?t=<token>` | A página. Carrega React e `@lazorkit/wallet` 3.4.0 da CDN esm.sh, tira o token da barra de endereço, confere o link e mostra o botão "Cadastrar com biometria" |
| `GET /api/carteira/link?t=<token>` | `{ valid }`: o link ainda vale? Não gasta o link |
| `POST /api/carteira` `{ token, address }` | Chama `registerWallet`. 200 `{ ok: true }` ou 400 com a mensagem do service; corpo limitado a 2 KB |

- A página manda `wallet.vaultPda` e recusa carteira sem ele (v1). Não guarda chave no navegador (`keyStorage: "memory"`).
- Cabeçalhos: `Referrer-Policy: no-referrer` (o token está na URL e não pode vazar para a CDN), `Cache-Control: no-store`, `X-Frame-Options: DENY`.
- Dois ajustes necessários para o SDK rodar sem build, achados testando no navegador: `globalThis.JS_SHA256_NO_NODE_JS = true` (o `js-sha256` achava que estava no Node) e passar `paymasterConfig` explícito ao `LazorkitProvider` (sem ele, o provider entra em laço: erro React #185).
- Testado no navegador em `localhost`: carrega sem erro, o link inválido é recusado e o botão abre o portal do LazorKit. **A criação da carteira com biometria ainda não foi testada de ponta a ponta.**

**Para testar sozinho:** `npx tsx scripts/wallet-page-dev.ts` sobe só a página, com banco separado e um link de teste.

**Para ligar no bot (Dev 3, `src/index.ts`):**

```ts
import { startWalletPage } from "./walletPage";
if (config.walletPageUrl) startWalletPage(svc, config.walletPagePort);
```

**O que falta para o celular abrir o link:** o SDK exige HTTPS (ou `localhost`). O link do `/carteira` vai para o celular, então `WALLET_PAGE_URL` precisa ser um endereço HTTPS público que chegue na porta `WALLET_PAGE_PORT`: um túnel (Cloudflare Tunnel, ngrok) para a demo, ou um servidor de verdade em produção.

**Melhoria futura:** hoje quem tem o link cadastra qualquer endereço. Uma prova de posse (`signMessage` na página e `verifyWalletMessage` no servidor) garantiria que o endereço é da carteira de quem fez a biometria.

## Cuidados com o LazorKit (conferidos nos tipos do `@lazorkit/wallet` 3.4.0)

1. **O endereço a cadastrar é o `wallet.vaultPda`, nunca o `wallet.smartWallet`.** O tipo `WalletInfo` diz: `smartWallet` é a "Wallet PDA (internal authority account — use vaultPda for user-facing address)" e `vaultPda` é o "Vault PDA — the actual SOL-holding account users should fund". Dinheiro mandado ao `smartWallet` fica preso.
2. **O `vaultPda` é opcional no tipo:** carteiras do protocolo v1 não o têm. A página de cadastro recusa uma carteira sem `vaultPda`, em vez de cair no `smartWallet`.
3. **Para a `AnchorEscrow` (Dev 2):** o `vaultPda` é um PDA, fora da curva ed25519. A conta de token do responsável tem que ser calculada com `getAssociatedTokenAddressSync(mint, vaultPda, true)` (o terceiro argumento, `allowOwnerOffCurve`). Sem ele, a biblioteca recusa o endereço na hora da liberação.
