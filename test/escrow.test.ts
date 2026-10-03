import { describe, it, expect } from "vitest";
import { deriveEscrowKeypair } from "../src/escrow";
import { Keypair } from "@solana/web3.js";

describe("escrow (pure functions)", () => {
  it("deriveEscrowKeypair determinism and uniqueness", () => {
    const treasury = Keypair.generate();
    const rateioId = "rateio_123";
    
    // determinística: mesma tesouraria e mesmo id geram a mesma chave pública.
    const escrow1 = deriveEscrowKeypair(treasury, rateioId);
    const escrow2 = deriveEscrowKeypair(treasury, rateioId);
    expect(escrow1.publicKey.toBase58()).toBe(escrow2.publicKey.toBase58());

    // ids de rateio diferentes geram chaves diferentes
    const escrowDifferentId = deriveEscrowKeypair(treasury, "rateio_456");
    expect(escrowDifferentId.publicKey.toBase58()).not.toBe(escrow1.publicKey.toBase58());

    // tesourarias diferentes geram chaves diferentes
    const treasury2 = Keypair.generate();
    const escrowDifferentTreasury = deriveEscrowKeypair(treasury2, rateioId);
    expect(escrowDifferentTreasury.publicKey.toBase58()).not.toBe(escrow1.publicKey.toBase58());

    // a chave derivada NÃO é igual à da tesouraria
    expect(escrow1.publicKey.toBase58()).not.toBe(treasury.publicKey.toBase58());
  });
});
