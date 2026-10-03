// Regras puras da conta dividida: sem rede nem disco, e cada função devolve um objeto novo.
import { randomUUID } from "node:crypto";

export type Participant = { userId: string; name: string; paid: boolean };
export type Rateio = {
  id: string; chatId: string; description: string; totalCents: number;
  responsibleId: string; participants: Participant[];
  status: "open" | "released"; releaseSig?: string; // releaseSig = assinatura da tx de liberação
  vaultAddress?: string; // endereço do cofre na rede, quando o Escrow cria um (open); qualquer um confere
};

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
}): Rateio => ({
  id: randomUUID().slice(0, 8),
  chatId: a.chatId,
  description: a.description,
  totalCents: a.totalCents,
  responsibleId: a.responsibleId,
  participants: [{ userId: a.responsibleId, name: a.responsibleName, paid: false }],
  status: "open",
});

export const join = (r: Rateio, userId: string, name: string): Rateio =>
  r.participants.some((p) => p.userId === userId)
    ? r
    : { ...r, participants: [...r.participants, { userId, name, paid: false }] };

// Divisão igual que fecha no total: os centavos que sobram vão, um a um, para os primeiros.
export const sharesCents = (r: Rateio): Map<string, number> => {
  const n = r.participants.length;
  const base = Math.floor(r.totalCents / n);
  const extra = r.totalCents - base * n;
  return new Map(r.participants.map((p, i) => [p.userId, base + (i < extra ? 1 : 0)]));
};

export const markPaid = (r: Rateio, userId: string): Rateio => {
  if (!r.participants.some((p) => p.userId === userId)) throw new Error("not_participant");
  return { ...r, participants: r.participants.map((p) => (p.userId === userId ? { ...p, paid: true } : p)) };
};

export const allPaid = (r: Rateio): boolean => r.participants.every((p) => p.paid);

export const progress = (r: Rateio): string =>
  `${r.participants.filter((p) => p.paid).length} de ${r.participants.length} pagaram ✅`;
