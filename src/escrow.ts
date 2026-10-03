import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createHash } from "node:crypto";
import type { DB, JsonStore } from "./store";
import { centsToTokenUnits } from "./solana";
import { getOrCreateWallet } from "./wallet";

// Escrow = cofre: segura o dinheiro até a regra ser cumprida (todos pagaram). A interface esconde COMO o cofre
// funciona. Hoje é o Plano B (carteira intermediária controlada pelo bot); em ambiente real seria um programa
// Anchor que impõe a regra na rede, sem chave humana.

export interface Escrow {
  deposit(rateioId: string, cents: number): Promise<string>;
  release(rateioId: string, toUserId: string): Promise<string>;
  refund(rateioId: string, toUserId: string, cents: number): Promise<string>;
}

export function deriveEscrowKeypair(treasury: Keypair, rateioId: string): Keypair {
  const seed = createHash("sha256")
    .update(treasury.secretKey)
    .update(rateioId)
    .digest();
  return Keypair.fromSeed(seed);
}

export class IntermediaryEscrow implements Escrow {
  constructor(
    private conn: Connection,
    private treasury: Keypair,
    private mint: PublicKey,
    private db: JsonStore<DB>,
    private brlPerToken: number
  ) {}

  private async ata(owner: PublicKey) {
    return getOrCreateAssociatedTokenAccount(this.conn, this.treasury, this.mint, owner);
  }

  private async send(from: Keypair, toOwner: PublicKey, units: bigint): Promise<string> {
    const src = getAssociatedTokenAddressSync(this.mint, from.publicKey);
    const dst = (await this.ata(toOwner)).address;
    
    const tx = new Transaction().add(
      createTransferInstruction(src, dst, from.publicKey, units)
    );
    tx.feePayer = this.treasury.publicKey; // a tesouraria SEMPRE paga a taxa de rede
    
    // quem tem autoridade sobre a origem assina
    const signers = from.publicKey.equals(this.treasury.publicKey) 
      ? [this.treasury] 
      : [this.treasury, from];
      
    return sendAndConfirmTransaction(this.conn, tx, signers);
  }

  async deposit(rateioId: string, cents: number): Promise<string> {
    const escrow = deriveEscrowKeypair(this.treasury, rateioId);
    await this.ata(escrow.publicKey);
    return this.send(this.treasury, escrow.publicKey, centsToTokenUnits(cents, this.brlPerToken));
  }

  async release(rateioId: string, toUserId: string): Promise<string> {
    const escrow = deriveEscrowKeypair(this.treasury, rateioId);
    const vault = getAssociatedTokenAddressSync(this.mint, escrow.publicKey);
    
    const balance = await this.conn.getTokenAccountBalance(vault);
    const units = BigInt(balance.value.amount);
    
    const toWallet = getOrCreateWallet(this.db, toUserId);
    return this.send(escrow, toWallet.publicKey, units);
  }

  async refund(rateioId: string, toUserId: string, cents: number): Promise<string> {
    // Devolução quando o prazo vence. O bot ainda não chama isto (primeiro corte de escopo).
    const escrow = deriveEscrowKeypair(this.treasury, rateioId);
    const toWallet = getOrCreateWallet(this.db, toUserId);
    return this.send(escrow, toWallet.publicKey, centsToTokenUnits(cents, this.brlPerToken));
  }
}
