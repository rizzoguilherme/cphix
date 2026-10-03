import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseChannels } from "../src/channels";
import { imagePayload, joinButtonPayload, parseWebhook, textPayload, verifySignature } from "../src/waCloudParse";

const hook = (message: object, contacts: object[] = [{ wa_id: "5521999990000", profile: { name: " Ana " } }]) => ({
  entry: [{ changes: [{ value: { contacts, messages: [message] } }] }],
});

describe("parseWebhook", () => {
  it("lê texto em conversa 1:1", () => {
    expect(parseWebhook(hook({ from: "5521999990000", id: "m1", type: "text", text: { body: " /rateio 30 pizza " } }))).toEqual([
      { messageId: "m1", chatId: "5521999990000", userId: "5521999990000", name: "Ana", isGroup: false, text: "/rateio 30 pizza" },
    ]);
  });
  it("usa o group_id como chatId em grupo", () => {
    const [m] = parseWebhook(hook({ from: "5521999990000", id: "m2", type: "text", group_id: "G1", text: { body: "oi" } }));
    expect(m).toMatchObject({ chatId: "G1", userId: "5521999990000", isGroup: true });
  });
  it("botão Participar vira /participar", () => {
    const [m] = parseWebhook(hook({ from: "5521999990000", id: "m3", type: "interactive", interactive: { button_reply: { id: "join" } } }));
    expect(m.text).toBe("/participar");
  });
  it("ignora mídia, botão desconhecido, texto vazio e webhook sem mensagens", () => {
    expect(parseWebhook(hook({ from: "1", id: "a", type: "image" }))).toEqual([]);
    expect(parseWebhook(hook({ from: "1", id: "b", type: "interactive", interactive: { button_reply: { id: "x" } } }))).toEqual([]);
    expect(parseWebhook(hook({ from: "1", id: "c", type: "text", text: { body: "  " } }))).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
  });
  it("usa 'Participante' sem nome de perfil", () => {
    const [m] = parseWebhook(hook({ from: "9", id: "d", type: "text", text: { body: "oi" } }, []));
    expect(m.name).toBe("Participante");
  });
});

describe("verifySignature", () => {
  const body = '{"a":1}';
  const sig = `sha256=${createHmac("sha256", "segredo").update(body).digest("hex")}`;
  it("aceita assinatura válida", () => expect(verifySignature(body, sig, "segredo")).toBe(true));
  it("rejeita segredo errado, corpo alterado, header ausente ou malformado", () => {
    expect(verifySignature(body, sig, "outro")).toBe(false);
    expect(verifySignature('{"a":2}', sig, "segredo")).toBe(false);
    expect(verifySignature(body, undefined, "segredo")).toBe(false);
    expect(verifySignature(body, "sha256=zz", "segredo")).toBe(false);
  });
});

describe("payloads de envio", () => {
  it("texto individual e em grupo", () => {
    expect(textPayload({ chatId: "55", isGroup: false }, "oi")).toMatchObject({ recipient_type: "individual", to: "55", text: { body: "oi" } });
    expect(textPayload({ chatId: "G1", isGroup: true }, "oi")).toMatchObject({ recipient_type: "group", to: "G1" });
  });
  it("corta texto e legenda nos limites da API", () => {
    expect(textPayload({ chatId: "1", isGroup: false }, "x".repeat(5000)).text.body).toHaveLength(4096);
    expect(imagePayload({ chatId: "1", isGroup: false }, "med", "y".repeat(2000)).image.caption).toHaveLength(1024);
  });
  it("botão Participar tem id join", () => {
    const p = joinButtonPayload({ chatId: "1", isGroup: false }, "Rateio criado");
    expect(p.interactive.action.buttons[0].reply).toEqual({ id: "join", title: "Participar" });
  });
});

describe("CHANNEL com whatsapp-cloud", () => {
  it("aceita whatsapp-cloud", () => expect(parseChannels("telegram,whatsapp-cloud")).toEqual(["telegram", "whatsapp-cloud"]));
});