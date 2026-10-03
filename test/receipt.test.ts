import { describe, it, expect, vi } from "vitest";
import {
  buildReceiptCard, renderReceiptSvg, renderReceiptPng, makeReceiptMaker, type ReceiptCard,
} from "../src/receipt";
import type { Rateio } from "../src/rateio";
import type { TxDetails, TxSource } from "../src/txDetails";

const rateio: Rateio = {
  id: "r1", chatId: "c1", description: "churrasco", totalCents: 12000, responsibleId: "u1",
  participants: [
    { userId: "u1", name: "Ana", paid: true },
    { userId: "u2", name: "Bia", paid: true },
    { userId: "u3", name: "Caio", paid: true },
  ],
  status: "released", releaseSig: "sig",
};

const details: TxDetails = {
  signature: "5VERYLONGSIGNATUREXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX6789ZZZZ",
  slot: 42, blockTime: 1790000000, feeLamports: 10000, mint: "MintX", tokenUnits: 24000000n,
  fromOwner: "EscrowAddr1111111111111111111111111111111",
  toOwner: "RespAddr22222222222222222222222222222222222222222".slice(0, 4) + "x".repeat(36) + "2222",
};

const card: ReceiptCard = buildReceiptCard(rateio, details, 5);

describe("buildReceiptCard", () => {
  it("monta os campos do cartão", () => {
    expect(card.description).toBe("churrasco");
    expect(card.totalBrl).toBe("R$ 120,00");
    expect(card.amountBrl).toBe("R$ 120,00");
    expect(card.participants).toBe(3);
    expect(card.responsibleName).toBe("Ana");
    expect(card.fromAddr).toBe("Escr…1111");
    expect(card.toAddr).toBe("Resp…2222");
    expect(card.feeSol).toBe("0.000010 SOL");
    expect(card.when).toMatch(/\d{2}\/\d{2}\/\d{2,4}/);
    expect(card.signature).toBe("5VERYLON…6789ZZZZ");
  });

  it("usa 'Responsável' quando o responsável não está na lista e '—' sem blockTime", () => {
    const c = buildReceiptCard({ ...rateio, responsibleId: "zzz" }, { ...details, blockTime: null }, 5);
    expect(c.responsibleName).toBe("Responsável");
    expect(c.when).toBe("—");
  });

  it("não encurta endereços curtos", () => {
    const c = buildReceiptCard(rateio, { ...details, fromOwner: "curto", toOwner: "123456789" }, 5);
    expect(c.fromAddr).toBe("curto");
    expect(c.toAddr).toBe("123456789");
  });
});

describe("renderReceiptSvg", () => {
  it("escapa marcação digitada por usuários", () => {
    const svg = renderReceiptSvg({ ...card, description: `<script>&"x"`, responsibleName: "<b>Ana</b>" });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<b>Ana");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;x&quot;");
  });

  it("corta texto longo com reticências", () => {
    const svg = renderReceiptSvg({ ...card, description: "x".repeat(80) });
    expect(svg).toContain("…");
    expect(svg).not.toContain("x".repeat(80));
  });

  it("remove emoji e caracteres de controle", () => {
    const svg = renderReceiptSvg({ ...card, description: "🍖 churrasco\u0001 do ano 🎉" });
    expect(svg).toContain("churrasco do ano");
    expect(svg).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(svg).not.toContain("\u0001");
  });
});

describe("renderReceiptPng", () => {
  it("devolve um PNG de verdade", () => {
    const png = renderReceiptPng(card);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(5000);
  });

  it("não lança com texto hostil", () => {
    expect(() => renderReceiptPng({
      ...card,
      description: `🍖<>&"'\u0001\u0002 ${"a".repeat(200)}`,
      responsibleName: "‍️🎉",
    })).not.toThrow();
  });
});

const txLiberacao = {
  slot: 42, blockTime: 1790000000,
  meta: {
    err: null, fee: 10000,
    preTokenBalances: [{ mint: "MintX", owner: "Escrow", uiTokenAmount: { amount: "24000000" } }],
    postTokenBalances: [{ mint: "MintX", owner: "Resp", uiTokenAmount: { amount: "24000000" } }],
  },
};

describe("makeReceiptMaker", () => {
  it("devolve um PNG quando a rede acha a transação", async () => {
    const conn: TxSource = { getParsedTransaction: vi.fn().mockResolvedValue(txLiberacao) };
    const png = await makeReceiptMaker(conn, "MintX", 5, { attempts: 1, delayMs: 0 })(rateio, "sig");
    expect(png).toBeInstanceOf(Buffer);
    expect(png!.subarray(1, 4).toString()).toBe("PNG");
  });

  it("devolve null quando a RPC nunca acha a transação", async () => {
    const conn: TxSource = { getParsedTransaction: vi.fn().mockResolvedValue(null) };
    expect(await makeReceiptMaker(conn, "MintX", 5, { attempts: 2, delayMs: 0 })(rateio, "sig")).toBeNull();
  });
});
