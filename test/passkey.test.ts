// Cofre na rede e carteira com passkey (proposta em docs/proposta-passkey.md).
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";
import type { Rateio } from "../src/rateio";
import { explorerUrl } from "../src/solana";

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Cofre de hoje (sem open), como o IntermediaryEscrow.
class FakeEscrow implements Escrow {
  deposits: [string, number][] = [];
  releases: [string, string][] = [];
  failReleases = 0;
  async deposit(rateioId: string, cents: number) {
    this.deposits.push([rateioId, cents]);
    return `dep-${this.deposits.length}`;
  }
  async release(rateioId: string, toUserId: string) {
    if (this.failReleases > 0) { this.failReleases--; throw new Error("rede fora"); }
    this.releases.push([rateioId, toUserId]);
    return `rel-${this.releases.length}`;
  }
  async refund(): Promise<string> { throw new Error("não usado"); }
}

// Cofre "na rede" falso: tem open, como terá a AnchorEscrow.
class FakeVaultEscrow extends FakeEscrow {
  opened: Rateio[] = [];
  failOpen = false;
  openDelayMs = 0; // simula a espera da devnet ao criar o cofre
  async open(r: Rateio) {
    if (this.openDelayMs) await new Promise((res) => setTimeout(res, this.openDelayMs));
    if (this.failOpen) throw new Error("rede fora");
    this.opened.push(r);
    return `vault-${r.id}`;
  }
}

const ADDR = "11111111111111111111111111111111"; // endereço Solana válido (32 bytes em base58)

// Rateio de R$ 120 com Ana (responsável), Bia e Caio.
const setup = (vault: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-vault-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const escrow = vault ? new FakeVaultEscrow() : new FakeEscrow();
  const svc = new RateioService(db, escrow);
  svc.create("g1", "u1", "Ana", "120 churrasco");
  svc.join("g1", "u2", "Bia");
  svc.join("g1", "u3", "Caio");
  return { db, escrow, svc };
};
const setupVault = () => {
  const s = setup(true);
  return { ...s, escrow: s.escrow as FakeVaultEscrow };
};

const register = (svc: RateioService, userId: string, address = ADDR) =>
  svc.registerWallet(svc.createWalletLink(userId).token, address);

const payAll = async (svc: RateioService) => {
  for (const u of ["u1", "u2", "u3"]) await svc.simulatePix("g1", u);
};

describe("vault mode: opening the vault", () => {
  it("opens the vault once, on the first payment, with the participants", async () => {
    const { svc, escrow, db } = setupVault();
    await svc.simulatePix("g1", "u2");
    await svc.simulatePix("g1", "u3");
    expect(escrow.opened).toHaveLength(1);
    expect(escrow.opened[0].participants.map((p) => p.userId)).toEqual(["u1", "u2", "u3"]);
    const r = db.get().rateios[0];
    expect(r.vaultAddress).toBe(`vault-${r.id}`);
    expect(escrow.deposits).toHaveLength(2);
  });

  it("deposits nothing when opening the vault fails", async () => {
    const { svc, escrow, db } = setupVault();
    escrow.failOpen = true;
    await expect(svc.simulatePix("g1", "u2")).rejects.toThrow("rede fora");
    expect(escrow.deposits).toHaveLength(0);
    expect(db.get().rateios[0].vaultAddress).toBeUndefined();
    expect(db.get().rateios[0].participants.every((p) => !p.paid)).toBe(true);
  });

  it("blocks new participants once the vault is open", async () => {
    const { svc } = setupVault();
    expect(svc.join("g1", "u4", "Davi").ok).toBe(true);
    await svc.simulatePix("g1", "u2");
    expect(svc.join("g1", "u5", "Eva")).toEqual({
      ok: false, error: "Os pagamentos já começaram. Não dá para entrar neste rateio.",
    });
  });

  it("blocks new participants while the vault is being created", async () => {
    const { svc, escrow, db } = setupVault();
    escrow.openDelayMs = 20;
    const paying = svc.simulatePix("g1", "u2");
    await new Promise((res) => setTimeout(res, 5));
    expect(svc.join("g1", "u4", "Davi").ok).toBe(false);
    await paying;
    expect(escrow.opened[0].participants).toHaveLength(3);
    expect(db.get().rateios[0].participants).toHaveLength(3);
  });

  it("lets people join again if creating the vault failed", async () => {
    const { svc, escrow } = setupVault();
    escrow.failOpen = true;
    await expect(svc.simulatePix("g1", "u2")).rejects.toThrow("rede fora");
    expect(svc.join("g1", "u4", "Davi").ok).toBe(true);
  });

  it("still answers /participar for someone already in after the vault opens", async () => {
    const { svc } = setupVault();
    await svc.simulatePix("g1", "u2");
    expect(svc.join("g1", "u3", "Caio").ok).toBe(true);
  });

  it("keeps today's behavior without open: no vault, joining after a payment is allowed", async () => {
    const { svc, db } = setup(false);
    await svc.simulatePix("g1", "u2");
    expect(svc.join("g1", "u4", "Davi").ok).toBe(true);
    expect(db.get().rateios[0].vaultAddress).toBeUndefined();
  });
});

describe("vault mode: release waits for the responsible's wallet", () => {
  it("keeps the money in the vault when the responsible has no wallet", async () => {
    const { svc, escrow, db } = setupVault();
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    const res = await svc.simulatePix("g1", "u3");
    expect(res).toMatchObject({ ok: true, awaitingWallet: true, progress: "3 de 3 pagaram ✅" });
    expect(res.ok && res.releaseUrl).toBeUndefined();
    expect(escrow.releases).toEqual([]);
    expect(db.get().rateios[0].status).toBe("open");
  });

  it("releases right away when the responsible already has a wallet", async () => {
    const { svc, escrow } = setupVault();
    expect(register(svc, "u1")).toEqual({ ok: true, userId: "u1" });
    await payAll(svc);
    expect(escrow.releases).toHaveLength(1);
  });

  it("does not require a wallet without open (today's custodial wallets)", async () => {
    const { svc, escrow } = setup(false);
    await payAll(svc);
    expect(escrow.releases).toHaveLength(1);
  });
});

describe("release (/liberar)", () => {
  it("fails without an open rateio", async () => {
    const { svc } = setupVault();
    expect(await svc.release("outro")).toEqual({ ok: false, error: "Nenhum rateio aberto. Use /rateio." });
  });

  it("fails while someone has not paid", async () => {
    const { svc, escrow } = setupVault();
    register(svc, "u1");
    await svc.simulatePix("g1", "u2");
    expect(await svc.release("g1")).toEqual({ ok: false, error: "Ainda falta gente pagar: 1 de 3 pagaram ✅" });
    expect(escrow.releases).toEqual([]);
  });

  it("still waits while the responsible has no wallet", async () => {
    const { svc, escrow } = setupVault();
    await payAll(svc);
    expect(await svc.release("g1")).toMatchObject({ ok: true, awaitingWallet: true });
    expect(escrow.releases).toEqual([]);
  });

  it("releases to the responsible after the wallet is registered", async () => {
    const { svc, escrow, db } = setupVault();
    await payAll(svc);
    register(svc, "u1");
    const res = await svc.release("g1");
    expect(res.ok && res.releaseUrl).toBe(explorerUrl("rel-1"));
    expect(escrow.releases).toEqual([[db.get().rateios[0].id, "u1"]]);
    expect(db.get().rateios[0].status).toBe("released");
  });

  it("retries a release that failed before, in today's mode too", async () => {
    const { svc, escrow } = setup(false);
    escrow.failReleases = 1;
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    await expect(svc.simulatePix("g1", "u3")).rejects.toThrow("rede fora");
    const res = await svc.release("g1");
    expect(res.ok && res.releaseUrl).toBe(explorerUrl("rel-1"));
  });
});

describe("wallet registration links", () => {
  const INVALID_LINK = { ok: false, error: "Link inválido ou expirado. Envie /carteira de novo." };

  it("registers the public address for the link's owner", () => {
    const { svc, db } = setupVault();
    expect(register(svc, "u1")).toEqual({ ok: true, userId: "u1" });
    expect(db.get().addresses).toEqual({ u1: ADDR });
  });

  it("creates long, different tokens", () => {
    const { svc } = setupVault();
    const a = svc.createWalletLink("u1").token;
    const b = svc.createWalletLink("u1").token;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("accepts each link only once", () => {
    const { svc } = setupVault();
    const { token } = svc.createWalletLink("u1");
    svc.registerWallet(token, ADDR);
    expect(svc.registerWallet(token, ADDR)).toEqual(INVALID_LINK);
  });

  it("rejects an unknown token", () => {
    expect(setupVault().svc.registerWallet("nao-existe", ADDR)).toEqual(INVALID_LINK);
  });

  it("expires links after 15 minutes", () => {
    vi.useFakeTimers();
    const { svc } = setupVault();
    const { token } = svc.createWalletLink("u1");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(svc.registerWallet(token, ADDR)).toEqual(INVALID_LINK);
  });

  it("rejects an invalid address and keeps the link usable", () => {
    const { svc } = setupVault();
    const { token } = svc.createWalletLink("u1");
    for (const bad of ["abc", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", ""]) {
      expect(svc.registerWallet(token, bad)).toEqual({ ok: false, error: "Endereço de carteira inválido." });
    }
    expect(svc.registerWallet(token, ADDR).ok).toBe(true);
  });

  it("never stores a secret key, only the public address", () => {
    const { svc, db } = setupVault();
    register(svc, "u1");
    expect(db.get().wallets).toEqual({});
  });
});
