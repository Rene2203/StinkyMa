import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeUrl,
  createPkce,
  emailFromIdToken,
  exchangeCode,
  OAuthError,
  oauthProviders,
  parseStoredOAuth,
  refreshTokens,
  tokenNeedsRefresh,
  type OAuthProviderConfig,
} from "../src/index.js";
import { signInWithLoopback } from "../src/node/index.js";

// Erfundener Anbieter auf 127.0.0.1 – spielt Anmeldeseite und Token-Endpunkt von Google/Microsoft nach.

const idToken = (claims: Record<string, unknown>) => `kopf.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signatur`;

let server: Server;
let base = "";
const issued = new Map<string, { challenge: string; redirectUri: string }>();
let tokenRequests: URLSearchParams[] = [];
let refreshMode: "ok" | "rotate" | "revoked" = "ok";
let authorizeMode: "ok" | "deny" | "wrongState" = "ok";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      const state = authorizeMode === "wrongState" ? "falsch" : (url.searchParams.get("state") ?? "");
      if (authorizeMode === "deny") {
        redirect.search = new URLSearchParams({ error: "access_denied", state }).toString();
      } else {
        const code = `code-${issued.size + 1}`;
        issued.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", redirectUri: url.searchParams.get("redirect_uri") ?? "" });
        redirect.search = new URLSearchParams({ code, state }).toString();
      }
      res.writeHead(302, { Location: redirect.toString() }).end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        tokenRequests.push(params);
        const json = (status: number, value: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
        if (params.get("grant_type") === "authorization_code") {
          const entry = issued.get(params.get("code") ?? "");
          const verifier = params.get("code_verifier") ?? "";
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!entry || entry.challenge !== challenge || entry.redirectUri !== params.get("redirect_uri")) {
            json(400, { error: "invalid_grant", error_description: "geheime Details" });
            return;
          }
          json(200, { access_token: "zugriff-1", refresh_token: "dauer-1", expires_in: 3600, id_token: idToken({ email: "Anna@Beispiel.example" }) });
          return;
        }
        if (refreshMode === "revoked") json(400, { error: "invalid_grant", error_description: "Token wurde widerrufen" });
        else json(200, { access_token: "zugriff-2", expires_in: 3600, ...(refreshMode === "rotate" ? { refresh_token: "dauer-2" } : {}) });
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const provider = (): OAuthProviderConfig => ({ ...oauthProviders.google, authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token` });
const client = { clientId: "app-123", clientSecret: "nicht-geheim" };
/** „Browser“: folgt der Weiterleitung der Anmeldeseite zur Loopback-Adresse der App. */
const browser = async (url: string) => {
  await fetch(url, { redirect: "follow" });
};

describe("OAuth – Bausteine", () => {
  it("PKCE: Prüfwert und SHA-256-Challenge (base64url), zufälliger state", async () => {
    const a = await createPkce();
    const b = await createPkce();
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.state).not.toBe(b.state);
  });

  it("Anmeldeseite mit allen Parametern – Google offline, Microsoft mit „localhost“", () => {
    const url = new URL(authorizeUrl(oauthProviders.google, client, { redirectUri: "http://127.0.0.1:5/callback", challenge: "c", state: "s", loginHint: "anna@beispiel.example" }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "app-123", response_type: "code", code_challenge: "c", code_challenge_method: "S256", state: "s",
      access_type: "offline", prompt: "consent", login_hint: "anna@beispiel.example", scope: "openid email https://mail.google.com/",
    });
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(oauthProviders.microsoft.redirectHost).toBe("localhost");
    expect(oauthProviders.microsoft.scopes).toContain("offline_access");
  });

  it("liest die Adresse aus dem ID-Token (Google: email, Microsoft: preferred_username)", () => {
    expect(emailFromIdToken(idToken({ email: "Anna@Beispiel.example" }))).toBe("anna@beispiel.example");
    expect(emailFromIdToken(idToken({ preferred_username: "max@outlook.example" }))).toBe("max@outlook.example");
    expect(emailFromIdToken(idToken({ name: "ohne Adresse" }))).toBeNull();
    expect(emailFromIdToken("kaputt")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });

  it("gespeicherte Tokens: tolerant lesen, rechtzeitig erneuern", () => {
    const stored = { provider: "google", accessToken: "a", refreshToken: "r", expiresAt: "2026-10-01T10:00:00.000Z" };
    expect(parseStoredOAuth(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredOAuth("{kaputt")).toBeNull();
    expect(parseStoredOAuth(JSON.stringify({ ...stored, provider: "yahoo" }))).toBeNull();
    expect(tokenNeedsRefresh(stored, new Date("2026-10-01T09:50:00Z"))).toBe(false);
    expect(tokenNeedsRefresh(stored, new Date("2026-10-01T09:59:00Z"))).toBe(true);
  });
});

describe("OAuth – Anmeldung über Loopback", () => {
  it("komplette Anmeldung: Browser, Rückleitung, Code-Tausch mit PKCE", async () => {
    authorizeMode = "ok";
    tokenRequests = [];
    const result = await signInWithLoopback({ provider: provider(), client, openBrowser: browser });
    expect(result).toMatchObject({ accessToken: "zugriff-1", refreshToken: "dauer-1", email: "anna@beispiel.example" });
    const exchange = tokenRequests[0];
    expect(exchange?.get("client_secret")).toBe("nicht-geheim");
    expect(exchange?.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it("lehnt eine Rückleitung mit falschem state ab (wartet weiter, dann Zeitlimit)", async () => {
    authorizeMode = "wrongState";
    await expect(signInWithLoopback({ provider: provider(), client, openBrowser: browser, timeoutMs: 400 })).rejects.toThrow(/zu lange/);
  });

  it("meldet Abbruch durch den Nutzer", async () => {
    authorizeMode = "deny";
    await expect(signInWithLoopback({ provider: provider(), client, openBrowser: browser })).rejects.toThrow("Anmeldung abgebrochen.");
  });

  it("lässt sich abbrechen", async () => {
    const controller = new AbortController();
    const running = signInWithLoopback({ provider: provider(), client, openBrowser: () => controller.abort(), signal: controller.signal });
    await expect(running).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("OAuth – Tokens erneuern", () => {
  it("behält das Refresh-Token, wenn keins mitkommt (Google), ersetzt es bei Rotation (Microsoft)", async () => {
    refreshMode = "ok";
    expect(await refreshTokens(provider(), client, "dauer-1")).toMatchObject({ accessToken: "zugriff-2", refreshToken: "dauer-1" });
    refreshMode = "rotate";
    expect(await refreshTokens(provider(), client, "dauer-1")).toMatchObject({ refreshToken: "dauer-2" });
  });

  it("widerrufen: verständlicher Hinweis zum Neu-Anmelden, ohne Details des Anbieters", async () => {
    refreshMode = "revoked";
    const error = await refreshTokens(provider(), client, "dauer-1").catch((e: OAuthError) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).needsReauth).toBe(true);
    expect(String(error)).toMatch(/erneut anmelden/);
    expect(String(error)).not.toMatch(/widerrufen\b.*Token wurde/);
  });

  it("lehnt einen falschen PKCE-Prüfwert ab", async () => {
    await expect(exchangeCode(provider(), client, { code: "code-1", verifier: "falsch", redirectUri: "http://127.0.0.1:1/callback" })).rejects.toBeInstanceOf(OAuthError);
  });
});
