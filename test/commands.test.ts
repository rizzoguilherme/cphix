import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMessage, brl, type Incoming } from "../src/commands";
import { RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";
import type { ReceiptMaker } from "../src/receipt";
import { explorerUrl } from "../src/solana";

const USAGE =
  "Uso: /rateio <valor> <descrição> [pessoas] [prazo]. Exemplo: /rateio 120 churrasco 4 30m (prazo: 30m, 2h, 1d; padrão 60m)";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const fakeEscrow = (failDeposit = false): Escrow => {
  let n = 0;
  return {
    deposit: async () => { if (failDeposit) throw new Error("rede fora"); return `dep-${++n}`; },
    release: async () => "rel-1",
    refund: async () => { throw new Error("não usado"); },
  };
};

const setup = (opts: { receipt?: ReceiptMaker; failDeposit?: boolean } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-cmd-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  return new RateioService(db, fakeEscrow(opts.failDeposit), opts.receipt);
};

// Mensagem no grupo g1; quem fala muda pelo userId/name.
const msg = (text: string, userId = "u1", name = "Ana", isGroup = true): Incoming =>
  ({ chatId: "g1", userId, name, isGroup, text });

describe("handleMessage", () => {
  it("ignores plain text and unknown commands", async () => {
    const svc = setup();
    expect(await handleMessage(svc, msg("oi pessoal"))).toBeNull();
    expect(await handleMessage(svc, msg("/xyz"))).toBeNull();
  });

  it("/rateio only works in groups", async () => {
    expect(await handleMessage(setup(), msg("/rateio 120 churrasco 2", "u1", "Ana", false)))
      .toEqual({ text: "Use este comando em um grupo." });
  });

  it("/rateio creates the rateio and offers the join button", async () => {
    const reply = await handleMessage(setup(), msg("/rateio 120 churrasco 2"));
    expect(reply).toEqual({
      text: expect.stringMatching(
        /^🧾 churrasco: R\$ 120,00\nResponsável: Ana\n2 pessoas, ~R\$ 60,00 cada\. Pague até \d\d:\d\d\.\nPara entrar, envie \/participar\.$/,
      ),
      offerJoin: true,
    });
  });

  it("/rateio without arguments returns usage, and a second one returns the duplicate error", async () => {
    const svc = setup();
    expect((await handleMessage(svc, msg("/rateio")))?.text)
      .toBe(USAGE);
    await handleMessage(svc, msg("/rateio 120 churrasco 2"));
    expect((await handleMessage(svc, msg("/rateio 50 pizza 2")))?.text).toBe("Já existe um rateio aberto neste chat.");
  });

  it("accepts the @bot suffix and uppercase commands", async () => {
    expect((await handleMessage(setup(), msg("/rateio@CPhixBot 50 pizza 2")))?.text).toContain("🧾 pizza: R$ 50,00");
    expect((await handleMessage(setup(), msg("/RATEIO 50 pizza 2")))?.text).toContain("🧾 pizza: R$ 50,00");
  });

  it("/participar shows the current share and the number of people", async () => {
    const svc = setup();
    expect((await handleMessage(svc, msg("/participar", "u2", "Bia")))?.text).toBe("Nenhum rateio aberto. Use /rateio.");
    await handleMessage(svc, msg("/rateio 120 churrasco 2"));
    expect((await handleMessage(svc, msg("/participar", "u2", "Bia")))?.text)
      .toBe("Bia entrou (2 de 2). Sua cota: ~R$ 60,00. Pague com /simular_pix");
  });

  it("/simular_pix reports progress, then the release with link and receipt", async () => {
    const png = Buffer.from("png");
    const svc = setup({ receipt: async () => png });
    await handleMessage(svc, msg("/rateio 120 churrasco 2"));
    await handleMessage(svc, msg("/participar", "u2", "Bia"));
    expect(await handleMessage(svc, msg("/simular_pix"))).toEqual({ text: "1 de 2 pagaram ✅", image: undefined });
    expect(await handleMessage(svc, msg("/simular_pix", "u2", "Bia"))).toEqual({
      text: `2 de 2 pagaram ✅\n🎉 Todos pagaram! Valor liberado ao responsável.\n${explorerUrl("rel-1")}`,
      image: png,
    });
  });

  it("/simular_pix returns a friendly message when the escrow throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = setup({ failDeposit: true });
    await handleMessage(svc, msg("/rateio 120 churrasco 2"));
    expect((await handleMessage(svc, msg("/simular_pix")))?.text)
      .toBe("Erro ao falar com a Solana. Tente de novo em instantes.");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("brl", () => {
  it.each([[0, "R$ 0,00"], [5, "R$ 0,05"], [4000, "R$ 40,00"], [12345, "R$ 123,45"]])("%i -> %s", (c, s) =>
    expect(brl(c)).toBe(s));
});

describe("/status", () => {
  it("returns the no-rateio error when nothing is open", async () => {
    expect((await handleMessage(setup(), msg("/status")))?.text).toBe("Nenhum rateio aberto. Use /rateio.");
  });

  it("lists each participant with share and payment state", async () => {
    const svc = setup();
    await handleMessage(svc, msg("/rateio 100 pizza 3"));
    await handleMessage(svc, msg("/participar", "u2", "Bia"));
    await handleMessage(svc, msg("/participar", "u3", "Caio"));
    await handleMessage(svc, msg("/simular_pix", "u2", "Bia"));
    const text = (await handleMessage(svc, msg("/status", "u3", "Caio")))?.text;
    expect(text).toMatch(/Prazo: até \d\d:\d\d\.$/);
    expect(text?.replace(/\nPrazo:.*$/, "")).toBe(
      "🧾 pizza: R$ 100,00 (responsável: Ana)\n" +
      "⏳ Ana: R$ 33,34\n✅ Bia: R$ 33,33\n⏳ Caio: R$ 33,33\n" +
      "1 de 3 pagaram ✅",
    );
  });
});

describe("/start and /ajuda", () => {
  it.each(["/start", "/ajuda", "/help", "/start@CPhixBot"])("%s explains the commands in private and in groups", async (text) => {
    for (const isGroup of [false, true]) {
      const reply = await handleMessage(setup(), msg(text, "u1", "Ana", isGroup));
      expect(reply?.text).toContain("/rateio <valor> <descrição> [pessoas] [prazo]");
      expect(reply?.text).toContain("/participar");
      expect(reply?.text).toContain("/simular_pix");
      expect(reply?.text).toContain("/status");
      expect(reply?.text).toContain("grupo");
    }
  });
});

describe("/historico", () => {
  it("says when nothing was released yet", async () => {
    expect((await handleMessage(setup(), msg("/historico")))?.text).toBe("Nenhum rateio liberado neste grupo ainda.");
  });

  it("lists released rateios with responsible, amount and Explorer link", async () => {
    const svc = setup();
    await handleMessage(svc, msg("/rateio 120 churrasco 2"));
    await handleMessage(svc, msg("/participar", "u2", "Bia"));
    await handleMessage(svc, msg("/simular_pix"));
    await handleMessage(svc, msg("/simular_pix", "u2", "Bia"));
    expect((await handleMessage(svc, msg("/historico", "u2", "Bia")))?.text).toBe(
      "📜 Rateios liberados neste grupo:\n\n" +
      `🧾 churrasco: R$ 120,00 para Ana\n${explorerUrl("rel-1")}`,
    );
  });

  it("is listed in the help", async () => {
    expect((await handleMessage(setup(), msg("/ajuda")))?.text).toContain("/historico");
  });
});
