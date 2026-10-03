import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMessage, type Incoming } from "../src/commands";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-lim-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const escrow: Escrow = {
    deposit: async () => "dep",
    release: async () => "rel",
    refund: async () => { throw new Error("não usado"); },
  };
  return new RateioService(db, escrow);
};

const msg = (text: string): Incoming => ({ chatId: "g1", userId: "u1", name: "Ana", isGroup: true, text });

describe("amount limit", () => {
  it("accepts exactly R$ 10.000,00", () => {
    expect(setup().create("g1", "u1", "Ana", "10000 viagem 2").ok).toBe(true);
  });

  it("refuses more than R$ 10.000,00", () => {
    expect(setup().create("g1", "u1", "Ana", "10000,01 viagem 2")).toEqual({
      ok: false, error: "O valor máximo de um rateio é R$ 10.000,00.",
    });
    expect(setup().create("g1", "u1", "Ana", "99999999999 x 2").ok).toBe(false);
  });
});

describe("description limit", () => {
  it("accepts 60 characters, counting accents and emoji as one", () => {
    const sixty = "á".repeat(58) + "🍕🍺";
    expect(setup().create("g1", "u1", "Ana", `50 ${sixty} 2`).ok).toBe(true);
  });

  it("refuses more than 60 characters", () => {
    expect(setup().create("g1", "u1", "Ana", `50 ${"x".repeat(61)} 2`)).toEqual({
      ok: false, error: "A descrição pode ter no máximo 60 caracteres.",
    });
  });
});

describe("commands addressed to another bot", () => {
  it("ignores /rateio@OtherBot when it knows its own name", async () => {
    expect(await handleMessage(setup(), msg("/rateio@OutroBot 50 pizza 2"), { botUsername: "CPhixBot" })).toBeNull();
  });

  it("answers its own name, in any case", async () => {
    const reply = await handleMessage(setup(), msg("/rateio@cphixbot 50 pizza 2"), { botUsername: "CPhixBot" });
    expect(reply?.text).toContain("🧾 pizza: R$ 50,00");
  });

  it("answers commands without a name", async () => {
    const reply = await handleMessage(setup(), msg("/rateio 50 pizza 2"), { botUsername: "CPhixBot" });
    expect(reply?.text).toContain("🧾 pizza: R$ 50,00");
  });

  it("keeps today's behavior when the adapter does not pass the name", async () => {
    const reply = await handleMessage(setup(), msg("/rateio@OutroBot 50 pizza 2"));
    expect(reply?.text).toContain("🧾 pizza: R$ 50,00");
  });
});
