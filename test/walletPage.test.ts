// Página de cadastro da carteira com passkey (tarefa 4 de docs/proposta-passkey.md).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createWalletServer } from "../src/walletPage";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";

const ADDR = "11111111111111111111111111111111";

let dir: string;
let server: Server;
let base: string;
let svc: RateioService;
let db: JsonStore<DB>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cphix-page-"));
  db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const escrow: Escrow = {
    deposit: async () => "dep",
    release: async () => "rel",
    refund: async () => { throw new Error("não usado"); },
  };
  svc = new RateioService(db, escrow);
  server = createWalletServer(svc);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((res) => server.close(res));
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown, raw = false) =>
  fetch(`${base}/api/carteira`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("GET /carteira", () => {
  it("serves the page without leaking the token", async () => {
    const res = await fetch(`${base}/carteira?t=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // O token está na URL: sem isso, o navegador o mandaria à CDN no cabeçalho Referer.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("@lazorkit/wallet@3.4.0");
    expect(html).toContain("vaultPda");
    expect(html).not.toContain("abc");
  });
});

describe("GET /api/carteira/link", () => {
  it("says whether a link is still valid, without using it", async () => {
    const { token } = svc.createWalletLink("u1");
    const ok = await fetch(`${base}/api/carteira/link?t=${token}`);
    expect(await ok.json()).toEqual({ valid: true });
    const bad = await fetch(`${base}/api/carteira/link?t=nao-existe`);
    expect(await bad.json()).toEqual({ valid: false });
    expect((await post({ token, address: ADDR })).status).toBe(200);
  });
});

describe("POST /api/carteira", () => {
  it("registers the address for the link's owner", async () => {
    const { token } = svc.createWalletLink("u1");
    const res = await post({ token, address: ADDR });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.get().addresses).toEqual({ u1: ADDR });
  });

  it("returns the service error for an invalid or used link", async () => {
    const res = await post({ token: "nao-existe", address: ADDR });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Link inválido ou expirado. Envie /carteira de novo." });
  });

  it("returns the service error for an invalid address", async () => {
    const { token } = svc.createWalletLink("u1");
    const res = await post({ token, address: "abc" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Endereço de carteira inválido." });
  });

  it("rejects a body that is not the expected JSON", async () => {
    expect((await post("{nao é json", true)).status).toBe(400);
    expect((await post({ token: 1, address: ADDR })).status).toBe(400);
    expect((await post(["x"])).status).toBe(400);
  });

  it("rejects a body larger than 2 KB", async () => {
    const res = await post({ token: "x".repeat(3000), address: ADDR });
    expect(res.status).toBe(413);
  });
});

describe("other routes", () => {
  it("answers 404 for unknown paths and 405 for wrong methods", async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/api/carteira`)).status).toBe(405);
    expect((await fetch(`${base}/carteira`, { method: "POST" })).status).toBe(405);
  });
});

describe("RateioService.checkWalletLink", () => {
  it("is true only for a live, unused link", () => {
    const { token } = svc.createWalletLink("u1");
    expect(svc.checkWalletLink(token)).toBe(true);
    svc.registerWallet(token, ADDR);
    expect(svc.checkWalletLink(token)).toBe(false);
    expect(svc.checkWalletLink("nao-existe")).toBe(false);
  });
});
