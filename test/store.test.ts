import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore, normalizeDb, activeRateio, saveRateio, type DB } from "../src/store";
import type { Rateio } from "../src/rateio";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cphix-store-"));
  dirs.push(d);
  return d;
};
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const emptyDb = (): DB => ({ rateios: [], wallets: {} });
const rateio = (id: string, chatId: string, status: Rateio["status"] = "open"): Rateio => ({
  id, chatId, description: "x", totalCents: 100, responsibleId: "u1", participants: [], status,
});

describe("JsonStore", () => {
  it("starts with the empty value when the file does not exist", () => {
    const s = new JsonStore(join(tmp(), "db.json"), { n: 1 });
    expect(s.get()).toEqual({ n: 1 });
  });

  it("persists to disk so a new store on the same path reads the same value", () => {
    const path = join(tmp(), "db.json");
    new JsonStore(path, { n: 0 }).set({ n: 42 });
    expect(new JsonStore(path, { n: 0 }).get()).toEqual({ n: 42 });
  });

  it("creates missing folders", () => {
    const path = join(tmp(), "a", "b", "db.json");
    new JsonStore(path, { n: 0 }).set({ n: 1 });
    expect(existsSync(path)).toBe(true);
  });

  it("applies migrate only when loading an existing file", () => {
    const path = join(tmp(), "db.json");
    const migrate = (v: { n: number }) => ({ n: v.n + 100 });
    expect(new JsonStore(path, { n: 0 }, migrate).get()).toEqual({ n: 0 });
    writeFileSync(path, JSON.stringify({ n: 1 }));
    expect(new JsonStore(path, { n: 0 }, migrate).get()).toEqual({ n: 101 });
  });
});

describe("normalizeDb", () => {
  it("converts numeric Telegram ids to strings and keeps wallets", () => {
    const db = normalizeDb({
      rateios: [{ ...rateio("r1", "x"), chatId: -100, responsibleId: 7, participants: [{ userId: 7, name: "A", paid: true }] }],
      wallets: { "7": "secret" },
    });
    expect(db.rateios[0].chatId).toBe("-100");
    expect(db.rateios[0].responsibleId).toBe("7");
    expect(db.rateios[0].participants[0]).toEqual({ userId: "7", name: "A", paid: true });
    expect(db.wallets).toEqual({ "7": "secret" });
  });

  it("accepts raw data without wallets or rateios", () => {
    expect(normalizeDb({})).toEqual(emptyDb());
  });
});

describe("activeRateio and saveRateio", () => {
  it("finds only the open rateio of the chat", () => {
    const db = new JsonStore(join(tmp(), "db.json"), emptyDb());
    saveRateio(db, rateio("old", "c1", "released"));
    saveRateio(db, rateio("other", "c2"));
    expect(activeRateio(db, "c1")).toBeUndefined();
    saveRateio(db, rateio("cur", "c1"));
    expect(activeRateio(db, "c1")?.id).toBe("cur");
  });

  it("replaces by id and appends new ones", () => {
    const db = new JsonStore(join(tmp(), "db.json"), emptyDb());
    saveRateio(db, rateio("r1", "c1"));
    saveRateio(db, rateio("r2", "c2"));
    saveRateio(db, { ...rateio("r1", "c1"), description: "novo" });
    expect(db.get().rateios.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(db.get().rateios[1].description).toBe("novo");
  });
});
