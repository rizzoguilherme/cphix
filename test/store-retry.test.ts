import { describe, it, expect, vi } from "vitest";
import { retrySync } from "../src/store";

// Erro de arquivo como o Node lança (o código fica em `code`).
const fsError = (code: string) => Object.assign(new Error(`${code}: arquivo ocupado`), { code });

describe("retrySync", () => {
  it("returns at once when the first try works", () => {
    const fn = vi.fn(() => 42);
    expect(retrySync(fn, { attempts: 5, delayMs: 0 })).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each(["EPERM", "EBUSY", "EACCES"])("tries again while Windows holds the file (%s)", (code) => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 3) throw fsError(code);
      return "ok";
    };
    expect(retrySync(fn, { attempts: 5, delayMs: 0 })).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt and throws the file error", () => {
    const fn = vi.fn(() => { throw fsError("EPERM"); });
    expect(() => retrySync(fn, { attempts: 4, delayMs: 0 })).toThrow("EPERM");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not retry other errors", () => {
    const fn = vi.fn(() => { throw fsError("ENOSPC"); });
    expect(() => retrySync(fn, { attempts: 5, delayMs: 0 })).toThrow("ENOSPC");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits between attempts", () => {
    let calls = 0;
    const start = Date.now();
    retrySync(() => { if (++calls < 3) throw fsError("EBUSY"); }, { attempts: 5, delayMs: 30 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
