import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { OutgoingMail } from "../compose.js";
import type { Account, ConnectionSecurity, EmailAddress } from "../models.js";
import { MailConnectionError } from "./connection.js";

export interface SmtpLogin {
  host: string;
  port: number;
  security: ConnectionSecurity;
  user: string;
  pass: string;
}

export function smtpLoginFor(account: Pick<Account, "smtpHost" | "smtpPort" | "smtpSecurity" | "username">, password: string): SmtpLogin {
  return { host: account.smtpHost, port: account.smtpPort, security: account.smtpSecurity, user: account.username, pass: password };
}

export interface BuiltMessage {
  raw: Buffer;
  envelope: { from: string; to: string[] };
  messageId: string;
}

/** Baut die MIME-Nachricht. Bcc steht nur im Umschlag, nicht in den Kopfzeilen. */
export async function buildMessage(mail: OutgoingMail, options: { from: EmailAddress; messageId: string; date: Date }): Promise<BuiltMessage> {
  const address = (a: EmailAddress) => ({ name: a.name ?? "", address: a.address });
  const composer = new MailComposer({
    from: address(options.from),
    to: mail.to.map(address),
    cc: mail.cc.map(address),
    bcc: mail.bcc.map(address),
    subject: mail.subject,
    text: mail.bodyText,
    messageId: options.messageId,
    date: options.date,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references?.length ? mail.references : undefined,
    headers: { "X-Mailer": "StinkyMa" },
    // Keine Dateien oder URLs nachladen – der Inhalt kommt ausschließlich aus dem Composer.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const node = composer.compile();
  const envelope = node.getEnvelope();
  const raw = await new Promise<Buffer>((resolve, reject) => node.build((error, message) => (error ? reject(error) : resolve(message))));
  return { raw, envelope: { from: envelope.from || options.from.address, to: envelope.to }, messageId: options.messageId };
}

/** Der Server hat die Mail endgültig abgelehnt (5xx) – erneutes Senden hilft nicht, der Nutzer muss sie ändern. */
export class SmtpRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpRejectedError";
  }
}

/** Übergibt eine fertige Nachricht an den SMTP-Server. */
export async function sendRaw(login: SmtpLogin, message: Pick<BuiltMessage, "raw" | "envelope">, options: { timeoutMs?: number } = {}): Promise<void> {
  const timeout = options.timeoutMs ?? 30_000;
  const transport = nodemailer.createTransport({
    host: login.host,
    port: login.port,
    secure: login.security === "tls",
    requireTLS: login.security === "starttls",
    ignoreTLS: login.security === "none",
    auth: login.security === "none" && !login.pass ? undefined : { user: login.user, pass: login.pass },
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout * 2,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({ envelope: message.envelope, raw: message.raw });
  } catch (error) {
    throw classifySmtpError(error);
  } finally {
    transport.close();
  }
}

/** Übersetzt SMTP-Fehler: dauerhaft abgelehnt → SmtpRejectedError, sonst Verbindungsfehler (später erneut versuchen). */
export function classifySmtpError(error: unknown): Error {
  const e = error as { code?: string; responseCode?: number; response?: string; message?: string };
  if (e.code === "EAUTH") {
    return new MailConnectionError("Anmeldung am Postausgangsserver (SMTP) fehlgeschlagen. Passwort oder Servereinstellungen prüfen.");
  }
  if (typeof e.responseCode === "number" && e.responseCode >= 500) {
    const detail = (e.response ?? e.message ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    return new SmtpRejectedError(`Der Server hat die Mail abgelehnt: ${detail}`);
  }
  if (e.code === "EENVELOPE") return new SmtpRejectedError("Mindestens ein Empfänger fehlt oder ist ungültig.");
  const reason = e.code === "ETIMEDOUT" ? "Zeitüberschreitung" : e.code === "ECONNECTION" || e.code === "ESOCKET" || e.code === "EDNS" ? "Server nicht erreichbar" : (e.message ?? "unbekannter Fehler");
  return new MailConnectionError(`Senden nicht möglich (${reason}). Die Mail bleibt im Postausgang.`);
}
