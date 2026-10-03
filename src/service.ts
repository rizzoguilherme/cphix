// Orquestra o fluxo: regras (rateio.ts), memória (store.ts), cofre (Escrow) e comprovante (ReceiptMaker).
// Não conhece Telegram, WhatsApp nem Solana: só as interfaces, para ser testável com versões falsas.
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import {
  allPaid, createRateio, formatTime, isExpired, isFull, join, markPaid, parseDuration, parseRateioArgs, progress, sharesCents,
  type Rateio,
} from "./rateio";
import { activeRateio, saveRateio, type DB, type JsonStore } from "./store";
import type { Escrow } from "./escrow";
import type { ReceiptMaker } from "./receipt";
import { explorerUrl } from "./solana";

type Err = { ok: false; error: string };
type PayResult =
  | { ok: true; rateio: Rateio; progress: string; releaseUrl?: string; receiptPng?: Buffer; awaitingWallet?: boolean }
  | Err;

// Cofre na rede (docs/proposta-passkey.md): com `open`, o dinheiro fica num cofre que só libera para a
// carteira com passkey do responsável. Sem `open` (o IntermediaryEscrow de hoje), o fluxo não muda.
type VaultEscrow = Escrow & { open?(rateio: Rateio): Promise<string> };

const USAGE =
  "Uso: /rateio <valor> <descrição> [pessoas] [prazo]. Exemplo: /rateio 120 churrasco 4 30m (prazo: 30m, 2h, 1d; padrão 60m)";
const NO_RATEIO = "Nenhum rateio aberto. Use /rateio.";
const DEFAULT_DURATION_MS = 3_600_000; // 60 min
const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 7 * 86_400_000;
const MIN_PEOPLE = 2;
const MAX_PEOPLE = 50;
const DURATION_RANGE = "O prazo deve ficar entre 1m e 7d. Exemplos: 30m, 2h, 1d.";
export const EXPIRED_MSG =
  "O prazo deste rateio acabou. O responsável pode usar /prorrogar <prazo> (ex.: /prorrogar 30m) ou /cancelar (devolve o dinheiro a quem já pagou).";
const MAX_CENTS = 1_000_000; // R$ 10.000,00
const MAX_DESCRIPTION = 60;
const INVALID_LINK = "Link inválido ou expirado. Envie /carteira de novo.";
const LINK_TTL_MS = 15 * 60 * 1000;

// Endereço Solana = 32 bytes em base58. Validar aqui evita liberar para um endereço digitado errado.
const isSolanaAddress = (a: string): boolean => {
  try {
    return bs58.decode(a).length === 32;
  } catch {
    return false;
  }
};

export class RateioService {
  // `now` existe para os testes controlarem o relógio.
  constructor(
    private db: JsonStore<DB>, private escrow: VaultEscrow, private receipt?: ReceiptMaker,
    private now: () => number = Date.now,
  ) {}

  // args = texto depois do comando: "<valor> <descrição> <pessoas> [prazo]".
  create(chatId: string, userId: string, name: string, args: string): { ok: true; rateio: Rateio } | Err {
    const parsed = parseRateioArgs(args);
    if (!parsed) return { ok: false, error: USAGE };
    const { totalCents, description, expected } = parsed;
    const durationMs = parsed.durationMs ?? DEFAULT_DURATION_MS;
    if (expected !== null && (expected < MIN_PEOPLE || expected > MAX_PEOPLE)) {
      return { ok: false, error: `A quantidade de pessoas deve ficar entre ${MIN_PEOPLE} e ${MAX_PEOPLE}.` };
    }
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) return { ok: false, error: DURATION_RANGE };
    // Acima disso a tesouraria de teste pode não ter token, e o erro viraria "Erro ao falar com a Solana".
    if (totalCents > MAX_CENTS) return { ok: false, error: "O valor máximo de um rateio é R$ 10.000,00." };
    // A descrição aparece em /status, /cobrar, /historico e no comprovante: longa demais, quebra tudo.
    // Array.from conta acento e emoji como um caractere.
    if (Array.from(description).length > MAX_DESCRIPTION) {
      return { ok: false, error: `A descrição pode ter no máximo ${MAX_DESCRIPTION} caracteres.` };
    }
    const open = activeRateio(this.db, chatId);
    if (open) {
      // Vencido e sem nenhum pagamento: não há dinheiro a devolver, então não deixa o grupo preso
      // esperando o responsável. O rateio vencido é descartado e o novo toma o lugar.
      if (!(isExpired(open, this.now()) && !open.participants.some((p) => p.paid))) {
        return { ok: false, error: "Já existe um rateio aberto neste chat." };
      }
      const cur = this.db.get();
      this.db.set({ ...cur, rateios: cur.rateios.filter((x) => x.id !== open.id) });
    }
    const rateio = createRateio({
      chatId, description, totalCents, responsibleId: userId, responsibleName: name,
      ...(expected !== null && { expectedParticipants: expected }), deadline: this.now() + durationMs,
    });
    saveRateio(this.db, rateio);
    return { ok: true, rateio };
  }

  join(chatId: string, userId: string, name: string): { ok: true; rateio: Rateio } | Err {
    const cur = activeRateio(this.db, chatId);
    if (!cur) return { ok: false, error: NO_RATEIO };
    if (isExpired(cur, this.now())) return { ok: false, error: EXPIRED_MSG };
    const already = cur.participants.some((p) => p.userId === userId);
    // O cofre na rede guarda a lista de participantes e as cotas: depois de aberto, ninguém novo entra.
    if (!already && (cur.vaultAddress || this.opening.has(cur.id))) {
      return { ok: false, error: "Os pagamentos já começaram. Não dá para entrar neste rateio." };
    }
    if (!already && isFull(cur)) return { ok: false, error: "Este rateio já está completo." };
    const rateio = join(cur, userId, name);
    saveRateio(this.db, rateio);
    return { ok: true, rateio };
  }

  isExpired(r: Rateio): boolean {
    return isExpired(r, this.now());
  }

  // Hora do prazo para mostrar no chat; com a data se não for hoje.
  formatDeadline(ms: number): string {
    return formatTime(ms, this.now());
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

  // Link de cadastro da carteira com passkey: token aleatório, de uso único, que vale 15 minutos.
  // Quem tiver o link cadastra a carteira de quem pediu, por isso ele só é entregue no privado.
  createWalletLink(userId: string): { token: string } {
    const token = randomBytes(24).toString("base64url");
    const cur = this.db.get();
    const now = Date.now();
    const live = Object.fromEntries(Object.entries(cur.walletLinks ?? {}).filter(([, l]) => l.expiresAt > now));
    this.db.set({ ...cur, walletLinks: { ...live, [token]: { userId, expiresAt: now + LINK_TTL_MS } } });
    return { token };
  }

  // A página confere o link antes de abrir a passkey, para avisar logo se ele expirou. Não gasta o link.
  checkWalletLink(token: string): boolean {
    const link = this.db.get().walletLinks?.[token];
    return !!link && link.expiresAt > Date.now();
  }

  // Chamado pela página de cadastro. Guarda só o endereço PÚBLICO: a chave fica no celular da pessoa.
  registerWallet(token: string, address: string): { ok: true; userId: string } | Err {
    const cur = this.db.get();
    const link = cur.walletLinks?.[token];
    if (!link || link.expiresAt <= Date.now()) return { ok: false, error: INVALID_LINK };
    // Endereço inválido não gasta o link: a pessoa pode tentar de novo.
    if (!isSolanaAddress(address)) return { ok: false, error: "Endereço de carteira inválido." };
    const { [token]: _used, ...walletLinks } = cur.walletLinks ?? {};
    this.db.set({ ...cur, walletLinks, addresses: { ...cur.addresses, [link.userId]: address } });
    return { ok: true, userId: link.userId };
  }

  // Pagamentos do mesmo chat rodam em fila: o depósito leva segundos na devnet, e duas chamadas juntas
  // leriam o mesmo rateio, uma apagaria o pagamento da outra e o cofre receberia em dobro.
  private queues = new Map<string, Promise<unknown>>();
  // Rateios cujo cofre está sendo criado agora: a lista de participantes já está congelada.
  private opening = new Set<string>();

  private inQueue<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(chatId) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {}); // um erro não trava a fila do chat
    this.queues.set(chatId, tail);
    void tail.then(() => { if (this.queues.get(chatId) === tail) this.queues.delete(chatId); });
    return run;
  }

  // Só o responsável cancela. Quem já pagou recebe o dinheiro de volta (refund do cofre), um a um.
  // Roda na fila do chat para esperar um pagamento em andamento, senão o depósito ficaria sem registro.
  cancel(chatId: string, userId: string): Promise<{ ok: true; rateio: Rateio; refunded: number } | Err> {
    return this.inQueue(chatId, async () => {
      let r = activeRateio(this.db, chatId);
      if (!r) return { ok: false, error: NO_RATEIO };
      if (r.responsibleId !== userId) return { ok: false, error: "Só o responsável pode cancelar o rateio." };
      const paid = r.participants.filter((p) => p.paid);
      // Rateio antigo, sem número combinado: a cota mudava a cada entrada, então não dá para saber o que devolver.
      if (paid.length > 0 && r.expectedParticipants === undefined) {
        return { ok: false, error: "Já há pagamentos neste rateio; o reembolso ainda não está disponível." };
      }
      const shares = sharesCents(r);
      for (const p of paid) {
        await this.escrow.refund(r.id, p.userId, shares.get(p.userId)!);
        // Marca cada devolução na hora: se uma falhar, o /cancelar seguinte continua de onde parou, sem pagar duas vezes.
        r = { ...r, participants: r.participants.map((x) => (x.userId === p.userId ? { ...x, paid: false } : x)) };
        saveRateio(this.db, r);
      }
      // Apaga em vez de marcar como cancelado: assim o tipo Rateio, que todos usam, não muda.
      const cur = this.db.get();
      this.db.set({ ...cur, rateios: cur.rateios.filter((x) => x.id !== r!.id) });
      return { ok: true, rateio: r, refunded: paid.length };
    });
  }

  // Dá mais tempo ao rateio: soma o prazo ao que resta (ou a partir de agora, se já acabou). Só o responsável.
  extend(chatId: string, userId: string, durationText: string): Promise<{ ok: true; rateio: Rateio } | Err> {
    return this.inQueue(chatId, async () => {
      const r = activeRateio(this.db, chatId);
      if (!r) return { ok: false, error: NO_RATEIO };
      if (r.responsibleId !== userId) return { ok: false, error: "Só o responsável pode prorrogar o rateio." };
      const ms = parseDuration(durationText);
      if (ms === null) return { ok: false, error: "Uso: /prorrogar <prazo>. Exemplos: /prorrogar 30m, /prorrogar 2h" };
      if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) return { ok: false, error: DURATION_RANGE };
      const updated: Rateio = { ...r, deadline: Math.max(r.deadline ?? 0, this.now()) + ms };
      saveRateio(this.db, updated);
      return { ok: true, rateio: updated };
    });
  }

  simulatePix(chatId: string, userId: string): Promise<PayResult> {
    return this.inQueue(chatId, () => this.pay(chatId, userId));
  }

  // /liberar: tenta de novo uma liberação que ficou pendente (carteira cadastrada depois, ou erro de rede).
  release(chatId: string): Promise<PayResult> {
    return this.inQueue(chatId, async () => {
      const r = activeRateio(this.db, chatId);
      if (!r) return { ok: false, error: NO_RATEIO };
      if (!allPaid(r)) return { ok: false, error: `Ainda falta gente pagar: ${progress(r)}` };
      return this.finish(r);
    });
  }

  private async pay(chatId: string, userId: string): Promise<PayResult> {
    let r = activeRateio(this.db, chatId);
    if (!r) return { ok: false, error: NO_RATEIO };
    // Rateio com todos pagos e a liberação pendente (release falhou) continua valendo, mesmo passado o prazo.
    if (isExpired(r, this.now()) && !allPaid(r)) return { ok: false, error: EXPIRED_MSG };
    const me = r.participants.find((p) => p.userId === userId);
    if (!me) return { ok: false, error: "Você não entrou neste rateio. Toque em Participar." };

    // Só deposita quem ainda não pagou: repetir o comando não cobra duas vezes.
    if (!me.paid) {
      // O cofre na rede nasce no primeiro pagamento, com a lista de participantes daquele momento.
      if (this.escrow.open && !r.vaultAddress) {
        // Com número de pessoas combinado (/rateio ... 4), um cofre aberto antes de todos entrarem congelaria
        // a lista incompleta: a última vaga nunca seria preenchida e o dinheiro nunca seria liberado.
        if (r.expectedParticipants !== undefined && !isFull(r)) {
          const n = r.participants.length;
          return { ok: false, error: `Espere todos entrarem antes de pagar: ${n} de ${r.expectedParticipants} entraram.` };
        }
        this.opening.add(r.id);
        try {
          const vaultAddress = await this.escrow.open(r);
          r = { ...(activeRateio(this.db, chatId) ?? r), vaultAddress };
          saveRateio(this.db, r);
        } finally {
          this.opening.delete(r.id);
        }
      }
      await this.escrow.deposit(r.id, sharesCents(r).get(userId)!);
      // Relê depois do depósito: alguém pode ter entrado (/participar) enquanto a devnet respondia.
      r = markPaid(activeRateio(this.db, chatId) ?? r, userId);
      saveRateio(this.db, r);
    }
    if (!allPaid(r)) return { ok: true, rateio: r, progress: progress(r) };
    return this.finish(r);
  }

  // Todos pagaram: libera ao responsável. No modo cofre, só depois que ele cadastrar a carteira com passkey;
  // até lá o dinheiro fica seguro no cofre e /liberar tenta de novo.
  private async finish(r: Rateio): Promise<PayResult> {
    if (this.escrow.open && !this.db.get().addresses?.[r.responsibleId]) {
      return { ok: true, rateio: r, progress: progress(r), awaitingWallet: true };
    }

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
