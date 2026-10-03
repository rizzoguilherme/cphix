import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "../src/config";
import { IntermediaryEscrow } from "../src/escrow";
import { JsonStore, DB } from "../src/store";
import { explorerUrl } from "../src/solana";

// Teste manual na devnet: faz um depósito e uma liberação reais e imprime os links.

async function main() {
  if (!config.treasurySecret || !config.mintAddress) {
    console.error("Erro: TREASURY_SECRET e MINT_ADDRESS não estão definidos no .env.");
    return;
  }

  const conn = new Connection(config.rpcUrl, "confirmed");
  const tesouraria = Keypair.fromSecretKey(bs58.decode(config.treasurySecret));
  const mint = new PublicKey(config.mintAddress);
  const db = new JsonStore<DB>("./data/smoke.json", { rateios: [], wallets: {} });
  
  const esc = new IntermediaryEscrow(conn, tesouraria, mint, db, config.brlPerToken);

  const depositSig = await esc.deposit("smoke1", 4000);
  console.log("deposit", explorerUrl(depositSig));

  const releaseSig = await esc.release("smoke1", "1");
  console.log("release", explorerUrl(releaseSig));
}

main().catch(console.error);
