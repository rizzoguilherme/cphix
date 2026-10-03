import { progress, sharesCents } from "./rateio";
import type { RateioService } from "./service";
import { explorerUrl } from "./solana";

// O que um adaptador entrega: quem falou, onde, e o que escreveu.
export type Incoming = { chatId: string; userId: string; name: string; isGroup: boolean; text: string };

// O que o adaptador deve enviar de volta. `offerJoin` pede um botão "Participar" onde houver botões.
// `image` (PNG) é o comprovante da transação: vai como foto, com `text` de legenda.
export type Reply = { text: string; offerJoin?: boolean; image?: Buffer };

// 4000 centavos -> "R$ 40,00".
export const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

// O sufixo @nomedobot existe porque grupos do Telegram escrevem "/rateio@MeuBot 50 pizza".
const COMMAND = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

// O Telegram manda /start sozinho quando alguém abre o bot: sem resposta, parece que o bot está quebrado.
const HELP = [
  "Olá! Eu divido a conta do grupo e seguro o dinheiro até todos pagarem.",
  "",
  "/rateio <valor> <descrição>: cria a conta. Exemplo: /rateio 120 churrasco",
  "/participar: entra no rateio",
  "/simular_pix: paga a sua parte (Pix simulado)",
  "/status: mostra quem já pagou",
  "/historico: rateios já liberados, com o link de cada transação",
  "",
  "Me adicione a um grupo e use os comandos lá.",
].join("\n");

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
    case "start":
    case "ajuda":
    case "help":
      return { text: HELP };
    case "status": {
      const res = svc.status(m.chatId);
      if (!res.ok) return { text: res.error };
      const r = res.rateio;
      const shares = sharesCents(r);
      const responsible = r.participants.find((p) => p.userId === r.responsibleId)?.name ?? "Responsável";
      const lines = r.participants.map((p) => `${p.paid ? "✅" : "⏳"} ${p.name}: ${brl(shares.get(p.userId)!)}`);
      return {
        text: [`🧾 ${r.description}: ${brl(r.totalCents)} (responsável: ${responsible})`, ...lines, progress(r)].join("\n"),
      };
    }
    case "historico": {
      // Cada liberação traz o link do Explorer: qualquer pessoa do grupo confere a transação na rede.
      const released = svc.history(m.chatId);
      if (released.length === 0) return { text: "Nenhum rateio liberado neste grupo ainda." };
      const items = released.map((r) => {
        const responsible = r.participants.find((p) => p.userId === r.responsibleId)?.name ?? "Responsável";
        return `🧾 ${r.description}: ${brl(r.totalCents)} para ${responsible}\n${explorerUrl(r.releaseSig!)}`;
      });
      return { text: ["📜 Rateios liberados neste grupo:", ...items].join("\n\n") };
    }
    default:
      return null;
  }
}
