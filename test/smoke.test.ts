import { describe, it, expect } from "vitest";
import { brl } from "../src/commands";
import { centsToTokenUnits } from "../src/solana";

describe("esqueleto", () => {
  it("formata reais", () => expect(brl(4000)).toBe("R$ 40,00"));
  it("converte centavos em unidades do token", () => expect(centsToTokenUnits(4000, 5)).toBe(8_000_000n));
});
