import type { RateioService } from "./service";

// O que um adaptador entrega: quem falou, onde, e o que escreveu.
export type Incoming = { chatId: string; userId: string; name: string; isGroup: boolean; text: string };

// O que o adaptador deve enviar de volta. `offerJoin` pede um botão "Participar" onde houver botões.
// `image` (PNG) é o comprovante da transação: vai como foto, com `text` de legenda.
export type Reply = { text: string; offerJoin?: boolean; image?: Buffer };

// 4000 centavos -> "R$ 40,00".
export const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

export async function handleMessage(_svc: RateioService, _m: Incoming): Promise<Reply | null> {
  return null;
}
