import { describe, it, expect } from "vitest";
import { parseIncoming, type WAMessageLike } from "../src/waParse";

const GRUPO = "120363000000000000@g.us";
const PRIVADO = "5511999999999@s.whatsapp.net";

describe("parseIncoming", () => {
  it("traduz mensagem de grupo", () => {
    const m: WAMessageLike = {
      key: { remoteJid: GRUPO, participant: PRIVADO },
      pushName: "Ana",
      message: { conversation: "/rateio 30 teste" },
    };
    expect(parseIncoming(m)).toEqual({
      chatId: GRUPO, userId: PRIVADO, name: "Ana", isGroup: true, text: "/rateio 30 teste",
    });
  });

  it("traduz conversa privada (userId é o próprio jid)", () => {
    const m: WAMessageLike = { key: { remoteJid: PRIVADO }, pushName: "Bia", message: { conversation: "oi" } };
    expect(parseIncoming(m)).toEqual({
      chatId: PRIVADO, userId: PRIVADO, name: "Bia", isGroup: false, text: "oi",
    });
  });

  it("lê o texto de extendedTextMessage", () => {
    const m: WAMessageLike = {
      key: { remoteJid: PRIVADO },
      pushName: "Bia",
      message: { extendedTextMessage: { text: "/participar" } },
    };
    expect(parseIncoming(m)?.text).toBe("/participar");
  });

  it("ignora mensagem do próprio bot", () => {
    const m: WAMessageLike = { key: { remoteJid: PRIVADO, fromMe: true }, message: { conversation: "oi" } };
    expect(parseIncoming(m)).toBeNull();
  });

  it("ignora status@broadcast", () => {
    const m: WAMessageLike = {
      key: { remoteJid: "status@broadcast", participant: PRIVADO },
      message: { conversation: "oi" },
    };
    expect(parseIncoming(m)).toBeNull();
  });

  it("ignora mensagem sem jid", () => {
    expect(parseIncoming({ key: {}, message: { conversation: "oi" } })).toBeNull();
  });

  it("ignora mensagem sem texto", () => {
    expect(parseIncoming({ key: { remoteJid: PRIVADO }, message: {} })).toBeNull();
    expect(parseIncoming({ key: { remoteJid: PRIVADO }, message: null })).toBeNull();
  });

  it("ignora mensagem de grupo sem participant", () => {
    const m: WAMessageLike = { key: { remoteJid: GRUPO }, message: { conversation: "oi" } };
    expect(parseIncoming(m)).toBeNull();
  });

  it("usa 'Participante' quando pushName é vazio ou só espaços", () => {
    const base = { key: { remoteJid: PRIVADO }, message: { conversation: "oi" } };
    expect(parseIncoming({ ...base, pushName: "" })?.name).toBe("Participante");
    expect(parseIncoming({ ...base, pushName: "   " })?.name).toBe("Participante");
    expect(parseIncoming({ ...base, pushName: null })?.name).toBe("Participante");
  });

  it("apara espaços nas pontas do pushName", () => {
    const m: WAMessageLike = { key: { remoteJid: PRIVADO }, pushName: "  Caio  ", message: { conversation: "oi" } };
    expect(parseIncoming(m)?.name).toBe("Caio");
  });

  it("aceita id @lid como userId", () => {
    const lid = "123456789012345@lid";
    const m: WAMessageLike = {
      key: { remoteJid: GRUPO, participant: lid },
      pushName: "Ana",
      message: { conversation: "oi" },
    };
    expect(parseIncoming(m)?.userId).toBe(lid);
  });
});
