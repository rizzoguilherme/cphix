import type { Rateio } from "./rateio";
import type { DB, JsonStore } from "./store";
import type { Escrow } from "./escrow";
import type { ReceiptMaker } from "./receipt";

type Err = { ok: false; error: string };

export class RateioService {
  constructor(_db: JsonStore<DB>, _escrow: Escrow, _receipt?: ReceiptMaker) {}
  create(_chatId: string, _userId: string, _name: string, _args: string): { ok: true; rateio: Rateio } | Err {
    throw new Error("não implementado");
  }
  join(_chatId: string, _userId: string, _name: string): { ok: true; rateio: Rateio } | Err {
    throw new Error("não implementado");
  }
  async simulatePix(
    _chatId: string, _userId: string,
  ): Promise<{ ok: true; rateio: Rateio; progress: string; releaseUrl?: string; receiptPng?: Buffer } | Err> {
    throw new Error("não implementado");
  }
}
