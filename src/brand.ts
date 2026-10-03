// Identidade visual do CPhix: o Pix move o dinheiro, a Solana faz cumprir as regras.
// Violeta e menta vêm da Solana; a marca é o balão com check da logo do projeto.
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";

export const PALETTE = {
  ink: "#1b1033", violet: "#9945ff", violetDark: "#6d2fc4", violetLogo: "#8b2be2", mint: "#14f195",
  paper: "#fbfaff", muted: "#6b6486", line: "#dcd6ee",
} as const;

// Fonte empacotada: com loadSystemFonts true, o resvg levou ~50 s por imagem no Windows.
const req = createRequire(import.meta.url);
export const FONT_FILES = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf"]
  .map((f) => req.resolve(`dejavu-fonts-ttf/ttf/${f}`));

export const svgToPng = (svg: string, width: number): Buffer =>
  new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "DejaVu Sans" },
  }).render().asPng();

// Ícone da marca: balão de conversa em losango (o bot) com um check violeta (pago). Desenhado numa
// caixa de 100x100 e escalado, para servir tanto no avatar quanto no cabeçalho do comprovante.
export const logoIcon = (x: number, y: number, size: number): string =>
  `<g transform="translate(${x} ${y}) scale(${size / 100})">` +
  `<rect x="19" y="19" width="58" height="58" rx="17" transform="rotate(45 48 48)" fill="none" stroke="${PALETTE.mint}" stroke-width="13"/>` +
  `<path d="M22 66 L40 82 L6 95 Z" fill="${PALETTE.mint}" stroke="${PALETTE.mint}" stroke-width="4" stroke-linejoin="round"/>` +
  `<path d="M25 47 L43 65 L84 17" fill="none" stroke="${PALETTE.violetLogo}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</g>`;

// Foto de perfil do bot: um robô de busto, com a logo no painel do peito. Telegram e WhatsApp
// cortam em círculo, então a cabeça fica no miolo e só os ombros chegam perto da borda.
export const renderAvatarSvg = (): string => {
  const metal = "#f4ecff";
  const shade = "#d9cdf0";
  const screw = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="6" fill="${shade}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" font-family="DejaVu Sans">` +
    `<title>CPhix</title>` +
    `<rect width="640" height="640" fill="${PALETTE.ink}"/>` +
    // antena
    `<rect x="314" y="118" width="12" height="60" rx="6" fill="${shade}"/>` +
    `<circle cx="320" cy="108" r="17" fill="${PALETTE.mint}"/><circle cx="314" cy="102" r="5" fill="${PALETTE.paper}" opacity="0.8"/>` +
    // pescoço articulado e ombros
    `<rect x="288" y="412" width="64" height="76" rx="14" fill="${PALETTE.violetDark}"/>` +
    `<rect x="276" y="428" width="88" height="12" rx="6" fill="${shade}"/><rect x="276" y="450" width="88" height="12" rx="6" fill="${shade}"/>` +
    `<path d="M100 640 C100 534 184 480 320 480 C456 480 540 534 540 640 Z" fill="${PALETTE.violet}"/>` +
    screw(206, 572) + screw(434, 572) +
    // painel do peito com a marca
    `<rect x="248" y="516" width="144" height="104" rx="24" fill="${PALETTE.ink}"/>` +
    logoIcon(278, 528, 84) +
    // cabeça: orelhas-fone, casco e viseira
    `<rect x="146" y="262" width="40" height="96" rx="16" fill="${PALETTE.violet}"/><rect x="454" y="262" width="40" height="96" rx="16" fill="${PALETTE.violet}"/>` +
    `<rect x="176" y="168" width="288" height="256" rx="62" fill="${metal}"/>` +
    screw(212, 202) + screw(428, 202) +
    `<rect x="212" y="226" width="216" height="124" rx="42" fill="${PALETTE.ink}"/>` +
    `<circle cx="274" cy="282" r="20" fill="${PALETTE.mint}"/><circle cx="366" cy="282" r="20" fill="${PALETTE.mint}"/>` +
    `<circle cx="281" cy="275" r="6" fill="${PALETTE.paper}"/><circle cx="373" cy="275" r="6" fill="${PALETTE.paper}"/>` +
    `<path d="M296 322 Q320 340 344 322" fill="none" stroke="${PALETTE.mint}" stroke-width="8" stroke-linecap="round"/>` +
    // grade do alto-falante
    `<rect x="292" y="372" width="10" height="30" rx="5" fill="${PALETTE.violet}"/><rect x="315" y="372" width="10" height="30" rx="5" fill="${PALETTE.violet}"/><rect x="338" y="372" width="10" height="30" rx="5" fill="${PALETTE.violet}"/>` +
    `</svg>`;
};

export const renderAvatarPng = (): Buffer => svgToPng(renderAvatarSvg(), 640);
