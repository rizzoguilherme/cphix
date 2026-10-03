import { sharesCents } from "./rateio";
import type { RateioService } from "./service";

// O que um adaptador entrega: quem falou, onde, e o que escreveu.
export type Incoming = { chatId: string; userId: string; name: string; isGroup: boolean; text: string };

// O que o adaptador deve enviar de volta. `offerJoin` pede um botão "Participar" onde houver botões.
// `image` (PNG) é o comprovante da transação: vai como foto, com `text` de legenda.
export type Reply = { text: string; offerJoin?: boolean; image?: Buffer };

// 4000 centavos -> "R$ 40,00".
export const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

// O sufixo @nomedobot existe porque grupos do Telegram escrevem "/rateio@MeuBot 50 pizza".
const COMMAND = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

// Comandos que valem para qualquer canal. Texto que não é comando devolve null: o bot não responde conversa comum.
export async function handleMessage(svc: RateioService, m: Incoming): Promise<Reply | null> {
  const match = COMMAND.exec(m.text.trim());
  if (!match) return null;
  const args = match[2] ?? "";

  switch (match[1].toLowerCase()) {
    case "rateio": {
      if (!m.isGroup) return { text: "Use este comando em um grupo." };
      const res = svc.create(m.chatId, m.userId, m.name, args);
      if (!res.ok) return { text: res.error };
      return {
        text: `🧾 ${res.rateio.description}: ${brl(res.rateio.totalCents)}\nResponsável: ${m.name}\nPara entrar, envie /participar.`,
        offerJoin: true,
      };
    }
    case "participar": {
      const res = svc.join(m.chatId, m.userId, m.name);
      if (!res.ok) return { text: res.error };
      const share = sharesCents(res.rateio).get(m.userId)!;
      const n = res.rateio.participants.length;
      return { text: `${m.name} entrou. Cota atual: ~${brl(share)} (${n} pessoas). Pague com /simular_pix` };
    }
    case "simular_pix": {
      try {
        const res = await svc.simulatePix(m.chatId, m.userId);
        if (!res.ok) return { text: res.error };
        if (res.releaseUrl) {
          return {
            text: `${res.progress}\n🎉 Todos pagaram! Valor liberado ao responsável.\n${res.releaseUrl}`,
            image: res.receiptPng,
          };
        }
        return { text: res.progress, image: res.receiptPng };
      } catch (e) {
        console.error(e);
        return { text: "Erro ao falar com a Solana. Tente de novo em instantes." };
      }
    }
    default:
      return null;
  }
}
