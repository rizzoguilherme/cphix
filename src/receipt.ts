import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import type { Rateio } from "./rateio";
import { fetchTxDetails, type TxDetails, type TxSource } from "./txDetails";

export type ReceiptCard = {
  description: string; totalBrl: string; participants: number; responsibleName: string;
  amountBrl: string; fromAddr: string; toAddr: string; feeSol: string; when: string; signature: string;
};

// Quem gera o comprovante de uma liberação. Devolve null se não achou a transação na rede.
export type ReceiptMaker = (rateio: Rateio, signature: string) => Promise<Buffer | null>;

// Fonte empacotada: com loadSystemFonts true, o resvg levou ~50 s por imagem no Windows.
const req = createRequire(import.meta.url);
const FONT_FILES = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((f) => req.resolve(`dejavu-fonts-ttf/ttf/${f}`));

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

export const renderReceiptSvg = (c: ReceiptCard): string => {
  const rows: [string, string][] = [
    ["Rateio", clean(c.description, 26)],
    ["Total do rateio", clean(c.totalBrl)],
    ["Participantes", String(c.participants)],
    ["Liberado para", clean(c.responsibleName, 22)],
    ["Origem (cofre)", clean(c.fromAddr)],
    ["Destino", clean(c.toAddr)],
    ["Taxa de rede", clean(c.feeSol)],
    ["Data", clean(c.when)],
    ["Rede", "Solana Devnet"],
  ];
  const lines = rows.map(([label, value], i) => {
    const y = 540 + i * 52;
    return `<text x="64" y="${y}" font-size="22" fill="#94a3b8">${label}</text>` +
      `<text x="736" y="${y}" font-size="24" fill="#f1f5f9" text-anchor="end">${value}</text>` +
      `<line x1="64" y1="${y + 18}" x2="736" y2="${y + 18}" stroke="#1e293b" stroke-width="2"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1080" viewBox="0 0 800 1080" font-family="DejaVu Sans">` +
    `<rect width="800" height="1080" fill="#0f172a"/>` +
    `<rect x="0" y="0" width="800" height="12" fill="#14f195"/>` +
    `<text x="400" y="96" font-size="44" font-weight="bold" fill="#f8fafc" text-anchor="middle">CPhix</text>` +
    `<text x="400" y="136" font-size="24" fill="#94a3b8" text-anchor="middle">Comprovante de liberação</text>` +
    `<circle cx="400" cy="236" r="48" fill="#14f195"/>` +
    `<path d="M376 238 l17 17 l32 -36" fill="none" stroke="#0f172a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="400" y="332" font-size="28" font-weight="bold" fill="#14f195" text-anchor="middle">Confirmado na Solana</text>` +
    `<text x="400" y="414" font-size="68" font-weight="bold" fill="#f8fafc" text-anchor="middle">${clean(c.amountBrl)}</text>` +
    `<text x="400" y="456" font-size="22" fill="#94a3b8" text-anchor="middle">liberado ao responsável</text>` +
    lines +
    `<text x="400" y="1030" font-size="20" fill="#64748b" text-anchor="middle">Assinatura ${clean(c.signature)}</text>` +
    `<text x="400" y="1058" font-size="18" fill="#475569" text-anchor="middle">Confira no Solana Explorer</text>` +
    `</svg>`;
};

export const renderReceiptPng = (c: ReceiptCard): Buffer => {
  const resvg = new Resvg(renderReceiptSvg(c), {
    fitTo: { mode: "width", value: 800 },
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
};

// Liga tudo: busca a transação, monta o cartão e devolve o PNG (ou null se a rede não a achou).
export const makeReceiptMaker = (
  conn: TxSource, mint: string, brlPerToken: number, opts?: { attempts?: number; delayMs?: number },
): ReceiptMaker => async (rateio, signature) => {
  const details = await fetchTxDetails(conn, signature, mint, opts);
  if (!details) return null;
  return renderReceiptPng(buildReceiptCard(rateio, details, brlPerToken));
};
