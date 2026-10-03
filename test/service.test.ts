import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";
import type { ReceiptMaker } from "../src/receipt";
import { explorerUrl } from "../src/solana";

const USAGE = "Uso: /rateio <valor> <descrição>. Exemplo: /rateio 120 churrasco";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

// Cofre falso: guarda as chamadas e devolve assinaturas previsíveis.
class FakeEscrow implements Escrow {
  deposits: [string, number][] = [];
  releases: [string, string][] = [];
  failReleases = 0;
  delayMs = 0; // simula a espera da devnet, para os testes de chamadas simultâneas
  async deposit(rateioId: string, cents: number) {
    this.deposits.push([rateioId, cents]);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return `dep-${this.deposits.length}`;
  }
  async release(rateioId: string, toUserId: string) {
    if (this.failReleases > 0) { this.failReleases--; throw new Error("rede fora"); }
    this.releases.push([rateioId, toUserId]);
    return `rel-${this.releases.length}`;
  }
  async refund(): Promise<string> { throw new Error("não usado"); }
}

const setup = (receipt?: ReceiptMaker) => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-svc-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const escrow = new FakeEscrow();
  return { db, escrow, svc: new RateioService(db, escrow, receipt) };
};

// Rateio de R$ 120 com Ana (responsável), Bia e Caio.
const withThree = (receipt?: ReceiptMaker) => {
  const s = setup(receipt);
  s.svc.create("g1", "u1", "Ana", "120 churrasco");
  s.svc.join("g1", "u2", "Bia");
  s.svc.join("g1", "u3", "Caio");
  return s;
};

describe("create", () => {
  it("rejects an invalid amount or an empty description with the usage message", () => {
    const { svc } = setup();
    expect(svc.create("g1", "u1", "Ana", "abc churrasco")).toEqual({ ok: false, error: USAGE });
    expect(svc.create("g1", "u1", "Ana", "120")).toEqual({ ok: false, error: USAGE });
    expect(svc.create("g1", "u1", "Ana", "")).toEqual({ ok: false, error: USAGE });
  });

  it("makes the creator responsible and rejects a second open rateio in the chat", () => {
    const { svc } = setup();
    const res = svc.create("g1", "u1", "Ana", "120 churrasco de domingo");
    expect(res.ok && res.rateio.responsibleId).toBe("u1");
    expect(res.ok && res.rateio.description).toBe("churrasco de domingo");
    expect(res.ok && res.rateio.totalCents).toBe(12000);
    expect(svc.create("g1", "u2", "Bia", "50 pizza")).toEqual({
      ok: false, error: "Já existe um rateio aberto neste chat.",
    });
  });
});

describe("join", () => {
  it("fails without an open rateio", () => {
    expect(setup().svc.join("g1", "u2", "Bia")).toEqual({ ok: false, error: "Nenhum rateio aberto. Use /rateio." });
  });

  it("does not duplicate a participant", () => {
    const { svc } = setup();
    svc.create("g1", "u1", "Ana", "120 churrasco");
    svc.join("g1", "u2", "Bia");
    const res = svc.join("g1", "u2", "Bia");
    expect(res.ok && res.rateio.participants).toHaveLength(2);
  });
});

describe("simulatePix", () => {
  it("fails without an open rateio or for someone who did not join", async () => {
    const { svc } = setup();
    expect(await svc.simulatePix("g1", "u1")).toEqual({ ok: false, error: "Nenhum rateio aberto. Use /rateio." });
    svc.create("g1", "u1", "Ana", "120 churrasco");
    expect(await svc.simulatePix("g1", "x")).toEqual({
      ok: false, error: "Você não entrou neste rateio. Toque em Participar.",
    });
  });

  it("deposits the right share on a partial payment and does not release", async () => {
    const { svc, escrow } = withThree();
    const res = await svc.simulatePix("g1", "u2");
    expect(res.ok && res.progress).toBe("1 de 3 pagaram ✅");
    expect(res.ok && res.releaseUrl).toBeUndefined();
    expect(escrow.deposits).toEqual([[res.ok && res.rateio.id, 4000]]);
    expect(escrow.releases).toEqual([]);
  });

  it("does not deposit twice when the same person pays again", async () => {
    const { svc, escrow } = withThree();
    await svc.simulatePix("g1", "u2");
    await svc.simulatePix("g1", "u2");
    expect(escrow.deposits).toHaveLength(1);
  });

  it("releases once to the responsible on the last payment", async () => {
    const { svc, escrow, db } = withThree();
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    const res = await svc.simulatePix("g1", "u3");
    if (!res.ok) throw new Error(res.error);
    expect(res.progress).toBe("3 de 3 pagaram ✅");
    expect(escrow.releases).toEqual([[res.rateio.id, "u1"]]);
    expect(res.releaseUrl).toBe(explorerUrl("rel-1"));
    const saved = db.get().rateios.find((r) => r.id === res.rateio.id)!;
    expect(saved.status).toBe("released");
    expect(saved.releaseSig).toBe("rel-1");
  });

  it("keeps the rateio open when release fails and releases on the next call", async () => {
    const { svc, escrow, db } = withThree();
    escrow.failReleases = 1;
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    await expect(svc.simulatePix("g1", "u3")).rejects.toThrow("rede fora");
    expect(db.get().rateios[0].status).toBe("open");
    const res = await svc.simulatePix("g1", "u2");
    expect(res.ok && res.releaseUrl).toBe(explorerUrl("rel-1"));
    expect(escrow.deposits).toHaveLength(3);
  });
});

describe("receipt", () => {
  const payAll = async (svc: RateioService) => {
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    return svc.simulatePix("g1", "u3");
  };

  it("is called after release with the released rateio and the signature", async () => {
    const png = Buffer.from("png");
    const receipt = vi.fn<ReceiptMaker>(async () => png);
    const { svc } = withThree(receipt);
    await svc.simulatePix("g1", "u1");
    expect(receipt).not.toHaveBeenCalled();
    await svc.simulatePix("g1", "u2");
    const res = await svc.simulatePix("g1", "u3");
    expect(receipt).toHaveBeenCalledTimes(1);
    const [rateio, sig] = receipt.mock.calls[0];
    expect(rateio.status).toBe("released");
    expect(rateio.releaseSig).toBe("rel-1");
    expect(sig).toBe("rel-1");
    expect(res.ok && res.receiptPng).toBe(png);
  });

  it("returns no image when the receipt maker returns null", async () => {
    const res = await payAll(withThree(async () => null).svc);
    expect(res.ok).toBe(true);
    expect(res.ok && res.receiptPng).toBeUndefined();
  });

  it("still succeeds without an image when the receipt maker throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await payAll(withThree(async () => { throw new Error("falhou"); }).svc);
    expect(res.ok).toBe(true);
    expect(res.ok && res.releaseUrl).toBe(explorerUrl("rel-1"));
    expect(res.ok && res.receiptPng).toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("concurrent calls in the same chat", () => {
  it("keeps both payments when two people pay at the same time", async () => {
    const { svc, escrow, db } = withThree();
    escrow.delayMs = 20;
    await Promise.all([svc.simulatePix("g1", "u2"), svc.simulatePix("g1", "u3")]);
    expect(escrow.deposits).toHaveLength(2);
    expect(db.get().rateios[0].participants.filter((p) => p.paid).map((p) => p.userId)).toEqual(["u2", "u3"]);
  });

  it("deposits once when the same person double-taps", async () => {
    const { svc, escrow } = withThree();
    escrow.delayMs = 20;
    await Promise.all([svc.simulatePix("g1", "u2"), svc.simulatePix("g1", "u2")]);
    expect(escrow.deposits).toHaveLength(1);
  });

  it("releases once when the last two pay at the same time", async () => {
    const { svc, escrow } = withThree();
    await svc.simulatePix("g1", "u1");
    escrow.delayMs = 20;
    const results = await Promise.all([svc.simulatePix("g1", "u2"), svc.simulatePix("g1", "u3")]);
    expect(escrow.releases).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.releaseUrl)).toHaveLength(1);
  });

  it("does not lose a participant who joins while a deposit is in flight", async () => {
    const { svc, escrow, db } = withThree();
    escrow.delayMs = 20;
    const paying = svc.simulatePix("g1", "u1");
    svc.join("g1", "u4", "Davi");
    await paying;
    expect(db.get().rateios[0].participants.map((p) => p.userId)).toEqual(["u1", "u2", "u3", "u4"]);
  });

  it("keeps serving the chat after a call fails", async () => {
    const { svc, escrow } = withThree();
    escrow.failReleases = 1;
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    await expect(svc.simulatePix("g1", "u3")).rejects.toThrow("rede fora");
    const res = await svc.simulatePix("g1", "u3");
    expect(res.ok && res.releaseUrl).toBe(explorerUrl("rel-1"));
  });
});

describe("status", () => {
  it("fails without an open rateio", () => {
    expect(setup().svc.status("g1")).toEqual({ ok: false, error: "Nenhum rateio aberto. Use /rateio." });
  });

  it("returns the open rateio with who already paid", async () => {
    const { svc } = withThree();
    await svc.simulatePix("g1", "u2");
    const res = svc.status("g1");
    expect(res.ok && res.rateio.participants.map((p) => p.paid)).toEqual([false, true, false]);
  });
});
