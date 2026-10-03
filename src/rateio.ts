export type Participant = { userId: string; name: string; paid: boolean };
export type Rateio = {
  id: string; chatId: string; description: string; totalCents: number;
  responsibleId: string; participants: Participant[];
  status: "open" | "released"; releaseSig?: string; // releaseSig = assinatura da tx de liberação
};

const todo = (): never => { throw new Error("não implementado"); };

export const parseAmountToCents = (_text: string): number | null => todo();
export const createRateio = (_a: {
  chatId: string; description: string; totalCents: number; responsibleId: string; responsibleName: string;
}): Rateio => todo();
export const join = (_r: Rateio, _userId: string, _name: string): Rateio => todo();
export const sharesCents = (_r: Rateio): Map<string, number> => todo();
export const markPaid = (_r: Rateio, _userId: string): Rateio => todo();
export const allPaid = (_r: Rateio): boolean => todo();
export const progress = (_r: Rateio): string => todo();
