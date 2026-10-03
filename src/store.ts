import type { Rateio } from "./rateio";

const todo = (): never => { throw new Error("não implementado"); };

export class JsonStore<T> {
  constructor(_path: string, _empty: T, _migrate: (v: T) => T = (v) => v) {}
  get(): T { return todo(); }
  set(_v: T): void { todo(); }
}

// O "banco": rateios e carteiras (id do usuário -> chave secreta em base58).
export type DB = { rateios: Rateio[]; wallets: Record<string, string> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalizeDb = (_raw: any): DB => todo();
export const activeRateio = (_db: JsonStore<DB>, _chatId: string): Rateio | undefined => todo();
export const saveRateio = (_db: JsonStore<DB>, _r: Rateio): void => todo();
