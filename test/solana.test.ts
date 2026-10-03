import { describe, it, expect } from "vitest";
import { centsToTokenUnits, explorerUrl } from "../src/solana";

describe("solana helpers", () => {
  it("centsToTokenUnits", () => {
    // os valores on-chain são inteiros grandes porque lidamos com precisão de token
    expect(centsToTokenUnits(4000, 5)).toBe(8_000_000n);
    expect(centsToTokenUnits(100, 5)).toBe(200_000n);
    expect(centsToTokenUnits(1, 5)).toBe(2000n);
    expect(centsToTokenUnits(100, 1)).toBe(1_000_000n);
    expect(typeof centsToTokenUnits(100, 1)).toBe("bigint");
  });

  it("explorerUrl", () => {
    expect(explorerUrl("abc")).toBe("https://explorer.solana.com/tx/abc?cluster=devnet");
  });
});
