// Ponto de entrada: monta o serviço e liga os canais escolhidos em CHANNEL.
import { buildService } from "./app";
import { parseChannels } from "./channels";
import { config } from "./config";
import { startTelegram } from "./telegram";
import { startWhatsAppCloud } from "./waCloud";

const channels = parseChannels(config.channel);
const svc = buildService();

if (channels.includes("telegram")) {
  if (!config.telegramToken) throw new Error("Falta TELEGRAM_TOKEN no .env (crie o bot no @BotFather).");
  startTelegram(svc, config.telegramToken);
}

if (channels.includes("whatsapp-cloud")) {
  const missing = [
    ["WA_CLOUD_TOKEN", config.waCloudToken],
    ["WA_CLOUD_PHONE_ID", config.waCloudPhoneId],
    ["WA_CLOUD_VERIFY_TOKEN", config.waCloudVerifyToken],
  ].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) throw new Error(`Faltam ${missing.join(", ")} no .env (veja docs/whatsapp-oficial.md).`);
  startWhatsAppCloud(svc, {
    token: config.waCloudToken,
    phoneNumberId: config.waCloudPhoneId,
    verifyToken: config.waCloudVerifyToken,
    appSecret: config.waCloudAppSecret,
    port: config.waCloudPort,
  });
}

if (channels.includes("whatsapp")) {
  // Import dinâmico: no modo só Telegram o Baileys nem é carregado.
  const { startWhatsApp } = await import("./whatsapp");
  await startWhatsApp(svc, config.waAuthDir);
}
