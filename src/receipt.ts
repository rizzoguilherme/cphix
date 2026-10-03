import type { Rateio } from "./rateio";
import { PALETTE as C, logoIcon, svgToPng } from "./brand";
import { fetchTxDetails, type TxDetails, type TxSource } from "./txDetails";

export type ReceiptCard = {
  description: string; totalBrl: string; participants: number; responsibleName: string;
  amountBrl: string; fromAddr: string; toAddr: string; feeSol: string; when: string; signature: string;
};

// Quem gera o comprovante de uma liberação. Devolve null se não achou a transação na rede.
export type ReceiptMaker = (rateio: Rateio, signature: string) => Promise<Buffer | null>;

// Formatador próprio: não importamos commands.ts para não acoplar o comprovante aos comandos.
const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

const shorten = (s: string, head = 4, tail = 4) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

export const buildReceiptCard = (r: Rateio, d: TxDetails, brlPerToken: number): ReceiptCard => {
  // Inversa de centsToTokenUnits: unidades do token (6 casas) -> centavos de real.
  const cents = Math.round((Number(d.tokenUnits) * brlPerToken) / 1e4);
  return {
    description: r.description,
    totalBrl: brl(r.totalCents),
    participants: r.participants.length,
    responsibleName: r.participants.find((p) => p.userId === r.responsibleId)?.name ?? "Responsável",
    amountBrl: brl(cents),
    fromAddr: shorten(d.fromOwner),
    toAddr: shorten(d.toOwner),
    feeSol: `${(d.feeLamports / 1e9).toFixed(6)} SOL`,
    when: d.blockTime
      ? new Date(d.blockTime * 1000).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
      })
      : "—",
    signature: shorten(d.signature, 8, 8),
  };
};

// Nomes digitados por usuários entram num XML: o render não tem fonte de emoji e controles quebram o XML.
const UNSAFE = /[\p{Extended_Pictographic}‍️\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/gu;
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const clean = (text: string, max = 40): string => {
  const t = text.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  // Array.from não quebra caractere especial no meio.
  const chars = Array.from(t);
  const cut = chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : t;
  return cut.replace(/[&<>"']/g, (c) => ESCAPES[c]);
};

// Anel com um segmento por participante, todos preenchidos: "todo mundo pagou" sem precisar de texto.
const ring = (cx: number, cy: number, r: number, n: number): string => {
  const count = Math.min(Math.max(n, 1), 24);
  const step = 360 / count;
  const gap = count === 1 ? 0 : Math.min(8, step / 3);
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${Math.round((cx + Math.cos(a) * r) * 100) / 100} ${Math.round((cy + Math.sin(a) * r) * 100) / 100}`;
  };
  let out = "";
  for (let i = 0; i < count; i++) {
    const a0 = i * step + gap / 2;
    const a1 = (i + 1) * step - gap / 2 - (count === 1 ? 0.1 : 0);
    out += `<path d="M${pt(a0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1)}" fill="none" stroke="${C.violet}" stroke-width="16"/>`;
  }
  return out;
};

// Borda serrilhada de cupom: dentes de 16 px na base.
const ticketPath = (x0: number, x1: number, y0: number, y1: number): string => {
  const teeth = Math.floor((x1 - x0) / 16);
  let d = `M${x0} ${y0} H${x1} V${y1}`;
  for (let k = 0; k < teeth; k++) d += ` L${x1 - 16 * k - 8} ${y1 + 10} L${x1 - 16 * (k + 1)} ${y1}`;
  return `${d} Z`;
};

export const renderReceiptSvg = (c: ReceiptCard): string => {
  const rows: [string, string, boolean?][] = [
    ["Rateio", clean(c.description, 26)],
    ["Total do rateio", clean(c.totalBrl)],
    ["Participantes", String(c.participants)],
    ["Origem (cofre)", clean(c.fromAddr), true],
    ["Destino", clean(c.toAddr), true],
    ["Taxa de rede", clean(c.feeSol)],
    ["Data", clean(c.when)],
    ["Rede", "Solana Devnet"],
  ];
  const lines = rows.map(([label, value, mono], i) => {
    const y = 584 + i * 47;
    return `<text x="96" y="${y}" font-size="20" fill="${C.muted}">${label}</text>` +
      `<text x="704" y="${y}" font-size="${mono ? 20 : 22}" fill="${C.ink}" text-anchor="end"${mono ? ' font-family="DejaVu Sans Mono"' : ""}>${value}</text>`;
  }).join("");
  const dash = (y: number) =>
    `<line x1="72" y1="${y}" x2="728" y2="${y}" stroke="${C.line}" stroke-width="3" stroke-dasharray="9 7"/>`;
  // Furos nas laterais, como num cupom destacado.
  const notch = (y: number) =>
    `<circle cx="48" cy="${y}" r="15" fill="${C.ink}"/><circle cx="752" cy="${y}" r="15" fill="${C.ink}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1080" viewBox="0 0 800 1080" font-family="DejaVu Sans">` +
    `<rect width="800" height="1080" fill="${C.ink}"/>` +
    `<path d="${ticketPath(48, 752, 36, 1034)}" fill="${C.paper}"/>` +
    // Faixa escura com a logo completa: o menta só tem contraste sobre a tinta.
    `<path d="M48 36 H752 V132 H48 Z" fill="${C.ink}"/>` +
    logoIcon(261, 52, 64) +
    `<text x="337" y="104" font-size="52" font-weight="bold" fill="${C.mint}">CPHIX</text>` +
    `<rect x="592" y="66" width="112" height="36" rx="18" fill="none" stroke="${C.mint}" stroke-width="2"/>` +
    `<text x="648" y="90" font-size="17" fill="${C.mint}" text-anchor="middle">Devnet</text>` +
    `<text x="400" y="166" font-size="20" fill="${C.muted}" text-anchor="middle">Comprovante de liberação</text>` +
    ring(400, 274, 84, c.participants) +
    `<circle cx="400" cy="274" r="50" fill="${C.mint}"/>` +
    `<path d="M376 275 l17 17 l32 -36" fill="none" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="400" y="454" font-size="76" font-weight="bold" fill="${C.ink}" text-anchor="middle">${clean(c.amountBrl)}</text>` +
    `<text x="400" y="494" font-size="24" fill="${C.muted}" text-anchor="middle">liberado para ${clean(c.responsibleName, 22)}</text>` +
    dash(530) + notch(530) +
    lines +
    dash(950) + notch(950) +
    `<text x="400" y="984" font-size="17" fill="${C.muted}" text-anchor="middle" font-family="DejaVu Sans Mono">${clean(c.signature)}</text>` +
    `<text x="400" y="1010" font-size="16" fill="${C.muted}" text-anchor="middle">Confira no Solana Explorer</text>` +
    `</svg>`;
};

export const renderReceiptPng = (c: ReceiptCard): Buffer => svgToPng(renderReceiptSvg(c), 800);

// Liga tudo: busca a transação, monta o cartão e devolve o PNG (ou null se a rede não a achou).
export const makeReceiptMaker = (
  conn: TxSource, mint: string, brlPerToken: number, opts?: { attempts?: number; delayMs?: number },
): ReceiptMaker => async (rateio, signature) => {
  const details = await fetchTxDetails(conn, signature, mint, opts);
  if (!details) return null;
  return renderReceiptPng(buildReceiptCard(rateio, details, brlPerToken));
};
