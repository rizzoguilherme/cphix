// Ponto de entrada: monta o serviço e liga os canais escolhidos em CHANNEL.
import { buildService } from "./app";
import { parseChannels } from "./channels";
import { config } from "./config";
import { startTelegram } from "./telegram";

const channels = parseChannels(config.channel);
const svc = buildService();

if (channels.includes("telegram")) {
  if (!config.telegramToken) throw new Error("Falta TELEGRAM_TOKEN no .env (crie o bot no @BotFather).");
  startTelegram(svc, config.telegramToken);
}

if (channels.includes("whatsapp")) {
  // Import dinâmico: no modo só Telegram o Baileys nem é carregado.
  const { startWhatsApp } = await import("./whatsapp");
  await startWhatsApp(svc, config.waAuthDir);
}
