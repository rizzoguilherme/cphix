export type Channel = "telegram" | "whatsapp";

const KNOWN: readonly Channel[] = ["telegram", "whatsapp"];

// Valida CHANNEL para que um erro de digitação ("whatsap") não suba o bot sem canal nenhum.
export const parseChannels = (value: string): Channel[] => {
  const items = value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (items.length === 0) {
    throw new Error("CHANNEL vazio. Use telegram, whatsapp ou telegram,whatsapp.");
  }
  const channels: Channel[] = [];
  for (const item of items) {
    if (!(KNOWN as readonly string[]).includes(item)) {
      throw new Error(`Canal desconhecido em CHANNEL: ${item}`);
    }
    if (!channels.includes(item as Channel)) channels.push(item as Channel);
  }
  return channels;
};
