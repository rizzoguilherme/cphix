import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "./config";
import { IntermediaryEscrow } from "./escrow";
import { makeReceiptMaker } from "./receipt";
import { RateioService } from "./service";
import { JsonStore, normalizeDb, type DB } from "./store";

// Montagem das dependências: store -> escrow (Solana) -> service. Os adaptadores só recebem o service pronto.
export function buildService(): RateioService {
  const missing = (["treasurySecret", "mintAddress"] as const).filter((k) => !config[k]);
  if (missing.length > 0) {
    const names = missing.map((k) => (k === "treasurySecret" ? "TREASURY_SECRET" : "MINT_ADDRESS")).join(" e ");
    throw new Error(`Faltam ${names} no .env. Rode: npx tsx scripts/setup-devnet.ts`);
  }

  const db = new JsonStore<DB>(`${config.dataDir}/db.json`, { rateios: [], wallets: {} }, normalizeDb);
  const conn = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(config.mintAddress);
  const treasury = Keypair.fromSecretKey(bs58.decode(config.treasurySecret));
  const escrow = new IntermediaryEscrow(conn, treasury, mint, db, config.brlPerToken);
  return new RateioService(db, escrow, makeReceiptMaker(conn, mint.toBase58(), config.brlPerToken));
}
