// Página de cadastro da carteira com passkey (tarefa 4 de docs/proposta-passkey.md).
// O responsável abre o link que o /carteira mandou no privado, cria ou conecta a carteira no portal do
// LazorKit (a passkey nasce lá, com a biometria) e a página manda só o endereço PÚBLICO ao registerWallet.
// Sem framework e sem build: o servidor é o http do Node, e a página carrega React e LazorKit de uma CDN.
// Bom para o protótipo; em produção a página seria empacotada e servida por HTTPS.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RateioService } from "./service";

const MAX_BODY = 2048;

// O token vai na URL da página: no-referrer impede que o navegador o mande à CDN, e no-store que fique em cache.
const SAFE_HEADERS = {
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const send = (res: ServerResponse, status: number, type: string, body: string) => {
  res.writeHead(status, { ...SAFE_HEADERS, "content-type": type });
  res.end(body);
};
const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

// Lê o corpo com limite de tamanho: devolve null se passar de MAX_BODY. Passado o limite, descarta o resto
// sem derrubar a conexão, para o cliente ainda receber a resposta 413.
const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on("end", () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

export function createWalletServer(svc: RateioService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/carteira") {
        if (req.method !== "GET") return json(res, 405, { error: "Método não permitido." });
        return send(res, 200, "text/html; charset=utf-8", PAGE);
      }

      if (url.pathname === "/api/carteira/link") {
        if (req.method !== "GET") return json(res, 405, { error: "Método não permitido." });
        return json(res, 200, { valid: svc.checkWalletLink(url.searchParams.get("t") ?? "") });
      }

      if (url.pathname === "/api/carteira") {
        if (req.method !== "POST") return json(res, 405, { error: "Método não permitido." });
        const raw = await readBody(req);
        if (raw === null) return json(res, 413, { error: "Pedido grande demais." });
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: "Pedido inválido." });
        }
        const { token, address } = (body ?? {}) as { token?: unknown; address?: unknown };
        if (typeof token !== "string" || typeof address !== "string") {
          return json(res, 400, { error: "Pedido inválido." });
        }
        const result = svc.registerWallet(token, address);
        return result.ok ? json(res, 200, { ok: true }) : json(res, 400, { error: result.error });
      }

      return json(res, 404, { error: "Página não encontrada." });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: "Erro interno." });
    }
  });
}

// Sobe a página junto com o bot. O index.ts (Dev 3) chama isto quando WALLET_PAGE_URL está configurado.
export function startWalletPage(svc: RateioService, port: number): Server {
  const server = createWalletServer(svc);
  server.listen(port, () => console.log(`Página de cadastro da carteira em http://localhost:${port}/carteira`));
  return server;
}

// A página. React e LazorKit vêm do esm.sh com versões fixas; o import map garante um React só.
// keyStorage "memory": a página só precisa do endereço, então não guarda chave nenhuma no navegador.
const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>CPhix: cadastrar carteira</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #f8fafc;
    font-family: system-ui, sans-serif; }
  main { width: min(92vw, 420px); padding: 32px 24px; border-radius: 16px; background: #1e293b; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { color: #cbd5e1; line-height: 1.5; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 10px; background: #14f195; color: #0f172a;
    font-size: 16px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .err { color: #fca5a5; }
  .ok { color: #14f195; }
  code { word-break: break-all; font-size: 12px; color: #94a3b8; }
</style>
<script type="importmap">
{ "imports": {
  "react": "https://esm.sh/react@18.3.1",
  "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1",
  "buffer": "https://esm.sh/buffer@6.0.3"
} }
</script>
</head>
<body>
<main id="app"><p>Carregando...</p></main>
<script type="module">
  // O SDK do LazorKit usa Buffer, que o navegador não tem.
  import { Buffer } from "buffer";
  globalThis.Buffer = Buffer;
  // O js-sha256 (dependência do LazorKit) acha que está no Node, porque a CDN simula o process, e quebra.
  globalThis.JS_SHA256_NO_NODE_JS = true;

  // Tira o token da barra de endereço (print, histórico); ele fica só na memória da página.
  const token = new URLSearchParams(location.search).get("t") || "";
  history.replaceState(null, "", location.pathname);

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LazorkitProvider, useWallet } =
    await import("https://esm.sh/@lazorkit/wallet@3.4.0?deps=react@18.3.1,react-dom@18.3.1");
  const h = React.createElement;

  function Cadastro() {
    const { connect } = useWallet();
    const [state, setState] = React.useState({ step: "checking" });

    React.useEffect(() => {
      if (!token) return setState({ step: "invalid" });
      fetch("/api/carteira/link?t=" + encodeURIComponent(token))
        .then((r) => r.json())
        .then((j) => setState({ step: j.valid ? "ready" : "invalid" }))
        .catch(() => setState({ step: "error", msg: "Não consegui falar com o servidor. Tente de novo." }));
    }, []);

    async function cadastrar() {
      setState({ step: "busy" });
      try {
        const wallet = await connect();
        // vaultPda é o endereço que recebe dinheiro. smartWallet é interno: dinheiro mandado a ele fica preso.
        // Carteiras do protocolo v1 não têm vaultPda: recusar em vez de cair no smartWallet.
        if (!wallet || !wallet.vaultPda) {
          return setState({ step: "error", msg: "Esta carteira é de uma versão antiga do LazorKit. Crie uma carteira nova." });
        }
        const r = await fetch("/api/carteira", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, address: wallet.vaultPda }),
        });
        const j = await r.json();
        if (!r.ok) return setState({ step: "error", msg: j.error });
        setState({ step: "done", address: wallet.vaultPda });
      } catch (e) {
        console.error(e);
        setState({ step: "error", msg: "A biometria foi cancelada ou falhou. Tente de novo." });
      }
    }

    const s = state.step;
    if (s === "checking") return h("p", null, "Conferindo o link...");
    if (s === "invalid") return h("p", { className: "err" }, "Link inválido ou expirado. Envie /carteira de novo no privado comigo.");
    if (s === "done") return h(React.Fragment, null,
      h("p", { className: "ok" }, "Carteira cadastrada!"),
      h("p", null, "Volte ao grupo e mande /liberar para receber o dinheiro."),
      h("code", null, state.address));
    return h(React.Fragment, null,
      h("p", null, "Crie ou conecte sua carteira com a biometria do celular. Ninguém vê sua chave: ela fica no seu aparelho."),
      s === "error" ? h("p", { className: "err" }, state.msg) : null,
      h("button", { onClick: cadastrar, disabled: s === "busy" }, s === "busy" ? "Aguardando a biometria..." : "Cadastrar com biometria"));
  }

  // Configuração explícita e criada uma vez só: sem paymasterConfig, o provider cria um objeto novo a cada
  // renderização e entra em laço (erro React #185). Os valores são os padrões de devnet do próprio SDK.
  const LAZORKIT = {
    cluster: "devnet",
    keyStorage: "memory",
    rpcUrl: "https://api.devnet.solana.com",
    portalUrl: "https://portal.lazor.sh",
    paymasterConfig: { paymasterUrl: "https://kora.devnet.lazorkit.com" },
  };

  createRoot(document.getElementById("app")).render(
    h(LazorkitProvider, LAZORKIT,
      h(React.Fragment, null, h("h1", null, "Cadastrar carteira"), h(Cadastro))));
</script>
</body>
</html>`;
