import { createHmac, timingSafeEqual } from "node:crypto";
import type { Incoming } from "./commands";

// Formato dos webhooks da WhatsApp Cloud API (só os campos que usamos).
type CloudMessage = {
  from?: string;
  id?: string;
  type?: string;
  group_id?: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id?: string } };
};
type CloudContact = { wa_id?: string; profile?: { name?: string } };
export type CloudWebhook = {
  entry?: { changes?: { value?: { contacts?: CloudContact[]; messages?: CloudMessage[] } }[] }[];
};

// Transforma o corpo do webhook em mensagens do CPhix. Ignora status de entrega, mídia e o resto.
// Em conversa 1:1 o chatId é o número de quem escreveu; em grupo (Groups API) é o group_id.
export const parseWebhook = (body: CloudWebhook): (Incoming & { messageId: string })[] => {
  const out: (Incoming & { messageId: string })[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const m of value?.messages ?? []) {
        if (!m.from || !m.id) continue;
        let text = "";
        if (m.type === "text") text = m.text?.body?.trim() ?? "";
        // Toque no botão "Participar" equivale a digitar /participar.
        else if (m.type === "interactive" && m.interactive?.button_reply?.id === "join") text = "/participar";
        if (!text) continue;
        const name = value?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.trim() || "Participante";
        out.push({
          messageId: m.id,
          chatId: m.group_id ?? m.from,
          userId: m.from,
          name,
          isGroup: Boolean(m.group_id),
          text,
        });
      }
    }
  }
  return out;
};

// A Meta assina o corpo cru com o App Secret: "sha256=<hex>" no header X-Hub-Signature-256.
export const verifySignature = (rawBody: string, header: string | undefined, appSecret: string): boolean => {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
};

// Limites da Cloud API: texto 4096 caracteres, legenda de imagem 1024.
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

type Target = { chatId: string; isGroup: boolean };
const base = ({ chatId, isGroup }: Target) => ({
  messaging_product: "whatsapp",
  recipient_type: isGroup ? "group" : "individual",
  to: chatId,
});

export const textPayload = (t: Target, text: string) => ({ ...base(t), type: "text", text: { body: cut(text, 4096) } });

export const imagePayload = (t: Target, mediaId: string, caption: string) => ({
  ...base(t), type: "image", image: { id: mediaId, caption: cut(caption, 1024) },
});

// Botão de resposta rápida "Participar" (o id "join" volta no webhook).
export const joinButtonPayload = (t: Target, text: string) => ({
  ...base(t),
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: cut(text, 1024) },
    action: { buttons: [{ type: "reply", reply: { id: "join", title: "Participar" } }] },
  },
});