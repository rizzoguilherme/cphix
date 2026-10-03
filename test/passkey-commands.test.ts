// Comandos do cofre na rede e da carteira com passkey (proposta em docs/proposta-passkey.md).
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMessage, type Incoming } from "../src/commands";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";
import type { Rateio } from "../src/rateio";
import { explorerUrl } from "../src/solana";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const ADDR = "11111111111111111111111111111111";
const PAGE = "https://cphix.example/carteira";

const setup = (opts: { vault?: boolean; failRelease?: boolean } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-pkcmd-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const escrow: Escrow & { open?(r: Rateio): Promise<string> } = {
    deposit: async () => "dep",
    release: async () => { if (opts.failRelease) throw new Error("rede fora"); return "rel-1"; },
    refund: async () => { throw new Error("não usado"); },
    ...(opts.vault && { open: async () => "VauLt1111" }),
  };
  return new RateioService(db, escrow);
};

const msg = (text: string, userId = "u1", name = "Ana", isGroup = true): Incoming =>
  ({ chatId: "g1", userId, name, isGroup, text });
const reply = async (svc: RateioService, m: Incoming, walletPageUrl = PAGE) =>
  (await handleMessage(svc, m, { walletPageUrl }))?.text;

// Ana cria, Bia entra, os duas pagam.
const payAll = async (svc: RateioService) => {
  await reply(svc, msg("/rateio 120 churrasco"));
  await reply(svc, msg("/participar", "u2", "Bia"));
  await reply(svc, msg("/simular_pix"));
  return reply(svc, msg("/simular_pix", "u2", "Bia"));
};

// Extrai o token do link que o bot mandou no privado.
const tokenFrom = (text: string) => new URL(text.split("\n").at(-1)!).searchParams.get("t")!;

describe("/carteira", () => {
  it("refuses in a group, because the link is personal", async () => {
    expect(await reply(setup({ vault: true }), msg("/carteira"))).toBe("Por segurança, envie /carteira no privado comigo.");
  });

  it("says it is unavailable when no page is configured", async () => {
    expect(await reply(setup({ vault: true }), msg("/carteira", "u1", "Ana", false), ""))
      .toBe("O cadastro de carteira ainda não está disponível.");
  });

  it("sends a personal link in private that registers the wallet", async () => {
    const svc = setup({ vault: true });
    const text = (await reply(svc, msg("/carteira", "u1", "Ana", false)))!;
    expect(text).toBe(
      "Cadastre sua carteira com a biometria do celular. O link é só seu e vale 15 minutos, não compartilhe:\n" +
      `${PAGE}?t=${tokenFrom(text)}`,
    );
    expect(svc.registerWallet(tokenFrom(text), ADDR)).toEqual({ ok: true, userId: "u1" });
  });
});

describe("vault mode in the group", () => {
  it("keeps the money in the vault and tells the responsible what to do", async () => {
    expect(await payAll(setup({ vault: true }))).toBe(
      "2 de 2 pagaram ✅\n🎉 Todos pagaram! O dinheiro está seguro no cofre.\n" +
      "Ana, para receber, envie /carteira no privado comigo e cadastre sua carteira. Depois, alguém manda /liberar aqui.",
    );
  });

  it("/liberar releases after the wallet is registered", async () => {
    const svc = setup({ vault: true });
    await payAll(svc);
    const text = (await reply(svc, msg("/carteira", "u1", "Ana", false)))!;
    svc.registerWallet(tokenFrom(text), ADDR);
    expect(await reply(svc, msg("/liberar", "u2", "Bia"))).toBe(
      `2 de 2 pagaram ✅\n🎉 Todos pagaram! Valor liberado ao responsável.\n${explorerUrl("rel-1")}`,
    );
  });

  it("/liberar explains who is missing", async () => {
    const svc = setup({ vault: true });
    await reply(svc, msg("/rateio 120 churrasco"));
    await reply(svc, msg("/participar", "u2", "Bia"));
    await reply(svc, msg("/simular_pix"));
    expect(await reply(svc, msg("/liberar"))).toBe("Ainda falta gente pagar: 1 de 2 pagaram ✅");
  });

  it("/liberar gives the friendly network error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = setup({ failRelease: true });
    await payAll(svc);
    expect(await reply(svc, msg("/liberar"))).toBe("Erro ao falar com a Solana. Tente de novo em instantes.");
    err.mockRestore();
  });

  it("/participar is refused once the vault is open", async () => {
    const svc = setup({ vault: true });
    await reply(svc, msg("/rateio 120 churrasco"));
    await reply(svc, msg("/simular_pix"));
    expect(await reply(svc, msg("/participar", "u2", "Bia")))
      .toBe("Os pagamentos já começaram. Não dá para entrar neste rateio.");
  });

  it("/status shows the vault's Explorer link once it exists", async () => {
    const svc = setup({ vault: true });
    await reply(svc, msg("/rateio 120 churrasco"));
    expect(await reply(svc, msg("/status"))).not.toContain("Cofre");
    await reply(svc, msg("/simular_pix"));
    expect(await reply(svc, msg("/status"))).toContain(
      "🔒 Cofre: https://explorer.solana.com/address/VauLt1111?cluster=devnet",
    );
  });

  it("help lists /carteira and /liberar", async () => {
    const text = await reply(setup(), msg("/ajuda"));
    expect(text).toContain("/carteira");
    expect(text).toContain("/liberar");
  });
});
