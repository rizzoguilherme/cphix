import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { DB, JsonStore } from "./store";

// Cada método devolve a assinatura (id) da transação feita na Solana.
export interface Escrow {
  deposit(rateioId: string, cents: number): Promise<string>;
  release(rateioId: string, toUserId: string): Promise<string>;
  refund(rateioId: string, toUserId: string, cents: number): Promise<string>;
}

export class IntermediaryEscrow implements Escrow {
  constructor(
    _conn: Connection, _treasury: Keypair, _mint: PublicKey, _db: JsonStore<DB>, _brlPerToken: number,
  ) {}
  async deposit(_rateioId: string, _cents: number): Promise<string> { throw new Error("não implementado"); }
  async release(_rateioId: string, _toUserId: string): Promise<string> { throw new Error("não implementado"); }
  async refund(_rateioId: string, _toUserId: string, _cents: number): Promise<string> {
    throw new Error("não implementado");
  }
}
