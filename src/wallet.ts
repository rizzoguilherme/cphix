import type { Keypair } from "@solana/web3.js";
import type { DB, JsonStore } from "./store";

// Carteira custodial: o bot cria e guarda a chave do usuário.
export const getOrCreateWallet = (_db: JsonStore<DB>, _userId: string): Keypair => {
  throw new Error("não implementado");
};
