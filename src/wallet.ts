import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { DB, JsonStore } from "./store";

// Carteira CUSTODIAL: o bot cria e guarda a chave do usuário, que só vê reais e nunca lida com Solana.
// NOTA: isso é simples para a demo e é o maior risco de segurança; em produção o usuário traria a própria carteira.
export const getOrCreateWallet = (db: JsonStore<DB>, userId: string): Keypair => {
  const data = db.get();
  const existingSecret = data.wallets[userId];
  
  if (existingSecret) {
    return Keypair.fromSecretKey(bs58.decode(existingSecret));
  }

  const kp = Keypair.generate();
  const secretString = bs58.encode(kp.secretKey);
  
  db.set({
    ...data,
    wallets: {
      ...data.wallets,
      [userId]: secretString
    }
  });

  return kp;
};
