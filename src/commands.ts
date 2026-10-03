import { progress, sharesCents, splitCount } from "./rateio";
import { EXPIRED_MSG, type RateioService } from "./service";
import { explorerUrl } from "./solana";

// O que um adaptador entrega: quem falou, onde, e o que escreveu.
export type Incoming = { chatId: string; userId: string; name: string; isGroup: boolean; text: string };

// O que o adaptador deve enviar de volta. `offerJoin` pede um botão "Participar" onde houver botões.
// `image` (PNG) é o comprovante da transação: vai como foto, com `text` de legenda.
export type Reply = { text: string; offerJoin?: boolean; image?: Buffer };

// 4000 centavos -> "R$ 40,00".
export const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

// "Falta 1 pessoa entrar" / "Faltam 2 pessoas entrarem".
const vagasText = (n: number) => (n === 1 ? "Falta 1 pessoa entrar" : `Faltam ${n} pessoas entrarem`);

// O sufixo @nomedobot existe porque grupos do Telegram escrevem "/rateio@MeuBot 50 pizza".
const COMMAND = /^\/([a-zA-Z_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/;

// O Telegram manda /start sozinho quando alguém abre o bot: sem resposta, parece que o bot está quebrado.
const HELP = [
  "Olá! Eu divido a conta do grupo e seguro o dinheiro até todos pagarem.",
  "",
  "📌 Para todos",
  "",
  "/rateio <valor> <descrição> [pessoas] [prazo]",
  "Cria a conta. Ex.: /rateio 120 churrasco 4 30m",
  "(prazo: 30m, 2h ou 1d; padrão 60m. Sem o número de pessoas, divide entre quem entrar)",
  "",
  "/participar",
  "Entra no rateio aberto.",
  "",
  "/simular_pix",
  "Paga a sua parte (Pix simulado).",
  "",
  "/status",
  "Mostra quem já pagou, as vagas e o prazo.",
  "",
  "/cobrar",
  "Lista quem ainda falta pagar.",
  "",
  "/historico",
  "Rateios já liberados, com o link de cada transação.",
  "",
  "👑 Só para o responsável",
  "",
  "/prorrogar <prazo>",
  "Dá mais tempo para pagar. Ex.: /prorrogar 30m",
  "",
  "/cancelar",
  "Cancela o rateio e devolve o dinheiro a quem já pagou.",
  "",
  "Me adicione a um grupo e use os comandos lá.",
].join("\n");

// Comandos que valem para qualquer canal. Texto que não é comando devolve null: o bot não responde conversa comum.
// `opts.botUsername`: o adaptador do Telegram passa o nome do bot, para ignorar "/rateio@OutroBot" num grupo
// com vários bots. Sem ele (WhatsApp, ou adaptador antigo), qualquer sufixo é aceito, como antes.
export async function handleMessage(
  svc: RateioService, m: Incoming, opts: { botUsername?: string } = {},
): Promise<Reply | null> {
  const match = COMMAND.exec(m.text.trim());
  if (!match) return null;
  const target = match[2];
  if (target && opts.botUsername && target.toLowerCase() !== opts.botUsername.toLowerCase()) return null;
  const args = match[3] ?? "";

  switch (match[1].toLowerCase()) {
    case "rateio": {
      if (!m.isGroup) return { text: "Use este comando em um grupo." };
      const res = svc.create(m.chatId, m.userId, m.name, args);
      if (!res.ok) return { text: res.error };
      const r = res.rateio;
      const share = sharesCents(r).get(m.userId)!;
      const until = `Pague até ${svc.formatDeadline(r.deadline!)}.`;
      return {
        text: [
          `🧾 ${r.description}: ${brl(r.totalCents)}`,
          `Responsável: ${m.name}`,
          // Sem número combinado, a conta é dividida entre quem entrar.
          r.expectedParticipants === undefined ? until : `${splitCount(r)} pessoas, ~${brl(share)} cada. ${until}`,
          "Para entrar, envie /participar.",
        ].join("\n"),
        offerJoin: true,
      };
    }
    case "prorrogar": {
      const res = await svc.extend(m.chatId, m.userId, args);
      if (!res.ok) return { text: res.error };
      return { text: `Prazo prorrogado: pague até ${svc.formatDeadline(res.rateio.deadline!)}.` };
    }
    case "participar": {
      const res = svc.join(m.chatId, m.userId, m.name);
      if (!res.ok) return { text: res.error };
      const share = sharesCents(res.rateio).get(m.userId)!;
      const n = res.rateio.participants.length;
      if (res.rateio.expectedParticipants === undefined) {
        return { text: `${m.name} entrou. Cota atual: ~${brl(share)} (${n} pessoas). Pague com /simular_pix` };
      }
      return { text: `${m.name} entrou (${n} de ${splitCount(res.rateio)}). Sua cota: ~${brl(share)}. Pague com /simular_pix` };
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
      const vagas = splitCount(r) - r.participants.length;
      const footer = r.deadline === undefined ? [] : [
        ...(vagas > 0 ? [`${vagasText(vagas)} (/participar).`] : []),
        svc.isExpired(r) ? `⏰ ${EXPIRED_MSG}` : `Prazo: até ${svc.formatDeadline(r.deadline)}.`,
      ];
      return {
        text: [
          `🧾 ${r.description}: ${brl(r.totalCents)} (responsável: ${responsible})`, ...lines, progress(r), ...footer,
        ].join("\n"),
      };
    }
    case "cobrar": {
      const res = svc.status(m.chatId);
      if (!res.ok) return { text: res.error };
      const r = res.rateio;
      const shares = sharesCents(r);
      const pending = r.participants.filter((p) => !p.paid).map((p) => `${p.name} (${brl(shares.get(p.userId)!)})`);
      const vagas = splitCount(r) - r.participants.length;
      // "Ana, Bia e Caio": vírgulas entre os nomes e "e" antes do último.
      const names = pending.length === 1 ? pending[0] : `${pending.slice(0, -1).join(", ")} e ${pending.at(-1)}`;
      const lines = [
        ...(pending.length > 0 ? [`Faltam pagar: ${names}. Pague com /simular_pix`] : []),
        ...(vagas > 0 ? [`${vagasText(vagas)} (/participar).`] : []),
      ];
      return { text: lines.length > 0 ? lines.join("\n") : "Todos já pagaram." };
    }
    case "cancelar": {
      try {
        const res = await svc.cancel(m.chatId, m.userId);
        if (!res.ok) return { text: res.error };
        return {
          text: res.refunded > 0
            ? `Rateio cancelado. O dinheiro de ${res.refunded} ${res.refunded === 1 ? "pessoa foi devolvido" : "pessoas foi devolvido"}.`
            : "Rateio cancelado.",
        };
      } catch (e) {
        console.error(e);
        return { text: "Erro ao devolver o dinheiro. Tente /cancelar de novo em instantes." };
      }
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
