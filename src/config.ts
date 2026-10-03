// Configuração central: lê o .env uma única vez e entrega um objeto tipado.
import "dotenv/config";

export const config = {
  telegramToken: process.env.TELEGRAM_TOKEN ?? "",
  rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  brlPerToken: Number(process.env.BRL_PER_TOKEN ?? "5"),
  dataDir: process.env.DATA_DIR ?? "./data",
  treasurySecret: process.env.TREASURY_SECRET ?? "",
  mintAddress: process.env.MINT_ADDRESS ?? "",
  channel: process.env.CHANNEL ?? "telegram",
  waAuthDir: process.env.WA_AUTH_DIR ?? "./data/wa-auth",
};
