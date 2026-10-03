// Orquestra o fluxo: regras (rateio.ts), memória (store.ts), cofre (Escrow) e comprovante (ReceiptMaker).
// Não conhece Telegram, WhatsApp nem Solana: só as interfaces, para ser testável com versões falsas.
import { allPaid, createRateio, join, markPaid, parseAmountToCents, progress, sharesCents, type Rateio } from "./rateio";
import { activeRateio, saveRateio, type DB, type JsonStore } from "./store";
import type { Escrow } from "./escrow";
import type { ReceiptMaker } from "./receipt";
import { explorerUrl } from "./solana";

type Err = { ok: false; error: string };

const USAGE = "Uso: /rateio <valor> <descrição>. Exemplo: /rateio 120 churrasco";
const NO_RATEIO = "Nenhum rateio aberto. Use /rateio.";

export class RateioService {
  constructor(private db: JsonStore<DB>, private escrow: Escrow, private receipt?: ReceiptMaker) {}

  // args = texto depois do comando: o primeiro token é o valor, o resto é a descrição.
  create(chatId: string, userId: string, name: string, args: string): { ok: true; rateio: Rateio } | Err {
    const [amount = "", ...rest] = args.trim().split(/\s+/);
    const totalCents = parseAmountToCents(amount);
    const description = rest.join(" ");
    if (totalCents === null || !description) return { ok: false, error: USAGE };
    if (activeRateio(this.db, chatId)) return { ok: false, error: "Já existe um rateio aberto neste chat." };
    const rateio = createRateio({ chatId, description, totalCents, responsibleId: userId, responsibleName: name });
    saveRateio(this.db, rateio);
    return { ok: true, rateio };
  }

  join(chatId: string, userId: string, name: string): { ok: true; rateio: Rateio } | Err {
    const cur = activeRateio(this.db, chatId);
    if (!cur) return { ok: false, error: NO_RATEIO };
    const rateio = join(cur, userId, name);
    saveRateio(this.db, rateio);
    return { ok: true, rateio };
  }

  // Só leitura: quem já pagou e quem falta, para responder "quem pagou?" sem ninguém precisar cobrar.
  status(chatId: string): { ok: true; rateio: Rateio } | Err {
    const rateio = activeRateio(this.db, chatId);
    return rateio ? { ok: true, rateio } : { ok: false, error: NO_RATEIO };
  }

  // Rateios já liberados no chat, do mais recente ao mais antigo (saveRateio grava no fim, então a ordem
  // da lista é a ordem da liberação). Limite de 5 para a mensagem caber na tela do celular.
  history(chatId: string): Rateio[] {
    return this.db.get().rateios
      .filter((r) => r.chatId === chatId && r.status === "released" && r.releaseSig)
      .slice(-5)
      .reverse();
  }

  // Pagamentos do mesmo chat rodam em fila: o depósito leva segundos na devnet, e duas chamadas juntas
  // leriam o mesmo rateio, uma apagaria o pagamento da outra e o cofre receberia em dobro.
  private queues = new Map<string, Promise<unknown>>();

  private inQueue<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(chatId) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {}); // um erro não trava a fila do chat
    this.queues.set(chatId, tail);
    void tail.then(() => { if (this.queues.get(chatId) === tail) this.queues.delete(chatId); });
    return run;
  }

  // Só o responsável cancela, e só antes de qualquer pagamento: o bot ainda não devolve dinheiro (refund).
  // Roda na fila do chat para esperar um pagamento em andamento, senão o depósito ficaria sem registro.
  cancel(chatId: string, userId: string): Promise<{ ok: true; rateio: Rateio } | Err> {
    return this.inQueue(chatId, async () => {
      const r = activeRateio(this.db, chatId);
      if (!r) return { ok: false, error: NO_RATEIO };
      if (r.responsibleId !== userId) return { ok: false, error: "Só o responsável pode cancelar o rateio." };
      if (r.participants.some((p) => p.paid)) {
        return { ok: false, error: "Já há pagamentos neste rateio; o reembolso ainda não está disponível." };
      }
      // Apaga em vez de marcar como cancelado: assim o tipo Rateio, que todos usam, não muda.
      const cur = this.db.get();
      this.db.set({ ...cur, rateios: cur.rateios.filter((x) => x.id !== r.id) });
      return { ok: true, rateio: r };
    });
  }

  simulatePix(
    chatId: string, userId: string,
  ): Promise<{ ok: true; rateio: Rateio; progress: string; releaseUrl?: string; receiptPng?: Buffer } | Err> {
    return this.inQueue(chatId, () => this.pay(chatId, userId));
  }

  private async pay(
    chatId: string, userId: string,
  ): Promise<{ ok: true; rateio: Rateio; progress: string; releaseUrl?: string; receiptPng?: Buffer } | Err> {
    let r = activeRateio(this.db, chatId);
    if (!r) return { ok: false, error: NO_RATEIO };
    const me = r.participants.find((p) => p.userId === userId);
    if (!me) return { ok: false, error: "Você não entrou neste rateio. Toque em Participar." };

    // Só deposita quem ainda não pagou: repetir o comando não cobra duas vezes.
    if (!me.paid) {
      await this.escrow.deposit(r.id, sharesCents(r).get(userId)!);
      // Relê depois do depósito: alguém pode ter entrado (/participar) enquanto a devnet respondia.
      r = markPaid(activeRateio(this.db, chatId) ?? r, userId);
      saveRateio(this.db, r);
    }
    if (!allPaid(r)) return { ok: true, rateio: r, progress: progress(r) };

    // Se release lançar, o rateio continua aberto com todos pagos e a próxima chamada tenta de novo.
    const sig = await this.escrow.release(r.id, r.responsibleId);
    const released: Rateio = { ...r, status: "released", releaseSig: sig };
    saveRateio(this.db, released);

    // O comprovante é um extra: a liberação já aconteceu e nunca falha por causa dele.
    let receiptPng: Buffer | undefined;
    try {
      receiptPng = (await this.receipt?.(released, sig)) ?? undefined;
    } catch (e) {
      console.error(e);
    }
    return { ok: true, rateio: released, progress: progress(released), releaseUrl: explorerUrl(sig), receiptPng };
  }
}
