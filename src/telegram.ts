import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { handleMessage, type Incoming, type Reply } from "./commands";
import type { RateioService } from "./service";

// Adaptador do Telegram: só traduz e envia. Toda regra de negócio vem de handleMessage.
export function startTelegram(svc: RateioService, token: string): void {
  const bot = new Bot(token);

  // Ids do Telegram são números; no resto do código todo id é string.
  const toIncoming = (ctx: Context, text: string): Incoming => ({
    chatId: String(ctx.chat!.id),
    userId: String(ctx.from!.id),
    name: ctx.from!.first_name,
    isGroup: ctx.chat!.type !== "private",
    text,
  });

  const send = async (ctx: Context, reply: Reply) => {
    if (reply.image) {
      try {
        await ctx.replyWithPhoto(new InputFile(reply.image, "comprovante.png"), { caption: reply.text });
        return;
      } catch (e) {
        // Se a foto falhar, o texto com o link ainda chega.
        console.error(e);
      }
    }
    await ctx.reply(
      reply.text,
      reply.offerJoin ? { reply_markup: new InlineKeyboard().text("Participar", "join") } : undefined,
    );
  };

  bot.on("message:text", async (ctx) => {
    const reply = await handleMessage(svc, toIncoming(ctx, ctx.message.text));
    if (reply) await send(ctx, reply);
  });

  // O botão Participar equivale a digitar /participar.
  bot.callbackQuery("join", async (ctx) => {
    await ctx.answerCallbackQuery();
    const reply = await handleMessage(svc, toIncoming(ctx, "/participar"));
    if (reply) await ctx.reply(reply.text);
  });

  bot.catch((e) => console.error(e));
  bot.start();
  console.log("CPhix no ar no Telegram");
}
