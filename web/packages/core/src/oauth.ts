// OAuth 2.0 für Mailkonten (Gmail, Outlook): Anmeldung im Browser mit PKCE, danach IMAP/SMTP per XOAUTH2.
// Plattformneutral (fetch + Web Crypto). Die Rückleitung (Loopback auf 127.0.0.1) baut die jeweilige Plattform.
// Tokens werden nie geloggt und liegen nur im sicheren Speicher (Windows: DPAPI).

export type OAuthProviderId = "google" | "microsoft";

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Zusätzliche Parameter für die Anmeldeseite. */
  authorizeParams: Record<string, string>;
  /** Host in der Rückleitung: Google akzeptiert 127.0.0.1, Microsoft verlangt „localhost“. */
  redirectHost: "127.0.0.1" | "localhost";
  /** Kontoeinstellungen nach der Anmeldung. */
  account: {
    provider: "gmail" | "outlook";
    imap: { host: string; port: number };
    smtp: { host: string; port: number; security: "tls" | "starttls" };
  };
}

export const oauthProviders: Record<OAuthProviderId, OAuthProviderConfig> = {
  google: {
    id: "google",
    label: "Google (Gmail)",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://mail.google.com/"],
    // offline + consent: Google liefert nur so ein Refresh-Token
    authorizeParams: { access_type: "offline", prompt: "consent" },
    redirectHost: "127.0.0.1",
    account: { provider: "gmail", imap: { host: "imap.gmail.com", port: 993 }, smtp: { host: "smtp.gmail.com", port: 465, security: "tls" } },
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft (Outlook, Hotmail, Microsoft 365)",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "email", "offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"],
    authorizeParams: { prompt: "select_account" },
    redirectHost: "localhost",
    account: { provider: "outlook", imap: { host: "outlook.office365.com", port: 993 }, smtp: { host: "smtp.office365.com", port: 587, security: "starttls" } },
  },
};

/** App-Registrierung beim Anbieter (Google Cloud bzw. Microsoft Entra). Das „Secret“ von Google-Desktop-Apps ist nicht geheim. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 */
  expiresAt: string;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    /** Refresh-Token ungültig (widerrufen, abgelaufen) – neu anmelden nötig. */
    readonly needsReauth = false,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE (RFC 7636): zufälliger Prüfwert und dessen SHA-256 – schützt, falls ein anderes Programm den Code abfängt. */
export async function createPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64Url(digest), state: base64Url(crypto.getRandomValues(new Uint8Array(16))) };
}

export function authorizeUrl(provider: OAuthProviderConfig, client: OAuthClient, options: { redirectUri: string; challenge: string; state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    scope: provider.scopes.join(" "),
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    state: options.state,
    ...provider.authorizeParams,
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  });
  return `${provider.authorizeUrl}?${params}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(provider: OAuthProviderConfig, client: OAuthClient, body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const response = await fetchImpl(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...body }),
  });
  let json: TokenResponse;
  try {
    json = (await response.json()) as TokenResponse;
  } catch {
    throw new OAuthError(`Anmeldung bei ${provider.label} fehlgeschlagen (HTTP ${response.status}).`);
  }
  if (!response.ok || json.error) {
    // invalid_grant = Refresh-Token widerrufen/abgelaufen; Beschreibungen der Anbieter nicht anzeigen (können Kennungen enthalten)
    const reauth = json.error === "invalid_grant";
    throw new OAuthError(
      reauth
        ? `Die Anmeldung bei ${provider.label} ist abgelaufen oder wurde widerrufen. Bitte erneut anmelden.`
        : `Anmeldung bei ${provider.label} fehlgeschlagen (${json.error ?? `HTTP ${response.status}`}).`,
      reauth,
    );
  }
  return json;
}

function expiresAt(response: TokenResponse, now: Date): string {
  return new Date(now.getTime() + Math.max(60, response.expires_in ?? 3600) * 1000).toISOString();
}

/** E-Mail-Adresse aus dem ID-Token (kommt direkt vom Token-Endpunkt über TLS – Signaturprüfung nicht nötig). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="))) as Record<string, unknown>;
    const email = json.email ?? json.preferred_username ?? json.upn;
    return typeof email === "string" && email.includes("@") ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Code aus der Rückleitung gegen Tokens tauschen. */
export async function exchangeCode(
  provider: OAuthProviderConfig,
  client: OAuthClient,
  options: { code: string; verifier: string; redirectUri: string; fetchImpl?: typeof fetch; now?: Date },
): Promise<OAuthTokens & { email: string | null }> {
  const json = await tokenRequest(provider, client, { grant_type: "authorization_code", code: options.code, code_verifier: options.verifier, redirect_uri: options.redirectUri }, options.fetchImpl ?? fetch);
  if (!json.access_token) throw new OAuthError(`${provider.label} hat kein Zugriffstoken geliefert.`);
  if (!json.refresh_token) throw new OAuthError(`${provider.label} hat kein dauerhaftes Token geliefert. Bitte die App-Registrierung prüfen (Offline-Zugriff).`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: expiresAt(json, options.now ?? new Date()), email: emailFromIdToken(json.id_token) };
}

/** Neues Zugriffstoken holen. Microsoft gibt dabei oft ein neues Refresh-Token aus – das alte wird dann ersetzt. */
export async function refreshTokens(
  provider: OAuthProviderConfig,
  client: OAuthClient,
  refreshToken: string,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<OAuthTokens> {
  const json = await tokenRequest(provider, client, { grant_type: "refresh_token", refresh_token: refreshToken, scope: provider.scopes.join(" ") }, options.fetchImpl ?? fetch);
  if (!json.access_token) throw new OAuthError(`${provider.label} hat kein Zugriffstoken geliefert.`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken, expiresAt: expiresAt(json, options.now ?? new Date()) };
}

/** Läuft das Token in den nächsten 2 Minuten ab? Dann vorher erneuern. */
export function tokenNeedsRefresh(tokens: Pick<OAuthTokens, "expiresAt">, now: Date = new Date()): boolean {
  return new Date(tokens.expiresAt).getTime() - now.getTime() < 2 * 60_000;
}

/** Gespeicherte Form im sicheren Speicher (JSON). */
export interface StoredOAuth extends OAuthTokens {
  provider: OAuthProviderId;
}

export function parseStoredOAuth(value: string | null): StoredOAuth | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredOAuth>;
    if ((parsed.provider === "google" || parsed.provider === "microsoft") && typeof parsed.refreshToken === "string" && typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "string") {
      return parsed as StoredOAuth;
    }
  } catch {
    // kaputt → neu anmelden
  }
  return null;
}
