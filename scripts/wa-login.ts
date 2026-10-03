// Login do WhatsApp com o QR code numa página HTML (o QR do terminal é pequeno e expira rápido).
// Uso: npx tsx scripts/wa-login.ts  -> abre data/wa-qr.html, escaneie, e a sessão fica salva em WA_AUTH_DIR.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import { config } from "../src/config";

const req = createRequire(import.meta.url);
const QRCode = req("qrcode-terminal/vendor/QRCode");
const QRErrorCorrectLevel = req("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");

const HTML_PATH = `${config.dataDir}/wa-qr.html`;

// Desenha o QR como SVG: cada módulo escuro vira um quadrado.
const toSvg = (text: string): string => {
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(text);
  qr.make();
  const n: number = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" ` +
    `style="width:min(90vw,90vh);height:min(90vw,90vh);background:#fff"><rect width="${size}" height="${size}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g></svg>`;
};

const page = (body: string, refresh = true) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">${refresh ? '<meta http-equiv="refresh" content="3">' : ""}` +
  `<title>CPhix: QR do WhatsApp</title></head><body style="margin:0;display:flex;flex-direction:column;` +
  `align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#f1f5f9">${body}</body></html>`;

mkdirSync(config.dataDir, { recursive: true });
writeFileSync(HTML_PATH, page("<h2>Aguardando o QR code...</h2>"));
exec(`start "" "${HTML_PATH}"`);

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.waAuthDir);
  const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      writeFileSync(HTML_PATH, page(
        `<h2>WhatsApp: Aparelhos conectados > Conectar um aparelho</h2>${toSvg(qr)}` +
        `<p>O QR muda a cada ~20 s; a página atualiza sozinha.</p>`,
      ));
      console.log("QR atualizado em", HTML_PATH);
    }
    if (connection === "open") {
      writeFileSync(HTML_PATH, page("<h1>Conectado! Pode fechar esta página.</h1>", false));
      console.log("WhatsApp conectado. Sessão salva em", config.waAuthDir);
      setTimeout(() => process.exit(0), 3000); // dá tempo de gravar as credenciais
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log(`Sessão recusada. Apague a pasta ${config.waAuthDir} e rode de novo.`);
        process.exit(1);
      }
      // Logo após ler o QR o WhatsApp pede para reconectar (restartRequired): é esperado.
      console.log(`Conexão encerrada (código ${code ?? "desconhecido"}). Reconectando...`);
      setTimeout(() => { void connect(); }, 1000);
    }
  });
}

await connect();
