import type { ConnectionSecurity, MailProvider } from "../models.js";

// Bekannte Anbieter (Spezifikation 4.1). Plattformneutral – später auch für Server und iPad nutzbar.
// Auto-Discovery über Mozilla-ISPDB und DNS-SRV folgt in Phase W3.

export interface ServerSettings {
  host: string;
  port: number;
  security: ConnectionSecurity;
}

export interface ProviderSettings {
  provider: MailProvider;
  /** Anzeigename des Anbieters. */
  label: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  /** Wie man sich anmeldet: normales Passwort, app-spezifisches Passwort oder (ab W3) OAuth. */
  auth: "password" | "app-password" | "oauth-required";
  /** Hilfeseite, z. B. zum Erstellen eines app-spezifischen Passworts. */
  helpUrl?: string;
}

interface KnownProvider extends ProviderSettings {
  domains: string[];
}

const known: KnownProvider[] = [
  {
    provider: "icloud", label: "iCloud", domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
    auth: "app-password", helpUrl: "https://support.apple.com/de-de/102654",
  },
  {
    provider: "gmail", label: "Gmail", domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, security: "tls" },
    smtp: { host: "smtp.gmail.com", port: 587, security: "starttls" },
    auth: "app-password", helpUrl: "https://support.google.com/accounts/answer/185833?hl=de",
  },
  {
    provider: "outlook", label: "Outlook / Microsoft 365",
    domains: ["outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com"],
    imap: { host: "outlook.office365.com", port: 993, security: "tls" },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    auth: "oauth-required",
  },
  {
    provider: "yahoo", label: "Yahoo", domains: ["yahoo.com", "yahoo.de", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
    auth: "app-password", helpUrl: "https://de.hilfe.yahoo.com/kb/SLN15241.html",
  },
  {
    provider: "imap", label: "GMX", domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"],
    imap: { host: "imap.gmx.net", port: 993, security: "tls" },
    smtp: { host: "mail.gmx.net", port: 587, security: "starttls" },
    auth: "password",
  },
  {
    provider: "imap", label: "WEB.DE", domains: ["web.de"],
    imap: { host: "imap.web.de", port: 993, security: "tls" },
    smtp: { host: "smtp.web.de", port: 587, security: "starttls" },
    auth: "password",
  },
  {
    provider: "imap", label: "T-Online", domains: ["t-online.de", "magenta.de"],
    imap: { host: "secureimap.t-online.de", port: 993, security: "tls" },
    smtp: { host: "securesmtp.t-online.de", port: 465, security: "tls" },
    auth: "password",
  },
  {
    provider: "imap", label: "Posteo", domains: ["posteo.de", "posteo.net"],
    imap: { host: "posteo.de", port: 993, security: "tls" },
    smtp: { host: "posteo.de", port: 587, security: "starttls" },
    auth: "password",
  },
  {
    provider: "imap", label: "mailbox.org", domains: ["mailbox.org"],
    imap: { host: "imap.mailbox.org", port: 993, security: "tls" },
    smtp: { host: "smtp.mailbox.org", port: 587, security: "starttls" },
    auth: "password",
  },
];

export function emailDomain(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.trim().slice(at + 1).toLowerCase();
  return domain.includes(".") ? domain : null;
}

/** Einstellungen für bekannte Anbieter, sonst `null` (dann manuelle Eingabe). */
export function detectProvider(email: string): ProviderSettings | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  const match = known.find((p) => p.domains.includes(domain));
  if (!match) return null;
  const { domains: _domains, ...settings } = match;
  return structuredClone(settings);
}

/** Vorschlag für unbekannte Domains: imap.<domain> / smtp.<domain>. */
export function guessSettings(email: string): ProviderSettings | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  return {
    provider: "imap",
    label: domain,
    imap: { host: `imap.${domain}`, port: 993, security: "tls" },
    smtp: { host: `smtp.${domain}`, port: 587, security: "starttls" },
    auth: "password",
  };
}
