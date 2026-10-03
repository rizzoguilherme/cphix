import type { Incoming } from "./commands";

export type WAMessageLike = {
  key: { remoteJid?: string | null; participant?: string | null; fromMe?: boolean | null };
  pushName?: string | null;
  message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null;
};

// Função pura (sem importar o Baileys) para poder testar sem conexão.
export const parseIncoming = (m: WAMessageLike): Incoming | null => {
  const jid = m.key.remoteJid;
  // fromMe: o bot não responde a si mesmo; status@broadcast são os stories.
  if (!jid || m.key.fromMe || jid === "status@broadcast") return null;

  const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
  if (!text) return null;

  const isGroup = jid.endsWith("@g.us");
  // Em grupo, o autor é o participant (número ou "@lid", desde que estável por pessoa).
  const userId = isGroup ? m.key.participant : jid;
  if (!userId) return null;

  return { chatId: jid, userId, name: m.pushName?.trim() || "Participante", isGroup, text };
};
