import { describe, it, expect } from "vitest";
import { parseChannels } from "../src/channels";

describe("parseChannels", () => {
  it("aceita telegram", () => expect(parseChannels("telegram")).toEqual(["telegram"]));
  it("aceita whatsapp", () => expect(parseChannels("whatsapp")).toEqual(["whatsapp"]));
  it("aceita os dois", () => expect(parseChannels("telegram,whatsapp")).toEqual(["telegram", "whatsapp"]));
  it("ignora espaços e maiúsculas", () =>
    expect(parseChannels(" Telegram , WhatsApp ")).toEqual(["telegram", "whatsapp"]));
  it("remove duplicados", () => expect(parseChannels("telegram,telegram")).toEqual(["telegram"]));
  it("lança erro para valor vazio", () => {
    const msg = "CHANNEL vazio. Use telegram, whatsapp ou telegram,whatsapp.";
    expect(() => parseChannels("")).toThrow(msg);
    expect(() => parseChannels(",")).toThrow(msg);
  });
  it("lança erro citando o canal desconhecido", () => {
    expect(() => parseChannels("whatsap")).toThrow("Canal desconhecido em CHANNEL: whatsap");
    expect(() => parseChannels("telegram,discord")).toThrow("Canal desconhecido em CHANNEL: discord");
  });
});
