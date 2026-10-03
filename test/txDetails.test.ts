import { describe, it, expect, vi } from "vitest";
import { parseTxDetails, fetchTxDetails, type ParsedTxLike, type TxSource } from "../src/txDetails";

const MINT = "MintX";
const bal = (owner: string | undefined, amount: string, mint = MINT) => ({
  mint, owner, uiTokenAmount: { amount },
});

const liberacao: ParsedTxLike = {
  slot: 42,
  blockTime: 1790000000,
  meta: {
    err: null,
    fee: 10000,
    preTokenBalances: [bal("Escrow", "24000000"), bal("Resp", "0")],
    postTokenBalances: [bal("Escrow", "0"), bal("Resp", "24000000")],
  },
};

describe("parseTxDetails", () => {
  it("lê origem, destino e valor de uma liberação", () => {
    expect(parseTxDetails(liberacao, "sig", MINT)).toEqual({
      signature: "sig", slot: 42, blockTime: 1790000000, feeLamports: 10000,
      mint: MINT, tokenUnits: 24000000n, fromOwner: "Escrow", toOwner: "Resp",
    });
  });

  it("ignora variações de outros mints", () => {
    const tx: ParsedTxLike = {
      ...liberacao,
      meta: {
        err: null, fee: 5,
        preTokenBalances: [bal("Escrow", "100"), bal("Outro", "999999", "OtherMint")],
        postTokenBalances: [bal("Resp", "100"), bal("Outro", "0", "OtherMint")],
      },
    };
    const d = parseTxDetails(tx, "sig", MINT);
    expect(d?.fromOwner).toBe("Escrow");
    expect(d?.toOwner).toBe("Resp");
    expect(d?.tokenUnits).toBe(100n);
  });

  it("trata conta ausente em 'pre' como zero", () => {
    const tx: ParsedTxLike = {
      slot: 1,
      meta: {
        err: null, fee: 5,
        preTokenBalances: [bal("Escrow", "50")],
        postTokenBalances: [bal("Escrow", "0"), bal("Resp", "50")],
      },
    };
    const d = parseTxDetails(tx, "sig", MINT);
    expect(d?.toOwner).toBe("Resp");
    expect(d?.tokenUnits).toBe(50n);
    expect(d?.blockTime).toBeNull();
  });

  it("soma contas do mesmo dono e ignora contas sem owner", () => {
    const tx: ParsedTxLike = {
      slot: 1,
      meta: {
        err: null, fee: 5,
        preTokenBalances: [bal("A", "30"), bal("A", "70"), bal(undefined, "500")],
        postTokenBalances: [bal("A", "0"), bal("A", "0"), bal("B", "100"), bal(undefined, "0")],
      },
    };
    const d = parseTxDetails(tx, "sig", MINT);
    expect(d).toMatchObject({ fromOwner: "A", toOwner: "B", tokenUnits: 100n });
  });

  it("devolve null para transação com erro, meta null, sem movimento e listas vazias", () => {
    expect(parseTxDetails({ slot: 1, meta: { ...liberacao.meta!, err: { x: 1 } } }, "s", MINT)).toBeNull();
    expect(parseTxDetails({ slot: 1, meta: null }, "s", MINT)).toBeNull();
    expect(parseTxDetails({
      slot: 1,
      meta: { err: null, fee: 1, preTokenBalances: [bal("A", "5")], postTokenBalances: [bal("A", "5")] },
    }, "s", MINT)).toBeNull();
    expect(parseTxDetails({ slot: 1, meta: { err: null, fee: 1, preTokenBalances: null, postTokenBalances: null } }, "s", MINT)).toBeNull();
    expect(parseTxDetails({ slot: 1, meta: { err: null, fee: 1 } }, "s", MINT)).toBeNull();
  });
});

describe("fetchTxDetails", () => {
  it("tenta de novo enquanto a RPC devolve null", async () => {
    const getParsedTransaction = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(liberacao);
    const conn: TxSource = { getParsedTransaction };
    const d = await fetchTxDetails(conn, "sig", MINT, { attempts: 5, delayMs: 0 });
    expect(d?.tokenUnits).toBe(24000000n);
    expect(getParsedTransaction).toHaveBeenCalledTimes(3);
    expect(getParsedTransaction).toHaveBeenCalledWith("sig", { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  });

  it("desiste com null depois da última tentativa", async () => {
    const getParsedTransaction = vi.fn().mockResolvedValue(null);
    const d = await fetchTxDetails({ getParsedTransaction }, "sig", MINT, { attempts: 3, delayMs: 0 });
    expect(d).toBeNull();
    expect(getParsedTransaction).toHaveBeenCalledTimes(3);
  });
});
