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

## O que preciso de você

- [ ] De acordo com `open(rateio): Promise<string>` devolvendo o endereço do cofre?
- [ ] A `AnchorEscrow` lê o destino da liberação de `db.addresses`?
- [ ] Qual SDK de carteira com passkey você vai usar? A página de cadastro depende disso.
