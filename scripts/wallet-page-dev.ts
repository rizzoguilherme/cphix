// Sobe só a página de cadastro da carteira, com um link de teste, para conferir no navegador.
// Uso: npx tsx scripts/wallet-page-dev.ts  -> abre o link impresso (localhost conta como contexto seguro).
// Usa um banco separado (data/wallet-page-dev.json) e um cofre falso: não fala com o bot nem com a Solana.
import { config } from "../src/config";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import { startWalletPage } from "../src/walletPage";

const port = config.walletPagePort;
const db = new JsonStore<DB>("./data/wallet-page-dev.json", { rateios: [], wallets: {} });
const svc = new RateioService(db, {
  deposit: async () => "dev",
  release: async () => "dev",
  refund: async () => "dev",
});

startWalletPage(svc, port);
const { token } = svc.createWalletLink("usuario-de-teste");
console.log(`Link de teste (vale 15 minutos): http://localhost:${port}/carteira?t=${token}`);
console.log("Endereços cadastrados ficam em data/wallet-page-dev.json (campo addresses).");
