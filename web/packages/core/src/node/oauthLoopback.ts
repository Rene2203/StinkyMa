import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  OAuthError,
  type OAuthClient,
  type OAuthProviderConfig,
  type OAuthTokens,
} from "../oauth.js";

// Rückleitung der Browser-Anmeldung (RFC 8252, „Loopback“): ein kurzlebiger HTTP-Server nur auf diesem Rechner nimmt den
// Code entgegen. Er prüft den `state` (gegen untergeschobene Anmeldungen) und beendet sich danach sofort.

const page = (title: string, text: string) =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>StinkyMa</title>
<style>body{font-family:"Segoe UI",system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f7;color:#1b1b1b}
main{background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-width:420px}h1{font-size:20px;margin:0 0 8px}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

async function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export interface LoopbackSignInOptions {
  provider: OAuthProviderConfig;
  client: OAuthClient;
  /** Öffnet die Anmeldeseite im Standardbrowser (Electron: shell.openExternal). */
  openBrowser: (url: string) => Promise<void> | void;
  loginHint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Komplette Anmeldung: Browser öffnen, Rückleitung abwarten, Code gegen Tokens tauschen. */
export async function signInWithLoopback(options: LoopbackSignInOptions): Promise<OAuthTokens & { email: string | null }> {
  const pkce = await createPkce();
  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Ablehnung (Zeitlimit, Abbruch) kann vor dem Warten kommen – nicht als „unbehandelt“ melden
  codePromise.catch(() => undefined);

  const handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== pkce.state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("Anmeldung abgelehnt", "Die Antwort passt nicht zu dieser Anmeldung. Bitte in StinkyMa erneut starten."));
      return;
    }
    if (error || !code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Anmeldung abgebrochen", "Du kannst dieses Fenster schließen."));
      rejectCode(new OAuthError(error === "access_denied" ? "Anmeldung abgebrochen." : `Anmeldung fehlgeschlagen (${error ?? "kein Code"}).`));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Anmeldung abgeschlossen", "Du kannst dieses Fenster schließen und zu StinkyMa zurückkehren."));
    resolveCode(code);
  };

  // IPv4 und (für „localhost“) IPv6 auf demselben Port – nie auf allen Netzwerkkarten
  const v4 = createServer(handler);
  const v6 = createServer(handler);
  const port = await listen(v4, "127.0.0.1", 0);
  await listen(v6, "::1", port).catch(() => undefined);
  const redirectUri = `http://${options.provider.redirectHost}:${port}/callback`;

  const timer = setTimeout(() => rejectCode(new OAuthError("Die Anmeldung hat zu lange gedauert. Bitte erneut versuchen.")), options.timeoutMs ?? 5 * 60_000);
  const onAbort = () => rejectCode(new OAuthError("Anmeldung abgebrochen."));
  options.signal?.addEventListener("abort", onAbort);
  try {
    await options.openBrowser(authorizeUrl(options.provider, options.client, { redirectUri, challenge: pkce.challenge, state: pkce.state, loginHint: options.loginHint }));
    const code = await codePromise;
    return await exchangeCode(options.provider, options.client, { code, verifier: pkce.verifier, redirectUri, fetchImpl: options.fetchImpl });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    v4.close();
    v6.close();
    v4.closeAllConnections?.();
    v6.closeAllConnections?.();
  }
}
