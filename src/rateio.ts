// Regras puras da conta dividida: sem rede nem disco, e cada função devolve um objeto novo.
import { randomUUID } from "node:crypto";

export type Participant = { userId: string; name: string; paid: boolean };
export type Rateio = {
  id: string; chatId: string; description: string; totalCents: number;
  responsibleId: string; participants: Participant[];
  status: "open" | "released"; releaseSig?: string; // releaseSig = assinatura da tx de liberação
  // Opcionais: rateios antigos (sem estes campos) seguem como antes, sem limite de pessoas nem prazo.
  expectedParticipants?: number; // quantas pessoas dividem a conta; a cota é total / isto
  deadline?: number; // instante (ms desde 1970) em que o prazo de pagamento acaba
};

const UNIT_MS = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// "30m", "2h", "1d" -> milissegundos. Sem a unidade não é prazo: "30" sozinho pode ser a quantidade de pessoas.
export const parseDuration = (text: string): number | null => {
  const m = /^(\d+)(m|min|h|d)$/i.exec(text.trim());
  if (!m) return null;
  const ms = Number(m[1]) * UNIT_MS[m[2].toLowerCase() as keyof typeof UNIT_MS];
  return ms > 0 ? ms : null;
};

// "<valor> <descrição> <pessoas> [prazo]". Lê do fim: o prazo (se houver, com unidade), depois as pessoas,
// e o que sobra é a descrição, que pode conter números ("pizza 2 queijos").
export const parseRateioArgs = (args: string): {
  totalCents: number; description: string; expected: number; durationMs: number | null;
} | null => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const totalCents = parseAmountToCents(tokens.shift() ?? "");
  if (totalCents === null) return null;
  let durationMs: number | null = null;
  if (tokens.length > 0) {
    durationMs = parseDuration(tokens[tokens.length - 1]);
    if (durationMs !== null) tokens.pop();
  }
  const last = tokens.pop() ?? "";
  if (!/^\d+$/.test(last)) return null;
  const description = tokens.join(" ");
  if (!description) return null;
  return { totalCents, description, expected: Number(last), durationMs };
};

// "20:35" no fuso do Brasil: é o horário que as pessoas do grupo enxergam.
export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export const isExpired = (r: Rateio, now: number): boolean => r.deadline !== undefined && now >= r.deadline;

// Aceita "120", "120,50", "120.5" e o formato brasileiro "1.000,50". No máximo 2 casas, para não haver
// fração de centavo. O ponto de milhar só vale junto com a vírgula: "12.345" sozinho é ambíguo e é recusado.
export const parseAmountToCents = (text: string): number | null => {
  let t = text.trim();
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents > 0 ? cents : null;
};

// Quem cria é o responsável e também paga a sua parte, por isso entra como primeiro participante.
export const createRateio = (a: {
  chatId: string; description: string; totalCents: number; responsibleId: string; responsibleName: string;
  expectedParticipants?: number; deadline?: number;
}): Rateio => ({
  id: randomUUID().slice(0, 8),
  chatId: a.chatId,
  description: a.description,
  totalCents: a.totalCents,
  responsibleId: a.responsibleId,
  participants: [{ userId: a.responsibleId, name: a.responsibleName, paid: false }],
  status: "open",
  ...(a.expectedParticipants !== undefined && { expectedParticipants: a.expectedParticipants }),
  ...(a.deadline !== undefined && { deadline: a.deadline }),
});

// Quantas pessoas dividem a conta: o combinado na criação, ou (rateio antigo) quem já entrou.
export const splitCount = (r: Rateio): number => r.expectedParticipants ?? r.participants.length;

export const isFull = (r: Rateio): boolean =>
  r.expectedParticipants !== undefined && r.participants.length >= r.expectedParticipants;

export const join = (r: Rateio, userId: string, name: string): Rateio =>
  r.participants.some((p) => p.userId === userId)
    ? r
    : { ...r, participants: [...r.participants, { userId, name, paid: false }] };

// Divisão igual que fecha no total: os centavos que sobram vão, um a um, para os primeiros.
export const sharesCents = (r: Rateio): Map<string, number> => {
  const n = splitCount(r);
  const base = Math.floor(r.totalCents / n);
  const extra = r.totalCents - base * n;
  return new Map(r.participants.map((p, i) => [p.userId, base + (i < extra ? 1 : 0)]));
};

export const markPaid = (r: Rateio, userId: string): Rateio => {
  if (!r.participants.some((p) => p.userId === userId)) throw new Error("not_participant");
  return { ...r, participants: r.participants.map((p) => (p.userId === userId ? { ...p, paid: true } : p)) };
};

// Com número combinado, só fecha quando todas as vagas foram preenchidas e pagas.
export const allPaid = (r: Rateio): boolean =>
  r.participants.length >= splitCount(r) && r.participants.every((p) => p.paid);

export const progress = (r: Rateio): string =>
  `${r.participants.filter((p) => p.paid).length} de ${splitCount(r)} pagaram ✅`;
