import { ImapFlow } from "imapflow";
import type { Account, ConnectionSecurity } from "../models.js";

export interface ImapLogin {
  host: string;
  port: number;
  security: ConnectionSecurity;
  username: string;
  password: string;
}

export function loginFor(account: Pick<Account, "imapHost" | "imapPort" | "imapSecurity" | "username">, password: string): ImapLogin {
  return { host: account.imapHost, port: account.imapPort, security: account.imapSecurity, username: account.username, password };
}

/** Öffnet eine IMAP-Verbindung. Passwörter und Mail-Inhalte werden nie geloggt (logger: false). */
export async function connectImap(login: ImapLogin, options: { timeoutMs?: number; maxIdleTimeMs?: number } = {}): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: login.host,
    port: login.port,
    secure: login.security === "tls",
    doSTARTTLS: login.security === "starttls" ? true : login.security === "none" ? false : undefined,
    auth: { user: login.username, pass: login.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: options.timeoutMs ?? 20_000,
    greetingTimeout: options.timeoutMs ?? 20_000,
    socketTimeout: 5 * 60_000,
    // Wächter-Verbindungen: IDLE regelmäßig erneuern, damit die stille Leitung nicht als hängend getrennt wird.
    ...(options.maxIdleTimeMs ? { maxIdleTime: options.maxIdleTimeMs } : {}),
  });
  // Unbehandelte Fehler-Events würden den Prozess beenden; Fehler kommen über die aufrufenden Promises.
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    client.close();
    throw new MailConnectionError(describeConnectionError(error), error);
  }
  return client;
}

export class MailConnectionError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
  }
}

/** Verständliche deutsche Fehlermeldung – ohne Zugangsdaten. */
export function describeConnectionError(error: unknown): string {
  const e = error as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string };
  if (e?.authenticationFailed || /auth|login|credentials|invalid/i.test(e?.responseText ?? "")) {
    return "Anmeldung fehlgeschlagen. Bitte Benutzername und Passwort prüfen – bei iCloud, Gmail und Yahoo wird ein app-spezifisches Passwort benötigt.";
  }
  switch (e?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Server nicht gefunden. Bitte die Serveradresse und die Internetverbindung prüfen.";
    case "ECONNREFUSED":
      return "Der Server hat die Verbindung abgelehnt. Bitte Port und Verschlüsselung prüfen.";
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
    case "GREETING_TIMEOUT":
      return "Zeitüberschreitung beim Verbinden. Bitte später erneut versuchen.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "Das Zertifikat des Servers ist ungültig. Aus Sicherheitsgründen wird keine Verbindung hergestellt.";
  }
  return `Verbindung fehlgeschlagen${e?.message ? `: ${e.message}` : "."}`;
}

/** Prüft Zugangsdaten: verbinden, abmelden. */
export async function testImapLogin(login: ImapLogin): Promise<void> {
  const client = await connectImap(login, { timeoutMs: 15_000 });
  await client.logout().catch(() => client.close());
}
