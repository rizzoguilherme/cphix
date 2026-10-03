// Em vez de decodificar instruções, comparamos os SALDOS DE TOKEN antes e depois da transação:
// quem perdeu saldo pagou, quem ganhou recebeu. Vale igual para depósito e liberação.
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const parseTxDetails = (tx: ParsedTxLike, signature: string, mint: string): TxDetails | null => {
  const meta = tx.meta;
  if (!meta || meta.err) return null;

  // Variação por dono: soma contas do mesmo dono; conta ausente em "pre" conta como zero.
  const delta = new Map<string, bigint>();
  const apply = (list: TokenBal[] | null | undefined, sign: 1n | -1n) => {
    for (const b of list ?? []) {
      if (b.mint !== mint || !b.owner) continue;
      delta.set(b.owner, (delta.get(b.owner) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
    }
  };
  apply(meta.postTokenBalances, 1n);
  apply(meta.preTokenBalances, -1n);

  let toOwner: string | undefined;
  let fromOwner: string | undefined;
  let max = 0n;
  let min = 0n;
  for (const [owner, d] of delta) {
    if (d > max) { max = d; toOwner = owner; }
    if (d < min) { min = d; fromOwner = owner; }
  }
  if (!toOwner || !fromOwner) return null;

  return {
    signature, slot: tx.slot, blockTime: tx.blockTime ?? null, feeLamports: meta.fee,
    mint, tokenUnits: max, fromOwner, toOwner,
  };
};

export const fetchTxDetails = async (
  conn: TxSource, signature: string, mint: string, opts: { attempts?: number; delayMs?: number } = {},
): Promise<TxDetails | null> => {
  const { attempts = 5, delayMs = 1000 } = opts;
  for (let i = 0; i < attempts; i++) {
    // Logo após confirmar, a RPC às vezes ainda não devolve a transação: tenta de novo.
    const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return parseTxDetails(tx, signature, mint);
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
};
