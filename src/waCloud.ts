import { createServer, type IncomingMessage } from "node:http";
import { handleMessage } from "./commands";
import type { RateioService } from "./service";
import { imagePayload, joinButtonPayload, parseWebhook, textPayload, verifySignature, type CloudWebhook } from "./waCloudParse";

export type WaCloudOptions = {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string; // vazio = nÃ£o valida a assinatura (sÃ³ para testes locais)
  port: number;
  apiVersion?: string;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

// WhatsApp Cloud API (oficial da Meta): a Meta chama nosso webhook (precisa de URL pÃºblica HTTPS,
// ex.: ngrok) e nÃ³s respondemos pela Graph API.
export function startWhatsAppCloud(svc: RateioService, opts: WaCloudOptions): void {
  const graph = `https://graph.facebook.com/${opts.apiVersion ?? "v21.0"}/${opts.phoneNumberId}`;
  const auth = { Authorization: `Bearer ${opts.token}` };

  const post = async (path: string, init: RequestInit): Promise<{ id?: string }> => {
    const res = await fetch(`${graph}/${path}`, { method: "POST", ...init });
    if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}: ${await res.text()}`);
    return (await res.json()) as { id?: string };
  };
  const sendJson = (payload: object) =>
    post("messages", { headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  const sendImage = async (target: { chatId: string; isGroup: boolean }, png: Buffer, caption: string) => {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "image/png");
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "comprovante.png");
    const media = await post("media", { headers: auth, body: form });
    if (!media.id) throw new Error("Upload da imagem nÃ£o devolveu id");
    await sendJson(imagePayload(target, media.id, caption));
  };

  const handleWebhook = async (body: CloudWebhook) => {
    for (const incoming of parseWebhook(body)) {
      try {
        const reply = await handleMessage(svc, incoming);
        if (!reply) continue;
        if (reply.image) {
          try {
            await sendImage(incoming, reply.image, reply.text);
            continue;
          } catch (e) {
            console.error(e); // cai para o texto
          }
        }
        await sendJson(reply.offerJoin ? joinButtonPayload(incoming, reply.text) : textPayload(incoming, reply.text));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/webhook") {
      res.writeHead(404).end();
      return;
    }
    // VerificaÃ§Ã£o inicial do webhook no painel da Meta.
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === opts.verifyToken;
      if (ok) res.writeHead(200, { "Content-Type": "text/plain" }).end(url.searchParams.get("hub.challenge") ?? "");
      else res.writeHead(403).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const raw = await readBody(req);
    if (opts.appSecret && !verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, opts.appSecret)) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200).end(); // responde logo: a Meta reenvia se demorarmos
    try {
      void handleWebhook(JSON.parse(raw) as CloudWebhook);
    } catch (e) {
      console.error(e);
    }
  });
  server.listen(opts.port, () => console.log(`CPhix no ar no WhatsApp (API oficial), webhook na porta ${opts.port}`));
}