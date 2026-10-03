import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { handleMessage } from "./commands";
import type { RateioService } from "./service";
import { parseIncoming, type WAMessageLike } from "./waParse";

// Conecta como um "WhatsApp Web" no número do bot. NÃO é a API oficial: use um número descartável.
// A sessão fica salva em authDir, então o QR code só precisa ser lido na primeira vez.
export async function startWhatsApp(svc: RateioService, authDir: string): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("Escaneie o QR code no WhatsApp (Aparelhos conectados > Conectar um aparelho):");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log("CPhix no ar no WhatsApp");
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log(`Sessão encerrada no celular. Apague a pasta ${authDir} e rode de novo para escanear o QR.`);
        return;
      }
      // Reconectar aqui criaria um ping-pong entre as duas cópias do bot.
      if (code === DisconnectReason.connectionReplaced) {
        console.log("Outra cópia do bot está usando esta sessão do WhatsApp. Feche as outras cópias e rode de novo.");
        return;
      }
      // Mostrar o código e esperar evita um loop de reconexão sem explicação.
      console.log(`Conexão do WhatsApp caiu (código ${code ?? "desconhecido"}). Reconectando em 3 s...`);
      setTimeout(() => { void startWhatsApp(svc, authDir); }, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // só mensagens novas, não o histórico
    for (const m of messages) {
      // Um erro numa mensagem não derruba o bot.
      try {
        const incoming = parseIncoming(m as WAMessageLike);
        if (!incoming) continue;
        const reply = await handleMessage(svc, incoming);
        if (!reply) continue;

        if (reply.image) {
          try {
            await sock.sendMessage(incoming.chatId, { image: reply.image, caption: reply.text }, { quoted: m });
            continue;
          } catch (e) {
            console.error(e); // cai para o texto
          }
        }
        // Esta biblioteca não tem botão Participar: offerJoin é ignorado (o texto já diz "envie /participar").
        await sock.sendMessage(incoming.chatId, { text: reply.text }, { quoted: m });
      } catch (e) {
        console.error(e);
      }
    }
  });
}
