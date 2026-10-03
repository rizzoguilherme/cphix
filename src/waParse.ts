import type { Incoming } from "./commands";

export type WAMessageLike = {
  key: { remoteJid?: string | null; participant?: string | null; fromMe?: boolean | null };
  pushName?: string | null;
  message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null;
};

export const parseIncoming = (_m: WAMessageLike): Incoming | null => {
  throw new Error("não implementado");
};
