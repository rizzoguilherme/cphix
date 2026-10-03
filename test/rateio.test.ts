import { describe, it, expect } from "vitest";
import {
  parseAmountToCents, createRateio, join, sharesCents, markPaid, allPaid, progress, type Rateio,
} from "../src/rateio";

// Rateio montado à mão para os testes não dependerem do id aleatório.
const make = (total: number, n: number): Rateio => ({
  id: "r1", chatId: "c1", description: "teste", totalCents: total, responsibleId: "u0", status: "open",
  participants: Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, paid: false })),
});

describe("parseAmountToCents", () => {
  it.each([
    ["120", 12000], ["120,50", 12050], ["120.5", 12050], [" 7 ", 700], ["0,01", 1], ["12.34", 1234],
  ])("accepts %j", (text, cents) => expect(parseAmountToCents(text)).toBe(cents));

  it.each(["abc", "-5", "1,2,3", "", "0", "0,00", "12.345"])("rejects %j", (text) =>
    expect(parseAmountToCents(text)).toBeNull());
});

describe("createRateio", () => {
  it("puts the responsible as first participant, unpaid, and opens the rateio", () => {
    const r = createRateio({
      chatId: "c1", description: "churrasco", totalCents: 12000, responsibleId: "u1", responsibleName: "Ana",
    });
    expect(r.participants).toEqual([{ userId: "u1", name: "Ana", paid: false }]);
    expect(r.responsibleId).toBe("u1");
    expect(r.status).toBe("open");
    expect(r.id).toHaveLength(8);
  });
});

describe("join", () => {
  it("adds a new participant at the end without changing the original", () => {
    const r = make(12000, 1);
    const r2 = join(r, "u9", "Bia");
    expect(r2.participants.map((p) => p.userId)).toEqual(["u0", "u9"]);
    expect(r2.participants[1].paid).toBe(false);
    expect(r.participants).toHaveLength(1);
    expect(r2).not.toBe(r);
  });

  it("does not duplicate an existing participant", () => {
    const r = make(12000, 2);
    expect(join(r, "u1", "P1")).toBe(r);
  });
});

describe("sharesCents", () => {
  it.each([[10000, 3], [1, 3], [100, 7], [12000, 3], [9999, 2]])("sums exactly to %i with %i people", (total, n) => {
    const shares = [...sharesCents(make(total, n)).values()];
    expect(shares).toHaveLength(n);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("gives the leftover cents to the first participants", () => {
    expect([...sharesCents(make(10000, 3)).values()]).toEqual([3334, 3333, 3333]);
    expect([...sharesCents(make(100, 7)).values()]).toEqual([15, 15, 14, 14, 14, 14, 14]);
  });
});

describe("markPaid", () => {
  it("marks the participant as paid without changing the original", () => {
    const r = make(12000, 2);
    const r2 = markPaid(r, "u1");
    expect(r2.participants[1].paid).toBe(true);
    expect(r.participants[1].paid).toBe(false);
  });

  it("throws not_participant for a stranger", () => {
    expect(() => markPaid(make(12000, 2), "x")).toThrow("not_participant");
  });

  it("is idempotent", () => {
    const once = markPaid(make(12000, 2), "u1");
    expect(markPaid(once, "u1")).toEqual(once);
  });
});

describe("allPaid and progress", () => {
  it("reports none, some and all paid", () => {
    const r0 = make(12000, 3);
    const r1 = markPaid(r0, "u0");
    const r3 = markPaid(markPaid(r1, "u1"), "u2");
    expect([allPaid(r0), allPaid(r1), allPaid(r3)]).toEqual([false, false, true]);
    expect(progress(r0)).toBe("0 de 3 pagaram ✅");
    expect(progress(r1)).toBe("1 de 3 pagaram ✅");
    expect(progress(r3)).toBe("3 de 3 pagaram ✅");
  });
});

describe("parseAmountToCents with thousands separator", () => {
  it.each([["1.000,50", 100050], ["12.345,67", 1234567], ["1.000.000,00", 100000000], ["1.000,5", 100050]])(
    "accepts the Brazilian format %j", (text, cents) => expect(parseAmountToCents(text)).toBe(cents));

  // Sem vírgula o ponto é ambíguo ("12.345" pode ser doze mil ou doze reais), então continua recusado.
  it.each(["1.000", "12.345", "1.00,50", "10.00,00", "1,000.50", ".100,00"])("still rejects %j", (text) =>
    expect(parseAmountToCents(text)).toBeNull());
});
