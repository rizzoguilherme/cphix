import type { Rateio } from "./rateio";
import type { TxDetails, TxSource } from "./txDetails";

export type ReceiptCard = {
  description: string; totalBrl: string; participants: number; responsibleName: string;
  amountBrl: string; fromAddr: string; toAddr: string; feeSol: string; when: string; signature: string;
};

// Quem gera o comprovante de uma liberação. Devolve null se não achou a transação na rede.
export type ReceiptMaker = (rateio: Rateio, signature: string) => Promise<Buffer | null>;

const todo = (): never => { throw new Error("não implementado"); };

export const buildReceiptCard = (_r: Rateio, _d: TxDetails, _brlPerToken: number): ReceiptCard => todo();
export const renderReceiptSvg = (_c: ReceiptCard): string => todo();
export const renderReceiptPng = (_c: ReceiptCard): Buffer => todo();
// Enquanto não implementado, não gera imagem (o bot segue só com texto).
export const makeReceiptMaker = (
  _conn: TxSource, _mint: string, _brlPerToken: number, _opts?: { attempts?: number; delayMs?: number },
): ReceiptMaker => async () => null;
