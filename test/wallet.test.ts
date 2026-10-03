import { describe, it, expect } from "vitest";
import { getOrCreateWallet } from "../src/wallet";
import type { DB, JsonStore } from "../src/store";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

describe("wallet", () => {
  it("getOrCreateWallet behaviour", () => {
    const mem = { v: { rateios: [], wallets: {} } as DB, get() { return this.v; }, set(x: DB) { this.v = x; } };
    const db = mem as unknown as JsonStore<DB>;

    // criar para "u1" devolve um Keypair e grava uma entrada em wallets["u1"].
    const kp1 = getOrCreateWallet(db, "u1");
    expect(kp1).toBeInstanceOf(Keypair);
    expect(mem.v.wallets["u1"]).toBeDefined();

    // chamar de novo para "u1" devolve a MESMA chave pública.
    const kp1Again = getOrCreateWallet(db, "u1");
    expect(kp1Again.publicKey.toBase58()).toBe(kp1.publicKey.toBase58());

    // usuários diferentes ("u1", "u2") têm chaves públicas diferentes.
    const kp2 = getOrCreateWallet(db, "u2");
    expect(kp2.publicKey.toBase58()).not.toBe(kp1.publicKey.toBase58());

    // a chave guardada é base58 e, decodificada, recria a mesma chave pública.
    const savedSecret = mem.v.wallets["u1"];
    const decodedKp = Keypair.fromSecretKey(bs58.decode(savedSecret));
    expect(decodedKp.publicKey.toBase58()).toBe(kp1.publicKey.toBase58());

    // criar uma carteira nova não apaga as existentes e não altera rateios.
    expect(mem.v.wallets["u1"]).toBeDefined();
    expect(mem.v.rateios.length).toBe(0);

    // ids de WhatsApp ("5511999999999@s.whatsapp.net") funcionam como chave do mapa.
    const waKp = getOrCreateWallet(db, "5511999999999@s.whatsapp.net");
    expect(waKp.publicKey).toBeDefined();
    expect(mem.v.wallets["5511999999999@s.whatsapp.net"]).toBeDefined();
  });
});
