type TokenBal = { mint: string; owner?: string; uiTokenAmount: { amount: string } };

export type ParsedTxLike = {
  slot: number;
  blockTime?: number | null;
  meta: null | {
    err: unknown; fee: number;
    preTokenBalances?: TokenBal[] | null; postTokenBalances?: TokenBal[] | null;
  };
};

export type TxDetails = {
  signature: string; slot: number; blockTime: number | null; feeLamports: number;
  mint: string; tokenUnits: bigint; fromOwner: string; toOwner: string;
};

export interface TxSource {
  getParsedTransaction(
    signature: string,
    config: { commitment: "confirmed"; maxSupportedTransactionVersion: number },
  ): Promise<ParsedTxLike | null>;
}

const todo = (): never => { throw new Error("não implementado"); };

export const parseTxDetails = (_tx: ParsedTxLike, _signature: string, _mint: string): TxDetails | null => todo();
export const fetchTxDetails = (
  _conn: TxSource, _signature: string, _mint: string, _opts?: { attempts?: number; delayMs?: number },
): Promise<TxDetails | null> => todo();
