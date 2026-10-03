import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMessage, type Incoming } from "../src/commands";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

// Cofre falso; depositDelayMs simula a espera da devnet.
const setup = (depositDelayMs = 0) => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-cc-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const deposits: number[] = [];
  const refunds: [string, number][] = [];
  const escrow: Escrow = {
    deposit: async (_id, cents) => {
      deposits.push(cents);
      if (depositDelayMs) await new Promise((r) => setTimeout(r, depositDelayMs));
      return "dep";
    },
    release: async () => "rel-1",
    refund: async (_id, userId, cents) => { refunds.push([userId, cents]); return "ref"; },
  };
  return { db, deposits, refunds, svc: new RateioService(db, escrow) };
};

const msg = (text: string, userId = "u1", name = "Ana"): Incoming => ({ chatId: "g1", userId, name, isGroup: true, text });
const say = async (svc: RateioService, text: string, userId = "u1", name = "Ana") =>
  (await handleMessage(svc, msg(text, userId, name)))?.text;

// R$ 100 em 3: Ana 33,34, Bia 33,33, Caio 33,33.
const withThree = async (svc: RateioService) => {
  await say(svc, "/rateio 100 pizza 3");
  await say(svc, "/participar", "u2", "Bia");
  await say(svc, "/participar", "u3", "Caio");
};

describe("/cobrar", () => {
  it("returns the no-rateio error", async () => {
    expect(await say(setup().svc, "/cobrar")).toBe("Nenhum rateio aberto. Use /rateio.");
  });

  it("lists who still has to pay, with each share", async () => {
    const { svc } = setup();
    await withThree(svc);
    await say(svc, "/simular_pix", "u2", "Bia");
    expect(await say(svc, "/cobrar")).toBe("Faltam pagar: Ana (R$ 33,34) e Caio (R$ 33,33). Pague com /simular_pix");
  });

  it("uses commas for three or more people", async () => {
    const { svc } = setup();
    await withThree(svc);
    expect(await say(svc, "/cobrar")).toBe(
      "Faltam pagar: Ana (R$ 33,34), Bia (R$ 33,33) e Caio (R$ 33,33). Pague com /simular_pix",
    );
  });

  it("works for a single person", async () => {
    const { svc } = setup();
    await say(svc, "/rateio 50 pizza 2");
    expect(await say(svc, "/cobrar")).toBe(
      "Faltam pagar: Ana (R$ 25,00). Pague com /simular_pix\nFalta 1 pessoa entrar (/participar).",
    );
  });

  it("says when everyone already paid", async () => {
    const { svc, db } = setup();
    await say(svc, "/rateio 50 pizza 2");
    await say(svc, "/participar", "u2", "Bia");
    // Todos pagos mas ainda aberto: acontece quando a liberação falhou e espera nova tentativa.
    const r = db.get().rateios[0];
    db.set({ ...db.get(), rateios: [{ ...r, participants: r.participants.map((p) => ({ ...p, paid: true })) }] });
    expect(await say(svc, "/cobrar")).toBe("Todos já pagaram.");
  });
});

describe("/cancelar", () => {
  it("returns the no-rateio error", async () => {
    expect(await say(setup().svc, "/cancelar")).toBe("Nenhum rateio aberto. Use /rateio.");
  });

  it("only the responsible can cancel", async () => {
    const { svc } = setup();
    await withThree(svc);
    expect(await say(svc, "/cancelar", "u2", "Bia")).toBe("Só o responsável pode cancelar o rateio.");
  });

  it("cancels when nobody paid, freeing the chat for a new rateio", async () => {
    const { svc, db } = setup();
    await withThree(svc);
    expect(await say(svc, "/cancelar")).toBe("Rateio cancelado.");
    expect(db.get().rateios).toEqual([]);
    expect(await say(svc, "/rateio 30 cafe 2")).toContain("🧾 cafe: R$ 30,00");
  });

  it("refunds who already paid and frees the chat", async () => {
    const { svc, db, refunds } = setup();
    await withThree(svc);
    await say(svc, "/simular_pix", "u2", "Bia");
    expect(await say(svc, "/cancelar")).toBe("Rateio cancelado. O dinheiro de 1 pessoa foi devolvido.");
    expect(refunds).toEqual([["u2", 3333]]);
    expect(db.get().rateios).toEqual([]);
  });

  it("refunds everyone who paid, with the right share", async () => {
    const { svc, refunds } = setup();
    await withThree(svc);
    await say(svc, "/simular_pix", "u1");
    await say(svc, "/simular_pix", "u3", "Caio");
    expect(await say(svc, "/cancelar")).toBe("Rateio cancelado. O dinheiro de 2 pessoas foi devolvido.");
    expect(refunds).toEqual([["u1", 3334], ["u3", 3333]]);
  });

  it("keeps the rateio when a refund fails and resumes without paying twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cphix-cc-"));
    dirs.push(dir);
    const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
    const refunds: string[] = [];
    let fail = true;
    const escrow: Escrow = {
      deposit: async () => "dep",
      release: async () => "rel-1",
      refund: async (_id, userId) => {
        if (userId === "u2" && fail) throw new Error("rede fora");
        refunds.push(userId);
        return "ref";
      },
    };
    const svc = new RateioService(db, escrow);
    await withThree(svc);
    await say(svc, "/simular_pix", "u1");
    await say(svc, "/simular_pix", "u2", "Bia");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await say(svc, "/cancelar")).toBe("Erro ao devolver o dinheiro. Tente /cancelar de novo em instantes.");
    err.mockRestore();
    expect(db.get().rateios).toHaveLength(1);
    fail = false;
    expect(await say(svc, "/cancelar")).toBe("Rateio cancelado. O dinheiro de 1 pessoa foi devolvido.");
    expect(refunds).toEqual(["u1", "u2"]); // u1 não é devolvido de novo
  });

  it("waits for a payment in flight and then refunds it, instead of losing the deposit", async () => {
    const { svc, db, deposits, refunds } = setup(20);
    await withThree(svc);
    const paying = svc.simulatePix("g1", "u2");
    const cancel = svc.cancel("g1", "u1");
    await paying;
    const res = await cancel;
    expect(res.ok && res.refunded).toBe(1);
    expect(deposits).toHaveLength(1);
    expect(refunds).toEqual([["u2", 3333]]);
    expect(db.get().rateios).toEqual([]);
  });

  it("keeps released rateios in the history", async () => {
    const { svc, db } = setup();
    await say(svc, "/rateio 50 pizza 2");
    await say(svc, "/participar", "u2", "Bia");
    await say(svc, "/simular_pix");
    await say(svc, "/simular_pix", "u2", "Bia");
    await say(svc, "/rateio 30 cafe 2");
    await say(svc, "/cancelar");
    expect(db.get().rateios.map((r) => r.description)).toEqual(["pizza"]);
  });
});

describe("help", () => {
  it("lists /cobrar and /cancelar", async () => {
    const text = await say(setup().svc, "/ajuda");
    expect(text).toContain("/cobrar");
    expect(text).toContain("/cancelar");
    expect(text).toContain("/prorrogar");
  });
});
