// Gera o comprovante da ÚLTIMA liberação registrada, para ver a imagem sem esperar o bot.
// Só LÊ da rede (não gasta SOL).
import { mkdirSync, writeFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import { config } from "../src/config";
import { JsonStore, normalizeDb, type DB } from "../src/store";
import { makeReceiptMaker } from "../src/receipt";

const db = new JsonStore<DB>(`${config.dataDir}/db.json`, { rateios: [], wallets: {} }, normalizeDb);
const rateio = [...db.get().rateios].reverse().find((r) => r.status === "released" && r.releaseSig);

if (!rateio?.releaseSig) {
  console.log("Nenhuma liberação ainda. Faça uma pelo bot ou por scripts/demo-local.ts.");
} else {
  const conn = new Connection(config.rpcUrl, "confirmed");
  const png = await makeReceiptMaker(conn, config.mintAddress, config.brlPerToken)(rateio, rateio.releaseSig);
  if (!png) {
    console.log("A RPC não achou a transação.");
  } else {
    mkdirSync(config.dataDir, { recursive: true });
    const out = `${config.dataDir}/receipt-preview.png`;
    writeFileSync(out, png);
    console.log(`Comprovante salvo em ${out}`);
  }
}
