import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMessage, type Incoming } from "../src/commands";
import { formatTime, parseDuration, parseRateioArgs } from "../src/rateio";
import { EXPIRED_MSG, RateioService } from "../src/service";
import { JsonStore, type DB } from "../src/store";
import type { Escrow } from "../src/escrow";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const MIN = 60_000;

// Relógio manual: `clock.t` avança quando o teste quer.
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "cphix-prazo-"));
  dirs.push(dir);
  const db = new JsonStore<DB>(join(dir, "db.json"), { rateios: [], wallets: {} });
  const clock = { t: 1_700_000_000_000 };
  const releases: string[] = [];
  const refunds: [string, number][] = [];
  const escrow: Escrow = {
    deposit: async () => "dep",
    release: async (_id, to) => { releases.push(to); return "rel-1"; },
    refund: async (_id, to, cents) => { refunds.push([to, cents]); return "ref"; },
  };
  return { db, clock, releases, refunds, svc: new RateioService(db, escrow, undefined, () => clock.t) };
};

const say = async (svc: RateioService, text: string, userId = "u1", name = "Ana") =>
  (await handleMessage(svc, { chatId: "g1", userId, name, isGroup: true, text } as Incoming))?.text;

describe("parseDuration", () => {
  it("lê minutos, horas e dias", () => {
    expect(parseDuration("30m")).toBe(30 * MIN);
    expect(parseDuration("45min")).toBe(45 * MIN);
    expect(parseDuration("2h")).toBe(120 * MIN);
    expect(parseDuration("1d")).toBe(1440 * MIN);
    expect(parseDuration("2H")).toBe(120 * MIN);
  });
  it("recusa sem unidade, zero ou lixo", () => {
    for (const t of ["30", "0m", "m", "1.5h", "abc", ""]) expect(parseDuration(t)).toBeNull();
  });
});

describe("parseRateioArgs", () => {
  it("valor, descrição, pessoas e prazo", () => {
    expect(parseRateioArgs("120 churrasco 4 30m")).toEqual({ totalCents: 12000, description: "churrasco", expected: 4, durationMs: 30 * MIN });
  });
  it("prazo é opcional", () => {
    expect(parseRateioArgs("120 churrasco 4")).toEqual({ totalCents: 12000, description: "churrasco", expected: 4, durationMs: null });
  });
  it("descrição com várias palavras e números", () => {
    expect(parseRateioArgs("50 pizza 2 queijos 3 1h")).toEqual({ totalCents: 5000, description: "pizza 2 queijos", expected: 3, durationMs: 60 * MIN });
  });
  it("pessoas é opcional: sem número, a divisão é entre quem entrar", () => {
    expect(parseRateioArgs("120 churrasco")).toEqual({ totalCents: 12000, description: "churrasco", expected: null, durationMs: null });
    expect(parseRateioArgs("120 churrasco de domingo 2h")).toEqual({ totalCents: 12000, description: "churrasco de domingo", expected: null, durationMs: 120 * MIN });
  });
  it("um número sozinho depois do valor é a descrição, não as pessoas", () => {
    expect(parseRateioArgs("120 4")).toEqual({ totalCents: 12000, description: "4", expected: null, durationMs: null });
  });
  it("recusa sem descrição ou sem valor", () => {
    for (const a of ["120", "120 30m", "churrasco 4", ""]) expect(parseRateioArgs(a)).toBeNull();
  });
});

describe("formatTime", () => {
  const base = Date.UTC(2026, 9, 3, 18, 39); // 03/10 15:39 em Brasília
  it("hoje: só a hora", () => expect(formatTime(base + 30 * MIN, base)).toBe("16:09"));
  it("outro dia: com a data", () => {
    expect(formatTime(base + 1440 * MIN, base)).toBe("04/10 15:39");
    expect(formatTime(base + 7 * 1440 * MIN, base)).toBe("10/10 15:39");
  });
  it("vira o dia no fuso do Brasil, não no UTC", () => {
    expect(formatTime(base + 9 * 60 * MIN, base)).toBe("04/10 00:39");
  });
});

describe("sem número de pessoas (como antes)", () => {
  it("cria sem expectedParticipants e a cota segue quem entrar", async () => {
    const { svc } = setup();
    const res = svc.create("g1", "u1", "Ana", "120 churrasco");
    expect(res.ok && res.rateio.expectedParticipants).toBeUndefined();
    expect(res.ok && res.rateio.deadline).toBeDefined();
    expect(await say(svc, "/participar", "u2", "Bia")).toBe("Bia entrou. Cota atual: ~R$ 60,00 (2 pessoas). Pague com /simular_pix");
    expect(await say(svc, "/participar", "u3", "Caio")).toBe("Caio entrou. Cota atual: ~R$ 40,00 (3 pessoas). Pague com /simular_pix");
  });
  it("a resposta do /rateio não menciona número de pessoas", async () => {
    const { svc } = setup();
    expect(await say(svc, "/rateio 120 churrasco")).toMatch(/^🧾 churrasco: R\$ 120,00\nResponsável: Ana\nPague até \d\d:\d\d\.\nPara entrar, envie \/participar\.$/);
  });
  it("libera quando todos que entraram pagaram", async () => {
    const { svc, releases } = setup();
    svc.create("g1", "u1", "Ana", "120 churrasco");
    svc.join("g1", "u2", "Bia");
    await svc.simulatePix("g1", "u1");
    await svc.simulatePix("g1", "u2");
    expect(releases).toEqual(["u1"]);
  });
});

describe("rateio vencido não trava o grupo", () => {
  it("sem pagamentos: um novo /rateio substitui o vencido", () => {
    const { svc, db, clock } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    clock.t += 31 * MIN;
    const res = svc.create("g1", "u2", "Bia", "50 cafe 2");
    expect(res.ok && res.rateio.responsibleId).toBe("u2");
    expect(db.get().rateios.map((r) => r.description)).toEqual(["cafe"]);
  });
  it("antes do prazo continua recusando um segundo rateio", () => {
    const { svc, clock } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    clock.t += 29 * MIN;
    expect(svc.create("g1", "u2", "Bia", "50 cafe 2")).toEqual({ ok: false, error: "Já existe um rateio aberto neste chat." });
  });
  it("vencido com pagamento continua preso ao responsável (há dinheiro a devolver)", async () => {
    const { svc, db, clock } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    svc.join("g1", "u2", "Bia");
    await svc.simulatePix("g1", "u2");
    clock.t += 31 * MIN;
    expect(svc.create("g1", "u3", "Caio", "50 cafe 2")).toEqual({ ok: false, error: "Já existe um rateio aberto neste chat." });
    expect(db.get().rateios).toHaveLength(1);
  });
});

describe("prazo em outro dia", () => {
  it("mostra a data quando o prazo não é hoje", async () => {
    const { svc } = setup();
    expect(await say(svc, "/rateio 100 viagem 4 1d")).toMatch(/Pague até \d\d\/\d\d \d\d:\d\d\./);
    expect(await say(svc, "/status")).toMatch(/Prazo: até \d\d\/\d\d \d\d:\d\d\./);
    expect(await say(svc, "/prorrogar 1h")).toMatch(/^Prazo prorrogado: pague até \d\d\/\d\d \d\d:\d\d\.$/);
  });
});

describe("criação com pessoas e prazo", () => {
  it("guarda pessoas e prazo; prazo padrão de 60 min", () => {
    const { svc, clock } = setup();
    const res = svc.create("g1", "u1", "Ana", "120 churrasco 4");
    expect(res.ok && res.rateio.expectedParticipants).toBe(4);
    expect(res.ok && res.rateio.deadline).toBe(clock.t + 60 * MIN);
  });
  it("usa o prazo escolhido", () => {
    const { svc, clock } = setup();
    const res = svc.create("g1", "u1", "Ana", "120 churrasco 4 2h");
    expect(res.ok && res.rateio.deadline).toBe(clock.t + 120 * MIN);
  });
  it("valida pessoas (2 a 50) e prazo (1m a 7d)", () => {
    const { svc } = setup();
    expect(svc.create("g1", "u1", "Ana", "120 x 1")).toEqual({ ok: false, error: "A quantidade de pessoas deve ficar entre 2 e 50." });
    expect(svc.create("g1", "u1", "Ana", "120 x 51")).toMatchObject({ ok: false });
    expect(svc.create("g1", "u1", "Ana", "120 x 2 8d")).toEqual({ ok: false, error: "O prazo deve ficar entre 1m e 7d. Exemplos: 30m, 2h, 1d." });
    expect(svc.create("g1", "u1", "Ana", "120 x 2 7d").ok).toBe(true);
  });
  it("a cota é o total dividido pelas pessoas combinadas, desde o primeiro participante", async () => {
    const { svc } = setup();
    expect(await say(svc, "/rateio 100 pizza 3")).toContain("3 pessoas, ~R$ 33,34 cada");
  });
});

describe("vagas", () => {
  it("recusa quem tenta entrar com o rateio completo, mas aceita quem já entrou", () => {
    const { svc } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 2");
    expect(svc.join("g1", "u2", "Bia").ok).toBe(true);
    expect(svc.join("g1", "u3", "Caio")).toEqual({ ok: false, error: "Este rateio já está completo." });
    expect(svc.join("g1", "u2", "Bia").ok).toBe(true);
  });
  it("não libera enquanto faltar gente entrar, mesmo que quem entrou já tenha pago", async () => {
    const { svc, releases } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 3");
    svc.join("g1", "u2", "Bia");
    await svc.simulatePix("g1", "u1");
    const res = await svc.simulatePix("g1", "u2");
    expect(res.ok && res.progress).toBe("2 de 3 pagaram ✅");
    expect(releases).toEqual([]);
    svc.join("g1", "u3", "Caio");
    const last = await svc.simulatePix("g1", "u3");
    expect(last.ok && last.releaseUrl).toBeDefined();
    expect(releases).toEqual(["u1"]);
  });
  it("/status e /cobrar dizem quantas pessoas faltam entrar", async () => {
    const { svc } = setup();
    await say(svc, "/rateio 100 pizza 3");
    expect(await say(svc, "/status")).toContain("Faltam 2 pessoas entrarem (/participar).");
    await say(svc, "/participar", "u2", "Bia");
    expect(await say(svc, "/cobrar")).toBe(
      "Faltam pagar: Ana (R$ 33,34) e Bia (R$ 33,33). Pague com /simular_pix\nFalta 1 pessoa entrar (/participar).",
    );
  });
});

describe("prazo estourado", () => {
  const expired = async () => {
    const s = setup();
    s.svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    s.svc.join("g1", "u2", "Bia");
    await s.svc.simulatePix("g1", "u2");
    s.clock.t += 31 * MIN;
    return s;
  };

  it("um instante antes do prazo ainda aceita pagamento; no instante do prazo já bloqueia", async () => {
    const { svc, clock } = setup();
    svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    svc.join("g1", "u2", "Bia");
    clock.t += 30 * MIN - 1;
    expect((await svc.simulatePix("g1", "u1")).ok).toBe(true);
    clock.t += 1;
    expect(await svc.simulatePix("g1", "u2")).toEqual({ ok: false, error: EXPIRED_MSG });
  });

  it("bloqueia pagamento e entrada, e o /status avisa", async () => {
    const { svc } = await expired();
    expect(await svc.simulatePix("g1", "u1")).toEqual({ ok: false, error: EXPIRED_MSG });
    expect(svc.join("g1", "u3", "Caio")).toEqual({ ok: false, error: EXPIRED_MSG });
    expect(await say(svc, "/status")).toContain(`⏰ ${EXPIRED_MSG}`);
  });

  it("/prorrogar volta a aceitar pagamentos, a partir de agora", async () => {
    const { svc, clock } = await expired();
    const res = await svc.extend("g1", "u1", "20m");
    expect(res.ok && res.rateio.deadline).toBe(clock.t + 20 * MIN);
    expect((await svc.simulatePix("g1", "u1")).ok).toBe(true);
  });

  it("/prorrogar antes do fim soma ao prazo que resta", async () => {
    const { svc, clock } = setup();
    const created = svc.create("g1", "u1", "Ana", "100 pizza 2 30m");
    const deadline = created.ok ? created.rateio.deadline! : 0;
    clock.t += 10 * MIN;
    const res = await svc.extend("g1", "u1", "1h");
    expect(res.ok && res.rateio.deadline).toBe(deadline + 60 * MIN);
  });

  it("/prorrogar só vale para o responsável e com prazo válido", async () => {
    const { svc } = await expired();
    expect(await say(svc, "/prorrogar 30m", "u2", "Bia")).toBe("Só o responsável pode prorrogar o rateio.");
    expect(await say(svc, "/prorrogar")).toContain("Uso: /prorrogar <prazo>");
    expect(await say(svc, "/prorrogar 30")).toContain("Uso: /prorrogar <prazo>");
    expect(await say(svc, "/prorrogar 8d")).toBe("O prazo deve ficar entre 1m e 7d. Exemplos: 30m, 2h, 1d.");
    expect(await say(svc, "/prorrogar 30m")).toMatch(/^Prazo prorrogado: pague até \d\d:\d\d\.$/);
  });

  it("/cancelar depois do prazo devolve o dinheiro a quem pagou", async () => {
    const { svc, db, refunds } = await expired();
    expect(await say(svc, "/cancelar")).toBe("Rateio cancelado. O dinheiro de 1 pessoa foi devolvido.");
    expect(refunds).toEqual([["u2", 5000]]);
    expect(db.get().rateios).toEqual([]);
  });

  it("rateio antigo, sem prazo nem pessoas, continua como antes", async () => {
    const { svc, db, clock } = setup();
    db.set({ ...db.get(), rateios: [{
      id: "old", chatId: "g1", description: "velho", totalCents: 1000, responsibleId: "u1",
      participants: [{ userId: "u1", name: "Ana", paid: false }], status: "open",
    }] });
    clock.t += 365 * 24 * 60 * MIN;
    const res = await svc.simulatePix("g1", "u1");
    expect(res.ok && res.releaseUrl).toBeDefined();
  });
});
