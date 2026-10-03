import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../src/config";

// A chave secreta impressa dá controle da tesouraria; copie para o .env local e não compartilhe em canal público.

async function main() {
  const conn = new Connection(config.rpcUrl, "confirmed");
  
  let treasury: Keypair;
  if (config.treasurySecret) {
    treasury = Keypair.fromSecretKey(bs58.decode(config.treasurySecret));
  } else {
    treasury = Keypair.generate();
  }

  const secretString = bs58.encode(treasury.secretKey);
  const address = treasury.publicKey.toBase58();

  const balance = await conn.getBalance(treasury.publicKey);
  if (balance < LAMPORTS_PER_SOL) {
    try {
      console.log(`Solicitando airdrop para ${address}...`);
      const sig = await conn.requestAirdrop(treasury.publicKey, 2 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
      console.log("Airdrop realizado com sucesso!");
    } catch (error) {
      console.log(`Erro no airdrop: ${error}`);
      console.log(`\n=== ATENÇÃO ===`);
      console.log(`A rede falhou em dar SOL automaticamente (muito comum em devnet). Faça o seguinte:`);
      console.log(`1. Adicione a seguinte linha no seu arquivo .env:`);
      console.log(`TREASURY_SECRET=${secretString}`);
      console.log(`2. Acesse https://faucet.solana.com e peça SOL para o endereço:`);
      console.log(`${address}`);
      console.log(`3. Depois que a faucet confirmar o envio, rode npx tsx scripts/setup-devnet.ts de novo.`);
      return;
    }
  }

  const mint = await createMint(conn, treasury, treasury.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
  await mintTo(conn, treasury, mint, ata.address, treasury, 1_000_000n * 1_000_000n);

  console.log(`\nTudo pronto! Cole exatamente estas duas linhas no seu .env:`);
  console.log(`TREASURY_SECRET=${secretString}`);
  console.log(`MINT_ADDRESS=${mint.toBase58()}`);
}

main().catch(console.error);
