import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Rateio } from "./rateio";

// Persistência simples em um arquivo JSON: basta para a demo e sobrevive a reinício.
// Em produção seria um banco de dados.
export class JsonStore<T> {
  private value: T;

  constructor(private path: string, empty: T, migrate: (v: T) => T = (v) => v) {
    this.value = existsSync(path) ? migrate(JSON.parse(readFileSync(path, "utf8"))) : empty;
  }

  get(): T { return this.value; }

  // Gravação síncrona: dois comandos seguidos nunca leem um arquivo pela metade.
  // Grava num temporário e renomeia: se o bot cair no meio, o db.json (com as chaves das carteiras)
  // continua inteiro na versão anterior. A memória só muda depois que o disco mudou.
  set(v: T): void {
    const json = JSON.stringify(v, null, 2);
    const tmp = `${this.path}.tmp`;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(tmp, json);
    renameSync(tmp, this.path);
    this.value = v;
  }
}

// O "banco": rateios e carteiras (id do usuário -> chave secreta em base58).
export type DB = { rateios: Rateio[]; wallets: Record<string, string> };

// Arquivos antigos guardavam ids do Telegram como número; hoje todo id é string (vale para o WhatsApp também).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeDb = (raw: any): DB => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rateios: (raw.rateios ?? []).map((r: any) => ({
    ...r,
    chatId: String(r.chatId),
    responsibleId: String(r.responsibleId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    participants: (r.participants ?? []).map((p: any) => ({ ...p, userId: String(p.userId) })),
  })),
  wallets: raw.wallets ?? {},
});

// No máximo um rateio aberto por chat; os já liberados ficam só como histórico.
export const activeRateio = (db: JsonStore<DB>, chatId: string): Rateio | undefined =>
  db.get().rateios.find((r) => r.chatId === chatId && r.status === "open");

export const saveRateio = (db: JsonStore<DB>, r: Rateio): void => {
  const cur = db.get();
  db.set({ ...cur, rateios: [...cur.rateios.filter((x) => x.id !== r.id), r] });
};
